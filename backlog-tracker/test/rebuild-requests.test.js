// An automatic rebuild is only ever "requested" on the card; it then either
// starts (the notify function stamps lastFire with the session) or, within a
// sweep, the card says it didn't. Pure decisions only — no network.
// Triggering case: DSP ticket OanRebXyEryAXBQrBsVe, 19 Oct 2026 — told "a
// rebuild was started automatically", the fire was answered 429, and with
// autoRebuilds already 1 nothing ever tried again.
//
// Run with:  node test/rebuild-requests.test.js
"use strict";
const assert = require("assert");
const { rebuildRequestOutcome, rebuildNeverStartedNote, fireRetryDue, REBUILD_NEVER_STARTED_MS } = require("../scripts/run-backlog-automation.js");

let passed = 0; const failures = [];
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (err) { failures.push(name); console.log(`FAIL  ${name}\n      ${err && err.stack || err}`); }
}

const NOW = Date.parse("2026-10-19T12:40:00Z");
const iso = (minAgo) => new Date(NOW - minAgo * 60 * 1000).toISOString();
const card = (over = {}) => ({ id: "t1", status: "backlog", rebuildRequestedAt: iso(45), ...over });

test("a fresh request (under 30 minutes) waits", () => {
  assert.strictEqual(rebuildRequestOutcome(card({ rebuildRequestedAt: iso(10) }), NOW), "wait");
  assert.strictEqual(rebuildRequestOutcome(card({ rebuildRequestedAt: iso(29) }), NOW), "wait");
});
test("a stale request with no session gets the note", () => {
  assert.strictEqual(rebuildRequestOutcome(card(), NOW), "note");
  assert.strictEqual(rebuildRequestOutcome(card({ rebuildRequestedAt: new Date(NOW - REBUILD_NEVER_STARTED_MS).toISOString() }), NOW), "note");
});
test("a stale request that failed to fire still gets the note", () => {
  const c = card({ lastFire: { status: "failed", sessionId: null, error: "status 429", at: iso(44) } });
  assert.strictEqual(rebuildRequestOutcome(c, NOW), "note");
});
test("a request with a session started since is just cleared", () => {
  assert.strictEqual(rebuildRequestOutcome(card({ lastFire: { status: "started", sessionId: "s1", at: iso(44) } }), NOW), "clear");
});
test("a session from an earlier request does not count", () => {
  assert.strictEqual(rebuildRequestOutcome(card({ lastFire: { status: "started", sessionId: "s0", at: iso(300) } }), NOW), "note");
});
test("a card no longer in Backlog, or already handed over, gets no note", () => {
  assert.strictEqual(rebuildRequestOutcome(card({ status: "ready-for-testing" }), NOW), "clear");
  assert.strictEqual(rebuildRequestOutcome(card({ patchReady: true }), NOW), "clear");
});
test("a card with no request is left alone", () => {
  assert.strictEqual(rebuildRequestOutcome({ id: "t", status: "backlog" }, NOW), "wait");
  assert.strictEqual(rebuildRequestOutcome({ id: "t", status: "backlog", rebuildRequestedAt: null }, NOW), "wait");
});
test("the note names when it was requested, the error if recorded, and what to do", () => {
  const withErr = rebuildNeverStartedNote(card({ rebuildRequestedAt: "2026-10-19T04:19:00.000Z", lastFire: { error: "Routine fire endpoint responded with status 429" } }));
  assert.strictEqual(withErr, "The automatic rebuild requested at 2026-10-19T04:19:00.000Z never started (Routine fire endpoint responded with status 429). Click Ready for Dev to build it again.");
  const bare = rebuildNeverStartedNote(card({ rebuildRequestedAt: "2026-10-19T04:19:00.000Z" }));
  assert.strictEqual(bare, "The automatic rebuild requested at 2026-10-19T04:19:00.000Z never started. Click Ready for Dev to build it again.");
});
test("a failed fire marked for retry is re-requested only once its time has come", () => {
  const retrying = (nextAttemptAt, over = {}) => card({ lastFire: { status: "retrying", nextAttemptAt }, ...over });
  assert.strictEqual(fireRetryDue(retrying(iso(1)), NOW), true);
  assert.strictEqual(fireRetryDue(retrying(new Date(NOW + 60000).toISOString()), NOW), false);
  assert.strictEqual(fireRetryDue(retrying(iso(1), { status: "ready-for-testing" }), NOW), false);
  assert.strictEqual(fireRetryDue(retrying(iso(1), { blocked: { reason: "waiting-on-input" } }), NOW), false);
  assert.strictEqual(fireRetryDue(card({ lastFire: { status: "failed", nextAttemptAt: null } }), NOW), false);
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
