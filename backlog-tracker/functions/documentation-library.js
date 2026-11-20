// Support › Documentation (the internal docs library that replaced Confluence)
// as the server sees it: the section a document sits in, whether it is
// archived, and its body as Markdown. Shared by the MCP read tools
// (list_documentation / get_documentation in mcp-server.js) and the PH Agent
// Context index (functions/context, source "documentation"), so a search hit
// and a read of the same document always agree.
//
// Data: `docCategories` (sections and folders, nested through parentId) and
// `docArticles` (the documents, bodyMd holding the editor's rich-text HTML).
// Members only (firestore.rules); nothing here is public. README.md →
// "Documentation — the internal docs library".
"use strict";

const { htmlToMarkdown } = require("./html-to-md");

const ARCHIVE_ROOT = "sec-archive";   // the Archive section the migration created
const SEP = " › ";

const str = (v) => (typeof v === "string" ? v : "");
const orderOf = (d) => (Number.isFinite(Number(d && d.order)) ? Number(d.order) : 0);

// cats: Map id -> {name, parentId} (or an array of {id, name, parentId}).
const asMap = (cats) => (cats instanceof Map ? cats : new Map((cats || []).map((c) => [c.id, c])));

// The sections from the top down to `id`, as [{id, name}]. Stops at a loop.
function trailOf(cats, id) {
  const byId = asMap(cats);
  const out = [];
  const seen = new Set();
  let cur = id ? byId.get(id) : null;
  let curId = id;
  while (cur && !seen.has(curId)) {
    seen.add(curId);
    out.unshift({ id: curId, name: str(cur.name) || curId });
    curId = cur.parentId || null;
    cur = curId ? byId.get(curId) : null;
  }
  return out;
}
const locationOf = (cats, id) => trailOf(cats, id).map((c) => c.name).join(SEP);

// Every section id under `id`, itself included.
function subtreeIds(cats, id) {
  const byId = asMap(cats);
  const kids = new Map();
  for (const [cid, c] of byId) {
    const p = (c && c.parentId) || null;
    if (!kids.has(p)) kids.set(p, []);
    kids.get(p).push(cid);
  }
  const out = [];
  const stack = [id];
  const seen = new Set();
  while (stack.length) {
    const cur = stack.pop();
    if (seen.has(cur)) continue;
    seen.add(cur);
    out.push(cur);
    for (const k of kids.get(cur) || []) stack.push(k);
  }
  return out;
}

// Archived: kept for the record. A document carried over from an archived
// Confluence page, or one filed anywhere under the Archive section.
function isArchived(cats, d) {
  if (d && d.source && d.source.archived === true) return true;
  const top = trailOf(cats, d && d.categoryId)[0];
  return Boolean(top && (top.id === ARCHIVE_ROOT || /^archive$/i.test(top.name)));
}

// The body as Markdown (the editor stores HTML; a document typed as Markdown
// is returned unchanged).
const bodyMarkdown = (d) => htmlToMarkdown(str(d && d.bodyMd));

// The Markdown with link and image targets dropped, for the search index: a
// Storage URL's token or a long Confluence link is not something anyone
// searches for, and it would only dilute the words that are.
function searchableText(md) {
  return String(md || "")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");
}

// Where a document came from, when it was migrated (Confluence page id,
// space, original path, last updated there, archived).
function sourceOf(d) {
  const s = d && d.source && typeof d.source === "object" ? d.source : null;
  if (!s) return null;
  return {
    system: str(s.system) || null, pageId: str(s.pageId) || null, space: str(s.space) || null,
    path: str(s.path) || null, lastUpdated: str(s.lastUpdated) || null, archived: s.archived === true,
    url: str(s.url) || null,
  };
}

module.exports = { ARCHIVE_ROOT, SEP, orderOf, trailOf, locationOf, subtreeIds, isArchived, bodyMarkdown, searchableText, sourceOf };
