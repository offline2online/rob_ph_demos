// Tests the REAL public/js/test-rounds-view.js — the board's read side of the
// testing-rounds fields (ticket hm84opFjizq3vekk0fC1): the "Round N" chip from
// round 2 (warning from round 3) in every column, Ready for Testing's "Sent
// back last time" line, the notes fallback for an old card, and the Testing
// loops report rows. Plain ESM, no Firebase, no DOM.
// Run with:  node test/test-rounds-view.test.mjs
import assert from "node:assert/strict";
import { loopOf, isLooping, roundChipHTML, sentBackLastTimeHTML, testingLoopRows, retestedRows, formatDuration, lastCountedSendBack, LOOP_ROUND } from "../public/js/test-rounds-view.js";
import { rejectionSummaryHTML, lastRejectionLine } from "../public/js/rejection-summary.js";

const sb = (iso, line, extra = {}) => ({ at: iso, by: "person", who: "tester@example.com", category: "Didn't work as described", line, counted: true, ...extra });
const round3 = {
  id: "r3", title: "Round three", status: "ready-for-testing", testRound: 3, sendBackCount: 3, countedSendBacks: 2,
  sendBacks: [sb("2026-11-10T10:00:00Z", "chip missing"), sb("2026-11-11T10:00:00Z", "flaky", { by: "tests", category: "flaky", counted: false }), sb("2026-11-12T10:00:00Z", "header count wrong", { by: "tests", category: "tests" })],
};
const round1 = { id: "r1", title: "First round", status: "ready-for-testing", testRound: 1, sendBackCount: 0, countedSendBacks: 0, sendBacks: [] };

// The chip: round 2 up, every column; warning at 3+.
for (const status of ["backlog", "ready-for-testing", "ready-to-publish", "published-live"]) {
  const html = roundChipHTML({ ...round3, status });
  assert.match(html, /class="round-chip round-chip-warn"/, `${status}: warning chip`);
  assert.match(html, /<span class="material-symbols-outlined" aria-hidden="true">replay<\/span>Round 3/);
  assert.match(html, /^<button type="button"/, "a button, so a tap opens the list (iPad)");
  assert.equal(roundChipHTML({ ...round1, status }), "", `${status}: no chip in round 1`);
}
const two = { ...round1, testRound: 2, sendBackCount: 1, countedSendBacks: 1, sendBacks: [sb("2026-11-10T10:00:00Z", "chip missing")] };
assert.match(roundChipHTML(two), /class="round-chip"/, "round 2: chip, no warning");
assert.doesNotMatch(roundChipHTML(two), /round-chip-warn/);

// Hover lists every earlier send-back; the uncounted one says so.
const chip = roundChipHTML(round3);
assert.match(chip, /title="Round 3\. Sent back 2 times \(plus 1 not counted\):/);
assert.match(chip, /header count wrong/);
assert.match(chip, /flaky \(not counted\)/);
assert.doesNotMatch(chip, /round-history/, "the list opens on tap only");
const open = roundChipHTML(round3, { expanded: true });
assert.match(open, /aria-expanded="true"/);
assert.equal((open.match(/<li/g) || []).length, 3, "one line per send-back");
assert.match(open, /class="round-history-uncounted"/, "the uncounted one greyed");

// Ready for Testing: what to re-check, from round 2.
assert.match(sentBackLastTimeHTML(round3), /Sent back last time: header count wrong/, "the last COUNTED send-back");
assert.equal(sentBackLastTimeHTML(round1), "");
assert.equal(sentBackLastTimeHTML({ ...round3, status: "backlog" }), "", "Ready for Testing only");
assert.equal(lastCountedSendBack(round3).line, "header count wrong");

// Looping = round 3 or later.
assert.equal(LOOP_ROUND, 3);
assert.equal(isLooping(round3), true);
assert.equal(isLooping(two), false);

// An old card with no stored fields is read from its notes.
const old = {
  id: "old", status: "ready-for-testing",
  notes: [
    { author: "backlog-automation", text: "Sent back automatically (Failed testing [tests]): Why: console tests: tools/list\nmore", at: "2026-11-01T10:00:00Z" },
    { author: "viewer", text: "Failed testing [Didn't work as described]: Still broken. More.", at: "2026-11-02T10:00:00Z" },
    { author: "viewer", text: "Failed testing [Blocking a release, not a rebuild]: Next release.", at: "2026-11-03T10:00:00Z" },
  ],
};
const o = loopOf(old);
assert.equal(o.counted, 2);
assert.equal(o.sendBackCount, 3);
assert.equal(o.round, 3, "on the board: 1 + 2 counted");
assert.match(roundChipHTML(old), /Round 3/);
assert.match(sentBackLastTimeHTML(old), /Sent back last time: Didn&#39;t work as described: Still broken/);

// The rejection summary reads the stored fields first.
const summary = rejectionSummaryHTML(round3);
assert.match(summary, /Sent back 2×/);
assert.match(summary, /class="rejection-uncounted"/);
assert.equal(lastRejectionLine({ ...round3, lastFailureReason: null }), "header count wrong", "a tests send-back has no category prefix");
assert.match(rejectionSummaryHTML(old), /Sent back 3×/, "notes fallback unchanged for an old card");

// The Testing loops report: 2+ counted send-backs in the last 30 days.
const now = Date.parse("2026-11-15T12:00:00Z");
const looping = {
  ...round3, id: "loop", approvedAt: "2026-11-13T10:00:00Z",
  notes: [{ text: "Committed to the project's integration branch `deploy/x` as abc (a.js).", at: "2026-11-09T10:00:00Z" }],
};
const rows = testingLoopRows([looping, round1, two, { ...looping, id: "stale", sendBacks: looping.sendBacks.map((s) => ({ ...s, at: "2026-09-01T10:00:00Z" })) }], now);
assert.deepEqual(rows.map((r) => r.id), ["loop"], "only 2+ counted in the last 30 days");
assert.equal(rows[0].recent, 2);
assert.equal(rows[0].round, 3);
assert.deepEqual(rows[0].reasons, ["tester@example.com: chip missing", "tests: header count wrong"]);
assert.equal(rows[0].buildToApprovalMs, 4 * 24 * 3600 * 1000);
assert.equal(formatDuration(rows[0].buildToApprovalMs), "4 days");
assert.equal(formatDuration(5 * 3600 * 1000), "5 h");
assert.equal(formatDuration(null), "");

// Retested tickets (0I93kb0fqXL4Qr4qyzwv): every ticket not archived with a
// counted send-back, all time, most retested first; the Dashboard counts these.
const oldLoop = { ...two, id: "old-one", title: "Old one", sendBacks: two.sendBacks.map((s) => ({ ...s, at: "2026-09-01T10:00:00Z" })) };
const shipped = { ...looping, id: "shipped", status: "published-live" };
const gone = { ...looping, id: "gone", status: "archived" };
const onlyUncounted = { ...round1, id: "flaky-only", sendBackCount: 1, countedSendBacks: 0, sendBacks: [sb("2026-11-11T10:00:00Z", "flaky", { by: "tests", counted: false })] };
const retested = retestedRows([round1, oldLoop, looping, gone, onlyUncounted, shipped, two]);
assert.deepEqual(retested.map((r) => r.id), ["loop", "shipped", "r1", "old-one"], "counted >= 1, archived and uncounted-only left out, most retested then latest first");
assert.equal(retested[0].counted, 2, "times retested is the counted send-backs, not the round");
assert.equal(retested[0].round, 3);
assert.equal(retested[0].recent, 2, "every counted send-back, not only the last 30 days");
assert.equal(retested.find((r) => r.id === "old-one").recent, 1, "an old send-back still counts");
assert.deepEqual(retestedRows([]), []);

console.log("test-rounds-view: all passed");
