// Post-merge docs sync (docs-sync-lib.js): after a train merges, the project's
// REQUIREMENTS.md / README.md at the merge commit are written to the board,
// read back, and the outcome recorded on projects/{id}.docsSync — including a
// refusal, which used to be silent. Pure fakes, no git or network.
//
// Run with:  node test/docs-sync.test.js
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { syncProjectDocs, docCandidates, resolveRepoFolder, MIRROR_CAP, CORE_DOC_CAP } = require("../scripts/docs-sync-lib.js");

let passed = 0;
const failures = [];
async function test(name, fn) {
  try { await fn(); passed += 1; console.log(`  ok  ${name}`); }
  catch (err) { failures.push([name, err]); console.log(`FAIL  ${name}\n      ${err && err.stack ? err.stack : err}`); }
}

// A fake board: one project doc, patch applies the fields (or throws).
function fakes(files, { refuse, drop } = {}) {
  const doc = {};
  const patches = [];
  const docs = {};
  return {
    doc, patches, docs,
    io: {
      putDoc: async (kind, fields) => {
        if (refuse && kind === "requirements") throw new Error(refuse);
        docs[kind] = (drop && kind === drop) ? { ...fields, contentMd: "tampered" } : { ...fields };
      },
      getDoc: async (kind) => docs[kind] || null,
      readFile: (p) => (p in files ? files[p] : null),
      lastCommitFor: (p) => `last-${p.split("/").pop()}`,
      getProject: async () => ({ ...doc }),
      patchProject: async (fields) => {
        patches.push(fields);
        for (const [k, v] of Object.entries(fields)) doc[k] = v;
      },
      now: () => new Date("2026-10-01T08:00:00Z"),
    },
  };
}

(async () => {
  await test("a project with no folder is skipped and nothing is written", async () => {
    const f = fakes({});
    assert.deepStrictEqual(await syncProjectDocs({ repoFolderNotApplicable: true, repoFolder: "x" }, "abc1234", f.io), { skipped: "no repo folder" });
    assert.strictEqual(f.patches.length, 0, "marked not-applicable: silent");
    assert.deepStrictEqual(await syncProjectDocs({}, "abc1234", f.io), { skipped: "no repo folder" });
    assert.strictEqual(f.patches.length, 1, "an unset folder is recorded, not just logged");
  });

  await test("DSP layout: requirements under docs/<folder>/, README at the folder root", async () => {
    assert.ok(docCandidates("dsp-integration", "REQUIREMENTS.md").includes("dsp-integration/docs/dsp-integration/REQUIREMENTS.md"));
    const f = fakes({ "dsp-integration/docs/dsp-integration/REQUIREMENTS.md": "R".repeat(220878), "dsp-integration/README.md": "# readme" });
    const r = await syncProjectDocs({ repoFolder: "dsp-integration/" }, "deadbeefcafe", f.io);
    assert.ok(r.ok, JSON.stringify(r));
    assert.strictEqual(f.docs.requirements.contentMd.length, 220878, "no client-side size guess — the 220k spec is sent");
    assert.strictEqual(f.docs.readme.contentMd, "# readme");
    assert.strictEqual(f.docs.requirements.sourceCommit, "last-REQUIREMENTS.md");
    assert.strictEqual(f.docs.requirements.sourcePath, "dsp-integration/docs/dsp-integration/REQUIREMENTS.md");
    assert.match(f.docs.readme.sha256, /^[0-9a-f]{64}$/);
    assert.strictEqual(f.doc.docs.requirements.chars, 220878, "the project doc keeps a pointer");
    assert.ok(!("requirementsMd" in f.doc) && !("readmeMd" in f.doc), "the text never goes on the project doc");
    assert.strictEqual(f.doc.docsSync.error, null);
    assert.strictEqual(f.doc.docsSync.mergeCommit, "deadbeefcafe");
    assert.strictEqual(f.doc.docsSync.requirementsCommit, "last-REQUIREMENTS.md");
    assert.strictEqual(f.doc.lastMergeCommit, "deadbeefcafe", "stamped in the same write as docsSync");
  });

  await test("a refused write is recorded as docsSync.error, never thrown or silent", async () => {
    const f = fakes({ "p/REQUIREMENTS.md": "x", "p/README.md": "y" }, { refuse: "PATCH failed: 400 over the limit" });
    const r = await syncProjectDocs({ repoFolder: "p", docsSync: { requirementsCommit: "old1" } }, "feed123", f.io);
    assert.strictEqual(r.ok, false);
    assert.match(f.doc.docsSync.error, /over the limit/);
    assert.strictEqual(f.doc.docsSync.requirementsCommit, "old1", "keeps the last good commit alongside the error");
    assert.strictEqual(f.doc.lastMergeCommit, "feed123");
  });

  await test("a write that does not read back byte for byte is an error", async () => {
    const f = fakes({ "p/README.md": "hello" }, { drop: "readme" });
    const r = await syncProjectDocs({ repoFolder: "p" }, "abc9999", f.io);
    assert.strictEqual(r.ok, false);
    assert.match(r.error, /does not match/);
  });

  await test("only the file that exists is written; the other keeps its previous commit", async () => {
    const f = fakes({ "p/README.md": "only readme" });
    const r = await syncProjectDocs({ repoFolder: "p", docsSync: { requirementsCommit: "keep1" } }, "abc0001", f.io);
    assert.ok(r.ok);
    assert.ok(!("requirements" in f.docs));
    assert.ok(!("requirements" in f.doc.docs), "no pointer for a doc that was not synced");
    assert.strictEqual(f.doc.docsSync.requirementsCommit, "keep1");
  });

  await test("folder falls back to the deploy-branch slug, and agrees with repoFolder when set", async () => {
    assert.strictEqual(resolveRepoFolder({ deployBranch: "deploy/dsp-integration" }), "dsp-integration");
    assert.strictEqual(resolveRepoFolder({ repoFolder: "/a/", deployBranch: "deploy/b" }), "a");
    assert.strictEqual(resolveRepoFolder({}), null);
    const f = fakes({ "dsp-integration/README.md": "# r" });
    const r = await syncProjectDocs({ deployBranch: "deploy/dsp-integration" }, "c0ffee1", f.io);
    assert.ok(r.ok, JSON.stringify(r));
    assert.strictEqual(f.docs.readme.contentMd, "# r");
  });

  await test("a skip is recorded on the project and cleared by the next successful sync", async () => {
    const f = fakes({});
    const r = await syncProjectDocs({ repoFolder: "" }, "aaa1111", f.io);
    assert.deepStrictEqual(r, { skipped: "no repo folder" });
    assert.deepStrictEqual(f.doc.docsSync, { skipped: "no repo folder", at: new Date("2026-10-01T08:00:00Z"), mergeCommit: "aaa1111" });
    const g = fakes({ "p/README.md": "ok" });
    g.doc.docsSync = f.doc.docsSync;
    const ok = await syncProjectDocs({ repoFolder: "p", docsSync: f.doc.docsSync }, "bbb2222", g.io);
    assert.ok(ok.ok);
    assert.ok(!("skipped" in g.doc.docsSync), "success replaces docsSync wholesale");
    assert.strictEqual(g.doc.docsSync.error, null);
  });

  await test("repoFolderNotApplicable: nothing to sync writes nothing; a README sourcePath plus a mirror both sync", async () => {
    const none = fakes({});
    await syncProjectDocs({ repoFolderNotApplicable: true, deployBranch: "deploy/x" }, "ccc3333", none.io);
    assert.strictEqual(none.patches.length, 0, "nothing to sync: silent");

    const f = fakes({ "backlog-tracker/README.md": "# bt", "faq/notes.md": "notes" });
    f.docs.readme = { contentMd: "old", sourcePath: "backlog-tracker/README.md" };
    const store = { m: { name: "Notes", sourcePath: "faq/notes.md", contentMd: "old" } };
    f.io.listProjectDocs = async () => Object.entries(store).map(([id, v]) => ({ id, name: v.name, sourcePath: v.sourcePath }));
    f.io.putProjectDocContent = async (id, fields) => { Object.assign(store[id], fields); };
    f.io.getProjectDocContent = async (id) => store[id];
    const r = await syncProjectDocs({ repoFolderNotApplicable: true }, "ccc4444", f.io);
    assert.ok(r.ok, JSON.stringify(r));
    assert.strictEqual(f.docs.readme.contentMd, "# bt");
    assert.strictEqual(store.m.contentMd, "notes");
    assert.strictEqual(store.m.updatedByEmail, "backlog-automation", "a mirror write names the automation, not the previous editor");
    assert.deepStrictEqual(f.doc.docsSync.mirroredDocs, [{ docId: "m", name: "Notes", sourcePath: "faq/notes.md", sourceCommit: "last-notes.md", ok: true, error: null }]);
    assert.strictEqual(f.doc.docsSync.readmeCommit, "last-README.md");
    assert.strictEqual(f.doc.lastMergeCommit, "ccc4444");
  });

  await test("repoFolderNotApplicable: a sourcePath that is missing at the commit or leaves the repo is an error", async () => {
    const f = fakes({});
    f.docs.readme = { sourcePath: "gone/README.md" };
    f.docs.requirements = { sourcePath: "../etc/passwd" };
    const r = await syncProjectDocs({ repoFolderNotApplicable: true }, "ddd0000", f.io);
    assert.strictEqual(r.ok, false);
    assert.match(f.doc.docsSync.error, /README\.md: gone\/README\.md not found/);
    assert.match(f.doc.docsSync.error, /must stay inside the repo/);
  });

  await test("a second sync with unchanged files writes no document and no pointer, but records the new mergeCommit", async () => {
    const f = fakes({ "p/README.md": "same", "p/REQUIREMENTS.md": "req" });
    const project = { repoFolder: "p" };
    assert.ok((await syncProjectDocs(project, "aaaa111", f.io)).ok);
    const pointerWrites = () => f.patches.filter((x) => "docs" in x).length;
    assert.strictEqual(pointerWrites(), 1);
    let puts = 0;
    const put = f.io.putDoc;
    f.io.putDoc = async (...a) => { puts += 1; return put(...a); };
    const again = await syncProjectDocs({ ...project, docs: f.doc.docs, docsSync: f.doc.docsSync }, "bbbb222", f.io);
    assert.ok(again.ok);
    assert.strictEqual(puts, 0, "no document write");
    assert.strictEqual(pointerWrites(), 1, "no pointer write");
    assert.strictEqual(f.doc.docsSync.mergeCommit, "bbbb222");
    assert.strictEqual(f.doc.lastMergeCommit, "bbbb222");
    assert.strictEqual(f.doc.docsSync.readmeCommit, "last-README.md", "each file's own last commit, not head");
  });

  await test("a stale sourceCommit alone is rewritten once", async () => {
    const f = fakes({ "p/README.md": "same" });
    f.docs.readme = { contentMd: "same", sourcePath: "p/README.md", sourceCommit: "old-commit" };
    let puts = 0;
    const put = f.io.putDoc;
    f.io.putDoc = async (...a) => { puts += 1; return put(...a); };
    assert.ok((await syncProjectDocs({ repoFolder: "p" }, "eee1111", f.io)).ok);
    assert.strictEqual(puts, 1);
    assert.strictEqual(f.docs.readme.sourceCommit, "last-README.md");
    assert.ok((await syncProjectDocs({ repoFolder: "p", docs: f.doc.docs }, "eee2222", f.io)).ok);
    assert.strictEqual(puts, 1, "in step now: not rewritten again");
  });

  await test("a Requirements/README over the board's cap is refused before writing, naming the document", async () => {
    const f = fakes({ "p/REQUIREMENTS.md": "R".repeat(CORE_DOC_CAP + 1), "p/README.md": "ok" });
    const r = await syncProjectDocs({ repoFolder: "p" }, "fff1111", f.io);
    assert.strictEqual(r.ok, false);
    assert.ok(!("requirements" in f.docs), "never written");
    assert.strictEqual(f.docs.readme.contentMd, "ok", "the rest still syncs");
    assert.match(f.doc.docsSync.error, /REQUIREMENTS\.md: 800001 chars, over the 800000.*split it with sourceSlices/);
  });

  await test("the cap constants match firestore.rules", async () => {
    const rules = fs.readFileSync(path.join(__dirname, "..", "firestore.rules"), "utf8");
    const sizes = [...rules.matchAll(/contentMd\.size\(\) <= (\d+)/g)].map((m) => Number(m[1]));
    assert.ok(sizes.includes(MIRROR_CAP), `rules have no ${MIRROR_CAP} cap: ${sizes}`);
    assert.ok(sizes.includes(CORE_DOC_CAP), `rules have no ${CORE_DOC_CAP} cap: ${sizes}`);
    assert.strictEqual(Math.max(...sizes), CORE_DOC_CAP);
  });

  await test("projectDocs with a sourcePath are mirrored and verified; an over-cap one is never written", async () => {
    const files = { "p/README.md": "# r", "p/api/A.md": "AAA", "p/api/B.md": "B".repeat(30000) };
    const f = fakes(files);
    const store = { a: { name: "A", sourcePath: "p/api/A.md", contentMd: "old" }, b: { name: "B", sourcePath: "p/api/B.md", contentMd: "old" }, c: { name: "C", contentMd: "keep" } };
    const writes = [];
    f.io.listProjectDocs = async () => Object.entries(store).map(([id, v]) => ({ id, name: v.name, sourcePath: v.sourcePath }));
    // A writer that accepts anything, like the service account does.
    f.io.putProjectDocContent = async (id, fields) => { writes.push(id); Object.assign(store[id], fields); };
    f.io.getProjectDocContent = async (id) => store[id];
    const r = await syncProjectDocs({ repoFolder: "p" }, "ddd4444", f.io);
    assert.strictEqual(store.a.contentMd, "AAA");
    assert.strictEqual(store.b.contentMd, "old");
    assert.deepStrictEqual(writes, ["a"], "the 30,000-char mirror is never written");
    assert.strictEqual(store.c.contentMd, "keep", "no sourcePath: untouched");
    assert.strictEqual(r.ok, false);
    const by = Object.fromEntries(f.doc.docsSync.mirroredDocs.map((m) => [m.docId, m]));
    assert.strictEqual(by.a.ok, true);
    assert.strictEqual(by.b.ok, false);
    assert.match(by.b.error, /30000 chars, over the 20000.*split it with sourceSlices/);
    assert.match(f.doc.docsSync.error, /"B" ← p\/api\/B\.md/);
    assert.strictEqual(f.docs.readme.contentMd, "# r", "readme still synced");
  });

  await test("a mirrored doc can be a heading-marked slice of its file, with a prefix", async () => {
    const file = "# T\nintro\n## A\na1\n## B\nb1\n## C\nc1\n## D\nd1\n";
    const files = { "p/README.md": "# r", "p/api/X.md": file };
    const f = fakes(files);
    const store = {
      one: { name: "X 1/2", sourcePath: "p/api/X.md", sourceSlices: [{ end: "## B" }], sourcePrefix: "> mirror\n\n", contentMd: "" },
      two: { name: "X 2/2", sourcePath: "p/api/X.md", sourceSlices: [{ start: "## B", end: "## C" }, { start: "## D" }], contentMd: "" },
      bad: { name: "X bad", sourcePath: "p/api/X.md", sourceSlices: [{ start: "## Gone" }], contentMd: "old" },
    };
    f.io.listProjectDocs = async () => Object.entries(store).map(([id, v]) => ({ id, ...v }));
    f.io.putProjectDocContent = async (id, fields) => { store[id].contentMd = fields.contentMd; };
    f.io.getProjectDocContent = async (id) => store[id];
    const r = await syncProjectDocs({ repoFolder: "p" }, "eee5555", f.io);
    assert.strictEqual(store.one.contentMd, "> mirror\n\n# T\nintro\n## A\na1\n");
    assert.strictEqual(store.two.contentMd, "## B\nb1\n\n## D\nd1\n");
    assert.strictEqual(store.bad.contentMd, "old", "missing marker: untouched");
    assert.strictEqual(r.ok, false);
    assert.match(f.doc.docsSync.error, /slice marker not found: "## Gone"/);
  });

  console.log(`\n${passed} passed, ${failures.length} failed`);
  process.exit(failures.length ? 1 : 0);
})();
