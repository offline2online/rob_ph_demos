// Promote section of the console: the sub-pages it holds, their routes, and
// how a page finds the board documents it shows. Pure functions only (no DOM,
// no Firestore) so test/promote-section.test.mjs can drive them; app.js owns
// the rendering.
//
// Brand Guidelines shows two board documents that mirror repo files
// (backlog-tracker/promote/*.md, declared in backlog-tracker/board-docs.json,
// copied to `projectDocs` on every merge to main). They carry a `mirrorKey`,
// which is what a page looks them up by. Agents read the same documents over
// MCP with list_project_documents / get_project_document.
//
// A later "Leads" page adds one entry to PROMOTE_PAGES beneath Brand Guidelines.

export const PROMOTE_PAGES = [
  { key: "brand-guidelines", label: "Brand Guidelines", icon: "palette", navId: "promote-brand-btn",
    docs: { guidelines: "brand-guidelines", requirements: "brand-requirements" } },
];
export const DEFAULT_PROMOTE_PAGE = PROMOTE_PAGES[0].key;

// "#promote" and "#promote/<page>" -> the page key, or null when the hash is
// not a Promote route. An unknown sub-page falls back to the first one.
export function promotePageFromHash(hash) {
  const h = String(hash || "").split("?")[0];
  if (h === "#promote") return DEFAULT_PROMOTE_PAGE;
  if (!h.startsWith("#promote/")) return null;
  const key = h.slice("#promote/".length);
  return PROMOTE_PAGES.some((p) => p.key === key) ? key : DEFAULT_PROMOTE_PAGE;
}
export function promoteHash(key) { return `#promote/${key}`; }

// The sidebar button that is "you are here" for a Promote route, or null.
export function promoteNavId(hash) {
  const key = promotePageFromHash(hash);
  const page = key && PROMOTE_PAGES.find((p) => p.key === key);
  return page ? page.navId : null;
}

// The text of a mirrored document without the "Copy of <file>…" line the sync
// puts at the top (it tells a document editor where the text comes from, which
// is noise on a page whose job is to be read).
export function mirrorBody(doc) {
  const text = String((doc && doc.contentMd) || "");
  const prefix = String((doc && doc.sourcePrefix) || "");
  return prefix && text.startsWith(prefix) ? text.slice(prefix.length) : text;
}

// { guidelines, requirements } -> the matching document bodies from the
// projectDocs rows (null for one not yet copied to the board).
export function promoteDocsFor(pageKey, projectDocs) {
  const page = PROMOTE_PAGES.find((p) => p.key === pageKey);
  const out = {};
  for (const [slot, mirrorKey] of Object.entries(page ? page.docs : {})) {
    const d = (projectDocs || []).find((x) => x && x.mirrorKey === mirrorKey);
    out[slot] = d ? { id: d.id, name: d.name || "", body: mirrorBody(d), sourcePath: d.sourcePath || "" } : null;
  }
  return out;
}
