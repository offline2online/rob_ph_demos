"use strict";

// The built-in templates (requirement 11): "Promotion scenes", "Opening hours"
// and one per season for the Seasonal promotion (internally "occasion"). They are read-only: the API
// refuses to change or delete them, and they live here in code rather than
// in the store, so a fresh environment always has them and no admin can
// remove the fallback that a deleted custom template's promotions return to.
//
// A built-in's html and css are empty on purpose: the screen page renders a
// built-in with its own engine (the "Promotion scenes" and "Opening hours"
// renderers ported from the prototype). A custom template starts as a clone
// of one, so its `kind` says which built-in it falls back to.
//
// The occasion templates (kind "occasion", with `occasion` naming which one)
// are drawn entirely by the screen page (js/render.js OCCASIONS): the
// approved standalone designs in js/occasions.js, with their fonts and the
// Christmas background photo self-hosted beside the page (css/occasion-*.css),
// so their html, css and backgrounds here stay empty. The admin
// editor's Season drop-down sets the Seasonal promotion's templateId to one
// of them; they can't be cloned (an occasion has no editable HTML version).

const OCCASIONS = Object.freeze([
  ["christmas", "Christmas"],
  ["new-year", "New Year's"],
  ["australia-day", "Australia Day"],
  ["valentines-day", "Valentine's Day"],
  ["easter", "Easter"],
  ["anzac-day", "Anzac Day"],
]);
const OCCASION_KIND = "occasion";
const occasionTemplateId = (occasion) => `builtin-occasion-${occasion}`;

const BUILTIN_TEMPLATES = Object.freeze([
  Object.freeze({
    id: "builtin-promotion-scenes",
    name: "Promotion scenes",
    kind: "promotion-scenes",
    builtIn: true,
    basedOn: null,
    html: "",
    css: "",
    backgrounds: Object.freeze({ portrait: null, landscape: null }),
  }),
  Object.freeze({
    id: "builtin-opening-hours",
    name: "Opening hours",
    kind: "opening-hours",
    builtIn: true,
    basedOn: null,
    html: "",
    css: "",
    backgrounds: Object.freeze({ portrait: null, landscape: null }),
  }),
  ...OCCASIONS.map(([occasion, name]) =>
    Object.freeze({
      id: occasionTemplateId(occasion),
      name,
      kind: OCCASION_KIND,
      occasion,
      builtIn: true,
      basedOn: null,
      html: "",
      css: "",
      backgrounds: Object.freeze({ portrait: null, landscape: null }),
    }),
  ),
]);

const BUILTIN_BY_ID = new Map(BUILTIN_TEMPLATES.map((t) => [t.id, t]));

function builtInFor(kind) {
  return BUILTIN_TEMPLATES.find((t) => t.kind === kind) || BUILTIN_TEMPLATES[0];
}

function isBuiltInId(id) {
  return BUILTIN_BY_ID.has(id);
}

// A plain (unfrozen) copy, safe to hand to a response.
function builtInView(t) {
  return { ...t, backgrounds: { ...t.backgrounds } };
}

module.exports = { BUILTIN_TEMPLATES, BUILTIN_BY_ID, OCCASIONS, OCCASION_KIND, occasionTemplateId, builtInFor, isBuiltInId, builtInView };
