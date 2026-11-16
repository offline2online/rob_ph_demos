// Agent tickets fire under their owner's own Claude account only
// (xFzQgynkoMdV33iWJFZq). Drives functions/owner-firing.js directly, then the
// REAL functions/index.js Ready for Dev / Deploy to Main / Groom Backlog
// handlers and the console's /mcp/me/routine-binding endpoint under stubbed
// Firebase SDKs with a fake fire endpoint (same approach as
// notify-fanout.test.js): no emulator, credentials or network.
//
// Run with:  node test/owner-firing.test.js
"use strict";
const assert = require("assert");
const Module = require("module");
process.env.FIRE_SPACING_MS = "0";

const of = require("../functions/owner-firing");

const OWNER = "owner@example.com";
const OTHER = "other@example.com";
const OWNER_URL = "https://api.anthropic.com/v1/owner/fire";
const SHARED_URL = "https://api.anthropic.com/v1/shared/fire";
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
  let auto = 0;
  function docRef(collection, id) {
    return {
      id,
      async get() {
        const raw = state[collection] && state[collection][id];
        return { exists: raw !== undefined, id, data: () => raw };
      },
      async set(data, opts) {
        writes.push({ collection, id, data, opts });
        state[collection] = state[collection] || {};
        state[collection][id] = opts && opts.merge ? deepMerge(state[collection][id] || {}, data) : data;
      },
      async delete() { writes.push({ collection, id, deleted: true }); if (state[collection]) delete state[collection][id]; },
      async update(data) { return this.set(data, { merge: true }); },
    };
  }
  function query(name, filters) {
    return {
      where: (f, op, v) => query(name, filters.concat([[f, op, v]])),
      async get() {
        const docs = Object.entries(state[name] || {})
          .filter(([, d]) => filters.every(([f, op, v]) => op === "==" && d[f] === v))
          .map(([id, d]) => ({ id, data: () => d }));
        return { docs };
      },
    };
  }
  return {
    collection: (name) => ({
      doc: (id) => docRef(name, id),
      where: (f, op, v) => query(name, [[f, op, v]]),
      async get() { return query(name, []).get().then(({ docs }) => ({ docs, forEach: (fn) => docs.forEach(fn), size: docs.length, empty: !docs.length })); },
      async add(data) { const id = `auto${++auto}`; await docRef(name, id).set(data); return { id }; },
    }),
    async getAll(...refs) { return Promise.all(refs.map((r) => r.get())); },
    batch() {
      const ops = [];
      return {
        update(ref, data) { ops.push(() => ref.set(data, { merge: true })); },
        delete(ref) { ops.push(() => ref.delete()); },
        async commit() { for (const op of ops) await op(); },
      };
    },
    __state: state, __writes: writes,
  };
}

function loadIndex(db, secrets, { idTokenEmail = null } = {}) {
  const stubs = {
    "firebase-functions/v2/firestore": { onDocumentUpdated: (o, h) => h, onDocumentWritten: (o, h) => h },
    "firebase-functions/params": { defineSecret: (name) => ({ value: () => secrets[name] || "" }) },
    "firebase-functions/logger": { info() {}, warn() {}, error() {}, debug() {} },
    "firebase-admin/app": { initializeApp: () => ({}) },
    "firebase-admin/firestore": {
      getFirestore: () => db,
      FieldValue: { serverTimestamp: () => ({ __sentinel: "serverTimestamp" }), arrayUnion: (...items) => ({ items }), delete: () => DELETE },
    },
    "firebase-admin/auth": { getAuth: () => ({ verifyIdToken: async (t) => { if (!idTokenEmail || t !== "good") throw new Error("bad token"); return { email: idTokenEmail, uid: "u1" }; } }) },
    "firebase-functions/v2/https": { onRequest: (o, h) => h },
    "google-auth-library": { GoogleAuth: class {} },
  };
  const originalLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (Object.prototype.hasOwnProperty.call(stubs, request)) return stubs[request];
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    for (const p of ["../functions/index.js", "../functions/mcp-server.js"]) delete require.cache[require.resolve(p)];
    const index = require("../functions/index.js");
    const mcp = require("../functions/mcp-server.js");
    return { index, mcp };
  } finally {
    Module._load = originalLoad;
  }
}

const ts = (ms) => ({ toMillis: () => ms, toDate: () => new Date(ms) });
const PID = "proj1";
const SECRETS = { CLAUDE_ROUTINE_FIRE_URL: SHARED_URL, CLAUDE_ROUTINE_TOKEN: "shared-token" };

function seed({ ownerBound = true, deployItems = null, extraItems = {} } = {}) {
  return {
    backlogItems: deployItems || {
      mine: { projectId: PID, status: "backlog", type: "feature", title: "Owner's agent ticket", desc: "Do it", ownerEmail: OWNER },
      plain: { projectId: PID, status: "backlog", type: "feature", title: "Plain ticket", desc: "Do that" },
      ...extraItems,
    },
    projects: { [PID]: { name: "Project" } },
    routineBindings: ownerBound ? { [OWNER]: { email: OWNER, fireUrl: OWNER_URL, token: "owner-token" } } : {},
    consoleUsers: { [OWNER]: { role: "editor" }, [OTHER]: { role: "editor" } },
  };
}

function fireStub() {
  const calls = [];
  let n = 0;
  const fn = async (url, opts) => {
    const body = JSON.parse(opts.body || "{}");
    calls.push({ url, auth: opts.headers && opts.headers.Authorization, text: body.text || "" });
    n++;
    return { ok: true, json: async () => ({ claude_code_session_id: `session_${n}` }), text: async () => "" };
  };
  fn.calls = calls;
  return fn;
}

async function withFetch(fn) {
  const real = global.fetch; const stub = fireStub(); global.fetch = stub;
  try { await fn(); } finally { global.fetch = real; }
  return stub;
}

function updated(handler, after, before = { name: "Project" }) {
  return handler({ params: { projectId: PID }, data: { before: { data: () => before }, after: { data: () => after } } });
}

let passed = 0; const failures = [];
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ok  ${name}`); }
  catch (err) { failures.push(name); console.log(`FAIL  ${name}\n      ${err && err.stack || err}`); }
}

(async () => {
  // ── The pure planner ───────────────────────────────────────────────────────
  await test("ticketOwner lowercases and ignores anything that isn't an email", () => {
    assert.strictEqual(of.ticketOwner({ ownerEmail: " Owner@Example.com " }), OWNER);
    assert.strictEqual(of.ticketOwner({ ownerEmail: "" }), null);
    assert.strictEqual(of.ticketOwner({ ownerEmail: "nobody" }), null);
    assert.strictEqual(of.ticketOwner({}), null);
  });

  await test("a build request is automatic only when notifyAutomationAt equals notifyRequestedAt", () => {
    const at = Date.parse("2026-11-15T10:00:00Z");
    assert.strictEqual(of.isAutomaticBuildRequest({ notifyRequestedAt: ts(at), notifyAutomationAt: ts(at) }), true);
    assert.strictEqual(of.isAutomaticBuildRequest({ notifyRequestedAt: ts(at + 5000), notifyAutomationAt: ts(at) }), false, "a person's later click is not automatic");
    assert.strictEqual(of.isAutomaticBuildRequest({ notifyRequestedAt: ts(at) }), false);
    assert.strictEqual(of.isAutomaticBuildRequest({ notifyRequestedAt: new Date(at), notifyAutomationAt: new Date(at) }), true, "Dates from the REST write compare too");
  });

  await test("planOwnedBuild: owner's own click, someone else's named or swept-up click, and automation", () => {
    const items = [{ id: "m", ownerEmail: OWNER }, { id: "p" }];
    let plan = of.planOwnedBuild(items, { requesterEmail: "OWNER@example.com" });
    assert.deepStrictEqual(plan.shared.map((i) => i.id), ["p"]);
    assert.deepStrictEqual(plan.byOwner[OWNER].map((i) => i.id), ["m"]);
    plan = of.planOwnedBuild(items, { requesterEmail: OTHER, named: (id) => id === "m" });
    assert.deepStrictEqual(plan.refused.map((r) => [r.item.id, r.reason]), [["m", "not-owner"]]);
    plan = of.planOwnedBuild(items, { requesterEmail: OTHER });
    assert.deepStrictEqual(plan.skipped.map((i) => i.id), ["m"], "swept up by a whole-column click: skipped quietly");
    plan = of.planOwnedBuild(items, { requesterEmail: null, named: () => true });
    assert.deepStrictEqual(plan.refused.map((r) => r.item.id), ["m"], "no named requester is not the owner");
    plan = of.planOwnedBuild(items, { requesterEmail: OTHER, automatic: true });
    assert.deepStrictEqual(plan.byOwner[OWNER].map((i) => i.id), ["m"], "the pipeline's own rebuild fires the owner's binding");
    const unbound = of.refuseUnboundOwners(of.planOwnedBuild(items, { requesterEmail: OWNER }), () => false);
    assert.deepStrictEqual(unbound.refused.map((r) => r.reason), ["no-binding"]);
    assert.deepStrictEqual(unbound.byOwner, {});
  });

  await test("planOwnedDeploy: owner only, one owner per train", () => {
    assert.deepStrictEqual(of.planOwnedDeploy([{ id: "a" }], { requesterEmail: OTHER }), { mode: "shared" });
    assert.deepStrictEqual(of.planOwnedDeploy([{ ownerEmail: OWNER }, { id: "b" }], { requesterEmail: OWNER }), { mode: "owner", owner: OWNER });
    assert.strictEqual(of.planOwnedDeploy([{ ownerEmail: OWNER }], { requesterEmail: OTHER }).mode, "refused");
    assert.strictEqual(of.planOwnedDeploy([{ ownerEmail: OWNER }], {}).mode, "refused");
    const mixed = of.planOwnedDeploy([{ ownerEmail: OWNER }, { ownerEmail: OTHER }], { requesterEmail: OWNER });
    assert.strictEqual(mixed.mode, "refused");
    assert.match(mixed.message, /2 different people/);
  });

  await test("planOwnedGroom keeps untagged tickets and the clicker's own", () => {
    const g = of.planOwnedGroom([{ id: "m", ownerEmail: OWNER }, { id: "o", ownerEmail: OTHER }, { id: "p" }], { requesterEmail: OWNER });
    assert.deepStrictEqual(g.keep.map((i) => i.id), ["m", "p"]);
    assert.deepStrictEqual(g.excluded.map((i) => i.id), ["o"]);
    assert.deepStrictEqual(g.ownOwned.map((i) => i.id), ["m"]);
  });

  // ── Ready for Dev (notifyOnProjectReadyForReview) ──────────────────────────
  await test("owner with a binding: their agent ticket fires on THEIR Routine, the plain ticket on the shared one", async () => {
    const db = makeFakeDb(seed());
    const { index } = loadIndex(db, SECRETS);
    const stub = await withFetch(() => updated(index.notifyOnProjectReadyForReview, { name: "Project", notifyRequestedAt: ts(Date.now()), notifyRequestedByEmail: OWNER }));
    const mine = stub.calls.find((c) => c.text.includes("(ticket mine)"));
    const plain = stub.calls.find((c) => c.text.includes("(ticket plain)"));
    assert.ok(mine && plain, "both fired");
    assert.strictEqual(mine.url, OWNER_URL);
    assert.strictEqual(mine.auth, "Bearer owner-token");
    // The plain ticket follows the old rule: the clicker's own binding.
    assert.strictEqual(plain.url, OWNER_URL);
    assert.strictEqual(db.__state.backlogItems.mine.lastFire.status, "started");
  });

  await test("someone else's click: the plain ticket fires on the shared Routine, the agent ticket is left alone", async () => {
    const db = makeFakeDb(seed());
    const { index } = loadIndex(db, SECRETS);
    const stub = await withFetch(() => updated(index.notifyOnProjectReadyForReview, { name: "Project", notifyRequestedAt: ts(Date.now()), notifyRequestedByEmail: OTHER }));
    assert.strictEqual(stub.calls.length, 1);
    assert.ok(stub.calls[0].text.includes("(ticket plain)"));
    assert.strictEqual(stub.calls[0].url, SHARED_URL);
    assert.strictEqual(db.__state.backlogItems.mine.lastFire, undefined, "swept up, not named: no mark on the card");
  });

  await test("someone else naming the owner's ticket is refused, on the card and the project, and nothing fires", async () => {
    const db = makeFakeDb(seed());
    const { index } = loadIndex(db, SECRETS);
    const stub = await withFetch(() => updated(index.notifyOnProjectReadyForReview, { name: "Project", notifyRequestedAt: ts(Date.now()), notifyRequestedByEmail: OTHER, notifyItemIds: ["mine"] }));
    assert.strictEqual(stub.calls.length, 0, "no fire at all — not even on the shared token");
    const lf = db.__state.backlogItems.mine.lastFire;
    assert.strictEqual(lf.status, "refused");
    assert.strictEqual(lf.reason, "not-owner");
    assert.match(db.__state.projects[PID].notifyRoutine.errorMessage, /Only owner@example\.com can start/);
  });

  await test("a refused named fire also leaves a note on the card's comment thread (ZmEWDC40NYOiojehfPjk)", async () => {
    const db = makeFakeDb(seed());
    const { index } = loadIndex(db, SECRETS);
    await withFetch(() => updated(index.notifyOnProjectReadyForReview, { name: "Project", notifyRequestedAt: ts(Date.now()), notifyRequestedByEmail: OTHER, notifyItemIds: ["mine"] }));
    const notes = db.__state.backlogItems.mine.notes;
    assert.ok(notes && Array.isArray(notes.items), "appended with arrayUnion, never replacing the thread");
    assert.match(notes.items[0].text, /^Not built: Only owner@example\.com can start this agent ticket/);
    assert.strictEqual(notes.items[0].author, "backlog-automation");
  });

  await test("an admin's send_to_build-shaped request for someone else's ticket is refused the same way", async () => {
    const db = makeFakeDb(seed());
    const { index } = loadIndex(db, SECRETS);
    const stub = await withFetch(() => updated(index.notifyOnProjectReadyForReview, { name: "Project", notifyRequestedAt: ts(Date.now()), notifyRequestedByEmail: "admin@example.com", notifyItemIds: ["mine", "plain"] }));
    assert.deepStrictEqual(stub.calls.map((c) => c.url), [SHARED_URL]);
    assert.strictEqual(db.__state.backlogItems.mine.lastFire.reason, "not-owner");
    assert.match(db.__state.projects[PID].notifyRoutine.errorMessage, /Only owner@example\.com/);
  });

  await test("owner WITHOUT a binding: nothing fires for the agent ticket — no shared-token fallback", async () => {
    const db = makeFakeDb(seed({ ownerBound: false }));
    const { index } = loadIndex(db, SECRETS);
    const stub = await withFetch(() => updated(index.notifyOnProjectReadyForReview, { name: "Project", notifyRequestedAt: ts(Date.now()), notifyRequestedByEmail: OWNER, notifyItemIds: ["mine"] }));
    assert.strictEqual(stub.calls.length, 0);
    assert.strictEqual(db.__state.backlogItems.mine.lastFire.reason, "no-binding");
    assert.match(db.__state.projects[PID].notifyRoutine.errorMessage, /My Claude Routine/);
  });

  await test("a binding pointing anywhere but api.anthropic.com counts as no binding", async () => {
    const s = seed();
    s.routineBindings[OWNER].fireUrl = "https://evil.example.com/fire";
    const db = makeFakeDb(s);
    const { index } = loadIndex(db, SECRETS);
    const stub = await withFetch(() => updated(index.notifyOnProjectReadyForReview, { name: "Project", notifyRequestedAt: ts(Date.now()), notifyRequestedByEmail: OWNER, notifyItemIds: ["mine"] }));
    assert.strictEqual(stub.calls.length, 0);
    assert.strictEqual(db.__state.backlogItems.mine.lastFire.reason, "no-binding");
  });

  await test("the pipeline's automatic rebuild fires the owner's Routine whoever clicked last", async () => {
    const db = makeFakeDb(seed());
    const { index } = loadIndex(db, SECRETS);
    const at = Date.now();
    const stub = await withFetch(() => updated(index.notifyOnProjectReadyForReview, { name: "Project", notifyRequestedAt: ts(at), notifyAutomationAt: ts(at), notifyRequestedByEmail: OTHER, notifyItemIds: ["mine"] }));
    assert.strictEqual(stub.calls.length, 1);
    assert.strictEqual(stub.calls[0].url, OWNER_URL);
  });

  await test("a stale automation stamp does not make a later click automatic", async () => {
    const db = makeFakeDb(seed());
    const { index } = loadIndex(db, SECRETS);
    const at = Date.now();
    const stub = await withFetch(() => updated(index.notifyOnProjectReadyForReview, { name: "Project", notifyRequestedAt: ts(at + 60000), notifyAutomationAt: ts(at), notifyRequestedByEmail: OTHER, notifyItemIds: ["mine"] }));
    assert.strictEqual(stub.calls.length, 0);
  });

  await test("the owner's agent tickets still fire when no shared Routine is configured", async () => {
    const db = makeFakeDb(seed());
    const { index } = loadIndex(db, {});
    const stub = await withFetch(() => updated(index.notifyOnProjectReadyForReview, { name: "Project", notifyRequestedAt: ts(Date.now()), notifyRequestedByEmail: OTHER, notifyItemIds: ["plain"] }));
    assert.strictEqual(stub.calls.length, 0, "no shared Routine and no binding for the clicker: nothing for the plain ticket");
    const db2 = makeFakeDb(seed());
    const { index: index2 } = loadIndex(db2, {});
    const stub2 = await withFetch(() => updated(index2.notifyOnProjectReadyForReview, { name: "Project", notifyRequestedAt: ts(Date.now()), notifyRequestedByEmail: OWNER, notifyItemIds: ["mine"] }));
    assert.deepStrictEqual(stub2.calls.map((c) => c.url), [OWNER_URL]);
  });

  // ── Deploy to Main ─────────────────────────────────────────────────────────
  const trainItems = (owners) => Object.fromEntries(owners.map((o, n) => [`t${n}`, { projectId: PID, status: "ready-to-publish", type: "feature", title: `T${n}`, ...(o ? { ownerEmail: o } : {}) }]));

  await test("Deploy: the owner of the train's agent tickets deploys on their own Routine", async () => {
    const db = makeFakeDb(seed({ deployItems: trainItems([OWNER, null]) }));
    const { index } = loadIndex(db, SECRETS);
    const stub = await withFetch(() => updated(index.notifyOnProjectReadyToDeploy, { name: "Project", deployNotifyRequestedAt: ts(Date.now()), deployNotifyRequestedByEmail: OWNER }));
    const fires = stub.calls.filter((c) => c.url.startsWith("https://api.anthropic.com"));
    assert.deepStrictEqual(fires.map((c) => c.url), [OWNER_URL]);
    assert.strictEqual(db.__state.projects[PID].deployRoutine.status, "in-progress");
  });

  await test("Deploy: anyone else is refused and nothing fires", async () => {
    const db = makeFakeDb(seed({ deployItems: trainItems([OWNER]) }));
    const { index } = loadIndex(db, SECRETS);
    const stub = await withFetch(() => updated(index.notifyOnProjectReadyToDeploy, { name: "Project", deployNotifyRequestedAt: ts(Date.now()), deployNotifyRequestedByEmail: OTHER }));
    assert.strictEqual(stub.calls.length, 0);
    assert.strictEqual(db.__state.projects[PID].deployRoutine.status, "error");
    assert.match(db.__state.projects[PID].deployRoutine.errorMessage, /Only owner@example\.com can deploy/);
  });

  await test("Deploy: an owner with no binding is refused rather than using the shared token", async () => {
    const db = makeFakeDb(seed({ ownerBound: false, deployItems: trainItems([OWNER]) }));
    const { index } = loadIndex(db, SECRETS);
    const stub = await withFetch(() => updated(index.notifyOnProjectReadyToDeploy, { name: "Project", deployNotifyRequestedAt: ts(Date.now()), deployNotifyRequestedByEmail: OWNER }));
    assert.strictEqual(stub.calls.length, 0);
    assert.match(db.__state.projects[PID].deployRoutine.errorMessage, /no personal Claude Routine/);
  });

  await test("Deploy: a train mixing two owners' agent tickets is refused", async () => {
    const db = makeFakeDb(seed({ deployItems: trainItems([OWNER, OTHER]) }));
    const { index } = loadIndex(db, SECRETS);
    const stub = await withFetch(() => updated(index.notifyOnProjectReadyToDeploy, { name: "Project", deployNotifyRequestedAt: ts(Date.now()), deployNotifyRequestedByEmail: OWNER }));
    assert.strictEqual(stub.calls.length, 0);
    assert.match(db.__state.projects[PID].deployRoutine.errorMessage, /2 different people/);
  });

  await test("Deploy: a refused click is never merged by the automation's hand-over safety net", async () => {
    const db = makeFakeDb(seed({ deployItems: trainItems([OWNER]) }));
    const { index } = loadIndex(db, SECRETS);
    const clickedAt = Date.now() - 60 * 60 * 1000;
    await withFetch(() => updated(index.notifyOnProjectReadyToDeploy, { name: "Project", deployNotifyRequestedAt: ts(clickedAt), deployNotifyRequestedByEmail: OTHER }));
    const { trainHandoverReason } = require("../functions/train-lock");
    const project = { ...db.__state.projects[PID], deployNotifyRequestedAt: new Date(clickedAt).toISOString() };
    assert.strictEqual(trainHandoverReason(project, Date.now() + 60 * 60 * 1000), null, "an hour later the sweep still does not deploy it");
  });

  await test("Deploy: a train with no agent tickets deploys exactly as before", async () => {
    const db = makeFakeDb(seed({ deployItems: trainItems([null]) }));
    const { index } = loadIndex(db, SECRETS);
    const stub = await withFetch(() => updated(index.notifyOnProjectReadyToDeploy, { name: "Project", deployNotifyRequestedAt: ts(Date.now()), deployNotifyRequestedByEmail: OTHER }));
    assert.deepStrictEqual(stub.calls.filter((c) => c.url.startsWith("https://api.anthropic.com")).map((c) => c.url), [SHARED_URL]);
  });

  // ── Groom Backlog ──────────────────────────────────────────────────────────
  await test("Groom by someone else leaves the owner's agent ticket out of the session", async () => {
    const db = makeFakeDb(seed());
    const { index } = loadIndex(db, SECRETS);
    const stub = await withFetch(() => updated(index.notifyOnProjectReadyForGrooming, { name: "Project", groomRequestedAt: ts(Date.now()), groomRequestedByEmail: OTHER }));
    const fire = stub.calls.find((c) => c.url.startsWith("https://api.anthropic.com"));
    assert.strictEqual(fire.url, SHARED_URL);
    assert.ok(fire.text.includes("[id: plain]") && !fire.text.includes("[id: mine]"));
    assert.match(db.__state.projects[PID].groomRoutine.note, /owned by someone else left out/);
  });

  await test("Groom by the owner includes their agent ticket and runs on their Routine", async () => {
    const db = makeFakeDb(seed());
    const { index } = loadIndex(db, SECRETS);
    const stub = await withFetch(() => updated(index.notifyOnProjectReadyForGrooming, { name: "Project", groomRequestedAt: ts(Date.now()), groomRequestedByEmail: OWNER }));
    const fire = stub.calls.find((c) => c.url.startsWith("https://api.anthropic.com"));
    assert.strictEqual(fire.url, OWNER_URL);
    assert.ok(fire.text.includes("[id: mine]"));
  });

  await test("Groom by an owner with no binding leaves their agent ticket out and says why", async () => {
    const db = makeFakeDb(seed({ ownerBound: false }));
    const { index } = loadIndex(db, SECRETS);
    const stub = await withFetch(() => updated(index.notifyOnProjectReadyForGrooming, { name: "Project", groomRequestedAt: ts(Date.now()), groomRequestedByEmail: OWNER }));
    const fire = stub.calls.find((c) => c.url.startsWith("https://api.anthropic.com"));
    assert.strictEqual(fire.url, SHARED_URL);
    assert.ok(!fire.text.includes("[id: mine]"));
    assert.match(db.__state.projects[PID].groomRoutine.note, /My Claude Routine/);
  });

  await test("Groom with nothing the clicker may groom fires nothing", async () => {
    const db = makeFakeDb(seed({ extraItems: {} }));
    delete db.__state.backlogItems.plain;
    const { index } = loadIndex(db, SECRETS);
    const stub = await withFetch(() => updated(index.notifyOnProjectReadyForGrooming, { name: "Project", groomRequestedAt: ts(Date.now()), groomRequestedByEmail: OTHER }));
    assert.strictEqual(stub.calls.length, 0);
    assert.strictEqual(db.__state.projects[PID].groomRoutine.status, "error");
  });

  // ── The automation's own rebuild request carries the stamp ─────────────────
  await test("run-backlog-automation's build request stamps notifyAutomationAt with the same instant", () => {
    const auto = require("../scripts/run-backlog-automation.js");
    const f = auto.buildRequestFields({ notifyRequestedByEmail: OTHER }, ["x"]);
    assert.ok(f.notifyAutomationAt instanceof Date);
    assert.strictEqual(f.notifyAutomationAt.getTime(), f.notifyRequestedAt.getTime());
    assert.strictEqual(of.isAutomaticBuildRequest(f), true);
  });

  // ── Settings → My Claude Routine: /mcp/me/routine-binding ─────────────────
  function fakeRes() {
    const r = { statusCode: 0, body: null, headers: {} };
    r.status = (c) => { r.statusCode = c; return r; };
    r.json = (b) => { r.body = b; return r; };
    r.set = (k, v) => { r.headers[k] = v; return r; };
    r.send = (b) => { r.body = b; return r; };
    return r;
  }
  function fakeReq(method, body, token = "good") {
    return { method, body, path: "/me/routine-binding", ip: `10.0.0.${Math.floor(Math.random() * 200)}`, headers: {}, get: (h) => (h.toLowerCase() === "x-firebase-id-token" ? token : "") };
  }

  await test("routineBindingError: Anthropic host only, both values or neither", () => {
    const { mcp } = loadIndex(makeFakeDb(seed()), SECRETS);
    const err = mcp.__test.routineBindingError;
    assert.strictEqual(err("", ""), null, "both empty clears");
    assert.match(err(OWNER_URL, ""), /both/);
    assert.match(err("http://api.anthropic.com/x", "tokentoken"), /https/);
    assert.match(err("https://example.com/fire", "tokentoken"), /api\.anthropic\.com/);
    assert.match(err(OWNER_URL, "short"), /real token/);
    assert.strictEqual(err(OWNER_URL, "tokentoken"), null);
    assert.ok(mcp.__test.routineBootstrapPrompt().includes("ROUTINE_INSTRUCTIONS.md"));
  });

  await test("console endpoint: GET says only whether a binding exists, never the URL or token", async () => {
    const db = makeFakeDb(seed());
    const { mcp } = loadIndex(db, SECRETS, { idTokenEmail: OWNER });
    const res = fakeRes();
    await mcp.__test.handleMyRoutineBinding(fakeReq("GET"), res);
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.hasRoutineBinding, true);
    assert.ok(res.body.bootstrapPrompt.includes("ROUTINE_INSTRUCTIONS.md"));
    const raw = JSON.stringify(res.body);
    assert.ok(!raw.includes("owner-token") && !raw.includes(OWNER_URL), "write-only");
  });

  await test("console endpoint: POST saves the caller's own binding, validates it, and clears it", async () => {
    const db = makeFakeDb(seed({ ownerBound: false }));
    const { mcp } = loadIndex(db, SECRETS, { idTokenEmail: OTHER });
    let res = fakeRes();
    await mcp.__test.handleMyRoutineBinding(fakeReq("POST", { fireUrl: "https://example.com/fire", token: "tokentoken" }), res);
    assert.strictEqual(res.statusCode, 400);
    assert.strictEqual(db.__state.routineBindings[OTHER], undefined);
    res = fakeRes();
    await mcp.__test.handleMyRoutineBinding(fakeReq("POST", { fireUrl: OWNER_URL, token: "tokentoken", email: OWNER }), res);
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.registered, true);
    assert.strictEqual(db.__state.routineBindings[OTHER].fireUrl, OWNER_URL, "written under the signed-in member, whatever the body says");
    assert.strictEqual(db.__state.routineBindings[OWNER], undefined);
    assert.ok(!JSON.stringify(res.body).includes("tokentoken"));
    res = fakeRes();
    await mcp.__test.handleMyRoutineBinding(fakeReq("POST", { fireUrl: "", token: "" }), res);
    assert.strictEqual(res.body.cleared, true);
    assert.strictEqual(db.__state.routineBindings[OTHER], undefined);
  });

  await test("console endpoint: no sign-in, a non-member or a viewer can't write", async () => {
    let db = makeFakeDb(seed());
    let { mcp } = loadIndex(db, SECRETS, { idTokenEmail: OWNER });
    let res = fakeRes();
    await mcp.__test.handleMyRoutineBinding(fakeReq("POST", { fireUrl: OWNER_URL, token: "tokentoken" }, ""), res);
    assert.strictEqual(res.statusCode, 401);
    db = makeFakeDb(seed());
    ({ mcp } = loadIndex(db, SECRETS, { idTokenEmail: "stranger@example.com" }));
    res = fakeRes();
    await mcp.__test.handleMyRoutineBinding(fakeReq("POST", { fireUrl: OWNER_URL, token: "tokentoken" }), res);
    assert.strictEqual(res.statusCode, 403);
    const s = seed(); s.consoleUsers["viewer@example.com"] = { role: "viewer" };
    db = makeFakeDb(s);
    ({ mcp } = loadIndex(db, SECRETS, { idTokenEmail: "viewer@example.com" }));
    res = fakeRes();
    await mcp.__test.handleMyRoutineBinding(fakeReq("POST", { fireUrl: OWNER_URL, token: "tokentoken" }), res);
    assert.strictEqual(res.statusCode, 403);
  });

  await test("a flagged ticket's build fire carries the upstream contract change (ZmEWDC40NYOiojehfPjk)", async () => {
    const db = makeFakeDb(seed({ extraItems: { flagged: { projectId: PID, status: "backlog", type: "feature", title: "Front end", desc: "Builds after the back end", dependsOnItemIds: ["gone"],
      contractReview: { status: "needs-review", upstreamItemId: "up1", upstreamTitle: "Back end", commit: "c".repeat(40), files: ["shared/interface-contract.md"], summary: "shared/interface-contract.md (+1 −0; sections: Attribute envelope)" } } } }));
    const { index } = loadIndex(db, SECRETS);
    const stub = await withFetch(() => updated(index.notifyOnProjectReadyForReview, { name: "Project", notifyRequestedAt: ts(Date.now()), notifyRequestedByEmail: OTHER, notifyItemIds: ["flagged", "plain"] }));
    const flaggedFire = stub.calls.find((c) => c.text.includes("ticket flagged)"));
    assert.ok(flaggedFire, "the flagged ticket fired");
    assert.match(flaggedFire.text, /=== UPSTREAM CONTRACT CHANGED: REVIEW THIS TICKET ===[\s\S]*Attribute envelope[\s\S]*=== END UPSTREAM CONTRACT CHANGED ===/);
    const plainFire = stub.calls.find((c) => c.text.includes("ticket plain)"));
    assert.ok(plainFire && !plainFire.text.includes("UPSTREAM CONTRACT CHANGED"), "an unflagged ticket's fire has no block");
  });

  // ── Owner scoping over MCP (ZmEWDC40NYOiojehfPjk) ─────────────────────────
  await test("ownerEditRefusal: another member's agent ticket is refused naming its owner; your own and untagged ones are not", () => {
    assert.strictEqual(of.ownerEditRefusal({ ownerEmail: OWNER }, OWNER), null);
    assert.strictEqual(of.ownerEditRefusal({ ownerEmail: OWNER }, " Owner@Example.com "), null, "case and spaces don't matter");
    assert.strictEqual(of.ownerEditRefusal({}, OTHER), null, "an untagged ticket stays open to every editor");
    assert.match(of.ownerEditRefusal({ ownerEmail: OWNER }, OTHER, "edit"), /^This is owner@example\.com's agent ticket: only owner@example\.com's own agent can edit it/);
    assert.match(of.ownerEditRefusal({ ownerEmail: OWNER }, OTHER), /add_item_comment/, "it says how to tell the owner instead");
  });

  const SESSION = (email, role = "editor") => ({ email, role, clientId: "c1" });
  const toolNamed = (mcp, name) => mcp.__test.TOOLS.find((t) => t.name === name);
  const isErr = (r) => !!(r && r.isError);
  const textOf = (r) => (r && r.content && r.content[0] && r.content[0].text) || "";

  await test("MCP: another member's agent reads the owner's ticket in full, ownerEmail included", async () => {
    const db = makeFakeDb(seed());
    const { mcp } = loadIndex(db, SECRETS);
    const got = await toolNamed(mcp, "get_backlog_item").run({ itemId: "mine" }, SESSION(OTHER));
    assert.ok(!isErr(got), textOf(got));
    const d = JSON.parse(textOf(got));
    assert.strictEqual(d.desc, "Do it");
    assert.strictEqual(d.ownerEmail, OWNER);
    assert.strictEqual(d.contractReview, null);
    const plain = JSON.parse(textOf(await toolNamed(mcp, "get_backlog_item").run({ itemId: "plain" }, SESSION(OTHER))));
    assert.strictEqual(plain.ownerEmail, null);
  });

  await test("MCP: update_backlog_item on another member's agent ticket is refused naming the owner, and nothing changes", async () => {
    const db = makeFakeDb(seed());
    const { mcp } = loadIndex(db, SECRETS);
    const r = await toolNamed(mcp, "update_backlog_item").run({ itemId: "mine", title: "Hijacked" }, SESSION(OTHER));
    assert.ok(isErr(r));
    assert.match(textOf(r), /owner@example\.com's agent ticket/);
    assert.strictEqual(db.__state.backlogItems.mine.title, "Owner's agent ticket");
    const admin = await toolNamed(mcp, "update_backlog_item").run({ itemId: "mine", desc: "Rewritten" }, SESSION(OTHER, "admin"));
    assert.ok(isErr(admin), "an admin's agent is one owner's session too");
    assert.strictEqual(db.__state.backlogItems.mine.desc, "Do it");
    const own = await toolNamed(mcp, "update_backlog_item").run({ itemId: "mine", title: "Clearer title" }, SESSION(OWNER));
    assert.ok(!isErr(own), textOf(own));
    assert.strictEqual(db.__state.backlogItems.mine.title, "Clearer title");
    const shared = await toolNamed(mcp, "update_backlog_item").run({ itemId: "plain", title: "Shared ticket" }, SESSION(OTHER));
    assert.ok(!isErr(shared), "an untagged ticket is still anyone's to correct");
    const release = await toolNamed(mcp, "update_backlog_item").run({ itemId: "mine", ownedByMe: false }, SESSION(OTHER, "admin"));
    assert.ok(!isErr(release), "an admin may still release someone's agent ticket");
    assert.strictEqual(db.__state.backlogItems.mine.ownerEmail, null);
  });

  await test("MCP: archive, delete and set_blocked refuse another member's agent ticket; commenting stays open", async () => {
    const db = makeFakeDb(seed());
    const { mcp } = loadIndex(db, SECRETS);
    for (const name of ["archive_backlog_items", "delete_backlog_items"]) {
      const r = await toolNamed(mcp, name).run({ itemIds: ["plain", "mine"] }, SESSION(OTHER));
      assert.ok(isErr(r), name);
      assert.match(textOf(r), /mine: This is owner@example\.com's agent ticket/, name);
    }
    assert.strictEqual(db.__state.backlogItems.mine.status, "backlog", "the whole call was refused");
    assert.strictEqual(db.__state.backlogItems.plain.status, "backlog");
    const b = await toolNamed(mcp, "set_blocked").run({ itemId: "mine", reason: "needs-decision", note: "Stop" }, SESSION(OTHER));
    assert.ok(isErr(b));
    assert.strictEqual(db.__state.backlogItems.mine.blocked, undefined);
    const c = await toolNamed(mcp, "add_item_comment").run({ itemId: "mine", text: "Heads up: my contract change affects this." }, SESSION(OTHER));
    assert.ok(!isErr(c), "a comment is how one owner tells another");
    const own = await toolNamed(mcp, "archive_backlog_items").run({ itemIds: ["mine"] }, SESSION(OWNER));
    assert.ok(!isErr(own), textOf(own));
    assert.strictEqual(db.__state.backlogItems.mine.status, "archived");
  });

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) process.exit(1);
})();
