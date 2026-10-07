// Train tests run on every train push, and a failure reaches the cards
// while they are still in Ready for Testing — not first as a refused Deploy
// to Main (PR #301, 3 Oct 2026; for the DSP train's e2e-quick, PR #330,
// 6 Oct 2026). Drives the pure decision functions.
const assert = require("assert");
const { trainTestFailureTargets, touchesConsoleTests, trainTestsFor, testedHeadOf, nextTrainTestsRed } = require("../scripts/run-backlog-automation.js");

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
  ["a dsp-integration source change starts e2e-quick", trainTestsFor(["dsp-integration/apps/api/src/exchange/openrtb.ts"]).map((t) => t.workflow), ["e2e-quick.yml"]],
  ["a prototype rebuild alone starts nothing", trainTestsFor(["dsp-integration/prototype/assets/index.js", "dsp-integration/prototype/build-info.json"]), []],
  ["a change to both projects starts both", trainTestsFor(["backlog-tracker/x.js", "dsp-integration/y.ts"]).map((t) => t.workflow), ["firestore-rules-test.yml", "e2e-quick.yml"]],
  ["e2e-quick red: told once per workflow and head", trainTestFailureTargets(failed, HEAD, [{ id: "d1" }, { id: "d2", testsFailedShas: [`e2e-quick.yml@${HEAD}`] }, { id: "d3", testsFailedSha: HEAD }], "e2e-quick.yml").map((c) => c.id), ["d1", "d3"]],
  ["run on the head itself: the head", testedHeadOf(HEAD, HEAD, null), HEAD],
  ["only a prototype rebuild since the run: the run still speaks for the head", testedHeadOf("tick", HEAD, ["dsp-integration/prototype/index.html", "dsp-integration/apps/admin/public/demo/api-snapshot.json"]), "tick"],
  ["a source change since the run: stale, the head", testedHeadOf("tick", HEAD, ["dsp-integration/prototype/index.html", "dsp-integration/apps/api/src/x.ts"]), HEAD],
  ["run not behind the head (diverged): the head", testedHeadOf("tick", HEAD, null), HEAD],
  // projects/{id}.trainTestsRed — what hides Deploy to Main (PR #335, 7 Oct 2026)
  ["red on the tested commit: set", nextTrainTestsRed(null, "e2e-quick.yml", failed, HEAD, "t"), { "e2e-quick": { sha: HEAD, url: "u", at: "t" } }],
  ["already red on that commit: no change", nextTrainTestsRed({ "e2e-quick": { sha: HEAD } }, "e2e-quick.yml", failed, HEAD, "t"), undefined],
  ["green: cleared, other workflow kept", nextTrainTestsRed({ "e2e-quick": { sha: "x" }, "firestore-rules-test": { sha: "y" } }, "e2e-quick.yml", { ...failed, conclusion: "success" }, HEAD, "t"), { "firestore-rules-test": { sha: "y" } }],
  ["green with nothing red: no change", nextTrainTestsRed({}, "e2e-quick.yml", { ...failed, conclusion: "success" }, HEAD, "t"), undefined],
  ["still running: no change", nextTrainTestsRed({ "e2e-quick": { sha: "x" } }, "e2e-quick.yml", { ...failed, status: "in_progress", conclusion: "" }, HEAD, "t"), undefined],
  ["cancelled (superseded by a newer push): no change", nextTrainTestsRed({}, "e2e-quick.yml", { ...failed, conclusion: "cancelled" }, HEAD, "t"), undefined],
  ["run on a stale commit: no change", nextTrainTestsRed({}, "e2e-quick.yml", { ...failed, headSha: "older" }, HEAD, "t"), undefined],
];
let failedCount = 0;
for (const [label, got, want] of cases) {
  try { assert.deepStrictEqual(got, want); console.log(`  ok  ${label}`); }
  catch { failedCount++; console.log(`  FAIL ${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); }
}
console.log(`\n${cases.length - failedCount} passed, ${failedCount} failed`);
process.exit(failedCount ? 1 : 0);
