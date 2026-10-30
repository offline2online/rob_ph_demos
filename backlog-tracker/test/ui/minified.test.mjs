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
assert.ok(appMin.includes("./kanban/kanban-page.js"), "the Kanban page import must be untouched");
assert.equal(fs.readFileSync(path.join(out, "js/vendor/purify.min.js"), "utf8"), fs.readFileSync(path.join(root, "public/js/vendor/purify.min.js"), "utf8"), "vendored files are copied as they are");
assert.equal(fs.readFileSync(path.join(out, "index.html"), "utf8"), fs.readFileSync(path.join(root, "public/index.html"), "utf8"), "index.html is copied as it is");

const env = { ...process.env, HARNESS_PUBLIC_DIR: out, KB_PROFILES: "quick", KB_ENGINES: "chromium", KB_ONLY: process.env.KB_ONLY || "" };
const run = spawnSync(process.execPath, [path.join(here, "staff-kanban.test.mjs")], { cwd: path.join(here, ".."), env, stdio: "inherit" });
fs.rmSync(out, { recursive: true, force: true });
assert.equal(run.status, 0, "the Staff Kanban suite failed against the minified build");
console.log("minified build: Staff Kanban suite passed");
