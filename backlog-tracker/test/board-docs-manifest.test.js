// board-docs.json: the per-project manifest of which repo files are documents
// on the console (docs-sync-lib.js reconcileManifest). Checks every manifest
// in the checkout against the real files, then drives the reconcile with stub
// I/O. Added to test:train-lock; runs in firestore-rules-test.yml.
//
// Run with:  node test/board-docs-manifest.test.js
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { syncProjectDocs, reconcileManifest, validateManifest, mirrorSpec, mirrorText, isManifestPath, BOARD_DOC_CAP } = require("../scripts/docs-sync-lib.js");

const REPO = path.join(__dirname, "..", "..");
let passed = 0;
const failures = [];
async function test(name, fn) {
  try { await fn(); passed += 1; console.log(`  ok  ${name}`); }
  catch (err) { failures.push([name, err]); console.log(`FAIL  ${name}\n      ${err && err.stack ? err.stack : err}`); }
}

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === ".git") continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else out.push(path.relative(REPO, p).split(path.sep).join("/"));
  }
  return out;
}
const all = walk(REPO);
const manifestPaths = all.filter((p) => path.basename(p) === "board-docs.json");
const exists = (p) => fs.existsSync(path.join(REPO, p));

// ── fakes ───────────────────────────────────────────────────────────────
function board(files, docs = [], projects = {}) {
  const store = new Map(docs.map((d) => [d.id, { ...d }]));
  const kinds = {};
  const calls = { put: [], create: [], del: 0, patch: [] };
  let n = 0;
  const io = {
    readFile: (p) => (p in files ? files[p] : null),
    lastCommitFor: (p) => `c-${p}`,
    listFiles: () => Object.keys(files).filter((p) => p.endsWith("board-docs.json")),
    listProjectDocs: async () => [...store.values()].filter((d) => d.projectId === "p1").map((d) => ({ ...d, contentMd: undefined })),
    getProjectDoc: async (id) => (store.has(id) ? { ...store.get(id) } : null),
    createProjectDoc: async (f) => { const id = `new${++n}`; store.set(id, { id, ...f }); calls.create.push(id); return id; },
    putProjectDocContent: async (id, f) => { calls.put.push([id, f]); Object.assign(store.get(id), f); },
    getProjectDocContent: async (id) => store.get(id) || null,
    getDoc: async (k) => kinds[k] || null, putDoc: async (k, f) => { kinds[k] = f; },
    patchProject: async (f) => { calls.patch.push(f); Object.assign(projects, f); },
    deleteProjectDoc: async () => { calls.del += 1; },
    now: () => new Date("2026-10-19T08:00:00Z"),
  };
  return { io, store, calls, projects };
}
const P = { id: "p1" };
const man = (o) => ({ manifest: { projectId: "p1", startHere: "readme", mirrors: [], boardDocs: [], ...o }, path: "x/board-docs.json" });

(async () => {
  // ── the real manifests in this checkout ───────────────────────────────
  await test("every board-docs.json in the checkout is valid, one per project, no document listed twice", async () => {
    const seenProjects = new Map();
    const seenIds = new Map();
    for (const p of manifestPaths) {
      const m = JSON.parse(fs.readFileSync(path.join(REPO, p), "utf8"));
      const errs = validateManifest(m, exists);
      assert.deepStrictEqual(errs, [], `${p}: ${errs.join("; ")}`);
      assert.ok(!seenProjects.has(m.projectId), `${p} and ${seenProjects.get(m.projectId)} both declare ${m.projectId}`);
      seenProjects.set(m.projectId, p);
      for (const id of [...m.mirrors.map((e) => e.id), ...m.boardDocs.map((e) => e.id)].filter(Boolean)) {
        assert.ok(!seenIds.has(id), `document ${id} is in ${p} and ${seenIds.get(id)}`);
        seenIds.set(id, p);
      }
    }
  });

  await test("every mirror of every real manifest cuts from the real file under the cap", async () => {
    for (const p of manifestPaths) {
      const m = JSON.parse(fs.readFileSync(path.join(REPO, p), "utf8"));
      for (const e of m.mirrors) {
        const text = mirrorText(fs.readFileSync(path.join(REPO, e.path), "utf8"), mirrorSpec(m, e));
        assert.ok(text.length <= BOARD_DOC_CAP, `${p}: ${e.key} is ${text.length} chars, over ${BOARD_DOC_CAP}`);
      }
    }
  });

  await test("no second registry: a folder with a board-docs.json declares no `const MIRRORS = [` script", async () => {
    for (const p of manifestPaths) {
      const dir = path.posix.dirname(p);
      for (const f of all.filter((x) => x.startsWith(dir === "." ? "" : `${dir}/`) && /\.(m?js|cjs|ts)$/.test(x) && x !== path.posix.join("backlog-tracker/test", path.basename(__filename)))) {
        assert.ok(!new RegExp("const MIRRORS = " + "\\[").test(fs.readFileSync(path.join(REPO, f), "utf8")), `${f} still declares MIRRORS next to ${p}`);
      }
    }
  });

  await test("isManifestPath ignores node_modules", () => {
    assert.ok(isManifestPath("a/b/board-docs.json"));
    assert.ok(!isManifestPath("a/node_modules/x/board-docs.json"));
  });

  // ── validator ─────────────────────────────────────────────────────────
  await test("validator: required fields, key format and uniqueness, startHere, names, paths", () => {
    const ok = { projectId: "p", startHere: "a-b", mirrors: [{ key: "a-b", path: "f.md", name: "N" }], boardDocs: [] };
    assert.deepStrictEqual(validateManifest(ok, () => true), []);
    assert.ok(validateManifest({ ...ok, projectId: "" }).length);
    assert.ok(validateManifest({ ...ok, startHere: "nope" }).length);
    assert.ok(validateManifest({ ...ok, mirrors: [{ ...ok.mirrors[0], key: "A_b" }] }).length);
    assert.ok(validateManifest({ ...ok, mirrors: [ok.mirrors[0], ok.mirrors[0]] }).length);
    assert.ok(validateManifest({ ...ok, mirrors: [{ ...ok.mirrors[0], name: "" }] }).length);
    assert.ok(validateManifest({ ...ok, mirrors: [{ ...ok.mirrors[0], name: "x".repeat(121) }] }).length);
    assert.ok(validateManifest({ ...ok, mirrors: [{ ...ok.mirrors[0], path: "../x" }] }).length);
    assert.ok(validateManifest(ok, () => false).length, "missing file");
    assert.ok(validateManifest({ ...ok, boardDocs: [{ id: "d", status: "bogus" }] }).length);
    assert.ok(validateManifest({ ...ok, boardDocs: [{ id: "d", status: "current" }, { id: "d", status: "working" }] }).length, "id twice");
  });

  // ── reconcileManifest ─────────────────────────────────────────────────
  const entry = (o) => ({ key: "k1", path: "f.md", name: "File one", ...o });

  await test("adopts a document by id, rewrites what differs, and a second run writes nothing", async () => {
    const b = board({ "f.md": "# one\n" }, [{ id: "d1", projectId: "p1", name: "old", contentMd: "stale" }]);
    const f = man({ mirrors: [entry({ id: "d1" })] });
    const r = await reconcileManifest(P, "abc", f, b.io, new Date());
    assert.deepStrictEqual(r.errors, []);
    assert.strictEqual(b.calls.put.length, 1);
    const d = b.store.get("d1");
    assert.strictEqual(d.name, "File one");
    assert.strictEqual(d.mirrorKey, "k1");
    assert.strictEqual(d.manifestPath, "x/board-docs.json");
    assert.strictEqual(d.sourcePath, "f.md");
    assert.ok(d.contentMd.startsWith("> Mirror of `f.md` — the repo wins."));
    assert.ok(d.contentMd.endsWith("# one\n"));
    const r2 = await reconcileManifest(P, "abc", f, b.io, new Date());
    assert.deepStrictEqual(r2.errors, []);
    assert.strictEqual(b.calls.put.length, 1, "nothing differs, nothing written");
  });

  await test("matches by mirrorKey when no id; creates when unmatched", async () => {
    const b = board({ "f.md": "x\n", "g.md": "y\n" }, [{ id: "d1", projectId: "p1", name: "n", mirrorKey: "k1", contentMd: "" }]);
    const r = await reconcileManifest(P, "abc", man({ mirrors: [entry(), entry({ key: "k2", path: "g.md", name: "G" })] }), b.io, new Date());
    assert.deepStrictEqual(r.errors, []);
    assert.strictEqual(b.calls.create.length, 1);
    assert.ok(b.store.get("d1").contentMd.endsWith("x\n"));
    const made = b.store.get(b.calls.create[0]);
    assert.strictEqual(made.projectId, "p1");
    assert.strictEqual(made.mirrorKey, "k2");
  });

  await test("two slices of one file stay two documents, with part i of n", async () => {
    const b = board({ "f.md": "# A\na\n# B\nb\n" });
    const m = man({ mirrors: [entry({ slices: [{ end: "# B" }] }), entry({ key: "k2", name: "Part B", slices: [{ start: "# B" }] })] });
    const r = await reconcileManifest(P, "abc", m, b.io, new Date());
    assert.deepStrictEqual(r.errors, []);
    assert.strictEqual(b.calls.create.length, 2);
    const [x, y] = b.calls.create.map((i) => b.store.get(i).contentMd);
    assert.ok(x.includes("(part 1 of 2)") && x.endsWith("# A\na\n"));
    assert.ok(y.includes("(part 2 of 2)") && y.endsWith("# B\nb\n"));
    const again = await reconcileManifest(P, "abc", m, b.io, new Date());
    assert.deepStrictEqual(again.errors, []);
    assert.strictEqual(b.calls.create.length, 2, "found again by mirrorKey, not recreated");
  });

  await test("an over-cap mirror is refused and recorded while others still sync", async () => {
    const b = board({ "big.md": "x".repeat(BOARD_DOC_CAP + 1), "f.md": "ok\n" });
    const r = await reconcileManifest(P, "abc", man({ mirrors: [entry({ key: "big", path: "big.md", name: "Big" }), entry()] }), b.io, new Date());
    assert.strictEqual(r.errors.length, 1);
    assert.ok(/over the 20000/.test(r.errors[0]), r.errors[0]);
    assert.strictEqual(b.calls.create.length, 1, "only the good one");
  });

  await test("a missing slice marker is recorded", async () => {
    const b = board({ "f.md": "# A\n" });
    const r = await reconcileManifest(P, "abc", man({ mirrors: [entry({ slices: [{ start: "# Gone" }] })] }), b.io, new Date());
    assert.ok(/slice marker not found/.test(r.errors.join()));
    assert.strictEqual(b.calls.create.length, 0);
  });

  await test("another project's document id is refused and not touched", async () => {
    const b = board({ "f.md": "x\n" }, [{ id: "z1", projectId: "other", name: "theirs", contentMd: "theirs" }]);
    const r = await reconcileManifest(P, "abc", man({ mirrors: [entry({ id: "z1" })], boardDocs: [] }), b.io, new Date());
    assert.ok(/another project/.test(r.errors.join()), r.errors.join());
    assert.strictEqual(b.store.get("z1").contentMd, "theirs");
    assert.strictEqual(b.calls.put.length, 0);
  });

  await test("boardDocs status is written; a mirror's declared status too", async () => {
    const b = board({ "f.md": "x\n" }, [{ id: "d2", projectId: "p1", name: "old note", contentMd: "t" }]);
    const r = await reconcileManifest(P, "abc", man({ mirrors: [entry({ status: "current" })], boardDocs: [{ id: "d2", status: "superseded", note: "see k1" }] }), b.io, new Date());
    assert.deepStrictEqual(r.errors, []);
    const d = b.store.get("d2");
    assert.strictEqual(d.status, "superseded");
    assert.strictEqual(d.statusNote, "see k1");
    assert.strictEqual(d.manifestPath, "x/board-docs.json");
    assert.strictEqual(b.store.get(b.calls.create[0]).status, "current");
  });

  await test("unlisted names unclassified documents and unlisted mirrors, skipping kind generated", async () => {
    const b = board({ "f.md": "x\n" }, [
      { id: "a", projectId: "p1", name: "Stray note", contentMd: "" },
      { id: "m", projectId: "p1", name: "Old mirror", sourcePath: "old.md", contentMd: "" },
      { id: "g", projectId: "p1", name: "Generated", kind: "generated", contentMd: "" },
      { id: "listed", projectId: "p1", name: "Listed", contentMd: "" },
    ]);
    const r = await reconcileManifest(P, "abc", man({ mirrors: [entry()], boardDocs: [{ id: "listed", status: "current" }] }), b.io, new Date());
    assert.deepStrictEqual(r.unlisted.map((u) => u.id).sort(), ["a", "m"]);
  });

  await test("startHereDocId resolves for readme and for a mirror key; never deletes", async () => {
    const b = board({ "f.md": "x\n" });
    let r = await reconcileManifest(P, "abc", man({ mirrors: [entry()], startHere: "readme" }), b.io, new Date());
    assert.strictEqual(r.startHereDocId, "readme");
    r = await reconcileManifest(P, "abc", man({ mirrors: [entry()], startHere: "k1" }), b.io, new Date());
    assert.strictEqual(r.startHereDocId, b.calls.create[0]);
    assert.strictEqual(b.calls.del, 0);
  });

  await test("an invalid manifest writes nothing and is reported", async () => {
    const b = board({ "f.md": "x\n" });
    const r = await reconcileManifest(P, "abc", man({ startHere: "missing", mirrors: [entry()] }), b.io, new Date());
    assert.ok(r.errors.length);
    assert.strictEqual(b.calls.create.length + b.calls.put.length, 0);
  });

  // ── syncProjectDocs ───────────────────────────────────────────────────
  await test("a repoFolderNotApplicable project with a manifest gets docsSync and startHereDocId, with no Requirements/README write", async () => {
    const files = { "backlog-tracker/board-docs.json": JSON.stringify({ projectId: "p1", startHere: "readme", mirrors: [entry()], boardDocs: [] }), "f.md": "x\n" };
    const b = board(files, [{ id: "s", projectId: "p1", name: "Stray", contentMd: "" }]);
    let wrote = 0;
    b.io.putDoc = async () => { wrote += 1; };
    const r = await syncProjectDocs({ id: "p1", repoFolderNotApplicable: true }, "abc1234", b.io);
    assert.ok(r.ok, JSON.stringify(r));
    assert.strictEqual(wrote, 0);
    assert.strictEqual(b.projects.docsSync.manifestPath, "backlog-tracker/board-docs.json");
    assert.strictEqual(b.projects.docsSync.error, null);
    assert.deepStrictEqual(b.projects.docsSync.unlisted, [{ id: "s", name: "Stray" }]);
    assert.strictEqual(b.projects.startHereDocId, "readme");
  });

  await test("a project with a folder: syncMirroredDocs does not rewrite what the reconcile wrote", async () => {
    const files = { "pf/board-docs.json": JSON.stringify({ projectId: "p1", startHere: "readme", mirrors: [entry()], boardDocs: [] }), "f.md": "x\n", "pf/README.md": "# r" };
    const b = board(files);
    const r = await syncProjectDocs({ id: "p1", repoFolder: "pf" }, "abc1234", b.io);
    assert.ok(r.ok, JSON.stringify(r));
    assert.strictEqual(b.calls.put.length, 0, "created, so never put, and the mirror pass skipped it");
    assert.strictEqual(b.projects.docsSync.manifestPath, "pf/board-docs.json");
    assert.deepStrictEqual(b.projects.docsSync.mirroredDocs.map((m) => [m.docId, m.ok]), [["new1", true]], "listed once, from the reconcile, not again from the mirror pass");
  });

  await test("a refusal reaches docsSync.error so the Docs behind main chip shows it", async () => {
    const files = { "pf/board-docs.json": JSON.stringify({ projectId: "p1", startHere: "readme", mirrors: [entry({ path: "big.md" })], boardDocs: [] }), "big.md": "x".repeat(BOARD_DOC_CAP + 5) };
    const b = board(files);
    const r = await syncProjectDocs({ id: "p1", repoFolderNotApplicable: true }, "abc1234", b.io);
    assert.strictEqual(r.ok, false);
    assert.ok(/over the 20000/.test(b.projects.docsSync.error));
  });

  console.log(`\n${passed} passed, ${failures.length} failed`);
  process.exit(failures.length ? 1 : 0);
})();
