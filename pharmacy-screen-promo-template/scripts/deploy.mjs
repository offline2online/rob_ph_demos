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
//                cleanup policy. Each step checks first and does nothing if
//                it is already in place.
//   3. deploy    firebase deploy of Hosting (the screen and admin), both
//                functions codebases (config API, PH API proxy), the Firestore
//                rules and indexes and the media bucket's Storage rules
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

import { spawnSync } from "node:child_process";
import { readFileSync, mkdirSync, copyFileSync, cpSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

export const FIREBASE_TOOLS = "firebase-tools@14.27.0";
export const REGION = "us-central1";
export const KMS = { location: "global", keyRing: "pharmacy-screen", key: "ph-api-token" };
export const CODEBASES = ["pharmacy-screen-config-api", "pharmacy-screen-ph-proxy"];
export const FUNCTION_SOURCES = ["pharmacy-screen/config-api", "pharmacy-screen/ph-proxy"];
// What Hosting publishes, by allow-list, from pharmacy-screen/: the screen page
// and the admin app. Everything else there (config-api/, ph-proxy/, tests,
// tools, env files) is server code or tooling and is never staged, so it can't
// be published by a later Hosting "ignore" slip.
export const PUBLIC_SOURCE = "pharmacy-screen";
export const PUBLIC_ENTRIES = ["pharmacy-screen.html", "css", "js", "fixtures", "admin"];
// The project's one Firestore ruleset lives at the repo root (shared with the
// menu-board demo); the Firebase CLI reads rules only from inside this folder.
export const RULES_SOURCE = "../firestore.rules";
export const STAGE_DIR = ".deploy";

// Writes <out>/public (Hosting's "public") and <out>/firestore.rules (the
// Firestore "rules"), fresh every run. firebase.json points at both.
export function stage(root = ROOT, out = join(root, STAGE_DIR)) {
  const pub = join(out, "public");
  rmSync(pub, { recursive: true, force: true });
  mkdirSync(pub, { recursive: true });
  for (const entry of PUBLIC_ENTRIES) {
    cpSync(join(root, PUBLIC_SOURCE, entry), join(pub, entry), {
      recursive: true,
      filter: (src) => !/(^|[\\/])(\.[^\\/]*|node_modules)$/.test(src),
    });
  }
  copyFileSync(join(root, RULES_SOURCE), join(out, "firestore.rules"));
  return `staged ${PUBLIC_ENTRIES.join(", ")} and ${RULES_SOURCE} in ${STAGE_DIR}/`;
}

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
      task: "authorizeDomains",
      label: `Add ${site}.web.app and ${site}.firebaseapp.com to Auth authorized domains`,
      args: { project, domains: [`${site}.web.app`, `${site}.firebaseapp.com`] },
    });
    steps.push({
      phase: "setup",
      kind: "run",
      optional: true,
      label: "Artifact Registry cleanup policy for function images (keeps the deploy non-interactive)",
      cmd: fb("functions:artifacts:setpolicy", "--location", REGION, "--days", "7", "--force", "--project", project),
    });
  }

  steps.push({
    phase: "deploy",
    kind: "run",
    label: "Deploy Hosting, functions, Firestore rules and indexes, Storage rules",
    cmd: fb(
      "deploy",
      "--project", project,
      "--non-interactive",
      "--only",
      [
        "hosting:pharmacy-screen",
        ...CODEBASES.map((c) => `functions:${c}`),
        "firestore:rules",
        "firestore:indexes",
        "storage:pharmacy-screen-media",
      ].join(",")
    ),
  });
  return steps;
}

// ── execution ──────────────────────────────────────────────────────────────

function run(cmd, { quiet = false } = {}) {
  const r = spawnSync(cmd[0], cmd.slice(1), { cwd: ROOT, stdio: quiet ? "ignore" : "inherit", env: process.env });
  return r.status === 0;
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

const TASKS = {
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
    } else if (!run(step.cmd)) {
      if (step.optional) { console.warn("   ! skipped (optional step failed; the deploy may ask about image cleanup)"); continue; }
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
