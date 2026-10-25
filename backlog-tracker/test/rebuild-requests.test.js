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
const { rebuildRequestOutcome, rebuildNeverStartedNote, fireRetryDue, REBUILD_NEVER_STARTED_MS, REBUILD_START_RETRIES, silentBuildSessionAction, BUILD_SESSION_SILENT_MS } = require("../scripts/run-backlog-automation.js");

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
test("a stale request with no session is asked for again, then gets the note", () => {
  assert.strictEqual(rebuildRequestOutcome(card(), NOW), "retry");
  assert.strictEqual(rebuildRequestOutcome(card({ rebuildRequestedAt: new Date(NOW - REBUILD_NEVER_STARTED_MS).toISOString() }), NOW), "retry");
  assert.strictEqual(rebuildRequestOutcome(card({ rebuildStartRetries: REBUILD_START_RETRIES - 1 }), NOW), "retry");
  assert.strictEqual(rebuildRequestOutcome(card({ rebuildStartRetries: REBUILD_START_RETRIES }), NOW), "note");
  assert.strictEqual(rebuildRequestOutcome(card({ blocked: { reason: "waiting-on-input" } }), NOW), "note");
});
test("a stale request that failed to fire is asked for again too", () => {
  const c = card({ lastFire: { status: "failed", sessionId: null, error: "status 429", at: iso(44) } });
  assert.strictEqual(rebuildRequestOutcome(c, NOW), "retry");
});
test("a request with a session started since is just cleared", () => {
  assert.strictEqual(rebuildRequestOutcome(card({ lastFire: { status: "started", sessionId: "s1", at: iso(44) } }), NOW), "clear");
});
test("a session from an earlier request does not count", () => {
  assert.strictEqual(rebuildRequestOutcome(card({ lastFire: { status: "started", sessionId: "s0", at: iso(300) } }), NOW), "retry");
});
test("a card no longer in Backlog, or already handed over, gets no note", () => {
  assert.strictEqual(rebuildRequestOutcome(card({ status: "ready-for-testing" }), NOW), "clear");
  assert.strictEqual(rebuildRequestOutcome(card({ patchReady: true }), NOW), "clear");
});
test("a build session that never reports back is restarted once, then marked errored", () => {
  const silent = (over = {}) => ({ id: "t", status: "backlog", lastFire: { status: "started", sessionId: "s1", at: iso(100) }, ...over });
  assert.strictEqual(silentBuildSessionAction(silent(), NOW), "retry");
  assert.strictEqual(silentBuildSessionAction(silent({ buildSessionRetries: 1 }), NOW), "escalate");
  assert.strictEqual(silentBuildSessionAction(silent({ lastFire: { status: "started", sessionId: "s1", at: iso(30) } }), NOW), null, "still within the window");
  assert.strictEqual(silentBuildSessionAction(silent({ buildSession: { status: "done", reportedAt: iso(20) } }), NOW), null, "it reported");
  assert.strictEqual(silentBuildSessionAction(silent({ buildSession: { status: "done", reportedAt: iso(500) } }), NOW), "retry", "an old report is not this session's");
  assert.strictEqual(silentBuildSessionAction(silent({ patchReady: true }), NOW), null);
  assert.strictEqual(silentBuildSessionAction(silent({ blocked: { reason: "waiting-on-input" } }), NOW), null);
  assert.strictEqual(silentBuildSessionAction(silent({ status: "ready-for-testing" }), NOW), null);
  assert.ok(BUILD_SESSION_SILENT_MS > 0);
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
