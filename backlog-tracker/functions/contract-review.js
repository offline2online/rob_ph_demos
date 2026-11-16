"use strict";

// Contract-change review flags (ZmEWDC40NYOiojehfPjk, 16 Nov 2026).
//
// When a ticket's build lands on its train and that commit changes an
// interface contract, every open ticket that builds after it
// (dependsOnItemIds names it) is flagged "Needs review: upstream contract
// changed" with a summary of what changed. The upstream ticket's session
// never edits the dependent: the dependent's OWN next build session reads the
// flag (its fire text carries contractReviewBlock) and updates that ticket as
// needed, and the flag clears when the dependent's own patch lands.
//
// What counts as a contract change is a change to one of these repo files:
//   - shared/interface-contract.md (the maintained contract between the two
//     DSP-side projects, root CLAUDE.md);
//   - shared/board-interfaces.json (the manifest that copies repo files to the
//     board's interfaces records);
//   - any file that manifest lists (its interfaces[].path).
// An edit made straight to an interfaces record on the board belongs to no
// ticket's build, so it flags nothing here.
//
// Pure functions only (git and Firestore stay in run-backlog-automation.js),
// so test/contract-review.test.js drives them directly.

const BASE_CONTRACT_PATHS = Object.freeze(["shared/interface-contract.md", "shared/board-interfaces.json"]);
const CONTRACT_MANIFEST_PATH = "shared/board-interfaces.json";
const NEEDS_REVIEW = "needs-review";
// A dependent past these (shipped, archived) keeps no flag: nothing would act on it.
const FLAGGABLE_STATUSES = Object.freeze(["backlog", "ready-for-testing", "ready-to-publish"]);
const SUMMARY_MAX = 600;

function cleanPath(p) {
  return typeof p === "string" ? p.trim().replace(/^\.?\/+/, "") : "";
}

// Every repo path that counts as a contract, given the manifest's text (or
// parsed object). A manifest that doesn't parse leaves the base list.
function contractPathsFrom(manifest) {
  const out = new Set(BASE_CONTRACT_PATHS);
  let m = manifest;
  if (typeof m === "string") {
    try { m = JSON.parse(m); } catch { m = null; }
  }
  const list = m && Array.isArray(m.interfaces) ? m.interfaces : [];
  for (const entry of list) {
    const p = cleanPath(entry && entry.path);
    if (p && !p.includes("..")) out.add(p);
  }
  return [...out];
}

// The changed paths that are contracts, in contract order.
function contractFilesIn(changedPaths, contractPaths) {
  const changed = new Set((changedPaths || []).map(cleanPath).filter(Boolean));
  return (contractPaths || []).filter((p) => changed.has(p));
}

// `git diff -U0` text → [{ oldStart, oldCount, newStart, newCount }].
function parseHunks(diffText) {
  const out = [];
  const re = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gm;
  let m;
  while ((m = re.exec(String(diffText || "")))) {
    out.push({
      oldStart: Number(m[1]), oldCount: m[2] == null ? 1 : Number(m[2]),
      newStart: Number(m[3]), newCount: m[4] == null ? 1 : Number(m[4]),
    });
  }
  return out;
}

// The Markdown headings (text, without the #s) the hunks fall under, in the
// file's own order and once each. `text` is the file AFTER the change; a hunk
// that only deletes lines is placed at its newStart, which is the line it was
// removed after.
function sectionsTouched(text, hunks) {
  const lines = String(text || "").split("\n");
  const headingAt = [];
  let inFence = false;
  let current = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    const h = !inFence && /^#{1,6}\s+(.+?)\s*#*\s*$/.exec(line);
    if (h) current = h[1].trim();
    headingAt[i + 1] = current; // 1-based, as git numbers lines
  }
  const seen = new Set();
  const out = [];
  for (const hk of hunks || []) {
    const from = Math.max(1, hk.newStart || 1);
    const to = Math.max(from, from + Math.max(0, (hk.newCount || 0) - 1));
    for (let n = from; n <= Math.min(to, lines.length); n++) {
      const s = headingAt[n];
      if (s && !seen.has(s)) { seen.add(s); out.push(s); }
    }
  }
  return out;
}

// files: [{ path, added, removed, sections }] → one line for the card.
function summariseContractChange(files) {
  const parts = (files || []).map((f) => {
    const counts = `+${Number(f.added) || 0} −${Number(f.removed) || 0}`;
    const sections = Array.isArray(f.sections) && f.sections.length ? `; sections: ${f.sections.slice(0, 6).join(", ")}${f.sections.length > 6 ? `, and ${f.sections.length - 6} more` : ""}` : "";
    return `${f.path} (${counts}${sections})`;
  });
  const s = parts.join("; ");
  return s.length > SUMMARY_MAX ? `${s.slice(0, SUMMARY_MAX - 1)}…` : s;
}

// The record written on each dependent: backlogItems/{id}.contractReview.
function contractReviewRecord({ upstream, commit, files, summary, now = new Date() }) {
  return {
    status: NEEDS_REVIEW,
    upstreamItemId: upstream && upstream.id ? String(upstream.id) : null,
    upstreamTitle: upstream && upstream.title ? String(upstream.title).slice(0, 200) : null,
    commit: commit ? String(commit) : null,
    files: (files || []).map((f) => (typeof f === "string" ? f : f.path)).filter(Boolean).slice(0, 20),
    summary: String(summary || "").slice(0, SUMMARY_MAX),
    flaggedAt: now instanceof Date ? now.toISOString() : String(now),
  };
}

function needsContractReview(item) {
  return !!(item && item.contractReview && item.contractReview.status === NEEDS_REVIEW);
}

// The tickets to flag: open, naming the upstream ticket as a dependency, and
// never the upstream ticket itself.
function dependentsToFlag(candidates, upstreamId) {
  return (candidates || []).filter((w) => w && w.id && w.id !== upstreamId
    && Array.isArray(w.dependsOnItemIds) && w.dependsOnItemIds.includes(upstreamId)
    && FLAGGABLE_STATUSES.includes(w.status || "backlog"));
}

function dependentNote(record) {
  const commit = record.commit ? ` (commit ${record.commit.slice(0, 7)})` : "";
  return `Needs review: upstream contract changed. "${record.upstreamTitle || record.upstreamItemId}", which this ticket builds after, changed an interface contract when it landed${commit}: ${record.summary}. ` +
    "This ticket was not edited. Its own next build session reads the change and updates it as needed; the flag clears when that build's patch lands.";
}

function upstreamNote(flagged, summary) {
  const list = (flagged || []).map((w) => `"${w.title || w.id}"`).join(", ");
  return `This build changed an interface contract (${summary}). Flagged ${flagged.length} dependent ticket${flagged.length === 1 ? "" : "s"} for review: ${list}. They were not edited; each is reviewed by its own build session.`;
}

// The block a dependent's build fire carries while it is flagged.
function contractReviewBlock(item) {
  if (!needsContractReview(item)) return "";
  const r = item.contractReview;
  return "\n\n=== UPSTREAM CONTRACT CHANGED: REVIEW THIS TICKET ===\n" +
    `"${r.upstreamTitle || r.upstreamItemId}" (ticket ${r.upstreamItemId}), which this ticket builds after, changed an interface contract when it landed${r.commit ? ` as commit ${r.commit}` : ""}.\n` +
    `What changed: ${r.summary}\n` +
    "Before building, read that change (git show <commit> -- <files>) and the contract as it is now. Update THIS ticket's work (and, if its scope moved, its description) to match the new contract. " +
    "Do not edit the upstream ticket or any other ticket. The flag clears when this ticket's patch lands; say in your [build] note what you changed because of it, or why nothing needed to change. ROUTINE_INSTRUCTIONS.md → \"Owner scoping and upstream contract changes\".\n" +
    "=== END UPSTREAM CONTRACT CHANGED ===";
}

module.exports = {
  BASE_CONTRACT_PATHS, CONTRACT_MANIFEST_PATH, NEEDS_REVIEW, FLAGGABLE_STATUSES,
  contractPathsFrom, contractFilesIn, parseHunks, sectionsTouched, summariseContractChange,
  contractReviewRecord, needsContractReview, dependentsToFlag, dependentNote, upstreamNote, contractReviewBlock,
};
