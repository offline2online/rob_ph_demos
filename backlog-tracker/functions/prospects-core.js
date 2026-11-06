// GENERATED from public/js/prospects-core.js by test/prospects-core-copy.mjs.
// Do not edit: change the source and run  node test/prospects-core-copy.mjs --write
"use strict";
// Promote › Prospects (TAM): the data rules behind the page (prospects-page.js)
// and, as a generated CommonJS copy, the MCP tools (functions/prospects.js).
// Pure functions only: no DOM, no Firestore, so test/prospects.test.mjs drives
// them directly.
//
// One document per company in `prospects/{id}` (company level, global):
//   name, website, industry, subIndustry, hqCountry, markets[] (countries
//   operated in), awsRegion, storeCount|null, sizeBand (derived from
//   storeCount unless set), vendors[] (current vendors where known),
//   campaigns[] (campaigns the company is in), status (one of STATUSES),
//   leadId ("" until converted), source, notes,
//   createdAt / updatedAt / createdByEmail / updatedByEmail

const STATUSES = [
  { key: "new", label: "New" },
  { key: "researching", label: "Researching" },
  { key: "targeted", label: "Targeted" },
  { key: "engaged", label: "Engaged" },
  { key: "converted", label: "Converted to lead" },
  { key: "disqualified", label: "Disqualified" },
];
const STATUS_KEYS = STATUSES.map((s) => s.key);
const DEFAULT_STATUS = "new";
const statusLabel = (key) => (STATUSES.find((s) => s.key === key) || { label: String(key || "") }).label;
const isStatus = (key) => STATUS_KEYS.includes(key);

// Store-count bands, smallest first. `min` is inclusive.
const SIZE_BANDS = [
  { key: "unknown", label: "Unknown", min: null },
  { key: "small", label: "Small (1-49 stores)", min: 1 },
  { key: "mid", label: "Mid-size (50-249)", min: 50 },
  { key: "large", label: "Large (250-999)", min: 250 },
  { key: "xlarge", label: "Enterprise (1,000+)", min: 1000 },
];
const SIZE_BAND_KEYS = SIZE_BANDS.map((b) => b.key);
const sizeBandLabel = (key) => (SIZE_BANDS.find((b) => b.key === key) || { label: "Unknown" }).label;
function sizeBandFor(storeCount) {
  if (typeof storeCount !== "number" || !Number.isFinite(storeCount) || storeCount < 1) return "unknown";
  let key = "small";
  for (const b of SIZE_BANDS) if (b.min != null && storeCount >= b.min) key = b.key;
  return key;
}

const LIMITS = { name: 120, website: 300, industry: 120, subIndustry: 120, country: 60, region: 40, vendor: 80, campaign: 80, source: 80, notes: 2000, list: 60, batch: 50 };

// The AWS region a company in this country would be hosted from, for the
// "AWS region" filter. Countries with no region of their own map to the
// nearest one; unknown countries get "".
const AWS_REGIONS = [
  "us-east-1", "us-east-2", "us-west-1", "us-west-2", "ca-central-1", "mx-central-1", "sa-east-1",
  "eu-west-1", "eu-west-2", "eu-west-3", "eu-central-1", "eu-central-2", "eu-north-1", "eu-south-1", "eu-south-2",
  "me-south-1", "me-central-1", "il-central-1", "af-south-1",
  "ap-south-1", "ap-southeast-1", "ap-southeast-2", "ap-southeast-3", "ap-southeast-5", "ap-southeast-7", "ap-northeast-1", "ap-northeast-2", "ap-northeast-3", "ap-east-1", "cn-north-1",
];
const REGION_BY_COUNTRY = {
  "united states": "us-east-1", usa: "us-east-1", us: "us-east-1", canada: "ca-central-1", mexico: "mx-central-1", brazil: "sa-east-1",
  "argentina": "sa-east-1", chile: "sa-east-1", colombia: "sa-east-1",
  "united kingdom": "eu-west-2", uk: "eu-west-2", ireland: "eu-west-1", france: "eu-west-3", germany: "eu-central-1", switzerland: "eu-central-2",
  austria: "eu-central-1", netherlands: "eu-central-1", belgium: "eu-west-3", luxembourg: "eu-central-1", poland: "eu-central-1",
  spain: "eu-south-2", portugal: "eu-south-2", italy: "eu-south-1", sweden: "eu-north-1", norway: "eu-north-1", denmark: "eu-north-1", finland: "eu-north-1",
  "united arab emirates": "me-central-1", uae: "me-central-1", bahrain: "me-south-1", "saudi arabia": "me-central-1", israel: "il-central-1",
  "south africa": "af-south-1", india: "ap-south-1", singapore: "ap-southeast-1", australia: "ap-southeast-2", "new zealand": "ap-southeast-2",
  indonesia: "ap-southeast-3", malaysia: "ap-southeast-5", thailand: "ap-southeast-7", japan: "ap-northeast-1", "south korea": "ap-northeast-2",
  "hong kong": "ap-east-1", china: "cn-north-1",
};
const awsRegionForCountry = (country) => REGION_BY_COUNTRY[String(country || "").trim().toLowerCase()] || "";

const str = (v, max) => String(v == null ? "" : v).trim().slice(0, max);

// "UK, France ; Germany" or an array -> a clean list (no duplicates, in order).
function parseList(v, max = LIMITS.country) {
  const parts = Array.isArray(v) ? v : String(v == null ? "" : v).split(/[,;\n]/);
  const seen = new Set();
  const out = [];
  for (const p of parts) {
    const c = str(p, max);
    if (c && !seen.has(c.toLowerCase())) { seen.add(c.toLowerCase()); out.push(c); }
  }
  return out.slice(0, LIMITS.list);
}

function parseStoreCount(v) {
  if (v === "" || v == null) return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[,\s]/g, ""));
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : NaN;
}

// "example.com" -> "https://example.com"; "" when blank; null when it can't be one.
function normaliseUrl(v) {
  const s = String(v == null ? "" : v).trim();
  if (!s) return "";
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : `https://${s}`;
  let u;
  try { u = new URL(withScheme); } catch { return null; }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  if (!u.hostname.includes(".")) return null;
  return u.href.replace(/\/$/, "");
}

// The same company is one prospect: a name matched ignoring case and spacing.
const companyKey = (name) => String(name == null ? "" : name).toLowerCase().replace(/[^a-z0-9]+/g, "");
function slugId(name) {
  return companyKey(name).slice(0, 60);
}

// What a writer (the MCP tools, the starter set) sends -> the document's
// fields, or { errors }. With `existing`, only the keys present in `input` are
// changed, so an enrichment run that knows one fact doesn't blank the others.
function prospectFromInput(input, existing) {
  const x = input || {};
  const e = existing || null;
  const errors = [];
  const has = (k) => Object.prototype.hasOwnProperty.call(x, k) && x[k] !== undefined;
  const out = {};
  const name = has("name") ? str(x.name, LIMITS.name) : (e ? e.name : "");
  if (!name) errors.push("Company name is required.");
  out.name = name;
  if (has("website")) {
    const w = normaliseUrl(x.website);
    if (w === null) errors.push("Website isn't a valid address."); else out.website = w;
  } else out.website = e ? e.website : "";
  out.industry = has("industry") ? str(x.industry, LIMITS.industry) : (e ? e.industry : "");
  out.subIndustry = has("subIndustry") ? str(x.subIndustry, LIMITS.subIndustry) : (e ? e.subIndustry : "");
  out.hqCountry = has("hqCountry") ? str(x.hqCountry, LIMITS.country) : (e ? e.hqCountry : "");
  out.markets = has("markets") ? parseList(x.markets) : (e ? e.markets : []);
  if (out.hqCountry && !out.markets.some((m) => m.toLowerCase() === out.hqCountry.toLowerCase())) out.markets = [out.hqCountry, ...out.markets].slice(0, LIMITS.list);
  if (has("awsRegion")) {
    const r = str(x.awsRegion, LIMITS.region).toLowerCase();
    if (r && !/^[a-z]{2}(-[a-z]+)+-\d$/.test(r)) errors.push(`awsRegion "${x.awsRegion}" isn't an AWS region code like eu-west-2.`); else out.awsRegion = r;
  } else out.awsRegion = e && e.awsRegion ? e.awsRegion : awsRegionForCountry(out.hqCountry);
  if (has("storeCount")) {
    const n = parseStoreCount(x.storeCount);
    if (Number.isNaN(n)) errors.push("Store count must be a number."); else out.storeCount = n;
  } else out.storeCount = e ? e.storeCount : null;
  if (has("sizeBand") && x.sizeBand !== "" && x.sizeBand != null) {
    if (!SIZE_BAND_KEYS.includes(x.sizeBand)) errors.push(`sizeBand must be one of: ${SIZE_BAND_KEYS.join(", ")}.`); else out.sizeBand = x.sizeBand;
  } else out.sizeBand = sizeBandFor(out.storeCount);
  out.vendors = has("vendors") ? parseList(x.vendors, LIMITS.vendor) : (e ? e.vendors : []);
  out.campaigns = has("campaigns") ? parseList(x.campaigns, LIMITS.campaign) : (e ? e.campaigns : []);
  if (has("status")) {
    if (!isStatus(x.status)) errors.push(`status must be one of: ${STATUS_KEYS.join(", ")}.`); else out.status = x.status;
  } else out.status = e ? e.status : DEFAULT_STATUS;
  out.source = has("source") ? str(x.source, LIMITS.source) : (e ? e.source : "");
  out.notes = has("notes") ? str(x.notes, LIMITS.notes) : (e ? e.notes : "");
  if (errors.length) return { errors };
  return { errors: [], fields: out };
}

// A stored document, tolerant of anything an older writer left out.
function normaliseProspect(id, d) {
  const x = d || {};
  const list = (v) => (Array.isArray(v) ? v.map(String).filter(Boolean) : []);
  const storeCount = typeof x.storeCount === "number" && Number.isFinite(x.storeCount) ? x.storeCount : null;
  return {
    id,
    name: String(x.name || ""),
    website: String(x.website || ""),
    industry: String(x.industry || ""),
    subIndustry: String(x.subIndustry || ""),
    hqCountry: String(x.hqCountry || ""),
    markets: list(x.markets),
    awsRegion: String(x.awsRegion || ""),
    storeCount,
    sizeBand: SIZE_BAND_KEYS.includes(x.sizeBand) ? x.sizeBand : sizeBandFor(storeCount),
    vendors: list(x.vendors),
    campaigns: list(x.campaigns),
    status: isStatus(x.status) ? x.status : DEFAULT_STATUS,
    leadId: String(x.leadId || ""),
    source: String(x.source || ""),
    notes: String(x.notes || ""),
    updatedAtMs: ms(x.updatedAt), createdAtMs: ms(x.createdAt),
  };
}
function ms(v) {
  if (!v) return 0;
  if (typeof v.toMillis === "function") return v.toMillis();
  if (v instanceof Date) return v.getTime();
  if (typeof v === "number") return v;
  if (typeof v === "string") { const t = Date.parse(v); return Number.isNaN(t) ? 0 : t; }
  return 0;
}

// ── Filtering ──────────────────────────────────────────────────────────────
const EMPTY_FILTER = { q: "", industry: "", market: "", awsRegion: "", campaign: "", sizeBand: "", status: "", minStores: "", maxStores: "" };
const FILTER_KEYS = Object.keys(EMPTY_FILTER);

const eq = (a, b) => String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
const hasItem = (list, v) => list.some((x) => eq(x, v));

// Does one prospect pass every filter that is set? A market matches the HQ
// country or any country the company operates in.
function matchesFilter(p, f) {
  const x = Object.assign({}, EMPTY_FILTER, f || {});
  if (x.industry && !eq(p.industry, x.industry)) return false;
  if (x.market && !(eq(p.hqCountry, x.market) || hasItem(p.markets, x.market))) return false;
  if (x.awsRegion && !eq(p.awsRegion, x.awsRegion)) return false;
  if (x.campaign && !hasItem(p.campaigns, x.campaign)) return false;
  if (x.sizeBand && p.sizeBand !== x.sizeBand) return false;
  if (x.status && p.status !== x.status) return false;
  const min = parseStoreCount(x.minStores);
  const max = parseStoreCount(x.maxStores);
  if (min != null && !Number.isNaN(min) && (p.storeCount == null || p.storeCount < min)) return false;
  if (max != null && !Number.isNaN(max) && (p.storeCount == null || p.storeCount > max)) return false;
  const q = String(x.q || "").trim().toLowerCase();
  if (q) {
    const hay = [p.name, p.website, p.industry, p.subIndustry, p.hqCountry, p.awsRegion, ...p.markets, ...p.vendors, ...p.campaigns].join(" ").toLowerCase();
    if (!hay.includes(q)) return false;
  }
  return true;
}
const filterProspects = (rows, f) => (rows || []).filter((p) => matchesFilter(p, f));
const isFilterEmpty = (f) => FILTER_KEYS.every((k) => !String((f || {})[k] == null ? "" : f[k]).trim());

// The values each dropdown offers: what is actually in the data, sorted.
function filterOptions(rows) {
  const set = () => new Map();
  const add = (m, v) => { const s = String(v == null ? "" : v).trim(); if (s && !m.has(s.toLowerCase())) m.set(s.toLowerCase(), s); };
  const industry = set(), market = set(), awsRegion = set(), campaign = set();
  for (const p of rows || []) {
    add(industry, p.industry); add(awsRegion, p.awsRegion);
    add(market, p.hqCountry); p.markets.forEach((m) => add(market, m));
    p.campaigns.forEach((c) => add(campaign, c));
  }
  const sorted = (m) => [...m.values()].sort((a, b) => a.localeCompare(b));
  return { industry: sorted(industry), market: sorted(market), awsRegion: sorted(awsRegion), campaign: sorted(campaign) };
}

// ── Saved filters (kept per browser; this module only validates them) ─────
function sanitiseSavedFilters(raw) {
  const out = [];
  for (const s of Array.isArray(raw) ? raw : []) {
    const name = str(s && s.name, 60);
    if (!name || !s.filter || typeof s.filter !== "object") continue;
    const filter = {};
    for (const k of FILTER_KEYS) filter[k] = str(s.filter[k], 120);
    if (isFilterEmpty(filter)) continue;
    if (out.some((o) => o.name.toLowerCase() === name.toLowerCase())) continue;
    out.push({ name, filter });
  }
  return out.slice(0, 30);
}
function withSavedFilter(list, name, filter) {
  const n = str(name, 60);
  if (!n) return { error: "Name the filter before saving it." };
  if (isFilterEmpty(filter)) return { error: "Set at least one filter to save." };
  const rest = (list || []).filter((s) => s.name.toLowerCase() !== n.toLowerCase());
  return { list: sanitiseSavedFilters([...rest, { name: n, filter }]) };
}

// ── CSV export ─────────────────────────────────────────────────────────────
const CSV_COLUMNS = [
  ["Company", (p) => p.name], ["Website", (p) => p.website], ["Industry", (p) => p.industry], ["Sub-industry", (p) => p.subIndustry],
  ["HQ country", (p) => p.hqCountry], ["Markets", (p) => p.markets.join("; ")], ["AWS region", (p) => p.awsRegion],
  ["Store count", (p) => (p.storeCount == null ? "" : p.storeCount)], ["Size band", (p) => sizeBandLabel(p.sizeBand)],
  ["Current vendors", (p) => p.vendors.join("; ")], ["Campaigns", (p) => p.campaigns.join("; ")], ["Status", (p) => statusLabel(p.status)],
  ["Lead", (p) => p.leadId],
];
// A cell that starts like a formula is prefixed so a spreadsheet shows it as text.
function csvCell(v) {
  let s = String(v == null ? "" : v);
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function toCsv(rows) {
  const lines = [CSV_COLUMNS.map(([h]) => csvCell(h)).join(",")];
  for (const p of rows || []) lines.push(CSV_COLUMNS.map(([, get]) => csvCell(get(p))).join(","));
  return lines.join("\r\n") + "\r\n";
}

// ── Convert to lead ────────────────────────────────────────────────────────
// A prospect becomes at most one lead: the lead's id comes from the prospect's,
// so converting twice (two tabs, two people) writes the same document.
const leadIdForProspect = (prospectId) => `prospect-${prospectId}`;
const LEAD_SOURCE = "Prospects (TAM)";
function leadFieldsFromProspect(p, email) {
  return {
    company: {
      name: p.name, website: p.website, industry: p.industry,
      countries: (p.markets.length ? p.markets : p.hqCountry ? [p.hqCountry] : []).slice(0, 60),
      storeCount: p.storeCount,
    },
    contacts: [], stage: "lead", source: LEAD_SOURCE, assignee: String(email || "").toLowerCase(), customerAccount: null,
    prospectId: p.id,
  };
}

module.exports = { STATUSES, STATUS_KEYS, DEFAULT_STATUS, statusLabel, isStatus, SIZE_BANDS, SIZE_BAND_KEYS, sizeBandLabel, sizeBandFor, LIMITS, AWS_REGIONS, awsRegionForCountry, parseList, parseStoreCount, normaliseUrl, companyKey, slugId, prospectFromInput, normaliseProspect, EMPTY_FILTER, FILTER_KEYS, matchesFilter, filterProspects, isFilterEmpty, filterOptions, sanitiseSavedFilters, withSavedFilter, CSV_COLUMNS, csvCell, toCsv, leadIdForProspect, LEAD_SOURCE, leadFieldsFromProspect };
