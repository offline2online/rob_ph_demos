// Tests for the faq/data/index.json merge-conflict auto-resolver
// (scripts/faq-index-lib.js + scripts/run-backlog-automation.js's
// tryAutoResolveFaqIndexConflict), added alongside the fix for the 17 Sep
// 2026 incident where a hourly FAQ export commit to main conflicted with a
// deployment train that had also touched a (different) article.
//
// Runs on plain node, no emulator, no network: it builds a real, disposable
// git repo under a temp directory, reproduces an actual `git merge` conflict
// confined to index.json, then calls the real resolver against it exactly
// as run-backlog-automation.js would.
//
//   node test/faq-index.test.js
"use strict";
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const { buildIndexFromArticleFiles, validateIndexAgainstArticleFiles, serializeIndex } = require("../scripts/faq-index-lib");
const { conflictedPaths, tryAutoResolveFaqIndexConflict } = require("../scripts/run-backlog-automation");

let passed = 0;
const failures = [];
async function test(name, fn) {
  try { await fn(); passed += 1; console.log(`  ok  ${name}`); }
  catch (err) { failures.push([name, err]); console.log(`FAIL  ${name}\n      ${err && err.stack}`); }
}

function sh(cmd, args) {
  return execFileSync(cmd, args, { encoding: "utf8" }).trim();
}

function writeArticle(dir, meta, bodyMd) {
  fs.writeFileSync(path.join(dir, `${meta.id}.json`), JSON.stringify({ ...meta, bodyMd }) + "\n");
}

const CATS = [{ id: "cat1", name: "Cat 1", icon: "help", description: "", order: 0, parentId: null }];

// Builds a fresh disposable repo with two articles, then diverges it into
// `main` (editing article A, regenerating index.json) and `train` (editing
// article B, regenerating index.json) so merging main into train conflicts
// on index.json alone — the exact shape of the production incident.
function makeConflictedRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "faq-index-test-"));
  const run = (cmd, args) => execFileSync(cmd, args, { cwd: dir, encoding: "utf8" }).trim();
  run("git", ["init", "-q"]);
  run("git", ["checkout", "-q", "-b", "main"]); // don't rely on the environment's init.defaultBranch
  run("git", ["config", "user.email", "test@test.com"]);
  run("git", ["config", "user.name", "test"]);

  const articlesDir = path.join(dir, "faq/data/articles");
  fs.mkdirSync(articlesDir, { recursive: true });
  const a = { id: "art-a", categoryId: "cat1", order: 0, title: "Article A v1", slug: "a", summary: "", keywords: [], docType: "faq", status: "published", sectionPicker: false, sectionPickerLabel: "", updatedAt: "2026-01-01T00:00:00Z", contentHash: "aaa1" };
  const b = { id: "art-b", categoryId: "cat1", order: 1, title: "Article B v1", slug: "b", summary: "", keywords: [], docType: "faq", status: "published", sectionPicker: false, sectionPickerLabel: "", updatedAt: "2026-01-01T00:00:00Z", contentHash: "bbb1" };
  writeArticle(articlesDir, a, "<p>A v1</p>");
  writeArticle(articlesDir, b, "<p>B v1</p>");
  fs.writeFileSync(path.join(dir, "faq/data/index.json"), serializeIndex(buildIndexFromArticleFiles(articlesDir, CATS, "2026-01-01T00:00:00Z")));
  run("git", ["add", "-A"]);
  run("git", ["commit", "-q", "-m", "base"]);
  run("git", ["branch", "train"]);

  // main: export edits article A only, regenerates index.json.
  const a2 = { ...a, title: "Article A v2 (edited on main)", contentHash: "aaa2", updatedAt: "2026-01-02T00:00:00Z" };
  writeArticle(articlesDir, a2, "<p>A v2</p>");
  fs.writeFileSync(path.join(dir, "faq/data/index.json"), serializeIndex(buildIndexFromArticleFiles(articlesDir, CATS, "2026-01-02T00:00:00Z")));
  run("git", ["add", "-A"]);
  run("git", ["commit", "-q", "-m", "main: export edits article A"]);

  // train: a ticket edits article B only, regenerates index.json.
  run("git", ["checkout", "-q", "train"]);
  const b2 = { ...b, title: "Article B v2 (edited on train)", contentHash: "bbb2", updatedAt: "2026-01-01T12:00:00Z" };
  writeArticle(articlesDir, b2, "<p>B v2</p>");
  fs.writeFileSync(path.join(dir, "faq/data/index.json"), serializeIndex(buildIndexFromArticleFiles(articlesDir, CATS, "2026-01-01T12:00:00Z")));
  run("git", ["add", "-A"]);
  run("git", ["commit", "-q", "-m", "train: ticket edits article B"]);

  return { dir, run };
}

(async () => {
  await test("buildIndexFromArticleFiles sorts by category order, then article order, then id", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "faq-index-sort-"));
    const articlesDir = path.join(dir, "articles");
    fs.mkdirSync(articlesDir);
    writeArticle(articlesDir, { id: "z", categoryId: "cat1", order: 5 }, "");
    writeArticle(articlesDir, { id: "a", categoryId: "cat1", order: 1 }, "");
    const index = buildIndexFromArticleFiles(articlesDir, CATS, "now");
    assert.deepStrictEqual(index.articles.map((a) => a.id), ["a", "z"]);
  });

  await test("validateIndexAgainstArticleFiles throws when an index entry has no backing file", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "faq-index-validate-"));
    const articlesDir = path.join(dir, "articles");
    fs.mkdirSync(articlesDir);
    writeArticle(articlesDir, { id: "a", categoryId: "cat1", order: 0 }, "");
    assert.throws(() => validateIndexAgainstArticleFiles({ articles: [{ id: "a" }, { id: "ghost" }] }, articlesDir), /ghost/);
  });

  await test("validateIndexAgainstArticleFiles throws when a file is missing from the index", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "faq-index-validate2-"));
    const articlesDir = path.join(dir, "articles");
    fs.mkdirSync(articlesDir);
    writeArticle(articlesDir, { id: "a", categoryId: "cat1", order: 0 }, "");
    writeArticle(articlesDir, { id: "orphan", categoryId: "cat1", order: 1 }, "");
    assert.throws(() => validateIndexAgainstArticleFiles({ articles: [{ id: "a" }] }, articlesDir), /orphan/);
  });

  await test("serializeIndex round-trips through JSON.parse and puts one entry per line", () => {
    const idx = { generatedAt: "now", categories: CATS, articles: [{ id: "a" }, { id: "b" }] };
    const text = serializeIndex(idx);
    assert.deepStrictEqual(JSON.parse(text), idx);
    const lines = text.split("\n").filter((l) => l.trim().startsWith('{"id"'));
    assert.strictEqual(lines.length, 3, "1 category line + 2 article lines, each its own line");
  });

  await test("git merge of two different-article edits conflicts on index.json alone (reproduces the incident)", () => {
    const { dir, run } = makeConflictedRepo();
    let threw = false;
    try {
      run("git", ["merge", "main", "--no-edit", "-q"]);
    } catch {
      threw = true;
    }
    assert.ok(threw, "expected the merge to conflict");
    const status = run("git", ["status", "--short"]);
    assert.ok(status.includes("UU faq/data/index.json"), `expected index.json to conflict, got:\n${status}`);
    assert.ok(!status.includes("UU faq/data/articles/"), `expected article files to merge cleanly, got:\n${status}`);
    run("git", ["merge", "--abort"]);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  await test("tryAutoResolveFaqIndexConflict rebuilds index.json with both sides' article edits and lets the merge complete", () => {
    const { dir, run } = makeConflictedRepo();
    try { run("git", ["merge", "main", "--no-edit", "-q"]); } catch { /* expected */ }
    const prevCwd = process.cwd();
    process.chdir(dir);
    try {
      const conflicted = conflictedPaths();
      assert.deepStrictEqual(conflicted, ["faq/data/index.json"]);
      const resolution = tryAutoResolveFaqIndexConflict(conflicted);
      assert.strictEqual(resolution.resolved, true, resolution.detail);
      assert.match(resolution.detail, /rebuilt it from faq\/data\/articles/);
      // No unresolved paths should remain, so the merge can be committed.
      assert.deepStrictEqual(conflictedPaths(), []);
      execFileSync("git", ["commit", "-q", "-m", "merge", "--no-edit"], { cwd: dir });
      const merged = JSON.parse(fs.readFileSync(path.join(dir, "faq/data/index.json"), "utf8"));
      const byId = Object.fromEntries(merged.articles.map((a) => [a.id, a]));
      assert.strictEqual(byId["art-a"].title, "Article A v2 (edited on main)", "main's edit to article A must survive");
      assert.strictEqual(byId["art-b"].title, "Article B v2 (edited on train)", "train's edit to article B must survive");
      // generatedAt is kept as the LATER of the two sides, per the ticket.
      assert.strictEqual(merged.generatedAt, "2026-01-02T00:00:00Z");
      validateIndexAgainstArticleFiles(merged, path.join(dir, "faq/data/articles"));
    } finally {
      process.chdir(prevCwd);
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  await test("tryAutoResolveFaqIndexConflict declines when something other than index.json also conflicts", () => {
    assert.deepStrictEqual(
      tryAutoResolveFaqIndexConflict(["faq/data/index.json", "backlog-tracker/public/js/app.js"]),
      { resolved: false, detail: "conflicted on faq/data/index.json, backlog-tracker/public/js/app.js" }
    );
  });

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) process.exit(1);
})();
