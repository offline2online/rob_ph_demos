// One automation note per event (Flow 6/9, jKM13xJ7PxW9THm3YQ9g). Covers
// appendNote's `key` (update in place, firstAt kept, people's notes never
// matched), and drives the REAL ejectRedCulprits and reportTrainTestResults
// over several sweeps with a fake `gh` on PATH and an in-memory Firestore that
// applies removeAllFromArray / appendMissingElements in commit order:
//   - failed → re-run → failed leaves one test note (naming the failing test)
//     and one send-back record;
//   - failed → re-run → passed leaves one note naming the flaky test;
//   - a five-cycle red train leaves one note per bystander, closed with its
//     duration when the train is green again;
//   - an approved ticket whose own commit fails twice, with main proven
//     green, is sent back (14 Nov 2026, d49d456) instead of a note asking a
//     person to use Failed testing.
// No network or credentials.
//
// Run with:  node test/note-keys.test.js
"use strict";
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "note-keys-"));
const stateFile = path.join(dir, "state.json");
fs.mkdirSync(path.join(dir, "bin"));
// A failed log in `gh run view --log-failed`'s shape (job, step, timestamp text).
const LOG = [
  "console\tRun npm run test:offline\t2026-11-14T00:40:00.0000000Z not ok 3 - bt-handover-docs",
  "console\tRun npm run test:offline\t2026-11-14T00:40:00.0000000Z   AssertionError [ERR_ASSERTION]: MCP.md cuts to 18538 characters, over 18500",
].join("\n");
fs.writeFileSync(path.join(dir, "bin", "gh"), `#!/usr/bin/env node
const fs = require("fs");
const st = JSON.parse(fs.readFileSync(${JSON.stringify(stateFile)}, "utf8"));
const a = process.argv.slice(2);
const j = a.join(" ");
const out = (v) => process.stdout.write(typeof v === "string" ? v : JSON.stringify(v));
let m;
if (a[0] === "run" && a[1] === "rerun") out("");
else if (a[0] === "run" && a[1] === "view") out(${JSON.stringify(LOG)});
else if (a[0] === "run" && a[1] === "list") out(st.list[a[a.indexOf("--workflow") + 1]] || []);
else if ((m = j.match(/branches\\/[^ ]+ /))) out(st.head);
else if ((m = j.match(/compare\\/main\\.\\.\\.[^ ]+/))) out(st.commits);
else if ((m = j.match(/compare\\/([0-9a-f]+)\\.\\.\\.([0-9a-f]+)/))) out(m[1] === m[2] ? { status: "identical", files: [] } : { status: "diverged", files: [] });
else if ((m = j.match(/actions\\/workflows\\/([^/]+)\\/runs\\?head_sha=([0-9a-f]+)/))) out(((st.bySha[m[1]] || {})[m[2]]) || []);
else if ((m = j.match(/commits\\/([0-9a-f]+)/))) out(a.includes("[.files[].filename]") ? [] : ((st.messages || {})[m[1]] || ""));
else out("");
`, { mode: 0o755 });
process.env.PATH = `${path.join(dir, "bin")}:${process.env.PATH}`;

const keyFile = path.join(dir, "sa.json");
const { privateKey } = require("crypto").generateKeyPairSync("rsa", { modulusLength: 2048 });
fs.writeFileSync(keyFile, JSON.stringify({ client_email: "t@t", private_key: privateKey.export({ type: "pkcs8", format: "pem" }) }));
process.env.GOOGLE_APPLICATION_CREDENTIALS = keyFile;

// In-memory Firestore. runQuery honours a status EQUAL / IN filter, the way
// the real one does (a card sent back leaves the train's query).
const DOCS = "projects/backlog-tracker-e4ed2/databases/(default)/documents";
const docs = new Map();
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function statusFilterOf(q) {
  const f = q && q.where && (q.where.fieldFilter || ((q.where.compositeFilter || {}).filters || []).map((x) => x.fieldFilter).find((x) => x && x.field.fieldPath === "status"));
  if (!f || f.field.fieldPath !== "status") return null;
  if (f.op === "IN") return f.value.arrayValue.values.map((v) => v.stringValue);
  if (f.op === "EQUAL") return [f.value.stringValue];
  return null;
}
global.fetch = async (url, o = {}) => {
  const reply = (status, body = {}) => ({ ok: status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });
  if (url.includes("oauth2")) return reply(200, { access_token: "t", expires_in: 3600 });
  if (url.endsWith(":runQuery")) {
    const q = JSON.parse(o.body).structuredQuery;
    const coll = q.from[0].collectionId;
    const statuses = statusFilterOf(q);
    return reply(200, [...docs].filter(([n, f]) => n.includes(`/${coll}/`) && (!statuses || statuses.includes((f.status || {}).stringValue)))
      .map(([name, fields]) => ({ document: { name, fields } })));
  }
  if (url.endsWith(":commit")) {
    for (const w of JSON.parse(o.body).writes) {
      const name = w.update ? w.update.name : w.transform.document;
      const doc = docs.get(name);
      if (!doc) return reply(404, {});
      if (w.update) for (const k of w.updateMask.fieldPaths) doc[k] = w.update.fields[k];
      for (const ft of (w.updateTransforms || w.transform.fieldTransforms || [])) {
        const have = (doc[ft.fieldPath] && doc[ft.fieldPath].arrayValue.values) || [];
        if (ft.removeAllFromArray) doc[ft.fieldPath] = { arrayValue: { values: have.filter((h) => !ft.removeAllFromArray.values.some((v) => same(v, h))) } };
        else doc[ft.fieldPath] = { arrayValue: { values: [...have, ...ft.appendMissingElements.values.filter((v) => !have.some((h) => same(v, h)))] } };
      }
    }
    return reply(200, { writeResults: [{}] });
  }
  const rel = url.startsWith(`https://firestore.googleapis.com/v1/${DOCS}/`) ? url.slice(`https://firestore.googleapis.com/v1/${DOCS}/`.length).split("?")[0] : null;
  if (rel && /^(projects|backlogItems)\/[^/]+$/.test(rel)) {
    const name = `${DOCS}/${rel}`;
    if ((o.method || "GET") === "GET") return docs.has(name) ? reply(200, { name, fields: docs.get(name) }) : reply(404, {});
    if (o.method === "PATCH") {
      const doc = docs.get(name) || {};
      const fields = JSON.parse(o.body).fields || {};
      const mask = [...url.matchAll(/updateMask\.fieldPaths=([^&]+)/g)].map((m) => decodeURIComponent(m[1]));
      for (const k of mask) { if (k in fields) doc[k] = fields[k]; else delete doc[k]; }
      docs.set(name, doc);
      return reply(200, { name, fields: doc });
    }
  }
  return reply(200, {});
};
const auto = require("../scripts/run-backlog-automation.js");

const WF = "firestore-rules-test.yml";
const sha = (c) => c.repeat(40);
const A = sha("a"), G = sha("9");
const enc = (v) => auto.tv(v);
function reset(cards, st, project = {}) {
  docs.clear();
  docs.set(`${DOCS}/projects/P1`, Object.fromEntries(Object.entries({ name: "P", deployBranch: "deploy/x", ...project }).map(([k, v]) => [k, enc(v)])));
  for (const c of cards) {
    const { id, ...rest } = c;
    docs.set(`${DOCS}/backlogItems/${id}`, Object.fromEntries(Object.entries({ projectId: "P1", deployBranch: "deploy/x", ...rest }).map(([k, v]) => [k, enc(v)])));
  }
  fs.writeFileSync(stateFile, JSON.stringify({ list: {}, bySha: {}, commits: [], head: "", messages: {}, ...st }));
}
const setState = (patch) => fs.writeFileSync(stateFile, JSON.stringify({ ...JSON.parse(fs.readFileSync(stateFile, "utf8")), ...patch }));
const card = (id) => auto.fdoc(docs.get(`${DOCS}/backlogItems/${id}`));
const project = () => auto.fdoc(docs.get(`${DOCS}/projects/P1`));
const notesOf = (id) => card(id).notes || [];
const mkRun = (id, headSha, attempt, status, conclusion) => ({ id, attempt, headSha, status, conclusion, url: `https://gh/run/${id}` });
async function sweep() { await auto.ejectRedCulprits(); await auto.reportTrainTestResults(); }
function runs(...rs) {
  const bySha = {};
  for (const r of rs) (bySha[r.headSha] = bySha[r.headSha] || []).push(r);
  setState({ list: { [WF]: rs.map((r) => ({ ...r, databaseId: r.id })) }, bySha: { [WF]: bySha } });
}

let failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`ok - ${name}`); } catch (err) { failed++; console.error(`not ok - ${name}\n${err.stack}`); }
}

(async () => {
  // ── 1. appendNote with a key ──────────────────────────────────────────────
  await test("same key updates in place and keeps firstAt; a different key appends", async () => {
    reset([{ id: "k1", status: "backlog", notes: [] }], {});
    const item = { id: "k1", notes: [] };
    await auto.patchItem("k1", { notes: await auto.appendNote(item, "one", { key: "train-test:x:wf" }) });
    const first = notesOf("k1")[0];
    assert.strictEqual(first.key, "train-test:x:wf");
    assert.strictEqual(first.firstAt, first.at);
    await new Promise((r) => setTimeout(r, 5));
    // a fresh read, as the next sweep would have
    const again = { id: "k1", notes: notesOf("k1") };
    await auto.patchItem("k1", { notes: await auto.appendNote(again, "two", { key: "train-test:x:wf" }) });
    let n = notesOf("k1");
    assert.strictEqual(n.length, 1, JSON.stringify(n));
    assert.strictEqual(n[0].text, "two");
    assert.strictEqual(n[0].firstAt, first.at);
    assert.notStrictEqual(n[0].at, first.at);
    const third = { id: "k1", notes: notesOf("k1") };
    await auto.patchItem("k1", { notes: await auto.appendNote(third, "other", { key: "revert:x" }) });
    n = notesOf("k1");
    assert.deepStrictEqual(n.map((x) => x.text), ["two", "other"]);
  });

  await test("two updates of one key in the same run leave one note", async () => {
    reset([{ id: "k2", status: "backlog", notes: [] }], {});
    const item = { id: "k2", notes: [] };
    await auto.patchItem("k2", { notes: await auto.appendNote(item, "a", { key: "k" }) });
    await auto.patchItem("k2", { notes: await auto.appendNote(item, "b", { key: "k" }) });
    await auto.patchItem("k2", { notes: await auto.appendNote(item, "c", { key: "k" }) });
    assert.deepStrictEqual(notesOf("k2").map((x) => x.text), ["c"]);
  });

  await test("people's and Claude's notes never carry or match a key; unkeyed notes always append", async () => {
    const person = { author: "someone@example.com", text: "mine", at: "2026-11-01T00:00:00Z", key: "k" };
    const claude = { author: "claude", text: "built", at: "2026-11-01T00:01:00Z", key: "k" };
    reset([{ id: "k3", status: "backlog", notes: [person, claude] }], {});
    const item = { id: "k3", notes: notesOf("k3") };
    await auto.patchItem("k3", { notes: await auto.appendNote(item, "auto", { key: "k" }) });
    await auto.patchItem("k3", { notes: await auto.appendNote(item, "plain") });
    await auto.patchItem("k3", { notes: await auto.appendNote(item, "plain 2") });
    const n = notesOf("k3");
    assert.deepStrictEqual(n.map((x) => x.text), ["mine", "built", "auto", "plain", "plain 2"]);
    assert.ok(!("key" in n[3]) && !("key" in n[4]));
    assert.strictEqual(auto.keyedNoteIndex([person, claude], "k"), -1);
  });

  await test("the removal write comes before the append, in one commit", async () => {
    const prev = { author: "backlog-automation", text: "old", at: "2026-11-01T00:00:00Z", key: "k", firstAt: "2026-11-01T00:00:00Z" };
    const item = { id: "k4", notes: [prev] };
    const notes = await auto.appendNote(item, "new", { key: "k" });
    const writes = auto.notesCommitWrites(`${DOCS}/backlogItems/k4`, notes.filter((x) => x !== prev), { updatedAt: "t" });
    assert.strictEqual(writes.length, 2);
    assert.ok(writes[0].transform.fieldTransforms[0].removeAllFromArray);
    assert.strictEqual(writes[0].transform.fieldTransforms[0].removeAllFromArray.values[0].mapValue.fields.text.stringValue, "old");
    assert.ok(writes[1].updateTransforms[0].appendMissingElements);
    assert.strictEqual(writes[1].updateTransforms[0].appendMissingElements.values[0].mapValue.fields.firstAt.stringValue, "2026-11-01T00:00:00Z");
  });

  await test("keys for silent builds and reverts name the attempt and the request", async () => {
    assert.strictEqual(auto.silentBuildNoteKey({ buildAttemptId: "abc" }), "build-silent:abc");
    assert.strictEqual(auto.revertNoteKey({ deployCommits: [A, G] }), `revert:${A}`);
    assert.strictEqual(auto.revertNoteKey({ deployCommit: G }), `revert:${G}`);
    assert.match(auto.redSpellEndNote("2026-11-14T00:00:00Z", Date.parse("2026-11-14T02:10:00Z"), "Ticket X"), /^Train was red for 2 h 10 min because of Ticket X; green again\./);
  });

  // ── 2. failed → re-run → failed / passed ─────────────────────────────────
  const trainOf = (status) => ([
    { id: "c0", title: "Earlier ticket", status: "ready-for-testing", deployCommit: G, deployCommits: [G] },
    { id: "c1", title: "Red ticket", status, deployCommit: A, deployCommits: [A] },
  ]);
  const trainState = { head: A, commits: [{ sha: G, message: "Backlog item: c0" }, { sha: A, message: "Backlog item: c1" }], messages: { [A]: "x\n\nBacklog item: c1", [G]: "x\n\nBacklog item: c0" } };
  const testKey = auto.noteKeys.trainTest(A, WF, 100);

  await test("failed, re-run, failed: one test note naming the failing test, one send-back record", async () => {
    reset(trainOf("ready-for-testing"), trainState);
    runs(mkRun(100, A, 1, "completed", "failure"), mkRun(90, G, 1, "completed", "success"));
    await sweep();
    let keyed = notesOf("c1").filter((n) => n.key === testKey);
    assert.strictEqual(keyed.length, 1, JSON.stringify(notesOf("c1")));
    assert.match(keyed[0].text, /Re-running it once/);
    assert.match(keyed[0].text, /bt-handover-docs — MCP\.md cuts to 18538 characters, over 18500/);
    runs(mkRun(100, A, 2, "completed", "failure"), mkRun(90, G, 1, "completed", "success"));
    await sweep();
    await sweep();
    const c1 = card("c1");
    assert.strictEqual(c1.status, "backlog");
    assert.strictEqual(c1.revertRequested, true);
    keyed = notesOf("c1").filter((n) => n.key === testKey);
    assert.strictEqual(keyed.length, 1, JSON.stringify(notesOf("c1"), null, 1));
    assert.match(keyed[0].text, /^Sent back automatically \(Failed testing \[tests\]\): Why: .*bt-handover-docs/);
    assert.strictEqual(notesOf("c1").length, 1, notesOf("c1").map((n) => n.text).join("\n"));
    assert.strictEqual((c1.sendBacks || []).length, 1);
    assert.ok(!notesOf("c1").some((n) => /use Failed testing/.test(n.text)));
    assert.strictEqual(notesOf("c0").length, 0, notesOf("c0").map((n) => n.text).join("\n"));
  });

  await test("failed, re-run, passed: one note naming the flaky test", async () => {
    reset(trainOf("ready-for-testing"), trainState);
    runs(mkRun(100, A, 1, "completed", "failure"), mkRun(90, G, 1, "completed", "success"));
    await sweep();
    runs(mkRun(100, A, 2, "completed", "success"), mkRun(90, G, 1, "completed", "success"));
    await sweep();
    await sweep();
    const n = notesOf("c1");
    assert.strictEqual(n.length, 1, n.map((x) => x.text).join("\n"));
    assert.strictEqual(n[0].key, testKey);
    assert.match(n[0].text, /^Passed on re-run: .*flaky: .*bt-handover-docs/);
    assert.strictEqual(card("c1").status, "ready-for-testing");
  });

  // ── 3. bystanders get one note per red spell ──────────────────────────────
  await test("a five-cycle red train leaves one note on a bystander, closed with its duration", async () => {
    const heads = ["1", "2", "3", "4", "5"].map(sha);
    reset([
      { id: "b1", title: "Bystander one", status: "ready-for-testing", deployCommit: A, deployCommits: [A] },
      { id: "b2", title: "Bystander two", status: "ready-to-publish", deployCommit: G, deployCommits: [G] },
    ], { head: heads[0], commits: [], messages: {} });
    for (const [i, h] of heads.entries()) {
      setState({ head: h });
      runs(mkRun(300 + i, h, 2, "completed", "failure"));
      await auto.reportTrainTestResults();
    }
    for (const id of ["b1", "b2"]) {
      const n = notesOf(id);
      assert.strictEqual(n.length, 1, `${id}: ${n.map((x) => x.text).join("\n")}`);
      assert.match(n[0].key, /^train-red:deploy\/x:/);
      assert.match(n[0].text, /cannot be pinned on one ticket/);
      assert.match(n[0].text, /Asked to look: whoever approves this project's Deploy to Main/);
      assert.match(n[0].text, new RegExp(heads[4].slice(0, 7)));
    }
    assert.ok(project().trainRedSpell && project().trainRedSpell.since);
    const green = sha("6");
    setState({ head: green });
    runs(mkRun(400, green, 1, "completed", "success"));
    await auto.reportTrainTestResults();
    for (const id of ["b1", "b2"]) {
      const n = notesOf(id);
      assert.strictEqual(n.length, 1, `${id}: ${n.map((x) => x.text).join("\n")}`);
      assert.match(n[0].text, /^Train was red for \d+ min because of .*; green again\./);
    }
    assert.ok(!project().trainTestsRed);
    assert.ok(!project().trainRedSpell);
  });

  // ── 4. the 14 Nov path ────────────────────────────────────────────────────
  await test("an approved ticket whose own commit fails twice, main proven green, is sent back and frees the train", async () => {
    reset(trainOf("ready-to-publish"), trainState);
    runs(mkRun(100, A, 2, "completed", "failure"), mkRun(90, G, 1, "completed", "success"));
    // GitHub still lists attempt 1's re-run key from the earlier sweep:
    const name = `${DOCS}/backlogItems/c1`;
    docs.get(name).trainTestReruns = enc([`${WF}@${A}:rerun:100`]);
    await sweep();
    const c1 = card("c1");
    assert.strictEqual(c1.status, "backlog", notesOf("c1").map((n) => n.text).join("\n"));
    assert.strictEqual(c1.revertRequested, true);
    assert.strictEqual(c1.lastFailureReason.category, "tests");
    assert.match(c1.lastFailureReason.summary, /bt-handover-docs/);
    assert.ok(!notesOf("c1").some((n) => /use Failed testing/.test(n.text)));
    assert.match(notesOf("c1").slice(-1)[0].text, /It had been approved, but its own commit fails this check/);
  });

  await test("the owner's failure note asks nothing of the person", async () => {
    const out = auto.trainFailureNotes({ workflow: WF, label: "console tests", sha: A, url: "u", cards: [{ id: "c1", deployCommit: A }], afterRerun: true, summary: "t — why", runId: 100 });
    assert.strictEqual(out.length, 1);
    assert.strictEqual(out[0].key, testKey);
    assert.ok(!/use Failed testing/.test(out[0].text), out[0].text);
    assert.match(out[0].text, /\(t — why\)/);
    assert.match(out[0].text, /Nothing to do\.$/);
  });

  fs.rmSync(dir, { recursive: true, force: true });
  if (failed) { console.error(`\n${failed} test(s) failed`); process.exit(1); }
  console.log("\nAll note-key tests passed");
})();
