// Time in column and the stuck-train alert (RC6wVNJJcPjNTR5hov9W, "Flow 7/9"),
// the server half: functions/index.js's onBacklogItemStatusEntered and
// onTrainStuckEscalated under stubbed Firebase SDKs, and
// scripts/backfill-status-entered.js's plan. No network, no credentials.
//
// Every status-changing path writes backlogItems/{id}.status, and the one
// trigger on that document stamps statusEnteredAt for all of them — the
// paths below are each driven through it as the before/after shape that
// writer produces.
"use strict";
const assert = require("assert");
const Module = require("module");

let passed = 0;
async function test(name, fn) { await fn(); passed += 1; console.log(`  ok  ${name}`); }

const stubs = {
  "firebase-functions/v2/firestore": { onDocumentUpdated: (o, h) => h, onDocumentWritten: (o, h) => (typeof o === "function" ? o : h) },
  "firebase-functions/params": { defineSecret: () => ({ value: () => "" }) },
  "firebase-functions/logger": { info() {}, warn() {}, error() {}, debug() {} },
  "firebase-functions/v2/https": { onRequest: (o, h) => h },
  "firebase-admin/app": { initializeApp: () => ({}) },
  "firebase-admin/firestore": { getFirestore: () => ({}), FieldValue: { serverTimestamp: () => ({ __sentinel: "serverTimestamp" }), delete: () => ({ __d: 1 }), arrayUnion: (...v) => ({ __union: v }) } },
  "firebase-admin/auth": { getAuth: () => ({}) },
  "google-auth-library": { GoogleAuth: class {} },
};
const orig = Module._load;
Module._load = function (req, ...rest) { return Object.prototype.hasOwnProperty.call(stubs, req) ? stubs[req] : orig.call(this, req, ...rest); };
let fns;
try { fns = require("../functions/index.js").__test; } finally { Module._load = orig; }
const { stampStatusEnteredAt, postTrainStuck, trainStuckMessage } = fns;
const { plan: backfillPlan } = require("../scripts/backfill-status-entered.js");

async function runStamp(before, after) {
  const updates = [];
  await stampStatusEnteredAt({ data: { before: before === undefined ? undefined : { data: () => before }, after: after === undefined ? undefined : { data: () => after, ref: { update: async (u) => updates.push(u) } } } });
  return updates;
}

// Each writer that changes a card's status, as the transition it writes.
const STATUS_PATHS = [
  ["board: new item (addDoc)", undefined, { status: "backlog" }],
  ["board: moveItem forward", { status: "backlog" }, { status: "ready-for-testing" }],
  ["board: approve (Approved for Deployment)", { status: "ready-for-testing" }, { status: "ready-to-publish" }],
  ["board: failTesting", { status: "ready-for-testing" }, { status: "backlog", revertRequested: true }],
  ["board: eject from train", { status: "ready-to-publish" }, { status: "backlog", revertRequested: true }],
  ["board: confirm tested, no deploy", { status: "ready-for-testing" }, { status: "published-live" }],
  ["board: archive", { status: "published-live" }, { status: "archived" }],
  ["board: restore", { status: "archived" }, { status: "published-live" }],
  ["MCP: approve_for_deployment", { status: "ready-for-testing" }, { status: "ready-to-publish" }],
  ["MCP: fail_testing", { status: "ready-for-testing" }, { status: "backlog" }],
  ["MCP: archive_backlog_items", { status: "backlog" }, { status: "archived" }],
  ["automation: processApplyPatch lands", { status: "backlog", patchReady: true }, { status: "ready-for-testing", patchReady: false }],
  ["automation: train merged", { status: "ready-to-publish" }, { status: "published-live" }],
  ["automation: revert PR opened", { status: "published-live", revertReady: true }, { status: "ready-for-testing" }],
  ["automation: send-back on a red train", { status: "ready-for-testing" }, { status: "backlog" }],
  ["Cloud Function: no-diff patch goes straight to testing", { status: "backlog" }, { status: "ready-for-testing", noDeploymentRequired: true }],
];

(async () => {
  await test("statusEnteredAt is stamped by the trigger for every status-changing path", async () => {
    for (const [name, before, after] of STATUS_PATHS) {
      const u = await runStamp(before, after);
      assert.deepStrictEqual(u, [{ statusEnteredAt: { __sentinel: "serverTimestamp" } }], name);
    }
  });

  await test("no stamp without a status change, on a delete, or when the writer stamped it itself", async () => {
    assert.deepStrictEqual(await runStamp({ status: "backlog", title: "a" }, { status: "backlog", title: "b" }), []);
    assert.deepStrictEqual(await runStamp({ status: "backlog" }, undefined), []);
    const own = { toMillis: () => 2000 };
    assert.deepStrictEqual(await runStamp({ status: "backlog", statusEnteredAt: { toMillis: () => 1000 } }, { status: "ready-for-testing", statusEnteredAt: own }), []);
    // The trigger's own write (status unchanged, stamp added) does not loop.
    assert.deepStrictEqual(await runStamp({ status: "ready-for-testing" }, { status: "ready-for-testing", statusEnteredAt: own }), []);
  });

  await test("backfill-status-entered.js: every non-archived ticket without the field, from updatedAt; idempotent", async () => {
    const items = [
      { id: "a", status: "backlog", updatedAt: "2026-11-01T10:00:00Z" },
      { id: "b", status: "ready-for-testing", createdAt: "2026-11-02T10:00:00Z" },
      { id: "c", status: "archived", updatedAt: "2026-11-01T10:00:00Z" },
      { id: "d", status: "backlog", statusEnteredAt: "2026-11-03T00:00:00Z", updatedAt: "2026-11-01T10:00:00Z" },
      { id: "e", status: "backlog" },
    ];
    const first = backfillPlan(items);
    assert.deepStrictEqual(first, [{ id: "a", statusEnteredAt: "2026-11-01T10:00:00.000Z" }, { id: "b", statusEnteredAt: "2026-11-02T10:00:00.000Z" }]);
    const applied = items.map((i) => { const w = first.find((f) => f.id === i.id); return w ? { ...i, statusEnteredAt: w.statusEnteredAt } : i; });
    assert.deepStrictEqual(backfillPlan(applied), [], "a second run writes nothing");
  });

  await test("onTrainStuckEscalated posts exactly one notification per spell through the notify webhook", async () => {
    const posts = [];
    const fetchImpl = async (url, init) => { posts.push({ url, body: JSON.parse(init.body) }); return { ok: true, status: 200 }; };
    const ev = (before, after) => ({ params: { projectId: "p1" }, data: { before: { data: () => before }, after: { data: () => after } } });
    const stuck = { name: "Backlog Tracker & FAQs", trainStatus: "conflict", trainStuckReason: "conflict", trainStuckSince: new Date(Date.now() - 3 * 3600000).toISOString() };
    // Entering the state: nothing posted yet.
    assert.strictEqual(await postTrainStuck(ev({}, stuck), { webhookUrl: "https://hooks.example/x", fetchImpl }), null);
    // The escalation write: one post.
    const esc = { ...stuck, trainStuckEscalatedAt: new Date().toISOString() };
    const r = await postTrainStuck(ev(stuck, esc), { webhookUrl: "https://hooks.example/x", fetchImpl });
    assert.strictEqual(r.posted, true);
    assert.strictEqual(posts.length, 1);
    assert.match(posts[0].body.text, /Backlog Tracker & FAQs.*merge conflict.*\(for 3 h\)/);
    assert.strictEqual(posts[0].body.reason, "conflict");
    // Later writes on the same spell: nothing more.
    assert.strictEqual(await postTrainStuck(ev(esc, { ...esc, trainNote: "x" }), { webhookUrl: "https://hooks.example/x", fetchImpl }), null);
    assert.strictEqual(await postTrainStuck(ev(esc, { ...esc, trainStuckEscalatedAt: null, trainStuckSince: null, trainStuckReason: null }), { webhookUrl: "https://hooks.example/x", fetchImpl }), null);
    assert.strictEqual(posts.length, 1);
    // No webhook: the board's Needs attention strip is the alert; nothing is fetched.
    const noHook = await postTrainStuck(ev(stuck, esc), { webhookUrl: "", fetchImpl });
    assert.deepStrictEqual([noHook.posted, posts.length], [false, 1]);
    assert.match(trainStuckMessage(esc, "p1"), /Needs attention/);
  });

  console.log(`card-state-stamp: ${passed} passed`);
})().catch((err) => { console.error(err); process.exit(1); });
