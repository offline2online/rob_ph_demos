// Drives the REAL functions/index.js Cloud Function
// (onBacklogItemTrainLockRecompute) end to end, not a reimplementation of
// its logic — the same "require the real file under stubbed Firebase
// SDKs" approach test/mcp-server.test.js already uses for mcp-server.js
// (test/mcp-stubs.js), just with its own smaller stub set here because
// index.js pulls in a few modules (firebase-functions/params,
// firebase-admin/app, google-auth-library) mcp-stubs.js doesn't need to
// know about.
//
// No emulator, no credentials, no network, no installed firebase-admin/
// firebase-functions packages required — this sandbox has neither, which
// is exactly why index.js has never had a test before this.
//
// Run with:  node test/train-lock-trigger.test.js
"use strict";
const assert = require("assert");
const path = require("path");
const Module = require("module");

// ── A tiny in-memory Firestore stand-in — only the surface index.js's new
// trigger actually calls: collection().doc().get()/.set(merge), and
// collection().where(field,"==",value).get() returning {docs:[{data()}]}.
function makeFakeDb(seed) {
  const state = { projects: {}, backlogItems: {} };
  for (const [col, docs] of Object.entries(seed || {})) {
    for (const [id, data] of Object.entries(docs)) state[col][id] = data;
  }
  function resolveValue(v) {
    if (v && v.__sentinel === "serverTimestamp") return new Date().toISOString();
    return v;
  }
  function docRef(collection, id) {
    return {
      async get() {
        const raw = state[collection][id];
        return { exists: raw !== undefined, data: () => raw };
      },
      async set(data, opts) {
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
        if (op !== "==") throw new Error(`stub: unsupported operator ${op}`);
        return {
          async get() {
            const docs = Object.values(state[name]).filter((d) => d[field] === value).map((d) => ({ data: () => d }));
            return { docs };
          },
        };
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
    // Only pulled in because index.js's own final lines require
    // ./mcp-server, which needs this — never exercised by this test.
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

function fakeEvent({ itemId, before, after }) {
  return {
    params: { itemId },
    data: {
      before: before === undefined ? undefined : { data: () => before },
      after: after === undefined ? undefined : { data: () => after },
    },
  };
}

(async () => {
  await test("index.js loads and exports onBacklogItemTrainLockRecompute", () => {
    const db = makeFakeDb();
    const mod = loadIndexFresh(db);
    assert.strictEqual(typeof mod.onBacklogItemTrainLockRecompute, "function");
  });

  await test("THE TICKET, end to end through the real trigger: deleting the last approved ticket clears trainLocked, trainStatus and trainNote", async () => {
    const db = makeFakeDb({
      projects: {
        p1: { name: "Backlog Tracker & FAQs", trainLocked: true, trainStatus: "conflict", trainNote: "stale note from before the tickets were deleted" },
      },
      backlogItems: {
        // Every other approved ticket on this train was already deleted —
        // this is the last one, and this event is its own deletion.
      },
    });
    const mod = loadIndexFresh(db);

    await mod.onBacklogItemTrainLockRecompute(fakeEvent({
      itemId: "lastItem",
      before: { projectId: "p1", status: "ready-to-publish", deployCommit: "sha1" },
      after: undefined, // deleteDoc()
    }));

    const project = db.__state.projects.p1;
    assert.strictEqual(project.trainLocked, false, "trainLocked should be cleared");
    assert.strictEqual(project.trainStatus, "idle", "the stale trainStatus should be reset");
    assert.strictEqual(project.trainNote, null, "the stale trainNote should be cleared");
  });

  await test("deleting one of TWO approved tickets leaves the lock in place", async () => {
    const db = makeFakeDb({
      projects: { p1: { trainLocked: true, trainStatus: "idle" } },
      backlogItems: {
        stillThere: { projectId: "p1", status: "ready-to-publish", deployCommit: "sha2" },
      },
    });
    const mod = loadIndexFresh(db);

    await mod.onBacklogItemTrainLockRecompute(fakeEvent({
      itemId: "deletedOne",
      before: { projectId: "p1", status: "ready-to-publish", deployCommit: "sha1" },
      after: undefined,
    }));

    assert.strictEqual(db.__state.projects.p1.trainLocked, true, "another approved ticket is still on the train");
  });

  await test("Failed testing (status -> backlog, revertRequested written) does NOT clear the lock until the revert actually completes", async () => {
    const db = makeFakeDb({ projects: { p1: { trainLocked: true, trainStatus: "idle" } }, backlogItems: {} });
    const mod = loadIndexFresh(db);

    // app.js's failTesting(): status backlog, revertRequested true, the
    // commit is still untouched until processRevertFromTrain runs.
    await mod.onBacklogItemTrainLockRecompute(fakeEvent({
      itemId: "rejected1",
      before: { projectId: "p1", status: "ready-for-testing", deployCommit: "sha1" },
      after: { projectId: "p1", status: "backlog", revertRequested: true, deployCommit: "sha1" },
    }));
    assert.strictEqual(db.__state.projects.p1.trainLocked, true, "still on the branch until the revert finishes");
  });

  await test("...and DOES clear once run-backlog-automation.js's processRevertFromTrain finishes the revert", async () => {
    const db = makeFakeDb({ projects: { p1: { trainLocked: true, trainStatus: "idle" } }, backlogItems: {} });
    const mod = loadIndexFresh(db);

    // processRevertFromTrain's own successful-revert write: revertRequested
    // and deployCommit both clear together.
    await mod.onBacklogItemTrainLockRecompute(fakeEvent({
      itemId: "rejected1",
      before: { projectId: "p1", status: "backlog", revertRequested: true, deployCommit: "sha1" },
      after: { projectId: "p1", status: "backlog", revertRequested: false, deployCommit: null },
    }));
    assert.strictEqual(db.__state.projects.p1.trainLocked, false);
  });

  await test("a write that never touches train-relevant fields is a no-op (no project read/write happens)", async () => {
    const db = makeFakeDb({ projects: { p1: { trainLocked: true, trainStatus: "idle" } }, backlogItems: {} });
    const mod = loadIndexFresh(db);

    // A plain title edit on a Backlog card, nowhere near the train.
    await mod.onBacklogItemTrainLockRecompute(fakeEvent({
      itemId: "unrelated1",
      before: { projectId: "p1", status: "backlog", title: "Old title" },
      after: { projectId: "p1", status: "backlog", title: "New title" },
    }));
    assert.strictEqual(db.__state.projects.p1.trainLocked, true, "an unrelated edit must never touch the lock");
  });

  await test("never unlocks a project that's mid-deploy, even if this write looks like the train just emptied", async () => {
    const db = makeFakeDb({ projects: { p1: { trainLocked: true, trainStatus: "deploying" } }, backlogItems: {} });
    const mod = loadIndexFresh(db);

    await mod.onBacklogItemTrainLockRecompute(fakeEvent({
      itemId: "item1",
      before: { projectId: "p1", status: "ready-to-publish", deployCommit: "sha1" },
      after: { projectId: "p1", status: "published-live", deployCommit: "sha1" },
    }));
    assert.strictEqual(db.__state.projects.p1.trainLocked, true, "finishTrain() itself owns clearing the lock once it's done");
  });

  console.log(`\n${passed} passed, ${failures.length} failed\n`);
  if (failures.length) {
    for (const [name, err] of failures) console.error(`--- ${name}\n${err && err.stack ? err.stack : err}\n`);
    process.exit(1);
  }
})();
