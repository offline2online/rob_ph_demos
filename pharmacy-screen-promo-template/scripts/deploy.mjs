#!/usr/bin/env node
// One-command deploy of the Pharmacy Screen Promo Template to our test
// environment (Firebase project rob-ph-demos), from a clean checkout:
//
//   cd pharmacy-screen-promo-template && npm run deploy
//
// It runs, in order:
//   1. install   npm install (production deps) in both Cloud Functions sources,
//                which the Firebase CLI needs to read the functions; stage
//                .deploy/public (the screen and admin files, by allow-list)
//                and .deploy/firestore.rules (the repo-root ruleset:
//                rob-ph-demos has one, shared with the menu-board demo, and
//                the Firebase CLI refuses a rules file outside this folder)
//   2. setup     idempotent one-time infrastructure (skipped with --skip-setup):
//                Google APIs, the Hosting site, the media bucket (linked to
//                Firebase Storage), the Cloud KMS key that wraps the PH API
//                token and the functions' right to use it, the Hosting
//                domains as Auth authorized domains, the Artifact Registry
//                cleanup policy for the function images. Each step checks
//                first (or is idempotent) and does nothing if it is already in
//                place.
//   3. deploy    firebase deploy of both functions codebases (config API, PH
//                API proxy) on their own; then Hosting (the screen and admin),
//                the Firestore rules and indexes and the media bucket's
//                Storage rules; then a check that the site's API answers.
//                A functions error stops the deploy before Hosting, except the
//                missing-cleanup-policy message (functionsDeployOutcome).
//   4. URLs      prints the screen, admin and API URLs
//
// Options:
//   --project <id>   Firebase project (default: .firebaserc "default", rob-ph-demos)
//   --skip-setup     skip step 2 (CI does this: setup needs project-owner rights)
//   --dry-run        print every command without running anything
//   --help
//
// Credentials: your own `gcloud auth login` + `firebase login`, or in CI a
// service account through GOOGLE_APPLICATION_CREDENTIALS. Nothing here reads,
// writes or prints the PH API token: the admin enters it in Settings after the
// first deploy (pharmacy-screen/ph-proxy/README.md).

import { spawn, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, copyFileSync, cpSync, rmSync, readdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

export const FIREBASE_TOOLS = "firebase-tools@14.27.0";
// Where both functions run: Sydney, next to the Australian stores (they ran in us-central1 until 23 Nov 2026).
// firebase.json's Hosting rewrites name it too, and PS_REGION / PH_REGION in the functions' .env.<project> files
// must match (test/deploy-config.test.mjs). The media bucket is created here only if it does not exist yet.
// The deploy never deletes a function. A future region move is done as separate deploys, in this order: create
// the functions in the new region, publish Hosting pointing at them, check the API answers, and only then delete
// the old ones by hand (docs/DEPLOYMENT.md → "Moving the functions to another region"). Deleting first is what
// took the site's API down on 23 Nov 2026.
export const REGION = "australia-southeast1";
export const KMS = { location: "global", keyRing: "pharmacy-screen", key: "ph-api-token" };
export const CODEBASES = ["pharmacy-screen-config-api", "pharmacy-screen-ph-proxy"];
export const FUNCTION_SOURCES = ["pharmacy-screen/config-api", "pharmacy-screen/ph-proxy"];
// What Hosting publishes, by allow-list, from pharmacy-screen/: the screen page,
// the admin editor and the seed fixtures the editor's Reset reads
// (../seed/fixtures/). Everything else there (config-api/, ph-proxy/, the rest
// of seed/, env files) is server code or tooling and is never staged, so it
// can't be published by a later Hosting "ignore" slip. Inside an entry,
// STAGE_SKIP drops dotfiles, node_modules and the editor's own tests, tools
// and package files.
export const PUBLIC_SOURCE = "pharmacy-screen";
export const PUBLIC_ENTRIES = ["pharmacy-screen.html", "sw.js", "css", "js", "fixtures", "admin", "seed/fixtures"];
export const STAGE_SKIP = /(^|[\\/])(\.[^\\/]*|node_modules|test|tools|package\.json|package-lock\.json|README\.md)$/;
// The Firebase web app the admin editor signs in with; the deploy writes its
// (non-secret) config into the staged admin/config.js.
export const ADMIN_WEB_APP = "Pharmacy Screen admin";
// The project's one Firestore ruleset lives at the repo root (shared with the
// menu-board demo); the Firebase CLI reads rules only from inside this folder.
export const RULES_SOURCE = "../firestore.rules";
export const STAGE_DIR = ".deploy";

// Writes <out>/public (Hosting's "public") and <out>/firestore.rules (the
// Firestore "rules"), fresh every run. firebase.json points at both.
export function stage(root = ROOT, out = join(root, STAGE_DIR)) {
  const build = stagePublic(root, join(out, "public"));
  copyFileSync(join(root, RULES_SOURCE), join(out, "firestore.rules"));
  return `staged ${PUBLIC_ENTRIES.join(", ")} and ${RULES_SOURCE} in ${STAGE_DIR}/ (screen build ${build})`;
}

// The published files alone (no rules), sw.js stamped; returns the build id. The rules live outside this folder,
// so a release package (scripts/release.mjs), which has no repo root, stages and tests through this.
export function stagePublic(root = ROOT, pub = join(root, STAGE_DIR, "public")) {
  rmSync(pub, { recursive: true, force: true });
  mkdirSync(pub, { recursive: true });
  for (const entry of PUBLIC_ENTRIES) {
    const from = join(root, PUBLIC_SOURCE, entry);
    cpSync(from, join(pub, entry), {
      recursive: true,
      filter: (src) => src === from || !STAGE_SKIP.test(src.slice(from.length)),
    });
  }
  return stampServiceWorker(pub);
}

// The screen as the players download it (buildShell), then its service worker (pharmacy-screen/sw.js) stamped with
// the result. Run on the staged copy (Firebase, AWS and the release package all stage through here), never on the
// repo's own files, and safe to run again on a staged copy whose css/ or js/ changed (the tests do).
//
//   assets/js/<name>.<hash>.js     every module in js/, its imports and the stylesheet paths it loads pointing at the
//                                  fingerprinted copies, so the copies only ever load each other
//   assets/css/<name>.<hash>.css   every stylesheet in css/, with each base64 font and image in it written out as
//   assets/fonts/<hash>.woff2      its own file (the committed stylesheets keep them as data: URLs because the
//   assets/media/<hash>.jpg        board's patch hand-over takes text only)
//   pharmacy-screen.html           its stylesheet, script and modulepreload URLs pointing at assets/
//   sw.js                          FILES: every one of those files and the hash of its content; BUILD: a hash of FILES
//
// A name in assets/ is the hash of its content, so it is published with Cache-Control immutable (firebase.json,
// aws/infra/stack.js) and a player never asks for it twice; pharmacy-screen.html and sw.js stay no-cache. A deploy
// that changes nothing leaves sw.js byte-identical and the players download nothing; one that changes js/player.js
// makes them download sw.js, the page and that one script (the worker keeps every unchanged file). The original
// css/ and js/ stay published for the admin editor's preview, which imports the render engine from them.
export const SW_FILE = "sw.js";
export const SW_PLACEHOLDER = "__PHARMACY_SCREEN_BUILD__";
export const SW_FILES_PLACEHOLDER = "{/*__PHARMACY_SCREEN_FILES__*/}";
export const SHELL_PAGE = "pharmacy-screen.html";
export const SHELL_DIRS = ["css", "js"];
export const ASSETS_DIR = "assets";
const NAME_HASH = 10; // hex characters in a fingerprinted name
const BINARY = { "font/woff2": ["fonts", "woff2"], "image/jpeg": ["media", "jpg"], "image/png": ["media", "png"], "image/webp": ["media", "webp"] };
const sha256 = (data) => createHash("sha256").update(data).digest("hex");
const fingerprint = (rel, data) => rel.replace(/\.(css|js)$/, (ext) => `.${sha256(data).slice(0, NAME_HASH)}${ext}`);
// An import of a sibling module: `from './x.js'`, `import './x.js'`, `import('./x.js')`.
const IMPORT = /(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(['"])\.\/([\w-]+\.js)\2/g;
// A document-relative stylesheet path in a script ('css/debug.css'), as js/player.js and js/debug-panel.js load them.
const CSS_PATH = /(['"])css\/([\w-]+\.css)\1/g;
// A stylesheet, script or module preload in the page, before or after an earlier build.
const PAGE_REF = /((?:href|src)=")(?:assets\/)?(css|js)\/([\w-]+)(?:\.[0-9a-f]+)?\.(css|js)"/g;

export function buildShell(pub) {
  rmSync(join(pub, ASSETS_DIR), { recursive: true, force: true });
  const put = (rel, data) => {
    mkdirSync(dirname(join(pub, rel)), { recursive: true });
    writeFileSync(join(pub, rel), data);
  };
  const map = {}; // "css/screen.css" -> "assets/css/screen.<hash>.css"

  for (const f of readdirSync(join(pub, "css")).filter((n) => n.endsWith(".css")).sort()) {
    const css = readFileSync(join(pub, "css", f), "utf8").replace(
      /url\(\s*(["']?)data:(font\/woff2|image\/jpeg|image\/png|image\/webp);base64,([A-Za-z0-9+/=]+)\1\s*\)/g,
      (m, q, type, b64, at, whole) => {
        const bytes = Buffer.from(b64, "base64");
        const [dir, ext] = BINARY[type];
        const name = `${sha256(bytes).slice(0, 16)}.${ext}`;
        put(`${ASSETS_DIR}/${dir}/${name}`, bytes);
        // A url() in a custom property (--occ-photo) is resolved where var() uses it: the screen's own <style>, so
        // relative to the page (beside assets/), not to this stylesheet.
        const decl = whole.slice(Math.max(whole.lastIndexOf("{", at), whole.lastIndexOf(";", at)) + 1, at);
        return /^\s*--/.test(decl) ? `url("${ASSETS_DIR}/${dir}/${name}")` : `url("../${dir}/${name}")`;
      }
    );
    const rel = `${ASSETS_DIR}/${fingerprint(`css/${f}`, css)}`;
    put(rel, css);
    map[`css/${f}`] = rel;
  }

  const sources = Object.fromEntries(readdirSync(join(pub, "js")).filter((n) => n.endsWith(".js")).sort().map((n) => [n, readFileSync(join(pub, "js", n), "utf8")]));
  const cssPaths = (src, where) => src.replace(CSS_PATH, (m, q, name) => {
    if (!map[`css/${name}`]) throw new Error(`${where} loads css/${name}, which is not in css/`);
    return `${q}${map[`css/${name}`]}${q}`;
  });
  // Leaves first, so a module's copy names its imports' fingerprinted copies.
  const state = {};
  const visit = (name, chain) => {
    if (state[name] === "done") return;
    if (state[name] === "visiting") throw new Error(`js/ has an import cycle: ${[...chain, name].join(" -> ")}`);
    if (!(name in sources)) throw new Error(`js/${chain.at(-1)} imports ./${name}, which is not in js/`);
    state[name] = "visiting";
    for (const m of sources[name].matchAll(IMPORT)) visit(m[3], [...chain, name]);
    const src = cssPaths(sources[name].replace(IMPORT, (m, lead, q, dep) => `${lead}${q}./${map[`js/${dep}`].split("/").pop()}${q}`), `js/${name}`);
    const rel = `${ASSETS_DIR}/${fingerprint(`js/${name}`, src)}`;
    put(rel, src);
    map[`js/${name}`] = rel;
    state[name] = "done";
  };
  for (const name of Object.keys(sources)) visit(name, []);

  const page = join(pub, SHELL_PAGE);
  writeFileSync(page, readFileSync(page, "utf8").replace(PAGE_REF, (m, attr, dir, name, ext) => {
    const to = map[`${dir}/${name}.${ext}`];
    if (!to || dir !== ext) throw new Error(`${SHELL_PAGE} refers to ${dir}/${name}.${ext}, which is not in ${dir}/`);
    return `${attr}${to}"`;
  }));
  return shellFiles(pub);
}

// The shell as it stands in a staged copy: the page and everything in assets/, each with the first 16 hex characters
// of the SHA-256 of its bytes (what sw.js checks a cached or downloaded copy against).
export function shellFiles(pub) {
  const files = [SHELL_PAGE];
  const walk = (rel) => {
    for (const n of readdirSync(join(pub, rel), { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      if (n.isDirectory()) walk(`${rel}/${n.name}`);
      else files.push(`${rel}/${n.name}`);
    }
  };
  if (existsSync(join(pub, ASSETS_DIR))) walk(ASSETS_DIR);
  return Object.fromEntries(files.map((f) => [f, sha256(readFileSync(join(pub, f))).slice(0, 16)]));
}
export const shellBuildId = (pub) => sha256(JSON.stringify(shellFiles(pub))).slice(0, 16);

// Builds the shell and stamps sw.js with it. Returns the build id.
export function stampServiceWorker(pub) {
  const file = join(pub, SW_FILE);
  const src = readFileSync(file, "utf8");
  if (!src.includes(SW_PLACEHOLDER)) throw new Error(`${SW_FILE} has no ${SW_PLACEHOLDER} to stamp`);
  if (!src.includes(SW_FILES_PLACEHOLDER)) throw new Error(`${SW_FILE} has no ${SW_FILES_PLACEHOLDER} to stamp`);
  const files = buildShell(pub);
  const build = sha256(JSON.stringify(files)).slice(0, 16);
  writeFileSync(file, src.split(SW_PLACEHOLDER).join(build).split(SW_FILES_PLACEHOLDER).join(JSON.stringify(files)));
  return build;
}

// The admin editor's deployed config.js: Firebase sign-in with this project's
// web app config (apiKey, authDomain, projectId, appId are public identifiers,
// not secrets). The committed admin/config.js keeps firebase: null, so a copy
// served without this deploy shows "Sign-in is not set up" instead of signing
// in to the wrong project.
//
// adminAuth says how people sign in to the editor (PS_ADMIN_AUTH, default
// ADMIN_AUTH_DEFAULT):
//   "ph"           only from Personalisation Hub: the page that embeds the
//                  editor hands over the signed-in user's session
//                  (docs/PH-EMBED.md). Opened any other way: "Access denied".
//                  Set PS_REQUIRE_PH_SESSION and PH_REQUIRE_PH_SESSION to true
//                  in the functions' .env.<project> files with it, so the
//                  APIs refuse every other sign-in too.
//   "ph+firebase"  the same, but where the embedding page does not hand a
//                  session over (yet), the Firebase sign-in is offered. For
//                  the changeover only.
//   "firebase"     Firebase sign-in only (as before PH sign-in existed).
export const ADMIN_AUTH_MODES = ["ph", "ph+firebase", "firebase"];
export const ADMIN_AUTH_DEFAULT = "ph+firebase";
export const PH_PARENT_ORIGINS = ["https://ph.mipharmacy.net"];
export function adminConfigJs({ apiKey, authDomain, projectId, appId }, { adminAuth = ADMIN_AUTH_DEFAULT, parentOrigins = PH_PARENT_ORIGINS } = {}) {
  if (!apiKey || !projectId) throw new Error("the admin web app config has no apiKey/projectId");
  if (!ADMIN_AUTH_MODES.includes(adminAuth)) throw new Error(`PS_ADMIN_AUTH must be one of ${ADMIN_AUTH_MODES.join(", ")}`);
  const firebase = { apiKey, authDomain: authDomain || `${projectId}.firebaseapp.com`, projectId };
  if (appId) firebase.appId = appId;
  const auth = adminAuth === "firebase" ? { mode: "firebase", firebase } : { mode: "ph", firebase, ph: { parentOrigins, ...(adminAuth === "ph+firebase" ? { fallback: "firebase" } : {}) } };
  const cfg = { apiBase: "", screenPage: "", auth };
  return `// Written by scripts/deploy.mjs for this deploy (see pharmacy-screen/admin/config.js). Non-secret.\nexport default ${JSON.stringify(cfg, null, 2)};\n`;
}

export function writeAdminConfig(web, out = join(ROOT, STAGE_DIR), opts = { adminAuth: process.env.PS_ADMIN_AUTH || ADMIN_AUTH_DEFAULT }) {
  const file = join(out, "public", "admin", "config.js");
  writeFileSync(file, adminConfigJs(web, opts));
  return file;
}

// Download MP4 files (exports/ in the media bucket) are deleted a day after they are made.
export const EXPORTS_LIFECYCLE = { rule: [{ action: { type: "Delete" }, condition: { age: 1, matchesPrefix: ["exports/"] } }] };

export const APIS = [
  "cloudfunctions.googleapis.com",
  "run.googleapis.com",
  "cloudbuild.googleapis.com",
  "artifactregistry.googleapis.com",
  "eventarc.googleapis.com",
  "cloudkms.googleapis.com",
  "firestore.googleapis.com",
  "firebasehosting.googleapis.com",
  "firebasestorage.googleapis.com",
  "identitytoolkit.googleapis.com",
  "firebase.googleapis.com",
  "cloudtasks.googleapis.com", // Download MP4's worker is a Cloud Tasks queue function
  "iamcredentials.googleapis.com", // ...and signs its one-hour download links (signBlob)
];

export function readTargets(projectId, root = ROOT) {
  const rc = JSON.parse(readFileSync(join(root, ".firebaserc"), "utf8"));
  const project = projectId || rc.projects.default;
  const t = (rc.targets && rc.targets[project]) || {};
  const site = t.hosting && t.hosting["pharmacy-screen"] && t.hosting["pharmacy-screen"][0];
  const bucket = t.storage && t.storage["pharmacy-screen-media"] && t.storage["pharmacy-screen-media"][0];
  if (!site || !bucket) {
    throw new Error(`.firebaserc has no pharmacy-screen hosting / pharmacy-screen-media storage target for project "${project}"`);
  }
  return { project, site, bucket };
}

export function urls({ project, site }) {
  const origin = `https://${site}.web.app`;
  return {
    screen: `${origin}/pharmacy-screen.html?device=TEST&promo=morning&orientation=portrait&mockapi=1`,
    admin: `${origin}/admin/`,
    api: `${origin}/api`,
    health: `${origin}/api/health`,
    configApiFunction: `https://${REGION}-${project}.cloudfunctions.net/pharmacyScreenConfigApi`,
    phApiFunction: `https://${REGION}-${project}.cloudfunctions.net/pharmacyScreenPhApi`,
  };
}

const fb = (...args) => ["npx", "--yes", FIREBASE_TOOLS, ...args];

// The whole run as data, so --dry-run and the tests see exactly what runs.
// Step kinds: "run" (a command), "ensure" (run `check`; only if it fails, run
// `cmd`), "task" (an in-process function, for the REST calls).
export function buildPlan({ project, site, bucket, skipSetup = false }) {
  const steps = [];
  const kmsKey = `projects/${project}/locations/${KMS.location}/keyRings/${KMS.keyRing}/cryptoKeys/${KMS.key}`;

  steps.push({
    phase: "install",
    kind: "task",
    task: "stage",
    label: "Stage the Hosting files (screen and admin only) and the repo-root Firestore rules in .deploy/",
    args: {},
  });
  for (const src of FUNCTION_SOURCES) {
    steps.push({
      phase: "install",
      kind: "run",
      label: `Install ${src} dependencies`,
      cmd: ["npm", "install", "--omit=dev", "--no-audit", "--no-fund", "--prefix", src],
    });
  }

  if (!skipSetup) {
    steps.push({
      phase: "setup",
      kind: "run",
      label: "Enable the Google APIs the deploy uses",
      cmd: ["gcloud", "services", "enable", ...APIS, `--project=${project}`],
    });
    steps.push({
      phase: "setup",
      kind: "ensure",
      label: `Hosting site ${site}`,
      check: fb("hosting:sites:get", site, "--project", project),
      cmd: fb("hosting:sites:create", site, "--project", project),
    });
    steps.push({
      phase: "setup",
      kind: "ensure",
      label: `Media bucket gs://${bucket}`,
      check: ["gcloud", "storage", "buckets", "describe", `gs://${bucket}`, `--project=${project}`],
      cmd: ["gcloud", "storage", "buckets", "create", `gs://${bucket}`, `--project=${project}`, `--location=${REGION}`, "--uniform-bucket-level-access"],
    });
    steps.push({
      phase: "setup",
      kind: "task",
      task: "linkBucketToFirebase",
      label: `Link gs://${bucket} to Firebase Storage (so its rules can be deployed)`,
      args: { project, bucket },
    });
    steps.push({
      phase: "setup",
      kind: "ensure",
      label: `KMS key ring ${KMS.keyRing}`,
      check: ["gcloud", "kms", "keyrings", "describe", KMS.keyRing, `--location=${KMS.location}`, `--project=${project}`],
      cmd: ["gcloud", "kms", "keyrings", "create", KMS.keyRing, `--location=${KMS.location}`, `--project=${project}`],
    });
    steps.push({
      phase: "setup",
      kind: "ensure",
      label: `KMS key ${KMS.key} (wraps the PH API token's data key; rotates every 90 days)`,
      check: ["gcloud", "kms", "keys", "describe", KMS.key, `--keyring=${KMS.keyRing}`, `--location=${KMS.location}`, `--project=${project}`],
      cmd: [
        "gcloud", "kms", "keys", "create", KMS.key, `--keyring=${KMS.keyRing}`, `--location=${KMS.location}`,
        "--purpose=encryption", "--rotation-period=90d", `--next-rotation-time=${new Date(Date.now() + 90 * 864e5).toISOString().replace(/\.\d+Z$/, "Z")}`,
        `--project=${project}`,
      ],
    });
    steps.push({
      phase: "setup",
      kind: "task",
      task: "grantKmsToRuntime",
      label: `Let the functions' runtime service account use ${KMS.key} (on that key only)`,
      args: { project, kmsKey },
    });
    steps.push({
      phase: "setup",
      kind: "task",
      task: "grantTasksToRuntime",
      label: "Let the functions' runtime service account queue Download MP4 renders (Cloud Tasks Enqueuer)",
      args: { project },
    });
    steps.push({
      phase: "setup",
      kind: "task",
      task: "grantSignToRuntime",
      label: "Let the functions' runtime service account sign Download MP4's one-hour links (Token Creator, on itself only)",
      args: { project },
    });
    steps.push({
      phase: "setup",
      kind: "task",
      task: "expireVideoExports",
      label: `Delete Download MP4 files under exports/ in gs://${bucket} after a day (lifecycle rule)`,
      args: { project, bucket },
    });
    steps.push({
      phase: "setup",
      kind: "task",
      task: "authorizeDomains",
      label: `Add ${site}.web.app and ${site}.firebaseapp.com to Auth authorized domains`,
      args: { project, domains: [`${site}.web.app`, `${site}.firebaseapp.com`] },
    });
    // Setup, not deploy: the CI service account may not set it (it needs Artifact Registry Administrator), and
    // trying on every CI run only printed an error. The owner's run sets it once per region (idempotent); until
    // then the functions step ends in the cleanup-policy message, which functionsDeployOutcome lets through.
    steps.push({
      phase: "setup",
      kind: "run",
      label: `Artifact Registry cleanup policy for function images in ${REGION} (keeps 7 days)`,
      cmd: fb(...CLEANUP_POLICY_ARGS, "--project", project),
    });
  }

  steps.push({
    phase: "deploy",
    kind: "task",
    task: "adminConfig",
    label: `Write the admin editor's Firebase sign-in config (web app "${ADMIN_WEB_APP}") into the staged admin/config.js`,
    args: { project },
  });
  // Functions first and on their own, then everything else, then a check that the site's API answers. One
  // `firebase deploy` of both stops before Hosting when the functions step ends in any error, the missing image
  // cleanup policy included. So the functions step is judged by functionsDeployOutcome: the cleanup-policy message
  // alone (the functions themselves deployed) carries on to Hosting with a warning; any other functions error stops
  // the deploy here, before Hosting, which keeps serving the previous functions (nothing is ever deleted). The API
  // check after Hosting then decides whether the deploy is good.
  const deploy = (only) => fb("deploy", "--project", project, "--non-interactive", "--only", only.join(","));
  steps.push({
    phase: "deploy",
    kind: "run",
    judge: "functionsDeploy",
    label: "Deploy the functions",
    cmd: deploy(CODEBASES.map((c) => `functions:${c}`)),
  });
  steps.push({
    phase: "deploy",
    kind: "run",
    label: "Deploy Hosting, Firestore rules and indexes, Storage rules",
    cmd: deploy(["hosting:pharmacy-screen", "firestore:rules", "firestore:indexes", "storage:pharmacy-screen-media"]),
  });
  steps.push({
    phase: "deploy",
    kind: "task",
    task: "checkApi",
    label: "Check the site's API answers (config API and PH API proxy, through Hosting)",
    args: { site },
  });
  return steps;
}

// The one-time command that sets the function images' cleanup policy (without --project). The owner's deploy runs
// it in setup; it is also the command docs/DEPLOYMENT.md and README "Continuous deploy" give the owner.
export const CLEANUP_POLICY_ARGS = ["functions:artifacts:setpolicy", "--location", REGION, "--days", "7", "--force"];

// How the "Deploy the functions" step ended, from its exit status and everything it printed:
//   "ok"              exit 0
//   "cleanup-policy"  the functions deployed, but the Firebase CLI could not set up the image cleanup policy
//                     ("Functions successfully deployed but could not set up cleanup policy in location …"): passable,
//                     the deploy carries on to Hosting with a warning naming the owner's one-time command
//   "failed"          anything else, including that message alongside a function that failed to create or update:
//                     the deploy stops before Hosting
export const CLEANUP_POLICY_MESSAGE = /Functions successfully deployed but could not set up cleanup polic/i;
// Both strings are firebase-tools' own wording (pinned by FIREBASE_TOOLS above); re-check them when it is upgraded.
// Unrecognised output fails closed: only the exact cleanup-policy sentence, with no failure line, is passable.
const FUNCTION_FAILURE = /Functions deploy had errors|Failed to (create|update|delete) function/i;
export function functionsDeployOutcome(status, output = "") {
  if (status === 0) return "ok";
  const text = String(output);
  if (CLEANUP_POLICY_MESSAGE.test(text) && !FUNCTION_FAILURE.test(text)) return "cleanup-policy";
  return "failed";
}

// ── execution ──────────────────────────────────────────────────────────────

function run(cmd, { quiet = false } = {}) {
  const r = spawnSync(cmd[0], cmd.slice(1), { cwd: ROOT, stdio: quiet ? "ignore" : "inherit", env: process.env });
  return r.status === 0;
}

// Runs a command with its output shown as it comes and kept, for a step that is judged by what it printed.
function runTee(cmd) {
  return new Promise((resolve) => {
    const child = spawn(cmd[0], cmd.slice(1), { cwd: ROOT, stdio: ["inherit", "pipe", "pipe"], env: process.env });
    let output = "";
    child.stdout.on("data", (d) => { output += d; process.stdout.write(d); });
    child.stderr.on("data", (d) => { output += d; process.stderr.write(d); });
    child.on("error", (e) => resolve({ status: 1, output: output + String(e && e.message) }));
    child.on("close", (status) => resolve({ status, output }));
  });
}

function capture(cmd) {
  const r = spawnSync(cmd[0], cmd.slice(1), { cwd: ROOT, encoding: "utf8", env: process.env });
  if (r.status !== 0) throw new Error(`${cmd.slice(0, 3).join(" ")} failed: ${(r.stderr || "").trim().split("\n").pop()}`);
  return r.stdout.trim();
}

async function googleApi(method, url, project, body) {
  const token = capture(["gcloud", "auth", "print-access-token"]);
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, "x-goog-user-project": project, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : {} };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The site's own /api routes, through Hosting's rewrites: the config API's health route must answer 200, and the
// proxy must answer a device read as JSON (a made-up device is a clean JSON error; Hosting's own "Page not found"
// HTML means the rewrite reaches no function). Tried for up to two minutes: a new release takes a moment.
export async function checkApi({ site, origin = `https://${site}.web.app`, fetchImpl = fetch, tries = 12, waitMs = 10000 }) {
  let last = "";
  for (let i = 0; i < tries; i++) {
    try {
      const bust = `deploycheck=${Date.now()}`;
      const health = await fetchImpl(`${origin}/api/health?${bust}`, { cache: "no-store" });
      const device = await fetchImpl(`${origin}/api/device/DEPLOY-CHECK/campaign_data?${bust}`, { cache: "no-store" });
      const json = String(device.headers.get("content-type") || "").includes("application/json");
      if (health.status === 200 && json) return `config API ${health.status}, PH API proxy ${device.status} (JSON)`;
      last = `health ${health.status}, device read ${device.status}${json ? "" : " (not JSON: no function behind the rewrite)"}`;
    } catch (e) {
      last = String((e && e.message) || e);
    }
    if (i < tries - 1) await new Promise((r) => setTimeout(r, waitMs));
  }
  throw new Error(`The site's API does not answer after the deploy: ${last}. The editor and screens cannot load data until this is fixed.`);
}

const TASKS = {
  async checkApi(args) {
    return checkApi(args);
  },
  async stage() {
    return stage();
  },
  async linkBucketToFirebase({ project, bucket }) {
    const base = `https://firebasestorage.googleapis.com/v1beta/projects/${project}/buckets/${bucket}`;
    const got = await googleApi("GET", base, project);
    if (got.status === 200) return "already linked";
    const add = await googleApi("POST", `${base}:addFirebase`, project, {});
    if (add.status !== 200) throw new Error(`addFirebase returned ${add.status}`);
    return "linked";
  },
  async grantKmsToRuntime({ project, kmsKey }) {
    // Cloud Functions (2nd gen) run as the default compute service account
    // unless told otherwise; neither function sets one.
    const number = capture(["gcloud", "projects", "describe", project, "--format=value(projectNumber)"]);
    const member = `serviceAccount:${number}-compute@developer.gserviceaccount.com`;
    const ok = run([
      "gcloud", "kms", "keys", "add-iam-policy-binding", kmsKey,
      `--member=${member}`, "--role=roles/cloudkms.cryptoKeyEncrypterDecrypter", "--condition=None", "--quiet",
    ], { quiet: true });
    if (!ok) throw new Error("could not grant roles/cloudkms.cryptoKeyEncrypterDecrypter on the key");
    return "granted (idempotent)";
  },
  async grantTasksToRuntime({ project }) {
    // The config API enqueues one task per video on pharmacyScreenVideoWorker's queue (config-api/index.js).
    const number = capture(["gcloud", "projects", "describe", project, "--format=value(projectNumber)"]);
    const member = `serviceAccount:${number}-compute@developer.gserviceaccount.com`;
    const ok = run([
      "gcloud", "projects", "add-iam-policy-binding", project,
      `--member=${member}`, "--role=roles/cloudtasks.enqueuer", "--condition=None", "--quiet",
    ], { quiet: true });
    if (!ok) throw new Error("could not grant roles/cloudtasks.enqueuer");
    return "granted (idempotent)";
  },
  async grantSignToRuntime({ project }) {
    // pharmacyScreenVideoWorker signs a V4 link for each MP4 (config-api/index.js signedLink); with no key file it
    // signs through the IAM Credentials API as itself, which needs Token Creator on its own account only.
    const number = capture(["gcloud", "projects", "describe", project, "--format=value(projectNumber)"]);
    const sa = `${number}-compute@developer.gserviceaccount.com`;
    const ok = run([
      "gcloud", "iam", "service-accounts", "add-iam-policy-binding", sa, `--project=${project}`,
      `--member=serviceAccount:${sa}`, "--role=roles/iam.serviceAccountTokenCreator", "--quiet",
    ], { quiet: true });
    if (!ok) throw new Error("could not grant roles/iam.serviceAccountTokenCreator");
    return "granted (idempotent)";
  },
  async expireVideoExports({ project, bucket }) {
    // The same rule as AWS's ExpireVideoExports (aws/infra/stack.js). The media bucket has no other lifecycle rule
    // (this script creates it with none), so setting the whole configuration replaces nothing else.
    const dir = mkdtempSync(join(tmpdir(), "ps-lifecycle-"));
    const file = join(dir, "lifecycle.json");
    writeFileSync(file, JSON.stringify(EXPORTS_LIFECYCLE));
    try {
      const ok = run(["gcloud", "storage", "buckets", "update", `gs://${bucket}`, `--project=${project}`, `--lifecycle-file=${file}`], { quiet: true });
      if (!ok) throw new Error(`could not set the lifecycle rule on gs://${bucket}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    return "set (idempotent)";
  },
  async adminConfig({ project }) {
    const base = `https://firebase.googleapis.com/v1beta1/projects/${project}/webApps`;
    const list = await googleApi("GET", `${base}?pageSize=100`, project);
    if (list.status !== 200) throw new Error(`listing the project's web apps returned ${list.status}`);
    let app = (list.json.apps || []).find((a) => a.displayName === ADMIN_WEB_APP && a.state !== "DELETED");
    let made = false;
    if (!app) {
      const op = await googleApi("POST", base, project, { displayName: ADMIN_WEB_APP });
      if (op.status !== 200) throw new Error(`creating the admin web app returned ${op.status}`);
      let done = op.json;
      for (let i = 0; !done.done && i < 30; i++) {
        await sleep(2000);
        const got = await googleApi("GET", `https://firebase.googleapis.com/v1beta1/${op.json.name}`, project);
        if (got.status !== 200) throw new Error(`waiting for the admin web app returned ${got.status}`);
        done = got.json;
      }
      if (!done.done || done.error || !done.response) throw new Error("the admin web app was not created in time");
      app = done.response;
      made = true;
    }
    const cfg = await googleApi("GET", `${base}/${app.appId}/config`, project);
    if (cfg.status !== 200) throw new Error(`reading the admin web app config returned ${cfg.status}`);
    const file = writeAdminConfig(cfg.json);
    return `${made ? "created" : "reused"} web app ${app.appId}; wrote ${file.slice(ROOT.length + 1)}`;
  },
  async authorizeDomains({ project, domains }) {
    const url = `https://identitytoolkit.googleapis.com/admin/v2/projects/${project}/config`;
    const got = await googleApi("GET", url, project);
    if (got.status !== 200) throw new Error(`reading the Auth config returned ${got.status}`);
    const have = got.json.authorizedDomains || [];
    const missing = domains.filter((d) => !have.includes(d));
    if (!missing.length) return "already authorized";
    const put = await googleApi("PATCH", `${url}?updateMask=authorizedDomains`, project, { authorizedDomains: [...have, ...missing] });
    if (put.status !== 200) throw new Error(`updating authorized domains returned ${put.status}`);
    // Admin sign-in uses the Google provider; say so if it is off.
    const google = await googleApi("GET", `https://identitytoolkit.googleapis.com/admin/v2/projects/${project}/defaultSupportedIdpConfigs/google.com`, project);
    if (google.status !== 200 || !google.json.enabled) {
      console.warn("   ! Google sign-in is not enabled for this project: turn it on once in Firebase console → Authentication → Sign-in method → Google.");
    }
    return `added ${missing.join(", ")}`;
  },
};

function show(cmd) {
  return cmd.map((a) => (/[\s"'$]/.test(a) ? JSON.stringify(a) : a)).join(" ");
}

export function parseArgs(argv) {
  const opts = { project: undefined, skipSetup: false, dryRun: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--project") opts.project = argv[++i];
    else if (a.startsWith("--project=")) opts.project = a.slice(10);
    else if (a === "--skip-setup") opts.skipSetup = true;
    else if (a === "--dry-run") opts.dryRun = true;
    else if (a === "--help" || a === "-h") opts.help = true;
    else throw new Error(`Unknown option ${a}`);
  }
  return opts;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log("Usage: npm run deploy -- [--project <id>] [--skip-setup] [--dry-run]");
    return;
  }
  const t = readTargets(opts.project);
  const plan = buildPlan({ ...t, skipSetup: opts.skipSetup });
  console.log(`Pharmacy Screen → Firebase project ${t.project} (site ${t.site}, media bucket ${t.bucket})${opts.dryRun ? " — dry run" : ""}`);

  for (const step of plan) {
    console.log(`\n▸ [${step.phase}] ${step.label}`);
    if (opts.dryRun) {
      if (step.kind === "ensure") console.log(`   if not: ${show(step.check)}\n   then:   ${show(step.cmd)}`);
      else if (step.kind === "task") console.log(`   task:   ${step.task} ${JSON.stringify(step.args)}`);
      else console.log(`   ${show(step.cmd)}`);
      continue;
    }
    if (step.kind === "ensure") {
      if (run(step.check, { quiet: true })) { console.log("   already in place"); continue; }
      if (!run(step.cmd)) throw new Error(`Failed: ${step.label}`);
    } else if (step.kind === "task") {
      console.log(`   ${await TASKS[step.task](step.args)}`);
    } else if (step.judge === "functionsDeploy") {
      const { status, output } = await runTee(step.cmd);
      const outcome = functionsDeployOutcome(status, output);
      if (outcome === "cleanup-policy") {
        console.warn(`   ! the functions deployed, but the image cleanup policy in ${REGION} is not set and this account may not set it.`);
        console.warn(`     The project owner runs this once: npx ${FIREBASE_TOOLS} ${CLEANUP_POLICY_ARGS.join(" ")} --project ${t.project}`);
        console.warn("     (docs/DEPLOYMENT.md → \"Image cleanup policy\"). Carrying on to Hosting.");
      } else if (outcome === "failed") {
        throw new Error(`Failed: ${step.label}. Hosting was not published, so the site still uses the functions it had before this deploy.`);
      }
    } else if (!run(step.cmd)) {
      if (step.optional) { console.warn(`   ! skipped (${step.optionalNote || "optional step failed"})`); continue; }
      throw new Error(`Failed: ${step.label}`);
    }
  }

  const u = urls(t);
  console.log(`
Pharmacy Screen is ${opts.dryRun ? "planned for" : "deployed to"} ${t.project}:
  Screen  ${u.screen}
  Admin   ${u.admin}
  API     ${u.api}   (health: ${u.health})
  Functions  ${u.configApiFunction}
             ${u.phApiFunction}
Next: grant yourself the admin role (pharmacy-screen/config-api/scripts/set-admin-claim.js),
then enter the PH API token in Admin → Settings.`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error(`\n✖ ${err.message}`);
    process.exit(1);
  });
}
