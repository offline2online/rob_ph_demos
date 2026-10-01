// Post-merge docs sync (docs-sync-lib.js): after a train merges, the project's
// REQUIREMENTS.md / README.md at the merge commit are written to the board,
// read back, and the outcome recorded on projects/{id}.docsSync — including a
// refusal, which used to be silent. Pure fakes, no git or network.
//
// Run with:  node test/docs-sync.test.js
"use strict";
const assert = require("assert");
const { syncProjectDocs, docCandidates, resolveRepoFolder } = require("../scripts/docs-sync-lib.js");

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

  await test("a project marked repoFolderNotApplicable skips silently", async () => {
    const f = fakes({});
    await syncProjectDocs({ repoFolderNotApplicable: true, deployBranch: "deploy/x" }, "ccc3333", f.io);
    assert.strictEqual(f.patches.length, 0);
  });

  console.log(`\n${passed} passed, ${failures.length} failed`);
  process.exit(failures.length ? 1 : 0);
})();
