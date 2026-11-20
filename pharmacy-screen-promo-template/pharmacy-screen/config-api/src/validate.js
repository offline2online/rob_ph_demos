"use strict";

// Input validation for the config API. Every write goes through one of the
// normalise* functions below: they take the merged record (stored fields
// overlaid with the request's fields), check it, and return a clean copy
// holding only the fields this entity has. Anything else in the request is
// dropped, so a client can never smuggle an extra field into the store or,
// from there, into the public screen config.

class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

const bad = (message, details) => new ApiError(400, "invalid-request", message, details);
const { SECTION_IDS } = require("./inherit");

const STORE_CODE_RE = /^[A-Z0-9][A-Z0-9-]{1,31}$/;
const PROMO_ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
const COLOUR_RE = /^#[0-9a-fA-F]{6}$/;
const TEMPLATE_KINDS = ["promotion-scenes", "opening-hours"];
const ORIENTATIONS = ["portrait", "landscape"];

const LIMITS = {
  name: 120,
  html: 100 * 1024,
  css: 100 * 1024,
  content: 200 * 1024, // one pharmacy's content for one promotion, as JSON
  serviceText: 400,
  offeredBy: 500,
  depth: 12,
  tokens: 50, // hand-set token values per pharmacy
  tokenValue: 200,
};

// Token values a pharmacy sets by hand (Admin → Settings → Tokens): names as js/tokens.js isSettableToken() —
// letters, digits and underscores, starting with a letter, never one of the template slots the render engine
// fills with layout (js/tokens.js SLOT_TOKENS; test/tokens.test.mjs checks the two lists agree).
const TOKEN_NAME_RE = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;
// Data tokens filled live, never set by hand (js/tokens.js LIVE_TOKENS): ${StoreName} is the pharmacy name and
// ${CloseTime} / ${OpenTime} are today's hours. A value stored for one before that rule is dropped on the next save.
const LIVE_TOKENS = Object.freeze(["StoreName", "CloseTime", "OpenTime"]);
const SLOT_TOKENS = Object.freeze(["Logo", "Headline", "AccentLine", "Content", "Icon", "ServiceLabel", "Line1", "Line2", "Tiles", "Footer", "OpenToday", "Chevron", "ViewBox", "EdgePath", "HoursCard", "HolidayNote", "ContactLine", "Decor"]);

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
}

function str(value, field, { max = LIMITS.name, required = true, allowEmpty = false } = {}) {
  if (value === undefined || value === null) {
    if (required) throw bad(`${field} is required`);
    return "";
  }
  if (typeof value !== "string") throw bad(`${field} must be a string`);
  const v = value.trim();
  if (!v && !allowEmpty && required) throw bad(`${field} must not be empty`);
  if (v.length > max) throw bad(`${field} is longer than ${max} characters`);
  return v;
}

// Script-bearing markup is refused anywhere it could reach a public screen.
// Templates and copy are authored by admins, but they are rendered on
// unattended screens in shops, so one compromised admin account must not be
// able to run code there. The screen page also scopes and sanitises what it
// renders; this is the server-side half of that.
const UNSAFE_MARKUP = [
  { re: /<\s*(script|iframe|object|embed|frame|frameset|base|meta|link)\b/i, why: "a <script>, <iframe>, <object>, <embed>, <frame>, <base>, <meta> or <link> element" },
  // Only inside a tag, so copy such as "Buy one = get one" is fine.
  { re: /<[^>]*[\s/"']on[a-z]+\s*=/i, why: "an inline event handler (on…=)" },
  { re: /(javascript|vbscript)\s*:/i, why: "a javascript: or vbscript: URL" },
  { re: /data\s*:\s*text\/html/i, why: "a data:text/html URL" },
];
const UNSAFE_CSS = [
  { re: /<\s*\/\s*style/i, why: "a closing </style> tag" },
  { re: /@import/i, why: "@import" },
  { re: /expression\s*\(/i, why: "expression()" },
  { re: /(javascript|vbscript)\s*:/i, why: "a javascript: or vbscript: URL" },
  { re: /-moz-binding|behavior\s*:/i, why: "-moz-binding or behavior:" },
];

function assertSafe(text, field, rules) {
  for (const { re, why } of rules) {
    if (re.test(text)) throw bad(`${field} contains ${why}, which is not allowed`);
  }
}

function safeMarkup(value, field, max) {
  const v = str(value, field, { max, required: false, allowEmpty: true });
  assertSafe(v, field, UNSAFE_MARKUP);
  return v;
}

function safeCss(value, field, max) {
  const v = str(value, field, { max, required: false, allowEmpty: true });
  assertSafe(v, field, UNSAFE_CSS);
  return v;
}

// Pharmacy content is free-form JSON owned by the editor and the screen
// (scenes, greeting, open-today bar messages, opening-hours headlines…).
// The API does not fix its shape, so the editor can evolve without a back-end
// change; it bounds its size and depth, refuses unsafe markup in any string,
// and keeps only plain JSON values.
function safeJson(value, field, depth = 0) {
  if (depth > LIMITS.depth) throw bad(`${field} is nested too deeply`);
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw bad(`${field} must hold finite numbers only`);
    return value;
  }
  if (typeof value === "string") {
    assertSafe(value, field, UNSAFE_MARKUP);
    return value;
  }
  if (Array.isArray(value)) return value.map((v, i) => safeJson(v, `${field}[${i}]`, depth + 1));
  if (isPlainObject(value)) {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (k === "__proto__" || k === "constructor" || k === "prototype") throw bad(`${field} has a reserved key "${k}"`);
      out[k] = safeJson(v, `${field}.${k}`, depth + 1);
    }
    return out;
  }
  throw bad(`${field} must be JSON`);
}

function normaliseStoreCode(value) {
  const v = str(value, "storeCode", { max: 32 }).toUpperCase();
  if (!STORE_CODE_RE.test(v)) throw bad("storeCode must be 2-32 characters: letters, digits and hyphens (e.g. VIC-MP-001)");
  return v;
}

function normalisePromoId(value) {
  const v = str(value, "promoId", { max: 40 }).toLowerCase();
  if (!PROMO_ID_RE.test(v)) throw bad("promoId must be 1-40 characters: lower-case letters, digits and hyphens (it is used as promo=<id> in the screen URL)");
  return v;
}

function colour(value, field) {
  const v = str(value, field, { max: 7 });
  if (!COLOUR_RE.test(v)) throw bad(`${field} must be a hex colour like #0a7d5a`);
  return v.toLowerCase();
}

// A stored media reference ({path, url, contentType}) is only ever written by
// the upload endpoints. Clients cannot set one through a normal update.
function keepMedia(stored) {
  if (!isPlainObject(stored) || typeof stored.path !== "string" || typeof stored.url !== "string") return null;
  return { path: stored.path, url: stored.url, contentType: String(stored.contentType || "") };
}

function normalisePharmacy(input, stored = {}) {
  if (!isPlainObject(input)) throw bad("Request body must be a JSON object");
  const merged = { ...stored, ...input };
  const coloursIn = isPlainObject(merged.colours) ? { ...(stored.colours || {}), ...merged.colours } : merged.colours;
  if (!isPlainObject(coloursIn)) throw bad("colours is required: {primary, accent}");
  const content = merged.content === undefined ? {} : merged.content;
  if (!isPlainObject(content)) throw bad("content must be an object keyed by promotion id");
  const cleanContent = {};
  for (const [promotionId, value] of Object.entries(content)) cleanContent[promotionId] = contentValue(value, `content.${promotionId}`);
  const detached = normaliseDetached(merged.detached);
  const tokens = normaliseTokens(merged.tokens);
  return {
    storeCode: normaliseStoreCode(merged.storeCode),
    name: str(merged.name, "name"),
    colours: { primary: colour(coloursIn.primary, "colours.primary"), accent: colour(coloursIn.accent, "colours.accent") },
    logo: keepMedia(stored.logo),
    content: cleanContent,
    // Only when the pharmacy manages a section itself, so a record that
    // inherits everything keeps its earlier shape.
    ...(Object.keys(detached).length ? { detached } : {}),
    // Only when the pharmacy sets a token by hand.
    ...(Object.keys(tokens).length ? { tokens } : {}),
  };
}

// {<token name>: text}: token values the pharmacy sets by hand. Blank values
// are dropped (the token then shows the store's data again).
function normaliseTokens(value) {
  if (value === undefined || value === null) return {};
  if (!isPlainObject(value)) throw bad("tokens must be an object keyed by token name");
  const out = {};
  for (const [name, text] of Object.entries(value)) {
    if (!TOKEN_NAME_RE.test(name)) throw bad(`tokens has an invalid token name "${name}" (letters, digits and underscores, starting with a letter)`);
    if (SLOT_TOKENS.includes(name)) throw bad(`tokens.${name} is a template slot and cannot be set by hand`);
    if (LIVE_TOKENS.includes(name)) continue;
    if (typeof text !== "string") throw bad(`tokens.${name} must be text`);
    const v = text.trim();
    if (v.length > LIMITS.tokenValue) throw bad(`tokens.${name} is longer than ${LIMITS.tokenValue} characters`);
    if (v) out[name] = v;
  }
  if (Object.keys(out).length > LIMITS.tokens) throw bad(`tokens holds more than ${LIMITS.tokens} values`);
  return out;
}

// One promotion's content (a pharmacy's, or a promotion's master template).
function contentValue(value, field) {
  if (!isPlainObject(value)) throw bad(`${field} must be an object`);
  const clean = safeJson(value, field);
  if (JSON.stringify(clean).length > LIMITS.content) throw bad(`${field} is larger than ${LIMITS.content / 1024} KB`);
  return clean;
}

// {<promotion record id>: [section id, …]}: the master template sections a
// pharmacy manages itself (src/inherit.js). Empty lists are dropped.
function normaliseDetached(value) {
  if (value === undefined || value === null) return {};
  if (!isPlainObject(value)) throw bad("detached must be an object keyed by promotion id");
  const out = {};
  for (const [promotionId, list] of Object.entries(value)) {
    if (promotionId === "__proto__" || promotionId === "constructor" || promotionId === "prototype") throw bad(`detached has a reserved key "${promotionId}"`);
    if (!Array.isArray(list)) throw bad(`detached.${promotionId} must be an array of section ids`);
    for (const s of list) if (!SECTION_IDS.includes(s)) throw bad(`detached.${promotionId} holds an unknown section "${s}" (one of ${SECTION_IDS.join(", ")})`);
    const clean = SECTION_IDS.filter((s) => list.includes(s));
    if (clean.length) out[promotionId] = clean;
  }
  return out;
}

// A promotion's schedule: { type: "none" } (the default, also what a missing
// or null schedule means) or { type: "annual", from: "MM-DD", to: "MM-DD" },
// inclusive dates that repeat every year. Returns null for "none", so a
// promotion with no schedule stores none.
const MONTH_DAY = /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
function scheduleValue(value) {
  if (value === undefined || value === null) return null;
  if (!isPlainObject(value)) throw bad('schedule must be an object: { "type": "none" } or { "type": "annual", "from": "MM-DD", "to": "MM-DD" }');
  if (value.type === "none") return null;
  if (value.type !== "annual") throw bad('schedule.type must be "none" or "annual"');
  const day = (v, field) => {
    const m = MONTH_DAY.exec(typeof v === "string" ? v : "");
    if (!m || +m[2] > DAYS_IN_MONTH[+m[1] - 1]) throw bad(`schedule.${field} must be a month and day, "MM-DD"`);
    return v;
  };
  return { type: "annual", from: day(value.from, "from"), to: day(value.to, "to") };
}

function normalisePromotion(input, stored = {}) {
  if (!isPlainObject(input)) throw bad("Request body must be a JSON object");
  const merged = { ...stored, ...input };
  const master = merged.master === undefined || merged.master === null ? null : contentValue(merged.master, "master");
  const schedule = scheduleValue(merged.schedule);
  return {
    name: str(merged.name, "name"),
    promoId: normalisePromoId(merged.promoId),
    templateId: str(merged.templateId, "templateId", { max: 80 }),
    // Annual schedule only; no schedule (the default) is left out.
    ...(schedule ? { schedule } : {}),
    // The master template's content for this promotion (src/inherit.js);
    // left out until one is saved.
    ...(master ? { master } : {}),
  };
}

// Custom templates only — built-ins never reach this (they are read-only and
// live in code, src/builtins.js).
function normaliseTemplate(input, stored = {}) {
  if (!isPlainObject(input)) throw bad("Request body must be a JSON object");
  const merged = { ...stored, ...input };
  const kind = str(merged.kind, "kind", { max: 40 });
  if (!TEMPLATE_KINDS.includes(kind)) throw bad(`kind must be one of ${TEMPLATE_KINDS.join(", ")}`);
  const bgStored = isPlainObject(stored.backgrounds) ? stored.backgrounds : {};
  return {
    name: str(merged.name, "name"),
    kind,
    basedOn: str(merged.basedOn, "basedOn", { max: 80, required: false, allowEmpty: true }) || null,
    html: safeMarkup(merged.html, "html", LIMITS.html),
    css: safeCss(merged.css, "css", LIMITS.css),
    backgrounds: { portrait: keepMedia(bgStored.portrait), landscape: keepMedia(bgStored.landscape) },
  };
}

function normaliseService(input, stored = {}) {
  if (!isPlainObject(input)) throw bad("Request body must be a JSON object");
  const merged = { ...stored, ...input };
  const text = (field, required = false) => {
    const v = str(merged[field], field, { max: LIMITS.serviceText, required, allowEmpty: !required });
    assertSafe(v, field, UNSAFE_MARKUP);
    return v;
  };
  let offeredBy = merged.offeredBy === undefined || merged.offeredBy === null ? [] : merged.offeredBy;
  if (!Array.isArray(offeredBy)) throw bad("offeredBy must be an array of store codes");
  if (offeredBy.length > LIMITS.offeredBy) throw bad(`offeredBy holds more than ${LIMITS.offeredBy} store codes`);
  offeredBy = [...new Set(offeredBy.map(normaliseStoreCode))].sort();
  return {
    label: text("label", true),
    icon: str(merged.icon, "icon", { max: 80, required: false, allowEmpty: true }),
    category: text("category"),
    headline: text("headline"),
    accent: text("accent"),
    line1: text("line1"),
    line2: text("line2"),
    offeredBy,
  };
}

module.exports = {
  ApiError,
  bad,
  LIMITS,
  LIVE_TOKENS,
  SLOT_TOKENS,
  TEMPLATE_KINDS,
  ORIENTATIONS,
  isPlainObject,
  normaliseStoreCode,
  normalisePromoId,
  normalisePharmacy,
  normalisePromotion,
  normaliseTemplate,
  normaliseService,
  safeJson,
};
