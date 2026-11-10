// scripts/verify-live-deploy.js (post-deploy "is it really live" check) and the pieces it relies on:
// build-console.js stamps build-info.json, the workflow runs the check, firebase.json keeps it uncached.
"use strict";
const assert = require("assert");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const { spawnSync, spawn } = require("child_process");

const root = path.join(__dirname, "..");
const wf = fs.readFileSync(path.join(root, "..", ".github", "workflows", "deploy-backlog-tracker.yml"), "utf8");
assert.ok(/scripts\/verify-live-deploy\.js/.test(wf), "deploy workflow must run verify-live-deploy.js");
assert.ok(/DEPLOY_TREE: \$\{\{ steps\.dedupe\.outputs\.tree \}\}/.test(wf), "deploy step must pass DEPLOY_TREE to the build");
assert.ok(/steps\.verify\.outcome/.test(wf), "status step must record a failed live check as a failed deploy");
const fb = JSON.parse(fs.readFileSync(path.join(root, "firebase.json"), "utf8"));
const rule = fb.hosting[0].headers.find((h) => h.source === "/build-info.json");
assert.ok(rule && /no-store/.test(JSON.stringify(rule)), "build-info.json must never be cached");
assert.ok(/build-info\.json/.test(fs.readFileSync(path.join(root, "scripts", "build-console.js"), "utf8")), "build-console.js must write build-info.json");

function serve(info, version) {
  const srv = http.createServer((req, res) => {
    if (req.url.startsWith("/build-info.json")) return res.end(JSON.stringify(info));
    if (req.url.startsWith("/js/version.js")) return res.end(`export const APP_VERSION = "${version}";`);
    res.statusCode = 404; res.end();
  });
  return new Promise((r) => srv.listen(0, () => r(srv)));
}
function run(port, env) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [path.join(root, "scripts", "verify-live-deploy.js")], {
      env: { ...process.env, LIVE_URL: `http://127.0.0.1:${port}`, VERIFY_ATTEMPTS: "2", VERIFY_DELAY_MS: "10", ...env }, stdio: "pipe" });
    let out = ""; p.stdout.on("data", (d) => (out += d)); p.stderr.on("data", (d) => (out += d));
    p.on("close", (code) => resolve({ code, out }));
  });
}

(async () => {
  const good = await serve({ commit: "abc", tree: "T1", version: "1.5.9" }, "1.5.9");
  let r = await run(good.address().port, { EXPECT_TREE: "T1", EXPECT_VERSION: "1.5.9" });
  assert.strictEqual(r.code, 0, r.out);
  r = await run(good.address().port, { EXPECT_TREE: "T2", EXPECT_VERSION: "1.5.9" });
  assert.strictEqual(r.code, 1, "a stale live tree must fail the check");
  assert.ok(/live tree T1 != deployed T2/.test(r.out), r.out);
  good.close();
  const stale = await serve({ commit: "old", tree: "T1", version: "1.5.8" }, "1.5.8");
  r = await run(stale.address().port, { EXPECT_TREE: "T1", EXPECT_VERSION: "1.5.9" });
  assert.strictEqual(r.code, 1, "a stale live version must fail the check");
  stale.close();

  // build-console.js stamps build-info.json (esbuild may be unavailable offline: it only warns).
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "console-"));
  const b = spawnSync(process.execPath, [path.join(root, "scripts", "build-console.js"), "--out", out],
    { env: { ...process.env, GITHUB_SHA: "deadbeef", DEPLOY_TREE: "TREE9" }, encoding: "utf8", timeout: 240000 });
  assert.strictEqual(b.status, 0, b.stderr);
  const info = JSON.parse(fs.readFileSync(path.join(out, "build-info.json"), "utf8"));
  assert.strictEqual(info.commit, "deadbeef"); assert.strictEqual(info.tree, "TREE9");
  assert.ok(/^\d+\.\d+\.\d+$/.test(info.version));
  fs.rmSync(out, { recursive: true, force: true });
  console.log("verify-live-deploy tests passed");
})().catch((e) => { console.error(e); process.exit(1); });
