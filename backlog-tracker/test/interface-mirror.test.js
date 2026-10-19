// Interface mirror (interface-mirror-lib.js): an interface listed in
// shared/board-interfaces.json is rewritten from its repo file, with a
// revision of the replaced text, read back byte for byte. Fakes only.
//
// Run with:  node test/interface-mirror.test.js
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { syncMirroredInterfaces, MANIFEST_PATH, INTERFACE_CAP } = require("../scripts/interface-mirror-lib.js");

let passed = 0;
const failures = [];
async function test(name, fn) {
  try { await fn(); passed += 1; console.log(`  ok  ${name}`); }
  catch (err) { failures.push([name, err]); console.log(`FAIL  ${name}\n      ${err && err.stack ? err.stack : err}`); }
}

const NOW = new Date("2026-10-19T09:00:00Z");
const manifest = (entries) => JSON.stringify({ interfaces: entries });

// ifaces: { id: fields }; files: { path: text }; opts.mangle makes read-back differ.
function fakes(ifaces, files, { mangle } = {}) {
  const log = [];
  const store = JSON.parse(JSON.stringify(ifaces));
  return {
    log, store,
    io: {
      readFile: (p) => (p in files ? files[p] : null),
      lastCommitFor: (p) => `last-${p.split("/").pop()}`,
      listInterfaces: async () => Object.entries(store).map(([id, v]) => ({ id, ...v })),
      getInterface: async (id) => (store[id] ? { id, ...store[id] } : null),
      addRevision: async (f) => { log.push(["revision", f]); return `rev${log.length}`; },
      patchInterface: async (id, f) => {
        log.push(["patch", id, f]);
        Object.assign(store[id], f);
        if (mangle && "contentMd" in f) store[id].contentMd = "tampered";
      },
      patchProject: async () => { throw new Error("must not patch a project"); },
      patchProjectDoc: async () => { throw new Error("must not patch a project document"); },
      putProjectDocContent: async () => { throw new Error("must not patch a project document"); },
      now: () => NOW,
    },
  };
}

const base = { name: "Contract", projectIds: ["A", "B"], contentMd: "old", updatedByEmail: "docs-sync@automation", updatedAt: "2026-10-03T00:00:00Z" };
const M = (...entries) => ({ [MANIFEST_PATH]: manifest(entries) });

(async () => {
  await test("(a) differing text is rewritten, read back, with a revision written first", async () => {
    const f = fakes({ i1: { ...base } }, { ...M({ id: "i1", path: "shared/c.md" }), "shared/c.md": "new text" });
    const r = await syncMirroredInterfaces("abc1234", f.io);
    assert.deepStrictEqual(r, { synced: ["i1"], skipped: [], errors: [] });
    assert.strictEqual(f.store.i1.contentMd, "new text");
    assert.strictEqual(f.store.i1.sourcePath, "shared/c.md");
    assert.strictEqual(f.store.i1.sourceCommit, "last-c.md");
    assert.strictEqual(f.store.i1.syncError, null);
    assert.strictEqual(f.store.i1.updatedByEmail, "docs-sync@automation");
    assert.ok(f.store.i1.syncedAt);
    assert.strictEqual(f.log[0][0], "revision");
    assert.strictEqual(f.log[1][0], "patch");
    const rev = f.log[0][1];
    assert.deepStrictEqual([rev.target, rev.interfaceId, rev.contentMd, rev.chars, rev.replacedByEmail, rev.via, rev.name], ["interface", "i1", "old", 3, "docs-sync@automation", "docs-sync", "Contract"]);
    assert.deepStrictEqual(rev.projectIds, ["A", "B"]);
  });

  await test("(b) unchanged text writes nothing", async () => {
    const f = fakes({ i1: { ...base, contentMd: "same", sourcePath: "shared/c.md", sourceCommit: "last-c.md" } }, { ...M({ id: "i1", path: "shared/c.md" }), "shared/c.md": "same" });
    const r = await syncMirroredInterfaces("abc", f.io);
    assert.deepStrictEqual(r, { synced: [], skipped: ["i1"], errors: [] });
    assert.strictEqual(f.log.length, 0);
  });

  await test("(c) text over the cap is refused with its size", async () => {
    const big = "x".repeat(INTERFACE_CAP + 1);
    const f = fakes({ i1: { ...base } }, { ...M({ id: "i1", path: "shared/c.md" }), "shared/c.md": big });
    const r = await syncMirroredInterfaces("abc", f.io);
    assert.strictEqual(r.synced.length, 0);
    assert.match(f.store.i1.syncError, /20001/);
    assert.strictEqual(f.store.i1.contentMd, "old");
    assert.ok(!f.log.some((l) => l[0] === "revision"));
  });

  await test("(d) a missing file records the path and commit; text untouched", async () => {
    const f = fakes({ i1: { ...base } }, M({ id: "i1", path: "shared/gone.md" }));
    const r = await syncMirroredInterfaces("abcdef0123", f.io);
    assert.strictEqual(r.errors.length, 1);
    assert.match(f.store.i1.syncError, /shared\/gone\.md/);
    assert.match(f.store.i1.syncError, /abcdef0/);
    assert.strictEqual(f.store.i1.contentMd, "old");
  });

  await test("(e) duplicate id, '..' path and unknown id are refused; the others still sync", async () => {
    const f = fakes({ dup: { ...base }, ok: { ...base }, esc: { ...base } }, {
      ...M({ id: "dup", path: "a.md" }, { id: "dup", path: "b.md" }, { id: "esc", path: "../x.md" }, { id: "nope", path: "a.md" }, { id: "ok", path: "a.md" }),
      "a.md": "A", "b.md": "B", "../x.md": "X",
    });
    const r = await syncMirroredInterfaces("abc", f.io);
    assert.deepStrictEqual(r.synced, ["ok"]);
    assert.strictEqual(r.errors.length, 4); // the duplicate is refused at both entries
    assert.strictEqual(f.store.dup.contentMd, "old");
    assert.strictEqual(f.store.esc.contentMd, "old");
  });

  await test("(f) replacing a hand edit sets overwroteEdit", async () => {
    const f = fakes({ i1: { ...base, updatedByEmail: "rob@offline2online.com", updatedAt: "2026-10-03T10:00:00Z" } }, { ...M({ id: "i1", path: "c.md" }), "c.md": "from repo" });
    await syncMirroredInterfaces("abc", f.io);
    const oe = f.store.i1.overwroteEdit;
    assert.strictEqual(oe.byEmail, "rob@offline2online.com");
    assert.ok(oe.revisionId);
    assert.ok(oe.at);
  });

  await test("(f2) a Docs-page edit after a sync (updatedByEmail still ours) sets overwroteEdit", async () => {
    const f = fakes({ i1: { ...base, syncedAt: "2026-10-03T00:00:00Z", updatedAt: "2026-10-03T09:00:00Z" } }, { ...M({ id: "i1", path: "c.md" }), "c.md": "from repo" });
    await syncMirroredInterfaces("abc", f.io);
    assert.ok(f.store.i1.overwroteEdit && f.store.i1.overwroteEdit.revisionId, "later updatedAt is a hand edit");
    const g = fakes({ i1: { ...base, syncedAt: "2026-10-03T00:00:00Z", updatedAt: "2026-10-03T00:00:00Z" } }, { ...M({ id: "i1", path: "c.md" }), "c.md": "from repo" });
    await syncMirroredInterfaces("abc", g.io);
    assert.strictEqual(g.store.i1.overwroteEdit, null, "updatedAt equal to syncedAt is the sync's own write");
  });

  await test("(g) a no-longer-listed mirror loses sourcePath and keeps its text", async () => {
    const f = fakes({ old: { ...base, contentMd: "keep", sourcePath: "gone.md", sourceCommit: "c" }, i1: { ...base } }, { ...M({ id: "i1", path: "c.md" }), "c.md": "N" });
    await syncMirroredInterfaces("abc", f.io);
    assert.strictEqual(f.store.old.sourcePath, null);
    assert.strictEqual(f.store.old.contentMd, "keep");
  });

  await test("(h) no manifest: no writes, no errors", async () => {
    const f = fakes({ i1: { ...base, sourcePath: "x.md" } }, {});
    const r = await syncMirroredInterfaces("abc", f.io);
    assert.deepStrictEqual(r, { synced: [], skipped: [], errors: [] });
    assert.strictEqual(f.log.length, 0);
  });

  await test("(i) a read-back mismatch sets syncError", async () => {
    const f = fakes({ i1: { ...base } }, { ...M({ id: "i1", path: "c.md" }), "c.md": "new" }, { mangle: true });
    const r = await syncMirroredInterfaces("abc", f.io);
    assert.strictEqual(r.synced.length, 0);
    assert.match(f.store.i1.syncError, /byte for byte/);
  });

  await test("(j) never patches a project or project document (fake io throws)", async () => {
    const f = fakes({ i1: { ...base } }, { ...M({ id: "i1", path: "c.md" }), "c.md": "new" });
    const r = await syncMirroredInterfaces("abc", f.io);
    assert.strictEqual(r.errors.length, 0);
  });

  await test("(k) the repo's shared/board-interfaces.json, when present, is sound", async () => {
    const root = path.join(__dirname, "..", "..");
    const p = path.join(root, MANIFEST_PATH);
    if (!fs.existsSync(p)) return;
    const m = JSON.parse(fs.readFileSync(p, "utf8"));
    assert.ok(Array.isArray(m.interfaces));
    const ids = m.interfaces.map((e) => e.id);
    assert.strictEqual(new Set(ids).size, ids.length, "ids are unique");
    for (const e of m.interfaces) {
      assert.ok(e.id && e.path && !e.path.includes(".."), `entry ${e.id}`);
      const file = path.join(root, e.path);
      assert.ok(fs.existsSync(file), `${e.path} exists`);
      assert.ok(fs.readFileSync(file, "utf8").length <= INTERFACE_CAP, `${e.path} fits the cap`);
    }
  });

  console.log(`\n${passed} passed, ${failures.length} failed`);
  process.exit(failures.length ? 1 : 0);
})();
