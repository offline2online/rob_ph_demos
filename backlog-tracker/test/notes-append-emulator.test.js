// notesCommitWrite against the real Firestore emulator: a body the stub in
// notes-append.test.js accepts but Firestore rejects would stall every
// note-carrying write (patchItem throws on a non-OK reply).
// Run by `npm run test:rules` inside `firebase emulators:exec`.
"use strict";
const assert = require("assert");
const { notesCommitWrite } = require("../scripts/run-backlog-automation.js");

const HOST = process.env.FIRESTORE_EMULATOR_HOST;
if (!HOST) { console.error("FIRESTORE_EMULATOR_HOST not set — run via `npm run test:rules`"); process.exit(1); }
const DB = "projects/demo-backlog-tracker/databases/(default)/documents";
const BASE = `http://${HOST}/v1/${DB}`;
const H = { "Content-Type": "application/json", Authorization: "Bearer owner" };
const s = (v) => ({ stringValue: v });
const note = (text, at) => ({ mapValue: { fields: { author: s("claude"), text: s(text), at: s(at) } } });
const nameOf = (id) => `${DB}/backlogItems/${id}`;
const commit = (write) => fetch(`http://${HOST}/v1/${DB}:commit`, { method: "POST", headers: H, body: JSON.stringify({ writes: [write] }) });
const read = async (id) => (await (await fetch(`${BASE}/backlogItems/${id}`, { headers: H })).json()).fields;
const texts = (f) => f.notes.arrayValue.values.map((v) => v.mapValue.fields.text.stringValue);
const entry = (text, at) => ({ author: "backlog-automation", text, at });

(async () => {
  const seed = await fetch(`${BASE}/backlogItems?documentId=C1`, {
    method: "POST", headers: H,
    body: JSON.stringify({ fields: { desc: s("keep me"), status: s("backlog"), notes: { arrayValue: { values: [note("one", "2026-10-01T00:00:00Z"), note("two", "2026-10-02T00:00:00Z")] } } } }),
  });
  assert.ok(seed.ok, await seed.text());

  let r = await commit(notesCommitWrite(nameOf("C1"), [entry("three", "2026-10-03T00:00:00Z")], { status: "ready-for-testing", patchReady: false }));
  assert.ok(r.ok, await r.text());
  let f = await read("C1");
  assert.deepStrictEqual(texts(f), ["one", "two", "three"]);
  assert.strictEqual(f.status.stringValue, "ready-for-testing");
  assert.strictEqual(f.desc.stringValue, "keep me");

  r = await commit(notesCommitWrite(nameOf("C1"), [entry("four", "2026-10-04T00:00:00Z")]));
  assert.ok(r.ok, await r.text());
  f = await read("C1");
  assert.deepStrictEqual(texts(f), ["one", "two", "three", "four"]);
  assert.strictEqual(f.status.stringValue, "ready-for-testing");
  assert.strictEqual(f.desc.stringValue, "keep me");

  r = await commit(notesCommitWrite(nameOf("MISSING"), [entry("x", "2026-10-05T00:00:00Z")], { status: "backlog" }));
  assert.ok(!r.ok, "a write to a missing card must fail");
  assert.strictEqual((await fetch(`${BASE}/backlogItems/MISSING`, { headers: H })).status, 404);
  console.log("ok - notes-append-emulator");
})().catch((e) => { console.error(e); process.exit(1); });
