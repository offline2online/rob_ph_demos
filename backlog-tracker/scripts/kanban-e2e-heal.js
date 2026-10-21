// Self-healing Staff Kanban E2E loop (ticket 6CScTuviK0lxznLl5FNk, 21 Oct 2026).
//
// The Staff Kanban suites run on every train that changes backlog-tracker/ or
// kanban-staff-board/ (TRAIN_TEST_WORKFLOWS in run-backlog-automation.js).
// When one fails, each failing case becomes a bug ticket that is sent straight
// to build and lands on the SAME train, the suite re-runs, and the loop
// repeats until green. A case that still fails after MAX_FIX_ATTEMPTS fixes is
// flagged for Rob and the rest of the train keeps going.
//
// Everything here is pure (no network, no git): the automation reads the
// board and the run logs, calls these, and does the writes. Tested by
// test/kanban-e2e-heal.test.js.

const MAX_FIX_ATTEMPTS = 3;
const E2E_AUTO_FIX_LABEL = "E2E auto-fix";
const KANBAN_PREFIXES = ["kanban-staff-board/", "backlog-tracker/"];

// A fix ticket in these states is still working towards green.
const OPEN_FIX_STATUSES = ["backlog", "ready-for-testing", "ready-to-publish"];

const stripAnsi = (s) => String(s || "").replace(/\x1b\[[0-9;]*m/g, "");
const CASE_RE = /\bTC-\d+[a-z]?\b/;
const VIEWPORT_RE = /[\[(](desktop|tablet|phone|mobile|laptop)\b[^\])]*[\])]/i;
const FAIL_LINE_RE = /^\s*(?:FAIL\b|not ok\b|✖|✘|×|✗)\s*(?:\d+\s*-\s*)?(.*)$/;

// Failing cases in a run's log (`gh run view --log-failed`: "job<TAB>step<TAB>
// timestamp text" lines, or bare text). Understands the console suite's
// "FAIL  <name>" + indented message, node:test's "✖ <name> (12ms)" and TAP's
// "not ok". `otherFailures` is true when something failed that is not a
// Staff Kanban case (the console tests run the whole console), so the caller
// leaves those to the usual red-train handling.
function parseFailedCases(log) {
  const rows = stripAnsi(log).split("\n").map((line) => {
    const parts = line.split("\t");
    const text = (parts.length >= 3 ? parts.slice(2).join("\t") : line).replace(/^﻿?\d{4}-\d\d-\d\dT[\d:.]+Z ?/, "");
    return text;
  });
  const found = new Map();
  let otherFailures = false;
  for (let i = 0; i < rows.length; i++) {
    const m = FAIL_LINE_RE.exec(rows[i]);
    if (!m) continue;
    const name = m[1].replace(/\s+\(\d+(\.\d+)?m?s\)\s*$/, "").trim();
    // node:test prints a summary line "✖ failing tests:" and the same name
    // again under it; the first mention of a case is the one we keep.
    if (!name || /^failing tests:?$/i.test(name)) continue;
    const id = (CASE_RE.exec(name) || [])[0];
    const isKanban = !!id || /kanban/i.test(name);
    if (!isKanban) { otherFailures = true; continue; }
    const vp = (VIEWPORT_RE.exec(name) || [])[1];
    const viewport = vp ? vp.toLowerCase() : "default";
    const caseId = id || name.slice(0, 60);
    const key = healKey(caseId, viewport);
    if (found.has(key)) continue;
    let failure = "";
    for (let j = i + 1; j < Math.min(rows.length, i + 6); j++) {
      const t = rows[j].trim();
      if (!t || /^at /.test(t) || /^-+$/.test(t)) continue;
      if (FAIL_LINE_RE.test(rows[j])) break;
      failure = t.replace(/^(AssertionError( \[ERR_ASSERTION\])?|Error):\s*/, "");
      break;
    }
    found.set(key, { caseId, viewport, name, failure: failure.length > 400 ? `${failure.slice(0, 397)}…` : failure });
  }
  return { cases: [...found.values()], otherFailures };
}

const healKey = (caseId, viewport) => `${String(caseId).toLowerCase()}@${String(viewport || "default").toLowerCase()}`;

// What `e2eAutoFix` on a fix ticket holds (also the shape a test builds).
function autoFixRecord({ failure, trainBranch, trainProjectId, causedByItemId, workflow, runUrl, sha, attempt }) {
  return {
    key: healKey(failure.caseId, failure.viewport),
    caseId: failure.caseId, viewport: failure.viewport, failure: failure.failure || "",
    trainBranch, trainProjectId, causedByItemId: causedByItemId || null,
    workflow, runUrl: runUrl || null, sha, attempt,
  };
}

// Decides, for one train, what the failing run asks for.
//   failures  — parseFailedCases().cases on the train's head
//   fixes     — every existing ticket with an e2eAutoFix for this train
//               ({ id, status, e2eAutoFix, flaggedForRob })
//   sha       — the head the failing run tested (fix.tested: its commit is in it)
// Returns { raise: [{failure, attempt}], flag: [{failure, attempt, history}],
// waiting: [{failure, fixId}] }.
//   - a failing case with a fix still in flight is `waiting` (never a second ticket
//     for the same case while the first is being built or not yet re-tested);
//   - otherwise attempt = fixes so far + 1; past MAX_FIX_ATTEMPTS it is flagged;
//   - a case already flagged stays flagged without another note.
function planHeal({ failures, fixes, sha, maxAttempts = MAX_FIX_ATTEMPTS }) {
  const byKey = new Map();
  for (const f of fixes || []) {
    const k = f.e2eAutoFix && f.e2eAutoFix.key;
    if (!k) continue;
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(f);
  }
  const plan = { raise: [], flag: [], waiting: [] };
  for (const failure of failures || []) {
    const history = byKey.get(healKey(failure.caseId, failure.viewport)) || [];
    // In flight: still in Backlog (being built), or landed but not yet inside
    // the commit the failing run tested (`tested` is set by the caller).
    const inFlight = history.find((f) => f.status === "backlog" || (OPEN_FIX_STATUSES.includes(f.status) && !f.tested));
    if (inFlight) { plan.waiting.push({ failure, fixId: inFlight.id }); continue; }
    const attempt = history.length + 1;
    if (attempt > maxAttempts) {
      if (!history.some((f) => f.flaggedForRob)) plan.flag.push({ failure, attempt: history.length, history });
      continue;
    }
    plan.raise.push({ failure, attempt });
  }
  return plan;
}

function fixTitle(failure) {
  return `E2E auto-fix: ${failure.caseId}${failure.viewport !== "default" ? ` (${failure.viewport})` : ""} fails`.slice(0, 120);
}

// The ticket text. Filled in all four intake sections, so the build session
// has nothing to wait on (ROUTINE_INSTRUCTIONS.md → "Complete the intake
// sections first"). The Outcome is what the run found, not a guess at the fix.
function fixDescription(rec, { causedByTitle } = {}) {
  const cause = rec.causedByItemId ? `Introduced by ticket ${rec.causedByItemId}${causedByTitle ? ` ("${causedByTitle}")` : ""}.` : "Which ticket introduced it is not known.";
  return [
    "## Outcome",
    `Staff Kanban case ${rec.caseId} fails${rec.viewport !== "default" ? ` at the ${rec.viewport} viewport` : ""} on \`${rec.trainBranch}\` at ${String(rec.sha).slice(0, 7)} (${rec.workflow}).`,
    `Failure: ${rec.failure || "(no message in the log)"}`,
    rec.runUrl ? `Run: ${rec.runUrl}` : "",
    cause,
    `Fix it on the train branch \`${rec.trainBranch}\` — the same branch, not a new one. This is fix attempt ${rec.attempt} of ${MAX_FIX_ATTEMPTS}; the suite re-runs by itself when it lands.`,
    "",
    "## Test steps",
    `1. Open the run link above and find ${rec.caseId}.`,
    `2. Expected: ${rec.caseId} passes at every viewport once this lands, and no other Staff Kanban case regresses.`,
    "",
    "## Dependencies",
    "None.",
    "",
    "## Spec reference",
    "`kanban-staff-board/docs/E2E-TEST-PLAN.md` → the case's row; `kanban-staff-board/REQUIREMENTS.md`.",
  ].filter((l) => l !== "").join("\n");
}

// What the card of the ticket that broke the train says once a fix is raised.
function raisedNote(rec, fixId) {
  return `Staff Kanban E2E: ${rec.caseId}${rec.viewport !== "default" ? ` (${rec.viewport})` : ""} failed on ${rec.trainBranch} at ${String(rec.sha).slice(0, 7)}. ` +
    `Raised bug ticket ${fixId} (${E2E_AUTO_FIX_LABEL}, attempt ${rec.attempt} of ${MAX_FIX_ATTEMPTS}) and sent it to build onto this train; nothing here waits on it.`;
}

function flagNote(failure, history) {
  const lines = history.map((f, i) => `  ${i + 1}. ${f.id} — ${f.status}${f.e2eAutoFix && f.e2eAutoFix.sha ? ` (failed at ${String(f.e2eAutoFix.sha).slice(0, 7)})` : ""}`);
  return `Staff Kanban E2E: ${failure.caseId}${failure.viewport !== "default" ? ` (${failure.viewport})` : ""} still fails after ${MAX_FIX_ATTEMPTS} automatic fix attempts — flagged for Rob. ` +
    `The rest of the train keeps going; only the merge to main waits for this case to pass.\nAttempts:\n${lines.join("\n")}\nLast failure: ${failure.failure || "(none)"}`;
}

// Kanban E2E status for the train card: { state, healing, flagged, detail }.
//   running — a Kanban run is in flight (or not started yet) for the head
//   healing — red, with fixes being built or re-tested (`healing` = open count)
//   flagged — a case ran out of attempts
//   green   — every Kanban workflow passed on the head
//   none    — this train changes neither folder
// `verdicts` is [{ workflow, label, verdict }] with verdict one of
// passed | failed | running | missing (the automation's trainRunVerdict
// mapped by the caller).
function kanbanE2eStatus({ verdicts, fixes }) {
  const list = verdicts || [];
  if (!list.length) return { state: "none", healing: 0, flagged: 0, detail: "No Staff Kanban suite applies to this train." };
  const open = (fixes || []).filter((f) => OPEN_FIX_STATUSES.includes(f.status));
  const flagged = (fixes || []).filter((f) => f.flaggedForRob && !OPEN_FIX_STATUSES.includes(f.status));
  const lines = list.map((v) => `${v.label || v.workflow}: ${v.verdict}`);
  if (flagged.length) return { state: "flagged", healing: open.length, flagged: flagged.length, detail: `${flagged.length} case(s) flagged for Rob after ${MAX_FIX_ATTEMPTS} attempts. ${lines.join("; ")}` };
  if (list.some((v) => v.verdict === "failed") || open.length) {
    return { state: "healing", healing: open.length, flagged: 0, detail: `${open.length} auto-fix bug(s) in flight. ${lines.join("; ")}` };
  }
  if (list.some((v) => v.verdict !== "passed")) return { state: "running", healing: 0, flagged: 0, detail: lines.join("; ") };
  return { state: "green", healing: 0, flagged: 0, detail: lines.join("; ") };
}

// An auto-fix card in Ready for Testing needs no tester: the suite is its test.
// Approve it once every applicable Kanban workflow passed on a head that
// contains its commit (the caller checks that), so the fix never keeps
// Deploy to Main from appearing.
function shouldAutoApprove(card, { allPassed }) {
  return !!(card && card.e2eAutoFix && card.status === "ready-for-testing" && !card.revertRequested && allPassed);
}

module.exports = {
  MAX_FIX_ATTEMPTS, E2E_AUTO_FIX_LABEL, KANBAN_PREFIXES, OPEN_FIX_STATUSES,
  parseFailedCases, healKey, autoFixRecord, planHeal, fixTitle, fixDescription,
  raisedNote, flagNote, kanbanE2eStatus, shouldAutoApprove,
};
