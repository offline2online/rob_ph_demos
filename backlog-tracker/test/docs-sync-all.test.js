// The main-moved sweep (docs-sync-lib.js syncAllProjectDocs), the git helper
// it shares with the post-merge sync, and the DSP script's hands-off rule.
// Fakes for Firestore; a disposable git repo for the git helper.
//
// Run with:  node test/docs-sync-all.test.js
"use strict";
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const { syncAllProjectDocs, MAX_SYNC_ATTEMPTS } = require("../scripts/docs-sync-lib.js");
const { gitDocsIo } = require("../scripts/run-backlog-automation.js");

let passed = 0;
const failures = [];
async function test(name, fn) {
  try { await fn(); passed += 1; console.log(`  ok  ${name}`); }
  catch (err) { failures.push([name, err]); console.log(`FAIL  ${name}\n      ${err && err.stack ? err.stack : err}`); }
}

// A fake board: projects by id, their docs, their projectDocs, and the state doc.
function board(projects, files, { state = null, failMirror = false } = {}) {
  const b = { state, reads: [], writes: [], projects: JSON.parse(JSON.stringify(projects)), docs: {}, mirrors: {} };
  const byId = (id) => b.projects.find((p) => p.id === id);
  b.io = {
    getState: async () => b.state,
    putState: async (f) => { b.state = { ...(b.state || {}), ...f }; },
    listProjects: async () => { b.reads.push("listProjects"); return b.projects.map((p) => ({ ...p })); },
    now: () => new Date("2026-10-19T09:00:00Z"),
    forProject: (project) => ({
      readFile: (p) => (p in files ? files[p] : null),
      lastCommitFor: (p) => `last-${p.split("/").pop()}`,
      getProject: async () => ({ ...byId(project.id) }),
      patchProject: async (f) => { b.writes.push([project.id, Object.keys(f)]); Object.assign(byId(project.id), f); },
      putDoc: async (kind, f) => { b.docs[`${project.id}/${kind}`] = { ...f }; },
      getDoc: async (kind) => b.docs[`${project.id}/${kind}`] || null,
      listProjectDocs: async () => (b.mirrors[project.id] || []).map(({ id, name, sourcePath }) => ({ id, name, sourcePath })),
      putProjectDocContent: async (id, f) => {
        if (failMirror) throw new Error("PERMISSION_DENIED");
        Object.assign(b.mirrors[project.id].find((m) => m.id === id), f);
      },
      getProjectDocContent: async (id) => b.mirrors[project.id].find((m) => m.id === id),
      now: () => new Date("2026-10-19T09:00:00Z"),
    }),
  };
  return b;
}

const FILES = { "alpha/README.md": "# alpha", "alpha/REQUIREMENTS.md": "# alpha req", "shared/bt.md": "bt" };
const PROJECTS = [
  { id: "alpha", name: "Alpha", repoFolder: "alpha" },
  { id: "bt", name: "Backlog Tracker", repoFolderNotApplicable: true },
  { id: "old", name: "Old", repoFolder: "alpha", archived: true },
  { id: "empty", name: "Products and Pricing Prototype" },
];

function withMirror(b) {
  b.docs["bt/readme"] = { contentMd: "stale", sourcePath: "shared/bt.md" };
  b.mirrors.bt = [{ id: "m1", name: "BT note", sourcePath: "shared/bt.md", contentMd: "old" }];
}

(async () => {
  await test("head unchanged: no project is read or written", async () => {
    const b = board(PROJECTS, FILES, { state: { lastSyncedMain: "h1", attemptedMain: "h1", attempts: 1 } });
    const r = await syncAllProjectDocs({ head: "h1", io: b.io });
    assert.ok(r.skipped);
    assert.deepStrictEqual(b.reads, []);
    assert.deepStrictEqual(b.writes, []);
    assert.strictEqual(b.state.attempts, 1, "state untouched");
  });

  await test("head moved: folder and repoFolderNotApplicable projects get docsSync at head; archived and empty ones are untouched", async () => {
    const b = board(PROJECTS, FILES, { state: { lastSyncedMain: "h0" } });
    withMirror(b);
    const r = await syncAllProjectDocs({ head: "h1", io: b.io });
    assert.ok(r.ok, JSON.stringify(r));
    const byId = (id) => b.projects.find((p) => p.id === id);
    assert.strictEqual(byId("alpha").docsSync.mergeCommit, "h1");
    assert.strictEqual(byId("alpha").docsSync.error, null);
    assert.strictEqual(byId("alpha").lastMergeCommit, "h1");
    assert.strictEqual(byId("bt").docsSync.mergeCommit, "h1");
    assert.strictEqual(b.docs["bt/readme"].contentMd, "bt");
    assert.strictEqual(b.mirrors.bt[0].contentMd, "bt");
    assert.deepStrictEqual(b.writes.map((w) => w[0]).filter((id, i, a) => a.indexOf(id) === i).sort(), ["alpha", "bt"]);
    assert.ok(!("docsSync" in byId("old")) && !("docsSync" in byId("empty")));
    assert.strictEqual(b.state.lastSyncedMain, "h1");
    assert.strictEqual(b.state.attemptedMain, "h1");
    assert.deepStrictEqual(b.state.failedProjects, []);
    assert.ok(b.state.checkedAt);
  });

  await test("a failing mirror leaves lastSyncedMain unchanged and retries the same head; after 5 attempts nothing runs; a new head resets", async () => {
    const b = board(PROJECTS, FILES, { state: { lastSyncedMain: "h0" }, failMirror: true });
    withMirror(b);
    for (let i = 1; i <= MAX_SYNC_ATTEMPTS; i++) {
      const r = await syncAllProjectDocs({ head: "h1", io: b.io });
      assert.strictEqual(r.ok, false);
      assert.strictEqual(b.state.lastSyncedMain, "h0", "does not advance");
      assert.strictEqual(b.state.attempts, i);
      assert.deepStrictEqual(b.state.failedProjects, ["bt"]);
    }
    const bt = b.projects.find((p) => p.id === "bt");
    assert.match(bt.docsSync.error, /PERMISSION_DENIED/);
    assert.strictEqual(bt.docsSync.mirroredDocs[0].ok, false);
    b.reads.length = 0; b.writes.length = 0;
    const gaveUp = await syncAllProjectDocs({ head: "h1", io: b.io });
    assert.ok(gaveUp.skipped);
    assert.deepStrictEqual(b.reads, []);
    assert.deepStrictEqual(b.writes, []);
    const fresh = await syncAllProjectDocs({ head: "h2", io: b.io });
    assert.strictEqual(fresh.attempts, 1, "a new head resets the count");
    assert.ok(b.reads.includes("listProjects"));
  });

  await test("a retry does not redo a project already complete at that head", async () => {
    const b = board(PROJECTS, FILES, { state: { lastSyncedMain: "h0" }, failMirror: true });
    withMirror(b);
    await syncAllProjectDocs({ head: "h1", io: b.io });
    b.writes.length = 0;
    await syncAllProjectDocs({ head: "h1", io: b.io });
    assert.ok(b.writes.every((w) => w[0] === "bt"), JSON.stringify(b.writes));
  });

  await test("gitDocsIo.lastCommitFor returns the file's own last commit, not head", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "docs-sync-git-"));
    const git = (...a) => execFileSync("git", a, { cwd: dir, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } }).trim();
    try {
      git("init", "-q");
      fs.writeFileSync(path.join(dir, "a.md"), "A");
      git("add", "."); git("commit", "-q", "-m", "a");
      const first = git("rev-parse", "HEAD");
      fs.writeFileSync(path.join(dir, "b.md"), "B");
      git("add", "."); git("commit", "-q", "-m", "b");
      const head = git("rev-parse", "HEAD");
      assert.notStrictEqual(first, head);
      const io = gitDocsIo(head, dir);
      assert.strictEqual(io.lastCommitFor("a.md"), first);
      assert.strictEqual(io.lastCommitFor("b.md"), head);
      assert.strictEqual(io.lastCommitFor("missing.md"), null);
      assert.strictEqual(io.readFile("a.md"), "A");
      assert.strictEqual(io.readFile("missing.md"), null);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  await test("sync-board-docs.mjs no longer writes docsSync, lastMergeCommit or lastMergeAt", async () => {
    const src = fs.readFileSync(path.join(__dirname, "..", "..", "dsp-integration", "scripts", "sync-board-docs.mjs"), "utf8");
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    for (const field of ["docsSync", "lastMergeCommit", "lastMergeAt", "recordSync"]) assert.ok(!code.includes(field), `still mentions ${field}`);
  });

  console.log(`\n${passed} passed, ${failures.length} failed`);
  process.exit(failures.length ? 1 : 0);
})();
