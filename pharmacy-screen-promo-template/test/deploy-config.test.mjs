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
import { ROOT, buildPlan, readTargets, urls, parseArgs, stage, adminConfigJs, writeAdminConfig, CODEBASES, RULES_SOURCE, STAGE_DIR, ADMIN_WEB_APP } from "../scripts/deploy.mjs";

const read = (p) => readFileSync(join(ROOT, p), "utf8");
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

test("Hosting rewrites send each /api path to the function that serves it", () => {
  assert.equal(routeOf("/api/settings/ph-api"), "pharmacyScreenPhApi");
  assert.equal(routeOf("/api/settings/ph-api/token"), "pharmacyScreenPhApi");
  assert.equal(routeOf("/api/device/DEVICE-1/campaign_data"), "pharmacyScreenPhApi");
  assert.equal(routeOf("/api/health"), "pharmacyScreenConfigApi");
  assert.equal(routeOf("/api/screens/VIC-MP-001"), "pharmacyScreenConfigApi");
  assert.equal(routeOf("/api/admin/me"), "pharmacyScreenConfigApi");
  assert.equal(routeOf("/api/admin/pharmacies/abc/logo"), "pharmacyScreenConfigApi");
  // Nothing catches everything: an unknown /api path is a Hosting 404, not a function call.
  assert.equal(routeOf("/api/other"), undefined);
  assert.equal(routeOf("/pharmacy-screen.html"), undefined);
  for (const rw of hosting.rewrites) assert.equal(rw.function.region, "us-central1", rw.source);
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
  stage(ROOT, out);
  const files = [];
  (function walk(dir) {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else files.push(relative(join(out, "public"), p).split("\\").join("/"));
    }
  })(join(out, "public"));
  for (const want of ["pharmacy-screen.html", "admin/index.html", "admin/config.js", "admin/css/admin.css", "admin/js/editor.js", "admin/js/auth.js",
    "css/screen.css", "js/player.js", "fixtures/campaign-data.json", "seed/fixtures/pharmacies.json"]) {
    assert.ok(files.includes(want), `${want} is published`);
  }
  for (const f of files) {
    assert.match(f, /^(pharmacy-screen\.html|(css|js|fixtures)\/[^/]+|admin\/(index\.html|config\.js|(css|js)\/[^/]+)|seed\/fixtures\/.+)$/, `${f} is in the allow-list`);
    assert.ok(!f.split("/").some((seg) => seg.startsWith(".") || ["test", "tools", "node_modules"].includes(seg)), `${f} must not be published`);
    assert.doesNotMatch(f, /(^|\/)(package(-lock)?\.json|README\.md)$/, `${f} must not be published`);
  }
  // The staged rules are the repo-root ruleset, byte for byte.
  assert.equal(readFileSync(join(out, "firestore.rules"), "utf8"), read(RULES_SOURCE));
});

test("the deploy writes the admin editor's Firebase web app config into the staged copy only", () => {
  const js = adminConfigJs({ apiKey: "k", projectId: "rob-ph-demos", appId: "1:2:web:3" });
  const cfg = JSON.parse(js.slice(js.indexOf("{"), js.lastIndexOf("}") + 1));
  assert.deepEqual(cfg, { apiBase: "", screenPage: "", auth: { mode: "firebase", firebase: { apiKey: "k", authDomain: "rob-ph-demos.firebaseapp.com", projectId: "rob-ph-demos", appId: "1:2:web:3" } } });
  assert.match(js, /^\/\/ .*\nexport default \{/);
  assert.throws(() => adminConfigJs({ projectId: "p" }), /apiKey/);
  const out = mkdtempSync(join(tmpdir(), "ps-admin-cfg-"));
  stage(ROOT, out);
  const file = writeAdminConfig({ apiKey: "k", authDomain: "custom.example", projectId: "p" }, out);
  assert.equal(file, join(out, "public", "admin", "config.js"));
  assert.match(readFileSync(file, "utf8"), /"authDomain": "custom\.example"/);
  // The committed config stays unconfigured, so an unstaged copy refuses to sign in.
  assert.match(read("pharmacy-screen/admin/config.js"), /mode: 'firebase', firebase: null/);
  assert.equal(ADMIN_WEB_APP, "Pharmacy Screen admin");
});

test("rules: the project's one Firestore ruleset, indexes, and Storage rules on the media bucket only", () => {
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

test("function environments: non-secret, KMS envelope encryption, the PH default base URL", () => {
  const proxy = parseEnv("pharmacy-screen/ph-proxy/.env.rob-ph-demos");
  const config = parseEnv("pharmacy-screen/config-api/.env.rob-ph-demos");
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
  const deploy = plan.at(-1);
  const only = deploy.cmd[deploy.cmd.indexOf("--only") + 1].split(",");
  assert.deepEqual(only, [
    "hosting:pharmacy-screen",
    "functions:pharmacy-screen-config-api",
    "functions:pharmacy-screen-ph-proxy",
    "firestore:rules",
    "firestore:indexes",
    "storage:pharmacy-screen-media",
  ]);
  assert.ok(deploy.cmd.includes("--non-interactive"));
  assert.ok(!deploy.cmd.includes("--force"), "no --force: it would delete Firestore indexes the menu-board demo owns");
  const labels = plan.map((s) => s.label).join("\n");
  for (const want of [/KMS key ring/, /KMS key ph-api-token/, /runtime service account/, /Media bucket/, /Firebase Storage/, /Hosting site/, /authorized domains/]) {
    assert.match(labels, want);
  }
  assert.ok(plan.find((s) => s.phase === "setup" && s.cmd && s.cmd.includes("firebase.googleapis.com")), "the Firebase Management API is enabled (admin web app)");
  assert.equal(plan.at(-2).task, "adminConfig", "the admin config is written right before firebase deploy");
  const setupFree = buildPlan({ ...t, skipSetup: true });
  assert.deepEqual([...new Set(setupFree.map((s) => s.phase))], ["install", "deploy"]);
  assert.equal(setupFree.at(-2).task, "adminConfig", "CI (--skip-setup) writes the admin config too");
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
