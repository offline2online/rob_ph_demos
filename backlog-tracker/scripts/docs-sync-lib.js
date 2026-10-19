"use strict";
// Board docs sync: copy a project's repo files onto the board and record the
// outcome on projects/{id}.docsSync, so a refused or failed sync is visible
// instead of silent. For one project: REQUIREMENTS.md and README.md go to
// projects/{id}/docs/{requirements|readme} (the project doc keeps only a
// `docs` pointer), each projectDocs document with a `sourcePath` is rewritten
// from its repo file, and a board-docs.json manifest is reconciled. Every
// write is read back and compared byte for byte; a document already in step
// is not written at all.
//
// It runs from two places, both in run-backlog-automation.js:
//   - syncProjectDocs, after a train merges (finishTrain), for that project;
//   - syncAllProjectDocs, at the end of every run, whenever main's head has
//     moved since the last complete pass. That covers every merge that did not
//     come through a train (a hand merge, a hotfix, another project's PR).
//     State lives in systemStatus/docsSync.
// A project with a repo folder reads Requirements/README from that folder; one
// without (repoFolderNotApplicable) reads them from the `sourcePath` already on
// its docs/{requirements|readme} document.
//
// Why this exists: the only automatic sync was a `push` trigger, and a merge
// made with the workflow's own GITHUB_TOKEN never fires one — PR #284
// (1 Oct 2026) changed both files of the DSP project and nothing ran, while
// the same project's board Requirements had been a 59-char placeholder since
// 29 Sep after a refused write nobody saw. PR #403 (17 Oct) was hand-merged
// and the board stayed old until that project's next train.
//
// Pure of I/O: every read/write is injected, so test/docs-sync.test.js and
// test/docs-sync-all.test.js drive it with fakes.

const crypto = require("crypto");

// `kind` is the document id under projects/{id}/docs/.
const DOCS = [
  { kind: "requirements", name: "REQUIREMENTS.md", commitKey: "requirementsCommit" },
  { kind: "readme", name: "README.md", commitKey: "readmeCommit" },
];

// Where a project keeps each file, relative to the repo root. The first that
// exists at the commit wins. `<folder>/docs/<folder>/` is how the DSP project
// lays out its requirements (dsp-integration/docs/dsp-integration/).
// The caps firestore.rules enforces on a person's write (the automation's
// service account bypasses them, so they are checked here): a projectDocs
// contentMd (`contentMd.size() <= 20000`) and a docs/{requirements|readme}
// contentMd (`<= 800000`). test/docs-sync.test.js compares both with the rules.
const MIRROR_CAP = 20000;
const CORE_DOC_CAP = 800000;
const MAX_SYNC_ATTEMPTS = 5;

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
// replaces docsSync wholesale, which clears it. A project marked
// repoFolderNotApplicable that has nothing to sync (no Requirements/README
// sourcePath, no mirrored document, no manifest) is deliberately silent: there
// is no problem to surface. Once it has any of those it is synced like any
// other project and never reaches here.
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

// The projectDocs of a project that carry a sourcePath (the manifest-handled
// ids excluded). -> { docs, error }
async function listMirrors(io, skipIds) {
  if (typeof io.listProjectDocs !== "function") return { docs: [] };
  try {
    const all = (await io.listProjectDocs()) || [];
    return { docs: all.filter((d) => String(d.sourcePath || "").trim() && !(skipIds && skipIds.has(d.id))) };
  } catch (err) {
    return { docs: [], error: `could not list project documents (${String(err && err.message || err).slice(0, 200)})` };
  }
}

// -> { results: [{ docId, name, sourcePath, sourceCommit, ok, error }], errors }
// A document already holding the file's text, path and last commit is not
// written. One bad mirror never stops the rest.
async function syncMirroredDocs(project, mergeCommit, io, now, listed) {
  const out = { results: [], errors: [] };
  if (listed.error) out.errors.push(listed.error);
  for (const d of listed.docs) {
    const sp = String(d.sourcePath || "").trim().replace(/^\/+/, "");
    const label = `"${d.name || d.id}" ← ${sp}`;
    const res = { docId: d.id, name: d.name || "", sourcePath: sp, sourceCommit: null, ok: false, error: null };
    out.results.push(res);
    const fail = (msg) => { res.error = String(msg).slice(0, 200); out.errors.push(`${label}: ${res.error}`); };
    if (sp.includes("..")) { fail("sourcePath must stay inside the repo"); continue; }
    let content = null;
    try { content = io.readFile(sp); } catch { content = null; }
    if (typeof content !== "string") { fail(`file not found at ${String(mergeCommit).slice(0, 7)}`); continue; }
    try { content = mirrorText(content, d); } catch (err) { fail(err && err.message || err); continue; }
    if (content.length > MIRROR_CAP) { fail(`${content.length} chars, over the ${MIRROR_CAP} the board allows a project document — split it with sourceSlices`); continue; }
    try {
      const sourceCommit = io.lastCommitFor(sp) || mergeCommit;
      res.sourceCommit = sourceCommit;
      const have = await io.getProjectDocContent(d.id);
      const inStep = have && have.contentMd === content && have.sourcePath === sp && have.sourceCommit === sourceCommit;
      if (!inStep) {
        await io.putProjectDocContent(d.id, { contentMd: content, sourcePath: sp, updatedAt: now, sourceCommit });
        const after = await io.getProjectDocContent(d.id);
        if (!after || (after.contentMd || "") !== content) throw new Error("wrote, but the board's copy does not match byte for byte");
      }
      res.ok = true;
    } catch (err) { fail(err && err.message || err); }
  }
  return out;
}


// ── board-docs.json: which repo files are documents on the console ─────────
// A project declares its handover files in a manifest (normally
// <folder>/board-docs.json) instead of someone creating each board document
// by hand and copying its id into a script. reconcileManifest() runs at the
// start of every post-merge sync, folder or not. Never deletes anything.
const MANIFEST_NAME = "board-docs.json";
const BOARD_DOC_CAP = MIRROR_CAP; // firestore.rules: projectDocs.contentMd; the service account bypasses it, so check here
const KEY_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const STATUSES = ["current", "working", "superseded"];
const MAX_UNLISTED = 50;

const isManifestPath = (p) => typeof p === "string" && p.split("/").pop() === MANIFEST_NAME && !p.split("/").includes("node_modules");

// The line every mirror opens with unless the manifest gives its own prefix.
// Entries sharing a path say "(part i of n)" in manifest order.
function mirrorSpec(manifest, entry) {
  const same = manifest.mirrors.filter((m) => m.path === entry.path);
  const part = same.length > 1 ? ` (part ${same.indexOf(entry) + 1} of ${same.length})` : "";
  const sourcePrefix = typeof entry.prefix === "string"
    ? entry.prefix
    : `> Mirror of \`${entry.path}\`${part} — the repo wins. Rewritten from the repo file on every merge to main; edit the file, not this copy.\n\n`;
  return { sourcePath: entry.path, sourceSlices: normSlices(entry.slices), sourcePrefix };
}

function normSlices(slices) {
  return (Array.isArray(slices) ? slices : []).map((sl) => {
    const o = {};
    if (sl && sl.start) o.start = String(sl.start);
    if (sl && sl.end) o.end = String(sl.end);
    return o;
  });
}

// Pure shape check. Returns a list of problems (empty = valid). `exists`
// (optional) checks a repo-relative path against a checkout.
function validateManifest(m, exists) {
  const errs = [];
  if (!m || typeof m !== "object" || Array.isArray(m)) return ["manifest must be a JSON object"];
  if (typeof m.projectId !== "string" || !m.projectId.trim()) errs.push("projectId is required");
  const mirrors = m.mirrors === undefined ? [] : m.mirrors;
  const boardDocs = m.boardDocs === undefined ? [] : m.boardDocs;
  if (!Array.isArray(mirrors)) errs.push("mirrors must be an array");
  if (!Array.isArray(boardDocs)) errs.push("boardDocs must be an array");
  if (errs.length) return errs;
  const keys = new Set();
  const ids = new Set();
  mirrors.forEach((e, i) => {
    const at = `mirrors[${i}]${e && e.key ? ` (${e.key})` : ""}`;
    if (!e || typeof e !== "object") { errs.push(`${at}: must be an object`); return; }
    if (typeof e.key !== "string" || !KEY_RE.test(e.key)) errs.push(`${at}: key must be lower-case kebab`);
    else if (keys.has(e.key)) errs.push(`${at}: key is listed twice`);
    else keys.add(e.key);
    if (typeof e.path !== "string" || !e.path.trim() || e.path.startsWith("/") || e.path.split("/").includes("..")) errs.push(`${at}: path must be repo-root-relative with no ".."`);
    else if (exists && !exists(e.path)) errs.push(`${at}: ${e.path} does not exist`);
    if (typeof e.name !== "string" || e.name.length < 1 || e.name.length > 120) errs.push(`${at}: name must be 1–120 characters`);
    if (e.slices !== undefined && !Array.isArray(e.slices)) errs.push(`${at}: slices must be an array`);
    if (e.prefix !== undefined && typeof e.prefix !== "string") errs.push(`${at}: prefix must be a string`);
    if (e.status !== undefined && !STATUSES.includes(e.status)) errs.push(`${at}: status must be one of ${STATUSES.join("/")}`);
    if (e.id !== undefined) {
      if (typeof e.id !== "string" || !e.id.trim()) errs.push(`${at}: id must be a non-empty string`);
      else if (ids.has(e.id)) errs.push(`${at}: document id ${e.id} is listed twice`);
      else ids.add(e.id);
    }
  });
  boardDocs.forEach((e, i) => {
    const at = `boardDocs[${i}]`;
    if (!e || typeof e !== "object") { errs.push(`${at}: must be an object`); return; }
    if (typeof e.id !== "string" || !e.id.trim()) errs.push(`${at}: id is required`);
    else if (ids.has(e.id)) errs.push(`${at}: document id ${e.id} is listed twice`);
    else ids.add(e.id);
    if (!STATUSES.includes(e.status)) errs.push(`${at}: status must be one of ${STATUSES.join("/")}`);
    if (e.note !== undefined && typeof e.note !== "string") errs.push(`${at}: note must be a string`);
  });
  const sh = m.startHere;
  if (typeof sh !== "string" || !(sh === "readme" || sh === "requirements" || keys.has(sh))) errs.push(`startHere must be "readme", "requirements" or a mirror key`);
  return errs;
}

// The manifest for a project in a commit's tree: found by scanning, matched on
// projectId, whatever repoFolder says. Two for one project is an error.
// -> { none: true } | { manifest, path } | { error }
function findManifest(project, io) {
  if (typeof io.listFiles !== "function") return { none: true };
  let files;
  try { files = io.listFiles(); } catch (err) { return { error: `could not scan for ${MANIFEST_NAME} (${String(err && err.message || err).slice(0, 160)})` }; }
  const folder = cleanFolder(project);
  const hits = [];
  for (const p of (files || []).filter(isManifestPath)) {
    let parsed = null;
    try { parsed = JSON.parse(io.readFile(p)); } catch {
      if (folder && p.startsWith(`${folder}/`)) return { error: `${p} is not valid JSON` };
      continue;
    }
    if (parsed && parsed.projectId === project.id) hits.push({ manifest: parsed, path: p });
  }
  if (!hits.length) return { none: true };
  if (hits.length > 1) return { error: `two manifests declare project ${project.id}: ${hits.map((h) => h.path).join(", ")}` };
  return hits[0];
}

const same = (a, b) => JSON.stringify(a === undefined ? null : a) === JSON.stringify(b === undefined ? null : b);

// io: listProjectDocs() -> [{id,name,sourcePath,mirrorKey,manifestPath,status,statusNote,kind}],
//     getProjectDoc(id) -> full doc|null, createProjectDoc(fields) -> id,
//     putProjectDocContent(id, fields), readFile(path), lastCommitFor(path).
// Returns { errors, handled:Set<docId>, startHereDocId, unlisted, written, created }. Never throws.
async function reconcileManifest(project, mergeCommit, found, io, now) {
  const { manifest, path: manifestPath } = found;
  const out = { errors: [], handled: new Set(), startHereDocId: null, unlisted: [], written: [], created: [], results: [], manifestPath };
  const bad = validateManifest(manifest);
  if (bad.length) { out.errors.push(`${manifestPath}: ${bad.join("; ")}`.slice(0, 600)); return out; }
  let docs;
  try { docs = await io.listProjectDocs(); } catch (err) { out.errors.push(`${manifestPath}: could not list project documents (${String(err && err.message || err).slice(0, 160)})`); return out; }
  docs = docs || [];
  const byId = new Map(docs.map((d) => [d.id, d]));
  const keyToId = new Map();
  const fail = (label, err) => out.errors.push(`${label}: ${String(err && err.message || err).slice(0, 220)}`);
  const getFull = async (id) => { try { return await io.getProjectDoc(id); } catch { return null; } };

  for (const entry of manifest.mirrors || []) {
    const label = `${entry.key} ← ${entry.path}`;
    try {
      let content = null;
      try { content = io.readFile(entry.path); } catch { content = null; }
      if (typeof content !== "string") throw new Error(`file not found at ${String(mergeCommit).slice(0, 7)}`);
      const spec = mirrorSpec(manifest, entry);
      const text = mirrorText(content, spec);
      if (text.length > BOARD_DOC_CAP) throw new Error(`${text.length} chars, over the ${BOARD_DOC_CAP} the board allows a document — split it with slices`);

      // Match by id, else by the stored mirrorKey. Never by sourcePath alone:
      // one file maps to several documents.
      let existing = null;
      if (entry.id) {
        if (byId.has(entry.id)) existing = await getFull(entry.id);
        else {
          const other = await getFull(entry.id);
          if (other && other.projectId && other.projectId !== project.id) throw new Error(`document ${entry.id} belongs to another project — refused`);
          existing = other;
        }
      }
      if (!existing) {
        const k = docs.find((d) => d.mirrorKey === entry.key);
        if (k) existing = await getFull(k.id);
      }

      const desired = { name: entry.name, sourcePath: spec.sourcePath, sourceSlices: spec.sourceSlices, sourcePrefix: spec.sourcePrefix, mirrorKey: entry.key, manifestPath };
      if (entry.status) desired.status = entry.status;
      const sourceCommit = io.lastCommitFor(entry.path) || mergeCommit;
      let id;
      if (existing) {
        id = existing.id;
        const diff = {};
        for (const [k, v] of Object.entries(desired)) {
          if (!same(k === "sourceSlices" ? normSlices(existing[k]) : existing[k], v)) diff[k] = v;
        }
        if (existing.contentMd !== text) diff.contentMd = text;
        if (Object.keys(diff).length) {
          await io.putProjectDocContent(id, { ...diff, updatedAt: now, updatedByEmail: "backlog-automation", sourceCommit });
          out.written.push(id);
        }
      } else {
        id = await io.createProjectDoc({ projectId: project.id, ...desired, contentMd: text, createdAt: now, updatedAt: now, updatedByEmail: "backlog-automation", sourceCommit });
        out.created.push(id);
      }
      out.handled.add(id);
      keyToId.set(entry.key, id);
      if (!existing || out.written.includes(id)) {
        const after = await io.getProjectDoc(id);
        if (!after || (after.contentMd || "") !== text) throw new Error("wrote, but the board's copy does not match byte for byte");
      }
      out.results.push({ docId: id, name: entry.name, sourcePath: entry.path, sourceCommit, ok: true, error: null });
    } catch (err) {
      fail(label, err);
      out.results.push({ docId: entry.id || null, name: entry.name, sourcePath: entry.path, sourceCommit: null, ok: false, error: String(err && err.message || err).slice(0, 200) });
    }
  }

  for (const b of manifest.boardDocs || []) {
    const label = `boardDocs ${b.id}`;
    try {
      let d = byId.get(b.id);
      if (!d) {
        const other = await getFull(b.id);
        throw new Error(other && other.projectId && other.projectId !== project.id ? "belongs to another project — refused" : "no such document in this project");
      }
      out.handled.add(b.id);
      const desired = { status: b.status, statusNote: b.note || null, manifestPath };
      const diff = {};
      for (const [k, v] of Object.entries(desired)) if (!same(d[k], v)) diff[k] = v;
      if (Object.keys(diff).length) { await io.putProjectDocContent(b.id, diff); out.written.push(b.id); }
    } catch (err) { fail(label, err); }
  }

  // Mirrors that declare a status but matched an existing doc get it above;
  // the manifest's own mirror docs are classified by being listed at all.
  const sh = manifest.startHere;
  if (sh === "readme" || sh === "requirements") out.startHereDocId = sh;
  else if (keyToId.has(sh)) out.startHereDocId = keyToId.get(sh);
  else out.errors.push(`startHere "${sh}" has no document yet (its mirror failed)`);

  const known = new Set([...out.handled, ...(manifest.boardDocs || []).map((b) => b.id), ...[...keyToId.values()]]);
  for (const d of docs) {
    if (known.has(d.id) || d.kind === "generated") continue;
    if (out.unlisted.length < MAX_UNLISTED) out.unlisted.push({ id: d.id, name: d.name || "" });
  }
  return out;
}

// Where Requirements/README come from. A project with a repo folder reads them
// from it (docCandidates). One without reads the `sourcePath` already on its
// docs/{kind} document — repo-root-relative, no "..", and the file must exist
// at the commit. -> { found: [{kind,name,commitKey,path,content}], errors }
async function coreSources(project, folder, io, mergeCommit) {
  const out = { found: [], errors: [] };
  for (const doc of DOCS) {
    if (folder) {
      for (const p of docCandidates(folder, doc.name)) {
        let content = null;
        try { content = io.readFile(p); } catch { content = null; }
        if (typeof content === "string") { out.found.push({ ...doc, path: p, content }); break; }
      }
      continue;
    }
    let sp = "";
    try { const cur = await io.getDoc(doc.kind); sp = String(cur && cur.sourcePath || "").trim().replace(/^\/+/, ""); } catch { sp = ""; }
    if (!sp) continue;
    if (sp.includes("..")) { out.errors.push(`${doc.name}: sourcePath ${sp} must stay inside the repo`); continue; }
    let content = null;
    try { content = io.readFile(sp); } catch { content = null; }
    if (typeof content !== "string") { out.errors.push(`${doc.name}: ${sp} not found at ${String(mergeCommit).slice(0, 7)}`); continue; }
    out.found.push({ ...doc, path: sp, content });
  }
  return out;
}

// io: { readFile(path) -> string|null, lastCommitFor(path) -> sha|null,
//       getProject() -> project doc, patchProject(fields) -> Promise,
//       putDoc(kind, fields) -> Promise  (writes projects/{id}/docs/{kind}),
//       getDoc(kind) -> {contentMd,sourcePath,sourceCommit,...}|null, now() -> Date,
//       listProjectDocs / putProjectDocContent / getProjectDocContent (mirrors),
//       getProjectDoc / createProjectDoc / listFiles (manifest) }
// Returns { skipped } | { ok: true, docsSync } | { ok: false, error }. Never throws.
async function syncProjectDocs(project, mergeCommit, io) {
  const short = String(mergeCommit).slice(0, 7);
  // The manifest runs first, folder or not (no manifest = today's behaviour).
  let manifestRun = null;
  const found0 = findManifest(project, io);
  if (found0.error) manifestRun = { errors: [found0.error], handled: new Set(), unlisted: [], results: [], manifestPath: null, startHereDocId: null };
  else if (!found0.none) manifestRun = await reconcileManifest(project, mergeCommit, found0, io, io.now());
  const folder = cleanFolder(project);
  const core = await coreSources(project, folder, io, mergeCommit);
  const listed = await listMirrors(io, manifestRun && manifestRun.handled);
  if (!manifestRun && !core.found.length && !core.errors.length && !listed.docs.length && !listed.error) {
    if (!folder) return skip(project, mergeCommit, io, "no repo folder");
    return skip(project, mergeCommit, io, `no REQUIREMENTS.md or README.md under ${folder}/`);
  }

  const now = io.now();
  const prev = project.docsSync && typeof project.docsSync === "object" ? project.docsSync : {};
  const errors = [...core.errors];
  const pointers = Object.assign({}, project.docs && typeof project.docs === "object" ? project.docs : {});
  const commits = {};
  let wrote = false;
  try {
    for (const d of core.found) {
      try {
        if (d.content.length > CORE_DOC_CAP) throw new Error(`${d.content.length} chars, over the ${CORE_DOC_CAP} the board allows — split it with sourceSlices`);
        const sourceCommit = io.lastCommitFor(d.path) || mergeCommit;
        const have = await io.getDoc(d.kind);
        const inStep = have && have.contentMd === d.content && have.sourcePath === d.path && have.sourceCommit === sourceCommit;
        if (!inStep) {
          const sha256 = crypto.createHash("sha256").update(d.content, "utf8").digest("hex");
          await io.putDoc(d.kind, { contentMd: d.content, updatedAt: now, updatedByEmail: "backlog-automation", sourceCommit, sourcePath: d.path, chars: d.content.length, sha256 });
          // Read it back: a sync that reports success without checking is
          // worse than none.
          const after = await io.getDoc(d.kind);
          if (!after || (after.contentMd || "") !== d.content) throw new Error(`wrote, but the board's ${d.kind} does not match ${d.path} byte for byte`);
          pointers[d.kind] = { chars: d.content.length, sha256, sourceCommit, updatedAt: now };
          wrote = true;
        }
        commits[d.commitKey] = sourceCommit;
      } catch (err) { errors.push(`${d.name}: ${String(err && err.message || err).slice(0, 300)}`); }
    }
    if (wrote) await io.patchProject({ docs: pointers, updatedAt: now });
    const docsSync = { mergeCommit, syncedAt: now, error: null, errorAt: null, attemptedCommit: mergeCommit };
    for (const d of DOCS) docsSync[d.commitKey] = commits[d.commitKey] || prev[d.commitKey] || null;
    const mirrors = await syncMirroredDocs(project, mergeCommit, io, now, listed);
    docsSync.mirroredDocs = [...(manifestRun ? manifestRun.results : []), ...mirrors.results];
    errors.push(...mirrors.errors);
    if (manifestRun) {
      docsSync.manifestPath = manifestRun.manifestPath;
      docsSync.unlisted = manifestRun.unlisted;
      errors.push(...manifestRun.errors);
    }
    if (errors.length) {
      docsSync.error = `Docs sync at ${short}: ${errors.join("; ")}`.slice(0, 900);
      docsSync.errorAt = now;
    }
    const finalFields = { docsSync, lastMergeCommit: mergeCommit, lastMergeAt: now };
    if (manifestRun && manifestRun.startHereDocId) finalFields.startHereDocId = manifestRun.startHereDocId;
    await io.patchProject(finalFields);
    return docsSync.error ? { ok: false, error: docsSync.error } : { ok: true, docsSync };
  } catch (err) {
    const error = `Docs sync at ${short} failed: ${String(err && err.message || err).slice(0, 600)}`;
    try {
      await io.patchProject({
        docsSync: { ...prev, error, errorAt: now, attemptedCommit: mergeCommit },
        lastMergeCommit: mergeCommit, lastMergeAt: now,
      });
    } catch { /* the caller logs the returned error; nothing else to try */ }
    return { ok: false, error };
  }
}

// Does the project have anything for the sweep to sync at this commit? A
// folder only counts when one of its Requirements/README candidates exists
// there, so a project that never had repo docs is not touched (and gets no
// "skipped" chip).
async function hasSomethingToSync(project, io) {
  const folder = cleanFolder(project);
  if (folder) {
    for (const doc of DOCS) {
      for (const p of docCandidates(folder, doc.name)) {
        let c = null;
        try { c = io.readFile(p); } catch { c = null; }
        if (typeof c === "string") return true;
      }
    }
  } else {
    for (const doc of DOCS) {
      try { const cur = await io.getDoc(doc.kind); if (cur && String(cur.sourcePath || "").trim()) return true; } catch { /* next */ }
    }
  }
  const found = findManifest(project, io);
  if (!found.none) return true;
  const listed = await listMirrors(io);
  return listed.docs.length > 0 || !!listed.error;
}

// The sweep: when main's head has moved since the last pass that fully
// succeeded, sync every non-archived project that has something to sync.
// State is systemStatus/docsSync: { lastSyncedMain, attemptedMain, attempts,
// failedProjects, checkedAt }. lastSyncedMain advances only when every project
// succeeded; otherwise the same head is retried on the next run, at most
// MAX_SYNC_ATTEMPTS times (the failure itself stays on each project's
// docsSync.error). A new head resets the count.
// io: { getState(), putState(fields), listProjects() -> [project],
//       forProject(project) -> the per-project io syncProjectDocs takes, now() }
// Never throws on a project; a state or listing failure rejects.
async function syncAllProjectDocs({ head, io }) {
  if (!head) return { skipped: "no head" };
  const state = (await io.getState()) || {};
  if (state.lastSyncedMain === head) return { skipped: "main unchanged" };
  const attempts = state.attemptedMain === head ? Number(state.attempts) || 0 : 0;
  if (attempts >= MAX_SYNC_ATTEMPTS) return { skipped: `gave up after ${attempts} attempts at ${String(head).slice(0, 7)}` };
  const projects = ((await io.listProjects()) || []).filter((p) => p && !p.archived);
  const failed = [];
  const synced = [];
  for (const project of projects) {
    try {
      const pio = io.forProject(project);
      // Already complete at this head (finishTrain got there first, or an
      // earlier attempt of this sweep did): nothing to redo.
      if (project.docsSync && project.docsSync.mergeCommit === head && !project.docsSync.error && !project.docsSync.skipped) continue;
      if (!(await hasSomethingToSync(project, pio))) continue;
      const r = await syncProjectDocs(project, head, pio);
      if (r.ok === false) failed.push(project.id);
      else if (r.ok) synced.push(project.id);
    } catch (err) {
      failed.push(project.id);
    }
  }
  const ok = failed.length === 0;
  await io.putState({
    lastSyncedMain: ok ? head : (state.lastSyncedMain || null),
    attemptedMain: head,
    attempts: attempts + 1,
    failedProjects: failed,
    checkedAt: io.now(),
  });
  return { ok, head, synced, failed, attempts: attempts + 1 };
}

module.exports = { syncProjectDocs, syncAllProjectDocs, MIRROR_CAP, CORE_DOC_CAP, MAX_SYNC_ATTEMPTS, reconcileManifest, validateManifest, findManifest, mirrorSpec, isManifestPath, MANIFEST_NAME, BOARD_DOC_CAP, mirrorText, docCandidates, cleanFolder, resolveRepoFolder, DOCS };
