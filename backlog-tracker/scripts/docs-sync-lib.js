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

function cleanFolder(project) {
  if (!project || project.repoFolderNotApplicable) return null;
  const f = typeof project.repoFolder === "string" ? project.repoFolder.trim().replace(/^\/+|\/+$/g, "") : "";
  return f || null;
}

// io: { readFile(path) -> string|null, lastCommitFor(path) -> sha|null,
//       getProject() -> project doc, patchProject(fields) -> Promise,
//       putDoc(kind, fields) -> Promise  (writes projects/{id}/docs/{kind}),
//       getDoc(kind) -> {contentMd,...}|null, now() -> Date }
// Returns { skipped } | { ok: true, docsSync } | { ok: false, error }. Never throws.
async function syncProjectDocs(project, mergeCommit, io) {
  const folder = cleanFolder(project);
  if (!folder) return { skipped: "no repo folder" };
  const found = [];
  for (const doc of DOCS) {
    for (const p of docCandidates(folder, doc.name)) {
      let content = null;
      try { content = io.readFile(p); } catch { content = null; }
      if (typeof content === "string") { found.push({ ...doc, path: p, content }); break; }
    }
  }
  if (!found.length) return { skipped: `no REQUIREMENTS.md or README.md under ${folder}/` };

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
    await io.patchProject({ docsSync, lastMergeCommit: mergeCommit, lastMergeAt: now });
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

module.exports = { syncProjectDocs, docCandidates, cleanFolder, DOCS };
