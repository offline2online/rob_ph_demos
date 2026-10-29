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

const {
  syncTrainWithMain, rebasePatchFilesOnto, mergeCommandChains,
  unionMergeConflicts, unionInsertedLines, unionInsertedListNames, unionMergeNote, UNION_MARKER_SIZE,
} = require("../scripts/run-backlog-automation.js");

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

// ── package.json: the 20 Oct 2026 Deploy to Main block ──────────────────
// The train added a test to test:ui while a fix merged to main added one to
// test:app-boots, the line above. Adjacent lines are a conflict to git, so
// Deploy to Main stopped on backlog-tracker/test/package.json at every click.

const pkg = (scripts, extra = {}) => JSON.stringify({
  name: "t", private: true,
  description: "tests \u2014 escaped",
  scripts, ...extra,
}, null, 2).replace("\u2014", "\\u2014") + "\n";
const PKG_BASE_SCRIPTS = {
  test: "npm run test:app-boots && npm run test:ui",
  "test:app-boots": "node app-boots.test.mjs && node system-map.test.mjs",
  "test:ui": "node ui/console-click.test.mjs && node ui/apple-redesign.test.mjs",
};
function makePkgConflict(mainScripts, trainScripts, mainExtra, trainExtra) {
  const { root, work } = makeDisposableRepoPair();
  fs.mkdirSync(path.join(work, "test"));
  commitFile(work, "test/package.json", pkg(PKG_BASE_SCRIPTS), "add package.json");
  sh(work, "git", ["push", "origin", "main", "--quiet"]);
  cutTrain(work);
  sh(work, "git", ["checkout", BRANCH, "--quiet"]);
  commitFile(work, "test/package.json", pkg(trainScripts, trainExtra), "Ticket\n\nBacklog item: T1");
  sh(work, "git", ["push", "origin", BRANCH, "--quiet"]);
  sh(work, "git", ["checkout", "main", "--quiet"]);
  commitFile(work, "test/package.json", pkg(mainScripts, mainExtra), "fix merged straight to main");
  sh(work, "git", ["push", "origin", "main", "--quiet"]);
  return { root, work };
}

test("THE 20 OCT INCIDENT: two tests added on adjacent script lines are both kept, and the merge is pushed", () => {
  const { root, work } = makePkgConflict(
    { ...PKG_BASE_SCRIPTS, "test:app-boots": "node app-boots.test.mjs && node dictation.test.mjs && node system-map.test.mjs" },
    { ...PKG_BASE_SCRIPTS, "test:ui": "node ui/mobile-shell.test.mjs && node ui/console-click.test.mjs && node ui/apple-redesign.test.mjs" },
  );
  try {
    process.chdir(work);
    const sync = syncTrainWithMain(BRANCH);
    assert.strictEqual(sync.kind, "merged", JSON.stringify(sync));
    const text = originFile(work, BRANCH, "test/package.json");
    const merged = JSON.parse(text);
    assert.strictEqual(merged.scripts["test:app-boots"], "node app-boots.test.mjs && node dictation.test.mjs && node system-map.test.mjs");
    assert.strictEqual(merged.scripts["test:ui"], "node ui/mobile-shell.test.mjs && node ui/console-click.test.mjs && node ui/apple-redesign.test.mjs");
    assert.ok(text.includes("\\u2014"), "the file's \\u escapes are written back as escapes");
    assert.ok(text.endsWith("}\n"), "trailing newline kept");
    assert.ok(cleanTree(work));
  } finally { process.chdir(root); fs.rmSync(root, { recursive: true, force: true }); }
});

test("both sides adding to the SAME script keep both commands", () => {
  const { root, work } = makePkgConflict(
    { ...PKG_BASE_SCRIPTS, "test:ui": "node ui/console-click.test.mjs && node ui/apple-redesign.test.mjs && node ui/main-side.test.mjs" },
    { ...PKG_BASE_SCRIPTS, "test:ui": "node ui/console-click.test.mjs && node ui/apple-redesign.test.mjs && node ui/train-side.test.mjs" },
  );
  try {
    process.chdir(work);
    const sync = syncTrainWithMain(BRANCH);
    assert.strictEqual(sync.kind, "merged", JSON.stringify(sync));
    const merged = JSON.parse(originFile(work, BRANCH, "test/package.json"));
    assert.strictEqual(merged.scripts["test:ui"], "node ui/console-click.test.mjs && node ui/apple-redesign.test.mjs && node ui/main-side.test.mjs && node ui/train-side.test.mjs");
  } finally { process.chdir(root); fs.rmSync(root, { recursive: true, force: true }); }
});

test("a dependency both sides changed differently is NOT guessed: reported, nothing pushed, nothing left mid-merge", () => {
  const { root, work } = makePkgConflict(
    { ...PKG_BASE_SCRIPTS, "test:app-boots": "node app-boots.test.mjs && node a.test.mjs && node system-map.test.mjs" },
    { ...PKG_BASE_SCRIPTS, "test:ui": "node ui/b.test.mjs && node ui/console-click.test.mjs && node ui/apple-redesign.test.mjs" },
    { devDependencies: { jsdom: "^26.0.0" } },
    { devDependencies: { jsdom: "^25.1.0" } },
  );
  try {
    process.chdir(work);
    const before = originSha(work, BRANCH);
    const sync = syncTrainWithMain(BRANCH);
    assert.strictEqual(sync.kind, "conflict");
    assert.match(sync.detail, /devDependencies\.jsdom/);
    assert.strictEqual(originSha(work, BRANCH), before);
    assert.ok(cleanTree(work));
  } finally { process.chdir(root); fs.rmSync(root, { recursive: true, force: true }); }
});

test("mergeCommandChains: keeps each side's additions in place and honours a removal", () => {
  assert.strictEqual(mergeCommandChains("a && b && c", "a && x && b && c", "a && b && c && y"), "a && x && b && c && y");
  assert.strictEqual(mergeCommandChains("a && b && c", "a && b && c && x", "a && c"), "a && c && x", "their removal of b stands");
  assert.strictEqual(mergeCommandChains("a && b", "z && a && b", "y && a && b"), "y && z && a && b");
  assert.strictEqual(mergeCommandChains("a", "a && b", "a && b"), "a && b", "the same addition on both sides is kept once");
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

// ── Append-only conflicts: keep both additions (29 Oct 2026) ────────────
// Staff Kanban sent 8 tickets at once; each appended a case to the end of
// test/kanban-mcp.test.js, a name to mcp-client.test.mjs's pinned tool list
// and a row to the MCP.md tool table. git merge-file calls two insertions at
// the same point a conflict, so one ticket landed per round and the rest
// were rebuilt. On allowlisted paths a hunk both sides only added to now
// keeps both additions, the branch's first.

const REAL = (rel) => fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
const KANBAN_TEST = "backlog-tracker/test/kanban-mcp.test.js";
const CLIENT_TEST = "backlog-tracker/test/mcp-client.test.mjs";
// A case added the way a build adds one: before the summary at the end.
function withCaseAppended(text, name) {
  const at = text.lastIndexOf("\n  console.log(`\\n${passed} passed");
  assert.ok(at > 0, "kanban-mcp.test.js still ends with its summary line");
  const block = `  await test("${name}", async () => {\n    const r = await tool(sam, "kanban_my_work", {});\n    assert.ok(!r.isError, r.text);\n  });\n`;
  return `${text.slice(0, at + 1)}\n${block}${text.slice(at + 1)}`;
}
// A repo whose base commit holds `files`; returns its sha (every ticket's patchBaseSha).
function makeTicketRepo(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "train-union-test-"));
  const work = path.join(root, "work");
  fs.mkdirSync(work);
  sh(work, "git", ["init", "--quiet", "-b", "main"]);
  sh(work, "git", ["config", "user.name", "test"]);
  sh(work, "git", ["config", "user.email", "test@example.com"]);
  for (const [p, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(work, p)), { recursive: true });
    fs.writeFileSync(path.join(work, p), content);
  }
  sh(work, "git", ["add", "-A"]);
  sh(work, "git", ["commit", "-m", "base", "--quiet"]);
  return { root, work, base: sh(work, "git", ["rev-parse", "HEAD"]) };
}
// What processApplyPatch does once rebasePatchFilesOnto has answered: write
// the files and commit them onto the train.
function land(work, files, message) {
  for (const f of files) fs.writeFileSync(path.join(work, f.path), f.content);
  sh(work, "git", ["add", "-A"]);
  sh(work, "git", ["commit", "-m", message, "--quiet"]);
}
const parses = (file, text) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "train-union-parse-"));
  try {
    fs.writeFileSync(path.join(dir, path.basename(file)), text);
    execFileSync(process.execPath, ["--check", path.join(dir, path.basename(file))], { stdio: "pipe" });
    return true;
  } catch { return false; } finally { fs.rmSync(dir, { recursive: true, force: true }); }
};

test("THE 29 OCT INCIDENT: two tickets built in parallel each add a case at the end of kanban-mcp.test.js — both land, no conflict", () => {
  const original = REAL("test/kanban-mcp.test.js");
  const { root, work, base } = makeTicketRepo({ [KANBAN_TEST]: original });
  try {
    process.chdir(work);
    // Both sessions read `base`. A lands first, exactly as written.
    land(work, [{ path: KANBAN_TEST, content: withCaseAppended(original, "ticket A's case") }], "ticket A\n\nBacklog item: A");
    const out = rebasePatchFilesOnto([{ path: KANBAN_TEST, content: withCaseAppended(original, "ticket B's case") }], base);
    assert.deepStrictEqual(out.conflicts, [], "not a conflict, so no rebuild");
    assert.deepStrictEqual(out.rebased, [KANBAN_TEST]);
    assert.deepStrictEqual(out.unioned, [{ path: KANBAN_TEST, hunks: 1 }], "the card is told which file was union-merged");
    const merged = out.files[0].content;
    const a = merged.indexOf(`await test("ticket A's case"`), b = merged.indexOf(`await test("ticket B's case"`);
    assert.ok(a > 0 && b > a, "both cases kept, the branch's (A) first, then this patch's (B)");
    assert.ok(merged.startsWith(original.slice(0, original.lastIndexOf("\n  console.log("))), "nothing above the additions changed");
    assert.ok(merged.endsWith(original.slice(original.lastIndexOf("\n  console.log(") + 1)), "the summary lines still close the file");
    assert.ok(parses(KANBAN_TEST, merged), "the merged file parses");
  } finally { process.chdir(root); fs.rmSync(root, { recursive: true, force: true }); }
});

test("eight tickets from one base, each appending a case, all land in turn without a conflict", () => {
  const original = REAL("test/kanban-mcp.test.js");
  const { root, work, base } = makeTicketRepo({ [KANBAN_TEST]: original });
  try {
    process.chdir(work);
    for (let n = 1; n <= 8; n++) {
      const patch = [{ path: KANBAN_TEST, content: withCaseAppended(original, `ticket ${n}`) }];
      const out = n === 1 ? { files: patch, conflicts: [] } : rebasePatchFilesOnto(patch, base);
      assert.deepStrictEqual(out.conflicts, [], `ticket ${n}`);
      land(work, out.files, `ticket ${n}`);
    }
    const final = fs.readFileSync(path.join(work, KANBAN_TEST), "utf8");
    const at = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => final.indexOf(`await test("ticket ${n}"`));
    assert.ok(at.every((x, i) => x > 0 && (i === 0 || x > at[i - 1])), "every case kept, in landing order");
    assert.ok(parses(KANBAN_TEST, final));
  } finally { process.chdir(root); fs.rmSync(root, { recursive: true, force: true }); }
});

test("the same line modified on both sides is still a conflict, and the patch is left as given", () => {
  const original = REAL("test/kanban-mcp.test.js");
  // Both tickets add a tool, so both re-count the tools in this test's title.
  const line = original.match(/await test\("the [\w-]+ kanban_\* tools are registered/)[0];
  const { root, work, base } = makeTicketRepo({ [KANBAN_TEST]: original });
  try {
    process.chdir(work);
    land(work, [{ path: KANBAN_TEST, content: withCaseAppended(original.replace(line, line.replace(/the [\w-]+ /, "the A-count ")), "A") }], "A");
    const theirs = withCaseAppended(original.replace(line, line.replace(/the [\w-]+ /, "the B-count ")), "B");
    const out = rebasePatchFilesOnto([{ path: KANBAN_TEST, content: theirs }], base);
    assert.deepStrictEqual(out.conflicts, [KANBAN_TEST], "one changed line makes the whole file a conflict, even with an append beside it");
    assert.deepStrictEqual(out.unioned, []);
    assert.strictEqual(out.files[0].content, theirs);
  } finally { process.chdir(root); fs.rmSync(root, { recursive: true, force: true }); }
});

test("a union that breaks JS syntax is still a conflict (each side adds the same top-level const)", () => {
  const file = "backlog-tracker/test/helpers.test.js";
  const baseText = '"use strict";\nconst assert = require("assert");\n\nassert.ok(true);\n';
  const add = (v) => baseText.replace("\nassert.ok(true);", `const helper = ${v};\n\nassert.ok(true);`);
  assert.ok(parses(file, add(1)) && parses(file, add(2)), "each side parses on its own");
  const { root, work, base } = makeTicketRepo({ [file]: baseText });
  try {
    process.chdir(work);
    land(work, [{ path: file, content: add(1) }], "A");
    const out = rebasePatchFilesOnto([{ path: file, content: add(2) }], base);
    assert.deepStrictEqual(out.conflicts, [file]);
    assert.deepStrictEqual(out.unioned, []);
    assert.strictEqual(out.files[0].content, add(2));
  } finally { process.chdir(root); fs.rmSync(root, { recursive: true, force: true }); }
});

test("a path off the allowlist (functions/kanban.js) is still a conflict however append-only it is", () => {
  const file = "backlog-tracker/functions/kanban.js";
  const baseText = "const TOOLS = [];\nTOOLS.push(1);\n";
  const { root, work, base } = makeTicketRepo({ [file]: baseText });
  try {
    process.chdir(work);
    land(work, [{ path: file, content: `${baseText}TOOLS.push(2);\n` }], "A");
    const out = rebasePatchFilesOnto([{ path: file, content: `${baseText}TOOLS.push(3);\n` }], base);
    assert.deepStrictEqual(out.conflicts, [file]);
    assert.deepStrictEqual(out.unioned, []);
  } finally { process.chdir(root); fs.rmSync(root, { recursive: true, force: true }); }
});

test("Markdown: two rows added to the end of the same tool table are both kept", () => {
  const file = "backlog-tracker/MCP.md";
  const table = "| Read | Write |\n|---|---|\n| `kanban_get_task` | `kanban_comment` |\n";
  const baseText = `# MCP\n\n${table}\nMore text.\n`;
  const row = (r) => baseText.replace(table, `${table}| | ${r} |\n`);
  const { root, work, base } = makeTicketRepo({ [file]: baseText });
  try {
    process.chdir(work);
    land(work, [{ path: file, content: row("`kanban_a`") }], "A");
    const out = rebasePatchFilesOnto([{ path: file, content: row("`kanban_b`") }], base);
    assert.deepStrictEqual(out.conflicts, []);
    assert.deepStrictEqual(out.unioned, [{ path: file, hunks: 1 }]);
    assert.strictEqual(out.files[0].content, baseText.replace(table, `${table}| | \`kanban_a\` |\n| | \`kanban_b\` |\n`));
  } finally { process.chdir(root); fs.rmSync(root, { recursive: true, force: true }); }
});

test("the pinned tool list in mcp-client.test.mjs: two tickets each adding a name to the same line keep both names, sorted", () => {
  const original = REAL("test/mcp-client.test.mjs");
  const { root, work, base } = makeTicketRepo({ [CLIENT_TEST]: original });
  try {
    process.chdir(work);
    land(work, [{ path: CLIENT_TEST, content: original.replace('"kanban_list_people",\n', '"kanban_list_people", "kanban_list_releases",\n') }], "A");
    const theirs = original.replace('"kanban_assign_task", "kanban_attach_file"', '"kanban_archive_task", "kanban_assign_task", "kanban_attach_file"')
      .replace('"kanban_my_work", ', '"kanban_my_work", "kanban_notify_people", ');
    const out = rebasePatchFilesOnto([{ path: CLIENT_TEST, content: theirs }], base);
    assert.deepStrictEqual(out.conflicts, []);
    assert.strictEqual(out.unioned.length, 1);
    const merged = out.files[0].content;
    const list = merged.slice(merged.indexOf("assert.deepStrictEqual(names, ["), merged.indexOf("]);", merged.indexOf("assert.deepStrictEqual(names, [")));
    const names = list.match(/"[a-z_]+"/g).map((n) => JSON.parse(n));
    for (const n of ["kanban_archive_task", "kanban_list_releases", "kanban_notify_people"]) assert.ok(names.includes(n), n);
    assert.deepStrictEqual(names, names.slice().sort(), "still sorted, as the test compares it with a sorted list");
    assert.strictEqual(new Set(names).size, names.length, "no name twice");
    assert.ok(parses(CLIENT_TEST, merged));
    // Only the lines that gained a name changed.
    const changed = merged.split("\n").filter((l, i) => l !== original.split("\n")[i]);
    assert.strictEqual(changed.length, 2, changed.join("\n"));
  } finally { process.chdir(root); fs.rmSync(root, { recursive: true, force: true }); }
});

test("the pinned tool list: a name one side removed is still a conflict", () => {
  const original = REAL("test/mcp-client.test.mjs");
  const { root, work, base } = makeTicketRepo({ [CLIENT_TEST]: original });
  try {
    process.chdir(work);
    land(work, [{ path: CLIENT_TEST, content: original.replace('"kanban_list_people",\n', '"kanban_list_people", "kanban_list_releases",\n') }], "A");
    const out = rebasePatchFilesOnto([{ path: CLIENT_TEST, content: original.replace('"kanban_flag_task", ', "") }], base);
    assert.deepStrictEqual(out.conflicts, [CLIENT_TEST]);
  } finally { process.chdir(root); fs.rmSync(root, { recursive: true, force: true }); }
});

test("unionInsertedLines: insertions around kept base lines; identical additions once; a changed line refuses", () => {
  assert.deepStrictEqual(unionInsertedLines(["a"], [], ["b"]), ["a", "b"], "same point: ours, then theirs");
  assert.deepStrictEqual(unionInsertedLines(["x", "a", "y"], ["x", "y"], ["x", "y", "b"]), ["x", "a", "y", "b"]);
  assert.deepStrictEqual(unionInsertedLines(["", "a", "x"], ["x"], ["", "b", "x"]), ["", "a", "", "b", "x"]);
  assert.deepStrictEqual(unionInsertedLines(["s", "a"], ["s"], ["s", "a"]), ["s", "a"], "the same addition on both sides is kept once");
  assert.strictEqual(unionInsertedLines(["x2", "a"], ["x"], ["x", "b"]), null, "ours changed a base line");
  assert.strictEqual(unionInsertedLines(["a"], ["x"], ["x", "b"]), null, "ours removed a base line");
});

test("unionInsertedListNames: names, not lines; refuses anything that isn't a list of string literals", () => {
  assert.deepStrictEqual(
    unionInsertedListNames(['  "a", "c",'], ['  "a",'], ['  "a", "b",']),
    ['  "a", "b", "c",'], "sorted lists stay sorted");
  assert.deepStrictEqual(
    unionInsertedListNames(['  "z", "a",'], ['  "z",'], ['  "z", "m",']),
    ['  "z", "a", "m",'], "an unsorted list: the branch's first");
  assert.deepStrictEqual(
    unionInsertedListNames(['  "b", "c",', '  "d",'], ['  "b", "c",', '  "d",'].slice(0, 1), ['  "a", "b", "c",']),
    ['  "a", "b", "c",', '  "d",'], "a name leading the hunk goes on its first line; untouched lines kept as written");
  assert.strictEqual(unionInsertedListNames(['  "a", // x'], ['  "a",'], ['  "a", "b",']), null);
  assert.strictEqual(unionInsertedListNames(['  "b",'], ['  "a",'], ['  "a", "c",']), null, "a removed name");
});

test("unionMergeConflicts: only allowlisted paths, every hunk or none, and a setext '=======' is not a marker", () => {
  const M = UNION_MARKER_SIZE;
  const hunk = (o, b, t) => [`${"<".repeat(M)} current branch`, ...o, `${"|".repeat(M)} before sync`, ...b, "=".repeat(M), ...t, `${">".repeat(M)} this patch`];
  const doc = ["Title", "=======", "", ...hunk(["- a"], [], ["- b"]), "", "Next", "=======", ""].join("\n");
  assert.deepStrictEqual(unionMergeConflicts("docs/x.md", doc), { text: "Title\n=======\n\n- a\n- b\n\nNext\n=======\n", hunks: 1 });
  assert.strictEqual(unionMergeConflicts("backlog-tracker/functions/kanban.js", doc), null, "not allowlisted");
  assert.strictEqual(unionMergeConflicts("backlog-tracker/test/kanban.js", doc), null, "a test helper, not a *.test.js");
  assert.ok(unionMergeConflicts("backlog-tracker/test/ui/staff-kanban.test.mjs", doc), "test/ui/ is covered");
  const mixed = [...hunk(["- a"], [], ["- b"]), ...hunk(["x2"], ["x"], ["x3"])].join("\n");
  assert.strictEqual(unionMergeConflicts("docs/x.md", mixed), null, "one hunk that is more than an insertion leaves the whole file a conflict");
});

test("unionMergeNote: names each union-merged file for the card; nothing when there was none", () => {
  assert.strictEqual(unionMergeNote([]), "");
  const note = unionMergeNote([{ path: KANBAN_TEST, hunks: 1 }, { path: "backlog-tracker/MCP.md", hunks: 2 }]);
  assert.match(note, /Union-merged backlog-tracker\/test\/kanban-mcp\.test\.js \(1 place\), backlog-tracker\/MCP\.md \(2 places\)/);
  assert.match(note, /the branch's first, then this patch's/);
  // processApplyPatch puts it on the card's "Committed to …" note.
  const src = fs.readFileSync(path.join(__dirname, "..", "scripts", "run-backlog-automation.js"), "utf8");
  const body = src.slice(src.indexOf("async function processApplyPatch("));
  assert.match(body, /unionedPaths = rebase\.unioned;/);
  assert.match(body, /unionMergeNote\(unionedPaths\)/);
});

console.log(`\n${passed} passed, ${failures.length} failed\n`);
if (failures.length) process.exit(1);
