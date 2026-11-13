// Pure helpers for faq-sync.js (repo faq/data -> Firestore), kept apart from
// the script itself so they can be tested without firebase-admin.
//
// The sync stores, on every document it writes, `contentHash`: a hash of the
// live fields it wrote. That makes "has anyone changed this document's live
// content since the last sync?" a question with an exact answer: hash the
// live fields the document holds NOW and compare. Before 13 Nov 2026 the
// script answered it from `updatedAt > syncedAt` alone, and every write that
// bumps `updatedAt` without touching live content counted as an edit:
// parking a pendingRevision (MCP `propose_faq_revision`, the Deploy flow's
// FAQ impact review, the Release Audit), rejecting one, rejecting a retire
// proposal. On 13 Nov 2026 four published articles had a pending revision
// and none of them could be fixed from the repo any more — the copy fix
// for "Benefits by industry" would have been reported as a conflict and
// skipped, and the next hourly export would have put the old text back.
"use strict";

const crypto = require("crypto");

const hash = (s) => crypto.createHash("sha256").update(s).digest("hex").slice(0, 16);
const toMillis = (v) => (v && typeof v.toMillis === "function" ? v.toMillis() : v ? new Date(v).getTime() : 0);

const SEO_FIELDS = ["seoTitle", "metaDescription", "directAnswer", "questionVariants", "articleType"];

// The SEO & agent fields that are set (empty strings and empty arrays are
// "not set"), in their fixed order. Only hashed when at least one is set, so
// articles without them keep the hash they always had.
function seoFieldsOf(a) {
  const seo = {};
  for (const k of SEO_FIELDS) {
    const v = a[k];
    if (v && !(Array.isArray(v) && !v.length)) seo[k] = v;
  }
  return seo;
}

// The sync hash of an article's live fields. Works on a faq/data file and on
// a Firestore document alike (same field names).
function articleSyncHash(a) {
  const seo = seoFieldsOf(a);
  return hash(
    (a.bodyMd || "") + "|" +
    JSON.stringify([a.categoryId, a.order, a.title, a.slug, a.summary, a.keywords, a.docType, a.status]) +
    (Object.keys(seo).length ? "|" + JSON.stringify(seo) : "")
  );
}

const categorySyncHash = (c) => hash(JSON.stringify([c.name, c.icon, c.description || "", c.order, c.parentId || null]));

// True when the Firestore document `d` was changed in the console after the
// last sync, so the repo copy must not overwrite it. `liveHash` is the sync
// hash of the live fields `d` holds now. A document whose live content still
// hashes to the contentHash the last sync stored has not been edited live,
// whatever its updatedAt says; anything else falls back to the timestamp
// rule (no syncedAt yet: compare with createdAt — XFeVboxWduEPT2zGcj8y).
function editedSinceSync(d, liveHash) {
  if (!d) return false;
  if (d.contentHash && d.syncedAt && liveHash === d.contentHash) return false;
  return toMillis(d.updatedAt) > toMillis(d.syncedAt || d.createdAt) + 1000;
}

module.exports = { hash, toMillis, seoFieldsOf, articleSyncHash, categorySyncHash, editedSinceSync, SEO_FIELDS };
