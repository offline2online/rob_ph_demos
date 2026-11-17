// The deployed console is the MINIFIED copy (scripts/build-console.js, run by
// firebase.json's hosting predeploy), so a minifier fault would reach
// production without any other test seeing it: the suites load public/.
// This builds the copy exactly as the deploy does and runs the Staff Kanban
// end-to-end suite against it (desktop 1440 + phone 390, Chromium, the cases
// that open the board, the ticket modal with its lazily loaded editor, and
// the report and settings pages), then checks the build itself.
//   cd backlog-tracker/test && node ui/minified.test.mjs
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..", "..");
const out = fs.mkdtempSync(path.join(os.tmpdir(), "console-dist-"));

const build = spawnSync(process.execPath, [path.join(root, "scripts/build-console.js"), "--out", out, "--require-minify"], { cwd: root, stdio: "inherit" });
assert.equal(build.status, 0, "scripts/build-console.js failed");

// The build is smaller, and keeps what must not change.
const size = (dir, f) => fs.statSync(path.join(dir, f)).size;
assert.ok(size(out, "js/app.js") < size(path.join(root, "public"), "js/app.js") * 0.6, "app.js should be well under 60% of its source size once minified");
const appMin = fs.readFileSync(path.join(out, "js/app.js"), "utf8");
assert.ok(appMin.includes("https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js"), "the Firebase SDK import must be untouched");
assert.ok(appMin.includes("./kanban/kanban-page.js?v="), "the Kanban page import is kept, with the build's stamp");
assert.equal(fs.readFileSync(path.join(out, "js/vendor/purify.min.js"), "utf8"), fs.readFileSync(path.join(root, "public/js/vendor/purify.min.js"), "utf8"), "vendored files are copied as they are");
// The page is the source page plus the build's ?v= stamps on its scripts and stylesheets, nothing else.
const info = JSON.parse(fs.readFileSync(path.join(out, "build-info.json"), "utf8"));
assert.match(info.assetVersion || "", /^[0-9a-f]{12}$/, "build-info.json names the asset version");
const V = `?v=${info.assetVersion}`;
for (const page of ["index.html", "whiteboard.html"]) {
  const built = fs.readFileSync(path.join(out, page), "utf8");
  assert.equal(built.split(V).join("").split('f + ""').join("f"), fs.readFileSync(path.join(root, "public", page), "utf8"), `${page} is the source page plus ?v= stamps`);
  assert.ok(built.includes(`js/auth-gate.js${V}`) || page !== "index.html", "index.html loads auth-gate.js with the stamp");
}
assert.ok(appMin.includes(`./version.js${V}`), "app.js imports version.js with the stamp");

// In a browser: every first-party script and stylesheet the console asks for carries the
// stamp, and no module is loaded under two URLs (which would give it two copies of its state).
// Opens the pages that load code on demand, so their imports are checked too.
{
  process.env.HARNESS_PUBLIC_DIR = out; // read when harness.mjs is first imported
  const { startHarness, until } = await import("./harness.mjs");
  const h = await startHarness();
  const o = await h.open({ seed: { user: { email: "admin@personalisationhub.com", role: "admin" }, docs: { projects: { p1: { name: "Demo", createdAt: { $ts: 1_760_000_000_000 } } }, backlogItems: {} } }, width: 1180, height: 820 });
  const seen = new Map();
  o.page.on("request", (rq) => { const u = new URL(rq.url()); if (u.origin === h.origin && /\.(js|css)$/.test(u.pathname) && !u.pathname.includes("/vendor/")) { const k = u.pathname; const q = u.search.replace(/[?&]retry=\d+/, ""); if (!seen.has(k)) seen.set(k, new Set()); seen.get(k).add(q); } });
  await o.page.reload();
  await until(() => o.page.locator(".project-options-btn").count(), "board on the built copy", 15000);
  for (const hash of ["#dashboard", "#staff-kanban", "#concept-incubator", "#promote/leads", "#promote/prospects", "#promote/conversion-funnel", "#support", "#settings", "#faq-management", ""]) {
    await o.page.evaluate((x) => { location.hash = x; }, hash);
    await o.page.waitForTimeout(900);
  }
  const bad = [...seen].filter(([, qs]) => qs.size !== 1 || ![...qs][0].startsWith(V));
  assert.deepEqual(bad.map(([k, qs]) => `${k} ${[...qs].join(" | ") || "(no query)"}`), [], "every first-party script and stylesheet is requested once, with this build's ?v= stamp");
  assert.ok(seen.size > 20, `the built console should load its scripts (saw ${seen.size})`);
  const errs = o.problems.filter((p) => !/unrouted host/.test(p));
  assert.deepEqual(errs, [], "the built console runs without errors");
  console.log(`minified build: ${seen.size} first-party files, all stamped ${V}, none loaded twice`);
  await o.close(); await h.close();
}

const env = { ...process.env, HARNESS_PUBLIC_DIR: out, KB_PROFILES: "quick", KB_ENGINES: "chromium", KB_SHARD: "", KB_ONLY: process.env.KB_ONLY || "" };
const run = spawnSync(process.execPath, [path.join(here, "staff-kanban.test.mjs")], { cwd: path.join(here, ".."), env, stdio: "inherit" });
fs.rmSync(out, { recursive: true, force: true });
assert.equal(run.status, 0, "the Staff Kanban suite failed against the minified build");
console.log("minified build: Staff Kanban suite passed");
