// Closing a project's per-item build record, and the trusted reportedAt stamp
// (functions/notify-routine.js + the onBacklogItemBuildReported trigger).
// Run with:  node test/notify-routine.test.js
"use strict";
const assert = require("assert");
const { notifyRoutineOutcome, stalledNoteText, shouldStampReportedAt, STALL_MS, inFlightItemIds, unbuiltReportAction, UNBUILT_REPORT_GRACE_MS } = require("../functions/notify-routine");

let passed = 0; const failures = [];
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ok  ${name}`); } catch (err) { failures.push(name); console.log(`FAIL  ${name}\n      ${err && err.stack || err}`); }
}
const MIN = 60 * 1000;
const FIRED = Date.parse("2026-10-19T20:00:00.000Z");
const routine = (extra = {}) => ({ status: "in-progress", mode: "per-item", firedAt: new Date(FIRED), sentItemIds: ["a", "b"], ...extra });
const backlog = (id, extra = {}) => ({ id, status: "backlog", ...extra });
const reported = (id, extra = {}) => backlog(id, { buildSession: { status: "done", finishedAt: new Date(FIRED + MIN), reportedAt: new Date(FIRED + 2 * MIN) }, ...extra });

(async () => {
  await test("all sent cards landed -> done", () => {
    const r = notifyRoutineOutcome(routine(), [{ id: "a", status: "ready-for-testing" }, backlog("b", { patchReady: true })], FIRED + 5 * MIN);
    assert.deepStrictEqual(r, { outcome: "done", noteCardIds: [] });
  });
  await test("a deleted card counts as settled", () => {
    assert.strictEqual(notifyRoutineOutcome(routine({ sentItemIds: ["gone"] }), [], FIRED + MIN).outcome, "done");
  });
  await test("wrong earlier finishedAt but a server reportedAt after the fire -> done", () => {
    const wrong = (id) => backlog(id, { buildSession: { status: "done", finishedAt: "2026-10-19T14:00:00.000Z", reportedAt: new Date(FIRED + 9 * MIN) } });
    assert.strictEqual(notifyRoutineOutcome(routine(), [wrong("a"), wrong("b")], FIRED + 10 * MIN).outcome, "done");
  });
  await test("a card blocked after reporting -> done", () => {
    const blocked = reported("b", { blocked: { reason: "waiting-on-input", note: "Waits for x" } });
    assert.strictEqual(notifyRoutineOutcome(routine(), [reported("a"), blocked], FIRED + 10 * MIN).outcome, "done");
  });
  await test("a report from before the click does not count", () => {
    const old = backlog("a", { buildSession: { status: "done", reportedAt: new Date(FIRED - 60 * MIN) } });
    assert.strictEqual(notifyRoutineOutcome(routine({ sentItemIds: ["a"] }), [old], FIRED + MIN).outcome, "open");
  });
  await test("no report at 24 minutes -> open", () => {
    const r = notifyRoutineOutcome(routine(), [reported("a"), backlog("b")], FIRED + 24 * MIN);
    assert.deepStrictEqual(r, { outcome: "open", noteCardIds: [] });
  });
  await test("no report at 76 minutes -> stalled, naming only that card", () => {
    const r = notifyRoutineOutcome(routine(), [reported("a"), backlog("b")], FIRED + 76 * MIN);
    assert.deepStrictEqual(r, { outcome: "stalled", noteCardIds: ["b"] });
    assert.strictEqual(STALL_MS, 75 * MIN);
  });
  await test("a healthy DSP build still running at 59 minutes is not called stalled (26 Oct 2026)", () => {
    assert.strictEqual(notifyRoutineOutcome(routine(), [backlog("b")], FIRED + 59 * MIN).outcome, "open");
  });
  await test("an already-closed record is unchanged", () => {
    for (const status of ["done", "stalled", "error"]) {
      assert.strictEqual(notifyRoutineOutcome(routine({ status }), [backlog("a"), backlog("b")], FIRED + 99 * MIN).outcome, "closed");
    }
    assert.strictEqual(notifyRoutineOutcome(null, [], FIRED).outcome, "closed");
  });
  await test("an older single-session record settles when its cards leave Backlog", () => {
    const old = routine({ mode: undefined });
    assert.strictEqual(notifyRoutineOutcome(old, [backlog("a"), { id: "b", status: "ready-for-testing" }], FIRED + MIN).outcome, "open");
    assert.strictEqual(notifyRoutineOutcome(old, [{ id: "a", status: "ready-for-testing" }, { id: "b", status: "ready-for-testing" }], FIRED + MIN).outcome, "done");
  });
  await test("the stalled note names the start time and the session link", () => {
    const text = stalledNoteText({ id: "b", lastFire: { at: new Date(FIRED), sessionUrl: "https://claude.ai/code/cse_x" } }, routine());
    assert.ok(text.includes("2026-10-19T20:00:00.000Z") && text.includes("https://claude.ai/code/cse_x") && text.includes("hasn't reported back after 75 minutes"), text);
    assert.ok(!/click Ready for Dev to build it again/.test(text), "never invites a second session");
  });
  await test("reportedAt is stamped on a status change to done/error and on nothing else", () => {
    const run = (b, a) => shouldStampReportedAt({ buildSession: b }, { buildSession: a });
    assert.ok(run({ status: "running" }, { status: "done", finishedAt: "x" }));
    assert.ok(run(undefined, { status: "error", errorMessage: "boom" }));
    assert.ok(run({ status: "done", finishedAt: "2026-10-19T10:00:00Z" }, { status: "done", finishedAt: "2026-10-19T12:00:00Z" }), "a second report on a rebuilt card");
    assert.ok(!run({ status: "done", finishedAt: "x" }, { status: "done", finishedAt: "x", reportedAt: new Date() }), "the stamp itself must not loop");
    assert.ok(!run({ status: "running" }, { status: "running", note: 1 }));
    assert.ok(!shouldStampReportedAt({ title: "a" }, { title: "b" }));
  });
  await test("the trigger writes buildSession.reportedAt only when it should", async () => {
    const Module = require("module");
    const stubs = {
      "firebase-functions/v2/firestore": { onDocumentUpdated: (o, h) => h, onDocumentWritten: (o, h) => (typeof o === "function" ? o : h) },
      "firebase-functions/params": { defineSecret: () => ({ value: () => "" }) },
      "firebase-functions/logger": { info() {}, warn() {}, error() {}, debug() {} },
      "firebase-functions/v2/https": { onRequest: (o, h) => h },
      "firebase-admin/app": { initializeApp: () => ({}) },
      "firebase-admin/firestore": { getFirestore: () => ({}), FieldValue: { serverTimestamp: () => ({ __sentinel: "serverTimestamp" }), delete: () => ({ __d: 1 }) } },
      "firebase-admin/auth": { getAuth: () => ({}) },
      "google-auth-library": { GoogleAuth: class {} },
    };
    const orig = Module._load;
    Module._load = function (req, ...rest) { return Object.prototype.hasOwnProperty.call(stubs, req) ? stubs[req] : orig.call(this, req, ...rest); };
    let stampBuildReportedAt;
    try { ({ stampBuildReportedAt } = require("../functions/index.js").__test); } finally { Module._load = orig; }
    const run = async (before, after) => {
      const updates = [];
      await stampBuildReportedAt({ data: { before: { data: () => before }, after: { data: () => after, ref: { update: async (u) => updates.push(u) } } } });
      return updates;
    };
    const stamped = await run({ buildSession: { status: "running" } }, { buildSession: { status: "done", finishedAt: "x" } });
    assert.deepStrictEqual(Object.keys(stamped[0] || {}), ["buildSession.reportedAt"]);
    assert.deepStrictEqual(await run({ title: "a", buildSession: { status: "running" } }, { title: "b", buildSession: { status: "running" } }), []);
  });
  // ── inFlightItemIds (20 Oct 2026: duplicate builds) ──
  const started = (id, atMs, extra = {}) => backlog(id, { lastFire: { status: "started", at: new Date(atMs) }, ...extra });
  await test("in flight: a started, unreported session within the stall window", () => {
    const cards = [started("a", FIRED), started("b", FIRED, { buildSession: { status: "done", reportedAt: new Date(FIRED + MIN) } })];
    assert.deepStrictEqual(inFlightItemIds(routine(), cards, FIRED + 5 * MIN), ["a"]);
  });
  await test("not in flight: a fire that never started, a blocked card, a landed card, or past the stall window", () => {
    const cards = [backlog("a", { lastFire: { status: "retrying", at: new Date(FIRED) } }), started("b", FIRED, { blocked: { reason: "waiting-on-input" } })];
    assert.deepStrictEqual(inFlightItemIds(routine(), cards, FIRED + MIN), []);
    assert.deepStrictEqual(inFlightItemIds(routine(), [{ ...started("a", FIRED), status: "ready-for-testing" }], FIRED + MIN), []);
    assert.deepStrictEqual(inFlightItemIds(routine(), [started("a", FIRED)], FIRED + STALL_MS), []);
    assert.deepStrictEqual(inFlightItemIds(routine({ status: "done" }), [started("a", FIRED)], FIRED + MIN), []);
  });
  await test("in flight is timed from the card's own fire, so a ticket carried onto a newer click's record still counts", () => {
    const carried = routine({ firedAt: new Date(FIRED + 10 * MIN), sentItemIds: ["a"] });
    assert.deepStrictEqual(inFlightItemIds(carried, [started("a", FIRED)], FIRED + 12 * MIN), ["a"]);
  });

  // ── unbuiltReportAction (20 Oct 2026: a question asked without the flag) ──
  const REP = FIRED + 2 * MIN;
  const stopped = (extra = {}) => backlog("x", {
    buildSession: { status: "done", reportedAt: new Date(REP) },
    lastFire: { status: "started", at: new Date(FIRED) },
    notes: [{ author: "claude", text: "Decision needed: A or B? Answer on the card (Answer button)", at: new Date(REP - MIN).toISOString() }],
    ...extra,
  });
  const LATER = REP + UNBUILT_REPORT_GRACE_MS + MIN;
  await test("stopped without a patch or a flag, nobody replied -> flag it with the session's question", () => {
    const r = unbuiltReportAction(stopped(), LATER);
    assert.strictEqual(r.action, "block");
    assert.strictEqual(r.blocked.reason, "waiting-on-input");
    assert.ok(r.blocked.note.startsWith("Decision needed: A or B?"));
    assert.ok(r.blocked.note.includes("Answer on the card (Answer button)"));
  });
  await test("a person replied in a comment after the report -> rebuild with that reply as the answer", () => {
    const card = stopped();
    card.notes.push({ author: "rob@offline2online.com", text: "A", at: new Date(REP + MIN).toISOString() });
    assert.deepStrictEqual(unbuiltReportAction(card, LATER), { action: "rebuild", answer: "A" });
  });
  await test("nothing to do: within the grace period, a newer fire, a cleared flag, already flagged, patch packaged, the pipeline acted since, or a report over a day old", () => {
    assert.strictEqual(unbuiltReportAction(stopped(), REP + MIN), null);
    assert.strictEqual(unbuiltReportAction(stopped({ lastFire: { status: "started", at: new Date(REP + MIN) } }), LATER), null);
    assert.strictEqual(unbuiltReportAction(stopped({ blockedClearedAt: new Date(REP + MIN) }), LATER), null);
    assert.strictEqual(unbuiltReportAction(stopped({ blocked: { reason: "waiting-on-input", note: "q" } }), LATER), null);
    assert.strictEqual(unbuiltReportAction(stopped({ patchReady: true }), LATER), null);
    const sentBack = stopped(); sentBack.notes.push({ author: "backlog-automation", text: "Sent back automatically", at: new Date(REP + MIN).toISOString() });
    assert.strictEqual(unbuiltReportAction(sentBack, LATER), null);
    assert.strictEqual(unbuiltReportAction(stopped(), REP + 25 * 60 * MIN), null);
    assert.strictEqual(unbuiltReportAction({ ...stopped(), buildSession: { status: "error", reportedAt: new Date(REP) } }, LATER), null);
  });

  console.log(failures.length ? `\n${failures.length} failed` : `\n${passed} passed`);
  process.exit(failures.length ? 1 : 0);
})();
