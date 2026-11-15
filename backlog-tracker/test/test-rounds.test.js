// Testing rounds (ticket hm84opFjizq3vekk0fC1): the REAL functions/test-rounds.js
// — every send-back path appends to sendBacks and bumps sendBackCount, an
// arrival in Ready for Testing bumps testRound, a send-back that is not the
// ticket's fault adds no round, the 3rd counted send-back flags the ticket
// instead of rebuilding it (then the 5th), and the notes backfill counts
// exactly what rejectionsOf (public/js/rejection-summary.js) counts. Plus
// scripts/backfill-test-rounds.js's plan. Pure: no network, no credentials.
//
// Run with:  node test/test-rounds.test.js
"use strict";
const assert = require("assert");
const path = require("path");
const { pathToFileURL } = require("url");
const tr = require("../functions/test-rounds");
const { plan: backfillPlan } = require("../scripts/backfill-test-rounds");

let failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`ok - ${name}`); } catch (err) { failed++; console.log(`not ok - ${name}\n${err.stack}`); }
}

const T = (min) => new Date(Date.UTC(2026, 10, 15, 10, min)).toISOString();
const person = (min, category = "Didn't work as described", text = "The chip is missing. More detail.") =>
  ({ at: T(min), by: "person", who: "tester@example.com", category, text });
const tests = (min) => ({ at: T(min), by: "tests", category: "tests", summary: "MCP client: tools/list returns the whole surface" });
const review = (min) => ({ at: T(min), by: "review", category: "Missing a case the ticket asked for", text: "docs: REQUIREMENTS.md not updated." });

// Applies fields to a card the way a Firestore write would.
const apply = (item, fields) => Object.assign({}, item, fields || {});

(async () => {
  await test("each send-back path appends to sendBacks and bumps sendBackCount", async () => {
    let card = { id: "c", status: "ready-for-testing", testRound: 1, sendBacks: [], sendBackCount: 0, countedSendBacks: 0 };
    for (const [i, e] of [person(1), tests(2), review(3)].entries()) {
      const f = tr.recordSendBack(card, e);
      assert.ok(f, "a new send-back is recorded");
      card = apply(card, f);
      assert.strictEqual(card.sendBackCount, i + 1);
      assert.strictEqual(card.sendBacks.length, i + 1);
      assert.strictEqual(card.countedSendBacks, i + 1);
    }
    assert.deepStrictEqual(card.sendBacks.map((s) => s.by), ["person", "tests", "review"], "newest last");
    assert.strictEqual(card.sendBacks[0].who, "tester@example.com");
    assert.strictEqual(card.sendBacks[0].line, "The chip is missing", "a person's first sentence");
    assert.strictEqual(card.sendBacks[1].line, "MCP client: tools/list returns the whole surface", "the failing test for the train");
    assert.strictEqual(tr.recordSendBack(card, person(1)), null, "the same send-back (same at) is never recorded twice");
  });

  await test("sendBacks keeps the last 10, sendBackCount counts every one", async () => {
    let card = { sendBacks: [], sendBackCount: 0, countedSendBacks: 0 };
    for (let i = 0; i < 13; i++) card = apply(card, tr.recordSendBack(card, person(i)));
    assert.strictEqual(card.sendBacks.length, tr.SEND_BACKS_KEPT);
    assert.strictEqual(card.sendBackCount, 13);
    assert.strictEqual(card.countedSendBacks, 13);
    assert.strictEqual(card.sendBacks[0].at, T(3), "the oldest are dropped");
  });

  await test("arrival in Ready for Testing: round 1, then +1 after each counted send-back", async () => {
    let card = { status: "backlog", sendBacks: [], sendBackCount: 0, countedSendBacks: 0 };
    assert.strictEqual(tr.arrivalFields(card).testRound, 1, "first arrival");
    card = apply(card, tr.arrivalFields(card));
    assert.strictEqual(tr.arrivalFields(card).testRound, 1, "a re-patch landing again without a send-back stays in its round");
    card = apply(card, tr.recordSendBack(card, person(1)));
    card = apply(card, tr.arrivalFields(card));
    assert.strictEqual(card.testRound, 2);
    card = apply(card, tr.recordSendBack(card, tests(2)));
    card = apply(card, tr.arrivalFields(card));
    assert.strictEqual(card.testRound, 3);
  });

  await test("uncounted send-backs add no round and no cap: off a release, a red main, a flaky pass", async () => {
    let card = { testRound: 1, sendBacks: [], sendBackCount: 0, countedSendBacks: 0 };
    card = apply(card, tr.recordSendBack(card, person(1, tr.NO_REBUILD_CATEGORY, "Hold it for the next release.")));
    card = apply(card, tr.recordSendBack(card, { at: T(2), by: "tests", category: "main is broken", line: "main is broken", counted: false }));
    card = apply(card, tr.recordSendBack(card, { at: T(3), by: "tests", category: "flaky", line: "passed when re-run", counted: false }));
    assert.strictEqual(card.sendBackCount, 3, "recorded");
    assert.strictEqual(card.countedSendBacks, 0, "not counted");
    assert.deepStrictEqual(card.sendBacks.map((s) => s.counted), [false, false, false]);
    assert.strictEqual(tr.arrivalFields(card).testRound, 1, "no new round");
  });

  await test("the cap: the 3rd counted send-back flags needs-decision instead of rebuilding; clearing it rebuilds; next cap at 5", async () => {
    assert.deepStrictEqual([1, 2, 3, 4, 5, 6, 7].map(tr.capReached), [false, false, true, false, true, false, true]);
    assert.strictEqual(tr.nextCap(3), 5);
    assert.strictEqual(tr.nextCap(0), 3);
    // Two earlier counted send-backs, then a person's Failed testing: the
    // board writes lastFailureReason + rebuildAfterRevert, processRevertFromTrain
    // records it and decides.
    let card = { id: "c", status: "backlog", testRound: 3, sendBacks: [], sendBackCount: 0, countedSendBacks: 0 };
    card = apply(card, tr.recordSendBack(card, tests(1)));
    card = apply(card, tr.recordSendBack(card, review(2)));
    const third = { ...card, rebuildAfterRevert: true, lastFailureReason: { category: "Didn't work as described", text: "Still no chip.", action: "failed-testing", at: T(3), who: "tester@example.com" } };
    const p = tr.revertLoopPlan(third, { nowIso: T(4) });
    assert.strictEqual(p.cap, true, "third counted send-back stops");
    assert.strictEqual(p.fields.countedSendBacks, 3);
    assert.strictEqual(p.block.reason, "needs-decision");
    assert.strictEqual(p.block.setBy, tr.LOOP_FLAG_SET_BY);
    assert.match(p.block.note, /^Sent back 3 times\. Decide: rewrite the ticket, split it, or build it on the Advanced model/);
    assert.match(p.note, /next cap is at 5/);
    assert.strictEqual(p.note.split("\n").length, 4, "the headline and the three reasons");
    assert.match(p.note, /1\. .*tests: \[tests\] MCP client/);
    assert.match(p.note, /3\. .*tester@example\.com: \[Didn't work as described\] Still no chip/);
    // The flag is cleared and it is rebuilt; the 4th send-back rebuilds.
    card = apply(third, p.fields);
    const fourth = { ...card, rebuildAfterRevert: true, lastFailureReason: { category: "tests", summary: "x", action: "failed-testing", at: T(5) } };
    const p4 = tr.revertLoopPlan(fourth);
    assert.strictEqual(p4.cap, false);
    assert.strictEqual(p4.fields.sendBacks.slice(-1)[0].by, "tests", "category tests is the train's send-back");
    card = apply(fourth, p4.fields);
    const p5 = tr.revertLoopPlan({ ...card, rebuildAfterRevert: true, lastFailureReason: { category: "Other", text: "y", action: "review-kickback", at: T(6) } });
    assert.strictEqual(p5.cap, true, "5th");
    assert.strictEqual(p5.fields.sendBacks.slice(-1)[0].by, "review");
  });

  await test("a send-back already recorded by its writer (MCP, ejectRedCulprits) is not recorded again, and the cap still reads it", async () => {
    let card = { status: "backlog", sendBacks: [], sendBackCount: 0, countedSendBacks: 0 };
    card = apply(card, tr.recordSendBack(card, person(1)));
    card = apply(card, tr.recordSendBack(card, person(2)));
    card = apply(card, tr.recordSendBack(card, { ...person(3), who: "agent@example.com" }));
    const p = tr.revertLoopPlan({ ...card, rebuildAfterRevert: true, lastFailureReason: { category: "Didn't work as described", text: "x", action: "failed-testing", at: T(3) } });
    assert.deepStrictEqual(p.fields, {}, "nothing new to write");
    assert.strictEqual(p.cap, true);
  });

  await test("no cap without a rebuild to stop, nor for an uncounted send-back", async () => {
    const base = { status: "backlog", sendBacks: [], sendBackCount: 0, countedSendBacks: 2 };
    assert.strictEqual(tr.revertLoopPlan({ ...base, rebuildAfterRevert: false, lastFailureReason: { category: "Other", text: "x", at: T(1) } }).cap, false, "ejected: not rebuilt anyway");
    assert.strictEqual(tr.revertLoopPlan({ ...base, rebuildAfterRevert: true, lastFailureReason: { category: tr.NO_REBUILD_CATEGORY, text: "x", at: T(1) } }).cap, false);
    assert.strictEqual(tr.revertLoopPlan({ ...base, rebuildAfterRevert: true }).cap, false, "no lastFailureReason");
  });

  // Real notes (abridged) of a ticket sent back by the train, by a person,
  // held once for a red main, by MCP, and taken off a release.
  const notes = [
    { author: "claude", text: "Built it.", at: T(0) },
    { author: "backlog-automation", text: "Committed to the project's integration branch `deploy/x` as abc1234 (a.js).", at: T(1) },
    { author: "backlog-automation", text: "Sent back automatically (Failed testing [tests]): Why: console tests: tools/list\nconsole tests (x.yml) failed on this ticket's own commit.", at: T(2) },
    { author: "viewer", text: "Failed testing [Didn't work as described]: Nothing changed. Second sentence.", at: T(3) },
    { author: "backlog-automation", text: "Not sent back: main is broken, not this ticket. The console tests fail the same way on main without this ticket (abc1234: https://x): rules. It stays where it is.", at: T(4) },
    { author: "tester@example.com", text: "Failed testing [Missing a case the ticket asked for] (via MCP): The filter is missing.", at: T(5) },
    { author: "tester@example.com", text: `Failed testing [${tr.NO_REBUILD_CATEGORY}]: Not this release.`, at: T(6) },
    { author: "tester@example.com", text: "Ejected from train [Other]: Blocking the deploy.", at: T(7) },
  ];

  await test("backfill from notes gives the same send-backs as rejectionsOf", async () => {
    const { rejectionsOf } = await import(pathToFileURL(path.join(__dirname, "../public/js/rejection-summary.js")).href);
    const rej = rejectionsOf(notes);
    const all = tr.sendBacksFromNotes(notes);
    assert.strictEqual(all.length, rej.length, "one send-back per rejection");
    assert.deepStrictEqual(all.map((s) => s.at), rej.map((r) => r.at.toISOString()).reverse(), "the same notes, oldest first");
    assert.deepStrictEqual(all.map((s) => s.line), rej.map((r) => r.line).reverse(), "the same lines");
    assert.strictEqual(all.filter((s) => !s.counted).length, rej.filter((r) => r.kind === "held" || r.line.startsWith(`${tr.NO_REBUILD_CATEGORY}:`)).length, "held and off-a-release are the uncounted ones");
    const f = tr.backfillFields({ status: "ready-for-testing", notes });
    assert.strictEqual(f.sendBackCount, 6);
    assert.strictEqual(f.countedSendBacks, 4, "tests, person, MCP, eject — not the held one, not off-a-release");
    assert.strictEqual(f.testRound, 5, "on the board: round 1 + 4");
    assert.strictEqual(tr.backfillFields({ status: "backlog", notes }).testRound, 4, "in Backlog: the round it last ran in");
    assert.deepStrictEqual(tr.backfillFields({ status: "backlog", notes: [] }), { testRound: 0, sendBacks: [], sendBackCount: 0, countedSendBacks: 0 });
    assert.strictEqual(all[1].who, "a tester", "a viewer note");
    assert.strictEqual(all[3].who, "tester@example.com");
  });

  await test("a card without stored fields is read from its notes, and its first record stores them all", async () => {
    const card = { status: "ready-for-testing", notes };
    assert.strictEqual(tr.loopState(card).countedSendBacks, 4);
    const f = tr.recordSendBack(card, tests(30));
    assert.strictEqual(f.sendBackCount, 7);
    assert.strictEqual(f.countedSendBacks, 5);
    // The board's own Failed testing note is already on the card when the
    // automation records it: same at, so the notes are stored, not doubled.
    const again = tr.recordSendBack(card, person(3));
    assert.strictEqual(again.sendBackCount, 6);
  });

  await test("backfill-test-rounds.js plan: every non-archived ticket without the fields, never one that has them", async () => {
    const out = backfillPlan([
      { id: "a", status: "backlog", notes },
      { id: "b", status: "archived", notes },
      { id: "c", status: "ready-for-testing", notes, sendBackCount: 1, sendBacks: [] },
      { id: "d", status: "published-live", notes: [] },
    ]);
    assert.deepStrictEqual(out.map((o) => o.id), ["a", "d"]);
    assert.strictEqual(out[0].fields.countedSendBacks, 4);
    assert.strictEqual(out[1].fields.testRound, 1);
  });

  if (failed) { console.log(`\n${failed} test(s) failed`); process.exit(1); }
  console.log("\nall testing-rounds tests passed");
})();
