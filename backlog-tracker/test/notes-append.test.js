// A card's notes are only ever appended (8 Oct–19 Oct 2026: whole-array
// writes erased the notes on seven cards). Covers run-backlog-automation.js's
// appendNote / patchItem / notesCommitWrite against a stubbed REST endpoint,
// and the Routine's instructions. No emulator, credentials or network.
//
// Run with:  node test/notes-append.test.js
"use strict";
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

let failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`ok - ${name}`); } catch (err) { failed++; console.error(`not ok - ${name}\n${err.stack}`); }
}

const keyFile = path.join(os.tmpdir(), `notes-append-sa-${process.pid}.json`);
const { privateKey } = require("crypto").generateKeyPairSync("rsa", { modulusLength: 2048 });
fs.writeFileSync(keyFile, JSON.stringify({ client_email: "t@t", private_key: privateKey.export({ type: "pkcs8", format: "pem" }) }));
process.env.GOOGLE_APPLICATION_CREDENTIALS = keyFile;

// In-memory Firestore applying :commit writes (appendMissingElements included).
const docs = new Map();
let calls = [];
global.fetch = async (url, o = {}) => {
  const reply = (status, body = {}) => ({ ok: status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });
  if (url.includes("oauth2")) return reply(200, { access_token: "t", expires_in: 3600 });
  calls.push({ method: o.method || "GET", url, body: o.body ? JSON.parse(o.body) : null });
  if (url.endsWith(":commit")) {
    for (const w of JSON.parse(o.body).writes) {
      const t = w.transform || w;
      const name = w.update ? w.update.name : w.transform.document;
      const cur = docs.get(name);
      if (w.currentDocument && w.currentDocument.exists && !cur) return reply(404, { error: { status: "NOT_FOUND" } });
      const doc = cur || {};
      if (w.update) for (const k of w.updateMask.fieldPaths) doc[k] = w.update.fields[k];
      for (const ft of (w.updateTransforms || w.transform.fieldTransforms || [])) {
        const have = (doc[ft.fieldPath] && doc[ft.fieldPath].arrayValue.values) || [];
        const add = ft.appendMissingElements.values.filter((v) => !have.some((h) => JSON.stringify(h) === JSON.stringify(v)));
        doc[ft.fieldPath] = { arrayValue: { values: [...have, ...add] } };
      }
      docs.set(name, doc);
    }
    return reply(200, { writeResults: [{}] });
  }
  return reply(200);
};
const auto = require("../scripts/run-backlog-automation.js");
const NAME = "projects/backlog-tracker-e4ed2/databases/(default)/documents/backlogItems/X";
const old = () => [{ author: "claude", text: "OLD-ONE", at: "2026-10-01T00:00:00Z" }, { author: "claude", text: "OLD-TWO", at: "2026-10-02T00:00:00Z" }];
const textsOf = (doc) => doc.notes.arrayValue.values.map((v) => v.mapValue.fields.text.stringValue);

(async () => {
  docs.set(NAME, {});
  await test("appendNote + patchItem with other fields: one :commit, no PATCH", async () => {
    calls = [];
    const item = { id: "X", notes: old() };
    const notes = await auto.appendNote(item, "NEW");
    await auto.patchItem("X", { updatedAt: "t", patchReady: false, notes });
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].method, "POST");
    assert.ok(calls[0].url.endsWith("/documents:commit"));
    const [w] = calls[0].body.writes;
    assert.ok(w.update && !w.transform);
    assert.deepStrictEqual(w.updateMask.fieldPaths, ["updatedAt", "patchReady"]);
    assert.strictEqual(w.updateTransforms.length, 1);
    assert.strictEqual(w.updateTransforms[0].fieldPath, "notes");
    assert.strictEqual(w.updateTransforms[0].appendMissingElements.values.length, 1);
    assert.strictEqual(w.currentDocument.exists, true);
    assert.ok(!("notes" in w.update.fields));
  });

  await test("existing notes are never sent", async () => {
    calls = [];
    const item = { id: "X", notes: old() };
    await auto.patchItem("X", { updatedAt: "t", notes: await auto.appendNote(item, "NEW") });
    const body = calls[0].body ? JSON.stringify(calls[0].body) : "";
    assert.ok(!body.includes("OLD-ONE") && !body.includes("OLD-TWO"));
    assert.ok(body.includes("NEW"));
  });

  await test("notes only: a transform write, no update", async () => {
    calls = [];
    await auto.patchItem("X", { notes: await auto.appendNote({ id: "X", notes: old() }, "N") });
    const [w] = calls[0].body.writes;
    assert.ok(w.transform && !w.update && !w.updateMask);
    assert.strictEqual(w.transform.document, NAME);
    assert.strictEqual(w.transform.fieldTransforms[0].fieldPath, "notes");
    assert.strictEqual(w.currentDocument.exists, true);
  });

  await test("two appendNote calls, one patchItem: both, in order; item.notes holds old plus new", async () => {
    calls = [];
    const item = { id: "X", notes: old() };
    await auto.appendNote(item, "A");
    const notes = await auto.appendNote(item, "B");
    assert.deepStrictEqual(item.notes.map((n) => n.text), ["OLD-ONE", "OLD-TWO", "A", "B"]);
    await auto.patchItem("X", { updatedAt: "t", notes });
    const vals = calls[0].body.writes[0].updateTransforms[0].appendMissingElements.values;
    assert.deepStrictEqual(vals.map((v) => v.mapValue.fields.text.stringValue), ["A", "B"]);
    assert.strictEqual(vals[0].mapValue.fields.author.stringValue, "backlog-automation");
  });

  await test("a notes array not from appendNote throws and sends nothing", async () => {
    calls = [];
    await assert.rejects(() => auto.patchItem("X", { notes: old() }), /appendNote/);
    await assert.rejects(() => auto.patchItem("X", { notes: [] }));
    assert.strictEqual(calls.length, 0);
  });

  await test("no notes: the same PATCH as before", async () => {
    calls = [];
    await auto.patchItem("X", { patchReady: false, updatedAt: "t" });
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].method, "PATCH");
    assert.ok(calls[0].url.includes("/backlogItems/X?updateMask.fieldPaths=patchReady&updateMask.fieldPaths=updatedAt"));
  });

  await test("two writers appending to the same card keep both notes", async () => {
    docs.set(NAME, { notes: { arrayValue: { values: old().map((n) => ({ mapValue: { fields: Object.fromEntries(Object.entries(n).map(([k, v]) => [k, { stringValue: v }])) } })) } } });
    const staleA = { id: "X", notes: old() };
    const staleB = { id: "X", notes: old() }; // both read before either wrote
    const a = await auto.appendNote(staleA, "FROM-A");
    const b = await auto.appendNote(staleB, "FROM-B");
    await auto.patchItem("X", { updatedAt: "t", notes: a });
    await auto.patchItem("X", { notes: b });
    assert.deepStrictEqual(textsOf(docs.get(NAME)), ["OLD-ONE", "OLD-TWO", "FROM-A", "FROM-B"]);
  });

  await test("a note never recreates a deleted card", async () => {
    docs.delete(NAME);
    const nn = await auto.appendNote({ id: "X" }, "N");
    await assert.rejects(() => auto.patchItem("X", { notes: nn }), /404/);
    assert.ok(!docs.has(NAME));
  });

  await test("static: no whole-array notes write left in the automation or the Routine's instructions", async () => {
    const root = path.join(__dirname, "..");
    const script = fs.readFileSync(path.join(root, "scripts/run-backlog-automation.js"), "utf8");
    assert.ok(!script.includes("fieldPaths=notes"));
    const ri = fs.readFileSync(path.join(root, "ROUTINE_INSTRUCTIONS.md"), "utf8").replace(/\s+/g, " ");
    for (const bad of ["existing notes, unchanged", "existing `notes` array", "fetch-then-append", "no native array-append", "existing misses, unchanged", "fieldPaths=notes"]) {
      assert.ok(!ri.includes(bad), `ROUTINE_INSTRUCTIONS.md still says "${bad}"`);
    }
    assert.ok(ri.includes("appendMissingElements") && ri.includes(":commit"));
  });

  fs.rmSync(keyFile, { force: true });
  if (failed) { console.error(`${failed} failed`); process.exit(1); }
})();
