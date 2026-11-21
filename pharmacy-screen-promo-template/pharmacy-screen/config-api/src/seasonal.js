"use strict";

// Seasonal content belongs to each pharmacy.
//
// For the Seasonal promotion (a promotion whose template is one of the
// built-in season templates) a pharmacy never follows the master live. Its
// season (which one plays outside every season's dates), and every season's
// copy, dates and timings, are its own:
//
//   content[<promotion id>].season     "christmas" | "new-year" | …
//   content[<promotion id>].occasions  {<season>: {beats, from?, to?}}
//   detached[<promotion id>]           includes "occasions"
//
// The master (promotion.master, promotion.templateId) is only where that
// starts from: ownSeasonal() copies it into a pharmacy that has not got its
// own yet. The service runs it on every pharmacy BEFORE a write is applied
// (so an edit to the master finds every store already holding what it played)
// and again after it (so a new pharmacy, a new Seasonal promotion, or a
// pharmacy that cleared its seasonal content starts from the master as it is
// at that moment). After that, nothing done to the master reaches the store.
//
// Morning, Afternoon and Closed are not touched: they inherit section by
// section as before (src/inherit.js).

const { BUILTIN_BY_ID, OCCASIONS } = require("./builtins");
const { effectiveContent } = require("./inherit");

const SEASON_IDS = OCCASIONS.map(([id]) => id);
const SECTION = "occasions";
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const copy = (v) => JSON.parse(JSON.stringify(v));

/** The season a promotion's own template names, or null when it is not a Seasonal promotion. */
function seasonOfPromotion(promotion) {
  const t = promotion && BUILTIN_BY_ID.get(promotion.templateId);
  return t && t.kind === "occasion" ? t.occasion : null;
}

/** The season a pharmacy plays for a Seasonal promotion: its own pick, else the promotion's. */
function seasonFor(promotion, ownContent) {
  const own = isObj(ownContent) ? ownContent.season : null;
  return SEASON_IDS.includes(own) ? own : seasonOfPromotion(promotion);
}

/**
 * `pharmacy` with its own seasonal content for every Seasonal promotion in
 * `promotions`, or null when it already has it all (nothing to write).
 */
function ownSeasonal(pharmacy, promotions) {
  let content = null;
  let detached = null;
  for (const p of promotions) {
    const fallback = seasonOfPromotion(p);
    if (!fallback) continue;
    const own = (pharmacy.content && pharmacy.content[p.id]) || {};
    const det = (pharmacy.detached && pharmacy.detached[p.id]) || [];
    // Its own already: seasonal copy with either mark of ownership (its own season, or the section detached).
    // Copy with neither is a leftover from before a pharmacy that inherits: what it plays is the master's.
    const hasCopy = isObj(own.occasions) && (SEASON_IDS.includes(own.season) || det.includes(SECTION));
    if (hasCopy && SEASON_IDS.includes(own.season) && det.includes(SECTION)) continue;
    const next = { ...own };
    if (!hasCopy) {
      // What this pharmacy plays now: the master's seasonal copy (or its own, where there is no master).
      const playing = effectiveContent(p.master, own, det.filter((s) => s !== SECTION));
      if (isObj(playing.occasions)) next.occasions = copy(playing.occasions);
    }
    if (!SEASON_IDS.includes(next.season)) next.season = fallback;
    content = content || { ...(pharmacy.content || {}) };
    detached = detached || { ...(pharmacy.detached || {}) };
    content[p.id] = next;
    detached[p.id] = det.includes(SECTION) ? det : [...det, SECTION];
  }
  return content ? { ...pharmacy, content, detached } : null;
}

module.exports = { SEASON_IDS, seasonOfPromotion, seasonFor, ownSeasonal };
