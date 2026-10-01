// The train is brought up to date with main before a ticket lands, and the
// patch's edits are carried onto whatever main brought in — the fix for the
// 30 Sep 2026 conflict (ticket Hdt4M6dEGe7uN8dmS8mT): the Routine wrote
// backlog-tracker/MCP.md against main, run-backlog-automation.js committed
// that whole file onto deploy/backlog-tracker-faqs four commits behind
// main, and Deploy to Main stopped with "merging main into
// deploy/backlog-tracker-faqs conflicted on backlog-tracker/MCP.md".
//
// Layers under test: syncTrainWithMain() and rebasePatchFilesOnto() against
// a disposable local repo pair — never the real origin. The script is
// require()d, which is safe because main() is guarded behind
// `require.main === module`.
//
// Run with:  node test/train-sync.test.js
"use strict";
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const { syncTrainWithMain, rebasePatchFilesOnto } = require("../scripts/run-backlog-automation.js");

let passed = 0;
const failures = [];
function test(name, fn) {
  const originalCwd = process.cwd();
  try { fn(); passed += 1; console.log(`  ok  ${name}`); }
  catch (err) { failures.push([name, err]); console.log(`FAIL  ${name}\n      ${err && err.stack ? err.stack : err}`); }
  finally { process.chdir(originalCwd); }
}

function sh(cwd, cmd, args) {
  return execFileSync(cmd, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}
function makeDisposableRepoPair() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "train-sync-test-"));
  const bareOrigin = path.join(root, "origin.git");
  const work = path.join(root, "work");
  fs.mkdirSync(bareOrigin);
  fs.mkdirSync(work);
  sh(bareOrigin, "git", ["init", "--bare", "--quiet"]);
  sh(work, "git", ["init", "--quiet", "-b", "main"]);
  sh(work, "git", ["config", "user.name", "test"]);
  sh(work, "git", ["config", "user.email", "test@example.com"]);
  fs.writeFileSync(path.join(work, "MCP.md"), "intro\n\nsection A\n\nsection B\n");
  fs.writeFileSync(path.join(work, "other.txt"), "untouched\n");
  sh(work, "git", ["add", "-A"]);
  sh(work, "git", ["commit", "-m", "initial", "--quiet"]);
  sh(work, "git", ["remote", "add", "origin", bareOrigin]);
  sh(work, "git", ["push", "-u", "origin", "main", "--quiet"]);
  return { root, work };
}
function commitFile(work, file, content, message) {
  fs.writeFileSync(path.join(work, file), content);
  sh(work, "git", ["add", "-A"]);
  sh(work, "git", ["commit", "-m", message, "--quiet"]);
  return sh(work, "git", ["rev-parse", "HEAD"]);
}
const BRANCH = "deploy/backlog-tracker-faqs";
function cutTrain(work) {
  sh(work, "git", ["checkout", "-b", BRANCH, "--quiet"]);
  sh(work, "git", ["push", "-u", "origin", BRANCH, "--quiet"]);
  sh(work, "git", ["checkout", "main", "--quiet"]);
}
const originSha = (work, ref) => { sh(work, "git", ["fetch", "origin", "--quiet"]); return sh(work, "git", ["rev-parse", `origin/${ref}`]); };
const originFile = (work, ref, file) => { sh(work, "git", ["fetch", "origin", "--quiet"]); return execFileSync("git", ["show", `origin/${ref}:${file}`], { cwd: work, encoding: "utf8" }); };
const cleanTree = (work) => sh(work, "git", ["status", "--porcelain"]) === "" && !fs.existsSync(path.join(work, ".git", "MERGE_HEAD"));

console.log("\nsyncTrainWithMain / rebasePatchFilesOnto against a disposable repo pair\n");

test("a train already on top of main is left alone", () => {
  const { root, work } = makeDisposableRepoPair();
  try {
    cutTrain(work);
    process.chdir(work);
    const before = originSha(work, BRANCH);
    const sync = syncTrainWithMain(BRANCH);
    assert.strictEqual(sync.kind, "current");
    assert.strictEqual(sync.behind, 0);
    assert.strictEqual(sync.baseTip, before);
    assert.strictEqual(originSha(work, BRANCH), before);
  } finally { process.chdir(root); fs.rmSync(root, { recursive: true, force: true }); }
});

test("THE INCIDENT'S SHAPE: an empty train that fell behind main is fast-forwarded to main before the ticket lands", () => {
  const { root, work } = makeDisposableRepoPair();
  try {
    cutTrain(work);
    const stale = originSha(work, BRANCH);
    // main moves on (PR #271/#272 and other projects' trains) while this
    // train has no ticket of its own.
    commitFile(work, "MCP.md", "intro\n\nsection A (PR #271)\n\nsection B\n", "PR #271 on main");
    commitFile(work, "other.txt", "changed on main\n", "another project's train");
    sh(work, "git", ["push", "origin", "main", "--quiet"]);
    process.chdir(work);
    const sync = syncTrainWithMain(BRANCH);
    assert.strictEqual(sync.kind, "fast-forwarded");
    assert.strictEqual(sync.behind, 2);
    assert.strictEqual(sync.baseTip, stale, "baseTip is the tip BEFORE the sync — what the Routine read");
    assert.strictEqual(originSha(work, BRANCH), originSha(work, "main"), "origin's branch now sits exactly on main");
    assert.ok(cleanTree(work));
  } finally { process.chdir(root); fs.rmSync(root, { recursive: true, force: true }); }
});

test("a train carrying a ticket gets main merged in (no conflict) and pushed", () => {
  const { root, work } = makeDisposableRepoPair();
  try {
    cutTrain(work);
    sh(work, "git", ["checkout", BRANCH, "--quiet"]);
    const ticketSha = commitFile(work, "MCP.md", "intro\n\nsection A\n\nsection B\n\nticket's paragraph\n", "Ticket on the train\n\nBacklog item: T1");
    sh(work, "git", ["push", "origin", BRANCH, "--quiet"]);
    sh(work, "git", ["checkout", "main", "--quiet"]);
    commitFile(work, "other.txt", "changed on main\n", "hotfix straight to main");
    sh(work, "git", ["push", "origin", "main", "--quiet"]);
    process.chdir(work);
    const sync = syncTrainWithMain(BRANCH);
    assert.strictEqual(sync.kind, "merged");
    assert.strictEqual(sync.behind, 1);
    assert.strictEqual(originFile(work, BRANCH, "other.txt"), "changed on main\n", "main's change is on the train now");
    assert.match(originFile(work, BRANCH, "MCP.md"), /ticket's paragraph/, "the ticket's own work survived");
    sh(work, "git", ["merge-base", "--is-ancestor", ticketSha, `origin/${BRANCH}`]);
    assert.ok(cleanTree(work));
  } finally { process.chdir(root); fs.rmSync(root, { recursive: true, force: true }); }
});

test("a real conflict between a ticket on the train and main is reported, nothing pushed, nothing left mid-merge", () => {
  const { root, work } = makeDisposableRepoPair();
  try {
    cutTrain(work);
    sh(work, "git", ["checkout", BRANCH, "--quiet"]);
    commitFile(work, "MCP.md", "intro\n\nsection A (ticket)\n\nsection B\n", "Ticket\n\nBacklog item: T1");
    sh(work, "git", ["push", "origin", BRANCH, "--quiet"]);
    const before = originSha(work, BRANCH);
    sh(work, "git", ["checkout", "main", "--quiet"]);
    commitFile(work, "MCP.md", "intro\n\nsection A (main)\n\nsection B\n", "conflicting change on main");
    sh(work, "git", ["push", "origin", "main", "--quiet"]);
    process.chdir(work);
    const sync = syncTrainWithMain(BRANCH);
    assert.strictEqual(sync.kind, "conflict");
    assert.deepStrictEqual(sync.paths, ["MCP.md"]);
    assert.match(sync.detail, /conflicted on MCP\.md/);
    assert.strictEqual(originSha(work, BRANCH), before, "a conflicted sync pushes nothing");
    assert.ok(cleanTree(work), "no merge left in progress for the next item to trip over");
  } finally { process.chdir(root); fs.rmSync(root, { recursive: true, force: true }); }
});

// ── rebasePatchFilesOnto ────────────────────────────────────────────────

function makeRebaseRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "train-rebase-test-"));
  const work = path.join(root, "work");
  fs.mkdirSync(work);
  sh(work, "git", ["init", "--quiet", "-b", "main"]);
  sh(work, "git", ["config", "user.name", "test"]);
  sh(work, "git", ["config", "user.email", "test@example.com"]);
  const base = commitFile(work, "MCP.md", "intro\n\nsection A\n\nsection B\n", "before the sync (what the Routine read)");
  commitFile(work, "unchanged.txt", "same\n", "an unrelated file");
  const baseTip = sh(work, "git", ["rev-parse", "HEAD"]);
  // What the sync brought in: main changed section A.
  commitFile(work, "MCP.md", "intro\n\nsection A (PR #271)\n\nsection B\n", "PR #271 on main");
  return { root, work, baseTip, base };
}

test("a Routine's edit to a file main also changed is carried onto main's version — main's change is kept", () => {
  const { root, work, baseTip } = makeRebaseRepo();
  try {
    process.chdir(work);
    const out = rebasePatchFilesOnto([{ path: "MCP.md", content: "intro\n\nsection A\n\nsection B\n\nTry it paragraph\n" }], baseTip);
    assert.deepStrictEqual(out.conflicts, []);
    assert.deepStrictEqual(out.rebased, ["MCP.md"]);
    assert.strictEqual(out.files[0].content, "intro\n\nsection A (PR #271)\n\nsection B\n\nTry it paragraph\n");
  } finally { process.chdir(root); fs.rmSync(root, { recursive: true, force: true }); }
});

test("THE INCIDENT: a Routine that already wrote against main (identical hunks) merges cleanly to exactly its own file", () => {
  const { root, work, baseTip } = makeRebaseRepo();
  try {
    process.chdir(work);
    const routineFile = "intro\n\nsection A (PR #271)\n\nsection B\n\nTry it paragraph\n";
    const out = rebasePatchFilesOnto([{ path: "MCP.md", content: routineFile }], baseTip);
    assert.deepStrictEqual(out.conflicts, []);
    assert.strictEqual(out.files[0].content, routineFile);
  } finally { process.chdir(root); fs.rmSync(root, { recursive: true, force: true }); }
});

test("an edit that collides with main's change is a conflict for that path, and the file is left as given", () => {
  const { root, work, baseTip } = makeRebaseRepo();
  try {
    process.chdir(work);
    const out = rebasePatchFilesOnto([{ path: "MCP.md", content: "intro\n\nsection A (routine)\n\nsection B\n" }], baseTip);
    assert.deepStrictEqual(out.conflicts, ["MCP.md"]);
    assert.deepStrictEqual(out.rebased, []);
    assert.strictEqual(out.files[0].content, "intro\n\nsection A (routine)\n\nsection B\n");
  } finally { process.chdir(root); fs.rmSync(root, { recursive: true, force: true }); }
});

test("a new file, a file the sync did not change, and a file identical to the branch are used exactly as given", () => {
  const { root, work, baseTip } = makeRebaseRepo();
  try {
    process.chdir(work);
    const out = rebasePatchFilesOnto([
      { path: "brand-new.md", content: "new\n" },
      { path: "unchanged.txt", content: "same but edited\n" },
      { path: "MCP.md", content: "intro\n\nsection A (PR #271)\n\nsection B\n" },
    ], baseTip);
    assert.deepStrictEqual(out.conflicts, []);
    assert.deepStrictEqual(out.rebased, []);
    assert.strictEqual(out.files[0].content, "new\n");
    assert.strictEqual(out.files[1].content, "same but edited\n");
    assert.strictEqual(out.files[2].content, "intro\n\nsection A (PR #271)\n\nsection B\n");
  } finally { process.chdir(root); fs.rmSync(root, { recursive: true, force: true }); }
});

console.log(`\n${passed} passed, ${failures.length} failed\n`);
if (failures.length) process.exit(1);
