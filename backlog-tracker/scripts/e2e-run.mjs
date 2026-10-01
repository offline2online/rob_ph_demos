#!/usr/bin/env node
// One E2E runner, two triggers: the board's "Run E2E" button (via the Routine,
// ROUTINE_INSTRUCTIONS.md -> "Run E2E") and CI call this same script, so
// there is exactly one implementation.
//
//   node backlog-tracker/scripts/e2e-run.mjs --folder dsp-integration --mode quick|full|journey
//        [--project <projectId>] [--publish] [--commit <sha>] [--results-url <url>]
//
// The project declares its steps in <folder>/e2e.config.json:
//   { "steps": [ { "id", "label", "cmd", "modes": ["quick","full","journey"],
//                  "cases": "optional path to a JSON array of {id,status,...}" } ],
//     "report": "npm run report-e2e", "fileBugs": "npm run file-e2e-bugs" }
// A step with no `cases` file counts as one case: exit 0 = pass, else fail.
// A step whose script does not exist yet is "skipped" (not-configured), never a pass.
// Case status is "pass" | "fail" | "known-gap". Known gaps are recorded, never filed.
//
// Writes <folder>/results/<timestamp>.json (full record) and prints a one-line
// JSON summary. With --publish and BOARD_API_KEY it writes
// projects/<id>.e2eStatus through the boardApi proxy so the header chip updates.
// Exit code: 0 all green, 1 any fail, 2 could not run.
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i < 0 ? d : (process.argv[i + 1]?.startsWith("--") || process.argv[i + 1] === undefined ? true : process.argv[i + 1]); };
const folder = arg("folder");
const mode = arg("mode", "quick");
if (!folder || !["quick", "full", "journey"].includes(mode)) {
  console.error("usage: e2e-run.mjs --folder <dir> --mode quick|full|journey [--project <id>] [--publish]");
  process.exit(2);
}
const dir = resolve(folder);
const cfgPath = join(dir, "e2e.config.json");
if (!existsSync(cfgPath)) { console.error(`no ${cfgPath}`); process.exit(2); }
const cfg = JSON.parse(readFileSync(cfgPath, "utf8"));

function sh(cmd) {
  const r = spawnSync(cmd, { cwd: dir, shell: true, encoding: "utf8", env: process.env, maxBuffer: 64 * 1024 * 1024 });
  return { code: r.status ?? 1, out: `${r.stdout || ""}${r.stderr || ""}` };
}
// "npm run x" where x is not a script in package.json -> not configured yet.
function configured(cmd) {
  const m = /^npm run ([\w:.-]+)/.exec(cmd);
  if (!m) return true;
  try { return !!JSON.parse(readFileSync(join(dir, "package.json"), "utf8")).scripts?.[m[1]]; } catch { return false; }
}

const steps = [];
for (const s of cfg.steps || []) {
  if (!(s.modes || ["quick", "full"]).includes(mode)) continue;
  if (!configured(s.cmd)) { steps.push({ id: s.id, label: s.label, status: "skipped", reason: "not configured", cases: [] }); continue; }
  const t0 = Date.now();
  const r = sh(s.cmd);
  let cases = [];
  if (s.cases && existsSync(join(dir, s.cases))) {
    try { cases = JSON.parse(readFileSync(join(dir, s.cases), "utf8")); } catch { /* fall through to exit code */ }
  }
  if (!cases.length) cases = [{ id: s.id, status: r.code === 0 ? "pass" : "fail", actual: r.code === 0 ? "" : r.out.slice(-1500), repro: `cd ${folder} && ${s.cmd}` }];
  steps.push({ id: s.id, label: s.label, status: cases.some((c) => c.status === "fail") ? "fail" : "pass", ms: Date.now() - t0, cases });
}

const all = steps.flatMap((s) => s.cases);
const count = (st) => all.filter((c) => c.status === st).length;
const commit = arg("commit", spawnSync("git", ["rev-parse", "--short", "HEAD"], { cwd: dir, encoding: "utf8" }).stdout.trim());
const record = { runAt: new Date().toISOString(), mode, commit, pass: count("pass"), fail: count("fail"), gap: count("known-gap"), skipped: steps.filter((s) => s.status === "skipped").length, steps };
mkdirSync(join(dir, "results"), { recursive: true });
const file = join(dir, "results", `${record.runAt.replace(/[:.]/g, "-")}.json`);
writeFileSync(file, JSON.stringify(record, null, 2));

// Results document + tickets: the same scripts a person would run by hand.
const env = { ...process.env, E2E_RESULTS_FILE: file };
for (const [k, cmd] of [["report", cfg.report], ["fileBugs", cfg.fileBugs]]) {
  if (!cmd || !configured(cmd)) { record[`${k}Skipped`] = true; continue; }
  const r = spawnSync(cmd, { cwd: dir, shell: true, encoding: "utf8", env });
  record[`${k}Code`] = r.status;
  const m = /RESULTS_URL=(\S+)/.exec(r.stdout || ""); if (k === "report" && m) record.resultsUrl = m[1];
  const t = /TICKETS_FILED=(\d+)/.exec(r.stdout || ""); if (k === "fileBugs" && t) record.ticketsFiled = Number(t[1]);
}
if (arg("results-url")) record.resultsUrl = arg("results-url");

const breakdown = steps.map((s) => ({ id: s.id, label: s.label, status: s.status, pass: s.cases.filter((c) => c.status === "pass").length, fail: s.cases.filter((c) => c.status === "fail").length, gap: s.cases.filter((c) => c.status === "known-gap").length }));
const status = { runAt: record.runAt, mode, commit, pass: record.pass, fail: record.fail, gap: record.gap, skipped: record.skipped, resultsUrl: record.resultsUrl || null, ticketsFiled: record.ticketsFiled ?? 0, breakdown };
writeFileSync(file, JSON.stringify({ ...record, status }, null, 2));

if (arg("publish")) {
  const pid = arg("project"), key = process.env.BOARD_API_KEY;
  if (!pid || !key) { console.error("--publish needs --project and BOARD_API_KEY"); }
  else {
    const toVal = (v) => v === null || v === undefined ? { nullValue: null } : Array.isArray(v) ? { arrayValue: { values: v.map(toVal) } }
      : typeof v === "object" ? { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, toVal(x)])) } }
      : typeof v === "number" ? { integerValue: String(v) } : { stringValue: String(v) };
    const body = { fields: { e2eStatus: toVal({ ...status, runAt: undefined }) } };
    body.fields.e2eStatus.mapValue.fields.runAt = { timestampValue: status.runAt };
    const url = `https://backlog-tracker-e4ed2.web.app/boardApi/v1/projects/backlog-tracker-e4ed2/databases/(default)/documents/projects/${pid}?updateMask.fieldPaths=e2eStatus`;
    const res = await fetch(url, { method: "PATCH", headers: { "Content-Type": "application/json", "X-Board-Key": key }, body: JSON.stringify(body) });
    if (!res.ok) console.error(`publish failed: ${res.status}`);
  }
}
console.log(JSON.stringify(status));
process.exit(record.fail ? 1 : 0);
