// Two things the automation tidies or ignores so a train is never held for
// them (14 Nov 2026):
//
// 1. train-base/* branches. dispatchOnSha() makes one per base check and
//    nothing deleted the ones nobody read again (four on origin, the oldest
//    three weeks old). baseRefsToPrune / pruneBaseRefs delete a branch once
//    its run has a conclusion, and any branch older than 24 hours.
//
// 2. Runs that never execute. A workflow run GitHub starts for the
//    pull_request event of a train PR opened by github-actions[bot] is held
//    as `action_required` and may never run (PR #585: runs 43531762912 and
//    43531762959). The gate does not depend on them: what decides a train is
//    the run the automation dispatches itself on the train's head commit
//    (workflow_dispatch, one concurrency group per commit). A held run is
//    neither a pass nor a failure, and approveHeldRuns() stays best effort.
//
//   cd backlog-tracker/test && node train-housekeeping.test.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const auto = require("../scripts/run-backlog-automation.js");
const { baseRefsToPrune, pruneBaseRefs, BASE_REF_MAX_AGE_MS, BASE_REF_SETTLE_MS, trainTestGate, newestRealRun, trainChecksState, TRAIN_TEST_WORKFLOWS } = auto;

let n = 0;
const ok = (name) => { n += 1; console.log(`  ok  ${name}`); };
const NOW = Date.parse("2026-11-14T12:00:00Z");
const iso = (msAgo) => new Date(NOW - msAgo).toISOString();
const MIN = 60 * 1000, HOUR = 60 * MIN;

// ── 1. train-base/* branches ───────────────────────────────────────────────
{
  const refs = [
    { name: "train-base/done", runs: [{ status: "completed", createdAt: iso(40 * MIN) }], firstSeenAt: iso(38 * MIN) },
    { name: "train-base/running", runs: [{ status: "in_progress", createdAt: iso(40 * MIN) }], firstSeenAt: iso(38 * MIN) },
    { name: "train-base/one-of-two-running", runs: [{ status: "completed", createdAt: iso(50 * MIN) }, { status: "queued", createdAt: iso(20 * MIN) }], firstSeenAt: iso(50 * MIN) },
    { name: "train-base/just-finished", runs: [{ status: "completed", createdAt: iso(4 * MIN) }], firstSeenAt: iso(3 * MIN) },
    { name: "train-base/just-made", runs: [], firstSeenAt: null },
    { name: "train-base/no-runs-yet", runs: [], firstSeenAt: iso(2 * HOUR) },
    { name: "train-base/abandoned", runs: [], firstSeenAt: iso(25 * HOUR) },
    { name: "train-base/hung", runs: [{ status: "in_progress", createdAt: iso(30 * HOUR) }], firstSeenAt: iso(30 * HOUR) },
    { name: "train-base/old-run-first-sighting", runs: [{ status: "completed", createdAt: iso(22 * 24 * HOUR) }], firstSeenAt: null },
    { name: "train-base/unreadable", runs: [{ status: "unknown", createdAt: null }], firstSeenAt: iso(HOUR) },
  ];
  assert.deepStrictEqual(baseRefsToPrune(refs, NOW), [
    { name: "train-base/done", why: "its run has finished" },
    { name: "train-base/abandoned", why: "older than 24 hours" },
    { name: "train-base/hung", why: "older than 24 hours" },
    { name: "train-base/old-run-first-sighting", why: "older than 24 hours" },
  ]);
  assert.deepStrictEqual(baseRefsToPrune([], NOW), []);
  assert.ok(BASE_REF_MAX_AGE_MS === 24 * HOUR && BASE_REF_SETTLE_MS < HOUR);
  ok("a branch goes once its run has a conclusion, or after 24 hours; a running or brand-new one stays");
}
{
  // pruneBaseRefs against a scripted gh: what is listed, what is deleted, what is remembered.
  const calls = [];
  const runsOf = {
    "train-base/aaaaaaaaaaaa": [{ status: "completed", createdAt: iso(3 * HOUR) }],
    "train-base/bbbbbbbbbbbb": [{ status: "in_progress", createdAt: iso(5 * MIN) }],
    "train-base/cccccccccccc": [],
  };
  const gh = (args) => {
    calls.push(args.join(" "));
    if (args[1] && args[1].includes("matching-refs/heads/train-base/")) return JSON.stringify(Object.keys(runsOf).map((r) => `refs/heads/${r}`));
    if (args[1] && args[1].includes("actions/runs?branch=")) return JSON.stringify(runsOf[decodeURIComponent(args[1].match(/branch=([^&]+)/)[1])]);
    if (args[1] === "-X" && args[2] === "DELETE") return "";
    throw new Error(`unexpected gh ${args.join(" ")}`);
  };
  const out = pruneBaseRefs(gh, { "train-base/bbbbbbbbbbbb": iso(5 * MIN), "train-base/gone": iso(HOUR) }, NOW);
  assert.deepStrictEqual(out.deleted, ["train-base/aaaaaaaaaaaa"]);
  assert.deepStrictEqual(calls.filter((c) => c.includes("DELETE")), ["api -X DELETE repos/offline2online/rob_ph_demos/git/refs/heads/train-base/aaaaaaaaaaaa"].map((c) => c.replace("offline2online/rob_ph_demos", calls.find((x) => x.includes("matching-refs")).match(/repos\/([^/]+\/[^/]+)\//)[1])));
  assert.deepStrictEqual(out.seen, { "train-base/bbbbbbbbbbbb": iso(5 * MIN), "train-base/cccccccccccc": new Date(NOW).toISOString() }, "a new branch is stamped, a deleted or vanished one is forgotten");
  // A day later the branch that never got a run goes too.
  runsOf["train-base/bbbbbbbbbbbb"] = [{ status: "completed", createdAt: iso(5 * MIN) }];
  delete runsOf["train-base/aaaaaaaaaaaa"];
  const later = pruneBaseRefs(gh, out.seen, NOW + 25 * HOUR);
  assert.deepStrictEqual(later.deleted.sort(), ["train-base/bbbbbbbbbbbb", "train-base/cccccccccccc"]);
  assert.deepStrictEqual(later.seen, {});
  // A failed listing deletes nothing and keeps what it knew; a failed delete is not reported as deleted.
  const seen = { "train-base/x": iso(HOUR) };
  assert.deepStrictEqual(pruneBaseRefs(() => { throw new Error("HTTP 502"); }, seen, NOW), { deleted: [], seen });
  const flakyGh = (args) => { if (args[1] === "-X") throw new Error("HTTP 422"); return gh(args); };
  runsOf["train-base/dddddddddddd"] = [{ status: "completed", createdAt: iso(2 * HOUR) }];
  assert.deepStrictEqual(pruneBaseRefs(flakyGh, {}, NOW + 25 * HOUR).deleted, []);
  ok("the sweep deletes finished branches, remembers when it first saw the rest, and never throws");
}

// ── 2. Held pull_request runs are not the gate ─────────────────────────────
{
  const held = { headSha: "head", status: "completed", conclusion: "action_required", url: "u/held" };
  const dispatched = { headSha: "head", status: "completed", conclusion: "success", url: "u/dispatch" };
  assert.strictEqual(newestRealRun([held]), null, "a held run tested nothing");
  assert.strictEqual(newestRealRun([held, dispatched]).url, "u/dispatch", "the dispatched run on the same commit is the evidence");
  const console_ = TRAIN_TEST_WORKFLOWS.find((t) => t.workflow === "firestore-rules-test.yml");
  // Only a held run on the head: the gate reads "missing" (the automation then starts the run itself), never red and never green.
  assert.strictEqual(trainTestGate([{ ...console_, run: held, speaksForHead: true }]).state, "missing");
  assert.strictEqual(trainTestGate([{ ...console_, run: null, speaksForHead: false }]).state, "missing");
  assert.strictEqual(trainTestGate([{ ...console_, run: dispatched, speaksForHead: true }]).state, "green");
  assert.strictEqual(trainTestGate([{ ...console_, run: { ...dispatched, conclusion: "failure" }, speaksForHead: true }]).state, "red");
  // The PR's own check rollup: runs held as action_required report no check at all, and for a train with no
  // required PR check that reads "success" (nothing to wait for), not "pending" for ever.
  assert.strictEqual(trainChecksState([], []), "success");
  assert.strictEqual(trainChecksState(undefined, []), "success");
  ok("a held pull_request run is neither a pass nor a failure; the dispatched run on the head commit decides");
}
{
  // The dispatched run has to be startable on a commit and must not be cancelled by the next one:
  // every train test workflow accepts workflow_dispatch and keys its concurrency group on the commit.
  const dir = path.join(__dirname, "../../.github/workflows");
  for (const t of TRAIN_TEST_WORKFLOWS) {
    const text = fs.readFileSync(path.join(dir, t.workflow), "utf8");
    assert.ok(/^\s{2}workflow_dispatch:/m.test(text), `${t.workflow} can be dispatched`);
    assert.ok(/group:.*github\.event_name == 'workflow_dispatch' && github\.sha/.test(text), `${t.workflow}: a dispatched run has its own concurrency group per commit`);
  }
  ok("every train test workflow can be dispatched on a commit, in a group of its own");
}

console.log(`train-housekeeping: ${n} checks passed`);
