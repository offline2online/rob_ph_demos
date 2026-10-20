// A train commit someone has already reverted by hand counts as reverted
// (20 Oct 2026, ticket v8q30p66b1WaUMpD4Vuk): the automation's "revert
// conflicted — fix the branch by hand" note asked for exactly that, but the
// next run tried `git revert` on the same commit again and conflicted forever.
// Drives the REAL revertCommitFor() against a throwaway git repository.
// Run with:  node test/train-revert-by-hand.test.js
"use strict";
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const repo = fs.mkdtempSync(path.join(os.tmpdir(), "revert-by-hand-"));
const git = (...args) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: repo, encoding: "utf8" }).trim();
git("init", "--quiet", "-b", "main");
fs.writeFileSync(path.join(repo, "a.txt"), "one\n"); git("add", "."); git("commit", "--quiet", "-m", "base");
fs.writeFileSync(path.join(repo, "a.txt"), "two\n"); git("commit", "--quiet", "-am", "ticket change\n\nBacklog item: v8q30p66b1WaUMpD4Vuk");
const ticket = git("rev-parse", "HEAD");
fs.writeFileSync(path.join(repo, "b.txt"), "later\n"); git("add", "."); git("commit", "--quiet", "-m", "later ticket");
const other = git("rev-parse", "HEAD");
git("revert", "--no-edit", ticket);
const handRevert = git("rev-parse", "HEAD");

const cwd = process.cwd();
process.chdir(repo);
let failed = 0;
try {
  const { revertCommitFor } = require("../scripts/run-backlog-automation.js");
  const check = (name, fn) => { try { fn(); console.log(`  ok  ${name}`); } catch (err) { failed++; console.log(`FAIL  ${name}\n      ${err.stack}`); } };
  check("a commit reverted by hand is found, with the revert that undid it", () => assert.strictEqual(revertCommitFor(ticket), handRevert));
  check("a commit nobody reverted is not", () => assert.strictEqual(revertCommitFor(other), null));
  check("an unknown sha is not an error", () => assert.strictEqual(revertCommitFor("0".repeat(40)), null));
} finally {
  process.chdir(cwd);
  fs.rmSync(repo, { recursive: true, force: true });
}
console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);
