// Each train card's own test result (trainTest) — the pure decisions behind it.
// A tester approving a Ready for Testing card could not see whether that
// ticket's own run was going, passed or failed (Oct 2026).
const assert = require("assert");
const { TRAIN_TEST_START_GRACE_MS, worstTrainTestState, trainTestRunState, landingTrainTest, nextCardTrainTest, memoByKey, trainTestsFor } = require("../scripts/run-backlog-automation.js");

const SHA = "a".repeat(40);
const T0 = Date.parse("2026-10-19T10:00:00Z");
const iso = (ms) => new Date(ms).toISOString();
const run = (status, conclusion, url = "https://github.com/x/actions/runs/1") => ({ headSha: SHA, status, conclusion, url });
const CONSOLE = "firestore-rules-test.yml";
const DSP = "e2e-quick.yml";
const stateOf = (r) => { const x = trainTestRunState(r ? [r] : []); return x && x.state; };

// each run status and conclusion maps to its state
assert.strictEqual(stateOf(run("queued", null)), "running");
assert.strictEqual(stateOf(run("in_progress", null)), "running");
assert.strictEqual(stateOf(run("completed", "success")), "passed");
for (const c of ["failure", "timed_out", "startup_failure"]) assert.strictEqual(stateOf(run("completed", c)), "failed", c);
for (const c of ["cancelled", "skipped", "neutral", "stale"]) assert.strictEqual(stateOf(run("completed", c)), "not-run", c);
// runs that are all action_required count as no run
assert.strictEqual(trainTestRunState([run("completed", "action_required"), run("completed", "action_required")]), null);
assert.strictEqual(stateOf(run("completed", "success")), "passed");

// worst workflow wins, in the documented order
assert.strictEqual(worstTrainTestState(["passed", "running"]), "running");
assert.strictEqual(worstTrainTestState(["running", "failed", "passed"]), "failed");
assert.strictEqual(worstTrainTestState(["starting", "not-run"]), "not-run");
assert.strictEqual(worstTrainTestState(["starting", "running"]), "running");
assert.strictEqual(worstTrainTestState([]), "not-applicable");

// at landing: no workflows → not-applicable; a failed dispatch → not-run
const consoleT = trainTestsFor(["backlog-tracker/x.js"]);
assert.strictEqual(landingTrainTest(SHA, ["faq/index.html"], [], iso(T0)).state, "not-applicable");
assert.strictEqual(landingTrainTest(SHA, ["backlog-tracker/x.js"], consoleT, iso(T0)).state, "starting");
assert.strictEqual(landingTrainTest(SHA, ["backlog-tracker/x.js"], [], iso(T0)).state, "not-run");
const both = landingTrainTest(SHA, ["backlog-tracker/x.js", "dsp-integration/y.ts"], consoleT, iso(T0));
assert.deepStrictEqual(both.workflows.map((w) => [w.workflow, w.state]), [[CONSOLE, "starting"], [DSP, "not-run"]]);
assert.strictEqual(both.state, "not-run");
assert.strictEqual(both.sha, SHA);

// no run is starting for 10 minutes, then not-run
const card = { id: "c1", deployCommit: SHA, trainTest: landingTrainTest(SHA, ["backlog-tracker/x.js"], consoleT, iso(T0)) };
assert.strictEqual(nextCardTrainTest(card, { [CONSOLE]: [] }, T0 + 60e3), undefined);
assert.strictEqual(nextCardTrainTest(card, { [CONSOLE]: [run("completed", "action_required")] }, T0 + 9 * 60e3), undefined);
const late = nextCardTrainTest(card, { [CONSOLE]: [] }, T0 + TRAIN_TEST_START_GRACE_MS);
assert.strictEqual(late.state, "not-run");
assert.strictEqual(late.since, iso(T0), "the record keeps when it started");

// transitions, and the same input twice returns undefined
const running = nextCardTrainTest(card, { [CONSOLE]: [run("in_progress", null)] }, T0 + 30e3);
assert.strictEqual(running.state, "running");
assert.strictEqual(running.workflows[0].runUrl, "https://github.com/x/actions/runs/1");
const runningCard = { ...card, trainTest: running };
assert.strictEqual(nextCardTrainTest(runningCard, { [CONSOLE]: [run("in_progress", null)] }, T0 + 90e3), undefined);
const passed = nextCardTrainTest(runningCard, { [CONSOLE]: [run("completed", "success")] }, T0 + 120e3);
assert.strictEqual(passed.state, "passed");
assert.strictEqual(nextCardTrainTest({ ...card, trainTest: passed }, { [CONSOLE]: [run("completed", "success")] }, T0 + 180e3), undefined);

// the worst of two workflows wins
const twoCard = { id: "c2", deployCommit: SHA, trainTest: both };
const mixed = nextCardTrainTest(twoCard, { [CONSOLE]: [run("completed", "success")], [DSP]: [run("completed", "failure")] }, T0 + 60e3);
assert.strictEqual(mixed.state, "failed");
assert.deepStrictEqual(mixed.workflows.map((w) => w.state), ["passed", "failed"]);

// a new deployCommit gives a fresh record (not the old sha's)
const NEW = "b".repeat(40);
const moved = nextCardTrainTest({ id: "c1", deployCommit: NEW, trainTest: passed }, { [CONSOLE]: [run("in_progress", null)] }, T0 + 400e3, ["backlog-tracker/y.js"]);
assert.strictEqual(moved.sha, NEW);
assert.strictEqual(moved.state, "running");
assert.strictEqual(moved.since, iso(T0 + 400e3));

// backfill: no record → from the commit's files; none needed → not-applicable
const filled = nextCardTrainTest({ id: "c3", deployCommit: SHA }, { [CONSOLE]: [run("completed", "success")] }, T0, ["backlog-tracker/a.js"]);
assert.strictEqual(filled.state, "passed");
assert.strictEqual(nextCardTrainTest({ id: "c4", deployCommit: SHA }, {}, T0, ["faq/a.html"]).state, "not-applicable");
assert.strictEqual(nextCardTrainTest({ id: "c5" }, {}, T0), undefined, "a card with no commit has nothing to record");

// the memo fetches once per (workflow, sha)
let calls = 0;
const memo = memoByKey((w, s) => { calls += 1; return Promise.resolve([w, s]); });
// a stale own-commit failure plus a fresh running run on the revert: running
const { cardEvidenceRun } = require("../scripts/run-backlog-automation.js");
const train = [{ sha: "a1b2c3d4", message: "p", generatedOnly: false }, { sha: "k2", message: "k", generatedOnly: false }, { sha: "v3", message: "Revert\n\nThis reverts commit a1b2c3d4.", generatedOnly: false }];
const fresh = cardEvidenceRun(train, "k2", { k2: [run("completed", "failure")], v3: [run("in_progress", null)] });
const staleCard = { id: "c3", deployCommit: "k2", trainTest: { sha: "k2", state: "failed", workflows: [{ workflow: CONSOLE, label: "console tests", state: "failed", runUrl: "https://github.com/x/actions/runs/1", since: iso(T0) }], since: iso(T0) } };
assert.strictEqual(nextCardTrainTest(staleCard, { [CONSOLE]: fresh ? [fresh] : [] }, T0 + 60e3, []).state, "running");

(async () => {
  await memo(CONSOLE, SHA); await memo(CONSOLE, SHA); await memo(DSP, SHA); await memo(CONSOLE, NEW);
  assert.strictEqual(calls, 3);
  console.log("card-test-status: ok");
})();
