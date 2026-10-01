"use strict";
// Post-merge docs sync: after a deployment train lands on main, copy the
// project's REQUIREMENTS.md and README.md at the merge commit onto its board
// document (requirementsMd / readmeMd), read them back, compare byte for byte,
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

const DOCS = [
  { field: "requirementsMd", name: "REQUIREMENTS.md", commitKey: "requirementsCommit", updatedAt: "requirementsUpdatedAt", updatedBy: "requirementsUpdatedByEmail" },
  { field: "readmeMd", name: "README.md", commitKey: "readmeCommit", updatedAt: "readmeUpdatedAt", updatedBy: "readmeUpdatedByEmail" },
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
//       getProject() -> project doc, patchProject(fields) -> Promise, now() -> Date }
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
    const fields = { updatedAt: now };
    for (const d of found) {
      fields[d.field] = d.content;
      fields[d.updatedAt] = now;
      fields[d.updatedBy] = "backlog-automation";
    }
    await io.patchProject(fields);
    // Read it back: a sync that reports success without checking is worse
    // than none.
    const after = await io.getProject();
    const bad = found.filter((d) => (after[d.field] || "") !== d.content);
    if (bad.length) throw new Error(`wrote, but the board's ${bad.map((d) => d.field).join(" and ")} does not match ${bad.map((d) => d.path).join(" / ")} byte for byte`);
    const docsSync = { mergeCommit, syncedAt: now, error: null };
    for (const d of DOCS) {
      const hit = found.find((f) => f.field === d.field);
      docsSync[d.commitKey] = hit ? (io.lastCommitFor(hit.path) || mergeCommit) : (prev[d.commitKey] || null);
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
