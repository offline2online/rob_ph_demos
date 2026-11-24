// Pure helpers for Support › Documentation (documentation-page.js): the
// section tree, search and filters. No DOM and no Firebase, so tests run them
// in Node (test/documentation-page.test.mjs).
export const orderOf = (d) => (Number.isFinite(Number(d && d.order)) ? Number(d.order) : 0);
export const byOrder = (a, b) => orderOf(a) - orderOf(b) || String(a.name || a.title || "").localeCompare(String(b.name || b.title || ""));
export const DOC_TYPE_LABEL = { faq: "FAQ", "how-to": "How-to", reference: "Reference", explanation: "Explanation" };
export const DOC_SECTION_ICONS = ["menu_book", "map", "integration_instructions", "article", "install_desktop", "storage", "build", "security", "monitoring", "api", "description", "folder", "inventory_2", "rocket_launch", "insights", "support_agent"];

// Pure helpers, exported for tests.
export function childrenOf(cats, parentId) {
  return cats.filter((c) => (c.parentId || null) === (parentId || null)).slice().sort(byOrder);
}
export function descendantIds(cats, id) {
  const out = [id];
  for (const c of childrenOf(cats, id)) out.push(...descendantIds(cats, c.id));
  return out;
}
export function pathOf(cats, id) {
  const byId = new Map(cats.map((c) => [c.id, c]));
  const path = [];
  const seen = new Set();
  let c = byId.get(id);
  while (c && !seen.has(c.id)) { seen.add(c.id); path.unshift(c); c = c.parentId ? byId.get(c.parentId) : null; }
  return path;
}
export function plainText(html) {
  return String(html || "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\s+/g, " ").trim();
}
export function matchesFilter(a, filter) {
  if (filter === "draft") return a.status === "draft";
  if (filter === "published") return a.status === "published";
  if (filter === "needs-review") return !!a.needsReview;
  return true;
}
// Every word of the query must appear somewhere; titles rank first.
export function searchDocs(arts, q, textOf) {
  const words = String(q || "").toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const scored = [];
  for (const a of arts) {
    const title = String(a.title || "").toLowerCase();
    const meta = `${a.summary || ""} ${(a.keywords || []).join(" ")}`.toLowerCase();
    const body = textOf(a);
    let score = 0, ok = true;
    for (const w of words) {
      if (title.includes(w)) score += 10;
      else if (meta.includes(w)) score += 4;
      else if (body.includes(w)) score += 1;
      else { ok = false; break; }
    }
    if (ok) scored.push({ a, score });
  }
  return scored.sort((x, y) => y.score - x.score || byOrder(x.a, y.a)).map((x) => x.a);
}
// A short excerpt around the first match, for search results.
export function snippetFor(text, q) {
  const words = String(q || "").toLowerCase().split(/\s+/).filter(Boolean);
  const lower = text.toLowerCase();
  let at = -1;
  for (const w of words) { at = lower.indexOf(w); if (at >= 0) break; }
  if (at < 0) return text.slice(0, 160);
  const start = Math.max(0, at - 60);
  return (start > 0 ? "…" : "") + text.slice(start, start + 180) + (start + 180 < text.length ? "…" : "");
}


// What the read-only document reader (#doc/<id>) shows above the body: where
// the document sits, its type, when it was last changed, its state badges and
// where it came from. `updatedAt` is a Firestore Timestamp, a Date or millis.
const DATE_FMT = { day: "numeric", month: "short", year: "numeric" };
export function readerDate(v) {
  if (!v) return "";
  const d = typeof v.toDate === "function" ? v.toDate() : v instanceof Date ? v : Number.isFinite(Number(v)) ? new Date(Number(v)) : null;
  return d && !Number.isNaN(d.getTime()) ? d.toLocaleDateString("en-GB", DATE_FMT) : "";
}
export function docReaderInfo(a, cats) {
  const src = (a && a.source) || {};
  const path = pathOf(cats || [], a && a.categoryId).map((c) => c.name || "(untitled)");
  const badges = [];
  if (a && a.status === "draft") badges.push({ label: "Draft", cls: "badge-status-draft" });
  if (a && a.needsReview) badges.push({ label: "Needs review", cls: "badge-needs-review" });
  if (src.archived || path[0] === "Archive") badges.push({ label: "Archived", cls: "badge-archived" });
  const updated = readerDate(a && a.updatedAt);
  return {
    path,
    typeLabel: (a && DOC_TYPE_LABEL[a.docType]) || "",
    updated: updated ? `Updated ${updated}` : "",
    badges,
    source: src.system === "confluence" || src.path || src.lastUpdated
      ? `Carried over from Confluence${src.path ? ` (${src.path})` : ""}${src.lastUpdated ? `, last updated there ${src.lastUpdated}` : ""}.`
      : "",
  };
}
