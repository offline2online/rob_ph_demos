// Every re-run the automation starts is recorded on the card that owns the run,
// so a pass on re-run is never silent (FkMuViqe2fQqcKr7MmqU, finishing
// EzkqnlhTeSu1ma47qjXN / 00a68803). Drives the REAL ejectRedCulprits and
// reportTrainTestResults over several sweeps with a fake `gh` on PATH and an
// in-memory Firestore. No network or credentials.
//
// Run with:  node test/train-rerun-sweeps.test.js
"use strict";
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "train-rerun-sweeps-"));
const stateFile = path.join(dir, "state.json");
const logFile = path.join(dir, "reruns.log");
fs.writeFileSync(logFile, "");
fs.mkdirSync(path.join(dir, "bin"));
fs.writeFileSync(path.join(dir, "bin", "gh"), `#!/usr/bin/env node
const fs = require("fs");
const st = JSON.parse(fs.readFileSync(${JSON.stringify(stateFile)}, "utf8"));
const a = process.argv.slice(2);
const j = a.join(" ");
const out = (v) => process.stdout.write(typeof v === "string" ? v : JSON.stringify(v));
let m;
if (a[0] === "run" && a[1] === "rerun") { fs.appendFileSync(${JSON.stringify(logFile)}, a[2] + "\\n"); out(""); }
else if (a[0] === "run" && a[1] === "list") { out(st.list[a[a.indexOf("--workflow") + 1]] || []); }
else if ((m = j.match(/branches\\/[^ ]+ /))) out(st.head);
else if ((m = j.match(/compare\\/main\\.\\.\\.[^ ]+/))) out(st.commits);
else if ((m = j.match(/compare\\/([0-9a-f]+)\\.\\.\\.([0-9a-f]+)/))) out(m[1] === m[2] ? { status: "identical", files: [] } : { status: "diverged", files: [] });
else if ((m = j.match(/actions\\/workflows\\/([^/]+)\\/runs\\?head_sha=([0-9a-f]+)/))) out(((st.bySha[m[1]] || {})[m[2]]) || []);
else if ((m = j.match(/commits\\/([0-9a-f]+)/))) out(a.includes("[.files[].filename]") ? ((st.files || {})[m[1]] || []) : "");
else out("");
`, { mode: 0o755 });
process.env.PATH = `${path.join(dir, "bin")}:${process.env.PATH}`;

const keyFile = path.join(dir, "sa.json");
const { privateKey } = require("crypto").generateKeyPairSync("rsa", { modulusLength: 2048 });
fs.writeFileSync(keyFile, JSON.stringify({ client_email: "t@t", private_key: privateKey.export({ type: "pkcs8", format: "pem" }) }));
process.env.GOOGLE_APPLICATION_CREDENTIALS = keyFile;

// In-memory Firestore: backlogItems as encoded field maps.
const docs = new Map();
global.fetch = async (url, o = {}) => {
  const reply = (status, body = {}) => ({ ok: status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });
  if (url.includes("oauth2")) return reply(200, { access_token: "t", expires_in: 3600 });
  if (url.endsWith(":runQuery")) {
    return reply(200, [...docs].filter(([n]) => n.includes("/backlogItems/")).map(([name, fields]) => ({ document: { name, fields } })));
  }
  if (url.endsWith(":commit")) {
    for (const w of JSON.parse(o.body).writes) {
      const name = w.update ? w.update.name : w.transform.document;
      const doc = docs.get(name);
      if (!doc) return reply(404, {});
      if (w.update) for (const k of w.updateMask.fieldPaths) doc[k] = w.update.fields[k];
      for (const ft of (w.updateTransforms || w.transform.fieldTransforms || [])) {
        const have = (doc[ft.fieldPath] && doc[ft.fieldPath].arrayValue.values) || [];
        doc[ft.fieldPath] = { arrayValue: { values: [...have, ...ft.appendMissingElements.values] } };
      }
    }
    return reply(200, { writeResults: [{}] });
  }
  if (url.includes("/projects/") && !url.includes("/backlogItems/")) return reply(200, { fields: {} });
  if ((o.method || "GET") === "PATCH") {
    const name = `projects/backlog-tracker-e4ed2/databases/(default)/documents/backlogItems/${url.split("/backlogItems/")[1].split("?")[0]}`;
    const doc = docs.get(name);
    for (const [k, v] of Object.entries(JSON.parse(o.body).fields)) doc[k] = v;
    return reply(200);
  }
  return reply(200);
};
const auto = require("../scripts/run-backlog-automation.js");

const WF = "firestore-rules-test.yml";
const LABEL = "console tests";
const sha = (c) => c.repeat(40);
const A = sha("a"), B = sha("b"), G = sha("9");
const enc = (v) => auto.tv(v);
function reset(cards, st) {
  docs.clear();
  for (const c of cards) {
    const { id, ...rest } = c;
    docs.set(`projects/backlog-tracker-e4ed2/databases/(default)/documents/backlogItems/${id}`,
      Object.fromEntries(Object.entries({ projectId: "P1", deployBranch: "deploy/x", ...rest }).map(([k, v]) => [k, enc(v)])));
  }
  fs.writeFileSync(stateFile, JSON.stringify({ list: {}, bySha: {}, commits: [], head: "", ...st }));
  fs.writeFileSync(logFile, "");
}
const setState = (patch) => fs.writeFileSync(stateFile, JSON.stringify({ ...JSON.parse(fs.readFileSync(stateFile, "utf8")), ...patch }));
const card = (id) => auto.fdoc(docs.get(`projects/backlog-tracker-e4ed2/databases/(default)/documents/backlogItems/${id}`));
const noteTexts = (id) => (card(id).notes || []).map((n) => n.text);
const reruns = () => fs.readFileSync(logFile, "utf8").split("\n").filter(Boolean);
const mkRun = (id, headSha, attempt, status, conclusion) => ({ id, attempt, headSha, status, conclusion, url: `https://gh/run/${id}` });
// One automation sweep, in main()'s order.
async function sweep() { await auto.ejectRedCulprits(); await auto.reportTrainTestResults(); }
// A run list for the branch and the same runs by sha, newest first.
function runs(...rs) {
  const bySha = {};
  for (const r of rs) (bySha[r.headSha] = bySha[r.headSha] || []).push(r);
  setState({ list: { [WF]: rs.map((r) => ({ ...r, databaseId: r.id })) }, bySha: { [WF]: bySha } });
}

let failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`ok - ${name}`); } catch (err) { failed++; console.error(`not ok - ${name}\n${err.stack}`); }
}
const rerunNotes = (id) => noteTexts(id).filter((t) => t.includes("Re-running it once"));
const flakyNotes = (id) => noteTexts(id).filter((t) => t.startsWith("Passed on re-run"));

(async () => {
  await test("(a) an approved card's own run: attempt 1 red, re-run, attempt 2 green — both notes and the key", async () => {
    reset([{ id: "c1", status: "ready-to-publish", deployCommit: A, deployCommits: [A] }],
      { head: A, commits: [{ sha: A, message: "Backlog item: c1" }] });
    runs(mkRun(100, A, 1, "completed", "failure"));
    await sweep();
    assert.deepStrictEqual(reruns(), ["100"]);
    assert.strictEqual(rerunNotes("c1").length, 1, noteTexts("c1").join("\n"));
    assert.ok(card("c1").trainTestReruns.includes(`${WF}@${A}:rerun:100`), JSON.stringify(card("c1").trainTestReruns));
    runs(mkRun(100, A, 2, "in_progress", ""));
    await sweep();
    assert.deepStrictEqual(reruns(), ["100"]);
    runs(mkRun(100, A, 2, "completed", "success"));
    await sweep();
    await sweep();
    assert.deepStrictEqual(reruns(), ["100"]);
    assert.strictEqual(rerunNotes("c1").length, 1);
    assert.strictEqual(flakyNotes("c1").length, 1, noteTexts("c1").join("\n"));
    assert.ok(flakyNotes("c1")[0].includes(LABEL));
    assert.ok(card("c1").trainTestReruns.includes(`${WF}@${A}:flaky:100`));
    assert.strictEqual(card("c1").status, "ready-to-publish");
  });

  await test("(b) the same with an earlier card's run still in progress", async () => {
    reset([
      { id: "c1", status: "ready-for-testing", deployCommit: A, deployCommits: [A] },
      { id: "c2", status: "ready-to-publish", deployCommit: B, deployCommits: [B] },
    ], { head: B, commits: [{ sha: A, message: "Backlog item: c1" }, { sha: B, message: "Backlog item: c2" }] });
    runs(mkRun(200, B, 1, "completed", "failure"), mkRun(199, A, 1, "in_progress", ""));
    await sweep();
    assert.deepStrictEqual(reruns(), ["200"]);
    assert.strictEqual(rerunNotes("c2").length, 1, noteTexts("c2").join("\n"));
    assert.strictEqual(rerunNotes("c1").length, 0);
    runs(mkRun(200, B, 2, "completed", "success"), mkRun(199, A, 1, "in_progress", ""));
    await sweep();
    assert.strictEqual(flakyNotes("c2").length, 1, noteTexts("c2").join("\n"));
    assert.strictEqual(flakyNotes("c1").length, 0);
  });

  await test("a generated-only commit after a card counts as that card", async () => {
    reset([{ id: "c1", status: "ready-to-publish", deployCommit: A, deployCommits: [A] }],
      { head: G, commits: [{ sha: A, message: "Backlog item: c1" }, { sha: G, message: "Rebuild the hosted prototype" }],
        files: { [G]: ["dsp-integration/prototype/index.html"] } });
    runs(mkRun(300, G, 1, "completed", "failure"));
    await sweep();
    assert.deepStrictEqual(reruns(), ["300"]);
    assert.strictEqual(rerunNotes("c1").length, 1, noteTexts("c1").join("\n"));
    assert.ok(card("c1").trainTestReruns.includes(`${WF}@${G}:rerun:300`));
  });

  await test("(c) a failed run on an older sha that no longer speaks for the head is not re-run", async () => {
    reset([
      { id: "c1", status: "ready-to-publish", deployCommit: A, deployCommits: [A] },
      { id: "c2", status: "ready-for-testing", deployCommit: B, deployCommits: [B] },
    ], { head: B, commits: [{ sha: A, message: "Backlog item: c1" }, { sha: B, message: "Backlog item: c2" }] });
    // compare/A...B reports "diverged" in the fake: not generated-only, so the head moved on
    runs(mkRun(400, A, 1, "completed", "failure"));
    await sweep();
    assert.deepStrictEqual(reruns(), []);
    assert.strictEqual(rerunNotes("c1").length, 0);
  });

  await test("(d) a second run on the same sha that fails on attempt 1 is re-run once", async () => {
    reset([{ id: "c1", status: "ready-to-publish", deployCommit: A, deployCommits: [A] }],
      { head: A, commits: [{ sha: A, message: "Backlog item: c1" }] });
    runs(mkRun(500, A, 1, "completed", "failure"));
    await sweep();
    runs(mkRun(500, A, 2, "completed", "success"));
    await sweep();
    assert.deepStrictEqual(reruns(), ["500"]);
    // a separate run on the same sha, red on attempt 1
    runs(mkRun(501, A, 1, "completed", "failure"), mkRun(500, A, 2, "completed", "success"));
    await sweep();
    await sweep(); // lag: GitHub still shows attempt 1 — not re-run twice
    assert.deepStrictEqual(reruns(), ["500", "501"]);
    assert.strictEqual(rerunNotes("c1").length, 2);
    runs(mkRun(501, A, 2, "completed", "success"));
    await sweep();
    assert.strictEqual(flakyNotes("c1").length, 2, noteTexts("c1").join("\n"));
  });

  await test("an old-form :rerun key still counts, and still yields a flaky note", async () => {
    reset([{ id: "c1", status: "ready-to-publish", deployCommit: A, deployCommits: [A], trainTestReruns: [`${WF}@${A}:rerun`] }],
      { head: A, commits: [{ sha: A, message: "Backlog item: c1" }] });
    runs(mkRun(600, A, 1, "completed", "failure"));
    await sweep();
    assert.deepStrictEqual(reruns(), []);
    runs(mkRun(600, A, 2, "completed", "success"));
    await sweep();
    assert.strictEqual(flakyNotes("c1").length, 1);
    assert.ok(card("c1").trainTestReruns.includes(`${WF}@${A}:flaky`));
  });

  await test("a run no train card owns is re-run and says so", async () => {
    reset([{ id: "c1", status: "ready-for-testing", deployCommit: A, deployCommits: [A] }],
      { head: G, commits: [{ sha: A, message: "Backlog item: c1" }, { sha: G, message: "Merge branch 'main'" }] });
    runs(mkRun(700, G, 1, "completed", "failure"));
    await sweep();
    assert.deepStrictEqual(reruns(), ["700"]);
    assert.strictEqual(rerunNotes("c1").length, 0);
  });

  fs.rmSync(dir, { recursive: true, force: true });
  if (failed) { console.error(`\n${failed} failed`); process.exit(1); }
  console.log("\nall passed");
})();
