// The release audit: when an admin marks a release "Live on AWS Marketplace"
// (releases/{id}.status === "live"), the Help Centre is audited ONCE against
// what shipped. Pure helpers shared by index.js's trigger and the tests; the
// console has its own copy of the classification in public/js/release-audit.js
// (separate deployables, no shared module — keep both in step).
//
// Collections touched (see REQUIREMENTS.md → "Release audit"):
//   releaseAudits/{releaseId}   the audit's record and log
//   faqArticles/{id}.pendingRevision   {…, sourceReleaseId}  updates + new drafts
//   faqArticles/{id}.retireProposal    {reason, sourceReleaseId, reviewStatus}
"use strict";

const LOG_TYPES = new Set([
  "audit-requested", "audit-started", "audit-finished", "audit-failed",
  "approved", "rejected", "edited", "retire-approved", "retire-rejected", "went-live",
]);

// One audit-log line. Kept small and flat so arrayUnion can append it.
function auditLogEntry({ type, by, articleId = null, title = null, note = null, at }) {
  if (!LOG_TYPES.has(type)) throw new Error(`unknown audit log type: ${type}`);
  return {
    type,
    by: by || "system",
    articleId: articleId || null,
    title: title ? String(title).slice(0, 200) : null,
    note: note ? String(note).slice(0, 500) : null,
    at: at || new Date().toISOString(),
  };
}

// The fire text for the Routine. Data only — the "how" is ROUTINE_INSTRUCTIONS.md
// → "The 'Release Audit' flow", which the Routine's bootstrap fetches.
function buildAuditRequestText({ releaseId, release, projects, requestedByEmail }) {
  const name = (release && release.name) || "(unnamed release)";
  const version = release && release.version ? ` (${release.version})` : "";
  const lines = (projects || []).map((p) =>
    `- ${p.name || "(unnamed)"} (projectId: ${p.id}${p.programId ? `, programId: ${p.programId}` : ""})`);
  return `=== RELEASE AUDIT REQUEST for "${name}${version}" (releaseId: ${releaseId}) on the Backlog Tracker & FAQs board ===\n` +
    `Release status: Live on AWS Marketplace${requestedByEmail ? ` — marked by ${requestedByEmail}` : ""}.\n` +
    `Projects in this release (${lines.length}):\n${lines.length ? lines.join("\n") : "- (none assigned — audit against the release's own name, version and notes only)"}\n\n` +
    `Audit the whole Help Centre against what shipped. Follow ROUTINE_INSTRUCTIONS.md's "Release Audit" flow section exactly. ` +
    `Record progress on releaseAudits/${releaseId}.`;
}

module.exports = { LOG_TYPES, auditLogEntry, buildAuditRequestText };
