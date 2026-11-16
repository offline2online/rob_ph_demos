// Build order (ticket ZE8h8cfaezOb0eTsRjSH, 14 Nov 2026): dependencies are
// data, and one Ready for Dev click builds tickets in the right order.
//
// Why: a click fired every ticket at once from the same base. 104 tickets
// carry "Not built: since this patch was written … changed … in the same
// places" (siblings built in parallel collided), and dependants were sent
// before their dependency and wasted a session first. functions/build-order.js
// holds the rules; this drives them directly and through the real
// notifyOnProjectReadyForReview and intake triggers under stubbed Firebase SDKs
// (no emulator, credentials or network).
//
// Run with:  node test/build-order.test.js
"use strict";
const assert = require("assert");
const Module = require("module");
process.env.FIRE_SPACING_MS = "0";

const bo = require("../functions/build-order");
const { dependencyIdsOf } = require("../scripts/run-backlog-automation.js");

let passed = 0; const failures = [];
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ok  ${name}`); }
  catch (err) { failures.push(name); console.log(`FAIL  ${name}\n      ${err && err.stack || err}`); }
}

const desc = ({ outcome = "Make the thing work properly for everyone who uses it.", deps = "None", spec = "None yet — new behaviour" } = {}) =>
  `## Outcome\n${outcome}\n\n## Test steps\n1. Open the board and check it works.\n\n## Dependencies\n${deps}\n\n## Spec reference\n${spec}`;
const t = (id, extra = {}) => ({ id, projectId: "p1", status: "backlog", type: "feature", title: `Ticket ${id}`, desc: desc(), ...extra });

// ── Minimal Firestore + Firebase stubs for the two triggers ─────────────────
const DELETE = { __delete: true };
function deepMerge(base, patch) {
  const out = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    if (v === DELETE) delete out[k];
    else if (v && typeof v === "object" && v.constructor === Object && out[k] && typeof out[k] === "object" && out[k].constructor === Object) out[k] = deepMerge(out[k], v);
    else out[k] = v;
  }
  return out;
}
function makeFakeDb(seed) {
  const state = JSON.parse(JSON.stringify(seed));
  const writes = [];
  function docRef(collection, id) {
    return {
      id,
      async get() {
        const raw = state[collection] && state[collection][id];
        return { id, exists: raw !== undefined, data: () => raw };
      },
      async set(data, opts) {
        writes.push({ collection, id, data });
        state[collection] = state[collection] || {};
        state[collection][id] = opts && opts.merge ? deepMerge(state[collection][id] || {}, data) : data;
      },
      async update(data) {
        writes.push({ collection, id, data });
        state[collection][id] = deepMerge(state[collection][id] || {}, data);
      },
    };
  }
  function query(name, filters) {
    return {
      where: (f, op, v) => query(name, filters.concat([[f, op, v]])),
      async get() {
        const docs = Object.entries(state[name] || {})
          .filter(([, d]) => filters.every(([f, op, v]) => op === "==" && d[f] === v))
          .map(([id, d]) => ({ id, data: () => d }));
        return { docs, forEach: (fn) => docs.forEach(fn) };
      },
    };
  }
  return {
    collection: (name) => ({ doc: (id) => docRef(name, id), where: (f, op, v) => query(name, [[f, op, v]]) }),
    getAll: (...refs) => Promise.all(refs.map((r) => r.get())),
    __state: state, __writes: writes, __ref: docRef,
  };
}
function loadIndex(db, secrets) {
  const stubs = {
    "firebase-functions/v2/firestore": { onDocumentUpdated: (o, h) => h, onDocumentWritten: (o, h) => h },
    "firebase-functions/params": { defineSecret: (name) => ({ value: () => secrets[name] || "" }) },
    "firebase-functions/logger": { info() {}, warn() {}, error() {}, debug() {} },
    "firebase-admin/app": { initializeApp: () => ({}) },
    "firebase-admin/firestore": {
      getFirestore: () => db,
      FieldValue: { serverTimestamp: () => ({}), arrayUnion: (...items) => ({ items }), delete: () => DELETE },
    },
    "firebase-admin/auth": { getAuth: () => ({}) },
    "firebase-functions/v2/https": { onRequest: (o, h) => h },
    "google-auth-library": { GoogleAuth: class {} },
  };
  const originalLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (Object.prototype.hasOwnProperty.call(stubs, request)) return stubs[request];
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    for (const p of ["../functions/index.js"]) delete require.cache[require.resolve(p)];
    return require("../functions/index.js");
  } finally {
    Module._load = originalLoad;
  }
}
const ts = (ms) => ({ toMillis: () => ms, toDate: () => new Date(ms) });
function fireStub() {
  const calls = [];
  let n = 0;
  const fn = async (url, opts) => {
    calls.push(JSON.parse(opts.body).text);
    n++;
    return { ok: true, json: async () => ({ claude_code_session_id: `session_${n}` }) };
  };
  fn.calls = calls;
  fn.ids = () => calls.map((x) => /\(ticket (\w+)\)/.exec(x)[1]).sort();
  return fn;
}
async function click(mod, pid, itemIds) {
  const after = { name: "Backlog Tracker & FAQs", notifyRequestedAt: ts(Date.now()), ...(itemIds ? { notifyItemIds: itemIds } : {}) };
  await mod.notifyOnProjectReadyForReview({ params: { projectId: pid }, data: { before: { data: () => ({ name: after.name }) }, after: { data: () => after } } });
}
const SECRETS = { CLAUDE_ROUTINE_FIRE_URL: "https://api.anthropic.com/v1/fire", CLAUDE_ROUTINE_TOKEN: "tok" };

(async () => {
  // ── 1. Reading the Dependencies section ──────────────────────────────────
  await test("ticket ids and exact open-ticket titles in Dependencies are found; other text stays prose", async () => {
    const open = [
      { id: "aaaaaaaaaaaaaaaaaaa1", title: "Flow 1/9: train tests stop failing for reasons no ticket caused" },
      { id: "bbbbbbbbbbbbbbbbbbb2", title: "Roles page" },
      { id: "ccccccccccccccccccc3", title: "Something nobody mentions here at all" },
    ];
    const d = desc({ deps: 'None in code. Build after "Flow 1/9: train tests stop failing for reasons no ticket caused" has landed, and ZmEWDC40NYOiojehfPjk. The Roles page is unrelated; also internationalization work.' });
    const r = bo.findDependencyReferences(d, open, { selfId: "self000000000000000x" });
    assert.deepStrictEqual(r.ids, ["ZmEWDC40NYOiojehfPjk"], "a 20-character ticket id; a plain 20-letter word is not one");
    assert.deepStrictEqual(r.titleIds, ["aaaaaaaaaaaaaaaaaaa1"], "a quoted exact title resolves; a short unquoted title in prose does not");
    assert.deepStrictEqual(bo.findDependencyReferences(desc({ deps: "None" }), open), { ids: [], titleIds: [], section: "None" });
    assert.deepStrictEqual(bo.findDependencyReferences(desc({ deps: 'Needs "Roles page" first' }), open).titleIds, ["bbbbbbbbbbbbbbbbbbb2"], "a short title counts when quoted");
    assert.deepStrictEqual(bo.findDependencyReferences(desc({ deps: "self000000000000000x" }), open, { selfId: "self000000000000000x" }).ids, [], "never itself");
  });

  await test("intake replaces only what intake set; a list a build session or a person set is merged, never overwritten", async () => {
    assert.deepStrictEqual(bo.mergeDependsOn([], null, ["a"]), { ids: ["a"], source: "intake" });
    assert.deepStrictEqual(bo.mergeDependsOn(["a"], "intake", ["b"]), { ids: ["b"], source: "intake" }, "the description changed: intake's own list follows it");
    assert.deepStrictEqual(bo.mergeDependsOn(["a"], "intake", []), { ids: [], source: null });
    assert.deepStrictEqual(bo.mergeDependsOn(["x"], "build", ["b"]), { ids: ["x", "b"], source: "build" });
    assert.deepStrictEqual(bo.mergeDependsOn(["x"], "manual", []), { ids: ["x"], source: "manual" });
    assert.deepStrictEqual(bo.mergeDependsOn(["x"], undefined, ["x"]), { ids: ["x"], source: "build" }, "a legacy list (no source) was a build session's");
  });

  await test("a cycle is refused with the loop named", async () => {
    const graph = { A: ["B"], B: [], C: ["A"] };
    const titles = { A: "Alpha", B: "Bravo", C: "Charlie" };
    const ctx = { exists: (id) => id in graph, depsOf: (id) => graph[id] || [], titleOf: (id) => titles[id] };
    assert.deepStrictEqual(bo.validateDependsOn("B", ["C"], ctx).error, "That would make a loop: Bravo waits for Charlie waits for Alpha waits for Bravo. Remove one of them first.");
    assert.strictEqual(bo.validateDependsOn("B", ["A"], ctx).error, "That would make a loop: Bravo waits for Alpha waits for Bravo. Remove one of them first.");
    assert.deepStrictEqual(bo.validateDependsOn("C", ["B"], ctx), { ids: ["B"] });
    assert.ok(/No ticket with id Z/.test(bo.validateDependsOn("C", ["Z"], ctx).error));
    assert.ok(/itself/.test(bo.validateDependsOn("C", ["C"], ctx).error));
    assert.ok(/At most 20/.test(bo.validateDependsOn("C", Array.from({ length: 21 }, (_, n) => `d${n}`), ctx).error));
  });

  // ── 3. A click builds in order ───────────────────────────────────────────
  await test("A <- B <- C in one click fires A only; B and C are held for the ticket ahead of them", async () => {
    const A = t("A"), B = t("B", { dependsOnItemIds: ["A"] }), C = t("C", { dependsOnItemIds: ["B"] });
    const plan = bo.planBuildOrder([C, B, A]);
    assert.deepStrictEqual(plan.fire.map((x) => x.id), ["A"]);
    assert.deepStrictEqual(plan.held.map((h) => [h.item.id, h.waitingFor.map((w) => w.title)]), [["C", ["Ticket B"]], ["B", ["Ticket A"]]]);
    assert.ok(plan.held.every((h) => h.waitingFor.every((w) => w.inClick && w.building)), "both wait on tickets in the click");
    assert.deepStrictEqual(plan.notSent, [], "nothing missing from the click");
    const block = bo.heldBlock(plan.held[1].waitingFor, "2026-11-14T00:00:00Z");
    assert.strictEqual(block.reason, "waiting-on-dependency");
    assert.ok(block.note.startsWith("Waiting for: Ticket A."));
    assert.deepStrictEqual(dependencyIdsOf({ ...B, blocked: block }), ["A"], "the automation's release reads the held flag");
  });

  await test("B fires once A has landed (a dependency on the train, approved or live holds nothing)", async () => {
    for (const status of ["ready-for-testing", "ready-to-publish", "published-live"]) {
      const B = t("B", { dependsOnItemIds: ["A"] });
      const plan = bo.planBuildOrder([B], { depsById: { A: { id: "A", title: "Ticket A", status, deployCommit: "abc1234567890def" } } });
      assert.deepStrictEqual(plan.fire.map((x) => x.id), ["B"], status);
      assert.strictEqual(plan.summary, null);
    }
    const wait = bo.dependencyWaitPlan({ id: "B", dependsOnItemIds: ["A"], blocked: { reason: "waiting-on-dependency" } }, { A: { id: "A", status: "ready-for-testing", title: "Ticket A" } }, () => []);
    assert.strictEqual(wait.action, "release", "the sweep releases a held ticket when its dependency reaches Ready for Testing");
  });

  await test("a dependency outside the click that is still in Backlog holds the ticket, and the click says it was not sent", async () => {
    const B = t("B", { dependsOnItemIds: ["X"] });
    const C = t("C", { dependsOnItemIds: ["X"] });
    const plan = bo.planBuildOrder([B, C], { depsById: { X: { id: "X", title: "Roles page", status: "backlog" } } });
    assert.deepStrictEqual(plan.fire, []);
    assert.deepStrictEqual(plan.held.map((h) => h.item.id), ["B", "C"]);
    assert.deepStrictEqual(plan.notSent, [{ id: "X", title: "Roles page" }]);
    assert.strictEqual(plan.summary, '2 held: they need "Roles page", which was not sent.');
    const building = bo.planBuildOrder([B], { depsById: { X: { id: "X", title: "Roles page", status: "backlog" } }, building: [t("X", { title: "Roles page" })] });
    assert.deepStrictEqual(building.notSent, [], "a dependency an earlier click is building is not 'not sent'");
    assert.ok(/builds after "Roles page" reaches Ready for Testing/.test(building.summary), building.summary);
  });

  await test("a deleted or archived dependency holds nothing", async () => {
    const B = t("B", { dependsOnItemIds: ["gone", "old"] });
    const plan = bo.planBuildOrder([B], { depsById: { gone: null, old: { id: "old", status: "archived", title: "Old" } } });
    assert.deepStrictEqual(plan.fire.map((x) => x.id), ["B"]);
  });

  // ── 4. Lanes ─────────────────────────────────────────────────────────────
  await test("lanes: four tickets, two sharing an area — three fire at once, the fourth queues behind its lane-mate", async () => {
    const A = t("A", { groomAreas: ["backlog-tracker/public"], createdAt: "2026-11-10T00:00:00Z" });
    const B = t("B", { groomAreas: ["backlog-tracker/public"], createdAt: "2026-11-09T00:00:00Z" });
    const C = t("C", { groomAreas: ["faq"] });
    const D = t("D", { desc: desc({ spec: "dsp-integration/apps/api/src/server.ts" }) });
    const plan = bo.planBuildOrder([A, B, C, D]);
    assert.deepStrictEqual(plan.fire.map((x) => x.id), ["B", "C", "D"], "the older of the two lane-mates goes first");
    assert.deepStrictEqual(plan.queued.map((q) => [q.item.id, q.after.id, q.after.title]), [["A", "B", "Ticket B"]]);
    assert.strictEqual(plan.summary, "3 started. 1 queued (same area, one at a time).");
    // Priority beats age.
    const hi = bo.planBuildOrder([{ ...A, priority: "high" }, B]);
    assert.deepStrictEqual([hi.fire[0].id, hi.queued[0].item.id], ["A", "B"]);
    const lo = bo.planBuildOrder([A, { ...B, priority: "low" }]);
    assert.deepStrictEqual([lo.fire[0].id, lo.queued[0].item.id], ["A", "B"]);
  });

  await test("lanes: same file path or same named function in Outcome/Spec reference chains; Test steps and docs do not", async () => {
    const A = t("A", { desc: desc({ spec: "backlog-tracker/functions/index.js (fireBuildSessionsPerItem)" }) });
    const B = t("B", { desc: desc({ outcome: "Change how fireBuildSessionsPerItem spaces its fires for every click." }) });
    const C = t("C", { desc: desc({ spec: "backlog-tracker/REQUIREMENTS.md and functions/index.js" }) });
    const D = t("D", { desc: desc({ spec: "backlog-tracker/REQUIREMENTS.md → \"The deployment train\"" }) });
    const E = t("E", { desc: desc({ spec: "backlog-tracker/REQUIREMENTS.md → \"The deployment train\" and README.md" }) });
    const F = t("F", { desc: desc({ spec: "backlog-tracker/README.md" }) });
    assert.ok(bo.laneKeysOf(A).includes("fn:fireBuildSessionsPerItem") && bo.laneKeysOf(A).includes("file:functions/index.js"));
    const plan = bo.planBuildOrder([A, B, C, D, E, F]);
    assert.deepStrictEqual(plan.fire.map((x) => x.id), ["A", "D", "F"]);
    assert.deepStrictEqual(plan.queued.map((q) => [q.item.id, q.after.id]), [["B", "A"], ["C", "B"], ["E", "D"]]);
  });

  await test("lanes: a ticket sharing a lane with a build already running waits for that one too", async () => {
    const running = t("R", { groomAreas: ["faq"], title: "Running ticket" });
    const A = t("A", { groomAreas: ["faq"] });
    const plan = bo.planBuildOrder([A], { building: [running] });
    assert.deepStrictEqual(plan.fire, []);
    assert.deepStrictEqual(plan.queued.map((q) => [q.item.id, q.after.title]), [["A", "Running ticket"]]);
  });

  await test("a queued ticket fires when its lane-mate lands or fails, and waits while it builds", async () => {
    const q = { id: "A", queuedAfter: { itemId: "B", title: "Ticket B", at: new Date(Date.now() - 60000).toISOString() } };
    const building = { id: "B", title: "Ticket B", status: "backlog", buildAttemptId: "n1", buildSession: { attemptId: "old", status: "error" } };
    assert.deepStrictEqual(bo.queueReleasePlan(q, building), { release: false }, "an old attempt's error is not this build's");
    assert.deepStrictEqual(bo.queueReleasePlan(q, { ...building, patchReady: true }), { release: false });
    assert.strictEqual(bo.queueReleasePlan(q, { ...building, status: "ready-for-testing" }).release, true, "landed");
    assert.strictEqual(bo.queueReleasePlan(q, { ...building, buildSession: { attemptId: "n1", status: "error" } }).release, true, "failed");
    assert.strictEqual(bo.queueReleasePlan(q, { ...building, buildSession: { attemptId: "n1", status: "done" } }).release, true, "finished without a patch");
    assert.strictEqual(bo.queueReleasePlan(q, { ...building, blocked: { reason: "waiting-on-input" } }).release, true, "blocked");
    assert.strictEqual(bo.queueReleasePlan(q, { ...building, lastFire: { status: "failed" } }).release, true, "never started");
    assert.strictEqual(bo.queueReleasePlan(q, null).release, true, "deleted");
    assert.strictEqual(bo.queueReleasePlan(q, { ...building, status: "archived" }).release, true, "archived");
    const old = { ...q, queuedAfter: { ...q.queuedAfter, at: new Date(Date.now() - 4 * 3600000).toISOString() } };
    assert.strictEqual(bo.queueReleasePlan(old, building).release, true, "never waits forever");
  });

  // ── 5. Deadlock check ────────────────────────────────────────────────────
  await test("deadlock: a dependency blocked on a person changes the waiter's flag text", async () => {
    const w = { id: "W", dependsOnItemIds: ["D"], blocked: { reason: "waiting-on-dependency", note: "Waiting for: Roles page." } };
    const plan = bo.dependencyWaitPlan(w, { D: { id: "D", status: "backlog", title: "Roles page", blocked: { reason: "needs-decision" } } }, () => []);
    assert.strictEqual(plan.action, "stuck");
    assert.strictEqual(plan.note, "Waiting for Roles page, which is blocked: it needs a decision. Settle that ticket and this one builds after it.");
    assert.deepStrictEqual(plan.stuckOn, { itemId: "D", title: "Roles page", reason: "needs-decision" });
    assert.strictEqual(bo.dependencyWaitPlan({ ...w, blocked: { ...w.blocked, note: plan.note, stuckOn: plan.stuckOn } }, { D: { id: "D", status: "backlog", title: "Roles page", blocked: { reason: "needs-decision" } } }, () => []).action, "wait", "written once");
    assert.strictEqual(bo.dependencyWaitPlan({ ...w, blocked: { ...w.blocked, stuckOn: plan.stuckOn } }, { D: { id: "D", status: "backlog", title: "Roles page" } }, () => []).action, "unstuck", "the person settled it");
  });

  await test("deadlock: an archived or deleted dependency releases the waiter with a note", async () => {
    const w = { id: "W", dependsOnItemIds: ["D", "E"], blocked: { reason: "waiting-on-dependency" } };
    const plan = bo.dependencyWaitPlan(w, { D: { id: "D", status: "archived", title: "Roles page" }, E: null }, () => []);
    assert.strictEqual(plan.action, "release");
    assert.strictEqual(plan.note, 'Released: "Roles page" (archived); E (deleted) will not land, so this ticket no longer waits for them.');
  });

  await test("deadlock: a loop a build session made is put to a person on the card", async () => {
    const graph = { A: ["B"], B: ["A"] };
    const plan = bo.dependencyWaitPlan({ id: "A", dependsOnItemIds: ["B"], blocked: { reason: "waiting-on-dependency" } }, { B: { id: "B", status: "backlog", title: "Bravo", blocked: { reason: "waiting-on-dependency" } } }, (id) => graph[id]);
    assert.deepStrictEqual(plan, { action: "cycle", path: ["A", "B", "A"] });
    const block = bo.cycleBlock(plan.path, (id) => ({ A: "Alpha", B: "Bravo" })[id]);
    assert.strictEqual(block.reason, "waiting-on-input");
    assert.ok(block.note.includes("Alpha waits for Bravo waits for Alpha") && block.note.endsWith("Answer on the card (Answer button)"));
    assert.strictEqual(dependencyIdsOf({ dependsOnItemIds: ["B"], blocked: block }), null, "the sweep never turns the question back into a wait");
  });

  // ── 6. Fire text ─────────────────────────────────────────────────────────
  await test("the fire names what the ticket builds on", async () => {
    const landed = bo.landedDependencies({ dependsOnItemIds: ["A", "X"] }, { A: { title: "Ticket A", status: "ready-for-testing", deployCommit: "0123456789abcdef0123" }, X: { title: "X", status: "backlog" } });
    assert.deepStrictEqual(landed, [{ id: "A", title: "Ticket A", status: "ready-for-testing", deployCommit: "0123456789abcdef0123" }]);
    const text = bo.builtOnBlock(landed);
    assert.ok(text.includes("Already landed and in your base") && text.includes("- A: Ticket A (ready-for-testing, commit 0123456789ab)"));
    assert.strictEqual(bo.builtOnBlock([]), "");
  });

  // ── Through the real Ready for Dev trigger ───────────────────────────────
  await test("Ready for Dev with A and B (B after A): only A starts; B is held 'Waiting for: Ticket A'", async () => {
    const db = makeFakeDb({
      backlogItems: { A: t("A"), B: t("B", { dependsOnItemIds: ["A"], dependsOnSource: "intake" }) },
      projects: { p1: { name: "Backlog Tracker & FAQs" } },
    });
    const mod = loadIndex(db, SECRETS);
    const realFetch = global.fetch; const stub = fireStub(); global.fetch = stub;
    try { await click(mod, "p1", ["A", "B"]); } finally { global.fetch = realFetch; }
    assert.deepStrictEqual(stub.ids(), ["A"]);
    const B = db.__state.backlogItems.B;
    assert.strictEqual(B.blocked.reason, "waiting-on-dependency");
    assert.strictEqual(B.blocked.setBy, "build-order");
    assert.ok(B.blocked.note.startsWith("Waiting for: Ticket A."), B.blocked.note);
    const r = db.__state.projects.p1.notifyRoutine;
    assert.deepStrictEqual(r.sentItemIds, ["A"], "the board waits only for what fired");
    assert.deepStrictEqual(r.buildOrder.heldItemIds, ["B"]);
  });

  await test("Ready for Dev with a held ticket whose dependency was not sent says so on the project", async () => {
    const db = makeFakeDb({
      backlogItems: { X: t("X", { title: "Roles page" }), B: t("B", { dependsOnItemIds: ["X"] }), C: t("C", { dependsOnItemIds: ["X"] }) },
      projects: { p1: { name: "Backlog Tracker & FAQs" } },
    });
    const mod = loadIndex(db, SECRETS);
    const realFetch = global.fetch; const stub = fireStub(); global.fetch = stub;
    try { await click(mod, "p1", ["B", "C"]); } finally { global.fetch = realFetch; }
    assert.deepStrictEqual(stub.calls, []);
    const r = db.__state.projects.p1.notifyRoutine;
    assert.strictEqual(r.status, "error");
    assert.strictEqual(r.errorMessage, 'Nothing started. 2 held: they need "Roles page", which was not sent.');
  });

  await test("Ready for Dev: a same-lane ticket is queued, and a fired ticket's prompt names the dependency already landed", async () => {
    const db = makeFakeDb({
      backlogItems: {
        L: t("L", { title: "Landed one", status: "ready-for-testing", deployCommit: "feedfacefeedface0000" }),
        A: t("A", { groomAreas: ["faq"], dependsOnItemIds: ["L"], createdAt: "2026-11-01T00:00:00Z" }),
        B: t("B", { groomAreas: ["faq"], createdAt: "2026-11-02T00:00:00Z" }),
      },
      projects: { p1: { name: "Backlog Tracker & FAQs" } },
    });
    const mod = loadIndex(db, SECRETS);
    const realFetch = global.fetch; const stub = fireStub(); global.fetch = stub;
    try { await click(mod, "p1", ["A", "B"]); } finally { global.fetch = realFetch; }
    assert.deepStrictEqual(stub.ids(), ["A"]);
    assert.ok(stub.calls[0].includes("Already landed and in your base") && stub.calls[0].includes("- L: Landed one (ready-for-testing, commit feedfacefeed)"));
    const B = db.__state.backlogItems.B;
    assert.strictEqual(B.queuedAfter.itemId, "A");
    assert.ok(!B.blocked, "queued is not blocked: no Answer button");
  });

  // ── Through the real intake trigger ──────────────────────────────────────
  async function intake(db, mod, id, before) {
    const ref = db.__ref("backlogItems", id);
    const after = db.__state.backlogItems[id];
    return mod.__test.runDependencyIntake({ params: { itemId: id }, data: { before: before ? { data: () => before } : undefined, after: { data: () => after, ref } } }, db);
  }

  await test("intake: B's Dependencies naming A's title stores dependsOnItemIds [A] with source intake", async () => {
    const db = makeFakeDb({ backlogItems: {
      AAAAAAAAAAAAAAAAAAA1: t("AAAAAAAAAAAAAAAAAAA1", { title: "Flow 1/9: train tests stop failing" }),
      Bbbbbbbbbbbbbbbbbbb2: t("Bbbbbbbbbbbbbbbbbbb2", { desc: desc({ deps: 'Build after "Flow 1/9: train tests stop failing" and after ZZZZZZZZZZZZZZZZZZZ9 (no such ticket).' }) }),
    } });
    const mod = loadIndex(db, SECRETS);
    const upd = await intake(db, mod, "Bbbbbbbbbbbbbbbbbbb2", null);
    assert.deepStrictEqual(upd, { dependsOnItemIds: ["AAAAAAAAAAAAAAAAAAA1"], dependsOnSource: "intake" }, "an id that names no ticket stays prose");
    // Idempotent: the trigger's own write changes nothing more.
    const before = { ...db.__state.backlogItems.Bbbbbbbbbbbbbbbbbbb2, dependsOnItemIds: undefined, dependsOnSource: undefined };
    assert.strictEqual(await intake(db, mod, "Bbbbbbbbbbbbbbbbbbb2", before), null);
  });

  await test("intake: a build session's list is merged, and a person's picker edit is marked manual", async () => {
    const db = makeFakeDb({ backlogItems: {
      A0000000000000000000: t("A0000000000000000000", { title: "Ticket A is the first one" }),
      B0000000000000000000: t("B0000000000000000000", { dependsOnItemIds: ["X0000000000000000000"], dependsOnSource: "build", desc: desc({ deps: "Ticket A is the first one" }) }),
      X0000000000000000000: t("X0000000000000000000"),
    } });
    const mod = loadIndex(db, SECRETS);
    const before = { ...db.__state.backlogItems.B0000000000000000000, desc: "old" };
    const upd = await intake(db, mod, "B0000000000000000000", before);
    assert.deepStrictEqual(upd, { dependsOnItemIds: ["X0000000000000000000", "A0000000000000000000"], dependsOnSource: "build" });
    // A person removes one in Edit item (desc unchanged): the list becomes theirs.
    const cur = db.__state.backlogItems.B0000000000000000000;
    db.__state.backlogItems.B0000000000000000000 = { ...cur, dependsOnItemIds: ["A0000000000000000000"], dependsOnSource: "intake" };
    const upd2 = await intake(db, mod, "B0000000000000000000", { ...cur, dependsOnSource: "intake" });
    assert.deepStrictEqual(upd2, { dependsOnSource: "manual" });
  });

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) process.exit(1);
})();
