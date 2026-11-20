"use strict";

// The two built-in templates (requirement 11). They are read-only: the API
// refuses to change or delete them, and they live here in code rather than
// in the store, so a fresh environment always has them and no admin can
// remove the fallback that a deleted custom template's promotions return to.
//
// A built-in's html and css are empty on purpose: the screen page renders a
// built-in with its own engine (the "Promotion scenes" and "Opening hours"
// renderers ported from the prototype). A custom template starts as a clone
// of one, so its `kind` says which built-in it falls back to.

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

module.exports = { BUILTIN_TEMPLATES, BUILTIN_BY_ID, builtInFor, isBuiltInId, builtInView };
