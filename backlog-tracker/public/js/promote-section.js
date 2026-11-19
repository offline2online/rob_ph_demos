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
// Brand Guidelines also lists its Partners and Markets subsections: one page
// per brand-partner-<slug> / brand-market-<slug> mirror, so a new one is a file
// and a manifest entry, never a code change.
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
// not a Promote route. An unknown sub-page falls back to the first one. A
// partner page ("#promote/brand-guidelines/partners/<slug>") and a market
// page ("#promote/brand-guidelines/markets/<slug>") are part of Brand Guidelines.
export function promotePageFromHash(hash) {
  const h = String(hash || "").split("?")[0];
  if (h === "#promote") return DEFAULT_PROMOTE_PAGE;
  if (!h.startsWith("#promote/")) return null;
  const key = h.slice("#promote/".length);
  if (key.startsWith(PARTNER_ROUTE)) return "brand-guidelines";
  if (key.startsWith(MARKET_ROUTE)) return "brand-guidelines";
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

// ── Partners (co-branding) under Brand Guidelines ─────────────────────────
// One page per partner, each a repo file backlog-tracker/promote/partners/
// <slug>.md declared in board-docs.json with the mirror key
// "brand-partner-<slug>". The page lists whatever partner mirrors exist, so a
// second partner is a new file and a manifest entry, never a code change.
// Agents read the same documents over MCP (get_project_document).
export const PARTNER_MIRROR_PREFIX = "brand-partner-";
const PARTNER_ROUTE = "brand-guidelines/partners/";
export function partnerHash(slug) { return `#promote/${PARTNER_ROUTE}${encodeURIComponent(slug)}`; }
// "#promote/brand-guidelines/partners/<slug>" -> slug, else null.
export function promotePartnerFromHash(hash) {
  const h = String(hash || "").split("?")[0];
  const pre = `#promote/${PARTNER_ROUTE}`;
  if (!h.startsWith(pre)) return null;
  const slug = decodeURIComponent(h.slice(pre.length)).split("/")[0];
  return /^[a-z0-9-]+$/.test(slug) ? slug : null;
}

// The "<!-- partner ... -->" block at the top of a partner file: one
// "key: value" per line (name, industry, summary, industryUrl, logoLight,
// logoDark). Returns { meta, body } with the block removed from the body.
export function parsePartnerDoc(md) {
  const text = String(md || "");
  const m = text.match(/^\s*<!--\s*partner\s*\n([\s\S]*?)-->\s*\n?/);
  const meta = {};
  if (m) {
    for (const line of m[1].split("\n")) {
      const i = line.indexOf(":");
      if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    }
  }
  return { meta, body: m ? text.slice(m[0].length) : text };
}

// projectDocs rows -> the partner pages, sorted by name.
export function partnersFrom(projectDocs) {
  return (projectDocs || [])
    .filter((d) => d && typeof d.mirrorKey === "string" && d.mirrorKey.startsWith(PARTNER_MIRROR_PREFIX) && d.status !== "superseded")
    .map((d) => {
      const slug = d.mirrorKey.slice(PARTNER_MIRROR_PREFIX.length);
      const { meta, body } = parsePartnerDoc(mirrorBody(d));
      return { id: d.id, slug, name: meta.name || slug, industry: meta.industry || "", summary: meta.summary || "", industryUrl: meta.industryUrl || "", logoLight: meta.logoLight || "", logoDark: meta.logoDark || "", body };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

const esc = (v) => String(v == null ? "" : v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const safeUrl = (u) => (/^(https:\/\/|\/|img\/)/.test(String(u || "")) ? String(u) : "");

// The Partners list on the Brand Guidelines page.
export function partnersListHtml(partners) {
  if (!partners.length) return "";
  const cards = partners.map((p) => `<li><a class="partner-card" href="${partnerHash(p.slug)}">`
    + `<span class="partner-card-text"><span class="partner-card-name">${esc(p.name)}</span>`
    + (p.industry ? `<span class="partner-card-meta">${esc(p.industry)}</span>` : "")
    + `</span><span class="material-symbols-outlined" aria-hidden="true">chevron_right</span></a></li>`).join("");
  return `<h2 class="partners-title">Partners</h2><ul class="partner-list" aria-label="Partners">${cards}</ul>`;
}

// The visual lockups at the top of a partner page: each lead brand, on a
// light and a dark surface, from the official files. A partner whose logo
// file isn't in Brand assets yet shows a labelled empty slot, never a
// drawn or typed logo.
export const PH_LOGO = { light: "img/brand/ph-logo-full-color.svg", dark: "img/brand/ph-logo-white.svg" };
export function partnerLockupHtml(p) {
  const partnerLogo = (surface) => {
    const src = safeUrl(surface === "dark" ? p.logoDark : p.logoLight);
    return src ? `<img class="lockup-logo" src="${esc(src)}" alt="${esc(p.name)} logo">`
      : `<span class="lockup-missing" title="Logo file not yet in Brand assets">${esc(p.name)} logo</span>`;
  };
  const ph = (surface) => `<img class="lockup-logo" src="${PH_LOGO[surface]}" alt="Personalisation Hub logo">`;
  const tile = (lead, surface) => {
    const pair = lead === "partner" ? [partnerLogo(surface), ph(surface)] : [ph(surface), partnerLogo(surface)];
    return `<figure class="lockup lockup-${surface}"><div class="lockup-row">${pair[0]}<span class="lockup-divider" aria-hidden="true"></span>${pair[1]}</div>`
      + `<figcaption>${lead === "partner" ? esc(p.name) : "Personalisation Hub"} leads · ${surface}</figcaption></figure>`;
  };
  return `<div class="lockup-grid" aria-label="Co-brand lockups">${tile("partner", "light")}${tile("partner", "dark")}${tile("ph", "light")}${tile("ph", "dark")}</div>`;
}

// ── Markets (cultural and communication guidelines) under Brand Guidelines ──
// One page per market, each a repo file backlog-tracker/promote/markets/
// <slug>.md declared in board-docs.json with the mirror key
// "brand-market-<slug>". The page lists whatever market mirrors exist, so a
// new market is a new file and a manifest entry, never a code change. Agents
// read the same documents over MCP (get_project_document); Aidan picks one by
// country (functions/market-core.js).
export const MARKET_MIRROR_PREFIX = "brand-market-";
const MARKET_ROUTE = "brand-guidelines/markets/";
export function marketHash(slug) { return `#promote/${MARKET_ROUTE}${encodeURIComponent(slug)}`; }
// "#promote/brand-guidelines/markets/<slug>" -> slug, else null.
export function promoteMarketFromHash(hash) {
  const h = String(hash || "").split("?")[0];
  const pre = `#promote/${MARKET_ROUTE}`;
  if (!h.startsWith(pre)) return null;
  let slug = "";
  try { slug = decodeURIComponent(h.slice(pre.length)).split("/")[0]; } catch (_) { return null; }
  return /^[a-z0-9-]+$/.test(slug) ? slug : null;
}

// The "<!-- market ... -->" block at the top of a market file: one
// "key: value" per line (name, countries, region, spelling, currency,
// summary). Returns { meta, body } with the block removed from the body.
export function parseMarketDoc(md) {
  const text = String(md || "");
  const m = text.match(/^\s*<!--\s*market\s*\n([\s\S]*?)-->\s*\n?/);
  const meta = {};
  if (m) {
    for (const line of m[1].split("\n")) {
      const i = line.indexOf(":");
      if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    }
  }
  return { meta, body: m ? text.slice(m[0].length) : text };
}

// projectDocs rows -> the market pages, sorted by name.
export function marketsFrom(projectDocs) {
  return (projectDocs || [])
    .filter((d) => d && typeof d.mirrorKey === "string" && d.mirrorKey.startsWith(MARKET_MIRROR_PREFIX) && d.status !== "superseded")
    .map((d) => {
      const slug = d.mirrorKey.slice(MARKET_MIRROR_PREFIX.length);
      const { meta, body } = parseMarketDoc(mirrorBody(d));
      return { id: d.id, slug, name: meta.name || slug, region: meta.region || "", spelling: meta.spelling || "", currency: meta.currency || "", summary: meta.summary || "", body };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

// The Markets list on the Brand Guidelines page (the Partners list's cards).
export function marketsListHtml(markets) {
  if (!markets.length) return "";
  const cards = markets.map((m) => `<li><a class="partner-card" href="${marketHash(m.slug)}">`
    + `<span class="partner-card-text"><span class="partner-card-name">${esc(m.name)}</span>`
    + (m.region ? `<span class="partner-card-meta">${esc(m.region)}</span>` : "")
    + `</span><span class="material-symbols-outlined" aria-hidden="true">chevron_right</span></a></li>`).join("");
  return `<h2 class="partners-title">Markets</h2><ul class="partner-list" aria-label="Markets">${cards}</ul>`;
}
