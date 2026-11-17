// Late arrivals, the deploy queue and shared files between trains
// (wPoSOXfp8Em06Vzp3Cz7). The decisions are pure (functions/deploy-queue.js);
// the version.js resolver is exercised against a disposable local repo pair
// through syncTrainWithMain, never the real origin; the order of the steps in
// processDeployTrain is pinned against the script's source.
//
// Run with:  node test/deploy-queue.test.js
"use strict";
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const dq = require("../functions/deploy-queue");
const auto = require("../scripts/run-backlog-automation.js");

let passed = 0;
const failures = [];
function test(name, fn) {
  const originalCwd = process.cwd();
  try { fn(); passed += 1; console.log(`  ok  ${name}`); }
  catch (err) { failures.push([name, err]); console.log(`FAIL  ${name}\n      ${err && err.stack ? err.stack : err}`); }
  finally { process.chdir(originalCwd); }
}

const T0 = Date.parse("2026-11-14T00:00:00Z");
const iso = (ms) => new Date(ms).toISOString();
const MIN = 60 * 1000;

// ── 1. Late arrivals ─────────────────────────────────────────────────────

test("a patch ready on an open train lands; on a locked train it is held", () => {
  const item = { id: "a", status: "backlog" };
  assert.strictEqual(dq.lateArrivalAction(item, { trainLocked: false, trainStatus: "idle" }), "land");
  assert.strictEqual(dq.lateArrivalAction(item, { trainLocked: true, trainStatus: "idle" }), "hold");
  assert.strictEqual(dq.lateArrivalAction(item, null), "land");
});

test("never on top of a running deploy: trainReady, deploying, queued or awaiting a human merge all hold", () => {
  const item = { id: "a", status: "backlog" };
  for (const p of [
    { trainLocked: true, trainReady: true },
    { trainLocked: true, trainStatus: "deploying" },
    { trainLocked: true, trainStatus: "deploying", trainHold: "queued" },
    { trainLocked: true, trainStatus: "awaiting-human-merge" },
  ]) assert.strictEqual(dq.lateArrivalAction(item, p), "hold", JSON.stringify(p));
});

test("exception: a rebuild of a ticket the train's own tests sent back lands while the train is only locked", () => {
  const rebuilt = { id: "a", status: "backlog", deployCommits: ["abc"], lastFailureReason: { category: "tests" } };
  assert.strictEqual(dq.lateArrivalAction(rebuilt, { trainLocked: true, trainStatus: "idle" }), "land");
  assert.strictEqual(dq.lateArrivalAction(rebuilt, { trainLocked: true, trainStatus: "deploying" }), "hold");
  // Sent back by a person, or never on a train: held like any newcomer.
  assert.strictEqual(dq.lateArrivalAction({ ...rebuilt, lastFailureReason: { category: "ui" } }, { trainLocked: true }), "hold");
  assert.strictEqual(dq.lateArrivalAction({ ...rebuilt, deployCommits: [] }, { trainLocked: true }), "hold");
});

test("a re-patch of a card already on the train lands while locked, not while deploying", () => {
  const onTrain = { id: "a", status: "ready-for-testing", deployCommit: "abc" };
  assert.strictEqual(dq.lateArrivalAction(onTrain, { trainLocked: true }), "land");
  assert.strictEqual(dq.lateArrivalAction(onTrain, { trainLocked: true, trainStatus: "deploying" }), "hold");
});

test("the held-patch note says it lands by itself after the merge", () => {
  const n = dq.heldPatchNote({ name: "Backlog Tracker & FAQs", trainLocked: true });
  assert.match(n, /held for the next release/);
  assert.match(n, /lands by itself right after that train merges/);
});

test("deferredBuildOutcome leaves a held patch alone; processApplyPatch lands it", () => {
  const held = { status: "backlog", buildAfterTrain: true, patchReady: true };
  assert.strictEqual(auto.deferredBuildOutcome(held, { trainLocked: true }), "wait");
  assert.strictEqual(auto.deferredBuildOutcome(held, { trainLocked: false }), "wait");
});

test("processApplyPatch holds before any branch work, and clears the flag when it lands", () => {
  const src = fs.readFileSync(path.join(__dirname, "../scripts/run-backlog-automation.js"), "utf8");
  const body = src.slice(src.indexOf("async function processApplyPatch(item)"));
  const hold = body.indexOf('deployQueue.lateArrivalAction(item, project) === "hold"');
  const ensure = body.indexOf("const deployBranch = await ensureDeployBranch(project);");
  assert.ok(hold > 0 && ensure > hold, "the hold must come before ensureDeployBranch/syncTrainWithMain");
  assert.ok(/buildAfterTrain: false,\n/.test(body.slice(body.indexOf('status: "ready-for-testing",'))), "landing clears buildAfterTrain");
});

// ── 2. The deploy queue ──────────────────────────────────────────────────

const BT = { projectId: "oTcL", projectName: "Backlog Tracker & FAQs", deployBranch: "deploy/backlog-tracker-faqs" };
const SK = { projectId: "New5", projectName: "Staff Kanban", deployBranch: "deploy/kanban-staff-board" };
const PH = { projectId: "ezm0", projectName: "PH Website", deployBranch: "deploy/ph-website" };
const DSP = { projectId: "mIPd", projectName: "Display Types & DSP Integration", deployBranch: "deploy/dsp-integration" };
const files = {
  oTcL: ["backlog-tracker/MCP.md", "backlog-tracker/public/index.html", dq.VERSION_JS],
  New5: ["backlog-tracker/public/js/kanban/board.js", dq.VERSION_JS],
  ezm0: ["ph-website/snippets/x.php"],
  mIPd: ["dsp-integration/apps/api/src/x.ts"],
};
const deploying = { trainReady: true, trainStatus: "deploying" };

test("related: shared files, or the same deploy workflow; version.js alone never relates two trains", () => {
  assert.deepStrictEqual(dq.trainsRelated(["a/x.js", "b/y.js"], ["b/y.js"]).shared, ["b/y.js"]);
  const sameSite = dq.trainsRelated(files.oTcL, files.New5);
  assert.strictEqual(sameSite.related, true);
  assert.deepStrictEqual(sameSite.groups, ["deploy-backlog-tracker.yml"]);
  assert.strictEqual(dq.trainsRelated(["faq/data/index.json"], ["backlog-tracker/x.js"]).related, true, "faq/ and backlog-tracker/ ship together");
  assert.strictEqual(dq.trainsRelated([dq.VERSION_JS, "ph-website/a"], [dq.VERSION_JS, "dsp-integration/b"]).related, false);
  assert.strictEqual(dq.trainsRelated(files.mIPd, files.ezm0).related, false);
});

test("related trains queue in click order and the second starts by itself when the first leaves", () => {
  let q = dq.emptyQueue();
  q = dq.enqueue(q, BT, iso(T0));
  q = dq.enqueue(q, SK, iso(T0 + MIN));
  q = dq.enqueue(q, BT, iso(T0 + 2 * MIN)); // a second click keeps its place
  assert.deepStrictEqual(q.entries.map((e) => e.projectId), ["oTcL", "New5"]);
  const state = { oTcL: deploying, New5: deploying };
  assert.strictEqual(dq.queueDecision(q, "oTcL", { filesById: files, stateById: state, nowMs: T0 + 5 * MIN }).action, "go");
  const second = dq.queueDecision(q, "New5", { filesById: files, stateById: state, nowMs: T0 + 5 * MIN });
  assert.strictEqual(second.action, "hold");
  assert.strictEqual(second.behind.projectId, "oTcL");
  assert.strictEqual(dq.queuedNote(second.behind).split(";")[0], "Queued behind Backlog Tracker & FAQs's deploy");
  assert.match(dq.queuedNote(second.behind), /starts by itself when that merges/);
  // The first merges (finishTrain → leaveDeployQueue): the second goes.
  q = dq.removeFromQueue(q, "oTcL");
  assert.strictEqual(dq.queueDecision(q, "New5", { filesById: files, stateById: state, nowMs: T0 + 40 * MIN }).action, "go");
});

test("unrelated trains run in parallel", () => {
  let q = dq.enqueue(dq.emptyQueue(), PH, iso(T0));
  q = dq.enqueue(q, DSP, iso(T0 + MIN));
  q = dq.enqueue(q, BT, iso(T0 + 2 * MIN));
  const state = { ezm0: deploying, mIPd: deploying, oTcL: deploying };
  for (const id of ["ezm0", "mIPd", "oTcL"]) {
    assert.strictEqual(dq.queueDecision(q, id, { filesById: files, stateById: state, nowMs: T0 + 3 * MIN }).action, "go", id);
  }
});

test("a stalled head is passed over after 60 minutes and keeps its place", () => {
  let q = dq.enqueue(dq.emptyQueue(), { ...BT, progressKey: "deploying|tests-running||aaa" }, iso(T0));
  q = dq.enqueue(q, SK, iso(T0 + MIN));
  const state = { oTcL: deploying, New5: deploying };
  assert.strictEqual(dq.queueDecision(q, "New5", { filesById: files, stateById: state, nowMs: T0 + 59 * MIN }).action, "hold");
  const late = dq.queueDecision(q, "New5", { filesById: files, stateById: state, nowMs: T0 + 61 * MIN });
  assert.strictEqual(late.action, "go");
  assert.deepStrictEqual(late.passedOver.map((e) => e.projectId), ["oTcL"]);
  assert.deepStrictEqual(q.entries.map((e) => e.projectId), ["oTcL", "New5"], "stays first in line");
  assert.match(dq.passedOverNote(late.passedOver[0], "Staff Kanban"), /no progress for 60 minutes, so Staff Kanban went ahead/);
  // Progress resets the clock: it holds the queue again.
  q = dq.refreshProgress(q, "oTcL", "deploying|||bbb", iso(T0 + 62 * MIN));
  assert.strictEqual(dq.queueDecision(q, "New5", { filesById: files, stateById: state, nowMs: T0 + 63 * MIN }).action, "hold");
  // A conflicted head is passed over at once.
  assert.strictEqual(dq.queueDecision(q, "New5", { filesById: files, stateById: { ...state, oTcL: { trainStatus: "conflict" } }, nowMs: T0 + 63 * MIN }).action, "go");
});

test("pruning drops finished deploys and keeps a conflicted one for a day", () => {
  let q = dq.enqueue(dq.emptyQueue(), BT, iso(T0));
  q = dq.enqueue(q, SK, iso(T0));
  q = dq.enqueue(q, PH, iso(T0));
  const state = { oTcL: { trainReady: false, trainStatus: "idle" }, New5: { trainStatus: "conflict" }, ezm0: { trainReady: true } };
  assert.deepStrictEqual(dq.pruneQueue(q, state, T0 + MIN).entries.map((e) => e.projectId), ["New5", "ezm0"]);
  assert.deepStrictEqual(dq.pruneQueue(q, state, T0 + 25 * 60 * MIN).entries.map((e) => e.projectId), ["ezm0"]);
});

test("the queue gate comes before main is merged in, the train tests and the version bump", () => {
  const src = fs.readFileSync(path.join(__dirname, "../scripts/run-backlog-automation.js"), "utf8");
  const body = src.slice(src.indexOf("async function processDeployTrain(project)"), src.indexOf("async function reconcileMergedTrains()"));
  const at = (s) => { const i = body.indexOf(s); assert.ok(i > 0, `missing: ${s}`); return i; };
  const gate = at("const queued = await deployQueueGate(project, deployBranch);");
  const held = at('trainHold: "queued"');
  const mergeMain = at('"merge", "origin/main", "--no-edit", "--quiet"');
  const tests = at("const gate = readTrainTestGate(deployBranch);");
  const bump = at("commitOnTrain(`Bump version to ${nextVersion} for deployment`)");
  assert.ok(gate < held && held < mergeMain, "a queued train returns before main is merged in");
  assert.ok(mergeMain < tests, "main is merged in before the train's tests are read (tests run once on the final head)");
  assert.ok(tests < bump, "the bump comes after the tests and starts none");
  // Nothing between the gate and its return dispatches a suite.
  const heldBlock = body.slice(gate, body.indexOf("return;", held));
  assert.ok(!/dispatchTrainTests|commitOnTrain|pushTrain/.test(heldBlock), "a queued train starts no suite, writes no bump");
});

test("finishTrain takes the train off the queue and asks for the next run", () => {
  const src = fs.readFileSync(path.join(__dirname, "../scripts/run-backlog-automation.js"), "utf8");
  const body = src.slice(src.indexOf("async function finishTrain("), src.indexOf("async function processDeployTrain(project)"));
  // Every member of a release group leaves the queue (just the project itself without one).
  assert.ok(/for \(const pid of releaseGroups\.trainProjectIdsOf\(project\)\)[^\n]*await leaveDeployQueue\(pid\)/.test(body));
  assert.ok(body.includes("followUpReasons.push"));
});

// ── 3. version.js resolver ───────────────────────────────────────────────

const VERSION_TEXT = (v) => `// header\n// more\nexport const APP_VERSION = "${v}";\n`;

test("resolveVersionJsConflict takes main's line when only APP_VERSION differs", () => {
  assert.strictEqual(dq.resolveVersionJsConflict(VERSION_TEXT("1.5.398"), VERSION_TEXT("1.5.399")), VERSION_TEXT("1.5.399"));
  assert.strictEqual(dq.resolveVersionJsConflict(VERSION_TEXT("1.5.398") + "x\n", VERSION_TEXT("1.5.399")), null);
  assert.strictEqual(dq.resolveVersionJsConflict(null, VERSION_TEXT("1.5.399")), null);
});

function sh(cwd, cmd, args) {
  return execFileSync(cmd, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}
test("a train holding a stale bump takes main's version.js when main is merged in (PR #585)", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "deploy-queue-test-"));
  const origin = path.join(root, "origin.git");
  const work = path.join(root, "work");
  fs.mkdirSync(origin); fs.mkdirSync(work);
  sh(origin, "git", ["init", "--bare", "--quiet"]);
  sh(work, "git", ["init", "--quiet", "-b", "main"]);
  sh(work, "git", ["config", "user.name", "test"]);
  sh(work, "git", ["config", "user.email", "test@example.com"]);
  const vpath = path.join(work, dq.VERSION_JS);
  fs.mkdirSync(path.dirname(vpath), { recursive: true });
  const write = (rel, text) => fs.writeFileSync(path.join(work, rel), text);
  write(dq.VERSION_JS, VERSION_TEXT("1.5.397"));
  write("README.md", "readme\n");
  sh(work, "git", ["add", "-A"]); sh(work, "git", ["commit", "-m", "init", "--quiet"]);
  sh(work, "git", ["remote", "add", "origin", origin]);
  sh(work, "git", ["push", "-u", "origin", "main", "--quiet"]);
  // The train bumps to 1.5.398 and carries a ticket; PH Website merges first with 1.5.398 → 1.5.399 on main.
  sh(work, "git", ["checkout", "-b", "deploy/x", "--quiet"]);
  write("ticket.txt", "ticket\n");
  write(dq.VERSION_JS, VERSION_TEXT("1.5.398"));
  sh(work, "git", ["add", "-A"]); sh(work, "git", ["commit", "-m", "ticket + bump", "--quiet"]);
  sh(work, "git", ["push", "-u", "origin", "deploy/x", "--quiet"]);
  sh(work, "git", ["checkout", "main", "--quiet"]);
  write(dq.VERSION_JS, VERSION_TEXT("1.5.399"));
  sh(work, "git", ["add", "-A"]); sh(work, "git", ["commit", "-m", "other train", "--quiet"]);
  sh(work, "git", ["push", "origin", "main", "--quiet"]);
  process.chdir(work);
  const r = auto.syncTrainWithMain("deploy/x");
  assert.strictEqual(r.kind, "merged", JSON.stringify(r));
  assert.strictEqual(sh(work, "git", ["show", `origin/deploy/x:${dq.VERSION_JS}`]), VERSION_TEXT("1.5.399").trim());
  assert.strictEqual(sh(work, "git", ["show", "origin/deploy/x:ticket.txt"]), "ticket");
});

// ── 5. Shared files between trains ───────────────────────────────────────

test("overlap from two file lists: one sharedWith entry per train, version.js ignored, one note", () => {
  const entries = dq.sharedWithEntries(
    ["backlog-tracker/MCP.md", "backlog-tracker/public/index.html", dq.VERSION_JS],
    [
      { projectId: "New5", projectName: "Staff Kanban", files: ["backlog-tracker/MCP.md", dq.VERSION_JS], conflictPaths: [] },
      { projectId: "ezm0", projectName: "PH Website", files: ["ph-website/a.php", dq.VERSION_JS] },
    ],
  );
  assert.deepStrictEqual(entries, [{ projectId: "New5", projectName: "Staff Kanban", paths: ["backlog-tracker/MCP.md"], conflictPaths: [], conflict: false }]);
  const note = dq.sharedWithNote(entries);
  assert.match(note, /^Also changed on Staff Kanban's train: backlog-tracker\/MCP\.md\./);
  assert.strictEqual(dq.sharedWithNote([]), "");
});

test("a merge-tree conflict between the two tips gives the warning variant", () => {
  const out = "4b825dc642cb6eb9a060e54bf8d69288fbee4904\nbacklog-tracker/MCP.md\nbacklog-tracker/functions/mcp-server.js\n\nAuto-merging backlog-tracker/MCP.md\nCONFLICT (content): Merge conflict in backlog-tracker/MCP.md\n";
  const conflicts = dq.parseMergeTreeConflicts(out);
  assert.deepStrictEqual(conflicts, ["backlog-tracker/MCP.md", "backlog-tracker/functions/mcp-server.js"]);
  assert.deepStrictEqual(dq.parseMergeTreeConflicts("4b825dc642cb6eb9a060e54bf8d69288fbee4904\n"), []);
  const [e] = dq.sharedWithEntries(["backlog-tracker/MCP.md"], [{ projectId: "New5", projectName: "Staff Kanban", files: ["backlog-tracker/MCP.md"], conflictPaths: conflicts }]);
  assert.strictEqual(e.conflict, true);
  assert.match(dq.sharedWithNote([e]), /^Conflicts with Staff Kanban's train: backlog-tracker\/MCP\.md, backlog-tracker\/functions\/mcp-server\.js\./);
});

// ── 6. Owned paths ───────────────────────────────────────────────────────

const PROJECTS = [
  { id: "oTcLAbnhUUO2S7NkbsuV", name: "Backlog Tracker & FAQs" },
  { id: "New5VKTF2QBqT3T4YEla", name: "Staff Kanban", repoFolder: "kanban-staff-board" },
  { id: "ezm0maxN6hmtogaW5M2P", name: "PH Website", repoFolder: "ph-website" },
  { id: "mIPdOCAWevhrgD8g2tCZ", name: "Display Types & DSP Integration", repoFolder: "dsp-integration" },
];

test("ownedPaths: explicit list, the three defaults, else the repo folder", () => {
  assert.deepStrictEqual(dq.ownedPathsOf({ id: "x", ownedPaths: ["a/", "b"] }), ["a/", "b"]);
  assert.deepStrictEqual(dq.ownedPathsOf(PROJECTS[3]), ["dsp-integration/"]);
  assert.ok(dq.ownedPathsOf(PROJECTS[0]).includes("CLAUDE.md"));
  assert.ok(dq.ownedPathsOf(PROJECTS[1]).includes("backlog-tracker/public/js/kanban/"));
  assert.deepStrictEqual(dq.ownedPathsOf({ id: "y" }), []);
});

test("a patch changing another project's files is warned about, by the longest owning prefix, never refused", () => {
  // A Backlog Tracker ticket touching the Kanban's files.
  const bt = dq.foreignOwnedPaths(["backlog-tracker/public/js/app.js", "backlog-tracker/public/js/kanban/board.js", "backlog-tracker/functions/kanban-core.js", dq.VERSION_JS], PROJECTS[0], PROJECTS);
  assert.deepStrictEqual(bt, [{ projectId: "New5VKTF2QBqT3T4YEla", projectName: "Staff Kanban", paths: ["backlog-tracker/functions/kanban-core.js", "backlog-tracker/public/js/kanban/board.js"] }]);
  assert.match(dq.foreignPathsNote(bt), /^Changes Staff Kanban's files: /);
  assert.match(dq.foreignPathsNote(bt), /a warning, not a refusal/);
  // A Kanban ticket touching its own paths only: nothing.
  assert.deepStrictEqual(dq.foreignOwnedPaths(["kanban-staff-board/a", "backlog-tracker/public/css/kanban.css"], PROJECTS[1], PROJECTS), []);
  // A file nobody owns: nothing.
  assert.deepStrictEqual(dq.foreignOwnedPaths(["shared/interface-contract.md"], PROJECTS[2], PROJECTS), []);
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
