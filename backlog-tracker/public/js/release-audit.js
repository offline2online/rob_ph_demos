// Release audit view logic — pure, so it is unit-tested without a browser
// (test/release-audit.test.mjs). The audit is what the Routine leaves behind
// after a release goes Live on AWS Marketplace:
//   - an article with pendingRevision.sourceReleaseId === releaseId, !isNew  → "update"
//   - the same with isNew (a draft article the Routine created)              → "new"
//   - an article with retireProposal.sourceReleaseId === releaseId           → "retire"
// functions/release-audit.js carries the matching log-entry shape.

export const AUDIT_KIND_LABELS = { update: "Proposed updates", new: "New articles", retire: "Articles to retire" };
export const AUDIT_LOG_LABELS = {
  "audit-requested": "Audit requested",
  "audit-started": "Audit started",
  "audit-finished": "Audit finished",
  "audit-failed": "Audit failed",
  approved: "Approved",
  rejected: "Rejected",
  edited: "Edited",
  "retire-approved": "Retirement approved",
  "retire-rejected": "Retirement rejected",
  "went-live": "Went live",
};

// -> [{kind, article, state, reason}] ordered update, new, retire then title.
// state: "awaiting-review" | "approved" (a retirement can also be "rejected",
// which drops out of the batch — a rejection is only kept in the log).
export function classifyAudit(articles, releaseId) {
  const rows = [];
  for (const a of articles || []) {
    if (!a) continue;
    const rev = a.pendingRevision;
    if (rev && rev.sourceReleaseId === releaseId) {
      rows.push({ kind: rev.isNew ? "new" : "update", article: a, state: rev.reviewStatus === "approved" ? "approved" : "awaiting-review", reason: rev.reason || "" });
    }
    const ret = a.retireProposal;
    if (ret && ret.sourceReleaseId === releaseId && ret.reviewStatus !== "rejected") {
      rows.push({ kind: "retire", article: a, state: ret.reviewStatus === "approved" ? "approved" : "awaiting-review", reason: ret.reason || "" });
    }
  }
  const order = { update: 0, new: 1, retire: 2 };
  return rows.sort((x, y) => order[x.kind] - order[y.kind] || String(x.article.title || "").localeCompare(String(y.article.title || "")));
}

export function auditCounts(rows) {
  const c = { update: 0, new: 0, retire: 0, awaiting: 0 };
  for (const r of rows) { c[r.kind] += 1; if (r.state === "awaiting-review") c.awaiting += 1; }
  return c;
}

// A log entry's time as a sortable ms value; tolerant of ISO strings,
// Firestore timestamps and Dates.
export function logTimeMs(e) {
  const v = e && e.at;
  if (!v) return 0;
  if (typeof v.toMillis === "function") return v.toMillis();
  const ms = v instanceof Date ? v.getTime() : Date.parse(String(v));
  return Number.isFinite(ms) ? ms : 0;
}

export function sortedLog(audit) {
  return (audit && Array.isArray(audit.log) ? audit.log.slice() : []).sort((a, b) => logTimeMs(a) - logTimeMs(b));
}

// The log line the console appends when a reviewer acts. Mirrors
// functions/release-audit.js auditLogEntry (same fields).
export function reviewLogEntry({ type, by, articleId, title, note, at }) {
  return { type, by: by || "editor", articleId: articleId || null, title: title ? String(title).slice(0, 200) : null, note: note ? String(note).slice(0, 500) : null, at: at || new Date().toISOString() };
}
