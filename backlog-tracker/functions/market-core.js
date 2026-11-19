"use strict";
// Brand Guidelines › Markets for agents (ticket mErc7MPAkrKjF9fWgqXb), pure.
//
// Each market page is a repo file, backlog-tracker/promote/markets/<slug>.md,
// mirrored to `projectDocs` with mirrorKey "brand-market-<slug>" (board-docs.json).
// Its "<!-- market ... -->" block names the market and the countries it covers
// ("countries: TH, THA, Thailand"). Aidan's collateral run (functions/aidan.js →
// writeCollateral) picks the page for the lead's or TAM company's country with
// `marketFor` and puts the WHOLE page (agent-only detail included) in the prompt
// as <market>, next to the brand skill, the industry and the prospect. No page
// for that country: the default brand guidelines apply, and the run records
// the missing market so Aidan's self-check files a ticket to add it
// (aidan-core.js → assessRun, category "missing-market").
//
// The console page draws the same files (public/js/promote-section.js →
// marketsFrom); the ph-brand and collateral skills read them over MCP with
// list_project_documents / get_project_document. Adding a market is a new file
// and a manifest entry, never a code change.
// Tests: test/market-core.test.js, and a whole run in test/support-mail.test.js.

const MARKET_MIRROR_PREFIX = "brand-market-";
const MARKET_TEXT_BUDGET = 20000; // characters of one market page in the prompt (a mirror is at most 20,000)
const clip = (s, n) => { const t = String(s == null ? "" : s); return t.length > n ? t.slice(0, n) : t; };
// "United States of America", "U.S.A." and "usa" compare equal.
const norm = (s) => String(s == null ? "" : s).toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/\./g, "").replace(/[^a-z0-9]+/g, " ").trim();

// The mirror's text without the "Copy of <file>" line the sync puts on top.
function mirrorBody(doc) {
  const text = String((doc && doc.contentMd) || "");
  const prefix = String((doc && doc.sourcePrefix) || "");
  return prefix && text.startsWith(prefix) ? text.slice(prefix.length) : text;
}
// "<!-- market\nkey: value\n... -->" at the top -> { meta, body } (block removed).
function parseMarketDoc(md) {
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
// projectDocs rows -> [{ id, slug, name, countries (normalised), spelling, currency, body }].
function marketsFrom(projectDocs) {
  return (projectDocs || [])
    .filter((d) => d && typeof d.mirrorKey === "string" && d.mirrorKey.startsWith(MARKET_MIRROR_PREFIX) && d.status !== "superseded")
    .map((d) => {
      const slug = d.mirrorKey.slice(MARKET_MIRROR_PREFIX.length);
      const { meta, body } = parseMarketDoc(mirrorBody(d));
      const name = meta.name || slug;
      const countries = [...new Set([name, slug.replace(/-/g, " "), ...String(meta.countries || "").split(",")].map(norm).filter(Boolean))];
      return { id: d.id, slug, name, countries, spelling: meta.spelling || "", currency: meta.currency || "", body };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}
// The market page for a country ("Thailand", "TH", "USA"), or null.
function marketFor(country, markets) {
  const c = norm(country);
  if (!c) return null;
  return (markets || []).find((m) => m.countries.includes(c)) || null;
}
// The prompt block: the whole page, agent-only detail included.
function marketBlock(market) {
  if (!market) return "";
  return `<market name="${String(market.name).replace(/"/g, "")}">\n${clip(market.body.trim(), MARKET_TEXT_BUDGET)}\n</market>`;
}
// The system lines for the market: tailored to its page, or the default guidelines.
function marketSystem(market, country = "") {
  if (market) {
    return `Tailor tone, forms of address, spelling, currency, date and number formats, units, business etiquette and regulatory caution to <market> (${market.name}). It adds to the brand guidelines and the industry: on tone and local conventions <market> wins; on product facts and claims the brand skill and the industry win. "Personalisation Hub" is a proper name and keeps its spelling in every market.`;
  }
  const c = clip(String(country || "").trim(), 60);
  return c ? `There is no market page for ${c}: follow the brand skill's default guidelines for tone and conventions.` : "";
}

module.exports = { MARKET_MIRROR_PREFIX, MARKET_TEXT_BUDGET, mirrorBody, parseMarketDoc, marketsFrom, marketFor, marketBlock, marketSystem, norm };
