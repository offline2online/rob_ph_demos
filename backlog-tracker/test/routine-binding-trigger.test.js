// Exercises the REAL functions/index.js's resolveRoutineCredentials
// (VNE6dxMu3h6jO3g6FNNB — per-member routine binding) under the same
// "require the real file under stubbed Firebase SDKs" approach
// test/train-lock-trigger.test.js already uses for this file, reusing its
// exact stub set so this needs no emulator, no credentials, no network.
//
// Run with:  node test/routine-binding-trigger.test.js
"use strict";
const assert = require("assert");
const Module = require("module");

function makeFakeDb(seed) {
  const state = { consoleUsers: {} };
  for (const [col, docs] of Object.entries(seed || {})) {
    for (const [id, data] of Object.entries(docs)) state[col][id] = data;
  }
  function docRef(collection, id) {
    return {
      async get() {
        const raw = state[collection] && state[collection][id];
        return { exists: raw !== undefined, data: () => raw };
      },
    };
  }
  function collectionRef(name) {
    state[name] = state[name] || {};
    return { doc: (id) => docRef(name, id) };
  }
  return { collection: collectionRef, __state: state };
}

function installStubs(db) {
  const stubs = {
    "firebase-functions/v2/firestore": {
      onDocumentUpdated: (opts, handler) => handler,
      onDocumentWritten: (opts, handler) => handler,
    },
    "firebase-functions/params": { defineSecret: () => ({ value: () => "" }) },
    "firebase-functions/logger": { info() {}, warn() {}, error() {}, debug() {} },
    "firebase-admin/app": { initializeApp: () => ({}) },
    "firebase-admin/firestore": {
      getFirestore: () => db,
      FieldValue: {
        serverTimestamp: () => ({ __sentinel: "serverTimestamp" }),
        arrayUnion: (...items) => ({ __sentinel: "arrayUnion", items }),
      },
    },
    "firebase-admin/auth": {
      getAuth: () => ({
        verifyIdToken: async () => { throw new Error("stub: not used by this test"); },
        getUserByEmail: async () => { throw new Error("stub: not used by this test"); },
        createUser: async () => ({}),
        setCustomUserClaims: async () => {},
      }),
    },
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
  let mod;
  try {
    mod = require(indexPath);
  } finally {
    stub.restore();
  }
  return mod;
}

let passed = 0;
const failures = [];
async function test(name, fn) {
  try { await fn(); passed += 1; console.log(`  ok  ${name}`); }
  catch (err) { failures.push([name, err]); console.log(`FAIL  ${name}\n      ${err && err.stack ? err.stack : err}`); }
}

(async () => {
  await test("index.js exports resolveRoutineCredentials via its test hook", () => {
    const mod = loadIndexFresh(makeFakeDb());
    assert.strictEqual(typeof mod.__test.resolveRoutineCredentials, "function");
  });

  await test("uses the member's own binding when both fireUrl and token are set", async () => {
    const db = makeFakeDb({
      consoleUsers: { "sam@personalisationhub.com": { role: "editor", routineFireUrl: "https://api.anthropic.com/v1/claude_code/routines/trig_sam/fire", routineFireToken: "sk-ant-sams-token" } },
    });
    const mod = loadIndexFresh(db);
    const out = await mod.__test.resolveRoutineCredentials(db, "sam@personalisationhub.com", "https://shared/fire", "shared-token");
    assert.strictEqual(out.fireUrl, "https://api.anthropic.com/v1/claude_code/routines/trig_sam/fire");
    assert.strictEqual(out.token, "sk-ant-sams-token");
    assert.strictEqual(out.via, "member");
  });

  await test("falls back to the shared secret when the member has no binding", async () => {
    const db = makeFakeDb({ consoleUsers: { "nobinding@personalisationhub.com": { role: "editor" } } });
    const mod = loadIndexFresh(db);
    const out = await mod.__test.resolveRoutineCredentials(db, "nobinding@personalisationhub.com", "https://shared/fire", "shared-token");
    assert.strictEqual(out.fireUrl, "https://shared/fire");
    assert.strictEqual(out.token, "shared-token");
    assert.strictEqual(out.via, "shared");
  });

  await test("falls back to the shared secret when only one of fireUrl/token is set (a half-written or cleared binding)", async () => {
    const db = makeFakeDb({ consoleUsers: { "half@personalisationhub.com": { role: "editor", routineFireUrl: "https://api.anthropic.com/fire", routineFireToken: null } } });
    const mod = loadIndexFresh(db);
    const out = await mod.__test.resolveRoutineCredentials(db, "half@personalisationhub.com", "https://shared/fire", "shared-token");
    assert.strictEqual(out.via, "shared");
  });

  await test("falls back to the shared secret when the click can't be attributed to anyone", async () => {
    const db = makeFakeDb();
    const mod = loadIndexFresh(db);
    const out = await mod.__test.resolveRoutineCredentials(db, null, "https://shared/fire", "shared-token");
    assert.strictEqual(out.via, "shared");
  });

  await test("falls back to the shared secret (rather than throwing) if the consoleUsers read fails", async () => {
    const brokenDb = { collection: () => ({ doc: () => ({ get: async () => { throw new Error("stub: firestore down"); } }) }) };
    const mod = loadIndexFresh(makeFakeDb());
    const out = await mod.__test.resolveRoutineCredentials(brokenDb, "someone@personalisationhub.com", "https://shared/fire", "shared-token");
    assert.strictEqual(out.via, "shared");
    assert.strictEqual(out.fireUrl, "https://shared/fire");
  });

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) process.exit(1);
})();
