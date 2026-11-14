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
        if (opts && opts.merge) {
          state[collection][id] = deepMerge(state[collection][id] || {}, data);
        } else state[collection][id] = data;
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

const DELETE = { __delete: true };

// Firestore's set(..., {merge: true}) merges maps deeply and removes a key
// whose value is FieldValue.delete().
function deepMerge(base, patch) {
  const out = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    if (v === DELETE) delete out[k];
    else if (v && typeof v === "object" && v.constructor === Object && out[k] && typeof out[k] === "object" && out[k].constructor === Object) out[k] = deepMerge(out[k], v);
    else out[k] = v;
  }
  return out;
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
      assert.ok(text.includes("Before setting patchReady, run the tests for what you changed") && text.includes("npm run test:fast") && text.includes("Retail-media-insights && npm run test:ci") && text.includes("/opt/pw-browsers/chromium"),
        "every build is told to run the suites for what it changed plus the fast checks, and that a browser is there");
      assert.ok(text.includes("train-only") && text.includes("what you ran and what you left to the train"), "the long suites are left to the train, and the note says what ran");
      // Heartbeat and build attempt (14 Nov 2026): the fire names its attempt,
      // and the card stores the same id as the current one.
      const attempt = (text.match(/HEARTBEAT — build attempt ([0-9a-f]{16})\./) || [])[1];
      assert.ok(attempt, "the fire carries a build attempt id and the heartbeat rule");
      assert.ok(text.includes(`buildSession.attemptId "${attempt}"`) && text.includes("buildSession.heartbeatAt") && text.includes("at least every 10 minutes"), "told what to send and how often");
      assert.ok(text.includes(`patchAttemptId "${attempt}"`) && text.includes("do NOT set patchReady"), "told to stop if superseded, and to send its id with the patch");
      assert.strictEqual(db.__state.backlogItems[id].buildAttemptId, attempt, "the card stores the current attempt");
      assert.strictEqual(db.__state.backlogItems[id].lastFire.buildAttemptId, attempt, "and its fire record marks a session that was told to beat");
      assert.ok(!text.includes("PATCH projects/proj1 with notifyRoutine.status"), "never flips the project's spinner itself");
    }
    const r = db.__state.projects[PID].notifyRoutine;
    assert.strictEqual(r.mode, "per-item");
    assert.strictEqual(r.status, "in-progress");
    assert.deepStrictEqual(r.sentItemIds.sort(), ["a", "b", "c"]);
    assert.strictEqual(r.sessions.length, 3);
    assert.ok(r.sessions.every((s) => s.sessionId && !s.error));
  });

  // 20 Oct 2026: "Ready for Dev — N new" sent the whole column while a build was
  // running, and every ticket on both trains was built twice.
  await test("a second click never starts another session for a ticket the first click is still building", async () => {
    const sd = seed();
    const firedAt = new Date(Date.now() - 4 * 60 * 1000);
    sd.backlogItems.a.lastFire = { status: "started", at: firedAt, sessionId: "session_old" };
    const db = makeFakeDb(sd);
    const mod = loadIndex(db, secrets);
    const realFetch = global.fetch; const stub = fireStub(); global.fetch = stub;
    const running = { status: "in-progress", mode: "per-item", firedAt, sentItemIds: ["a"], sessions: [{ itemId: "a", sessionId: "session_old", sessionUrl: "https://claude.ai/code/session_old" }] };
    try { await click(db, mod, { notifyRoutine: running }); } finally { global.fetch = realFetch; }
    assert.ok(!stub.calls.some((t) => t.includes("(ticket a)")), "no second session for a");
    assert.deepStrictEqual(stub.calls.map((t) => /\(ticket (\w+)\)/.exec(t)[1]).sort(), ["b", "c"]);
    const r = db.__state.projects[PID].notifyRoutine;
    assert.deepStrictEqual(r.sentItemIds.sort(), ["a", "b", "c"], "a stays on the record as building");
    assert.ok(r.sessions.some((x) => x.itemId === "a" && x.sessionId === "session_old"), "a's session link is kept");
  });

  await test("a click that only names tickets already being built fires nothing and keeps the running record", async () => {
    const sd = seed();
    const firedAt = new Date(Date.now() - 2 * 60 * 1000);
    sd.backlogItems.a.lastFire = { status: "started", at: firedAt, sessionId: "session_old" };
    const running = { status: "in-progress", mode: "per-item", firedAt, sentItemIds: ["a"] };
    sd.projects[PID].notifyRoutine = running;
    const db = makeFakeDb(sd);
    const mod = loadIndex(db, secrets);
    const realFetch = global.fetch; const stub = fireStub(); global.fetch = stub;
    try { await click(db, mod, { notifyRoutine: running, notifyItemIds: ["a"] }); } finally { global.fetch = realFetch; }
    assert.strictEqual(stub.calls.length, 0);
    assert.deepStrictEqual(db.__state.projects[PID].notifyRoutine.sentItemIds, ["a"]);
  });

  await test("a ticket whose session already reported, or whose fire never started, is built again", async () => {
    const sd = seed();
    const firedAt = new Date(Date.now() - 10 * 60 * 1000);
    sd.backlogItems.a.lastFire = { status: "started", at: firedAt };
    sd.backlogItems.a.buildSession = { status: "done", reportedAt: new Date(Date.now() - 60 * 1000) };
    sd.backlogItems.b.lastFire = { status: "retrying", at: firedAt, error: "429" };
    const db = makeFakeDb(sd);
    const mod = loadIndex(db, secrets);
    const realFetch = global.fetch; const stub = fireStub(); global.fetch = stub;
    try { await click(db, mod, { notifyRoutine: { status: "in-progress", mode: "per-item", firedAt, sentItemIds: ["a", "b"] }, notifyItemIds: ["a", "b"] }); } finally { global.fetch = realFetch; }
    assert.strictEqual(stub.calls.length, 2);
  });

  await test("a click clears the previous record's finishedAt, closedAt and stalledItemIds", async () => {
    const sd = seed();
    sd.projects[PID].notifyRoutine = { status: "stalled", finishedAt: "2026-10-03T10:00:00Z", closedAt: "2026-10-03T11:00:00Z", stalledItemIds: ["a"], mode: "per-item" };
    const db = makeFakeDb(sd);
    const mod = loadIndex(db, secrets);
    const realFetch = global.fetch; const stub = fireStub(); global.fetch = stub;
    try { await click(db, mod); } finally { global.fetch = realFetch; }
    const r = db.__state.projects[PID].notifyRoutine;
    assert.strictEqual(r.status, "in-progress");
    for (const k of ["finishedAt", "closedAt", "stalledItemIds"]) assert.ok(!(k in r), `${k} cleared`);
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

  await test("a click whose tickets are all blocked writes a visible error and fires nothing", async () => {
    const db = makeFakeDb(seed());
    const mod = loadIndex(db, secrets);
    const realFetch = global.fetch; const stub = fireStub(); global.fetch = stub;
    try { await click(db, mod, { notifyItemIds: ["blocked"] }); } finally { global.fetch = realFetch; }
    assert.strictEqual(stub.calls.length, 0, "nothing fired");
    const r = db.__state.projects[PID].notifyRoutine;
    assert.strictEqual(r.status, "error");
    assert.strictEqual(r.errorMessage, "Every selected ticket is waiting on your answer — answer it on the card");
    assert.ok(r.firedAt);
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
    const r = mod.__test.lastFireRecord({ result: { error: "Routine fire endpoint responded with status 401", status: 401, buildAttemptId: "ffffffffffffffff" }, prior: {}, requestedAt: null });
    assert.ok(!("buildAttemptId" in r), "a fire that started no session does not replace the card's current attempt");
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

  // Per-ticket model requirement (t1CU2q6LlxGd5pFB9vwG): the requirement rides
  // in each ticket's own fire, and the automation refuses an Advanced patch
  // that wasn't built on Opus.
  await test("an Advanced ticket's fire carries the Opus rule; a Standard one only asks for builtByModel", async () => {
    const sd = seed();
    sd.backlogItems.a.model = "advanced";
    const db = makeFakeDb(sd);
    const mod = loadIndex(db, secrets);
    const realFetch = global.fetch; const stub = fireStub(); global.fetch = stub;
    try { await click(db, mod); } finally { global.fetch = realFetch; }
    const a = stub.calls.find((t) => t.includes("(ticket a)"));
    const b = stub.calls.find((t) => t.includes("(ticket b)"));
    assert.ok(a.includes("=== MODEL REQUIREMENT: ADVANCED (Claude Opus) ==="), "Advanced block present");
    assert.ok(a.includes('model "opus"') && a.includes('reason: "model-unavailable"') && a.includes("builtByModel"), "delegate, flag, record");
    assert.ok(a.includes("Per-ticket model requirement"), "points at the instructions section");
    assert.ok(!b.includes("MODEL REQUIREMENT: ADVANCED"), "no Advanced block on a Standard ticket");
    assert.ok(b.includes("Model requirement: Standard") && b.includes("builtByModel"));
  });

  await test("the review fire tags each ticket's model and asks for reviewedByModel", async () => {
    const sd = seed();
    Object.assign(sd.backlogItems.a, { status: "ready-for-testing", deployCommit: "aaa1111", model: "advanced" });
    Object.assign(sd.backlogItems.b, { status: "ready-for-testing", deployCommit: "bbb2222" });
    const db = makeFakeDb(sd);
    const mod = loadIndex(db, secrets);
    const realFetch = global.fetch; const stub = fireStub(); global.fetch = stub;
    try {
      const before = { name: "Display Types" };
      const after = { name: "Display Types", reviewRequestedAt: ts(Date.now()) };
      await mod.notifyOnProjectReviewBatch({ params: { projectId: PID }, data: { before: { data: () => before }, after: { data: () => after } } });
    } finally { global.fetch = realFetch; }
    assert.strictEqual(stub.calls.length, 1);
    const text = stub.calls[0];
    assert.match(text, /\[id: a\].*\[Model: Advanced — review on Claude Opus only\]/);
    assert.match(text, /\[id: b\].*\[Model: Standard\]/);
    assert.ok(text.includes("reviewedByModel") && text.includes("model-unavailable: needs Claude Opus"));
  });

  await test("modelGuardRefusal: an Advanced patch lands only when builtByModel is an Opus", async () => {
    const m = require("../functions/model-requirement.js");
    assert.strictEqual(m.modelGuardRefusal({ title: "plain" }), null, "Standard (unset) is never refused");
    assert.strictEqual(m.modelGuardRefusal({ model: "standard", builtByModel: "claude-sonnet-5-5" }), null);
    assert.strictEqual(m.modelGuardRefusal({ model: "advanced", builtByModel: "claude-opus-5-5" }), null);
    assert.strictEqual(m.modelGuardRefusal({ model: "advanced", builtByModel: "Claude Opus 5.5" }), null);
    for (const builtByModel of ["claude-sonnet-5-5", "claude-haiku-5-5", "", undefined]) {
      const r = m.modelGuardRefusal({ model: "advanced", builtByModel });
      assert.ok(r, `refused: ${builtByModel}`);
      assert.strictEqual(r.blocked.reason, "model-unavailable");
      assert.match(r.why, /Not built: this ticket is marked Advanced/);
    }
    assert.strictEqual(m.normaliseModelRequirement("advanced"), "advanced");
    for (const v of [undefined, null, "", "opus", "standard"]) assert.strictEqual(m.normaliseModelRequirement(v), "standard");
  });

  await test("run-backlog-automation.js applies the model guard before anything lands", async () => {
    const src = require("fs").readFileSync(require("path").join(__dirname, "../scripts/run-backlog-automation.js"), "utf8");
    const body = src.slice(src.indexOf("async function processApplyPatch("));
    const guard = body.indexOf("modelGuardRefusal(item)");
    assert.ok(guard > 0, "processApplyPatch calls modelGuardRefusal");
    assert.ok(guard < body.indexOf("syncTrainWithMain") || body.indexOf("syncTrainWithMain") < 0, "before the train is touched");
    assert.ok(guard < body.indexOf("workflowPathsIn(item.patchFiles)"), "before any git work");
    assert.match(body.slice(guard, guard + 800), /patchReady: false[\s\S]*blocked:/, "clears patchReady and flags the card");
  });

  console.log(`\n${passed} passed, ${failures.length} failed`);
  process.exit(failures.length ? 1 : 0);
})();
