// A ticket is never sent back for a failure main already has (20 Oct 2026,
// NBQ1scD9GFEr6YbQxSYX). kanban-staff-board/ reached main with no line in
// START-HERE.md's deploy map, so bt-handover-docs.test.js was red on main
// itself; the train merged that main in before the ticket landed, and the
// ticket was sent back, reverted and rebuilt twice for it. Drives the REAL
// ejectRedCulprits with a fake `gh` on PATH and an in-memory Firestore, plus
// the pure helpers. No network or credentials.
//
// Run with:  node test/train-base-check.test.js
"use strict";
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "train-base-check-"));
const stateFile = path.join(dir, "state.json");
const logFile = path.join(dir, "gh.log");
fs.writeFileSync(logFile, "");
fs.mkdirSync(path.join(dir, "bin"));
fs.writeFileSync(path.join(dir, "bin", "gh"), `#!/usr/bin/env node
const fs = require("fs");
const st = JSON.parse(fs.readFileSync(${JSON.stringify(stateFile)}, "utf8"));
const a = process.argv.slice(2);
const j = a.join(" ");
fs.appendFileSync(${JSON.stringify(logFile)}, j + "\\n");
const out = (v) => process.stdout.write(typeof v === "string" ? v : JSON.stringify(v));
let m;
if (a[0] === "run" && a[1] === "rerun") out("");
else if (a[0] === "run" && a[1] === "view") out(st.failedLog || "");
else if (a[0] === "workflow" && a[1] === "run") out("");
else if (a[0] === "api" && a[1] === "-X") out("{}");
else if ((m = j.match(/compare\\/main\\.\\.\\.([0-9a-f]{40}) -q \\.merge_base_commit\\.sha/))) out((st.base || {})[m[1]] || "");
else if (/commits\\/main -q \\.sha/.test(j)) out(st.mainHead || "");
else if ((m = j.match(/compare\\/main\\.\\.\\.[^ ]+/))) out(st.commits);
else if ((m = j.match(/actions\\/workflows\\/([^/]+)\\/runs\\?head_sha=([0-9a-f]+)/))) out(((st.bySha[m[1]] || {})[m[2]]) || []);
else if ((m = j.match(/commits\\/([0-9a-f]+)/))) out(a.includes("[.files[].filename]") ? ((st.files || {})[m[1]] || ["backlog-tracker/x.js"]) : "");
else out("");
`, { mode: 0o755 });
process.env.PATH = `${path.join(dir, "bin")}:${process.env.PATH}`;

const keyFile = path.join(dir, "sa.json");
const { privateKey } = require("crypto").generateKeyPairSync("rsa", { modulusLength: 2048 });
fs.writeFileSync(keyFile, JSON.stringify({ client_email: "t@t", private_key: privateKey.export({ type: "pkcs8", format: "pem" }) }));
process.env.GOOGLE_APPLICATION_CREDENTIALS = keyFile;

const docs = new Map();
const DOC = (id) => `projects/backlog-tracker-e4ed2/databases/(default)/documents/backlogItems/${id}`;
global.fetch = async (url, o = {}) => {
  const reply = (status, body = {}) => ({ ok: status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });
  if (url.includes("oauth2")) return reply(200, { access_token: "t", expires_in: 3600 });
  if (url.endsWith(":runQuery")) return reply(200, [...docs].map(([name, fields]) => ({ document: { name, fields } })));
  if (url.endsWith(":commit")) {
    for (const w of JSON.parse(o.body).writes) {
      const name = w.update ? w.update.name : w.transform.document;
      const d = docs.get(name);
      if (!d) return reply(404, {});
      if (w.update) for (const k of w.updateMask.fieldPaths) d[k] = w.update.fields[k];
      for (const ft of (w.updateTransforms || w.transform.fieldTransforms || [])) {
        const have = (d[ft.fieldPath] && d[ft.fieldPath].arrayValue.values) || [];
        d[ft.fieldPath] = { arrayValue: { values: [...have, ...ft.appendMissingElements.values] } };
      }
    }
    return reply(200, { writeResults: [{}] });
  }
  if (url.includes("/projects/") && !url.includes("/backlogItems/")) return reply(200, { fields: {} });
  if ((o.method || "GET") === "PATCH") {
    const d = docs.get(DOC(url.split("/backlogItems/")[1].split("?")[0]));
    for (const [k, v] of Object.entries(JSON.parse(o.body).fields)) d[k] = v;
    return reply(200);
  }
  return reply(200);
};
const auto = require("../scripts/run-backlog-automation.js");
const { heldDeployMainPlan, heldDeployMainRedNote, baseCheckAction, failureSummaryFromLog, isMainMergeCommit, evidenceCandidates, BASE_CHECK_GIVE_UP_MS, baseCheckRef } = auto;

const WF = "firestore-rules-test.yml";
const sha = (c) => c.repeat(40);
const A = sha("a"), M = sha("e"), B = sha("b"), X = sha("c"), Y = sha("d");
const run_ = (id, headSha, attempt, status, conclusion) => ({ id, attempt, headSha, status, conclusion, url: `https://gh/run/${id}` });

// The two real failures of 20 Oct 2026, as `gh run view --log-failed` prints them.
const LOG_DEPLOY_MAP = [
  "rules\tRun deployment train tests\t2026-10-20T22:56:31.9056651Z   ok  START-HERE.md: every function it cites is declared",
  "rules\tRun deployment train tests\t2026-10-20T22:56:31.9065947Z FAIL  START-HERE.md: the deploy map names every top-level folder",
  "rules\tRun deployment train tests\t2026-10-20T22:56:31.9067179Z       AssertionError [ERR_ASSERTION]: the deploy map in START-HERE.md does not name kanban-staff-board/",
  "rules\tRun deployment train tests\t2026-10-20T22:56:31.9068630Z     at /home/runner/work/x.js:133:32",
  "rules\tRun deployment train tests\t2026-10-20T22:56:31.9166194Z ##[error]Process completed with exit code 1.",
].join("\n");
const LOG_AUTH_GATE = [
  "rules\tRun sign-in wall tests\t2026-10-20T22:43:44.5493867Z   ok  a remembered session shows the console shell straight away",
  "rules\tRun sign-in wall tests\t2026-10-20T22:43:44.7402589Z FAIL  with a role claim on the token, the board starts without waiting on any network call",
  "rules\tRun sign-in wall tests\t2026-10-20T22:43:44.7403159Z       app.js is not held back behind the function",
  "rules\tRun sign-in wall tests\t2026-10-20T22:43:46.5708691Z ##[error]Process completed with exit code 1.",
].join("\n");

function reset(cards, st) {
  docs.clear();
  for (const c of cards) {
    const { id, ...rest } = c;
    docs.set(DOC(id), Object.fromEntries(Object.entries({ projectId: "P1", deployBranch: "deploy/x", ...rest }).map(([k, v]) => [k, auto.tv(v)])));
  }
  fs.writeFileSync(stateFile, JSON.stringify({ bySha: {}, commits: [], ...st }));
  fs.writeFileSync(logFile, "");
}
const setState = (patch) => fs.writeFileSync(stateFile, JSON.stringify({ ...JSON.parse(fs.readFileSync(stateFile, "utf8")), ...patch }));
const card = (id) => auto.fdoc(docs.get(DOC(id)));
const notes = (id) => (card(id).notes || []).map((n) => n.text);
const ghCalls = () => fs.readFileSync(logFile, "utf8").split("\n").filter(Boolean);
const memoRuns = () => (workflow, s) => {
  const st = JSON.parse(fs.readFileSync(stateFile, "utf8"));
  return ((st.bySha[workflow] || {})[s]) || [];
};
const sweep = () => auto.ejectRedCulprits(memoRuns());

let failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ok  ${name}`); } catch (err) { failed++; console.log(`FAIL  ${name}\n      ${err.stack}`); }
}

(async () => {
  // 21 Oct 2026: main went red (a workflow without its TRAIN_TEST_WORKFLOWS
  // line), DSP's approved deploy was held "fix it on deploy/dsp-integration",
  // and fixing main didn't release it.
  await test("heldDeployMainPlan: red on main too blames main; fixed main is taken once per main tip", async () => {
    const red = [{ workflow: WF }];
    const fixed = { [WF]: { verdict: "passed", onTrain: false } };
    assert.deepStrictEqual(heldDeployMainPlan({ red, onBase: { [WF]: "failed" }, onMain: { [WF]: { verdict: "failed", onTrain: true } }, mainHead: X }), { mainRed: true, resync: null });
    assert.deepStrictEqual(heldDeployMainPlan({ red, onBase: { [WF]: "rerun" }, onMain: fixed, mainHead: Y }), { mainRed: true, resync: Y });
    assert.deepStrictEqual(heldDeployMainPlan({ red, onBase: { [WF]: "failed" }, onMain: fixed, mainHead: Y, resyncedTo: Y }), { mainRed: true, resync: null }, "never twice for one main tip");
    assert.deepStrictEqual(heldDeployMainPlan({ red, onBase: { [WF]: "passed" }, onMain: { [WF]: { verdict: "passed", onTrain: true } }, mainHead: Y }), { mainRed: false, resync: null }, "the train's own red: as before");
    assert.deepStrictEqual(heldDeployMainPlan({ red, onBase: {}, onMain: {}, mainHead: Y }), { mainRed: false, resync: null }, "unknown blames nobody");
    assert.deepStrictEqual(heldDeployMainPlan({ red: [{ workflow: WF }, { workflow: "b.yml" }], onBase: { [WF]: "failed", "b.yml": "passed" }, onMain: fixed, mainHead: Y }), { mainRed: false, resync: null }, "every red workflow must be fixed on main");
    assert.deepStrictEqual(heldDeployMainPlan({ red: [], onBase: {}, onMain: {}, mainHead: Y }), { mainRed: false, resync: null });
    assert.ok(/main is broken, not this train/.test(heldDeployMainRedNote("console tests failed", "0db46cc")));
  });

  await test("baseCheckAction: green base ejects, red base holds, attempt-1 red re-runs main, running waits", async () => {
    const at = (o) => baseCheckAction({ workflow: WF, baseSha: X, keys: [], nowMs: 1e12, ...o });
    assert.deepStrictEqual(at({ baseRun: run_(1, X, 1, "completed", "success") }), { act: "eject", why: "base-green" });
    assert.deepStrictEqual(at({ baseRun: run_(1, X, 2, "completed", "failure") }), { act: "hold" });
    assert.deepStrictEqual(at({ baseRun: run_(1, X, 1, "completed", "failure") }), { act: "rerun-base" });
    assert.deepStrictEqual(at({ baseRun: run_(1, X, 1, "in_progress", "") }), { act: "wait" });
    assert.deepStrictEqual(at({ baseSha: "" }), { act: "eject", why: "no-base" });
  });

  await test("baseCheckAction: no run on main yet is dispatched once, waited on, and given up after an hour", async () => {
    assert.deepStrictEqual(baseCheckAction({ workflow: WF, baseSha: X, baseRun: null, keys: [], nowMs: 1e12 }), { act: "dispatch" });
    const keys = [`${WF}@${X}:base:${1e12}`];
    assert.deepStrictEqual(baseCheckAction({ workflow: WF, baseSha: X, baseRun: null, keys, nowMs: 1e12 + 60000 }), { act: "wait" });
    assert.deepStrictEqual(baseCheckAction({ workflow: WF, baseSha: X, baseRun: null, keys, nowMs: 1e12 + BASE_CHECK_GIVE_UP_MS }), { act: "eject", why: "base-never-ran" });
    assert.deepStrictEqual(baseCheckAction({ workflow: WF, baseSha: Y, baseRun: null, keys, nowMs: 1e12 }), { act: "dispatch" }, "a dispatch for another main commit doesn't count");
  });

  await test("failureSummaryFromLog: the failing test and its message, on one line", async () => {
    assert.strictEqual(failureSummaryFromLog(LOG_DEPLOY_MAP),
      "deployment train tests: START-HERE.md: the deploy map names every top-level folder — the deploy map in START-HERE.md does not name kanban-staff-board/");
    assert.strictEqual(failureSummaryFromLog(LOG_AUTH_GATE),
      "sign-in wall tests: with a role claim on the token, the board starts without waiting on any network call — app.js is not held back behind the function");
    assert.strictEqual(failureSummaryFromLog("e2e\tRun npx playwright test\t2026-10-20T10:00:00.0Z   ✘  3 [chromium] › tests/booking.spec.ts:12:5 › books a slot (1.2s)\ne2e\tRun npx playwright test\t2026-10-20T10:00:00.1Z     Error: expect(received).toBe(expected)"),
      "npx playwright test: 3 [chromium] › tests/booking.spec.ts:12:5 › books a slot — expect(received).toBe(expected)");
    assert.strictEqual(failureSummaryFromLog("rules\tRun npm ci\t2026-10-20T10:00:00.0Z ##[error]Process completed with exit code 1."), "npm ci failed");
    assert.strictEqual(failureSummaryFromLog(""), "");
    assert.ok(failureSummaryFromLog(`r\tRun t\t2026-10-20T10:00:00.0Z FAIL  ${"x".repeat(400)}`).length <= 240);
  });

  await test("a merge of main counts as a card's evidence only while the card is held for a red main", async () => {
    const commits = [{ sha: A, message: "Backlog item: c0" }, { sha: B, message: "Backlog item: c1" }, { sha: M, message: "Merge remote-tracking branch 'origin/main' into deploy/x" }];
    assert.ok(isMainMergeCommit(commits[2]) && isMainMergeCommit({ message: "Merge branch 'main' into deploy/x" }) && !isMainMergeCommit(commits[1]));
    assert.deepStrictEqual(evidenceCandidates(commits, B).map((c) => c.sha), [B]);
    assert.deepStrictEqual(evidenceCandidates(commits, B, { mainMerges: true }).map((c) => c.sha), [B, M]);
    assert.strictEqual(auto.heldForMain({ trainTestReruns: [`${WF}@${X}:base-red`] }, WF), true);
    assert.strictEqual(auto.heldForMain({ trainTestReruns: [`${WF}@${X}:base-red`] }, "e2e-quick.yml"), false);
  });

  // The incident: c0 green on A, main merged in (M), c1 red twice on B.
  const train = () => reset([
    { id: "c0", status: "ready-for-testing", deployCommit: A, deployCommits: [A], title: "Agent Board" },
    { id: "c1", status: "ready-for-testing", deployCommit: B, deployCommits: [B], title: "Voice-first", trainTestReruns: [`${WF}@${B}:rerun:20`] },
  ], {
    commits: [{ sha: A, message: "Backlog item: c0" }, { sha: M, message: "Merge remote-tracking branch 'origin/main' into deploy/x" }, { sha: B, message: "Backlog item: c1" }],
    base: { [B]: X }, mainHead: X, failedLog: LOG_DEPLOY_MAP,
    bySha: { [WF]: { [A]: [run_(10, A, 1, "completed", "success")], [B]: [run_(20, B, 2, "completed", "failure")] } },
  });

  await test("red on main too: the ticket is NOT sent back — main is checked first, then the ticket is held with a one-line why", async () => {
    train();
    await sweep();
    assert.strictEqual(card("c1").status, "ready-for-testing");
    assert.ok(!card("c1").revertRequested);
    assert.ok(ghCalls().some((c) => c.includes(`refs/heads/${baseCheckRef(X)}`) && c.includes(`sha=${X}`)), ghCalls().join("\n"));
    assert.ok(ghCalls().some((c) => c === `workflow run ${WF} --repo offline2online/rob_ph_demos --ref ${baseCheckRef(X)}`), ghCalls().join("\n"));
    assert.ok(notes("c1").some((t) => t.includes("Before sending it back")), notes("c1").join("\n"));
    await sweep();
    assert.strictEqual(ghCalls().filter((c) => c.startsWith("workflow run")).length, 1, "dispatched once, not every sweep");

    const st = JSON.parse(fs.readFileSync(stateFile, "utf8"));
    st.bySha[WF][X] = [run_(30, X, 2, "completed", "failure")];
    setState({ bySha: st.bySha });
    await sweep();
    await sweep();
    assert.strictEqual(card("c1").status, "ready-for-testing", "still not sent back");
    const held = notes("c1").filter((t) => t.startsWith("Not sent back: main is broken"));
    assert.strictEqual(held.length, 1, notes("c1").join("\n"));
    assert.ok(held[0].includes("does not name kanban-staff-board/"), held[0]);
    assert.ok(ghCalls().some((c) => c.includes(`-X DELETE`) && c.includes(baseCheckRef(X))), "the throwaway branch is removed");
    assert.strictEqual(card("c0").status, "ready-for-testing");
  });

  await test("green on main: the ticket is sent back as before, with the failing test as its one-line reason", async () => {
    train();
    const st = JSON.parse(fs.readFileSync(stateFile, "utf8"));
    st.bySha[WF][X] = [run_(30, X, 1, "completed", "success")];
    setState({ bySha: st.bySha });
    await sweep();
    const c1 = card("c1");
    assert.strictEqual(c1.status, "backlog");
    assert.strictEqual(c1.revertRequested, true);
    assert.strictEqual(c1.lastFailureReason.summary, "deployment train tests: START-HERE.md: the deploy map names every top-level folder — the deploy map in START-HERE.md does not name kanban-staff-board/");
    assert.ok(c1.lastFailureReason.text.includes("main without it passes"), c1.lastFailureReason.text);
    assert.ok(notes("c1").some((t) => t.startsWith("Sent back automatically (Failed testing [tests]): Why: deployment train tests:")), notes("c1").join("\n"));
  });

  await test("no merge base from GitHub: sent back as before (no base check to run)", async () => {
    train();
    setState({ base: {} });
    await sweep();
    assert.strictEqual(card("c1").status, "backlog");
    assert.ok(!ghCalls().some((c) => c.startsWith("workflow run")));
  });

  await test("a held ticket is re-judged on the merge of a fixed main: green there, nobody is sent back", async () => {
    train();
    const st = JSON.parse(fs.readFileSync(stateFile, "utf8"));
    st.commits.push({ sha: Y, message: "Merge remote-tracking branch 'origin/main' into deploy/x" });
    st.bySha[WF][X] = [run_(30, X, 2, "completed", "failure")];
    st.bySha[WF][Y] = [run_(40, Y, 1, "completed", "success")];
    setState({ commits: st.commits, bySha: st.bySha });
    const d = docs.get(DOC("c1"));
    d.trainTestReruns = auto.tv([`${WF}@${B}:rerun:20`, `${WF}@${X}:base-red`]);
    await sweep();
    assert.strictEqual(card("c1").status, "ready-for-testing");
    assert.ok(!ghCalls().some((c) => c.startsWith("workflow run")), ghCalls().join("\n"));
  });

  fs.rmSync(dir, { recursive: true, force: true });
  console.log(failed ? `\n${failed} failed` : "\nall passed");
  if (failed) process.exit(1);
})();
