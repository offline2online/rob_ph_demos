"use strict";
// Interface mirror: an interface contract (the Firestore `interfaces`
// collection) that is listed in shared/board-interfaces.json is copied from
// its repo file onto the board whenever main moves, read back byte for byte,
// so the board record can no longer drift from the file. Project documents
// already work this way (docs-sync-lib.js, syncMirroredDocs); interfaces join
// two projects, so they are handled once per sweep here, not once per project.
//
// Manifest, at `ref`: { "interfaces": [ { "id": "<interface id>", "path": "<repo-root path>" } ] }
// No manifest = nothing to do, no error (the file arrives with the Display
// Types "Interface contract v3.3" ticket).
//
// Never writes a project's docsSync: patchProject replaces the whole map, so
// it would wipe the other project's status. Pure of I/O: everything is
// injected (test/interface-mirror.test.js drives it with fakes).
//
// io: readFile(path) -> string|null, lastCommitFor(path) -> sha|null,
//     listInterfaces() -> [{id, ...fields}], getInterface(id) -> fields|null,
//     addRevision(fields) -> id, patchInterface(id, fields), now() -> Date.

const MANIFEST_PATH = "shared/board-interfaces.json";
const INTERFACE_CAP = 20000; // firestore.rules `interfaces` contentMd cap; the service account bypasses the rules
const SYNC_EMAIL = "docs-sync@automation";

const millis = (v) => {
  if (v && typeof v.toMillis === "function") return v.toMillis();
  const t = v instanceof Date ? v.getTime() : Date.parse(String(v || ""));
  return Number.isFinite(t) ? t : NaN;
};
const laterThan = (a, b) => millis(a) > millis(b);

const short = (s) => String(s || "").slice(0, 7);
const msg = (err) => String((err && err.message) || err).slice(0, 200);

async function syncMirroredInterfaces(ref, io) {
  const out = { synced: [], skipped: [], errors: [] };
  try {
    let raw = null;
    try { raw = io.readFile(MANIFEST_PATH); } catch { raw = null; }
    if (typeof raw !== "string") return out;

    let entries;
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.interfaces)) throw new Error('expected {"interfaces":[…]}');
      entries = parsed.interfaces;
    } catch (err) {
      out.errors.push(`${MANIFEST_PATH} at ${short(ref)}: ${msg(err)}`);
      return out;
    }

    const counts = {};
    for (const e of entries) { const id = e && e.id; counts[id] = (counts[id] || 0) + 1; }
    const listedIds = new Set();
    const now = () => io.now();

    for (const e of entries) {
      const id = e && typeof e.id === "string" ? e.id.trim() : "";
      const sp = e && typeof e.path === "string" ? e.path.trim().replace(/^\/+/, "") : "";
      if (id) listedIds.add(id);
      const label = `${id || "(no id)"} ← ${sp || "(no path)"}`;
      const refuse = (why) => out.errors.push(`${label}: ${why}`);
      if (!id) { refuse("entry has no id"); continue; }
      if (counts[id] > 1) { refuse("id is listed more than once"); continue; }
      if (!sp || sp.includes("..")) { refuse("path must be non-empty and stay inside the repo"); continue; }

      let existing = null;
      try { existing = await io.getInterface(id); } catch (err) { refuse(`could not read the interface (${msg(err)})`); continue; }
      if (!existing) { refuse("no such interface on the board"); continue; }

      // From here a failure is recorded on the interface itself.
      const fail = async (why) => {
        const text = `${why} (at ${short(ref)})`;
        out.errors.push(`${label}: ${text}`);
        try { await io.patchInterface(id, { syncError: text.slice(0, 300) }); } catch { /* the error is already in the result */ }
      };

      let content = null;
      try { content = io.readFile(sp); } catch { content = null; }
      if (typeof content !== "string") { await fail(`${sp} not found`); continue; }
      if (content.length > INTERFACE_CAP) { await fail(`${sp} is ${content.length} chars, over the ${INTERFACE_CAP} the board allows an interface`); continue; }

      try {
        const sourceCommit = io.lastCommitFor(sp) || ref;
        const current = typeof existing.contentMd === "string" ? existing.contentMd : "";
        if (current === content && existing.sourcePath === sp && existing.sourceCommit === sourceCommit && !existing.syncError) {
          out.skipped.push(id);
          continue;
        }

        const at = now(); // one instant for syncedAt and updatedAt, so the next sync can tell a later edit from this write
        const fields = { sourcePath: sp, sourceCommit, syncedAt: at, syncError: null };
        if (current !== content) {
          let revisionId = null;
          if (current !== "") {
            revisionId = await io.addRevision({
              target: "interface",
              interfaceId: id,
              projectIds: existing.projectIds || [],
              name: existing.name || "",
              contentMd: current,
              chars: current.length,
              replacedAt: now(),
              replacedByEmail: SYNC_EMAIL,
              via: "docs-sync",
            });
          }
          Object.assign(fields, { contentMd: content, updatedAt: at, updatedByEmail: SYNC_EMAIL });
          const by = existing.updatedByEmail || null;
          // The Docs page's save never sets updatedByEmail, so an edit made after
          // a sync still reads as ours by email; it shows as updatedAt moving past syncedAt.
          const editedAfterSync = laterThan(existing.updatedAt, existing.syncedAt);
          fields.overwroteEdit = revisionId && (by !== SYNC_EMAIL || editedAfterSync) ? { byEmail: by, at: existing.updatedAt ? new Date(existing.updatedAt) : null, revisionId } : null;
        }
        await io.patchInterface(id, fields);

        const after = await io.getInterface(id);
        if (!after || (after.contentMd || "") !== content) { await fail("wrote, but the board's copy does not match byte for byte"); continue; }
        out.synced.push(id);
      } catch (err) { await fail(msg(err)); }
    }

    // A record still claiming a mirror that is no longer listed keeps its text.
    let all = [];
    try { all = (await io.listInterfaces()) || []; } catch (err) { out.errors.push(`could not list interfaces (${msg(err)})`); }
    for (const i of all) {
      if (!String(i.sourcePath || "").trim() || listedIds.has(i.id)) continue;
      try { await io.patchInterface(i.id, { sourcePath: null, sourceCommit: null, syncError: null }); }
      catch (err) { out.errors.push(`${i.id}: could not clear sourcePath (${msg(err)})`); }
    }
  } catch (err) {
    out.errors.push(`unexpected failure (${msg(err)})`);
  }
  return out;
}

module.exports = { syncMirroredInterfaces, MANIFEST_PATH, INTERFACE_CAP, SYNC_EMAIL };
