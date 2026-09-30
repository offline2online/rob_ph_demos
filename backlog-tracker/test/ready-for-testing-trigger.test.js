// Drives the REAL functions/index.js Cloud Function notifyOnItemsReadyForTesting
// end to end under stubbed Firebase SDKs (the same approach as
// train-lock-trigger.test.js), plus the automation script's pure half
// (readyForTestingNotifyFields / tv) that writes the stamp it reacts to.
//
// The behaviour under test (30 Sep 2026): when run-backlog-automation.js lands
// tickets in Ready for Testing it stamps the project, and this function
// fires a Claude session whose only job is to PRESENT that column — the
// "trigger" half of the composable UI tickets (ZXmW4lHMKpQRlarlwK7z /
// f1yOqE2Sx2q8D7MSvfDu), which shipped a view but nothing that ever showed it.
//
// Run with:  node test/ready-for-testing-trigger.test.js
"use strict";
const assert = require("assert");
const Module = require("module");

function makeFakeDb(seed) {
  const state = {};
  for (const [col, docs] of Object.entries(seed || {})) {
    state[col] = state[col] || {};
    for (const [id, data] of Object.entries(docs)) state[col][id] = data;
  }
  function resolveValue(v) {
    if (v && v.__sentinel === "serverTimestamp") return new Date();
    return v;
  }
  function docRef(collection, id) {
    return {
      async get() {
        const raw = state[collection] && state[collection][id];
        return { exists: raw !== undefined, data: () => raw };
      },
      async set(data, opts) {
        state[collection] = state[collection] || {};
        const existing = state[collection][id];
        const resolved = {};
        for (const [k, v] of Object.entries(data)) resolved[k] = resolveValue(v);
        state[collection][id] = (opts && opts.merge && existing) ? Object.assign({}, existing, resolved) : resolved;
      },
    };
  }
  function collectionRef(name) {
    state[name] = state[name] || {};
    return {
      doc: (id) => docRef(name, id),
      where(field, op, value) {
        return { async get() { return { docs: Object.values(state[name]).filter((d) => d[field] === value).map((d) => ({ data: () => d })) }; } };
      },
    };
  }
  return { collection: collectionRef, __state: state };
}

const SECRETS = {
  CLAUDE_ROUTINE_FIRE_URL: "https://api.anthropic.com/v1/routines/trig_shared/fire",
  CLAUDE_ROUTINE_TOKEN: "shared-token",
  BOARD_API_KEY: "board-key",
  NOTIFY_WEBHOOK_URL: "https://hooks.slack.test/T/B/x",
};

function installStubs(db) {
  const stubs = {
    "firebase-functions/v2/firestore": { onDocumentUpdated: (opts, handler) => handler, onDocumentWritten: (opts, handler) => handler },
    "firebase-functions/params": { defineSecret: (name) => ({ value: () => SECRETS[name] || "" }) },
    "firebase-functions/logger": { info() {}, warn() {}, error() {}, debug() {} },
    "firebase-admin/app": { initializeApp: () => ({}) },
    "firebase-admin/firestore": {
      getFirestore: () => db,
      FieldValue: { serverTimestamp: () => ({ __sentinel: "serverTimestamp" }), arrayUnion: (...items) => ({ __sentinel: "arrayUnion", items }) },
    },
    "firebase-admin/auth": { getAuth: () => ({}) },
    "firebase-functions/v2/https": { onRequest: (opts, handler) => handler },
    "google-auth-library": { GoogleAuth: class GoogleAuthStub {} },
  };
  const originalLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (Object.prototype.hasOwnProperty.call(stubs, request)) return stubs[request];
    return originalLoad.call(this, request, parent, isMain);
  };
  return { restore() { Module._load = originalLoad; } };
}

function loadIndexFresh(db) {
  const stub = installStubs(db);
  const indexPath = require.resolve("../functions/index.js");
  delete require.cache[indexPath];
  delete require.cache[require.resolve("../functions/mcp-server.js")];
  delete require.cache[require.resolve("../functions/mcp-app-views.js")];
  let mod;
  try { mod = require(indexPath); } finally { stub.restore(); }
  return mod;
}

// Every outbound HTTP call the function makes, captured.
const calls = [];
global.fetch = async (url, opts) => {
  calls.push({ url: String(url), opts });
  return { ok: true, status: 200, json: async () => ({ claude_code_session_id: "cse_presenting123" }), text: async () => "" };
};

let passed = 0;
const failures = [];
async function test(name, fn) {
  try { await fn(); passed += 1; console.log(`  ok  ${name}`); }
  catch (err) { failures.push([name, err]); console.log(`FAIL  ${name}\n      ${err && err.stack ? err.stack : err}`); }
}
const stamp = (ms) => ({ toMillis: () => ms });
function projectEvent(projectId, before, after) {
  return { params: { projectId }, data: { before: { data: () => before }, after: { data: () => after } } };
}
const fireCalls = () => calls.filter((c) => c.url.includes("/fire"));
const slackCalls = () => calls.filter((c) => c.url.startsWith("https://hooks.slack.test"));

const ITEMS = {
  t1: { projectId: "p1", status: "ready-for-testing", type: "feature", title: "Try-it example for the in-agent views", desc: "Add a Try it example to MCP.md.", testSummary: "Added a Try it block under What the agent can and can't do.", previewUrl: "https://rawcdn.githack.com/offline2online/rob_ph_demos/abc1234/backlog-tracker/MCP.md", testVersion: "1.5.129", deployCommit: "abc1234" },
  t2: { projectId: "p1", status: "ready-for-testing", type: "bug", title: "Second ticket", desc: "Fix the thing.", deployCommit: "def5678" },
  gone: { projectId: "p1", status: "backlog", type: "bug", title: "Failed testing already", desc: "x" },
  other: { projectId: "p2", status: "ready-for-testing", type: "bug", title: "Someone else's project", desc: "x" },
};

(async () => {
  console.log("\nnotifyOnItemsReadyForTesting — the Ready for Testing presentation fire\n");

  await test("index.js exports notifyOnItemsReadyForTesting", () => {
    const mod = loadIndexFresh(makeFakeDb());
    assert.strictEqual(typeof mod.notifyOnItemsReadyForTesting, "function");
  });

  await test("a new stamp fires one presentation session listing only cards still in Ready for Testing on this project, and records it", async () => {
    calls.length = 0;
    const db = makeFakeDb({ projects: { p1: { name: "Backlog Tracker & FAQs", deployBranch: "deploy/backlog-tracker-faqs" } }, backlogItems: ITEMS });
    const mod = loadIndexFresh(db);
    const after = { name: "Backlog Tracker & FAQs", deployBranch: "deploy/backlog-tracker-faqs", readyForTestingNotifyRequestedAt: stamp(2000), readyForTestingNotifyItemIds: ["t1", "t2", "gone", "other", "missing"], readyForTestingNotifyRequestedByEmail: null };
    await mod.notifyOnItemsReadyForTesting(projectEvent("p1", { name: "Backlog Tracker & FAQs" }, after));

    assert.strictEqual(fireCalls().length, 1, "exactly one Routine fire");
    const fire = fireCalls()[0];
    assert.strictEqual(fire.url, SECRETS.CLAUDE_ROUTINE_FIRE_URL);
    assert.strictEqual(fire.opts.headers.Authorization, "Bearer shared-token");
    const text = JSON.parse(fire.opts.body).text;
    assert.ok(text.startsWith('=== READY FOR TESTING for "Backlog Tracker & FAQs" (projectId: p1)'), text.slice(0, 120));
    assert.match(text, /landed 2 tickets/);
    assert.match(text, /\[id: t1\] \[Feature\] Try-it example/);
    assert.match(text, /Test link: https:\/\/rawcdn\.githack\.com\/offline2online\/rob_ph_demos\/abc1234/);
    assert.match(text, /Test version: v1\.5\.129/);
    assert.match(text, /Ticket: https:\/\/backlog-tracker-e4ed2\.web\.app\/#item-t1/);
    assert.match(text, /Added a Try it block/, "testSummary is preferred over desc");
    assert.match(text, /\[id: t2\] \[Bug\] Second ticket/);
    assert.ok(!text.includes("gone"), "a card that already left Ready for Testing is not presented");
    assert.ok(!text.includes("Someone else"), "a card on another project is not presented");
    assert.match(text, /Do NOT investigate, build, re-test, approve, reject or move anything/);
    assert.match(text, /readyForTestingRoutine\.status/);
    assert.match(text, /BOARD ACCESS/);

    const rec = db.__state.projects.p1.readyForTestingRoutine;
    assert.strictEqual(rec.status, "in-progress");
    assert.strictEqual(rec.sessionId, "cse_presenting123");
    assert.strictEqual(rec.sessionUrl, "https://claude.ai/code/cse_presenting123");
    assert.deepStrictEqual(rec.sentItemIds, ["t1", "t2"]);
    assert.strictEqual(rec.firedVia, "shared");
    assert.strictEqual(rec.errorMessage, null);

    assert.strictEqual(slackCalls().length, 1);
    const slack = JSON.parse(slackCalls()[0].opts.body);
    assert.match(slack.text, /2 tickets landed in Ready for Testing/);
    assert.match(slack.text, /https:\/\/claude\.ai\/code\/cse_presenting123/);
  });

  await test("the same stamp re-saved (e.g. the function's own readyForTestingRoutine write) does not fire again", async () => {
    calls.length = 0;
    const db = makeFakeDb({ backlogItems: ITEMS });
    const mod = loadIndexFresh(db);
    const doc = { name: "P", readyForTestingNotifyRequestedAt: stamp(2000), readyForTestingNotifyItemIds: ["t1"] };
    await mod.notifyOnItemsReadyForTesting(projectEvent("p1", doc, { ...doc, readyForTestingRoutine: { status: "in-progress" } }));
    await mod.notifyOnItemsReadyForTesting(projectEvent("p1", doc, { ...doc, requirementsMd: "edited" }));
    assert.strictEqual(fireCalls().length, 0);
  });

  await test("an ISO-string stamp (what the automation's REST PATCH would send without tv()'s Date support) still counts as a stamp", async () => {
    calls.length = 0;
    const db = makeFakeDb({ backlogItems: ITEMS });
    const mod = loadIndexFresh(db);
    await mod.notifyOnItemsReadyForTesting(projectEvent("p1", { name: "P" }, { name: "P", readyForTestingNotifyRequestedAt: "2026-09-30T11:00:00.000Z", readyForTestingNotifyItemIds: ["t1"] }));
    assert.strictEqual(fireCalls().length, 1);
  });

  await test("the member who started the build has a Routine binding → fires under it, not the shared token", async () => {
    calls.length = 0;
    const db = makeFakeDb({
      backlogItems: ITEMS,
      routineBindings: { "rob@offline2online.com": { email: "rob@offline2online.com", fireUrl: "https://api.anthropic.com/v1/routines/trig_rob/fire", token: "rob-token" } },
    });
    const mod = loadIndexFresh(db);
    await mod.notifyOnItemsReadyForTesting(projectEvent("p1", { name: "P" }, { name: "P", readyForTestingNotifyRequestedAt: stamp(3000), readyForTestingNotifyItemIds: ["t1"], readyForTestingNotifyRequestedByEmail: "rob@offline2online.com" }));
    assert.strictEqual(fireCalls().length, 1);
    assert.strictEqual(fireCalls()[0].url, "https://api.anthropic.com/v1/routines/trig_rob/fire");
    assert.strictEqual(fireCalls()[0].opts.headers.Authorization, "Bearer rob-token");
    assert.strictEqual(db.__state.projects.p1.readyForTestingRoutine.firedVia, "member");
  });

  await test("no card still in Ready for Testing → no fire, no record", async () => {
    calls.length = 0;
    const db = makeFakeDb({ backlogItems: ITEMS });
    const mod = loadIndexFresh(db);
    await mod.notifyOnItemsReadyForTesting(projectEvent("p1", { name: "P" }, { name: "P", readyForTestingNotifyRequestedAt: stamp(4000), readyForTestingNotifyItemIds: ["gone", "missing"] }));
    assert.strictEqual(fireCalls().length, 0);
    assert.strictEqual((db.__state.projects || {}).p1, undefined);
  });

  await test("a failed fire is recorded as an error on the project, and Slack still hears about the tickets", async () => {
    calls.length = 0;
    const realFetch = global.fetch;
    global.fetch = async (url, opts) => {
      calls.push({ url: String(url), opts });
      if (String(url).includes("/fire")) return { ok: false, status: 503, json: async () => ({}), text: async () => "down" };
      return { ok: true, status: 200, json: async () => ({}), text: async () => "" };
    };
    try {
      const db = makeFakeDb({ backlogItems: ITEMS });
      const mod = loadIndexFresh(db);
      await mod.notifyOnItemsReadyForTesting(projectEvent("p1", { name: "P" }, { name: "P", readyForTestingNotifyRequestedAt: stamp(5000), readyForTestingNotifyItemIds: ["t1"] }));
      const rec = db.__state.projects.p1.readyForTestingRoutine;
      assert.strictEqual(rec.status, "error");
      assert.match(rec.errorMessage, /503/);
      assert.strictEqual(slackCalls().length, 1);
    } finally { global.fetch = realFetch; }
  });

  // ── The automation's half: the stamp it writes ──────────────────────────
  const { readyForTestingNotifyFields, tv } = require("../scripts/run-backlog-automation.js");
  await test("run-backlog-automation.js stamps the project with a real timestamp, the landed ids and the build's requester", () => {
    const fields = readyForTestingNotifyFields({ id: "p1", notifyRequestedByEmail: "rob@offline2online.com" }, ["t1", "t2"]);
    assert.ok(fields.readyForTestingNotifyRequestedAt instanceof Date);
    assert.deepStrictEqual(fields.readyForTestingNotifyItemIds, ["t1", "t2"]);
    assert.strictEqual(fields.readyForTestingNotifyRequestedByEmail, "rob@offline2online.com");
    const encoded = tv(fields).mapValue.fields;
    assert.ok(encoded.readyForTestingNotifyRequestedAt.timestampValue, "a Firestore timestamp, not a string — the function's stamp guard needs toMillis()");
    assert.deepStrictEqual(encoded.readyForTestingNotifyItemIds.arrayValue.values.map((v) => v.stringValue), ["t1", "t2"]);
    assert.strictEqual(readyForTestingNotifyFields({ id: "p1" }, []).readyForTestingNotifyRequestedByEmail, null);
  });

  console.log(`\n${passed} passed, ${failures.length} failed\n`);
  if (failures.length) process.exit(1);
})();
