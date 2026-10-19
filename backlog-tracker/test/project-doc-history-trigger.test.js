// Drives the REAL functions/index.js Cloud Function (onProjectDocWritten) end
// to end under stubbed Firebase SDKs, as skill-history-trigger.test.js does
// for skills. A projectDocs row with sourcePath is a copy of a repo file; the
// sync writers cannot write docRevisions themselves, so the trigger keeps the
// text each change replaced. No emulator, no credentials, no network.
//
// Run with:  node test/project-doc-history-trigger.test.js
"use strict";
const assert = require("assert");
const Module = require("module");

function makeFakeDb(seed) {
  const state = {};
  for (const [col, docs] of Object.entries(seed || {})) {
    state[col] = {};
    for (const [id, data] of Object.entries(docs)) state[col][id] = data;
  }
  let autoId = 0;
  function resolveValue(v) {
    if (v && v.__sentinel === "serverTimestamp") return { __ts: true, toMillis: () => Date.now() };
    return v;
  }
  function resolveFields(data) {
    const out = {};
    for (const [k, v] of Object.entries(data)) out[k] = resolveValue(v);
    return out;
  }
  function docRef(name, id) {
    return {
      id,
      async get() {
        state[name] = state[name] || {};
        const raw = state[name][id];
        return { exists: raw !== undefined, id, data: () => raw };
      },
      async set(data, opts) {
        state[name] = state[name] || {};
        const existing = state[name][id];
        const resolved = resolveFields(data);
        state[name][id] = (opts && opts.merge && existing) ? Object.assign({}, existing, resolved) : resolved;
      },
    };
  }
  function makeQuery(name, filters) {
    return {
      where(field, op, value) {
        if (op !== "==") throw new Error(`stub: unsupported operator ${op}`);
        return makeQuery(name, filters.concat([[field, value]]));
      },
      limit() { return this; },
      async get() {
        const all = Object.entries(state[name] || {});
        const matched = all.filter(([, d]) => filters.every(([f, v]) => d[f] === v));
        const docs = matched.map(([id, d]) => ({ id, data: () => d }));
        return { docs, empty: docs.length === 0 };
      },
    };
  }
  function collectionRef(name) {
    state[name] = state[name] || {};
    return {
      doc: (id) => docRef(name, id),
      where(field, op, value) { return makeQuery(name, []).where(field, op, value); },
      async add(data) {
        autoId += 1;
        const id = `auto${autoId}`;
        state[name][id] = resolveFields(data);
        return { id };
      },
    };
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

function fakeEvent({ docId, before, after }) {
  return {
    params: { docId },
    data: {
      before: before === undefined ? undefined : { data: () => before },
      after: after === undefined ? undefined : { data: () => after },
    },
  };
}

const MIRROR = { projectId: "p1", name: "Start here", contentMd: "old text", sourcePath: "p/docs/A.md" };
const revisions = (db) => Object.values(db.__state.docRevisions || {});

(async () => {
  await test("index.js loads and exports onProjectDocWritten", () => {
    assert.strictEqual(typeof loadIndexFresh(makeFakeDb()).onProjectDocWritten, "function");
  });

  await test("a mirror text change records exactly one entry holding the previous text", async () => {
    const db = makeFakeDb();
    await loadIndexFresh(db).onProjectDocWritten(fakeEvent({
      docId: "d1", before: MIRROR,
      after: { ...MIRROR, contentMd: "new text", updatedByEmail: "backlog-automation" },
    }));
    const r = revisions(db);
    assert.strictEqual(r.length, 1);
    assert.strictEqual(r[0].target, "projectDoc");
    assert.strictEqual(r[0].docId, "d1");
    assert.strictEqual(r[0].projectId, "p1");
    assert.strictEqual(r[0].name, "Start here");
    assert.strictEqual(r[0].contentMd, "old text", "the text BEFORE the write, not after");
    assert.strictEqual(r[0].chars, 8);
    assert.strictEqual(r[0].replacedByEmail, "backlog-automation");
    assert.strictEqual(r[0].via, "trigger");
    assert.ok(r[0].replacedAt);
  });

  await test("a name-only change, a non-mirror change and a creation record nothing", async () => {
    const db = makeFakeDb();
    const mod = loadIndexFresh(db);
    await mod.onProjectDocWritten(fakeEvent({ docId: "d1", before: MIRROR, after: { ...MIRROR, name: "Renamed" } }));
    await mod.onProjectDocWritten(fakeEvent({ docId: "d2", before: { projectId: "p1", name: "Board", contentMd: "a" }, after: { projectId: "p1", name: "Board", contentMd: "b" } }));
    await mod.onProjectDocWritten(fakeEvent({ docId: "d3", before: undefined, after: MIRROR }));
    await mod.onProjectDocWritten(fakeEvent({ docId: "d4", before: { ...MIRROR, contentMd: "" }, after: MIRROR }));
    assert.strictEqual(revisions(db).length, 0);
  });

  await test("deleting a mirror records one projectDoc.deleted; deleting a board doc records nothing", async () => {
    const db = makeFakeDb();
    const mod = loadIndexFresh(db);
    await mod.onProjectDocWritten(fakeEvent({ docId: "d1", before: { ...MIRROR, updatedByEmail: "rob@offline2online.com" }, after: undefined }));
    await mod.onProjectDocWritten(fakeEvent({ docId: "d2", before: { projectId: "p1", name: "Board", contentMd: "a" }, after: undefined }));
    const r = revisions(db);
    assert.strictEqual(r.length, 1);
    assert.strictEqual(r[0].target, "projectDoc.deleted");
    assert.strictEqual(r[0].contentMd, "old text");
    assert.strictEqual(r[0].docId, "d1");
    assert.strictEqual(r[0].replacedByEmail, "rob@offline2online.com");
  });

  await test("a failing add is logged, never thrown", async () => {
    const db = makeFakeDb();
    const real = db.collection;
    db.collection = (name) => ({ ...real(name), add: async () => { throw new Error("boom"); } });
    await loadIndexFresh(db).onProjectDocWritten(fakeEvent({ docId: "d1", before: MIRROR, after: { ...MIRROR, contentMd: "new" } }));
  });

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) process.exit(1);
})();
