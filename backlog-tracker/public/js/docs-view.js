// Pure, dependency-free helpers for the Docs page's "repo mirrors are
// read-only" view (a1xWfd9zq1a0cuuwf4cA). A document, interface or
// README/Requirements record that carries a `sourcePath` is a copy that a
// docs sync rewrites from that repo file after every merge to main, so the
// page shows it as a mirror (chip + "Open in GitHub") instead of offering
// an editor whose save the next sync would silently overwrite.
//
// No Firebase, no DOM: testable with plain node (test/docs-view.test.mjs),
// same split as build-batches.js — imported by public/js/app.js.

const REPO_BLOB_BASE = "https://github.com/offline2online/rob_ph_demos/blob/main/";

export const MIRROR_TOOLTIP = "Rewritten from the repo file after each merge to main. Edit the file, not this copy.";

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function sourcePathOf(record) {
  const p = record && record.sourcePath;
  return typeof p === "string" && p.trim() ? p.trim() : "";
}

// A record is a mirror when a sync wrote it from a repo file.
export function isMirror(record) {
  return sourcePathOf(record) !== "";
}

// The GitHub page of a repo-root-relative path on main; null for anything
// that is not one (absolute path, "..", a URL), so a bad value never becomes
// a link.
export function repoFileUrl(path) {
  if (typeof path !== "string") return null;
  const p = path.trim();
  if (!p || p.startsWith("/") || p.includes("\\") || /^[a-z][a-z0-9+.-]*:/i.test(p)) return null;
  const segments = p.split("/");
  if (segments.some((s) => s === ".." || s === "." || s === "")) return null;
  return REPO_BLOB_BASE + segments.map(encodeURIComponent).join("/");
}

export function mirrorChipHTML(record) {
  const path = sourcePathOf(record);
  if (!path) return "";
  const err = record && typeof record.syncError === "string" ? record.syncError.trim() : "";
  const bad = err ? " mirror-chip-error" : "";
  const icon = err ? "sync_problem" : "sync";
  const tip = err ? `Last sync failed: ${err}` : MIRROR_TOOLTIP;
  return `<span class="mirror-chip${bad}" title="${esc(tip)}"><span class="material-symbols-outlined mirror-chip-icon">${icon}</span>Mirror of ${esc(path)}</span>` +
    (err ? `<span class="mirror-sync-error">${esc(err)}</span>` : "");
}

// The "Open in GitHub" link that replaces the Edit pencil on a mirror.
export function openInGithubHTML(record) {
  const url = repoFileUrl(sourcePathOf(record));
  if (!url) return "";
  return `<a class="icon-btn mirror-open-link" href="${esc(url)}" target="_blank" rel="noopener" title="Open in GitHub" aria-label="Open in GitHub"><span class="material-symbols-outlined">open_in_new</span></a>`;
}

export function startHereChipHTML() {
  return '<span class="docs-start-chip"><span class="material-symbols-outlined mirror-chip-icon">flag</span>Start here</span>';
}

function statusChipHTML(d) {
  const s = typeof d.status === "string" ? d.status.trim() : "";
  if (!s || s === "current" || s === "superseded") return "";
  return `<span class="docs-status-chip">${esc(s)}</span>`;
}

export function projectDocRowHTML(d, opts = {}) {
  const mirror = isMirror(d);
  const preview = d.contentMd
    ? `<div class="interface-row-content">${esc(d.contentMd)}</div>`
    : `<p class="interface-row-empty" style="margin:8px 0 0;">No content written yet.</p>`;
  const note = opts.showNote && typeof d.statusNote === "string" && d.statusNote.trim()
    ? `<p class="docs-status-note">${esc(d.statusNote.trim())}</p>` : "";
  const id = esc(d.id);
  const edit = mirror
    ? openInGithubHTML(d)
    : `<button type="button" class="icon-btn doc-edit-btn" data-id="${id}" title="Edit">&#9998;</button>`;
  return `
    <div class="interface-row${opts.startHere ? " docs-start-row" : ""}" data-id="${id}">
      <div class="interface-row-top">
        <div>
          <div class="interface-row-title">${opts.startHere ? '<span class="material-symbols-outlined docs-start-icon">flag</span>' : ""}${esc(d.name)}</div>
          <div class="docs-row-chips">${opts.startHere ? startHereChipHTML() : ""}${statusChipHTML(d)}${mirrorChipHTML(d)}</div>
        </div>
        <div class="interface-row-actions">
          ${edit}
          <button type="button" class="icon-btn doc-delete-btn" data-id="${id}" title="Remove">&times;</button>
        </div>
      </div>
      ${note}
      ${preview}
    </div>`;
}

// Edit pencil (or, on a mirror, the GitHub link) and Remove for an interface
// row; the caller supplies the title/with line.
export function interfaceActionsHTML(f, anchorId) {
  const edit = isMirror(f)
    ? openInGithubHTML(f)
    : `<button type="button" class="icon-btn interface-edit-btn" data-id="${esc(f.id)}" data-anchor-id="${esc(anchorId)}" title="Edit">&#9998;</button>`;
  return `${edit}<button type="button" class="icon-btn interface-delete-btn" data-id="${esc(f.id)}" title="Remove">&times;</button>`;
}

// {startHere, current, superseded}. `docs` is a project's documents;
// `project.startHereDocId` pins one of them first (a value naming no doc in
// the list, such as "readme" or another project's doc, pins nothing). The
// rest sort by name, numeric-aware so "(2/7)" precedes "(10/7)". A
// superseded doc goes to the folded list unless it is the start doc.
export function orderProjectDocs(docs, project) {
  const list = (docs || []).filter((d) => !(project && project.id && d.projectId && d.projectId !== project.id));
  const pin = project && project.startHereDocId;
  const byName = (a, b) => String(a.name || "").localeCompare(String(b.name || ""), undefined, { numeric: true });
  const startHere = pin ? list.find((d) => d.id === pin) || null : null;
  const rest = list.filter((d) => d !== startHere).sort(byName);
  return {
    startHere,
    current: rest.filter((d) => d.status !== "superseded"),
    superseded: rest.filter((d) => d.status === "superseded"),
  };
}

// Text shown instead of saving a copy; null when `record` is not a mirror.
export function mirrorEditRefusal(record) {
  const path = sourcePathOf(record);
  if (!path) return null;
  const name = (record && record.name) || "This document";
  return `${name} is a copy of ${path} in the repo. Edit that file; this copy is rewritten from it after the next merge to main.`;
}

export function mirrorDeleteWarning(record) {
  return `This document mirrors ${sourcePathOf(record)}. Deleting it does not change the repo, and the next docs sync will report it missing until it is taken off the project's mirror list. Delete anyway?`;
}
