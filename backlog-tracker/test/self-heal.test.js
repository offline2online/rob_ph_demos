// A ticket that fails gets itself through, or asks a person — never strands
// (26 Oct 2026 review of 19–26 Oct: send-backs waited 26–38 minutes on a run
// on main that the train had already answered; one automatic rebuild was
// shared by every cause, so a ticket that had merely conflicted once was left
// "for a person" after a later test failure; a rebuild due while a release
// closed waited for a click; a duplicate session's late patch produced a false
// "Not built" and a needless rebuild). Pure helpers, plus the REAL
// ejectRedCulprits driven by a fake `gh` on PATH and an in-memory Firestore.
// No network or credentials.
//
// Run with:  node test/self-heal.test.js
"use strict";
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "self-heal-"));
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
let projectFields = {};
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
  if (url.includes("/projects/") && !url.includes("/backlogItems/")) return reply(200, { fields: projectFields });
  if ((o.method || "GET") === "PATCH") {
    const d = docs.get(DOC(url.split("/backlogItems/")[1].split("?")[0]));
    for (const [k, v] of Object.entries(JSON.parse(o.body).fields)) d[k] = v;
    return reply(200);
  }
  return reply(200);
};
const auto = require("../scripts/run-backlog-automation.js");
const { selfHealPlan, MAX_AUTO_REBUILDS, latePatchFromDuplicateSession, deferredBuildOutcome, provenGreenMain } = auto;

const WF = "firestore-rules-test.yml";
const sha = (c) => c.repeat(40);
const A = sha("a"), B = sha("b"), C = sha("c"), M = sha("e"), X = sha("f");
const run_ = (id, headSha, attempt, status, conclusion) => ({ id, attempt, headSha, status, conclusion, url: `https://gh/run/${id}` });
const green = (id, s) => run_(id, s, 1, "completed", "success");
const redTwice = (id, s) => run_(id, s, 2, "completed", "failure");
const MERGE = (s) => ({ sha: s, message: "Merge remote-tracking branch 'origin/main' into deploy/x" });

function reset(cards, st, project = {}) {
  docs.clear();
  projectFields = Object.fromEntries(Object.entries(project).map(([k, v]) => [k, auto.tv(v)]));
  for (const c of cards) {
    const { id, ...rest } = c;
    docs.set(DOC(id), Object.fromEntries(Object.entries({ projectId: "P1", deployBranch: "deploy/x", ...rest }).map(([k, v]) => [k, auto.tv(v)])));
  }
  fs.writeFileSync(stateFile, JSON.stringify({ bySha: {}, commits: [], ...st }));
  fs.writeFileSync(logFile, "");
}
const card = (id) => auto.fdoc(docs.get(DOC(id)));
const notes = (id) => (card(id).notes || []).map((n) => n.text);
const ghCalls = () => fs.readFileSync(logFile, "utf8").split("\n").filter(Boolean);
const runsFrom = () => (workflow, s) => (((JSON.parse(fs.readFileSync(stateFile, "utf8")).bySha[workflow]) || {})[s]) || [];

let failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ok  ${name}`); } catch (err) { failed++; console.log(`FAIL  ${name}\n      ${err.stack}`); }
}

(async () => {
  await test("selfHealPlan: rebuilds within the budget, waits for a closing release, then asks a person", async () => {
    const r = selfHealPlan({ autoRebuilds: 0 }, {}, "why");
    assert.strictEqual(r.action, "rebuild");
    assert.deepStrictEqual(r.fields, { autoRebuilds: 1 });
    // One conflict no longer uses up the budget a later test failure needs.
    assert.strictEqual(selfHealPlan({ autoRebuilds: 1 }, {}, "why").action, "rebuild");
    assert.strictEqual(selfHealPlan({ autoRebuilds: MAX_AUTO_REBUILDS - 1 }, {}, "why").action, "rebuild");
    const d = selfHealPlan({ autoRebuilds: 0 }, { trainLocked: true }, "why");
    assert.strictEqual(d.action, "defer");
    assert.deepStrictEqual(d.fields, { autoRebuilds: 1, buildAfterTrain: true });
    assert.match(d.sentence, /starts by itself as soon as that train has merged/);
    assert.strictEqual(selfHealPlan({ autoRebuilds: 0 }, { trainLocked: true }, "why", { ignoreLock: true }).action, "rebuild", "a ticket sent back off its train rebuilds now");
    const e = selfHealPlan({ autoRebuilds: MAX_AUTO_REBUILDS }, {}, "console tests failed: tools/list", { nowIso: "2026-10-26T01:00:00.000Z" });
    assert.strictEqual(e.action, "escalate");
    assert.deepStrictEqual(Object.keys(e.fields), ["blocked"]);
    assert.strictEqual(e.fields.blocked.reason, "waiting-on-input", "shows on the board with an Answer button");
    assert.match(e.fields.blocked.note, /^console tests failed: tools\/list/);
    assert.match(e.fields.blocked.note, /Answer button/);
    assert.strictEqual(e.fields.blocked.setAt, "2026-10-26T01:00:00.000Z");
    assert.strictEqual(selfHealPlan({ autoRebuilds: 0 }, null, "why").action, "escalate", "no project: nothing to rebuild onto");
    assert.ok(selfHealPlan({}, {}, "x".repeat(5000)).action === "rebuild");
    assert.ok(auto.escalationBlock("x".repeat(5000), 3).note.length < 1500, "the flag stays readable");
  });

  await test("latePatchFromDuplicateSession: only a patch written without the card's own landed commit", async () => {
    const is = (answer) => () => answer;
    const onTrain = { status: "ready-for-testing", deployCommit: A, patchBaseSha: B };
    assert.strictEqual(latePatchFromDuplicateSession(onTrain, is(false)), true, "base predates the card's commit: a duplicate");
    assert.strictEqual(latePatchFromDuplicateSession(onTrain, is(true)), false, "a re-patch read from the branch after it");
    assert.strictEqual(latePatchFromDuplicateSession(onTrain, is(null)), false, "git can't tell: land it as before");
    assert.strictEqual(latePatchFromDuplicateSession({ ...onTrain, status: "backlog" }, is(false)), false, "a sent-back card rebuilds normally");
    assert.strictEqual(latePatchFromDuplicateSession({ ...onTrain, patchBaseSha: undefined }, is(false)), false);
    assert.strictEqual(latePatchFromDuplicateSession({ ...onTrain, deployCommit: null }, is(false)), false);
    assert.strictEqual(latePatchFromDuplicateSession({ ...onTrain, patchBaseSha: A }, is(false)), false);
  });

  await test("deferredBuildOutcome: builds once the release has merged, never while it is closing or a question is open", async () => {
    const held = { status: "backlog", buildAfterTrain: true };
    assert.strictEqual(deferredBuildOutcome(held, { trainLocked: false }), "build");
    assert.strictEqual(deferredBuildOutcome(held, { trainLocked: true }), "wait");
    assert.strictEqual(deferredBuildOutcome({ ...held, blocked: { reason: "waiting-on-input" } }, {}), "wait");
    assert.strictEqual(deferredBuildOutcome({ ...held, status: "ready-for-testing" }, {}), "clear");
    assert.strictEqual(deferredBuildOutcome({ ...held, patchReady: true }, {}), "clear");
    assert.strictEqual(deferredBuildOutcome(held, null), "clear");
  });

  await test("provenGreenMain: the ticket before it passed on the same main, unless main was merged in between", async () => {
    const cards = [{ id: "c0", deployCommit: A }, { id: "c1", deployCommit: B }, { id: "c2", deployCommit: C }];
    const runs = { [A]: green(1, A), [B]: green(2, B), [C]: redTwice(3, C) };
    const plain = [{ sha: A, message: "Backlog item: c0" }, { sha: B, message: "Backlog item: c1" }, { sha: C, message: "Backlog item: c2" }];
    assert.strictEqual(provenGreenMain(plain, cards, runs, cards[2]).card.id, "c1", "the nearest green ticket");
    assert.strictEqual(provenGreenMain([plain[0], plain[1], MERGE(M), plain[2]], cards, runs, cards[2]), null, "main merged in just before the culprit landed: check main");
    assert.strictEqual(provenGreenMain([plain[0], MERGE(M), plain[1], plain[2]], cards, runs, cards[2]).card.id, "c1", "a merge before the green ticket is in both runs");
    assert.strictEqual(provenGreenMain(plain, cards, { [C]: redTwice(3, C) }, cards[2]), null, "nothing before it passed");
    assert.strictEqual(provenGreenMain(plain, cards, { [A]: redTwice(1, A), [B]: run_(2, B, 1, "in_progress", ""), [C]: redTwice(3, C) }, cards[2]), null);
    assert.strictEqual(provenGreenMain(plain, cards, runs, cards[0]), null, "the first ticket has nothing before it");
    assert.strictEqual(provenGreenMain(plain, cards, runs, { id: "zz", deployCommit: X }), null, "not on the train");
  });

  // 26 Oct 2026, 7dVoY12l: c0 green, c1 red twice on the same main. It waited
  // 26 minutes for a run on main that c0's run had already answered.
  const train = (c1 = {}, project = {}) => reset([
    { id: "c0", status: "ready-for-testing", deployCommit: A, deployCommits: [A], title: "Train self-healing" },
    { id: "c1", status: "ready-for-testing", deployCommit: B, deployCommits: [B], title: "fail_testing tool", trainTestReruns: [`${WF}@${B}:rerun:20`], ...c1 },
  ], {
    commits: [{ sha: A, message: "Backlog item: c0" }, { sha: B, message: "Backlog item: c1" }],
    base: { [A]: X, [B]: X }, mainHead: X,
    failedLog: "rules\tRun MCP client integration test\t2026-10-26T00:03:16.6488228Z FAIL  tools/list returns the whole surface\nrules\tRun MCP client integration test\t2026-10-26T00:03:16.6489221Z       Expected values to be strictly deep-equal:",
    bySha: { [WF]: { [A]: [green(10, A)], [B]: [redTwice(20, B)] } },
  }, project);

  await test("a ticket red on the same main as a green one is sent back at once: no run on main, revert and rebuild queued", async () => {
    train();
    const ejected = await auto.ejectRedCulprits(runsFrom());
    assert.deepStrictEqual(ejected, ["c1"], "reported so the revert runs in the same sweep");
    assert.ok(!ghCalls().some((c) => /workflow run .*train-base\//.test(c)), "no run dispatched on main");
    const c1 = card("c1");
    assert.strictEqual(c1.status, "backlog");
    assert.strictEqual(c1.revertRequested, true);
    assert.strictEqual(c1.rebuildAfterRevert, true);
    assert.strictEqual(Number(c1.autoRebuilds), 1);
    assert.strictEqual(c1.lastFailureReason.summary, "MCP client integration test: tools/list returns the whole surface — Expected values to be strictly deep-equal:");
    const note = notes("c1").pop();
    assert.match(note, /on the same main \(c0's run passed just before it\)/);
    assert.match(note, /A rebuild starts once the revert has landed/);
    assert.strictEqual(card("c0").status, "ready-for-testing", "the green ticket stays");
  });

  await test("a ticket whose automatic rebuilds are used up is flagged for a person with the reason, not rebuilt", async () => {
    train({ autoRebuilds: MAX_AUTO_REBUILDS });
    assert.deepStrictEqual(await auto.ejectRedCulprits(runsFrom()), ["c1"]);
    const c1 = card("c1");
    assert.strictEqual(c1.status, "backlog");
    assert.strictEqual(c1.revertRequested, true, "still comes off the train");
    assert.ok(!c1.rebuildAfterRevert);
    assert.strictEqual(c1.blocked.reason, "waiting-on-input");
    assert.match(c1.blocked.note, /tools\/list returns the whole surface/);
    assert.match(notes("c1").pop(), /flagged for you with the reason/);
  });

  await test("main merged in under the red ticket: main is still checked first", async () => {
    train();
    const st = JSON.parse(fs.readFileSync(stateFile, "utf8"));
    st.commits = [{ sha: A, message: "Backlog item: c0" }, MERGE(M), { sha: B, message: "Backlog item: c1" }];
    fs.writeFileSync(stateFile, JSON.stringify(st));
    assert.deepStrictEqual(await auto.ejectRedCulprits(runsFrom()), []);
    assert.ok(ghCalls().some((c) => /workflow run firestore-rules-test\.yml .*train-base\//.test(c)), "the check on main is dispatched");
    assert.strictEqual(card("c1").status, "ready-for-testing");
  });

  await test("a ticket the workflow never runs for no longer hides a red ticket after it", async () => {
    reset([
      { id: "faq", status: "ready-for-testing", deployCommit: A, deployCommits: [A], title: "FAQ copy" },
      { id: "c0", status: "ready-for-testing", deployCommit: B, deployCommits: [B], title: "green" },
      { id: "c1", status: "ready-for-testing", deployCommit: C, deployCommits: [C], title: "red", trainTestReruns: [`${WF}@${C}:rerun:30`] },
    ], {
      commits: [{ sha: A, message: "Backlog item: faq" }, { sha: B, message: "Backlog item: c0" }, { sha: C, message: "Backlog item: c1" }],
      base: { [C]: X }, mainHead: X, failedLog: "",
      files: { [A]: ["faq/data/articles/1.json"] },
      bySha: { [WF]: { [B]: [green(20, B)], [C]: [redTwice(30, C)] } },
    });
    assert.deepStrictEqual(await auto.ejectRedCulprits(runsFrom()), ["c1"]);
    assert.strictEqual(card("faq").status, "ready-for-testing");
  });

  await test("a ticket whose run hasn't started still holds the tickets after it (it may be the cause)", async () => {
    reset([
      { id: "c0", status: "ready-for-testing", deployCommit: A, deployCommits: [A], title: "no run yet" },
      { id: "c1", status: "ready-for-testing", deployCommit: B, deployCommits: [B], title: "red", trainTestReruns: [`${WF}@${B}:rerun:20`] },
    ], {
      commits: [{ sha: A, message: "Backlog item: c0" }, { sha: B, message: "Backlog item: c1" }],
      base: { [B]: X }, mainHead: X, failedLog: "",
      files: { [A]: ["backlog-tracker/functions/index.js"] },
      bySha: { [WF]: { [B]: [redTwice(20, B)] } },
    });
    assert.deepStrictEqual(await auto.ejectRedCulprits(runsFrom()), []);
    assert.strictEqual(card("c1").status, "ready-for-testing");
  });

  // 26 Oct 2026, Retail Media Insights: B was ejected and reverted as E; C and
  // D only ever ran with B under them, and D's evidence (the run on E) is red.
  // C must be tested again without B before D is blamed.
  const D = sha("d"), E = sha("9"), S = sha("5");
  const rejudgeTrain = (bySha, c2 = {}) => reset([
    { id: "c0", status: "ready-for-testing", deployCommit: A, deployCommits: [A], title: "green" },
    { id: "c2", status: "ready-for-testing", deployCommit: C, deployCommits: [C], title: "stale", trainTestReruns: [`rejudge@${C.slice(0, 12)}:${B.slice(0, 7)}=${S}`], ...c2 },
    { id: "c3", status: "ready-for-testing", deployCommit: D, deployCommits: [D], title: "blamed before", trainTestReruns: [`${WF}@${E}:rerun:31`] },
  ], {
    commits: [{ sha: A, message: "Backlog item: c0" }, { sha: B, message: "Backlog item: cB" }, { sha: C, message: "Backlog item: c2" }, { sha: D, message: "Backlog item: c3" }, { sha: E, message: `Revert "x"\n\nThis reverts commit ${B}.` }],
    base: { [A]: X, [S]: X, [E]: X }, mainHead: X, failedLog: "",
    bySha: { [WF]: { [A]: [green(10, A)], [C]: [redTwice(30, C)], [D]: [redTwice(31, D)], [E]: [redTwice(32, E)], ...bySha } },
  });

  await test("a red run that also held an unjudged ticket blames nobody: that ticket is tested again without the reverted one", async () => {
    rejudgeTrain({});
    assert.deepStrictEqual(await auto.ejectRedCulprits(runsFrom()), [], "D is not sent back");
    assert.ok(ghCalls().some((c) => c === `workflow run ${WF} --repo offline2online/rob_ph_demos --ref train-rejudge/${C.slice(0, 12)}`), "C's re-test started on its own branch");
    assert.match(notes("c2").pop(), /Testing this ticket again without that change \(5555555\); no ticket is sent back until it reports/);
    assert.ok(card("c2").trainTestReruns.some((k) => k.startsWith(`${WF}@${S}:rejudge:`)));
    assert.strictEqual(card("c3").status, "ready-for-testing");
    // Started once: the next sweep, with no run on the re-test yet, starts nothing.
    fs.writeFileSync(logFile, "");
    const keys = card("c2").trainTestReruns;
    rejudgeTrain({}, { trainTestReruns: keys });
    assert.deepStrictEqual(await auto.ejectRedCulprits(runsFrom()), []);
    assert.ok(!ghCalls().some((c) => /workflow run/.test(c)), "not dispatched twice");
  });

  await test("the re-test fails twice: the unjudged ticket is the culprit, and its note says what it was tested without", async () => {
    rejudgeTrain({ [S]: [redTwice(40, S)] });
    assert.deepStrictEqual(await auto.ejectRedCulprits(runsFrom()), ["c2"]);
    assert.strictEqual(card("c3").status, "ready-for-testing", "the ticket above it stays");
    assert.match(card("c2").lastFailureReason.text, new RegExp(`own commit ${C.slice(0, 7)} \\(re-tested without the reverted ${B.slice(0, 7)}, which its earlier runs held\\)`));
    assert.match(card("c2").lastFailureReason.text, /c0's run passed just before it/);
  });

  await test("the re-test passes: the ticket above it is the culprit after all", async () => {
    rejudgeTrain({ [S]: [green(40, S)] });
    assert.deepStrictEqual(await auto.ejectRedCulprits(runsFrom()), ["c3"]);
    assert.strictEqual(card("c2").status, "ready-for-testing");
  });

  await test("a re-test that can't be built passes the ticket over as before, so the train never strands", async () => {
    rejudgeTrain({}, { trainTestReruns: [`rejudge@${C.slice(0, 12)}:${B.slice(0, 7)}=none`] });
    assert.deepStrictEqual(await auto.ejectRedCulprits(runsFrom()), ["c3"]);
  });

  await test("a card whose own run is red shows the pass of the newer run up the train that holds it", async () => {
    const RMI = "retail-media-insights-tests.yml";
    const setup = (head) => reset([
      { id: "c1", status: "ready-for-testing", deployCommit: B, deployCommits: [B], title: "own run red, fixed by c2" },
      { id: "c2", status: "ready-for-testing", deployCommit: C, deployCommits: [C], title: "fixes c1's tests" },
    ], {
      commits: [{ sha: B, message: "Backlog item: c1" }, { sha: C, message: "Backlog item: c2" }],
      files: { [B]: ["Retail-media-insights/frontend/revenue-deals.js"], [C]: ["Retail-media-insights/test/ui/smoke.test.js"] },
      bySha: { [RMI]: { [B]: [redTwice(50, B)], [C]: [head] } },
    });
    setup(green(51, C));
    await auto.recordCardTrainTests(runsFrom());
    assert.strictEqual(card("c1").trainTest.state, "passed");
    assert.strictEqual(card("c1").trainTest.workflows[0].runUrl, "https://gh/run/51", "links the run that passed");
    assert.strictEqual(card("c2").trainTest.state, "passed");
    setup(run_(51, C, 1, "in_progress", ""));
    await auto.recordCardTrainTests(runsFrom());
    assert.strictEqual(card("c1").trainTest.state, "failed", "nothing newer has passed yet");
  });

  await test("resolveRevertDocConflict: drops the reverted ticket's lines, keeps the later ones, refuses anything else", async () => {
    const hunk = (ours, theirs) => ["# Log", "<<<<<<< HEAD", ...ours, "=======", ...theirs, ">>>>>>> parent of 457b2b0 (x)", "tail"].join("\n");
    assert.strictEqual(auto.resolveRevertDocConflict(hunk(["- later ticket", "- reverted ticket"], []), ["- reverted ticket"]), "# Log\n- later ticket\ntail");
    assert.strictEqual(auto.resolveRevertDocConflict(hunk(["- later", "- reverted", "- older"], ["- older"]), ["- reverted"]), "# Log\n- later\n- older\ntail");
    assert.strictEqual(auto.resolveRevertDocConflict(hunk(["- later"], ["- something else"]), ["- reverted"]), null, "the revert side brings back text the current side lacks");
    assert.strictEqual(auto.resolveRevertDocConflict(hunk(["- later"], []), ["- reverted"]), null, "nothing of the reverted commit in the hunk");
    assert.strictEqual(auto.resolveRevertDocConflict("<<<<<<< HEAD\n- a\n=======\n", ["- a"]), null, "unterminated");
  });

  await test("a revert that collides only in REQUIREMENTS.md completes in a real repository; one in code does not", async () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), "revert-doc-"));
    const git = (...a) => require("child_process").execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...a], { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
    const write = (f, t) => { fs.mkdirSync(path.dirname(path.join(repo, f)), { recursive: true }); fs.writeFileSync(path.join(repo, f), t); };
    git("init", "-q", "-b", "main");
    write("REQUIREMENTS.md", "# Changes\n- base\n"); write("app.js", "a\nb\nc\n");
    git("add", "-A"); git("commit", "-qm", "base");
    write("REQUIREMENTS.md", "# Changes\n- base\n- ticket one\n"); write("app.js", "a\nONE\nb\nc\n");
    git("commit", "-qam", "one"); const one = git("rev-parse", "HEAD");
    write("REQUIREMENTS.md", "# Changes\n- base\n- ticket one\n- ticket two\n"); write("app.js", "a\nONE\nb\nc\nTWO\n");
    git("commit", "-qam", "two");
    assert.throws(() => git("revert", "--no-edit", one));
    const cwd = process.cwd();
    process.chdir(repo);
    try {
      const r = auto.tryAutoResolveRevertConflict(git("diff", "--name-only", "--diff-filter=U").split("\n").filter(Boolean), one);
      assert.deepStrictEqual(r, { resolved: true, paths: ["REQUIREMENTS.md"] });
    } finally { process.chdir(cwd); }
    git("-c", "core.editor=true", "revert", "--continue");
    assert.strictEqual(fs.readFileSync(path.join(repo, "REQUIREMENTS.md"), "utf8"), "# Changes\n- base\n- ticket two\n");
    assert.strictEqual(fs.readFileSync(path.join(repo, "app.js"), "utf8"), "a\nb\nc\nTWO\n");
    // The same shape in code is a person's call.
    write("app.js", "a\nb\nTHREE\nc\nTWO\n"); git("commit", "-qam", "three"); const three = git("rev-parse", "HEAD");
    write("app.js", "a\nb\nTHREE\nFOUR\nc\nTWO\n"); git("commit", "-qam", "four");
    assert.throws(() => git("revert", "--no-edit", three));
    process.chdir(repo);
    try { assert.deepStrictEqual(auto.tryAutoResolveRevertConflict(["app.js"], three), { resolved: false }); } finally { process.chdir(cwd); }
  });

  await test("retestPlan: a workflow that never reached a result is started again once, and its branch cleaned up after", async () => {
    const tt = (state) => ({ sha: A, workflows: [{ workflow: WF, label: "console tests", state }] });
    assert.deepStrictEqual(auto.retestPlan({ deployCommit: A }, tt("not-run")).start.map((w) => w.workflow), [WF]);
    assert.deepStrictEqual(auto.retestPlan({ deployCommit: A, trainTestReruns: [`${WF}@${A}:retest`] }, tt("not-run")).start, [], "once");
    assert.deepStrictEqual(auto.retestPlan({ deployCommit: A, trainTestReruns: [`${WF}@${A}:retested`] }, tt("not-run")).start, [], "never twice");
    assert.deepStrictEqual(auto.retestPlan({ deployCommit: A, trainTestReruns: [`${WF}@${A}:retest`] }, tt("passed")).cleanup.map((w) => w.workflow), [WF]);
    assert.deepStrictEqual(auto.retestPlan({ deployCommit: A }, tt("running")), { start: [], cleanup: [] });
    assert.deepStrictEqual(auto.retestPlan({ deployCommit: B }, tt("not-run")), { start: [], cleanup: [] }, "a record for another commit");
  });

  await test("retestUnrunWorkflows: starts the run on the card's own commit, notes it, then deletes the branch", async () => {
    reset([{ id: "c1", status: "ready-for-testing", deployCommit: A, deployCommits: [A], title: "cancelled run" }], {});
    const calls = [];
    const gh = (a) => { calls.push(a.join(" ")); return ""; };
    const c = card("c1"); c.id = "c1";
    await auto.retestUnrunWorkflows(c, { sha: A, workflows: [{ workflow: WF, label: "console tests", state: "not-run" }] }, gh);
    assert.ok(calls.some((x) => x.includes(`ref=refs/heads/train-retest/${A.slice(0, 12)}`) && x.includes(`sha=${A}`)), calls.join("\n"));
    assert.ok(calls.some((x) => x === `workflow run ${WF} --repo offline2online/rob_ph_demos --ref train-retest/${A.slice(0, 12)}`), calls.join("\n"));
    assert.deepStrictEqual(card("c1").trainTestReruns, [`${WF}@${A}:retest`]);
    assert.match(notes("c1").pop(), /never reached a result .* started again\. Nothing to do\./);
    calls.length = 0;
    const again = card("c1"); again.id = "c1";
    await auto.retestUnrunWorkflows(again, { sha: A, workflows: [{ workflow: WF, label: "console tests", state: "passed" }] }, gh);
    assert.deepStrictEqual(calls, [`api -X DELETE repos/offline2online/rob_ph_demos/git/refs/heads/train-retest/${A.slice(0, 12)}`]);
    assert.deepStrictEqual(card("c1").trainTestReruns, [`${WF}@${A}:retested`]);
  });

  // Failed testing on a train where another ticket is already approved: the
  // release ships without it and its rebuild follows the merge, instead of a
  // fresh ticket landing on a train that is waiting to deploy.
  await test("a sent-back ticket is reverted, its doc-only conflict resolved, and rebuilt now, or after a closing release merges", async () => {
    const sh = (cwd, ...a) => require("child_process").execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...a], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
    const setup = () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), "revert-rebuild-"));
      const origin = path.join(root, "origin.git"), work = path.join(root, "work");
      fs.mkdirSync(origin); sh(origin, "init", "--bare", "--quiet");
      fs.mkdirSync(work); sh(work, "init", "-q", "-b", "main");
      const write = (f, t) => fs.writeFileSync(path.join(work, f), t);
      write("REQUIREMENTS.md", "# Changes\n- base\n"); write("app.js", "a\n");
      sh(work, "add", "-A"); sh(work, "commit", "-qm", "base");
      sh(work, "remote", "add", "origin", origin); sh(work, "push", "-q", "-u", "origin", "main");
      sh(work, "checkout", "-q", "-b", "deploy/x");
      write("REQUIREMENTS.md", "# Changes\n- base\n- failed ticket\n"); write("app.js", "a\nfailed\n");
      sh(work, "commit", "-qam", "failed ticket\n\nBacklog item: f1"); const failedSha = sh(work, "rev-parse", "HEAD");
      write("REQUIREMENTS.md", "# Changes\n- base\n- failed ticket\n- good ticket\n"); write("other.js", "good\n");
      sh(work, "add", "-A"); sh(work, "commit", "-qm", "good ticket\n\nBacklog item: g1");
      sh(work, "push", "-q", "-u", "origin", "deploy/x"); sh(work, "checkout", "-q", "main");
      return { work, failedSha };
    };
    for (const locked of [false, true]) {
      const { work, failedSha } = setup();
      reset([{ id: "f1", status: "backlog", deployCommit: failedSha, deployCommits: [failedSha], revertRequested: true, rebuildAfterRevert: true, title: "failed" }], {}, { trainLocked: locked });
      const cwd = process.cwd();
      process.chdir(work);
      try {
        await auto.processRevertFromTrain(card("f1") && { id: "f1", ...card("f1") });
        await auto.flushBuildRequests();
      } finally { process.chdir(cwd); }
      const head = sh(work, "show", "origin/deploy/x:REQUIREMENTS.md");
      assert.strictEqual(head, "# Changes\n- base\n- good ticket", "reverted; the later ticket's line kept");
      assert.strictEqual(sh(work, "show", "origin/deploy/x:app.js"), "a");
      const f1 = card("f1");
      assert.strictEqual(f1.revertRequested, false);
      assert.strictEqual(f1.rebuildAfterRevert, false);
      if (locked) {
        assert.strictEqual(f1.buildAfterTrain, true, "waits for the release to merge");
        assert.ok(!f1.rebuildRequestedAt, "no build requested onto the closing train");
        assert.match(notes("f1").pop(), /ships without this ticket/);
      } else {
        assert.ok(!f1.buildAfterTrain);
        assert.ok(f1.rebuildRequestedAt, "rebuild requested straight away");
      }
    }
  });

  await test("gateRunFor: a duplicate run still going on the head doesn't hide a pass on the same commit; a later failure wins", async () => {
    const r = (headSha, status, conclusion) => ({ headSha, status, conclusion });
    assert.deepStrictEqual(auto.gateRunFor([r(A, "in_progress", ""), r(A, "completed", "success")], A), r(A, "completed", "success"));
    assert.deepStrictEqual(auto.gateRunFor([r(A, "in_progress", ""), r(A, "completed", "failure")], A), r(A, "in_progress", ""), "a red earlier run is not a verdict while a newer one runs");
    assert.deepStrictEqual(auto.gateRunFor([r(A, "completed", "failure"), r(A, "completed", "success")], A), r(A, "completed", "failure"), "the newest completed run decides");
    assert.deepStrictEqual(auto.gateRunFor([r(A, "in_progress", ""), r(B, "completed", "success")], A), r(A, "in_progress", ""), "a pass on another commit doesn't count");
    assert.deepStrictEqual(auto.gateRunFor([r(B, "completed", "success")], A), r(B, "completed", "success"), "older head: left to testedHeadOf as before");
    assert.deepStrictEqual(auto.gateRunFor([{ headSha: A, status: "completed", conclusion: "action_required" }, r(A, "completed", "success")], A), r(A, "completed", "success"));
    assert.strictEqual(auto.gateRunFor([], A), null);
  });

  if (failed) { console.log(`\n${failed} failed`); process.exit(1); }
  console.log("\nself-heal: all passed");
})();
