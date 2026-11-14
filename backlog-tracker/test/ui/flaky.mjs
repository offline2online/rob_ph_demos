// One retry for Playwright-driven (UI) cases, with the flake written down.
//
// A UI case that fails is run once more in the same run. A pass on the retry
// does not fail the run, but it is recorded: one JSON line per flake in
// FLAKY_TESTS_FILE (default test/flaky-tests.jsonl), which ui/flaky-report.mjs
// turns into the run's flaky-tests.json artifact and job summary, and which
// the backlog automation adds to the board's flake ledger (settings/flakyTests,
// scripts/flaky-ledger.js). A case that fails its retry fails the run as before.
//
// Only UI suites import this: unit, rules, MCP and docs tests never retry
// (test/ui-retry.test.mjs checks both halves).
//   UI_RETRIES=0             no retry (a failure is a failure)
//   UI_FORCE_FAIL_ONCE=<id>  the case whose id contains <id> fails its first
//                            attempt; used only by test/ui-retry.test.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const flakyFile = () => process.env.FLAKY_TESTS_FILE || path.join(here, "..", "flaky-tests.jsonl");
export const uiRetries = () => { const n = Number(process.env.UI_RETRIES ?? 1); return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 1; };
const firstLine = (e) => String((e && e.message) || e || "").split("\n")[0].slice(0, 300);

// Appends one flake. appendFileSync with one short line is safe across the
// Staff Kanban suite's parallel worker processes. Never throws.
export function recordFlaky({ suite, id, profile = "", error = "" }) {
  const row = { suite: String(suite || ""), id: String(id || ""), profile: String(profile || ""), error: firstLine(error), at: new Date().toISOString() };
  try { fs.appendFileSync(flakyFile(), JSON.stringify(row) + "\n"); } catch (e) { console.log(`# flaky.mjs: could not record ${row.id}: ${firstLine(e)}`); }
  return row;
}

// Every flake recorded so far in this run ([] when there is no file).
export function readFlaky(file = flakyFile()) {
  let text = "";
  try { text = fs.readFileSync(file, "utf8"); } catch { return []; }
  return text.split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter((r) => r && r.id);
}

// Runs `attempt(n)` (n = 0, then 1 on the retry). Resolves with its value;
// rejects with the LAST failure when every attempt failed.
export async function retryCase({ suite, id, profile = "" }, attempt, { retries = uiRetries(), log = console.log } = {}) {
  let first = "";
  for (let n = 0; ; n++) {
    try {
      const forced = process.env.UI_FORCE_FAIL_ONCE;
      if (n === 0 && forced && String(id).includes(forced)) throw new Error("forced to fail once (UI_FORCE_FAIL_ONCE)");
      const value = await attempt(n);
      if (n) { recordFlaky({ suite, id, profile, error: first }); log(`# FLAKY ${id}${profile ? ` [${profile}]` : ""}: failed, passed on retry ${n} — ${first}`); }
      return value;
    } catch (e) {
      if (n >= retries) throw e;
      first = first || firstLine(e);
      log(`# RETRY ${id}${profile ? ` [${profile}]` : ""}: ${first}`);
    }
  }
}
