// Exercises archiveAndResetOrphanedBranch()/dateStamp() from
// scripts/run-backlog-automation.js — point 3 of "Ready for Dev CTA stays
// hidden after all train tickets are deleted (stuck trainLocked)": when
// reconcileLockedTrains() finds a project's train empty with nothing
// merged, this is what tags any commits the branch holds that never
// reached main (a card deleted outright, or reverted history that nets to
// zero but is still real history) as archive/<branch>-<date> and resets
// the branch back to main.
//
// Runs against two disposable, LOCAL-ONLY git repos under a fresh
// os.tmpdir() directory (a bare "origin" and a working clone) — never the
// real offline2online/rob_ph_demos repo, per this ticket's own
// instructions. run-backlog-automation.js is `require()`d (not spawned),
// which is safe because its own main() is guarded behind
// `require.main === module` specifically so this works.
//
// Run with:  node test/train-lock-branch-archive.test.js
"use strict";
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

function sh(cwd, cmd, args) {
  return execFileSync(cmd, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function makeDisposableRepoPair() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "train-lock-archive-test-"));
  const bareOrigin = path.join(root, "origin.git");
  const work = path.join(root, "work");
  fs.mkdirSync(bareOrigin);
  fs.mkdirSync(work);
  sh(bareOrigin, "git", ["init", "--bare", "--quiet"]);
  sh(work, "git", ["init", "--quiet", "-b", "main"]);
  sh(work, "git", ["config", "user.name", "test"]);
  sh(work, "git", ["config", "user.email", "test@example.com"]);
  fs.writeFileSync(path.join(work, "README.md"), "hello\n");
  sh(work, "git", ["add", "-A"]);
  sh(work, "git", ["commit", "-m", "initial commit", "--quiet"]);
  sh(work, "git", ["remote", "add", "origin", bareOrigin]);
  sh(work, "git", ["push", "-u", "origin", "main", "--quiet"]);
  return { root, bareOrigin, work };
}

function cleanup(root) {
  fs.rmSync(root, { recursive: true, force: true });
}

function remoteTags(work) {
  const out = sh(work, "git", ["ls-remote", "--tags", "origin"]);
  return out
    ? out.split("\n").map((l) => l.split("\t")[1]).filter(Boolean).map((ref) => ref.replace(/^refs\/tags\//, ""))
    : [];
}

function remoteBranchSha(work, branch) {
  const out = sh(work, "git", ["ls-remote", "origin", `refs/heads/${branch}`]);
  return out ? out.split("\t")[0] : null;
}

let passed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed += 1; console.log(`  ok  ${name}`); }
  catch (err) { failures.push([name, err]); console.log(`FAIL  ${name}\n      ${err && err.stack ? err.stack : err}`); }
}

const scriptPath = require.resolve("../scripts/run-backlog-automation.js");
const { archiveAndResetOrphanedBranch, dateStamp } = require(scriptPath);

test("dateStamp() is a plain YYYY-MM-DD", () => {
  assert.match(dateStamp(), /^\d{4}-\d{2}-\d{2}$/);
});

test("a deploy branch that doesn't exist on origin is a no-op", () => {
  const { root, work } = makeDisposableRepoPair();
  const originalCwd = process.cwd();
  try {
    process.chdir(work);
    const result = archiveAndResetOrphanedBranch("deploy/never-created");
    assert.deepStrictEqual(result, { ok: true, tag: null });
  } finally {
    process.chdir(originalCwd);
    cleanup(root);
  }
});

test("THE ORPHANED-COMMITS CASE: a branch ahead of main gets tagged archive/<branch>-<date> and reset to main", () => {
  const { root, work, bareOrigin } = makeDisposableRepoPair();
  const originalCwd = process.cwd();
  const branch = "deploy/orphan-project";
  try {
    // Simulate a card deleted outright while its commit was still live on
    // the train: two commits on the integration branch that never reached
    // main and never went through processRevertFromTrain either.
    sh(work, "git", ["checkout", "-b", branch, "--quiet"]);
    fs.writeFileSync(path.join(work, "a.txt"), "a\n");
    sh(work, "git", ["add", "-A"]);
    sh(work, "git", ["commit", "-m", "ticket A", "--quiet"]);
    fs.writeFileSync(path.join(work, "b.txt"), "b\n");
    sh(work, "git", ["add", "-A"]);
    sh(work, "git", ["commit", "-m", "ticket B (its own card was deleted)", "--quiet"]);
    const orphanedTip = sh(work, "git", ["rev-parse", "HEAD"]);
    sh(work, "git", ["push", "-u", "origin", branch, "--quiet"]);
    sh(work, "git", ["checkout", "main", "--quiet"]);

    process.chdir(work);
    const result = archiveAndResetOrphanedBranch(branch);

    assert.strictEqual(result.ok, true, result.error);
    assert.ok(result.tag, "a tag should have been created");
    assert.strictEqual(result.tag, `archive/${branch}-${dateStamp()}`);

    // The tag is really on origin, pointing at the orphaned work.
    assert.ok(remoteTags(work).includes(result.tag), "the tag should be pushed to origin");
    const tagTarget = sh(work, "git", ["rev-parse", `refs/tags/${result.tag}`]);
    assert.strictEqual(tagTarget, orphanedTip, "the tag should point at the branch's orphaned tip, not main");

    // The branch itself is reset to main on origin — nothing left dangling
    // for the next train to trip over.
    const mainSha = sh(work, "git", ["rev-parse", "origin/main"]);
    const branchShaAfter = remoteBranchSha(work, branch);
    assert.strictEqual(branchShaAfter, mainSha, "the integration branch should be reset to main on origin");

    // The orphaned work is still fetchable from the tag even though
    // nothing on the board points at it any more.
    sh(work, "git", ["fetch", "origin", `refs/tags/${result.tag}`, "--quiet"]);
    const filesAtTag = sh(work, "git", ["ls-tree", "-r", "--name-only", result.tag]);
    assert.ok(filesAtTag.includes("a.txt") && filesAtTag.includes("b.txt"), "the archived tag should still contain the orphaned files");
  } finally {
    process.chdir(originalCwd);
    cleanup(root);
  }
});

test("a branch already equal to main (e.g. every ticket was already reverted, net zero) is reset with no tag created", () => {
  const { root, work } = makeDisposableRepoPair();
  const originalCwd = process.cwd();
  const branch = "deploy/already-clean";
  try {
    sh(work, "git", ["push", "-u", "origin", "main:" + branch, "--quiet"]);
    process.chdir(work);
    const result = archiveAndResetOrphanedBranch(branch);
    assert.strictEqual(result.ok, true, result.error);
    assert.strictEqual(result.tag, null, "nothing ahead of main means nothing worth archiving");
  } finally {
    process.chdir(originalCwd);
    cleanup(root);
  }
});

test("a second orphaned train the same day gets a distinctly-suffixed tag rather than colliding", () => {
  const { root, work } = makeDisposableRepoPair();
  const originalCwd = process.cwd();
  const branch = "deploy/repeat-offender";
  try {
    sh(work, "git", ["checkout", "-b", branch, "--quiet"]);
    fs.writeFileSync(path.join(work, "c1.txt"), "1\n");
    sh(work, "git", ["add", "-A"]);
    sh(work, "git", ["commit", "-m", "first orphaned commit", "--quiet"]);
    sh(work, "git", ["push", "-u", "origin", branch, "--quiet"]);
    sh(work, "git", ["checkout", "main", "--quiet"]);

    process.chdir(work);
    const first = archiveAndResetOrphanedBranch(branch);
    assert.strictEqual(first.ok, true, first.error);
    assert.ok(first.tag);

    // A second batch of tickets lands on the same (freshly reset) branch,
    // gets deleted too, all on the same calendar day.
    process.chdir(originalCwd);
    sh(work, "git", ["fetch", "origin", branch, "--quiet"]);
    sh(work, "git", ["checkout", "-B", branch, `origin/${branch}`, "--quiet"]);
    fs.writeFileSync(path.join(work, "c2.txt"), "2\n");
    sh(work, "git", ["add", "-A"]);
    sh(work, "git", ["commit", "-m", "second orphaned commit", "--quiet"]);
    sh(work, "git", ["push", "origin", branch, "--quiet"]);
    sh(work, "git", ["checkout", "main", "--quiet"]);

    process.chdir(work);
    const second = archiveAndResetOrphanedBranch(branch);
    assert.strictEqual(second.ok, true, second.error);
    assert.ok(second.tag);
    assert.notStrictEqual(second.tag, first.tag, "the second archive tag must not collide with the first");
    assert.strictEqual(second.tag, `${first.tag}-2`);
  } finally {
    process.chdir(originalCwd);
    cleanup(root);
  }
});

console.log(`\n${passed} passed, ${failures.length} failed\n`);
if (failures.length) {
  for (const [name, err] of failures) console.error(`--- ${name}\n${err && err.stack ? err.stack : err}\n`);
  process.exit(1);
}
