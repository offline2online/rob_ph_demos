// Patches built in parallel (4 Oct 2026): one Notify Claude click now
// starts a session per ticket, so two patches can be written against the
// same train commit. The second to land must merge onto the first, not
// overwrite it with a whole-file copy taken before it existed — that is
// what patchBaseSha + rebasePatchFilesOnto do. Also covers the dependency
// release rule and the build-request write.
//
// Run with:  node test/parallel-builds.test.js
"use strict";
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const {
  rebasePatchFilesOnto, patchBaseFor, dependenciesLanded, buildRequestFields,
} = require("../scripts/run-backlog-automation.js");

let passed = 0; const failures = [];
function test(name, fn) {
  const cwd = process.cwd();
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (err) { failures.push(name); console.log(`FAIL  ${name}\n      ${err && err.stack || err}`); }
  finally { process.chdir(cwd); }
}
const sh = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

function repo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "parallel-builds-"));
  sh(dir, "init", "--quiet", "-b", "train");
  sh(dir, "config", "user.name", "t"); sh(dir, "config", "user.email", "t@example.com");
  fs.writeFileSync(path.join(dir, "REQUIREMENTS.md"), "# Spec\n\n## 5 Buyers\nold buyers\n\n## 6 Lists\nold lists\n\n## 7 Billing\nold billing\n");
  sh(dir, "add", "-A"); sh(dir, "commit", "-m", "base", "--quiet");
  return { dir, base: sh(dir, "rev-parse", "HEAD") };
}

test("two tickets written against the same commit both survive when the second lands", () => {
  const { dir, base } = repo();
  const file = path.join(dir, "REQUIREMENTS.md");
  const original = fs.readFileSync(file, "utf8");
  // Session A and session B both read `base`. A lands first: §5 rewritten.
  fs.writeFileSync(file, original.replace("old buyers", "buyers from synced DSP advertisers"));
  sh(dir, "commit", "-am", "ticket A", "--quiet");
  // B's patch: the whole file as B saw it at `base`, with §7 rewritten.
  const bPatch = [{ path: "REQUIREMENTS.md", content: original.replace("old billing", "settlement is final") }];
  process.chdir(dir);
  const { files, rebased, conflicts } = rebasePatchFilesOnto(bPatch, base);
  assert.deepStrictEqual(conflicts, []);
  assert.deepStrictEqual(rebased, ["REQUIREMENTS.md"]);
  assert.ok(files[0].content.includes("buyers from synced DSP advertisers"), "A's change kept");
  assert.ok(files[0].content.includes("settlement is final"), "B's change applied");
  // Without the base (the old behaviour) B's copy would have reverted A:
  assert.ok(!bPatch[0].content.includes("buyers from synced DSP advertisers"));
});

test("the same lines changed by both is a conflict, not a silent overwrite", () => {
  const { dir, base } = repo();
  const file = path.join(dir, "REQUIREMENTS.md");
  const original = fs.readFileSync(file, "utf8");
  fs.writeFileSync(file, original.replace("old lists", "lists per DSP"));
  sh(dir, "commit", "-am", "A", "--quiet");
  process.chdir(dir);
  const r = rebasePatchFilesOnto([{ path: "REQUIREMENTS.md", content: original.replace("old lists", "lists central") }], base);
  assert.deepStrictEqual(r.conflicts, ["REQUIREMENTS.md"]);
});

test("patchBaseFor: a resolvable patchBaseSha wins; otherwise the pre-sync tip; otherwise none", () => {
  const sha = "a".repeat(40);
  assert.strictEqual(patchBaseFor({ patchBaseSha: sha }, { kind: "current" }, { resolvable: () => true }), sha);
  assert.strictEqual(patchBaseFor({ patchBaseSha: sha.toUpperCase() }, { kind: "current" }, { resolvable: () => true }), sha);
  assert.strictEqual(patchBaseFor({ patchBaseSha: sha }, { kind: "merged", baseTip: "tip" }, { resolvable: () => false }), "tip");
  assert.strictEqual(patchBaseFor({ patchBaseSha: "deploy/x" }, { kind: "current" }, { resolvable: () => true }), null, "a branch name is not a base");
  assert.strictEqual(patchBaseFor({}, { kind: "current" }), null, "old-style patch, branch unchanged: written as given");
});

test("dependenciesLanded: waits while any dependency is still in Backlog", () => {
  assert.strictEqual(dependenciesLanded(["a", "b"], { a: "ready-for-testing", b: "backlog" }), false);
  assert.strictEqual(dependenciesLanded(["a", "b"], { a: "ready-for-testing", b: "published-live" }), true);
  assert.strictEqual(dependenciesLanded(["a"], { a: null }), true, "a deleted dependency doesn't block forever");
  assert.strictEqual(dependenciesLanded([], {}), true);
});

test("buildRequestFields: the same project write a Ready for Dev click makes", () => {
  const f = buildRequestFields({ notifyRequestedByEmail: "rob@offline2online.com" }, ["x", "y"]);
  assert.ok(f.notifyRequestedAt instanceof Date, "a timestamp, so the trigger's toMillis() guard sees a new value");
  assert.deepStrictEqual(f.notifyItemIds, ["x", "y"]);
  assert.strictEqual(f.notifyRequestedByEmail, "rob@offline2online.com");
});

console.log(`\n${passed} passed, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);
