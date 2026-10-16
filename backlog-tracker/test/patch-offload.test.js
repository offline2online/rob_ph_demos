// patchFiles moves off the card (Firebase cost review, 5 Oct 2026):
//  - functions/patch-offload.js, driven directly and through the REAL
//    onBacklogItemPatchFilesOffload trigger in functions/index.js (stubbed
//    Firebase SDKs, same approach as train-lock-trigger.test.js);
//  - run-backlog-automation.js's patchFilesFor / dropPatchFiles against a
//    stubbed Firestore REST endpoint.
// No emulator, credentials or network.
//
// Run with:  node test/patch-offload.test.js
"use strict";
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const Module = require("module");

const DELETE = { __sentinel: "delete" };
const FieldValue = {
  serverTimestamp: () => ({ __sentinel: "serverTimestamp" }),
  delete: () => DELETE,
  arrayUnion: (...items) => ({ __sentinel: "arrayUnion", items }),
};

// In-memory Firestore: documents keyed by full path; enough of the surface
// for patch-offload.js (collection/doc/sub-collection, runTransaction with
// get/set/update) and for index.js to load.
function makeFakeDb(seed = {}) {
  const docs = new Map(Object.entries(seed));
  let txCount = 0;
  const ref = (p) => ({
    path: p,
    collection: (c) => ({ doc: (id) => ref(`${p}/${c}/${id}`) }),
    async get() { return snapOf(p); },
  });
  const snapOf = (p) => ({ exists: docs.has(p), data: () => docs.get(p) });
  const resolve = (v) => (v && v.__sentinel === "serverTimestamp" ? "now" : v);
  return {
    docs,
    get txCount() { return txCount; },
    collection: (c) => ({ doc: (id) => ref(`${c}/${id}`), where() { return { async get() { return { docs: [] }; } }; } }),
    async runTransaction(fn) {
      txCount += 1;
      const writes = [];
      const tx = {
        async get(r) { return snapOf(r.path); },
        set(r, data) { writes.push(() => docs.set(r.path, Object.fromEntries(Object.entries(data).map(([k, v]) => [k, resolve(v)])))); },
        update(r, data) {
          writes.push(() => {
            const next = { ...docs.get(r.path) };
            for (const [k, v] of Object.entries(data)) { if (v === DELETE) delete next[k]; else next[k] = resolve(v); }
            docs.set(r.path, next);
          });
        },
      };
      const out = await fn(tx);
      writes.forEach((w) => w()); // committed together, after the reads
      return out;
    },
  };
}

function loadIndex(db) {
  const stubs = {
    "firebase-functions/v2/firestore": { onDocumentUpdated: (o, h) => h, onDocumentWritten: (o, h) => (typeof o === "function" ? o : h) },
    "firebase-functions/params": { defineSecret: () => ({ value: () => "" }) },
    "firebase-functions/logger": { info() {}, warn() {}, error() {}, debug() {} },
    "firebase-admin/app": { initializeApp: () => ({}) },
    "firebase-admin/firestore": { getFirestore: () => db, FieldValue },
    "firebase-admin/auth": { getAuth: () => ({}) },
    "firebase-functions/v2/https": { onRequest: (o, h) => h },
    "google-auth-library": { GoogleAuth: class {} },
  };
  const orig = Module._load;
  Module._load = function (req, ...rest) { return Object.prototype.hasOwnProperty.call(stubs, req) ? stubs[req] : orig.call(this, req, ...rest); };
  try {
    for (const m of ["../functions/index.js", "../functions/mcp-server.js"]) delete require.cache[require.resolve(m)];
    return require("../functions/index.js");
  } finally { Module._load = orig; }
}

const event = (itemId, after) => ({ params: { itemId }, data: { after: { data: () => after } } });
const FILES = [{ path: "backlog-tracker/public/js/app.js", content: "x".repeat(1000) }];

let passed = 0; const failures = [];
async function test(name, fn) {
  try { await fn(); passed += 1; console.log(`  ok  ${name}`); }
  catch (err) { failures.push(name); console.log(`FAIL  ${name}\n      ${err.stack || err}`); }
}

(async () => {
  const { offloadPatchFiles } = require("../functions/patch-offload.js");

  await test("moves patchFiles to pipeline/patch and deletes the field, atomically", async () => {
    const db = makeFakeDb({ "backlogItems/A": { title: "t", patchReady: true, patchBaseSha: "abc", patchFiles: FILES } });
    assert.strictEqual(await offloadPatchFiles(db, FieldValue, "A"), true);
    const item = db.docs.get("backlogItems/A");
    assert.ok(!("patchFiles" in item), "field removed from the card");
    assert.strictEqual(item.patchReady, true, "other fields untouched");
    assert.deepStrictEqual(db.docs.get("backlogItems/A/pipeline/patch").patchFiles, FILES);
    assert.strictEqual(db.docs.get("backlogItems/A/pipeline/patch").patchBaseSha, "abc");
  });

  await test("does nothing when the card carries no patchFiles (already moved, or never had any)", async () => {
    const db = makeFakeDb({ "backlogItems/A": { title: "t" }, "backlogItems/A/pipeline/patch": { patchFiles: FILES } });
    assert.strictEqual(await offloadPatchFiles(db, FieldValue, "A"), false);
    assert.deepStrictEqual(db.docs.get("backlogItems/A/pipeline/patch").patchFiles, FILES, "existing copy kept");
  });

  await test("moves the CURRENT files, not the event's (a re-patch in between wins)", async () => {
    const newer = [{ path: "x.js", content: "newer" }];
    const db = makeFakeDb({ "backlogItems/A": { patchFiles: newer }, "backlogItems/A/pipeline/patch": { patchFiles: FILES } });
    const mod = loadIndex(db);
    await mod.onBacklogItemPatchFilesOffload(event("A", { patchFiles: FILES })); // stale event payload
    assert.deepStrictEqual(db.docs.get("backlogItems/A/pipeline/patch").patchFiles, newer);
  });

  await test("the real trigger skips writes without patchFiles without opening a transaction", async () => {
    const db = makeFakeDb({ "backlogItems/A": { title: "t" } });
    const mod = loadIndex(db);
    assert.strictEqual(typeof mod.onBacklogItemPatchFilesOffload, "function");
    await mod.onBacklogItemPatchFilesOffload(event("A", { title: "t", notes: ["n"] }));
    await mod.onBacklogItemPatchFilesOffload(event("A", { patchFiles: [] }));
    await mod.onBacklogItemPatchFilesOffload({ params: { itemId: "A" }, data: { after: { data: () => undefined } } }); // a delete
    assert.strictEqual(db.txCount, 0);
  });

  await test("the real trigger moves the files on a Routine's patch write", async () => {
    const db = makeFakeDb({ "backlogItems/A": { patchReady: true, patchFiles: FILES } });
    const mod = loadIndex(db);
    await mod.onBacklogItemPatchFilesOffload(event("A", { patchReady: true, patchFiles: FILES }));
    assert.ok(!("patchFiles" in db.docs.get("backlogItems/A")));
    assert.deepStrictEqual(db.docs.get("backlogItems/A/pipeline/patch").patchFiles, FILES);
  });

  // ── run-backlog-automation.js side, against a stubbed REST endpoint ──
  const keyFile = path.join(os.tmpdir(), `patch-offload-sa-${process.pid}.json`);
  const { privateKey } = require("crypto").generateKeyPairSync("rsa", { modulusLength: 2048 });
  fs.writeFileSync(keyFile, JSON.stringify({ client_email: "t@t", private_key: privateKey.export({ type: "pkcs8", format: "pem" }) }));
  process.env.GOOGLE_APPLICATION_CREDENTIALS = keyFile;
  const rest = new Map(); const calls = [];
  const enc = (v) => (Array.isArray(v) ? { arrayValue: { values: v.map(enc) } } : typeof v === "object" ? { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, enc(x)])) } } : { stringValue: String(v) });
  global.fetch = async (url, o = {}) => {
    const reply = (status, body = {}) => ({ ok: status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });
    if (url.includes("oauth2")) return reply(200, { access_token: "t", expires_in: 3600 });
    const p = decodeURIComponent(url.split("/documents/")[1]).split("?")[0];
    calls.push(`${o.method || "GET"} ${p}`);
    if (o.method === "DELETE") { const had = rest.delete(p); return reply(had ? 200 : 404); }
    if (o.method === "PATCH") return reply(200);
    // A collection list (dropPatchFiles listing patchParts).
    if (p.endsWith("/patchParts")) {
      const docs = [...rest.keys()].filter((k) => k.startsWith(`${p}/`)).map((k) => ({ name: `projects/x/databases/(default)/documents/${k}` }));
      return reply(200, docs.length ? { documents: docs } : {});
    }
    return rest.has(p) ? reply(200, { fields: Object.fromEntries(Object.entries(rest.get(p)).map(([k, v]) => [k, enc(v)])) }) : reply(404);
  };
  const auto = require("../scripts/run-backlog-automation.js");

  await test("patchFilesFor uses the card's own field when it still has one, without a read", async () => {
    calls.length = 0;
    assert.deepStrictEqual(await auto.patchFilesFor({ id: "A", patchFiles: FILES }), FILES);
    assert.deepStrictEqual(calls, []);
  });

  await test("patchFilesFor reads pipeline/patch once the field has been moved", async () => {
    rest.set("backlogItems/B/pipeline/patch", { patchFiles: FILES });
    assert.deepStrictEqual(await auto.patchFilesFor({ id: "B" }), FILES);
  });

  await test("patchFilesFor returns [] when neither holds files (the 'nothing to apply' path)", async () => {
    assert.deepStrictEqual(await auto.patchFilesFor({ id: "C" }), []);
  });

  const MORE = [{ path: "dsp-integration/packages/types/src/openapi.d.ts", content: "big" }];
  const EVEN_MORE = [{ path: "dsp-integration/docs/dsp-integration/api/openapi.yaml", content: "bigger" }];

  await test("patchFilesFor appends parts 1..patchPartCount after the card's own files, in order", async () => {
    rest.set("backlogItems/P/patchParts/1", { patchFiles: MORE, patchBaseSha: "s1" });
    rest.set("backlogItems/P/patchParts/2", { patchFiles: EVEN_MORE, patchBaseSha: "s1" });
    assert.deepStrictEqual(await auto.patchFilesFor({ id: "P", patchFiles: FILES, patchBaseSha: "s1", patchPartCount: 2 }), [...FILES, ...MORE, ...EVEN_MORE]);
  });

  await test("patchFilesFor reads parts even after the card's own files moved to pipeline/patch", async () => {
    rest.set("backlogItems/P/pipeline/patch", { patchFiles: FILES });
    assert.deepStrictEqual(await auto.patchFilesFor({ id: "P", patchBaseSha: "s1", patchPartCount: 1 }), [...FILES, ...MORE]);
  });

  await test("a stale patchPartCount (part 1 from another build, or gone) is ignored, not applied", async () => {
    assert.deepStrictEqual(await auto.patchFilesFor({ id: "P", patchFiles: FILES, patchBaseSha: "s2", patchPartCount: 2 }), FILES);
    assert.deepStrictEqual(await auto.patchFilesFor({ id: "Q", patchFiles: FILES, patchBaseSha: "s2", patchPartCount: 1 }), FILES);
  });

  await test("a missing or foreign later part throws rather than landing half a patch", async () => {
    await assert.rejects(auto.patchFilesFor({ id: "P", patchFiles: FILES, patchBaseSha: "s1", patchPartCount: 3 }), /part 3 of 3/);
    rest.set("backlogItems/P/patchParts/2", { patchFiles: EVEN_MORE, patchBaseSha: "old" });
    await assert.rejects(auto.patchFilesFor({ id: "P", patchFiles: FILES, patchBaseSha: "s1", patchPartCount: 2 }), /left over from another build/);
  });

  await test("dropPatchFiles also deletes every patch part", async () => {
    calls.length = 0;
    await auto.dropPatchFiles("P");
    assert.ok(!rest.has("backlogItems/P/patchParts/1") && !rest.has("backlogItems/P/patchParts/2"));
    assert.ok(calls.includes("DELETE backlogItems/P/patchParts/1") && calls.includes("DELETE backlogItems/P/patchParts/2"));
  });

  await test("dropPatchFiles clears the field and deletes the sub-document", async () => {
    calls.length = 0;
    rest.set("backlogItems/B/pipeline/patch", { patchFiles: FILES });
    await auto.dropPatchFiles("B");
    assert.deepStrictEqual(calls, ["PATCH backlogItems/B", "DELETE backlogItems/B/pipeline/patch", "GET backlogItems/B/patchParts"]);
    assert.ok(!rest.has("backlogItems/B/pipeline/patch"));
  });

  fs.unlinkSync(keyFile);
  console.log(`\n${passed} passed, ${failures.length} failed`);
  process.exit(failures.length ? 1 : 0);
})();
