// The self-healing Staff Kanban E2E loop (ticket 6CScTuviK0lxznLl5FNk): which
// failures become bug tickets, when a case is flagged for Rob, and what the
// train card says. Drives the pure functions; no network.
const assert = require("assert");
const h = require("../scripts/kanban-e2e-heal");
const { TRAIN_TEST_WORKFLOWS, trainTestsFor } = require("../scripts/run-backlog-automation.js");

const consoleLog = [
  "test\tConsole\t2026-10-21T08:00:00.1Z   ok  TC-01 board renders six columns",
  "test\tConsole\t2026-10-21T08:00:01.1Z FAIL  TC-10 phone: columns are a carousel [phone 390x844]",
  "test\tConsole\t2026-10-21T08:00:01.2Z       expected 6 columns, saw 5",
  "test\tConsole\t2026-10-21T08:00:02.1Z FAIL  TC-10 phone: columns are a carousel [phone 390x844]",
  "test\tConsole\t2026-10-21T08:00:03.1Z FAIL  TC-16b server search finds a ticket the board isn't holding",
  "test\tConsole\t2026-10-21T08:00:03.2Z       AssertionError: nothing found",
].join("\n");
const parsed = h.parseFailedCases(consoleLog);
const nodeTest = h.parseFailedCases("✖ TC-05 touch: press-and-hold drag [tablet 820x1180] (1200ms)\n  Error: card did not move\n✖ failing tests:");
const mixed = h.parseFailedCases("FAIL  mcp-server: tools/list\nFAIL  TC-02 drag a card");

const fix = (id, status, over = {}) => ({ id, status, tested: false, e2eAutoFix: { key: h.healKey("TC-10", "phone") }, ...over });
const failure = { caseId: "TC-10", viewport: "phone", failure: "x" };
const plan = (fixes) => h.planHeal({ failures: [failure], fixes, sha: "head" });
const verdicts = (...v) => v.map((verdict, i) => ({ workflow: `w${i}`, label: `w${i}`, verdict }));

const cases = [
  ["parses each failing case once, with its viewport", parsed.cases.map((c) => `${c.caseId}@${c.viewport}`), ["TC-10@phone", "TC-16b@default"]],
  ["keeps the message under the failure", parsed.cases[0].failure, "expected 6 columns, saw 5"],
  ["node:test ✖ lines and the summary header", nodeTest.cases.map((c) => `${c.caseId}@${c.viewport}`), ["TC-05@tablet"]],
  ["a non-Kanban failure is reported as other", [mixed.otherFailures, mixed.cases.length], [true, 1]],
  ["all-Kanban failures leave nothing for the usual handling", parsed.otherFailures, false],
  ["first failure: raise attempt 1", plan([]).raise.map((r) => r.attempt), [1]],
  ["a fix still in Backlog: wait, never a second ticket", [plan([fix("a", "backlog")]).raise.length, plan([fix("a", "backlog")]).waiting.length], [0, 1]],
  ["a landed fix the failing run did not contain yet: wait", plan([fix("a", "ready-for-testing")]).waiting.length, 1],
  ["a landed fix the run did contain, still red: attempt 2", plan([fix("a", "ready-for-testing", { tested: true })]).raise.map((r) => r.attempt), [2]],
  ["third fix failed: attempt 3 is raised", plan([fix("a", "ready-to-publish", { tested: true }), fix("b", "ready-to-publish", { tested: true })]).raise.map((r) => r.attempt), [3]],
  ["three fixes failed: flagged, nothing raised", (() => { const p = plan([1, 2, 3].map((n) => fix(String(n), "ready-to-publish", { tested: true }))); return [p.raise.length, p.flag.length, p.flag[0].attempt]; })(), [0, 1, 3]],
  ["already flagged: not flagged twice", plan([1, 2, 3].map((n) => fix(String(n), "ready-to-publish", { tested: true, flaggedForRob: n === 3 }))).flag.length, 0],
  ["another case is unaffected by this one's history", h.planHeal({ failures: [{ caseId: "TC-11", viewport: "phone" }], fixes: [fix("a", "backlog")], sha: "head" }).raise.length, 1],
  ["status: all green", h.kanbanE2eStatus({ verdicts: verdicts("passed", "passed"), fixes: [] }).state, "green"],
  ["status: a run in flight", h.kanbanE2eStatus({ verdicts: verdicts("passed", "running"), fixes: [] }).state, "running"],
  ["status: red with a fix building", (() => { const s = h.kanbanE2eStatus({ verdicts: verdicts("failed"), fixes: [fix("a", "backlog")] }); return [s.state, s.healing]; })(), ["healing", 1]],
  ["status: fix landed, re-test pending, still healing", h.kanbanE2eStatus({ verdicts: verdicts("running"), fixes: [fix("a", "ready-for-testing")] }).state, "healing"],
  ["status: flagged wins", h.kanbanE2eStatus({ verdicts: verdicts("failed"), fixes: [fix("a", "archived", { flaggedForRob: true })] }).state, "flagged"],
  ["status: no Kanban suite applies", h.kanbanE2eStatus({ verdicts: [], fixes: [] }).state, "none"],
  ["a landed fix is approved only by a green run", [true, false].map((allPassed) => h.shouldAutoApprove({ e2eAutoFix: {}, status: "ready-for-testing" }, { allPassed })), [true, false]],
  ["an ordinary card is never auto-approved", h.shouldAutoApprove({ status: "ready-for-testing" }, { allPassed: true }), false],
  ["the title and description carry case, viewport, failure", (() => { const r = h.autoFixRecord({ failure, trainBranch: "deploy/x", trainProjectId: "p", causedByItemId: "T1", workflow: "w", runUrl: "u", sha: "abcdef123", attempt: 1 }); const d = h.fixDescription(r, { causedByTitle: "Foo" }); return [h.fixTitle(failure), /## Outcome/.test(d) && /## Test steps/.test(d) && /## Dependencies/.test(d) && /## Spec reference/.test(d), /TC-10/.test(d) && /phone/.test(d) && /T1/.test(d)]; })(), ["E2E auto-fix: TC-10 (phone) fails", true, true]],
  // the stages: either folder starts the Kanban suites, on any project's train
  ["a backlog-tracker change starts the prototype suite", trainTestsFor(["backlog-tracker/functions/index.js"]).map((t) => t.workflow), ["firestore-rules-test.yml", "kanban-staff-board-tests.yml"]],
  ["a kanban-staff-board change starts the console suites too", trainTestsFor(["kanban-staff-board/prototype/index.html"]).map((t) => t.workflow), ["firestore-rules-test.yml", "kanban-staff-board-tests.yml"]],
  ["a dsp change starts neither", trainTestsFor(["dsp-integration/apps/api/src/x.ts"]).some((t) => t.kanban), false],
  ["both Kanban workflows are healable", TRAIN_TEST_WORKFLOWS.filter((t) => t.kanban).length, 2],
];

let failed = 0;
for (const [name, got, want] of cases) {
  try { assert.deepStrictEqual(got, want); console.log(`  ok  ${name}`); }
  catch { failed++; console.log(`FAIL  ${name}\n      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`); }
}
if (failed) process.exit(1);
console.log(`${cases.length} kanban-e2e-heal cases passed`);
