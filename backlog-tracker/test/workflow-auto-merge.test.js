// Exercises the merge half of "The workflow-push GitHub App" (README.md):
// a train that changes a file under .github/workflows/ is merged by the
// pipeline itself, with the App token, when WORKFLOW_AUTO_MERGE is on and
// workflowAutoMergeBlockers() finds nothing — the same three guardrails
// the push had, re-checked against the PR head at merge time — and is
// left for a person otherwise. Until 25 Sep 2026 every such train stopped
// at "awaiting-human-merge" (PR #211 sat in Approved for Deployment for
// two hours that way).
//
// Runs against two disposable, LOCAL-ONLY git repos under a fresh
// os.tmpdir() directory (a bare "origin" and a working clone) — never the
// real offline2online/rob_ph_demos repo. run-backlog-automation.js is
// `require()`d, which is safe because its own main() is guarded behind
// `require.main === module`. The two switches are module-level constants
// read from the environment at load, so the module is re-required with a
// different environment per case (loadScript below).
//
// Run with:  node test/workflow-auto-merge.test.js
"use strict";
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

function sh(cwd, cmd, args) {
  return execFileSync(cmd, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

const WORKFLOW = ".github/workflows/deploy.yml";
const ON_MAIN = [
  "name: Deploy",
  "",
  "on:",
  "  push:",
  "    branches: [main]",
  "  workflow_dispatch: {}",
  "",
  "jobs:",
  "  deploy:",
  "    runs-on: ubuntu-latest",
  "    steps:",
  "      - run: echo deploy",
  "",
].join("\n");

// A bare origin with `main` holding one workflow, and a clone of it that
// has fetched origin/main — the shape the runner sees after checkout.
function makeDisposableRepoPair() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "workflow-auto-merge-test-"));
  const bareOrigin = path.join(root, "origin.git");
  const work = path.join(root, "work");
  fs.mkdirSync(bareOrigin);
  fs.mkdirSync(work);
  sh(bareOrigin, "git", ["init", "--bare", "--quiet"]);
  sh(work, "git", ["init", "--quiet", "-b", "main"]);
  sh(work, "git", ["config", "user.name", "test"]);
  sh(work, "git", ["config", "user.email", "test@example.com"]);
  fs.mkdirSync(path.join(work, ".github/workflows"), { recursive: true });
  fs.writeFileSync(path.join(work, WORKFLOW), ON_MAIN);
  fs.writeFileSync(path.join(work, "README.md"), "hello\n");
  sh(work, "git", ["add", "-A"]);
  sh(work, "git", ["commit", "-m", "initial commit", "--quiet"]);
  sh(work, "git", ["remote", "add", "origin", bareOrigin]);
  sh(work, "git", ["push", "-u", "origin", "main", "--quiet"]);
  return { root, bareOrigin, work };
}

// A train branch on origin, one commit ahead of main, made by `mutate(work)`.
function makeTrain(work, branch, mutate, message = "ticket commit\n\nBacklog item: abc123") {
  sh(work, "git", ["checkout", "-B", branch, "origin/main", "--quiet"]);
  mutate(work);
  sh(work, "git", ["add", "-A"]);
  sh(work, "git", ["commit", "-m", message, "--quiet"]);
  sh(work, "git", ["push", "-u", "origin", branch, "--quiet"]);
  sh(work, "git", ["checkout", "main", "--quiet"]);
  sh(work, "git", ["fetch", "origin", "--quiet"]);
}

function cleanup(root) {
  fs.rmSync(root, { recursive: true, force: true });
}

const scriptPath = require.resolve("../scripts/run-backlog-automation.js");

// The switches are read once, at load — so load the script fresh for each
// environment under test. Everything else the script requires is shared
// and harmless to keep cached.
function loadScript({ autoMerge, token }) {
  if (autoMerge === undefined) delete process.env.WORKFLOW_AUTO_MERGE; else process.env.WORKFLOW_AUTO_MERGE = autoMerge;
  if (token === undefined) delete process.env.WORKFLOW_PUSH_TOKEN; else process.env.WORKFLOW_PUSH_TOKEN = token;
  delete require.cache[scriptPath];
  return require(scriptPath);
}

let passed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed += 1; console.log(`  ok  ${name}`); }
  catch (err) { failures.push([name, err]); console.log(`FAIL  ${name}\n      ${err && err.stack ? err.stack : err}`); }
}

// Runs `fn` inside a fresh repo pair with the clone as cwd (the script's
// git calls are cwd-relative), and always restores cwd and removes the pair.
function withRepo(fn) {
  const { root, work } = makeDisposableRepoPair();
  const originalCwd = process.cwd();
  process.chdir(work);
  try { fn({ root, work }); }
  finally { process.chdir(originalCwd); cleanup(root); }
}

const editStep = (work) => fs.writeFileSync(path.join(work, WORKFLOW), ON_MAIN.replace("echo deploy", "echo deploy --verbose"));

test("workflowFilesChangedIn(): an edited workflow comes back with the branch's content; a deletion with null", () => {
  withRepo(({ work }) => {
    const { workflowFilesChangedIn } = loadScript({ autoMerge: "true", token: "t0k3n" });
    makeTrain(work, "deploy/edit", editStep);
    const edited = workflowFilesChangedIn("origin/deploy/edit");
    assert.deepStrictEqual(edited.map((f) => f.path), [WORKFLOW]);
    assert.match(edited[0].content, /echo deploy --verbose/);

    makeTrain(work, "deploy/delete", (w) => fs.rmSync(path.join(w, WORKFLOW)));
    assert.deepStrictEqual(workflowFilesChangedIn("origin/deploy/delete"), [{ path: WORKFLOW, content: null }]);

    makeTrain(work, "deploy/readme-only", (w) => fs.writeFileSync(path.join(w, "README.md"), "changed\n"));
    assert.deepStrictEqual(workflowFilesChangedIn("origin/deploy/readme-only"), []);
  });
});

test("blockers: the switch off names the switch; no App token names the token; both checked before any git", () => {
  withRepo(({ work }) => {
    makeTrain(work, "deploy/edit", editStep);
    let { workflowAutoMergeBlockers } = loadScript({ autoMerge: undefined, token: "t0k3n" });
    let blockers = workflowAutoMergeBlockers("origin/deploy/edit");
    assert.strictEqual(blockers.length, 1);
    assert.match(blockers[0], /WORKFLOW_AUTO_MERGE/);

    ({ workflowAutoMergeBlockers } = loadScript({ autoMerge: "false", token: "t0k3n" }));
    assert.match(workflowAutoMergeBlockers("origin/deploy/edit")[0], /WORKFLOW_AUTO_MERGE/);

    ({ workflowAutoMergeBlockers } = loadScript({ autoMerge: "true", token: undefined }));
    blockers = workflowAutoMergeBlockers("origin/deploy/edit");
    assert.strictEqual(blockers.length, 1);
    assert.match(blockers[0], /App token/);

    // Neither switch satisfied: both reasons, and a ref that doesn't even
    // exist is never touched — the answer is the same.
    ({ workflowAutoMergeBlockers } = loadScript({ autoMerge: undefined, token: undefined }));
    assert.strictEqual(workflowAutoMergeBlockers("origin/does-not-exist").length, 2);
  });
});

test("blockers: with both switches on, a step edit passes; an `on:` change, a new workflow and a deletion each block", () => {
  withRepo(({ work }) => {
    const { workflowAutoMergeBlockers } = loadScript({ autoMerge: "true", token: "t0k3n" });
    makeTrain(work, "deploy/edit", editStep);
    assert.deepStrictEqual(workflowAutoMergeBlockers("origin/deploy/edit"), []);

    makeTrain(work, "deploy/trigger", (w) => fs.writeFileSync(path.join(w, WORKFLOW), ON_MAIN.replace("branches: [main]", "branches: [main, deploy/trigger]")));
    const trigger = workflowAutoMergeBlockers("origin/deploy/trigger");
    assert.strictEqual(trigger.length, 1);
    assert.match(trigger[0], /`on:` trigger block differs/);

    makeTrain(work, "deploy/new", (w) => fs.writeFileSync(path.join(w, ".github/workflows/extra.yml"), ON_MAIN));
    const added = workflowAutoMergeBlockers("origin/deploy/new");
    assert.strictEqual(added.length, 1);
    assert.match(added[0], /new workflow files/);

    makeTrain(work, "deploy/delete", (w) => fs.rmSync(path.join(w, WORKFLOW)));
    const deleted = workflowAutoMergeBlockers("origin/deploy/delete");
    assert.strictEqual(deleted.length, 1);
    assert.match(deleted[0], /can't be deleted/);

    // A comment-only or whitespace-only difference inside `on:` is not a
    // trigger change (triggerBlock() ignores both) — the branch can push
    // and merge.
    makeTrain(work, "deploy/comment", (w) => fs.writeFileSync(path.join(w, WORKFLOW), ON_MAIN.replace("on:\n", "on:  # deploy triggers\n").replace("echo deploy", "echo deployed")));
    assert.deepStrictEqual(workflowAutoMergeBlockers("origin/deploy/comment"), []);

    // A ref that can't be read is a blocker, not a pass.
    const unreadable = workflowAutoMergeBlockers("origin/no-such-branch");
    assert.strictEqual(unreadable.length, 1);
    assert.match(unreadable[0], /couldn't read the workflow changes/);
  });
});

test("mergeWithWorkflowToken(): a --no-ff merge of the train lands on origin's main with GitHub's own subject line", () => {
  withRepo(({ work }) => {
    const { mergeWithWorkflowToken } = loadScript({ autoMerge: "true", token: "t0k3n" });
    makeTrain(work, "deploy/backlog-tracker-faqs", editStep);
    const trainTip = sh(work, "git", ["rev-parse", "origin/deploy/backlog-tracker-faqs"]);
    const mainBefore = sh(work, "git", ["rev-parse", "origin/main"]);

    const sha = mergeWithWorkflowToken(211, "origin/deploy/backlog-tracker-faqs", "Deploy Backlog Tracker & FAQs — 2 tickets");

    sh(work, "git", ["fetch", "origin", "--quiet"]);
    assert.strictEqual(sh(work, "git", ["rev-parse", "origin/main"]), sha, "origin/main is the merge commit");
    const parents = sh(work, "git", ["rev-list", "--parents", "-n", "1", sha]).split(" ").slice(1);
    assert.deepStrictEqual(parents, [mainBefore, trainTip], "a real two-parent merge, main first");
    const subject = sh(work, "git", ["log", "-1", "--format=%s", sha]);
    assert.strictEqual(subject, "Merge pull request #211 from offline2online/deploy/backlog-tracker-faqs");
    assert.strictEqual(sh(work, "git", ["log", "-1", "--format=%b", sha]), "Deploy Backlog Tracker & FAQs — 2 tickets");
    assert.match(sh(work, "git", ["show", `origin/main:${WORKFLOW}`]), /echo deploy --verbose/, "the train's workflow change is on main");
    // The ticket's own commit — and its `Backlog item:` trailer — is intact
    // in main's history, which is what a merge (never a squash) is for.
    assert.match(sh(work, "git", ["log", "--format=%B", `${mainBefore}..origin/main`]), /Backlog item: abc123/);
    assert.strictEqual(sh(work, "git", ["branch", "--show-current"]), "main");
  });
});

test("mergeWithWorkflowToken(): a push origin refuses throws, leaving no merge in progress", () => {
  withRepo(({ work, root }) => {
    const { mergeWithWorkflowToken } = loadScript({ autoMerge: "true", token: "t0k3n" });
    makeTrain(work, "deploy/train", editStep);
    // The script fetches main itself just before merging, so "main moved
    // under us" can't be staged from a single process; a pre-receive hook
    // that refuses the push is the same failure as far as the caller is
    // concerned (the push throws, nothing landed on origin).
    const mainBefore = sh(work, "git", ["rev-parse", "origin/main"]);
    fs.writeFileSync(path.join(root, "origin.git", "hooks", "pre-receive"), "#!/bin/sh\necho rejected >&2\nexit 1\n");
    fs.chmodSync(path.join(root, "origin.git", "hooks", "pre-receive"), 0o755);
    assert.throws(() => mergeWithWorkflowToken(5, "origin/deploy/train", "t"), /rejected|pre-receive/);
    sh(work, "git", ["fetch", "origin", "--quiet"]);
    assert.strictEqual(sh(work, "git", ["rev-parse", "origin/main"]), mainBefore, "origin/main untouched");
    assert.strictEqual(sh(work, "git", ["branch", "--show-current"]), "main");
    assert.ok(!fs.existsSync(path.join(work, ".git", "MERGE_HEAD")), "no merge left in progress");
  });
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
