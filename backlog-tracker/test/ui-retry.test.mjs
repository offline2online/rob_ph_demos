// One retry for UI cases, none for anything else (ui/flaky.mjs, ui/run-ui.mjs,
// ui/flaky-report.mjs). No browser: the wrapper is driven with plain functions
// and tiny scripts written to a temp folder.
//   cd backlog-tracker/test && node ui-retry.test.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ui-retry-"));
const jsonl = path.join(tmp, "flaky-tests.jsonl");
process.env.FLAKY_TESTS_FILE = jsonl;
delete process.env.UI_FORCE_FAIL_ONCE;
delete process.env.UI_RETRIES;
const { retryCase, readFlaky, recordFlaky } = await import("./ui/flaky.mjs");
const { runUiFiles, CASE_LEVEL } = await import("./ui/run-ui.mjs");
const { summaryLine, buildReport } = await import("./ui/flaky-report.mjs");

let n = 0;
const ok = (name) => { n += 1; console.log(`  ok  ${name}`); };
const quiet = { log: () => {} };

// A case that passes first time: one attempt, nothing recorded.
{
  let calls = 0;
  assert.equal(await retryCase({ suite: "s", id: "TC-1" }, async () => { calls += 1; return 7; }, quiet), 7);
  assert.equal(calls, 1);
  assert.deepEqual(readFlaky(), []);
  ok("a passing case runs once and records nothing");
}

// Fails once, passes on the retry: the run goes on, and the flake is written down with its first failure.
{
  let calls = 0;
  const lines = [];
  await retryCase({ suite: "console-click", id: "TC-55", profile: "desktop-1280" }, async (attempt) => { calls += 1; if (attempt === 0) throw new Error("the card left the view\nstack…"); }, { log: (l) => lines.push(l) });
  assert.equal(calls, 2);
  const rows = readFlaky();
  assert.equal(rows.length, 1);
  assert.deepEqual({ suite: rows[0].suite, id: rows[0].id, profile: rows[0].profile, error: rows[0].error }, { suite: "console-click", id: "TC-55", profile: "desktop-1280", error: "the card left the view" });
  assert.ok(!Number.isNaN(Date.parse(rows[0].at)));
  assert.ok(lines.some((l) => l.startsWith("# RETRY TC-55 [desktop-1280]: the card left the view")));
  assert.ok(lines.some((l) => l.startsWith("# FLAKY TC-55 [desktop-1280]: failed, passed on retry 1")));
  ok("a case that passes on its retry does not fail and is recorded");
}

// Fails twice: the LAST failure is thrown, nothing more is recorded, and it is tried exactly twice.
{
  let calls = 0;
  await assert.rejects(retryCase({ suite: "s", id: "TC-2" }, async () => { calls += 1; throw new Error(`broken ${calls}`); }, quiet), /broken 2/);
  assert.equal(calls, 2);
  assert.equal(readFlaky().length, 1);
  ok("a case that fails its retry fails, after exactly two attempts");
}

// UI_RETRIES=0 and retries: 0 turn the retry off.
{
  let calls = 0;
  await assert.rejects(retryCase({ suite: "s", id: "TC-3" }, async () => { calls += 1; throw new Error("x"); }, { ...quiet, retries: 0 }), /x/);
  assert.equal(calls, 1);
  ok("retries: 0 means a failure is a failure");
}

// The env flag used only here: the named case fails its first attempt without running, then passes.
{
  process.env.UI_FORCE_FAIL_ONCE = "TC-9";
  let calls = 0;
  await retryCase({ suite: "s", id: "TC-9 forced", profile: "phone-390" }, async () => { calls += 1; }, quiet);
  let other = 0;
  await retryCase({ suite: "s", id: "TC-10" }, async () => { other += 1; }, quiet);
  delete process.env.UI_FORCE_FAIL_ONCE;
  assert.equal(calls, 1, "the forced failure replaces the first attempt");
  assert.equal(other, 1, "other cases are untouched");
  const forced = readFlaky().find((r) => r.id === "TC-9 forced");
  assert.ok(forced && /forced to fail once/.test(forced.error));
  ok("UI_FORCE_FAIL_ONCE fails the named case once; the run passes and the case is listed");
}

// The report: flaky-tests.json and the job summary name the case.
{
  const out = path.join(tmp, "flaky-tests.json");
  const summary = path.join(tmp, "summary.md");
  const r = spawnSync(process.execPath, [path.join(here, "ui", "flaky-report.mjs"), "--out", out], { env: { ...process.env, FLAKY_TESTS_FILE: jsonl, GITHUB_STEP_SUMMARY: summary, GITHUB_RUN_ID: "123", GITHUB_REPOSITORY: "o/r", GITHUB_SHA: "abc" }, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  const report = JSON.parse(fs.readFileSync(out, "utf8"));
  assert.deepEqual(report.flaky.map((f) => f.id), ["TC-55", "TC-9 forced"]);
  assert.equal(report.runUrl, "https://github.com/o/r/actions/runs/123");
  assert.match(r.stdout, /Flaky this run: TC-55 desktop-1280, passed on retry; TC-9 forced phone-390, passed on retry/);
  assert.match(fs.readFileSync(summary, "utf8"), /Flaky this run: TC-55 desktop-1280, passed on retry/);
  assert.equal(summaryLine([]), "Flaky this run: none");
  assert.deepEqual(buildReport([], {}).flaky, []);
  ok("flaky-tests.json lists the case and the job summary names it");
}

// run-ui.mjs: a small UI file that fails is run once more; a case-level file is not; it stops at the first real failure.
{
  fs.writeFileSync(jsonl, "");
  const runs = [];
  const fake = (script) => async (file) => { runs.push(file); return script[file].shift(); };
  let res = await runUiFiles(["ui/a.test.mjs", "ui/b.test.mjs"], { ...quiet, run: fake({ "ui/a.test.mjs": [{ code: 1, failLine: "FAIL a @820px" }, { code: 0, failLine: "" }], "ui/b.test.mjs": [{ code: 0, failLine: "" }] }) });
  assert.deepEqual(res, { ok: true, failed: null });
  assert.deepEqual(runs, ["ui/a.test.mjs", "ui/a.test.mjs", "ui/b.test.mjs"]);
  assert.deepEqual(readFlaky().map((r) => [r.suite, r.id, r.error]), [["console-ui", "a.test.mjs", "FAIL a @820px"]]);
  runs.length = 0;
  res = await runUiFiles(["ui/a.test.mjs", "ui/b.test.mjs"], { ...quiet, run: fake({ "ui/a.test.mjs": [{ code: 1, failLine: "x" }, { code: 1, failLine: "x" }], "ui/b.test.mjs": [] }) });
  assert.deepEqual(res, { ok: false, failed: "a.test.mjs" });
  assert.deepEqual(runs, ["ui/a.test.mjs", "ui/a.test.mjs"], "the next file is not run");
  runs.length = 0;
  assert.ok(CASE_LEVEL.includes("console-click.test.mjs") && CASE_LEVEL.includes("staff-kanban.test.mjs"));
  res = await runUiFiles(["ui/console-click.test.mjs"], { ...quiet, run: fake({ "ui/console-click.test.mjs": [{ code: 1, failLine: "x" }] }) });
  assert.deepEqual([res.ok, runs.length], [false, 1], "a suite that retries its own cases is not run twice");
  ok("run-ui.mjs retries a small UI file once and never a suite that retries its own cases");
}

// Real processes: a UI file that fails once passes the run; a unit test that fails is not retried and fails.
{
  fs.writeFileSync(jsonl, "");
  const marker = path.join(tmp, "ran-once");
  const flakyUi = path.join(tmp, "flaky-ui.test.mjs");
  fs.writeFileSync(flakyUi, `import fs from "node:fs";\nif (!fs.existsSync(${JSON.stringify(marker)})) { fs.writeFileSync(${JSON.stringify(marker)}, "1"); console.log("FAIL forced once"); process.exit(1); }\nconsole.log("PASS");\n`);
  const ui = spawnSync(process.execPath, [path.join(here, "ui", "run-ui.mjs"), flakyUi], { env: { ...process.env, FLAKY_TESTS_FILE: jsonl }, encoding: "utf8" });
  assert.equal(ui.status, 0, ui.stdout + ui.stderr);
  assert.match(ui.stdout, /# FLAKY flaky-ui\.test\.mjs: failed, passed on retry 1/);
  assert.deepEqual(readFlaky().map((r) => r.id), ["flaky-ui.test.mjs"]);

  const counter = path.join(tmp, "unit-runs");
  const unit = path.join(tmp, "unit.test.js");
  fs.writeFileSync(unit, `const fs = require("fs");\nfs.appendFileSync(${JSON.stringify(counter)}, "x");\nrequire("assert").strictEqual(1, 2, "forced unit failure");\n`);
  const u = spawnSync(process.execPath, [unit], { env: { ...process.env, FLAKY_TESTS_FILE: jsonl, UI_FORCE_FAIL_ONCE: "unit" }, encoding: "utf8" });
  assert.notEqual(u.status, 0, "a failing unit test fails the run");
  assert.equal(fs.readFileSync(counter, "utf8"), "x", "…and ran exactly once");
  assert.deepEqual(readFlaky().map((r) => r.id), ["flaky-ui.test.mjs"], "…and is not recorded as a flake");
  ok("a forced UI failure passes the run with the flake listed; a forced unit failure fails with no retry");
}

// Only UI suites may retry: nothing outside ui/ imports the wrapper or the runner, and no
// script retries a non-UI file through run-ui.mjs.
{
  const offenders = fs.readdirSync(here).filter((f) => /\.test\.m?js$/.test(f) && f !== "ui-retry.test.mjs")
    .filter((f) => /(from|import\()\s*["']\.\/ui\/(flaky|run-ui)\.mjs["']|retryCase\(/.test(fs.readFileSync(path.join(here, f), "utf8")));
  assert.deepEqual(offenders, [], "unit, rules, MCP and docs tests never retry");
  const scripts = JSON.parse(fs.readFileSync(path.join(here, "package.json"), "utf8")).scripts;
  // The two Playwright-driven files that live outside ui/.
  const BROWSER_OUTSIDE_UI = ["mcp-app-view.test.mjs", "faq-editor-load.test.mjs"];
  for (const [name, cmd] of Object.entries(scripts)) {
    for (const m of cmd.matchAll(/node\s+ui\/run-ui\.mjs((?:\s+[\w./-]+\.m?js)+)/g)) {
      for (const f of m[1].trim().split(/\s+/)) {
        assert.ok(f.startsWith("ui/") || BROWSER_OUTSIDE_UI.includes(f), `${name} retries ${f}, which is not a UI test`);
        if (!f.startsWith("ui/")) assert.match(fs.readFileSync(path.join(here, f), "utf8"), /playwright-core|launchChromium/, `${f} drives a browser`);
      }
    }
    if (/^test:(mcp|client|auth-gate|routine-binding|ready-for-testing|train-lock|rules|build-batches|app-boots:unit)$/.test(name)) assert.ok(!/run-ui\.mjs/.test(cmd), `${name} must not retry`);
  }
  recordFlaky({ suite: "s", id: "" });
  ok("only Playwright-driven suites go through the retry");
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`ui-retry: ${n} checks passed`);
