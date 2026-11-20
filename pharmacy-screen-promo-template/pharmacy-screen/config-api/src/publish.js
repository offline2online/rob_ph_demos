"use strict";

// The published screen config: what a screen needs to render one pharmacy,
// and nothing else. Built by allow-list — every field below is copied by
// name — so audit metadata, who-edited-what, versions, storage paths and any
// field a later ticket adds to the admin records stay out of the public view
// unless someone adds them here on purpose. The PH API token never lives in
// these records at all (it has its own encrypted settings store), and this
// view could not carry it even if it did.

const { BUILTIN_BY_ID, builtInFor } = require("./builtins");

const PUBLISHED_SCHEMA_VERSION = 1;

function mediaUrl(m) {
  return m && typeof m.url === "string" ? m.url : null;
}

function resolveTemplate(templateId, templatesById) {
  const t = templatesById.get(templateId) || BUILTIN_BY_ID.get(templateId) || builtInFor("promotion-scenes");
  return {
    id: t.id,
    name: t.name,
    kind: t.kind,
    builtIn: Boolean(t.builtIn),
    html: t.html || "",
    css: t.css || "",
    backgrounds: {
      portrait: mediaUrl(t.backgrounds && t.backgrounds.portrait),
      landscape: mediaUrl(t.backgrounds && t.backgrounds.landscape),
    },
  };
}

// pharmacy: a stored pharmacy record (with id); promotions: every promotion
// (with id); templates: every custom template (with id). Returns the public
// document for pharmacy.storeCode.
function buildScreenConfig(pharmacy, promotions, templates, publishedAt) {
  const templatesById = new Map(templates.map((t) => [t.id, t]));
  const content = pharmacy.content || {};
  const promos = {};
  for (const p of [...promotions].sort((a, b) => a.promoId.localeCompare(b.promoId))) {
    promos[p.promoId] = {
      promoId: p.promoId,
      name: p.name,
      template: resolveTemplate(p.templateId, templatesById),
      content: content[p.id] || {},
    };
  }
  return {
    schemaVersion: PUBLISHED_SCHEMA_VERSION,
    storeCode: pharmacy.storeCode,
    name: pharmacy.name,
    colours: { primary: pharmacy.colours.primary, accent: pharmacy.colours.accent },
    logo: mediaUrl(pharmacy.logo),
    promotions: promos,
    publishedAt,
  };
}

module.exports = { buildScreenConfig, PUBLISHED_SCHEMA_VERSION };
