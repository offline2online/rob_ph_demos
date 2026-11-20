"use strict";

// The master template: inheritance of promotion content.
//
// Each promotion may carry a `master` — the content every pharmacy uses for
// that promotion by default (greeting, promotion slots, walk-in close, Open
// today bar, opening-hours headlines, occasion copy). A pharmacy inherits every
// section of it unless its `detached[<promotion record id>]` lists the section,
// in which case the pharmacy's own copy of that section is used and later
// changes to the master no longer reach it. Branding (name, logo, colours) is
// always the pharmacy's own; it is not content and is never inherited.
//
// A promotion without a master behaves as before the master existed: each
// pharmacy's own content is used as it is.
//
// The admin editor holds the same section map (admin/js/model.js →
// MASTER_SECTIONS, effectiveContent); test/admin-model.test.mjs checks the
// two agree.

const SECTIONS = Object.freeze({
  greeting: ["greeting", "introTitle", "introSub", "introDur"],
  slots: ["slots"],
  close: ["close"],
  headlines: ["headlines"],
  address: ["showAddress"],
  occasions: ["occasions"],
  footer: ["footer"],
});
const SECTION_IDS = Object.keys(SECTIONS);
const SECTION_OF_KEY = Object.fromEntries(SECTION_IDS.flatMap((s) => SECTIONS[s].map((k) => [k, s])));

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const copy = (v) => JSON.parse(JSON.stringify(v));

/**
 * The content a pharmacy plays for one promotion: the master's sections, with
 * the pharmacy's own value for every detached section and for any field that
 * belongs to no section. `own` and `master` are content objects (or missing);
 * `detached` is the list of section ids the pharmacy manages itself.
 */
function effectiveContent(master, own, detached) {
  const mine = isObj(own) ? own : {};
  if (!isObj(master)) return copy(mine);
  const det = new Set(Array.isArray(detached) ? detached : []);
  const out = copy(master);
  for (const s of det) for (const k of SECTIONS[s] || []) delete out[k];
  for (const [k, v] of Object.entries(mine)) {
    const s = SECTION_OF_KEY[k];
    if (!s || det.has(s)) out[k] = copy(v);
  }
  return out;
}

module.exports = { SECTIONS, SECTION_IDS, effectiveContent };
