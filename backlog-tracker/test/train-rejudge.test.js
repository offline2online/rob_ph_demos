// A ticket whose every test run held a ticket since reverted is tested again
// without it before anyone is blamed (26 Oct 2026, Retail Media Insights:
// M3Uysw3u was sent back for a failure Lk5ojZ0t caused two tickets below it).
//
// Run with:  node test/train-rejudge.test.js
"use strict";
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const auto = require("../scripts/run-backlog-automation.js");
const { scanRedTrain, pickRedCulprit, rejudgeReverts, rejudgeKey, rejudgeShaOf, evidenceRunsFor, onlyStaleEvidence, provenGreenMain, buildRejudgeCommit, rejudgeRef } = auto;

let failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ok  ${name}`); } catch (err) { failed++; console.log(`FAIL  ${name}\n      ${err.stack}`); }
}

const WF = "retail-media-insights-tests.yml";
const sha = (c) => c.repeat(40);
const L2 = sha("1"), CW = sha("2"), ON = sha("3"), LK = sha("4"), PJ = sha("5"), M3 = sha("6"), RV = sha("7");
const S_ON = sha("a"), S_LK = sha("b"), S_PJ = sha("c");
const commit = (s, id) => ({ sha: s, message: `Ticket\n\nBacklog item: ${id}`, generatedOnly: false });
// The train on 26 Oct 2026 at 21:01, oldest first: CW was ejected and reverted as RV.
const commits = [commit(L2, "L2"), commit(CW, "CW"), commit(ON, "ON"), commit(LK, "LK"), commit(PJ, "PJ"), commit(M3, "M3"),
  { sha: RV, message: `Revert "x"\n\nThis reverts commit ${CW}.`, generatedOnly: false }];
const order = commits.map((c) => c.sha);
const run_ = (id, headSha, conclusion, attempt = 2, status = "completed") => ({ id, attempt, headSha, status, conclusion, url: `https://gh/run/${id}` });
const card = (id, deployCommit, extra = {}) => ({ id, status: "ready-for-testing", deployCommit, ...extra });
const keysFor = (s, synth) => [`${rejudgeKey(s, [CW])}=${synth}`];

// Each card's evidence and the unjudged set, as ejectRedCulprits builds them.
async function judge(cards, bySha) {
  const runsFor = async (w, s) => bySha[s] || [];
  const runs = {};
  for (const c of cards) {
    const [r] = await evidenceRunsFor(WF, c, commits, runsFor);
    if (r) runs[c.deployCommit] = r;
  }
  const skip = new Set(), unjudged = new Set();
  for (const c of cards) {
    if (runs[c.deployCommit] || !onlyStaleEvidence(commits, c.deployCommit)) continue;
    (rejudgeShaOf(c, commits) === "none" ? skip : unjudged).add(c.deployCommit);
  }
  return { runs, skip, unjudged, scan: scanRedTrain(order, cards, runs, { skip, unjudged }) };
}

// Every run before the revert held CW and failed; the run on the revert (M3's evidence) failed too.
const before = { [L2]: [run_(1, L2, "success", 1)], [ON]: [run_(3, ON, "failure", 1)], [LK]: [run_(4, LK, "failure", 1)], [PJ]: [run_(5, PJ, "failure", 1)], [M3]: [run_(6, M3, "failure")], [RV]: [run_(7, RV, "failure")] };

(async () => {
  await test("the reverts that left a card with only stale runs, newest first", async () => {
    assert.deepStrictEqual(rejudgeReverts(commits, ON), [CW]);
    assert.deepStrictEqual(rejudgeReverts(commits, L2), [], "nothing below it was reverted");
    const two = [...commits, commit(sha("8"), "N"), { sha: sha("9"), message: `Revert\n\nThis reverts commit ${LK}.` }];
    assert.deepStrictEqual(rejudgeReverts(two, PJ), [LK, CW], "the newer revert first");
    assert.deepStrictEqual(rejudgeReverts(two, ON), [CW], "a revert of a ticket above it doesn't count");
    assert.deepStrictEqual(rejudgeReverts(commits, sha("0")), [], "not on the train");
  });

  await test("rejudgeShaOf reads the re-test for the card's current reverts only", async () => {
    assert.strictEqual(rejudgeShaOf(card("ON", ON), commits), null);
    assert.strictEqual(rejudgeShaOf(card("ON", ON, { trainTestReruns: keysFor(ON, S_ON) }), commits), S_ON);
    assert.strictEqual(rejudgeShaOf(card("ON", ON, { trainTestReruns: keysFor(ON, "none") }), commits), "none");
    const later = [...commits, commit(sha("8"), "N"), { sha: sha("9"), message: `Revert\n\nThis reverts commit ${L2}.` }];
    assert.strictEqual(rejudgeShaOf(card("ON", ON, { trainTestReruns: keysFor(ON, S_ON) }), later), null, "a second revert needs a new re-test");
    assert.strictEqual(rejudgeRef(ON), `train-rejudge/${ON.slice(0, 12)}`);
  });

  const train = (extra = {}) => [card("L2", L2), card("ON", ON, extra.ON), card("LK", LK, extra.LK), card("PJ", PJ, extra.PJ), card("M3", M3, extra.M3)];

  await test("26 Oct replay: the red run on the revert names nobody while the cards below it have no verdict", async () => {
    const { scan, unjudged, skip } = await judge(train(), before);
    assert.strictEqual(scan.culprit, null, "M3 is not blamed");
    assert.deepStrictEqual(scan.unjudged.map((c) => c.id), ["ON", "LK", "PJ"], "those three are re-tested");
    // What the old scan did with the same evidence: passed them over and blamed M3.
    assert.strictEqual(pickRedCulprit(order, train(), (await judge(train(), before)).runs, { skip: new Set([...skip, ...unjudged]) }).id, "M3");
  });

  const rejudged = (on, lk, pj) => ({
    ...before,
    ...(on ? { [S_ON]: [on] } : {}), ...(lk ? { [S_LK]: [lk] } : {}), ...(pj ? { [S_PJ]: [pj] } : {}),
  });
  const withKeys = () => train({ ON: { trainTestReruns: keysFor(ON, S_ON) }, LK: { trainTestReruns: keysFor(LK, S_LK) }, PJ: { trainTestReruns: keysFor(PJ, S_PJ) } });

  await test("the re-tests decide: the first red re-test is the culprit", async () => {
    const { scan, runs } = await judge(withKeys(), rejudged(run_(10, S_ON, "success", 1), run_(11, S_LK, "failure"), run_(12, S_PJ, "failure")));
    assert.strictEqual(scan.culprit.id, "LK");
    assert.strictEqual(runs[LK].headSha, S_LK, "judged on its re-test commit");
    assert.strictEqual(auto.culpritAction(runs[LK]), "eject");
    const proven = provenGreenMain(commits, withKeys(), runs, scan.culprit);
    assert.strictEqual(proven && proven.card.id, "ON", "ON's green re-test proves main green, though its commit is off the train");
  });

  await test("a re-test red on its first attempt is the culprit to re-run", async () => {
    const { scan, runs } = await judge(withKeys(), rejudged(run_(10, S_ON, "success", 1), run_(11, S_LK, "failure", 1), run_(12, S_PJ, "failure", 1)));
    assert.strictEqual(scan.culprit.id, "LK");
    assert.strictEqual(runs[LK].attempt, 1);
  });

  await test("every re-test green: the card whose run failed is the culprit after all", async () => {
    const g = (id, s) => run_(id, s, "success", 1);
    assert.strictEqual((await judge(withKeys(), rejudged(g(10, S_ON), g(11, S_LK), g(12, S_PJ)))).scan.culprit.id, "M3");
  });

  await test("a re-test still running or not yet started: wait", async () => {
    const { scan } = await judge(withKeys(), rejudged(run_(10, S_ON, "success", 1), run_(11, S_LK, "", 1, "in_progress")));
    assert.strictEqual(scan.culprit, null);
    assert.deepStrictEqual(scan.unjudged.map((c) => c.id), [], "LK has a run going; PJ only waits behind it");
    const none = await judge(withKeys(), rejudged(run_(10, S_ON, "success", 1)));
    assert.strictEqual(none.scan.culprit, null);
    assert.deepStrictEqual(none.scan.unjudged.map((c) => c.id), ["LK", "PJ"], "dispatched, no run yet: still unjudged");
  });

  await test("a card that can't be re-tested is passed over as before, so the train never strands", async () => {
    const cards = train({ ON: { trainTestReruns: keysFor(ON, "none") }, LK: { trainTestReruns: keysFor(LK, "none") }, PJ: { trainTestReruns: keysFor(PJ, "none") } });
    const { scan, skip } = await judge(cards, before);
    assert.deepStrictEqual([...skip].sort(), [LK, ON, PJ].sort());
    assert.strictEqual(scan.culprit.id, "M3");
  });

  await test("a green run above an unjudged card covers it (B, S, L, M, revert(S), N)", async () => {
    const tr = [commit(sha("b"), "B"), commit(sha("5"), "S"), commit(sha("1"), "L"), commit(sha("a"), "M"), { sha: sha("e"), message: `Revert\n\nThis reverts commit ${sha("5")}.` }, commit(sha("f"), "N")];
    const cards = ["b", "1", "a", "f"].map((c) => card(c, sha(c)));
    const runs = { [sha("b")]: run_(1, sha("b"), "success"), [sha("a")]: run_(2, sha("e"), "success"), [sha("f")]: run_(3, sha("f"), "failure") };
    const scan = scanRedTrain(tr.map((c) => c.sha), cards, runs, { unjudged: new Set([sha("1")]) });
    assert.strictEqual(scan.culprit.id, "f", "N is named: M's green run held L");
    assert.deepStrictEqual(scan.unjudged, []);
  });

  await test("laterPassFor: a red card's chip follows the newest run up the train when that run passed", async () => {
    // The train at 21:24: CW rebuilt as CW2, M3 reverted as RV2 and rebuilt as M3N, whose run passed.
    const CW2 = sha("8"), RV2 = sha("9"), M3N = sha("d");
    const now = [...commits, commit(CW2, "CW"), { sha: RV2, message: `Revert "y"\n\nThis reverts commit ${M3}.` }, commit(M3N, "M3")];
    const runsOf = (by) => async (w, s) => by[s] || [];
    const by = { ...before, [CW2]: [run_(20, CW2, "failure")], [RV2]: [run_(21, RV2, "failure")], [M3N]: [run_(22, M3N, "success", 1)] };
    assert.strictEqual((await auto.laterPassFor(WF, card("LK", LK), now, runsOf(by))).headSha, M3N, "Lk5o's own red was fixed by M3's patch");
    assert.strictEqual((await auto.laterPassFor(WF, card("CW", CW2), now, runsOf(by))).headSha, M3N);
    assert.strictEqual(await auto.laterPassFor(WF, card("LK", LK), now, runsOf({ ...by, [M3N]: [run_(22, M3N, "", 1, "in_progress")] })), null, "the newest run still going: no pass yet");
    assert.strictEqual(await auto.laterPassFor(WF, card("LK", LK), now, runsOf({ ...by, [M3N]: [run_(22, M3N, "failure")] })), null, "the newest run red: stays red");
    assert.strictEqual(await auto.laterPassFor(WF, card("M3", M3N), now, runsOf(by)), null, "nothing above the head");
    assert.strictEqual((await auto.laterPassFor(WF, card("LK", LK), commits, runsOf({ ...before, [RV]: [run_(7, RV, "success")] }))).headSha, RV);
    assert.strictEqual(await auto.laterPassFor(WF, card("LK", LK), [...commits.slice(0, 6), commit(sha("e"), "N"), { sha: RV, message: `Revert\n\nThis reverts commit ${CW}.` }], runsOf({ ...before, [sha("e")]: [run_(8, sha("e"), "success")] })), null,
      "a pass on a commit that still held a reverted ticket says nothing");
  });

  await test("buildRejudgeCommit: the card's commit without the reverted ticket, pushed to its own branch", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "rejudge-test-"));
    const origin = path.join(root, "origin.git"), work = path.join(root, "work");
    const git = (cwd, ...a) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...a], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
    git(root, "init", "-q", "--bare", "-b", "main", origin);
    git(root, "clone", "-q", origin, work);
    const write = (f, t) => fs.writeFileSync(path.join(work, f), t);
    write("README.md", "# Log\n- base\n"); write("app.js", "a\nb\nc\n");
    git(work, "add", "-A"); git(work, "commit", "-qm", "base"); git(work, "push", "-q", "origin", "HEAD:main");
    write("README.md", "# Log\n- base\n- culprit\n"); write("culprit.js", "x\n");
    git(work, "add", "-A"); git(work, "commit", "-qm", "culprit"); const culprit = git(work, "rev-parse", "HEAD");
    write("README.md", "# Log\n- base\n- culprit\n- card\n"); write("app.js", "a\nb\nc\nCARD\n");
    git(work, "commit", "-qam", "card"); const cardSha = git(work, "rev-parse", "HEAD");
    write("app.js", "a\nb\nc\nCARD\nLATER\n"); git(work, "commit", "-qam", "later");
    // The train's own revert, its README collision resolved as the automation does.
    assert.throws(() => git(work, "revert", "--no-edit", culprit));
    write("README.md", "# Log\n- base\n- card\n"); git(work, "add", "README.md"); git(work, "-c", "core.editor=true", "revert", "--continue");
    git(work, "push", "-q", "origin", "HEAD:refs/heads/deploy/x");
    const cwd = process.cwd();
    process.chdir(work);
    let built, clash;
    try {
      built = buildRejudgeCommit("deploy/x", cardSha, [culprit]);
      // A revert that collides in code can't be built: no commit, nothing pushed.
      write("app.js", "a\nB2\nc\nCARD\nLATER\n"); git(work, "commit", "-qam", "touch b"); const touch = git(work, "rev-parse", "HEAD");
      write("app.js", "a\nB3\nc\nCARD\nLATER\n"); git(work, "commit", "-qam", "touch b again"); const again = git(work, "rev-parse", "HEAD");
      git(work, "push", "-q", "origin", "HEAD:refs/heads/deploy/x");
      clash = buildRejudgeCommit("deploy/x", again, [touch]);
    } finally { process.chdir(cwd); }
    assert.match(built, /^[0-9a-f]{40}$/);
    assert.strictEqual(git(origin, "rev-parse", `refs/heads/${rejudgeRef(cardSha)}`), built, "pushed to train-rejudge/<sha>");
    assert.strictEqual(git(work, "rev-parse", `${built}^`), cardSha, "built on the card's own commit");
    assert.strictEqual(git(work, "show", `${built}:README.md`), "# Log\n- base\n- card", "the document list collision is resolved");
    assert.strictEqual(git(work, "show", `${built}:app.js`), "a\nb\nc\nCARD", "the card's change, nothing later");
    assert.throws(() => git(work, "show", `${built}:culprit.js`), "the reverted ticket's file is gone");
    assert.strictEqual(clash, null);
    assert.strictEqual(git(work, "worktree", "list").split("\n").length, 1, "worktrees removed");
    fs.rmSync(root, { recursive: true, force: true });
  });

  console.log(failed ? `train-rejudge: ${failed} failed` : "train-rejudge: all passed");
  process.exit(failed ? 1 : 0);
})();
