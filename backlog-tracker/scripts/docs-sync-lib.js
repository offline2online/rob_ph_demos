"use strict";
// Post-merge docs sync: after a deployment train lands on main, copy the
// project's REQUIREMENTS.md and README.md at the merge commit onto the
// board's projects/{id}/docs/{requirements|readme} documents (the project doc
// itself keeps only a `docs` pointer), read them back, compare byte for byte,
// and record the outcome on projects/{id}.docsSync so a refused or failed sync
// is visible on the board instead of silent.
//
// Why this exists: the only automatic sync was a `push` trigger, and a merge
// made with the workflow's own GITHUB_TOKEN never fires one — PR #284
// (1 Oct 2026) changed both files of the DSP project and nothing ran, while
// the same project's board Requirements had been a 59-char placeholder since
// 29 Sep after a refused write nobody saw.
//
// Pure of I/O: every read/write is injected, so test/docs-sync.test.js drives
// it with fakes. run-backlog-automation.js wires the real git and Firestore.

const crypto = require("crypto");

// `kind` is the document id under projects/{id}/docs/.
const DOCS = [
  { kind: "requirements", name: "REQUIREMENTS.md", commitKey: "requirementsCommit" },
  { kind: "readme", name: "README.md", commitKey: "readmeCommit" },
];

// Where a project keeps each file, relative to the repo root. The first that
// exists at the commit wins. `<folder>/docs/<folder>/` is how the DSP project
// lays out its requirements (dsp-integration/docs/dsp-integration/).
function docCandidates(folder, name) {
  return [`${folder}/${name}`, `${folder}/docs/${folder}/${name}`, `${folder}/docs/${name}`];
}

// The one rule for "which repo folder is this project's": repoFolder, else the
// slug of its deploy/<folder> branch. run-backlog-automation.js's
// projectFolderOf() and the docs sync below both use it, so they cannot
// disagree (1 Oct 2026: the sync read repoFolder alone and skipped the DSP
// project, whose folder projectFolderOf() had been finding via the branch).
// `exists` (optional) filters candidates to folders present in a checkout.
function resolveRepoFolder(project, exists) {
  const slug = String(project?.deployBranch || "").replace(/^deploy\//, "");
  for (const c of [project?.repoFolder, slug]) {
    const folder = String(c || "").trim().replace(/^\/+|\/+$/g, "");
    if (folder && !folder.includes("..") && (!exists || exists(folder))) return folder;
  }
  return null;
}

function cleanFolder(project) {
  if (!project || project.repoFolderNotApplicable) return null;
  return resolveRepoFolder(project);
}

// A skip used to be a log line only, so the board's "Docs behind main" chip
// could not show it. Record it on the project; the next successful sync
// replaces docsSync wholesale, which clears it. A project deliberately marked
// repoFolderNotApplicable is not a problem to surface, so it stays silent.
async function skip(project, mergeCommit, io, reason) {
  const result = { skipped: reason };
  if (project && project.repoFolderNotApplicable) return result;
  try {
    const at = io.now();
    await io.patchProject({ docsSync: { skipped: reason, at, mergeCommit }, lastMergeCommit: mergeCommit, lastMergeAt: at });
  } catch { /* the caller logs the skip; nothing else to try */ }
  return result;
}

// projectDocs (the "Additional documents" on a project's Docs page) may carry
// an optional `sourcePath` (repo-root-relative): the repo file the document
// mirrors. After a merge each is rewritten from that file at the merge commit
// and read back byte for byte, like Requirements/README. A refusal on one
// (e.g. over the editor cap) is collected, not thrown, so it neither blocks
// the others nor the Requirements/README result. Needs io.listProjectDocs,
// io.putProjectDocContent and io.getProjectDocContent; absent = no-op.
// A board document capped below its repo file mirrors part of it
// (taUi7jWIwhCvfeDDUURl: "Boundaries with PH Core" is three board docs).
// d.sourceSlices = [{ start, end }]: `start` is a line of the file, matched
// exactly after trimming, taken inclusive; `end` is the line the slice stops
// before (omitted = to the end of the file; start omitted = from the top).
// Headings, never line numbers, so an edit above a slice doesn't shift it.
// d.sourcePrefix, if set, is prepended verbatim. Throws when a marker is
// missing, so a renamed heading is reported instead of mirroring nothing.
function mirrorText(content, d) {
  const slices = Array.isArray(d.sourceSlices) ? d.sourceSlices : [];
  let body = content;
  if (slices.length) {
    const lines = content.split("\n");
    const find = (marker, from) => {
      const i = lines.findIndex((l, n) => n >= from && l.trim() === String(marker).trim());
      if (i < 0) throw new Error(`slice marker not found: "${String(marker).slice(0, 80)}"`);
      return i;
    };
    body = slices.map((sl) => {
      const a = sl && sl.start ? find(sl.start, 0) : 0;
      const b = sl && sl.end ? find(sl.end, a + 1) : lines.length;
      return lines.slice(a, b).join("\n").replace(/\n+$/, "");
    }).join("\n\n") + "\n";
  }
  return (d.sourcePrefix ? String(d.sourcePrefix) : "") + body;
}

async function syncMirroredDocs(project, mergeCommit, io, now) {
  const out = { synced: [], errors: [] };
  if (typeof io.listProjectDocs !== "function") return out;
  let docs;
  try { docs = await io.listProjectDocs(); } catch (err) { out.errors.push(`could not list project documents (${String(err && err.message || err).slice(0, 200)})`); return out; }
  for (const d of docs || []) {
    const sp = String(d.sourcePath || "").trim().replace(/^\/+/, "");
    if (!sp) continue;
    const label = `"${d.name || d.id}" ← ${sp}`;
    if (sp.includes("..")) { out.errors.push(`${label}: sourcePath must stay inside the repo`); continue; }
    let content = null;
    try { content = io.readFile(sp); } catch { content = null; }
    if (typeof content !== "string") { out.errors.push(`${label}: file not found at ${String(mergeCommit).slice(0, 7)}`); continue; }
    try {
      content = mirrorText(content, d);
    } catch (err) { out.errors.push(`${label}: ${String(err && err.message || err).slice(0, 200)}`); continue; }
    try {
      const sourceCommit = io.lastCommitFor(sp) || mergeCommit;
      await io.putProjectDocContent(d.id, { contentMd: content, updatedAt: now, sourceCommit });
      const after = await io.getProjectDocContent(d.id);
      if (!after || (after.contentMd || "") !== content) throw new Error("wrote, but the board's copy does not match byte for byte");
      out.synced.push(`${d.id}@${String(sourceCommit).slice(0, 7)}`);
    } catch (err) {
      out.errors.push(`${label}: ${String(err && err.message || err).slice(0, 200)}`);
    }
  }
  return out;
}

// io: { readFile(path) -> string|null, lastCommitFor(path) -> sha|null,
//       getProject() -> project doc, patchProject(fields) -> Promise,
//       putDoc(kind, fields) -> Promise  (writes projects/{id}/docs/{kind}),
//       getDoc(kind) -> {contentMd,...}|null, now() -> Date }
// Returns { skipped } | { ok: true, docsSync } | { ok: false, error }. Never throws.
async function syncProjectDocs(project, mergeCommit, io) {
  const folder = cleanFolder(project);
  if (!folder) return skip(project, mergeCommit, io, "no repo folder");
  const found = [];
  for (const doc of DOCS) {
    for (const p of docCandidates(folder, doc.name)) {
      let content = null;
      try { content = io.readFile(p); } catch { content = null; }
      if (typeof content === "string") { found.push({ ...doc, path: p, content }); break; }
    }
  }
  if (!found.length) return skip(project, mergeCommit, io, `no REQUIREMENTS.md or README.md under ${folder}/`);

  const now = io.now();
  const prev = project.docsSync && typeof project.docsSync === "object" ? project.docsSync : {};
  try {
    const pointers = Object.assign({}, project.docs && typeof project.docs === "object" ? project.docs : {});
    for (const d of found) {
      const sourceCommit = io.lastCommitFor(d.path) || mergeCommit;
      const sha256 = crypto.createHash("sha256").update(d.content, "utf8").digest("hex");
      await io.putDoc(d.kind, {
        contentMd: d.content,
        updatedAt: now,
        updatedByEmail: "backlog-automation",
        sourceCommit,
        sourcePath: d.path,
        chars: d.content.length,
        sha256,
      });
      d.sourceCommit = sourceCommit;
      pointers[d.kind] = { chars: d.content.length, sha256, sourceCommit, updatedAt: now };
    }
    await io.patchProject({ docs: pointers, updatedAt: now });
    // Read it back: a sync that reports success without checking is worse
    // than none.
    const bad = [];
    for (const d of found) {
      const after = await io.getDoc(d.kind);
      if (!after || (after.contentMd || "") !== d.content) bad.push(d);
    }
    if (bad.length) throw new Error(`wrote, but the board's ${bad.map((d) => d.kind).join(" and ")} does not match ${bad.map((d) => d.path).join(" / ")} byte for byte`);
    const docsSync = { mergeCommit, syncedAt: now, error: null };
    for (const d of DOCS) {
      const hit = found.find((f) => f.kind === d.kind);
      docsSync[d.commitKey] = hit ? hit.sourceCommit : (prev[d.commitKey] || null);
    }
    const mirrors = await syncMirroredDocs(project, mergeCommit, io, now);
    if (mirrors.errors.length) {
      const error = `Docs sync at ${String(mergeCommit).slice(0, 7)}: ${mirrors.errors.join("; ")}`.slice(0, 900);
      Object.assign(docsSync, { error, errorAt: now, attemptedCommit: mergeCommit });
    }
    if (mirrors.synced.length) docsSync.mirroredDocs = mirrors.synced;
    await io.patchProject({ docsSync, lastMergeCommit: mergeCommit, lastMergeAt: now });
    if (mirrors.errors.length) return { ok: false, error: docsSync.error };
    return { ok: true, docsSync };
  } catch (err) {
    const error = `Docs sync at ${String(mergeCommit).slice(0, 7)} failed: ${String(err && err.message || err).slice(0, 600)}`;
    try {
      await io.patchProject({
        docsSync: { ...prev, error, errorAt: now, attemptedCommit: mergeCommit },
        lastMergeCommit: mergeCommit, lastMergeAt: now,
      });
    } catch { /* the caller logs the returned error; nothing else to try */ }
    return { ok: false, error };
  }
}

module.exports = { syncProjectDocs, mirrorText, docCandidates, cleanFolder, resolveRepoFolder, DOCS };
