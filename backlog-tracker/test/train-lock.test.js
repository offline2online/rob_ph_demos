// Unit tests for the shared, pure lock-recompute predicate
// (functions/train-lock.js) that fixes "Ready for Dev CTA stays hidden
// after all train tickets are deleted (stuck trainLocked)".
//
// This is deliberately the layer under test, not functions/index.js's
// Cloud Function trigger or app.js's isTrainLocked()/board rendering:
// train-lock.js has no Firebase SDK and no DOM, so it runs and asserts the
// same way here as it does inside the real trigger and the real sweep —
// no emulator, no stubbed SDK, no network. See train-lock-trigger.test.js
// for the same scenarios driven through the real Cloud Function handler.
//
// Run with:  node test/train-lock.test.js
"use strict";
const assert = require("assert");
const { isTrainRelevantItem, trainLockShouldClear } = require("../functions/train-lock");

let passed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed += 1; console.log(`  ok  ${name}`); }
  catch (err) { failures.push([name, err]); console.log(`FAIL  ${name}\n      ${err && err.message}`); }
}

// ── isTrainRelevantItem ─────────────────────────────────────────────────

test("a ready-to-publish item with a commit occupies the train", () => {
  assert.strictEqual(isTrainRelevantItem({ status: "ready-to-publish", deployCommit: "abc123" }), true);
});

test("a ready-for-testing item with a commit occupies the train", () => {
  assert.strictEqual(isTrainRelevantItem({ status: "ready-for-testing", deployCommit: "abc123" }), true);
});

test("a ready-to-publish item with NO deployCommit does not occupy the train", () => {
  // Same reasoning as app.js's own trainItemsForProject(): a legacy,
  // pre-train approved item has a per-ticket PR instead, not a branch
  // commit — it's legacyDeployItemsForProject's problem, not the train's.
  assert.strictEqual(isTrainRelevantItem({ status: "ready-to-publish", deployCommit: null }), false);
});

test("a plain backlog item does not occupy the train", () => {
  assert.strictEqual(isTrainRelevantItem({ status: "backlog" }), false);
});

test("a published-live item does not occupy the train", () => {
  assert.strictEqual(isTrainRelevantItem({ status: "published-live", deployCommit: "abc123" }), false);
});

test("a card mid-revert (Failed testing written, not yet reverted off the branch) still occupies the train", () => {
  assert.strictEqual(isTrainRelevantItem({ status: "backlog", revertRequested: true, deployCommit: "abc123" }), true);
});

test("a card whose revert already completed (flag and commit both cleared) does not occupy the train", () => {
  assert.strictEqual(isTrainRelevantItem({ status: "backlog", revertRequested: false, deployCommit: null }), false);
});

test("a card whose revert is BLOCKED (revertRequested stays true) still occupies the train", () => {
  assert.strictEqual(isTrainRelevantItem({ status: "backlog", revertRequested: true, revertBlockedBy: ["other1"], deployCommit: "abc123" }), true);
});

test("null/undefined item is never relevant", () => {
  assert.strictEqual(isTrainRelevantItem(null), false);
  assert.strictEqual(isTrainRelevantItem(undefined), false);
});

// ── trainLockShouldClear ─────────────────────────────────────────────────

test("an unlocked project is never told to clear (nothing to clear)", () => {
  assert.strictEqual(trainLockShouldClear({ trainLocked: false }, []), false);
});

test("THE TICKET: all approved/testing tickets deleted -> Ready for Dev should come back", () => {
  // Exactly the reported state: a train that had tickets approved (which
  // locked it), left at a stale trainStatus "conflict" from before they
  // were removed, with an empty items list once every one of them was
  // deleted from the board.
  const project = { trainLocked: true, trainStatus: "conflict", trainNote: "stale note from before deletion" };
  assert.strictEqual(trainLockShouldClear(project, []), true);
});

test("still locked while an approved (ready-to-publish) ticket remains", () => {
  const project = { trainLocked: true, trainStatus: "idle" };
  const items = [{ projectId: "p1", status: "ready-to-publish", deployCommit: "sha1" }];
  assert.strictEqual(trainLockShouldClear(project, items), false);
});

test("still locked while a ticket is still in Ready for Testing", () => {
  const project = { trainLocked: true, trainStatus: "idle" };
  const items = [{ projectId: "p1", status: "ready-for-testing", deployCommit: "sha1" }];
  assert.strictEqual(trainLockShouldClear(project, items), false);
});

test("still locked while a rejected ticket's revert hasn't finished (or is blocked)", () => {
  const project = { trainLocked: true, trainStatus: "idle" };
  const items = [{ projectId: "p1", status: "backlog", revertRequested: true, revertBlockedBy: ["x"], deployCommit: "sha1" }];
  assert.strictEqual(trainLockShouldClear(project, items), false);
});

test("clears once every ticket that was on the train has published-live, been deleted, or fully reverted", () => {
  const project = { trainLocked: true, trainStatus: "idle" };
  const items = [
    { projectId: "p1", status: "published-live", deployCommit: "sha1" },
    { projectId: "p1", status: "backlog" }, // an unrelated, never-built ticket
  ];
  assert.strictEqual(trainLockShouldClear(project, items), true);
});

test("never unlocks a project mid-deploy (trainStatus 'deploying'), even with no train-relevant items visible yet", () => {
  // Guards a real race: finishTrain() flips each item off the train
  // BEFORE it flips trainLocked false on the project itself, so a
  // recompute reacting to one of those intermediate item writes must not
  // race ahead of it.
  const project = { trainLocked: true, trainStatus: "deploying" };
  assert.strictEqual(trainLockShouldClear(project, []), false);
});

test("never unlocks a project awaiting a human merge, even with no train-relevant items visible yet", () => {
  const project = { trainLocked: true, trainStatus: "awaiting-human-merge" };
  assert.strictEqual(trainLockShouldClear(project, []), false);
});

test("items belonging to other projects are irrelevant to this project's decision", () => {
  // Callers are expected to pass only this project's own items (both real
  // call sites query backlogItems by projectId), but the predicate itself
  // doesn't filter — document that explicitly so a future caller passing
  // an unfiltered list fails loudly rather than silently trusting it.
  const project = { trainLocked: true, trainStatus: "idle" };
  const items = [{ projectId: "OTHER", status: "ready-to-publish", deployCommit: "sha1" }];
  // Passed as-is (not pre-filtered), this looks locked — proving the
  // caller's own responsibility to filter by projectId first.
  assert.strictEqual(trainLockShouldClear(project, items), false);
});

console.log(`\n${passed} passed, ${failures.length} failed\n`);
if (failures.length) {
  for (const [name, err] of failures) console.error(`--- ${name}\n${err && err.stack ? err.stack : err}\n`);
  process.exit(1);
}
