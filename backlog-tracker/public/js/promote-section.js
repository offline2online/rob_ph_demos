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
// Leads (leads-page.js) is the second entry: a board of its own, not a document page.
// Prospects (TAM) (prospects-page.js) is the third, directly below Leads: an AG Grid.
// Conversion Funnel (funnel-page.js) is the fourth, directly below Prospects.

export const PROMOTE_PAGES = [
  { key: "brand-guidelines", label: "Brand Guidelines", icon: "palette", navId: "promote-brand-btn",
    docs: { guidelines: "brand-guidelines", requirements: "brand-requirements" } },
  { key: "leads", label: "Leads", icon: "group", navId: "promote-leads-btn", docs: {} },
  { key: "prospects", label: "Prospects (TAM)", icon: "travel_explore", navId: "promote-prospects-btn", docs: {} },
  { key: "conversion-funnel", label: "Conversion Funnel", icon: "filter_alt", navId: "promote-funnel-btn", docs: {} },
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

// Brand Guidelines is a team-facing look-and-feel document. Sections the repo
// file wraps in agent-only markers are for agents (read over MCP in full) and
// are dropped from what the page shows. An unclosed start drops the rest.
export function teamFacingMd(md) {
  const out = [];
  let hidden = false;
  for (const line of String(md || "").split("\n")) {
    const t = line.trim();
    if (t === "<!-- agent-only:start -->") { hidden = true; continue; }
    if (t === "<!-- agent-only:end -->") { hidden = false; continue; }
    if (!hidden) out.push(line);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

// The visual header of the Brand Guidelines page: the four logo bars, the
// umbrella line, the palette and the type specimen. Static brand facts (the
// colours are the real brand palette in brand-guidelines.md).
export const BRAND_PALETTE = [
  { name: "Teal", hex: "#169BC2" }, { name: "Pink", hex: "#EF60A7" },
  { name: "Orange", hex: "#FE9226" }, { name: "Green", hex: "#60D838" },
  { name: "Wordmark grey", hex: "#7B7B7B" },
];
export const BRAND_UMBRELLA = "Make every store visit worth more";
export function brandHeaderHtml() {
  const bars = BRAND_PALETTE.slice(0, 4).map((c) => `<span class="brand-bar" style="background:${c.hex}"></span>`).join("");
  const swatches = BRAND_PALETTE.map((c) => `<li class="brand-swatch"><span class="brand-chip" style="background:${c.hex}"></span><span class="brand-swatch-name">${c.name}</span><code>${c.hex}</code></li>`).join("");
  return `<div class="brand-bars" aria-hidden="true">${bars}</div>`
    + `<p class="brand-umbrella">${BRAND_UMBRELLA}</p>`
    + `<ul class="brand-palette" aria-label="Brand palette">${swatches}</ul>`
    + `<div class="brand-type"><span class="brand-type-name">Kantumruy Pro</span><span class="brand-type-sample">Aa Bb Cc 0123</span></div>`;
}
