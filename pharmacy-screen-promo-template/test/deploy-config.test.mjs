// Offline checks of the one-command deploy (no network, no Firebase CLI):
// firebase.json, .firebaserc, the functions' environment files and the plan
// scripts/deploy.mjs runs. They pin what the ticket asks for, so a later edit
// cannot quietly drop part of the deploy or publish server code as static files.
//
//   cd pharmacy-screen-promo-template && npm run check

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync, statSync, mkdtempSync } from "node:fs";
import { join, relative } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { hasGit } from "../scripts/release.mjs";
import { createRequire } from "node:module";
import { ROOT, buildPlan, readTargets, urls, parseArgs, stage, stagePublic, adminConfigJs, writeAdminConfig, CODEBASES, RULES_SOURCE, STAGE_DIR, ADMIN_WEB_APP, REGION, CLEANUP_POLICY_ARGS, functionsDeployOutcome, checkApi, EXPORTS_LIFECYCLE, APIS } from "../scripts/deploy.mjs";

const csp = createRequire(import.meta.url)("../aws/infra/csp.js");

const read = (p) => readFileSync(join(ROOT, p), "utf8");
// A release package (scripts/release.mjs) carries this folder without the repo-root firestore.rules or our test
// environment's .env.rob-ph-demos files, so the checks that need them run in the repo only. "In the repo" means a
// git checkout (as test/release.test.mjs decides), not "the files are there": in the repo a missing rules or env
// file fails these checks instead of quietly skipping them.
const OUR_ENV = hasGit(ROOT);
const ourEnvOnly = { skip: !OUR_ENV && "no git checkout (an unzipped release package): our Firebase test environment's rules and env files are not in it" };
const json = (p) => JSON.parse(read(p));
const fbJson = json("firebase.json");
const hosting = fbJson.hosting.find((h) => h.target === "pharmacy-screen");

function parseEnv(p) {
  const out = {};
  for (const line of read(p).split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

// Firebase Hosting matches rewrites in order with glob patterns; this is a
// small glob matcher good enough for the patterns used here (**, *, {a,b}).
function globToRe(glob) {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*" && glob[i + 1] === "*") { re += ".*"; i++; }
    else if (c === "*") re += "[^/]*";
    else if (c === "{") { const end = glob.indexOf("}", i); re += "(" + glob.slice(i + 1, end).split(",").map((s) => s.replace(/[.+?^$()|[\]\\]/g, "\\$&")).join("|") + ")"; i = end; }
    else re += c.replace(/[.+?^$()|[\]\\]/g, "\\$&");
  }
  return new RegExp("^" + re + "$");
}
const routeOf = (path) => {
  const r = hosting.rewrites.find((rw) => globToRe(rw.source).test(path));
  return r && r.function && r.function.functionId;
};

test(".firebaserc targets rob-ph-demos: a dedicated Hosting site and the media bucket", () => {
  const t = readTargets();
  assert.equal(t.project, "rob-ph-demos");
  assert.equal(t.site, "rob-ph-demos-pharmacy-screen");
  assert.equal(t.bucket, "rob-ph-demos-pharmacy-screen-media");
});

// Hosting's header globs, with the extglob @(a|b) the rules use.
function headerGlobToRe(glob) {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*" && glob[i + 1] === "*") { re += ".*"; i++; }
    else if (c === "*") re += "[^/]*";
    else if (c === "@" && glob[i + 1] === "(") { const end = glob.indexOf(")", i); re += "(" + glob.slice(i + 2, end).split("|").map((s) => s.replace(/[.+?^$()|[\]\\]/g, "\\$&")).join("|") + ")"; i = end; }
    else re += c.replace(/[.+?^$()|[\]\\]/g, "\\$&");
  }
  return new RegExp("^" + re + "$");
}
const cacheControlOf = (path) => hosting.headers.filter((h) => headerGlobToRe(h.source).test(path)).flatMap((h) => h.headers.filter((x) => x.key === "Cache-Control").map((x) => x.value));

test("the screen's fingerprinted assets/ are kept for a year; the page, sw.js and everything else are revalidated", () => {
  for (const p of ["/assets/js/player.0123456789.js", "/assets/css/screen.0123456789.css", "/assets/fonts/0123456789abcdef.woff2", "/assets/media/0123456789abcdef.jpg"]) {
    assert.deepEqual(cacheControlOf(p), ["public, max-age=31536000, immutable"], p);
  }
  for (const p of ["/pharmacy-screen.html", "/sw.js", "/js/render.js", "/css/screen.css", "/fixtures/config.json", "/seed/fixtures/pharmacies.json", "/admin/js/editor.js", "/admin/"]) {
    assert.deepEqual(cacheControlOf(p), ["no-cache"], p);
  }
});

test("the admin editor can only be framed by Personalisation Hub", () => {
  const admin = hosting.headers.find((h) => h.source === "/admin/**");
  const csp = admin.headers.find((h) => h.key === "Content-Security-Policy");
  assert.equal(csp.value, "frame-ancestors 'self' https://ph.mipharmacy.net");
});

test("Content-Security-Policy (report-only) on the screen page and the editor: the same policies as aws/infra/csp.js", () => {
  const headerOf = (path, key) => hosting.headers.filter((h) => headerGlobToRe(h.source).test(path)).flatMap((h) => h.headers.filter((x) => x.key === key).map((x) => x.value));
  assert.equal(csp.CSP_HEADER, "Content-Security-Policy-Report-Only", "report-only until a week without violations");
  assert.deepEqual(headerOf("/pharmacy-screen.html", csp.CSP_HEADER), [csp.screenCsp()]);
  assert.equal(csp.screenCsp(), "script-src 'self'; object-src 'none'; base-uri 'none'; img-src 'self' https: data:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; connect-src 'self'; report-uri /api/csp-report");
  const { project } = readTargets();
  for (const p of ["/admin/", "/admin/index.html", "/admin/js/editor.js"]) {
    assert.deepEqual(headerOf(p, csp.CSP_HEADER), [csp.editorCsp(csp.firebaseEditorExtras(`${project}.firebaseapp.com`))], p);
  }
  const editor = csp.editorCsp(csp.firebaseEditorExtras(`${project}.firebaseapp.com`));
  for (const want of ["script-src 'self' https://www.gstatic.com", "https://fonts.googleapis.com", "https://fonts.gstatic.com", "https://identitytoolkit.googleapis.com", "frame-src https://rob-ph-demos.firebaseapp.com", "object-src 'none'", "base-uri 'none'"]) {
    assert.ok(editor.includes(want), want);
  }
  assert.doesNotMatch(editor, /unsafe-eval|'unsafe-inline'[^;]*script|script-src[^;]*'unsafe-inline'/);
  assert.equal(routeOf("/api/csp-report"), "pharmacyScreenConfigApi", "reports reach the config API");
});

test("Hosting rewrites send each /api path to the function that serves it", () => {
  assert.equal(routeOf("/api/settings/ph-api"), "pharmacyScreenPhApi");
  assert.equal(routeOf("/api/settings/ph-api/token"), "pharmacyScreenPhApi");
  assert.equal(routeOf("/api/device/DEVICE-1/campaign_data"), "pharmacyScreenPhApi");
  assert.equal(routeOf("/api/auth/ph-session"), "pharmacyScreenPhApi");
  assert.equal(routeOf("/api/health"), "pharmacyScreenConfigApi");
  assert.equal(routeOf("/api/screens/VIC-MP-001"), "pharmacyScreenConfigApi");
  assert.equal(routeOf("/api/admin/me"), "pharmacyScreenConfigApi");
  assert.equal(routeOf("/api/admin/pharmacies/abc/logo"), "pharmacyScreenConfigApi");
  // Nothing catches everything: an unknown /api path is a Hosting 404, not a function call.
  assert.equal(routeOf("/api/other"), undefined);
  assert.equal(routeOf("/pharmacy-screen.html"), undefined);
  // Sydney, next to the stores; the functions' own region settings say the same (next test).
  for (const rw of hosting.rewrites) assert.equal(rw.function.region, REGION, rw.source);
  assert.equal(REGION, "australia-southeast1");
});

test("every rewritten function is exported by its codebase's entry point", () => {
  // Each codebase also sets the same runtime in firebase.json.
  for (const f of fbJson.functions) assert.equal(f.runtime, "nodejs22", `${f.codebase} deploys on nodejs22`);
  const byCodebase = Object.fromEntries(fbJson.functions.map((f) => [f.codebase, f.source]));
  assert.deepEqual(Object.keys(byCodebase).sort(), [...CODEBASES].sort());
  const exported = {};
  for (const [codebase, src] of Object.entries(byCodebase)) {
    const index = read(join(src, "index.js"));
    for (const m of index.matchAll(/exports\.(\w+)\s*=\s*onRequest/g)) exported[m[1]] = codebase;
    const pkg = json(join(src, "package.json"));
    assert.equal(pkg.engines.node, "22", `${src} runs on Node 22 (Node 20 was decommissioned on 30 Oct 2026)`);
    assert.ok(pkg.dependencies["firebase-functions"], `${src} depends on firebase-functions`);
  }
  for (const rw of hosting.rewrites) assert.ok(exported[rw.function.functionId], `${rw.function.functionId} is exported`);
});

test("Hosting publishes the screen, the admin editor and its seed fixtures only (allow-list), never server code, tests, tools or env files", () => {
  assert.equal(hosting.public, `${STAGE_DIR}/public`);
  assert.equal(fbJson.firestore.rules, `${STAGE_DIR}/firestore.rules`);
  assert.match(read(".gitignore"), /^\.deploy\/$/m, "the staged copy is never committed");
  const out = mkdtempSync(join(tmpdir(), "ps-stage-"));
  if (OUR_ENV) stage(ROOT, out);
  else stagePublic(ROOT, join(out, "public"));
  const files = [];
  (function walk(dir) {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else files.push(relative(join(out, "public"), p).split("\\").join("/"));
    }
  })(join(out, "public"));
  for (const want of ["pharmacy-screen.html", "sw.js", "admin/index.html", "admin/config.js", "admin/css/admin.css", "admin/js/editor.js", "admin/js/auth.js",
    "css/screen.css", "js/player.js", "fixtures/campaign-data.json", "seed/fixtures/pharmacies.json"]) {
    assert.ok(files.includes(want), `${want} is published`);
  }
  for (const f of files) {
    assert.match(f, /^(pharmacy-screen\.html|sw\.js|(css|js|fixtures)\/[^/]+|assets\/(css\/[\w-]+\.[0-9a-f]{10}\.css|js\/[\w-]+\.[0-9a-f]{10}\.js|fonts\/[0-9a-f]{16}\.woff2|media\/[0-9a-f]{16}\.jpg)|admin\/(index\.html|config\.js|(css|js)\/[^/]+)|seed\/fixtures\/.+)$/, `${f} is in the allow-list`);
    assert.ok(!f.split("/").some((seg) => seg.startsWith(".") || ["test", "tools", "node_modules"].includes(seg)), `${f} must not be published`);
    assert.doesNotMatch(f, /(^|\/)(package(-lock)?\.json|README\.md)$/, `${f} must not be published`);
  }
  // The staged rules are the repo-root ruleset, byte for byte.
  if (OUR_ENV) assert.equal(readFileSync(join(out, "firestore.rules"), "utf8"), read(RULES_SOURCE));
});

test("the deploy writes the admin editor's Firebase web app config into the staged copy only", async () => {
  const js = adminConfigJs({ apiKey: "k", projectId: "rob-ph-demos", appId: "1:2:web:3" }, { adminAuth: "firebase" });
  const cfg = JSON.parse(js.slice(js.indexOf("{"), js.lastIndexOf("}") + 1));
  assert.deepEqual(cfg, { apiBase: "", screenPage: "", auth: { mode: "firebase", firebase: { apiKey: "k", authDomain: "rob-ph-demos.firebaseapp.com", projectId: "rob-ph-demos", appId: "1:2:web:3" } } });
  assert.match(js, /^\/\/ .*\nexport default \{/);
  assert.throws(() => adminConfigJs({ projectId: "p" }), /apiKey/);
  // Sign-in from Personalisation Hub: the default keeps the Firebase sign-in as a fallback for the changeover;
  // "ph" alone offers no sign-in of its own. Only PH's origin may hand a session over.
  const authOf = async (opts) => (await import(`data:text/javascript,${encodeURIComponent(adminConfigJs({ apiKey: "k", projectId: "p" }, opts))}`)).default.auth;
  assert.deepEqual((await authOf()).ph, { parentOrigins: ["https://ph.mipharmacy.net"], fallback: "firebase" });
  assert.deepEqual(await authOf({ adminAuth: "ph" }), { mode: "ph", firebase: { apiKey: "k", authDomain: "p.firebaseapp.com", projectId: "p" }, ph: { parentOrigins: ["https://ph.mipharmacy.net"] } });
  assert.throws(() => adminConfigJs({ apiKey: "k", projectId: "p" }, { adminAuth: "open" }), /PS_ADMIN_AUTH/);
  const out = mkdtempSync(join(tmpdir(), "ps-admin-cfg-"));
  stagePublic(ROOT, join(out, "public"));
  const file = writeAdminConfig({ apiKey: "k", authDomain: "custom.example", projectId: "p" }, out, { adminAuth: "firebase" });
  assert.equal(file, join(out, "public", "admin", "config.js"));
  assert.match(readFileSync(file, "utf8"), /"authDomain": "custom\.example"/);
  // The committed config stays unconfigured, so an unstaged copy refuses to sign in.
  assert.match(read("pharmacy-screen/admin/config.js"), /mode: 'firebase', firebase: null/);
  assert.equal(ADMIN_WEB_APP, "Pharmacy Screen admin");
});

test("rules: the project's one Firestore ruleset, indexes, and Storage rules on the media bucket only", ourEnvOnly, () => {
  assert.ok(existsSync(join(ROOT, RULES_SOURCE)), "repo-root firestore.rules exists");
  assert.ok(existsSync(join(ROOT, fbJson.firestore.indexes)));
  assert.ok(Array.isArray(fbJson.storage), "storage is a per-bucket list");
  assert.deepEqual(fbJson.storage.map((s) => s.target), ["pharmacy-screen-media"], "never the default bucket (the menu-board demo's)");
  assert.ok(!fbJson.storage.some((s) => s.bucket), "bucket comes from the .firebaserc target");
  assert.ok(existsSync(join(ROOT, fbJson.storage[0].rules)));
  const rules = read(RULES_SOURCE);
  assert.match(rules, /match \/pharmacyScreen\/published\/screens\/\{storeCode\}/);
  assert.doesNotMatch(rules, /match \/pharmacyScreen\/private/, "settings and token documents get no client rule");
});

test("function environments: non-secret, KMS envelope encryption, the PH default base URL", ourEnvOnly, () => {
  const proxy = parseEnv("pharmacy-screen/ph-proxy/.env.rob-ph-demos");
  const config = parseEnv("pharmacy-screen/config-api/.env.rob-ph-demos");
  assert.equal(proxy.PH_REGION, REGION, "the proxy deploys where Hosting rewrites to");
  assert.equal(config.PS_REGION, REGION, "the config API deploys where Hosting rewrites to");
  for (const [name, env, key] of [["config API", config, "PS_MIN_INSTANCES"], ["proxy", proxy, "PH_MIN_INSTANCES"]]) {
    assert.ok(!(key in env) || env[key] === "0", `${name}: no instance kept warm without the owner's yes (a monthly cost)`);
  }
  const { site, bucket } = readTargets();
  assert.equal(proxy.PH_SECRET_STORE, "gcp-kms");
  assert.equal(proxy.PH_TOKEN_KMS_KEY, "projects/rob-ph-demos/locations/global/keyRings/pharmacy-screen/cryptoKeys/ph-api-token");
  assert.equal(proxy.PH_API_DEFAULT_BASE_URL, "https://ph.mipharmacy.net");
  assert.ok(!("PH_LOCAL_KMS_KEY" in proxy), "no local wrapping key in a deployed environment");
  assert.equal(config.PS_MEDIA_BUCKET, bucket);
  for (const env of [proxy, config]) {
    const origins = (env.PH_ALLOWED_ORIGINS || env.PS_ALLOWED_ORIGINS).split(",");
    assert.deepEqual(origins, [`https://${site}.web.app`, `https://${site}.firebaseapp.com`]);
    for (const [k, v] of Object.entries(env)) {
      assert.doesNotMatch(k, /TOKEN$|SECRET$|PASSWORD|API_KEY$/, `${k} looks like a secret`);
      // A credential is one long unbroken run of letters and digits; names here are words joined by - . / , :
      assert.doesNotMatch(v, /[A-Za-z0-9+_=]{32,}/, `${k} holds something key-like`);
    }
  }
  // The token never appears in any deploy file.
  for (const p of ["firebase.json", ".firebaserc", "scripts/deploy.mjs", "ci/deploy-pharmacy-screen.yml"]) {
    assert.doesNotMatch(read(p), /x-api-key\s*[:=]\s*\S{8,}/i, p);
  }
});

test("the deploy plan installs, sets up and deploys every part, in that order", () => {
  const t = readTargets();
  const plan = buildPlan(t);
  const phases = plan.map((s) => s.phase);
  assert.deepEqual([...new Set(phases)], ["install", "setup", "deploy"]);
  assert.equal(plan[0].task, "stage", "files and rules are staged before anything deploys");
  // Functions on their own first, then Hosting and the rules, then a check that the site's API answers: one
  // `firebase deploy` of both never publishes Hosting when the functions step ends in any error (23 Nov 2026).
  const [functionsStep, deploy, check] = plan.slice(-3);
  const onlyOf = (step) => step.cmd[step.cmd.indexOf("--only") + 1].split(",");
  assert.deepEqual(onlyOf(functionsStep), ["functions:pharmacy-screen-config-api", "functions:pharmacy-screen-ph-proxy"]);
  assert.equal(functionsStep.judge, "functionsDeploy", "the functions step is judged by functionsDeployOutcome");
  assert.notEqual(functionsStep.optional, true, "a functions error other than the cleanup-policy message stops the deploy before Hosting");
  assert.deepEqual(onlyOf(deploy), ["hosting:pharmacy-screen", "firestore:rules", "firestore:indexes", "storage:pharmacy-screen-media"]);
  assert.notEqual(deploy.optional, true);
  assert.deepEqual([check.kind, check.task, check.args.site], ["task", "checkApi", t.site]);
  assert.ok(functionsStep.cmd.includes("--non-interactive") && !functionsStep.cmd.includes("--force"));
  assert.ok(deploy.cmd.includes("--non-interactive"));
  assert.ok(!deploy.cmd.includes("--force"), "no --force: it would delete Firestore indexes the menu-board demo owns");
  const labels = plan.map((s) => s.label).join("\n");
  for (const want of [/KMS key ring/, /KMS key ph-api-token/, /runtime service account/, /Media bucket/, /Firebase Storage/, /Hosting site/, /authorized domains/]) {
    assert.match(labels, want);
  }
  assert.ok(plan.find((s) => s.phase === "setup" && s.cmd && s.cmd.includes("firebase.googleapis.com")), "the Firebase Management API is enabled (admin web app)");
  assert.equal(plan.at(-4).task, "adminConfig", "the admin config is written right before firebase deploy");
  const setupFree = buildPlan({ ...t, skipSetup: true });
  assert.deepEqual([...new Set(setupFree.map((s) => s.phase))], ["install", "deploy"]);
  assert.equal(setupFree.at(-4).task, "adminConfig", "CI (--skip-setup) writes the admin config too");
  // The image cleanup policy is set by the owner's run (setup), once per region; CI (--skip-setup) may not set it
  // and no longer tries, so its log carries no permission error.
  const policy = plan.find((x) => x.cmd && x.cmd.includes("functions:artifacts:setpolicy"));
  assert.equal(policy.phase, "setup");
  assert.notEqual(policy.optional, true);
  assert.deepEqual(policy.cmd.slice(policy.cmd.indexOf("functions:artifacts:setpolicy")), [...CLEANUP_POLICY_ARGS, "--project", t.project]);
  assert.ok(CLEANUP_POLICY_ARGS.includes(REGION));
  assert.ok(!setupFree.some((x) => x.cmd && x.cmd.includes("functions:artifacts:setpolicy")), "CI does not try to set the cleanup policy");
  // The deploy never deletes a function (23 Nov 2026: deleting the old region's functions before their replacements
  // answered took the API down). A region move is separate deploys, deleting last, by hand (docs/DEPLOYMENT.md).
  for (const p of [plan, setupFree]) {
    for (const step of p) {
      for (const cmd of [step.cmd, step.check].filter(Boolean)) assert.ok(!cmd.includes("functions:delete"), `${step.label} deletes functions`);
    }
  }
  const src = read("scripts/deploy.mjs");
  assert.doesNotMatch(src, /LEGACY_REGION|LEGACY_FUNCTIONS/);
});

test("npm run deploy -- --dry-run --skip-setup shows no delete step", () => {
  const r = spawnSync(process.execPath, [join(ROOT, "scripts/deploy.mjs"), "--dry-run", "--skip-setup"], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.doesNotMatch(r.stdout, /functions:delete|old region/i);
  assert.match(r.stdout, /Deploy the functions\n.*--only functions:pharmacy-screen-config-api,functions:pharmacy-screen-ph-proxy/);
});

test("the functions step: only the cleanup-policy message is passable; any other error stops the deploy before Hosting", () => {
  // firebase-tools 14's own wording when the functions deployed but the policy could not be set.
  const policyOnly = [
    "✔  functions[pharmacyScreenConfigApi(australia-southeast1)] Successful update operation.",
    "✔  functions[pharmacyScreenPhApi(australia-southeast1)] Successful update operation.",
    "Error: Functions successfully deployed but could not set up cleanup policy in location australia-southeast1. Pass the --force option to automatically set up a cleanup policy or run 'firebase functions:artifacts:setpolicy' to manually set up a cleanup policy.",
  ].join("\n");
  assert.equal(functionsDeployOutcome(0, "✔  Deploy complete!"), "ok");
  assert.equal(functionsDeployOutcome(1, policyOnly), "cleanup-policy");
  // The first deploy on 23 Nov 2026: one function failed to create.
  const oneFailed = [
    "✔  functions[pharmacyScreenConfigApi(australia-southeast1)] Successful create operation.",
    "Failed to create function projects/rob-ph-demos/locations/australia-southeast1/functions/pharmacyScreenPhApi",
    "Functions deploy had errors with the following functions:",
    "\tpharmacyScreenPhApi(australia-southeast1)",
    "Error: There was an error deploying functions",
  ].join("\n");
  assert.equal(functionsDeployOutcome(1, oneFailed), "failed");
  // Both at once: a failed function is never excused by the cleanup-policy message.
  assert.equal(functionsDeployOutcome(1, `${oneFailed}\n${policyOnly}`), "failed");
  // Anything unrecognised fails closed.
  assert.equal(functionsDeployOutcome(1, "Error: Failed to authenticate, have you run firebase login?"), "failed");
  assert.equal(functionsDeployOutcome(1, ""), "failed");
  assert.equal(functionsDeployOutcome(null, "killed"), "failed");
});

test("URLs printed after a deploy", () => {
  const u = urls(readTargets());
  assert.equal(u.admin, "https://rob-ph-demos-pharmacy-screen.web.app/admin/");
  assert.equal(u.health, "https://rob-ph-demos-pharmacy-screen.web.app/api/health");
  assert.match(u.screen, /^https:\/\/rob-ph-demos-pharmacy-screen\.web\.app\/pharmacy-screen\.html\?device=TEST&.*mockapi=1/);
  assert.throws(() => parseArgs(["--bogus"]), /Unknown option/);
});

test("npm run deploy -- --dry-run prints the plan and the URLs without running anything", () => {
  const r = spawnSync(process.execPath, [join(ROOT, "scripts/deploy.mjs"), "--dry-run"], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /dry run/);
  assert.match(r.stdout, /firebase-tools@14\.27\.0 deploy --project rob-ph-demos/);
  assert.match(r.stdout, /Admin {3}https:\/\/rob-ph-demos-pharmacy-screen\.web\.app\/admin\//);
});

test("README records the screen, admin and API URLs", () => {
  const readme = read("README.md");
  const u = urls(readTargets());
  for (const want of [u.admin, u.api, "https://rob-ph-demos-pharmacy-screen.web.app/pharmacy-screen.html"]) {
    assert.ok(readme.includes(want), `README names ${want}`);
  }
});

test("CI workflow template deploys from main, with setup skipped, and matches the installed copy", () => {
  const yml = read("ci/deploy-pharmacy-screen.yml");
  // Not on the train: tickets land there with the automation's GITHUB_TOKEN, which never fires `on: push`.
  // A train merge dispatches it instead (HOSTED_DEPLOYS in backlog-tracker/scripts/run-backlog-automation.js).
  assert.doesNotMatch(yml, /deploy\/pharmacy-screen-promo-template/);
  assert.match(yml, /- main/);
  const installed = join(ROOT, "..", ".github", "workflows", "deploy-pharmacy-screen.yml");
  if (existsSync(installed)) assert.equal(readFileSync(installed, "utf8"), yml, "the installed workflow is the template");
  assert.match(yml, /npm run deploy -- --skip-setup/);
  assert.match(yml, /secrets\.FIREBASE_SERVICE_ACCOUNT_ROB_PH_DEMOS/);
});

test("the deploy fails when the site's API does not answer afterwards, and passes when it does", async () => {
  const reply = (status, type) => ({ status, headers: { get: () => type } });
  const up = async (url) => (url.includes("/api/health") ? reply(200, "application/json") : reply(404, "application/json; charset=utf-8"));
  assert.match(await checkApi({ site: "s", fetchImpl: up, tries: 1 }), /config API 200, PH API proxy 404 \(JSON\)/);
  // What Hosting answered on 23 Nov 2026: its own HTML "Page not found" for every /api route.
  const gone = async () => reply(404, "text/html; charset=UTF-8");
  await assert.rejects(checkApi({ site: "s", fetchImpl: gone, tries: 2, waitMs: 1 }), /does not answer after the deploy/);
  const halfGone = async (url) => (url.includes("/api/health") ? reply(200, "application/json") : reply(404, "text/html"));
  await assert.rejects(checkApi({ site: "s", fetchImpl: halfGone, tries: 1 }), /not JSON/);
  let n = 0;
  const slow = async (url) => (++n > 2 ? up(url) : gone());
  assert.match(await checkApi({ site: "s", fetchImpl: slow, tries: 3, waitMs: 1 }), /config API 200/);
});

test("the API check fails the 23 Nov 2026 first deploy, where one function failed to create (Hosting's HTML 404)", async () => {
  // Firebase Hosting's own 404 page, as every /api route served it from 19:55 to 22:13 UTC on 23 Nov 2026.
  const hosting404 = { status: 404, headers: { get: (h) => (/content-type/i.test(h) ? "text/html; charset=utf-8" : null) }, text: async () => "<!DOCTYPE html><html><head><title>Page Not Found</title></head><body><h1>Page Not Found</h1><p>This file does not exist and there was no index.html found in the current directory or 404.html in the root directory.</p></body></html>" };
  const json = (status) => ({ status, headers: { get: (h) => (/content-type/i.test(h) ? "application/json; charset=utf-8" : null) } });
  const routes = (health, device) => async (url) => (url.includes("/api/health") ? health() : device());
  // Only the config API was created: the proxy's route falls through to Hosting's page.
  await assert.rejects(checkApi({ site: "s", fetchImpl: routes(() => json(200), () => hosting404), tries: 2, waitMs: 1 }), /does not answer after the deploy: health 200, device read 404 \(not JSON/);
  // Only the proxy was created: the health route is Hosting's page.
  await assert.rejects(checkApi({ site: "s", fetchImpl: routes(() => hosting404, () => json(404)), tries: 2, waitMs: 1 }), /does not answer after the deploy: health 404/);
  // Neither: every /api route is Hosting's page.
  await assert.rejects(checkApi({ site: "s", fetchImpl: routes(() => hosting404, () => hosting404), tries: 2, waitMs: 1 }), /does not answer after the deploy/);
});

test("Download MP4 on Firebase: setup lets the worker sign one-hour links and deletes exports after a day", () => {
  const t = readTargets();
  const plan = buildPlan(t);
  const step = (task) => plan.find((s) => s.task === task);
  for (const task of ["grantTasksToRuntime", "grantSignToRuntime", "expireVideoExports"]) {
    assert.equal(step(task) && step(task).phase, "setup", `${task} is a setup step`);
  }
  assert.equal(step("expireVideoExports").args.bucket, t.bucket);
  assert.deepEqual(EXPORTS_LIFECYCLE, { rule: [{ action: { type: "Delete" }, condition: { age: 1, matchesPrefix: ["exports/"] } }] });
  assert.ok(APIS.includes("iamcredentials.googleapis.com"), "signing a link uses the IAM Credentials API");
  // The worker hands out a signed link, never a Firebase download token (a token link never expires).
  const index = read("pharmacy-screen/config-api/index.js");
  assert.match(index, /getSignedUrl\(\{ version: "v4", action: "read", expires: Date\.now\(\) \+ LINK_SECONDS \* 1000/);
  assert.match(index, /const LINK_SECONDS = 3600;/);
  assert.doesNotMatch(index, /firebaseStorageDownloadTokens/);
  // The worker's time limit stays inside the render lease (src/video/jobs.js LEASE_MS, 20 minutes).
  assert.match(index, /const WORKER_SECONDS = 900;/);
  assert.match(index, /timeoutSeconds: WORKER_SECONDS/);
});
