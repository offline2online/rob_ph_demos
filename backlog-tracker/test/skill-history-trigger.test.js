// Drives the REAL functions/index.js Cloud Function (onSkillWritten) end to
// end, not a reimplementation of its logic — same "require the real file
// under stubbed Firebase SDKs" approach as test/train-lock-trigger.test.js,
// with its own small fake-Firestore stub extended to support .add() (new
// docRevisions docs) and a two-filter .where().where() query (the
// delete-dedup check).
//
// What this covers (see onSkillWritten's own comment in functions/index.js
// for the full reasoning): a skill edited on the console can't write
// docRevisions itself (firestore.rules denies it from the browser), so this
// trigger backfills the same audit trail an MCP-originated update_skill/
// delete_skill already writes inline — without ever recording the same
// change twice.
//
// No emulator, no credentials, no network, no installed firebase-admin/
// firebase-functions packages required.
//
// Run with:  node test/skill-history-trigger.test.js
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

function fakeEvent({ skillId, before, after }) {
  return {
    params: { skillId },
    data: {
      before: before === undefined ? undefined : { data: () => before },
      after: after === undefined ? undefined : { data: () => after },
    },
  };
}

const FILES_V1 = [{ path: "SKILL.md", content: "v1" }];
const FILES_V2 = [{ path: "SKILL.md", content: "v2" }];

(async () => {
  await test("index.js loads and exports onSkillWritten", () => {
    const db = makeFakeDb();
    const mod = loadIndexFresh(db);
    assert.strictEqual(typeof mod.onSkillWritten, "function");
  });

  await test("creation (no before doc) is a no-op — nothing was replaced yet", async () => {
    const db = makeFakeDb();
    const mod = loadIndexFresh(db);
    await mod.onSkillWritten(fakeEvent({
      skillId: "s1",
      before: undefined,
      after: { name: "New skill", slug: "new-skill", files: FILES_V1, lastWriteVia: "console" },
    }));
    assert.strictEqual(Object.keys(db.__state.docRevisions || {}).length, 0);
  });

  await test("console-originated file change records a docRevisions entry", async () => {
    const db = makeFakeDb();
    const mod = loadIndexFresh(db);
    await mod.onSkillWritten(fakeEvent({
      skillId: "s1",
      before: { name: "Skill One", slug: "skill-one", files: FILES_V1, updatedByEmail: "rob@offline2online.com" },
      after: { name: "Skill One", slug: "skill-one", files: FILES_V2, updatedByEmail: "rob@offline2online.com", lastWriteVia: "console" },
    }));
    const revisions = Object.values(db.__state.docRevisions || {});
    assert.strictEqual(revisions.length, 1);
    assert.strictEqual(revisions[0].target, "skill");
    assert.strictEqual(revisions[0].skillId, "s1");
    assert.strictEqual(revisions[0].via, "console");
    assert.deepStrictEqual(JSON.parse(revisions[0].contentMd), FILES_V1, "should preserve the file set BEFORE this write, not after");
  });

  await test("MCP-originated file change is skipped — update_skill already recorded it inline", async () => {
    const db = makeFakeDb({
      // Simulates update_skill's own recordDocRevision call, which runs
      // BEFORE the skills/{id} write commits — so by the time this trigger
      // fires, the revision already exists.
      docRevisions: { existing1: { target: "skill", skillId: "s1", contentMd: JSON.stringify(FILES_V1) } },
    });
    const mod = loadIndexFresh(db);
    await mod.onSkillWritten(fakeEvent({
      skillId: "s1",
      before: { name: "Skill One", slug: "skill-one", files: FILES_V1 },
      after: { name: "Skill One", slug: "skill-one", files: FILES_V2, updatedByEmail: "agent@offline2online.com", lastWriteVia: "mcp" },
    }));
    assert.strictEqual(Object.keys(db.__state.docRevisions).length, 1, "no second revision should have been written");
  });

  await test("no file change (name/summary/owningTeam only) is a no-op regardless of lastWriteVia", async () => {
    const db = makeFakeDb();
    const mod = loadIndexFresh(db);
    await mod.onSkillWritten(fakeEvent({
      skillId: "s1",
      before: { name: "Old name", slug: "skill-one", files: FILES_V1 },
      after: { name: "New name", slug: "skill-one", files: FILES_V1, lastWriteVia: "console" },
    }));
    assert.strictEqual(Object.keys(db.__state.docRevisions || {}).length, 0);
  });

  await test("console-originated delete records a skill.deleted docRevisions entry", async () => {
    const db = makeFakeDb();
    const mod = loadIndexFresh(db);
    await mod.onSkillWritten(fakeEvent({
      skillId: "s1",
      before: { name: "Skill One", slug: "skill-one", version: "1.0.0", files: FILES_V1, updatedByEmail: "rob@offline2online.com" },
      after: undefined,
    }));
    const revisions = Object.values(db.__state.docRevisions || {});
    assert.strictEqual(revisions.length, 1);
    assert.strictEqual(revisions[0].target, "skill.deleted");
    assert.strictEqual(revisions[0].via, "console");
    const parsed = JSON.parse(revisions[0].contentMd);
    assert.deepStrictEqual(parsed.files, FILES_V1);
  });

  await test("MCP-originated delete is skipped — delete_skill already recorded one", async () => {
    const db = makeFakeDb({
      docRevisions: { existing1: { target: "skill.deleted", skillId: "s1", contentMd: "{}" } },
    });
    const mod = loadIndexFresh(db);
    await mod.onSkillWritten(fakeEvent({
      skillId: "s1",
      before: { name: "Skill One", slug: "skill-one", files: FILES_V1 },
      after: undefined,
    }));
    assert.strictEqual(Object.keys(db.__state.docRevisions).length, 1, "no second skill.deleted revision should have been written");
  });

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) process.exit(1);
})();
