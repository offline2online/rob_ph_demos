// One Notify Claude click → one Routine session PER TICKET, in parallel
// (4 Oct 2026). Drives the REAL functions/index.js notifyOnProjectReadyForReview
// handler under stubbed Firebase SDKs (same approach as
// routine-binding-trigger.test.js) with a fake fire endpoint, so no emulator,
// credentials or network.
//
// Why: a click used to start ONE session holding every selected ticket; it
// built one of eight Display Types tickets and parked the rest. And the
// prompt carried no comments, so a decision recorded on a card never
// reached the session.
//
// Run with:  node test/notify-fanout.test.js
"use strict";
const assert = require("assert");
const Module = require("module");
// The real spacing between fires is for the live endpoint; the stub needs none.
process.env.FIRE_SPACING_MS = "0";

function makeFakeDb(seed) {
  const state = JSON.parse(JSON.stringify(seed));
  const writes = [];
  function docRef(collection, id) {
    return {
      async get() {
        const raw = state[collection] && state[collection][id];
        return { exists: raw !== undefined, data: () => raw };
      },
      async set(data, opts) {
        writes.push({ collection, id, data, opts });
        state[collection] = state[collection] || {};
        state[collection][id] = opts && opts.merge ? { ...(state[collection][id] || {}), ...data } : data;
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
        return { docs };
      },
    };
  }
  return {
    collection: (name) => ({ doc: (id) => docRef(name, id), where: (f, op, v) => query(name, [[f, op, v]]) }),
    __state: state, __writes: writes,
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
      FieldValue: { serverTimestamp: () => ({}), arrayUnion: (...items) => ({ items }) },
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
    for (const p of ["../functions/index.js", "../functions/mcp-server.js"]) delete require.cache[require.resolve(p)];
    return require("../functions/index.js");
  } finally {
    Module._load = originalLoad;
  }
}

const ts = (ms) => ({ toMillis: () => ms, toDate: () => new Date(ms) });
const PID = "proj1";
function seed() {
  return {
    backlogItems: {
      a: { projectId: PID, status: "backlog", type: "feature", title: "Ticket A", desc: "Do A",
        notes: [{ author: "rob@offline2online.com", text: "DECIDED: the automated score wins.", at: "2026-10-03T23:32:02Z" }] },
      b: { projectId: PID, status: "backlog", type: "bug", title: "Ticket B", desc: "Fix B" },
      c: { projectId: PID, status: "backlog", type: "feature", title: "Ticket C", desc: "Do C" },
      blocked: { projectId: PID, status: "backlog", type: "feature", title: "Blocked", desc: "x", blocked: { reason: "needs-decision" } },
      other: { projectId: "elsewhere", status: "backlog", type: "feature", title: "Other project", desc: "x" },
    },
    projects: { [PID]: { name: "Display Types" } },
  };
}

let passed = 0; const failures = [];
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ok  ${name}`); }
  catch (err) { failures.push(name); console.log(`FAIL  ${name}\n      ${err && err.stack || err}`); }
}

function fireStub({ failFor = [] } = {}) {
  const calls = [];
  let inFlight = 0, maxInFlight = 0, n = 0;
  const fn = async (url, opts) => {
    const text = JSON.parse(opts.body).text;
    calls.push(text);
    inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((r) => setTimeout(r, 5));
    inFlight--;
    if (failFor.some((id) => text.includes(`(ticket ${id})`))) return { ok: false, status: 429, text: async () => "slow down" };
    n++;
    return { ok: true, json: async () => ({ claude_code_session_id: `session_${n}` }) };
  };
  fn.calls = calls; fn.max = () => maxInFlight;
  return fn;
}

async function click(db, mod, extra = {}) {
  const before = { name: "Display Types" };
  const after = { name: "Display Types", notifyRequestedAt: ts(Date.now()), ...extra };
  await mod.notifyOnProjectReadyForReview({ params: { projectId: PID }, data: { before: { data: () => before }, after: { data: () => after } } });
}

(async () => {
  const secrets = { CLAUDE_ROUTINE_FIRE_URL: "https://api.anthropic.com/v1/fire", CLAUDE_ROUTINE_TOKEN: "tok" };

  await test("a click with three buildable tickets starts three sessions, one ticket each", async () => {
    const db = makeFakeDb(seed());
    const mod = loadIndex(db, secrets);
    const realFetch = global.fetch; const stub = fireStub(); global.fetch = stub;
    try { await click(db, mod); } finally { global.fetch = realFetch; }
    assert.strictEqual(stub.calls.length, 3, "one fire per buildable ticket (blocked and other-project skipped)");
    for (const id of ["a", "b", "c"]) {
      const text = stub.calls.find((t) => t.includes(`(ticket ${id})`));
      assert.ok(text, `a session for ${id}`);
      assert.ok(text.includes("has 1 item in Backlog"), "keeps the default-flow prompt shape");
      assert.ok(text.includes("each of the others is being built right now by its own parallel session"));
      assert.ok(text.includes(`PATCH backlogItems/${id} with buildSession.status`), "reports on its own card");
      assert.ok(!text.includes("PATCH projects/proj1 with notifyRoutine.status"), "never flips the project's spinner itself");
    }
    const r = db.__state.projects[PID].notifyRoutine;
    assert.strictEqual(r.mode, "per-item");
    assert.strictEqual(r.status, "in-progress");
    assert.deepStrictEqual(r.sentItemIds.sort(), ["a", "b", "c"]);
    assert.strictEqual(r.sessions.length, 3);
    assert.ok(r.sessions.every((s) => s.sessionId && !s.error));
  });

  await test("the ticket's comments ride along, so a recorded decision reaches its session", async () => {
    const db = makeFakeDb(seed());
    const mod = loadIndex(db, secrets);
    const realFetch = global.fetch; const stub = fireStub(); global.fetch = stub;
    try { await click(db, mod, { notifyItemIds: ["a"] }); } finally { global.fetch = realFetch; }
    assert.strictEqual(stub.calls.length, 1);
    assert.ok(stub.calls[0].includes("DECIDED: the automated score wins."));
    assert.ok(!stub.calls[0].includes("sent together"), "a lone ticket has no sibling block");
  });

  await test("sessions start a few at a time, not all at once", async () => {
    const s = seed();
    for (let i = 0; i < 9; i++) s.backlogItems[`x${i}`] = { projectId: PID, status: "backlog", type: "feature", title: `X${i}`, desc: "d" };
    const db = makeFakeDb(s);
    const mod = loadIndex(db, secrets);
    const realFetch = global.fetch; const stub = fireStub(); global.fetch = stub;
    try { await click(db, mod); } finally { global.fetch = realFetch; }
    assert.strictEqual(stub.calls.length, 12);
    assert.ok(stub.max() <= 4, `at most 4 in flight, saw ${stub.max()}`);
  });

  await test("one failed fire doesn't sink the others, and is reported", async () => {
    const db = makeFakeDb(seed());
    const mod = loadIndex(db, secrets);
    const realFetch = global.fetch; const stub = fireStub({ failFor: ["b"] }); global.fetch = stub;
    try { await click(db, mod); } finally { global.fetch = realFetch; }
    const r = db.__state.projects[PID].notifyRoutine;
    assert.strictEqual(r.status, "in-progress", "two of three started");
    assert.match(r.errorMessage, /1 of 3 sessions failed to start/);
    assert.strictEqual(r.sessions.find((x) => x.itemId === "b").error.includes("429"), true);
  });

  await test("each card records its own fire outcome: the session, or the error and when it will be retried", async () => {
    const db = makeFakeDb(seed());
    const mod = loadIndex(db, secrets);
    const realFetch = global.fetch; const stub = fireStub({ failFor: ["b"] }); global.fetch = stub;
    try { await click(db, mod); } finally { global.fetch = realFetch; }
    const a = db.__state.backlogItems.a.lastFire;
    assert.strictEqual(a.status, "started");
    assert.ok(a.sessionId && !a.error);
    const b = db.__state.backlogItems.b.lastFire;
    assert.strictEqual(b.status, "retrying", "a 429 is tried again");
    assert.match(b.error, /429/);
    assert.strictEqual(b.attempts, 1);
    assert.ok(b.nextAttemptAt.getTime() > Date.now() + 4 * 60 * 1000, "about five minutes out");
    assert.ok(b.requestedAt, "tied to the request that caused it");
  });

  await test("after a 429 the rest of the batch is deferred, not fired into the same wall", async () => {
    const s = seed();
    for (let i = 0; i < 6; i++) s.backlogItems[`x${i}`] = { projectId: PID, status: "backlog", type: "feature", title: `X${i}`, desc: "d" };
    const db = makeFakeDb(s);
    const mod = loadIndex(db, secrets);
    const realFetch = global.fetch; const stub = fireStub({ failFor: ["a"] }); global.fetch = stub;
    try { await click(db, mod, { notifyItemIds: ["a", "x0", "x1", "x2", "x3", "x4", "x5"] }); } finally { global.fetch = realFetch; }
    assert.ok(stub.calls.length < 7, `stopped firing once throttled (fired ${stub.calls.length})`);
    const deferred = Object.values(db.__state.backlogItems).filter((i) => i.lastFire && i.lastFire.status === "retrying" && i.lastFire.attempts === 0);
    assert.ok(deferred.length >= 1, "deferred cards wait without using an attempt");
  });

  await test("a retry that succeeds replaces the retrying record with the session", async () => {
    const s = seed();
    s.backlogItems.b.lastFire = { status: "retrying", attempts: 1, error: "429", nextAttemptAt: new Date(0) };
    const db = makeFakeDb(s);
    const mod = loadIndex(db, secrets);
    const realFetch = global.fetch; const stub = fireStub(); global.fetch = stub;
    try { await click(db, mod, { notifyItemIds: ["b"] }); } finally { global.fetch = realFetch; }
    const b = db.__state.backlogItems.b.lastFire;
    assert.strictEqual(b.status, "started");
    assert.strictEqual(b.attempts, 2);
    assert.strictEqual(b.error, null);
  });

  await test("retry policy: 429, 5xx and no answer retry; other 4xx do not; three attempts over about 15 minutes", async () => {
    const mod = loadIndex(makeFakeDb(seed()), secrets);
    const plan = mod.__test.fireRetryPlan;
    const now = 1_000_000;
    for (const status of [429, 500, 502, 503, null]) assert.strictEqual(plan({ status, attempts: 1, now }).retry, true, String(status));
    for (const status of [400, 401, 403, 404, 422]) assert.strictEqual(plan({ status, attempts: 1, now }).retry, false, String(status));
    assert.strictEqual(plan({ status: 429, attempts: 1, now }).nextAttemptAt.getTime(), now + 5 * 60 * 1000);
    assert.strictEqual(plan({ status: 429, attempts: 2, now }).nextAttemptAt.getTime(), now + 10 * 60 * 1000);
    assert.strictEqual(plan({ status: 429, attempts: 3, now }).retry, false, "the third attempt is the last");
    assert.strictEqual(plan({ status: 429, attempts: 0, deferred: true, deferrals: 0, now }).retry, true);
    assert.strictEqual(plan({ status: 429, attempts: 0, deferred: true, deferrals: 6, now }).retry, false, "deferral is bounded");
  });

  await test("a 4xx that shouldn't be retried is recorded as failed, with no next attempt", async () => {
    const mod = loadIndex(makeFakeDb(seed()), secrets);
    const r = mod.__test.lastFireRecord({ result: { error: "Routine fire endpoint responded with status 401", status: 401 }, prior: {}, requestedAt: null });
    assert.strictEqual(r.status, "failed");
    assert.strictEqual(r.nextAttemptAt, null);
    assert.match(r.error, /401/);
  });

  await test("itemNotesBlock keeps the newest comments and truncates long ones", async () => {
    const mod = loadIndex(makeFakeDb(seed()), secrets);
    const notes = Array.from({ length: 20 }, (_, i) => ({ author: "x", text: i === 19 ? "y".repeat(3000) : `n${i}`, at: "t" }));
    const block = mod.__test.itemNotesBlock({ notes });
    assert.ok(!block.includes("- x (t): n0\n"), "oldest dropped");
    assert.ok(block.includes("n8") && block.includes("…"));
  });

  await test("deploy request: 50 items with 10 KB descriptions stay under 60 KiB and list every id, title and commit", async () => {
    const mod = loadIndex(makeFakeDb(seed()), secrets);
    const items = Array.from({ length: 50 }, (_, i) => ({ id: `id${i}`, type: "feature", title: `Title ${i}`, desc: "d".repeat(10240), deployCommit: `sha${i}` }));
    const out = mod.__test.buildDeployFireText(items, (lines) => `HEAD\n${lines}\nTAIL`);
    assert.ok(!out.error, out.error);
    assert.ok(Buffer.byteLength(out.text) < 60 * 1024);
    items.forEach((i) => assert.ok(out.text.includes(i.id) && out.text.includes(i.title) && out.text.includes(i.deployCommit)));
    assert.ok(!out.text.includes("ddddd"), "descriptions are not sent");
  });

  await test("deploy request: a text that cannot fit names its size instead of firing", async () => {
    const mod = loadIndex(makeFakeDb(seed()), secrets);
    const out = mod.__test.buildDeployFireText([{ id: "a", type: "bug", title: "t" }], (lines) => `${"x".repeat(70000)}${lines}`);
    assert.match(out.error, /bytes for 1 items, over the 61440-byte limit/);
  });

  await test("deploy click: 18 long tickets fire once, body within 64 KiB; a 400 surfaces its body", async () => {
    const s = seed();
    s.projects[PID].deployBranch = "deploy/x";
    for (let i = 0; i < 18; i++) s.backlogItems[`t${i}`] = { projectId: PID, status: "ready-to-publish", type: "feature", title: `Long ${i}`, desc: "z".repeat(4000), deployCommit: `c${i}` };
    for (const reject of [false, true]) {
      const db = makeFakeDb(s);
      const mod = loadIndex(db, secrets);
      const bodies = [];
      const realFetch = global.fetch;
      global.fetch = async (url, opts) => {
        bodies.push(Buffer.byteLength(opts.body));
        return reject ? { ok: false, status: 400, text: async () => "bad payload" } : { ok: true, json: async () => ({ claude_code_session_id: "s1" }) };
      };
      try {
        const before = { name: "Display Types" };
        const after = { name: "Display Types", deployBranch: "deploy/x", deployNotifyRequestedAt: ts(Date.now()) };
        await mod.notifyOnProjectReadyToDeploy({ params: { projectId: PID }, data: { before: { data: () => before }, after: { data: () => after } } });
      } finally { global.fetch = realFetch; }
      assert.strictEqual(bodies.length, 1);
      assert.ok(bodies[0] <= 64 * 1024, `body ${bodies[0]}`);
      const r = db.__state.projects[PID].deployRoutine;
      if (reject) { assert.strictEqual(r.status, "error"); assert.match(r.errorMessage, /status 400.*bad payload/); }
      else assert.strictEqual(r.status, "in-progress");
    }
  });

  console.log(`\n${passed} passed, ${failures.length} failed`);
  process.exit(failures.length ? 1 : 0);
})();
