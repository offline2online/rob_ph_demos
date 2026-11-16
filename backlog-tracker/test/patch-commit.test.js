// A patch handed over as a commit (run-backlog-automation.js → patchFilesFromCommit).
// A build session pushes its commit to its own branch and writes only
// { patchCommit, patchRef, patchBaseSha } on the card; the automation reads the
// changed files from git, as the [{path, content}] list a patchFiles hand-over
// carries. Added 14 Nov 2026, after a built and tested ticket could not be
// handed over as file contents. Runs on plain node against a disposable repo.
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { patchFilesFromCommit, patchRefProblem } = require("../scripts/run-backlog-automation.js");

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (err) { failed++; console.log(`FAIL  ${name}\n      ${err && err.stack ? err.stack : err}`); }
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "patch-commit-"));
const git = (...args) => execFileSync("git", args, { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const write = (p, text) => { fs.mkdirSync(path.dirname(path.join(dir, p)), { recursive: true }); fs.writeFileSync(path.join(dir, p), text); };
const opts = { cwd: dir };

git("init", "-q", "-b", "main");
git("config", "user.email", "test@example.com"); git("config", "user.name", "Test");
write("backlog-tracker/MCP.md", "# MCP\n\nOne.\n");
write("backlog-tracker/functions/mcp-server.js", "const a = 1;\n");
write("old/gone.txt", "remove me\n");
write("untouched.txt", "same\n");
git("add", "-A"); git("commit", "-q", "-m", "base");
const base = git("rev-parse", "HEAD");

git("checkout", "-q", "-b", "claude/build-session");
write("backlog-tracker/MCP.md", "# MCP\n\nOne.\n\nTwo, with a trailing newline kept.\n");
write("backlog-tracker/functions/mcp-server.js", "const a = 2; // owner@example.com stays in the file\n");
write("backlog-tracker/test/new one.test.js", "// a new file, with a space in its name\n");
fs.rmSync(path.join(dir, "old/gone.txt"));
git("add", "-A"); git("commit", "-q", "-m", "ticket");
const commit = git("rev-parse", "HEAD");

test("the files a commit changes come back as the patchFiles list: full new text, null for a deleted path, nothing untouched", () => {
  const files = patchFilesFromCommit(base, commit, opts);
  const byPath = Object.fromEntries(files.map((f) => [f.path, f.content]));
  assert.deepEqual(Object.keys(byPath).sort(), ["backlog-tracker/MCP.md", "backlog-tracker/functions/mcp-server.js", "backlog-tracker/test/new one.test.js", "old/gone.txt"]);
  assert.equal(byPath["backlog-tracker/MCP.md"], "# MCP\n\nOne.\n\nTwo, with a trailing newline kept.\n", "exact text, final newline included");
  assert.equal(byPath["backlog-tracker/functions/mcp-server.js"], "const a = 2; // owner@example.com stays in the file\n", "a file holding an address is read like any other");
  assert.equal(byPath["backlog-tracker/test/new one.test.js"], "// a new file, with a space in its name\n");
  assert.equal(byPath["old/gone.txt"], null, "a deleted path");
  for (const f of files) assert.deepEqual(Object.keys(f).sort(), ["content", "path"]);
});

test("two commits on the session's branch are handed over as one patch", () => {
  write("backlog-tracker/MCP.md", "# MCP\n\nOne.\n\nTwo, with a trailing newline kept.\n\nThree.\n");
  git("add", "-A"); git("commit", "-q", "-m", "ticket, second commit");
  const second = git("rev-parse", "HEAD");
  const files = patchFilesFromCommit(base, second, opts);
  assert.equal(files.length, 4);
  assert.match(files.find((f) => f.path === "backlog-tracker/MCP.md").content, /Three\.\n$/);
});

test("a commit that changes nothing is an empty patch (the already-built case)", () => {
  assert.deepEqual(patchFilesFromCommit(base, base, opts), []);
});

test("refused with a plain reason: a short or made-up id, no base, a commit not built on the base, a binary file", () => {
  assert.throws(() => patchFilesFromCommit(base, commit.slice(0, 7), opts), /full 40-character commit id/);
  assert.throws(() => patchFilesFromCommit(base, "main; rm -rf /", opts), /full 40-character commit id/);
  assert.throws(() => patchFilesFromCommit("", commit, opts), /needs patchBaseSha/);
  assert.throws(() => patchFilesFromCommit(base, "0".repeat(40), opts), /is not built on patchBaseSha/);
  // A commit on another line of history than the base it names.
  git("checkout", "-q", "main");
  write("elsewhere.txt", "main moved\n"); git("add", "-A"); git("commit", "-q", "-m", "main moves");
  const mainHead = git("rev-parse", "HEAD");
  assert.throws(() => patchFilesFromCommit(mainHead, commit, opts), /is not built on patchBaseSha/);
  git("checkout", "-q", "-b", "claude/binary", base);
  fs.writeFileSync(path.join(dir, "logo.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3, 0, 255, 254]));
  git("add", "-A"); git("commit", "-q", "-m", "binary");
  assert.throws(() => patchFilesFromCommit(base, git("rev-parse", "HEAD"), opts), /logo\.png is a binary file/);
});

test("a hand-over may name only a claude/* session branch (the push rule)", () => {
  assert.equal(patchRefProblem(""), "");
  assert.equal(patchRefProblem(undefined), "");
  assert.equal(patchRefProblem("claude/fix-tc-68-abc123"), "");
  for (const bad of ["main", "deploy/backlog-tracker-faqs", "fix/console", "claudex/x", "claude", "claude/../main", "refs/heads/main"]) {
    assert.match(patchRefProblem(bad), /not a claude\/\* session branch|not a branch name/, bad);
  }
});

fs.rmSync(dir, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
