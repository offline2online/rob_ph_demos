// Console tests run on every train push, and a failure reaches the cards
// while they are still in Ready for Testing — not first as a refused Deploy
// to Main (PR #301, 3 Oct 2026). Drives the pure decision function.
const assert = require("assert");
const { trainTestFailureTargets, touchesConsoleTests } = require("../scripts/run-backlog-automation.js");

const HEAD = "aaaaaaa1111111";
const cards = [{ id: "c1" }, { id: "c2", testsFailedSha: HEAD }, { id: "c3", testsFailedSha: "old" }];
const failed = { headSha: HEAD, status: "completed", conclusion: "failure", url: "u" };
const cases = [
  ["failed on the current head: every card not yet told", trainTestFailureTargets(failed, HEAD, cards).map((c) => c.id), ["c1", "c3"]],
  ["passed: nothing", trainTestFailureTargets({ ...failed, conclusion: "success" }, HEAD, cards), []],
  ["still running: nothing yet", trainTestFailureTargets({ ...failed, status: "in_progress", conclusion: "" }, HEAD, cards), []],
  ["failed on an older head (since fixed?): nothing", trainTestFailureTargets({ ...failed, headSha: "older" }, HEAD, cards), []],
  ["no run at all: nothing", trainTestFailureTargets(null, HEAD, cards), []],
  ["timed out counts as a failure", trainTestFailureTargets({ ...failed, conclusion: "timed_out" }, HEAD, [{ id: "c1" }]).map((c) => c.id), ["c1"]],
  ["a backlog-tracker path starts the tests", touchesConsoleTests(["backlog-tracker/public/js/app.js"]), true],
  ["a faq-only or other project's change doesn't", touchesConsoleTests(["faq/index.html", "dsp-integration/x.ts"]), false],
];
let failedCount = 0;
for (const [label, got, want] of cases) {
  try { assert.deepStrictEqual(got, want); console.log(`  ok  ${label}`); }
  catch { failedCount++; console.log(`  FAIL ${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); }
}
console.log(`\n${cases.length - failedCount} passed, ${failedCount} failed`);
process.exit(failedCount ? 1 : 0);
