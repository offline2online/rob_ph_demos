// The board's flake ledger: settings/flakyTests.
//
// A UI test case that fails and then passes on its one retry does not fail
// the run (test/ui/flaky.mjs), but each one is written to the run's
// flaky-tests artifact. After each train-test run run-backlog-automation.js
// reads that artifact and keeps this ledger, so a flake is counted and fixed
// instead of re-run:
//
//   settings/flakyTests = {
//     cases: [ { id, suite, profile, count, seenAt: [ISO…], lastSeenAt,
//                lastRunUrl, lastError, ticketId } ],   // newest first, 50 at most
//     processedRuns: [run ids already read],            // newest 200
//     updatedAt
//   }
//
// A case is keyed by its id alone ("TC-55", "console-click: Modals…"), so
// flakes of one case in different viewports count together. A case that
// flakes FLAKE_TICKET_THRESHOLD times within FLAKE_WINDOW_MS gets ONE Backlog
// bug ticket, "Flaky test: <case>", and never a second while one is open.
//
// Pure: no network, no clock of its own. test/flaky-ledger.test.js.
const FLAKE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const FLAKE_TICKET_THRESHOLD = 3;
const MAX_CASES = 50;
const MAX_SEEN = 20;
const MAX_PROCESSED_RUNS = 200;
// Statuses in which a "Flaky test: …" ticket still counts as open.
const OPEN_STATUSES = ["backlog", "ready-for-testing", "ready-to-publish"];

const ms = (v) => { const n = v instanceof Date ? v.getTime() : typeof v === "number" ? v : Date.parse(v); return Number.isFinite(n) ? n : 0; };
const str = (v, max) => String(v == null ? "" : v).slice(0, max);
const flakyTicketTitle = (caseId) => `Flaky test: ${str(caseId, 150)}`;

function emptyLedger() { return { cases: [], processedRuns: [] }; }

// The flakes in a downloaded flaky-tests.json (or the jsonl it was made
// from). Anything that is not a flake row is dropped; never throws.
function flakesFromArtifact(text) {
  const rows = [];
  const push = (r) => { if (r && typeof r === "object" && typeof r.id === "string" && r.id.trim()) rows.push({ id: str(r.id.trim(), 200), suite: str(r.suite, 80), profile: str(r.profile, 80), error: str(r.error, 300), at: r.at || null }); };
  const src = String(text || "").trim();
  if (!src) return rows;
  try {
    const json = JSON.parse(src);
    (Array.isArray(json) ? json : Array.isArray(json.flaky) ? json.flaky : []).forEach(push);
    return rows;
  } catch { /* not one JSON document: one row per line */ }
  for (const line of src.split("\n")) { try { push(JSON.parse(line)); } catch { /* skip */ } }
  return rows;
}

// The ledger after one run's flakes. A run already in processedRuns changes
// nothing (the same artifact read twice must not count twice).
function applyRun(ledger, { runId, runUrl = "", flakes = [], now }) {
  const prev = ledger && Array.isArray(ledger.cases) ? ledger : emptyLedger();
  const processed = (prev.processedRuns || []).map(String);
  const key = String(runId || "");
  if (key && processed.includes(key)) return { ledger: prev, changed: false };
  const nowMs = ms(now);
  const byId = new Map(prev.cases.map((c) => [c.id, { ...c, seenAt: [...(c.seenAt || [])] }]));
  for (const f of flakes) {
    const at = new Date(ms(f.at) || nowMs).toISOString();
    const c = byId.get(f.id) || { id: f.id, suite: f.suite || "", profile: "", count: 0, seenAt: [], lastSeenAt: null, lastRunUrl: "", lastError: "", ticketId: null };
    c.count = (Number(c.count) || 0) + 1;
    c.seenAt = [...c.seenAt, at].sort().slice(-MAX_SEEN);
    c.lastSeenAt = c.seenAt[c.seenAt.length - 1];
    c.suite = f.suite || c.suite || "";
    c.profile = f.profile || c.profile || "";
    c.lastRunUrl = runUrl || c.lastRunUrl || "";
    c.lastError = f.error || c.lastError || "";
    byId.set(f.id, c);
  }
  const cases = [...byId.values()].sort((a, b) => ms(b.lastSeenAt) - ms(a.lastSeenAt)).slice(0, MAX_CASES);
  const processedRuns = key ? [key, ...processed].slice(0, MAX_PROCESSED_RUNS) : processed;
  return { ledger: { ...prev, cases, processedRuns }, changed: true };
}

// How many times a case flaked in the window ending at `now`.
const flakesInWindow = (c, now, windowMs = FLAKE_WINDOW_MS) => (c.seenAt || []).filter((t) => { const d = ms(now) - ms(t); return d >= 0 && d <= windowMs; }).length;
// What the console's health strip shows: flakes in the last 7 days.
const flakesThisWeek = (ledger, now) => ((ledger && ledger.cases) || []).reduce((n, c) => n + flakesInWindow(c, now), 0);

// The cases that need a ticket filed now: at the threshold within the
// window, and no "Flaky test: <case>" ticket open. `openTickets` is the
// project's tickets as [{ id, title, status }].
function casesNeedingTicket(ledger, { now, openTickets = [] }) {
  const open = new Set(openTickets.filter((t) => t && OPEN_STATUSES.includes(t.status)).map((t) => String(t.title || "").trim().toLowerCase()));
  return ((ledger && ledger.cases) || []).filter((c) => flakesInWindow(c, now) >= FLAKE_TICKET_THRESHOLD && !open.has(flakyTicketTitle(c.id).toLowerCase()));
}

// The ticket's description, in the four intake sections.
function flakyTicketDesc(c, now) {
  const n = flakesInWindow(c, now);
  return [
    "## Outcome",
    `The UI test case \`${c.id}\`${c.suite ? ` (${c.suite})` : ""} failed and then passed on its automatic retry ${n} times in the last 7 days${c.profile ? `, most recently in ${c.profile}` : ""}. It did not fail a run, but each flake is a retry and a risk of a false red train. Fix the case so it waits on the condition it asserts (never a fixed sleep or a wall-clock limit); do not change what it asserts about the product and do not remove it.`,
    "",
    `Last failure: ${c.lastError || "not recorded"}`,
    `Last run: ${c.lastRunUrl || "not recorded"}`,
    "",
    "## Test steps",
    `1. Run the case 20 times in a row (see backlog-tracker/test/README.md → "Flaky tests") and report the pass count in the build note: expect 20/20 with no "# RETRY" line.`,
    "2. `cd backlog-tracker/test && npm run test:offline` passes.",
    "",
    "## Dependencies",
    "None.",
    "",
    "## Spec reference",
    "backlog-tracker/REQUIREMENTS.md → \"Flaky tests: retry once, record, ticket at three\"; backlog-tracker/test/README.md → \"Flaky tests\".",
  ].join("\n");
}

module.exports = {
  FLAKE_WINDOW_MS, FLAKE_TICKET_THRESHOLD, MAX_CASES, MAX_PROCESSED_RUNS, OPEN_STATUSES,
  emptyLedger, flakesFromArtifact, applyRun, flakesInWindow, flakesThisWeek, casesNeedingTicket, flakyTicketTitle, flakyTicketDesc,
};
