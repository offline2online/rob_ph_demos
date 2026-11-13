// GENERATED from public/js/prospects-core.js by test/prospects-core-copy.mjs.
// Do not edit: change the source and run  node test/prospects-core-copy.mjs --write
"use strict";
// Promote › Prospects (TAM): the data rules behind the page (prospects-page.js)
// and, as a generated CommonJS copy, the MCP tools (functions/prospects.js).
// Pure functions only: no DOM, no Firestore, so test/prospects.test.mjs drives
// them directly.
//
// One document per company PER COUNTRY in `prospects/{id}` (global):
//   name, country (the country this record covers), website, industry,
//   subIndustry, hqCountry (head office), markets[] (other countries operated
//   in), awsRegion (from country, else hqCountry), storeCount|null,
//   storePresence (the store count as written), sizeBand (derived from
//   storeCount unless set), ownership, priority (high|medium|low|""),
//   insights, decisionMakers, linkedinUrl, linkedinOrgId, linkedinVerified,
//   awsAccountId (12 digits or ""),
//   contacts[{name, role, lastContact, awsAccountId?, email?}], vendors[], campaigns[],
//   status (one of STATUSES), leadId ("" until converted), source, notes,
//   createdAt / updatedAt / createdByEmail / updatedByEmail
// "The same prospect" is the same company (companyKey of name) in the same
// country, read from the fields, never from the doc id (prospectKey).

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

const LIMITS = { name: 120, website: 300, industry: 120, subIndustry: 120, country: 60, region: 40, vendor: 80, campaign: 80, source: 80, notes: 2000, list: 60, batch: 50, storePresence: 80, ownership: 120, insights: 2000, decisionMakers: 500, linkedinUrl: 300, linkedinOrgId: 20, contacts: 30, contactName: 120, contactRole: 120, contactLast: 40, contactEmail: 200 };

const PRIORITIES = [
  { key: "high", label: "High" },
  { key: "medium", label: "Medium" },
  { key: "low", label: "Low" },
];
const PRIORITY_KEYS = PRIORITIES.map((x) => x.key);
const priorityLabel = (key) => (PRIORITIES.find((x) => x.key === key) || { label: "" }).label;

// ── Industry taxonomy: the nine on personalisationhub.com/industries/ (6 Nov 2026) ──
// The display name is the stored and filtered value, the slug the stable key.
// Anything that fits none of the nine is "" (Unassigned), never a new industry.
const INDUSTRIES = [
  { slug: "convenience", label: "Fuel & Convenience" },
  { slug: "hospitality", label: "Pubs & Hospitality" },
  { slug: "telco", label: "Telco Retail" },
  { slug: "pharmacy", label: "Pharmacy" },
  { slug: "retail-media", label: "Retail Media" },
  { slug: "grocery", label: "Grocery & Supermarkets" },
  { slug: "fashion", label: "Fashion & Department Stores" },
  { slug: "qsr", label: "Quick Service Restaurants" },
  { slug: "banking", label: "Banking" },
];
const INDUSTRY_LABELS = INDUSTRIES.map((i) => i.label);
const UNASSIGNED_INDUSTRY = "Unassigned";
// Order matters: the first rule that matches wins.
const INDUSTRY_RULES = [
  ["retail-media", /retail[\s_-]*media|\brmn\b/],
  ["telco", /telco|telecom|\bmobile\b|wireless/],
  ["pharmacy", /pharmac|chemist|drug[\s-]*store/],
  ["qsr", /\bqsr\b|quick[\s_-]*service|fast[\s_-]*food|restaurant|food[\s_-]*service/],
  ["hospitality", /hospitality|\bpubs?\b|\bbars?\b|\bhotels?\b|venue/],
  ["convenience", /convenien|\bfuel\b|petrol|service[\s_-]*station|forecourt|c-?store/],
  ["grocery", /grocer|supermarket|hypermarket|food[\s_-]*retail/],
  ["fashion", /fashion|apparel|clothing|footwear|department[\s_-]*store/],
  ["banking", /\bbank|financial|finance|credit[\s_-]*union/],
];
// Any stored or typed industry (a display name, a slug or free text) -> one of the nine labels, else "".
function normaliseIndustry(v) {
  const s = String(v == null ? "" : v).trim().toLowerCase();
  if (!s || s === "unassigned") return "";
  const exact = INDUSTRIES.find((i) => i.label.toLowerCase() === s || i.slug === s);
  if (exact) return exact.label;
  const hit = INDUSTRY_RULES.find(([, re]) => re.test(s));
  return hit ? INDUSTRIES.find((i) => i.slug === hit[0]).label : "";
}

// Every country, for the Country filter: the list does not depend on what is in the data.
const COUNTRIES = ("Afghanistan|Albania|Algeria|Andorra|Angola|Antigua and Barbuda|Argentina|Armenia|Australia|Austria|Azerbaijan|Bahamas|Bahrain|Bangladesh|Barbados|Belarus|Belgium|Belize|Benin|Bhutan|Bolivia|Bosnia and Herzegovina|Botswana|Brazil|Brunei|Bulgaria|Burkina Faso|Burundi|Cabo Verde|Cambodia|Cameroon|Canada|Central African Republic|Chad|Chile|China|Colombia|Comoros|Congo|Costa Rica|Croatia|Cuba|Cyprus|Czechia|Democratic Republic of the Congo|Denmark|Djibouti|Dominica|Dominican Republic|Ecuador|Egypt|El Salvador|Equatorial Guinea|Eritrea|Estonia|Eswatini|Ethiopia|Fiji|Finland|France|Gabon|Gambia|Georgia|Germany|Ghana|Greece|Grenada|Guatemala|Guinea|Guinea-Bissau|Guyana|Haiti|Honduras|Hong Kong|Hungary|Iceland|India|Indonesia|Iran|Iraq|Ireland|Israel|Italy|Ivory Coast|Jamaica|Japan|Jordan|Kazakhstan|Kenya|Kiribati|Kosovo|Kuwait|Kyrgyzstan|Laos|Latvia|Lebanon|Lesotho|Liberia|Libya|Liechtenstein|Lithuania|Luxembourg|Macau|Madagascar|Malawi|Malaysia|Maldives|Mali|Malta|Marshall Islands|Mauritania|Mauritius|Mexico|Micronesia|Moldova|Monaco|Mongolia|Montenegro|Morocco|Mozambique|Myanmar|Namibia|Nauru|Nepal|Netherlands|New Zealand|Nicaragua|Niger|Nigeria|North Korea|North Macedonia|Norway|Oman|Pakistan|Palau|Palestine|Panama|Papua New Guinea|Paraguay|Peru|Philippines|Poland|Portugal|Puerto Rico|Qatar|Romania|Russia|Rwanda|Saint Kitts and Nevis|Saint Lucia|Saint Vincent and the Grenadines|Samoa|San Marino|Sao Tome and Principe|Saudi Arabia|Senegal|Serbia|Seychelles|Sierra Leone|Singapore|Slovakia|Slovenia|Solomon Islands|Somalia|South Africa|South Korea|South Sudan|Spain|Sri Lanka|Sudan|Suriname|Sweden|Switzerland|Syria|Taiwan|Tajikistan|Tanzania|Thailand|Timor-Leste|Togo|Tonga|Trinidad and Tobago|Tunisia|Turkey|Turkmenistan|Tuvalu|Uganda|Ukraine|United Arab Emirates|United Kingdom|United States|Uruguay|Uzbekistan|Vanuatu|Vatican City|Venezuela|Vietnam|Yemen|Zambia|Zimbabwe").split("|");
const COUNTRY_ALIASES = { uk: "United Kingdom", "great britain": "United Kingdom", england: "United Kingdom", usa: "United States", us: "United States", "united states of america": "United States", uae: "United Arab Emirates", "south korea (republic of korea)": "South Korea", korea: "South Korea", "czech republic": "Czechia", "cote d'ivoire": "Ivory Coast", "türkiye": "Turkey", holland: "Netherlands" };
// A country as typed -> the list's spelling when it is one (UK -> United Kingdom), else as typed.
function canonicalCountry(v) {
  const s = String(v == null ? "" : v).trim();
  if (!s) return "";
  const k = s.toLowerCase();
  return COUNTRY_ALIASES[k] || COUNTRIES.find((c) => c.toLowerCase() === k) || s;
}

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

// "100+ stores", "~2,800", "1.2k" -> the first number in it, or null.
function parseStorePresence(v) {
  const m = /(\d[\d,]*(?:\.\d+)?)\s*([km](?![a-z]))?/i.exec(String(v == null ? "" : v));
  if (!m) return null;
  let n = Number(m[1].replace(/,/g, ""));
  if (!Number.isFinite(n)) return null;
  const unit = (m[2] || "").toLowerCase();
  if (unit === "k") n *= 1000; else if (unit === "m") n *= 1000000;
  return Math.round(n);
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

// A company's LinkedIn page -> https://www.linkedin.com/company/<slug>/ ("" when
// blank; null when it isn't a /company/ or /showcase/ page, e.g. a search URL).
function normaliseLinkedinUrl(v) {
  const s = String(v == null ? "" : v).trim();
  if (!s) return "";
  let u;
  try { u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : `https://${s}`); } catch { return null; }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  const host = u.hostname.toLowerCase();
  if (host !== "linkedin.com" && !host.endsWith(".linkedin.com")) return null;
  const m = /^\/(company|showcase)\/([A-Za-z0-9_%.-]+)(?:\/.*)?$/.exec(u.pathname.replace(/'/g, "%27"));
  if (!m) return null;
  return `https://www.linkedin.com/${m[1].toLowerCase()}/${m[2].toLowerCase()}/`;
}

// The same company is one prospect per country: a name matched ignoring case and spacing.
const companyKey = (name) => String(name == null ? "" : name).toLowerCase().replace(/[^a-z0-9]+/g, "");
function slugId(name) {
  return companyKey(name).slice(0, 60);
}
// Company + country, from the fields. This is what "the same prospect" means.
const prospectKey = (name, country) => `${companyKey(name)}|${companyKey(country)}`;
// The id a NEW record gets. Existing records keep theirs.
const prospectIdFor = (name, country) => `${slugId(name)}-${slugId(country)}`;

// An AWS account ID is exactly 12 digits ("1234-5678-9012" and spaces are tidied
// to "123456789012"). "" when blank; null when it can't be one.
function normaliseAwsAccountId(v) {
  const s = String(v == null ? "" : v).trim();
  if (!s) return "";
  const digits = s.replace(/[\s-]/g, "");
  return /^\d{12}$/.test(digits) ? digits : null;
}
const AWS_ACCOUNT_ID_ERROR = "AWS account ID must be exactly 12 digits.";

const EMAIL_RE = /^[^\s@|]+@[^\s@|]+\.[^\s@|]+$/;
// A contact as stored: awsAccountId and email are only kept when there is one.
function contactOf(c) {
  const out = { name: String(c.name || ""), role: String(c.role || ""), lastContact: String(c.lastContact || "") };
  if (c.awsAccountId) out.awsAccountId = String(c.awsAccountId);
  if (c.email) out.email = String(c.email);
  return out;
}
function contactsFrom(v, errors) {
  const list = Array.isArray(v) ? v : [];
  const out = [];
  for (const c of list) {
    if (!c || typeof c !== "object") continue;
    const name = str(c.name, LIMITS.contactName), role = str(c.role, LIMITS.contactRole), lastContact = str(c.lastContact, LIMITS.contactLast);
    const awsAccountId = normaliseAwsAccountId(c.awsAccountId);
    if (awsAccountId === null) { errors.push(`${name || "A contact"}: ${AWS_ACCOUNT_ID_ERROR}`); continue; }
    const email = str(c.email, LIMITS.contactEmail).toLowerCase();
    if (email && !EMAIL_RE.test(email)) { errors.push(`${name || "A contact"}: that email address isn't valid.`); continue; }
    if (!name && !role && !lastContact && !awsAccountId && !email) continue;
    out.push(contactOf({ name, role, lastContact, awsAccountId, email }));
  }
  if (out.length > LIMITS.contacts) { errors.push(`At most ${LIMITS.contacts} contacts per record.`); return out.slice(0, LIMITS.contacts); }
  return out;
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
  const country = has("country") ? str(x.country, LIMITS.country) : (e ? e.country : "");
  if (!country) errors.push("Country is required: one record per company per country.");
  out.country = country;
  if (has("website")) {
    const w = normaliseUrl(x.website);
    if (w === null) errors.push("Website isn't a valid address."); else out.website = w;
  } else out.website = e ? e.website : "";
  out.industry = has("industry") ? normaliseIndustry(str(x.industry, LIMITS.industry)) : (e ? normaliseIndustry(e.industry) : "");
  out.subIndustry = has("subIndustry") ? str(x.subIndustry, LIMITS.subIndustry) : (e ? e.subIndustry : "");
  out.hqCountry = has("hqCountry") ? str(x.hqCountry, LIMITS.country) : (e ? e.hqCountry : "");
  out.markets = has("markets") ? parseList(x.markets) : (e ? e.markets : []);
  if (out.hqCountry && !out.markets.some((m) => m.toLowerCase() === out.hqCountry.toLowerCase())) out.markets = [out.hqCountry, ...out.markets].slice(0, LIMITS.list);
  if (has("awsRegion")) {
    const r = str(x.awsRegion, LIMITS.region).toLowerCase();
    if (r && !/^[a-z]{2}(-[a-z]+)+-\d$/.test(r)) errors.push(`awsRegion "${x.awsRegion}" isn't an AWS region code like eu-west-2.`); else out.awsRegion = r;
  } else out.awsRegion = e && e.awsRegion ? e.awsRegion : (awsRegionForCountry(out.country) || awsRegionForCountry(out.hqCountry));
  out.storePresence = has("storePresence") ? str(x.storePresence, LIMITS.storePresence) : (e ? e.storePresence : "");
  if (has("storeCount")) {
    const n = parseStoreCount(x.storeCount);
    if (Number.isNaN(n)) errors.push("Store count must be a number."); else out.storeCount = n;
  } else if (has("storePresence")) {
    const n = parseStorePresence(out.storePresence);
    out.storeCount = n != null ? n : (e ? e.storeCount : null);
  } else out.storeCount = e ? e.storeCount : null;
  if (has("sizeBand") && x.sizeBand !== "" && x.sizeBand != null) {
    if (!SIZE_BAND_KEYS.includes(x.sizeBand)) errors.push(`sizeBand must be one of: ${SIZE_BAND_KEYS.join(", ")}.`); else out.sizeBand = x.sizeBand;
  } else out.sizeBand = sizeBandFor(out.storeCount);
  out.ownership = has("ownership") ? str(x.ownership, LIMITS.ownership) : (e ? e.ownership : "");
  if (has("priority")) {
    const pr = String(x.priority == null ? "" : x.priority).trim().toLowerCase();
    if (pr && !PRIORITY_KEYS.includes(pr)) errors.push(`priority must be one of: ${PRIORITY_KEYS.join(", ")}.`); else out.priority = pr;
  } else out.priority = e ? e.priority : "";
  out.insights = has("insights") ? str(x.insights, LIMITS.insights) : (e ? e.insights : "");
  out.decisionMakers = has("decisionMakers") ? str(x.decisionMakers, LIMITS.decisionMakers) : (e ? e.decisionMakers : "");
  if (has("linkedinUrl")) {
    const l = normaliseLinkedinUrl(x.linkedinUrl);
    if (l === null) errors.push("linkedinUrl must be a LinkedIn company page (linkedin.com/company/<name> or /showcase/<name>), not a search or profile link."); else out.linkedinUrl = l;
  } else out.linkedinUrl = e ? e.linkedinUrl : "";
  if (has("linkedinOrgId")) {
    const id = String(x.linkedinOrgId == null ? "" : x.linkedinOrgId).trim();
    if (id && !/^\d{1,20}$/.test(id)) errors.push("linkedinOrgId must be digits only."); else out.linkedinOrgId = id;
  } else out.linkedinOrgId = e ? e.linkedinOrgId : "";
  out.linkedinVerified = has("linkedinVerified") ? (x.linkedinVerified === true || x.linkedinVerified === "true") : (e ? e.linkedinVerified : false);
  if (has("awsAccountId")) {
    const a = normaliseAwsAccountId(x.awsAccountId);
    if (a === null) errors.push(AWS_ACCOUNT_ID_ERROR); else out.awsAccountId = a;
  } else out.awsAccountId = e ? (e.awsAccountId || "") : "";
  out.contacts = has("contacts") ? contactsFrom(x.contacts, errors) : (e ? e.contacts : []);
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
  const marketsList = list(x.markets);
  const hq = String(x.hqCountry || "");
  const country = String(x.country || "").trim() || marketsList[0] || hq;
  const contacts = (Array.isArray(x.contacts) ? x.contacts : []).filter((c) => c && typeof c === "object")
    .map(contactOf).slice(0, LIMITS.contacts);
  return {
    id,
    name: String(x.name || ""),
    country,
    priority: PRIORITY_KEYS.includes(x.priority) ? x.priority : "",
    storePresence: String(x.storePresence || ""),
    ownership: String(x.ownership || ""),
    insights: String(x.insights || ""),
    decisionMakers: String(x.decisionMakers || ""),
    linkedinUrl: String(x.linkedinUrl || ""),
    linkedinOrgId: String(x.linkedinOrgId || ""),
    linkedinVerified: x.linkedinVerified === true,
    awsAccountId: String(x.awsAccountId || ""),
    contacts,
    website: String(x.website || ""),
    industry: normaliseIndustry(x.industry),
    subIndustry: String(x.subIndustry || ""),
    hqCountry: hq,
    markets: marketsList,
    awsRegion: String(x.awsRegion || "") || awsRegionForCountry(country) || awsRegionForCountry(hq),
    storeCount,
    sizeBand: SIZE_BAND_KEYS.includes(x.sizeBand) ? x.sizeBand : sizeBandFor(storeCount),
    vendors: list(x.vendors),
    campaigns: list(x.campaigns),
    status: isStatus(x.status) ? x.status : DEFAULT_STATUS,
    leadId: String(x.leadId || ""),
    source: String(x.source || ""),
    notes: String(x.notes || ""),
    enrichment: x.enrichment && typeof x.enrichment === "object" && !Array.isArray(x.enrichment) ? x.enrichment : null, // written by functions/lead-enrich.js
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
const EMPTY_FILTER = { q: "", industry: "", country: "", priority: "", market: "", awsRegion: "", campaign: "", sizeBand: "", status: "", minStores: "", maxStores: "" };
const FILTER_KEYS = Object.keys(EMPTY_FILTER);

const eq = (a, b) => String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
const hasItem = (list, v) => list.some((x) => eq(x, v));

// Does one prospect pass every filter that is set? A market matches the HQ
// country, the record's country or any country the company operates in.
function matchesFilter(p, f) {
  const x = Object.assign({}, EMPTY_FILTER, f || {});
  if (x.industry && !eq(p.industry, normaliseIndustry(x.industry))) return false;
  if (x.country && !eq(p.country, x.country)) return false;
  if (x.priority && !eq(p.priority, x.priority)) return false;
  if (x.market && !(eq(p.country, x.market) || eq(p.hqCountry, x.market) || hasItem(p.markets, x.market))) return false;
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
    const hay = [p.name, p.website, p.industry, p.subIndustry, p.country, p.hqCountry, p.awsRegion, p.ownership, p.storePresence, p.decisionMakers, ...p.markets, ...p.vendors, ...p.campaigns].join(" ").toLowerCase();
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
    add(market, p.country); add(market, p.hqCountry); p.markets.forEach((m) => add(market, m));
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
  ["Company", (p) => p.name], ["Country", (p) => p.country], ["Website", (p) => p.website], ["Industry", (p) => p.industry], ["Sub-industry", (p) => p.subIndustry],
  ["Priority", (p) => priorityLabel(p.priority)], ["HQ country", (p) => p.hqCountry], ["Other markets", (p) => p.markets.join("; ")], ["AWS region", (p) => p.awsRegion],
  ["Store presence", (p) => p.storePresence], ["Store count", (p) => (p.storeCount == null ? "" : p.storeCount)], ["Size band", (p) => sizeBandLabel(p.sizeBand)],
  ["Ownership", (p) => p.ownership], ["Insights", (p) => p.insights], ["Decision makers", (p) => p.decisionMakers],
  ["Contacts", (p) => p.contacts.map((c) => [c.name, c.role, c.lastContact, c.awsAccountId ? `AWS ${c.awsAccountId}` : "", c.email || ""].filter(Boolean).join(" / ")).join("; ")],
  ["AWS account ID", (p) => p.awsAccountId || ""],
  ["LinkedIn page", (p) => p.linkedinUrl], ["LinkedIn org id", (p) => p.linkedinOrgId], ["LinkedIn verified", (p) => (p.linkedinVerified ? "yes" : "")],
  ["Current vendors", (p) => p.vendors.join("; ")], ["Campaigns", (p) => p.campaigns.join("; ")], ["Status", (p) => statusLabel(p.status)],
  ["Source", (p) => p.source], ["Lead", (p) => p.leadId],
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

// ── LinkedIn Campaign Manager: Matched Audiences company list ─────────────
// The template's headers, in its order. Blank where unknown; companycountry is the
// record's country; the email domain is the website's host.
const siteHost = (w) => { try { return new URL(w).hostname.replace(/^www\./i, ""); } catch { return ""; } };
const LINKEDIN_COLUMNS = [
  ["companyname", (p) => p.name], ["companywebsite", (p) => p.website], ["companyemaildomain", (p) => siteHost(p.website)],
  ["linkedincompanypageurl", (p) => p.linkedinUrl], ["stocksymbol", () => ""], ["industry", (p) => p.industry],
  ["city", () => ""], ["state", () => ""], ["companycountry", (p) => p.country], ["zipcode", () => ""],
];
function toLinkedInCsv(rows) {
  const lines = [LINKEDIN_COLUMNS.map(([h]) => h).join(",")];
  for (const p of rows || []) lines.push(LINKEDIN_COLUMNS.map(([, get]) => csvCell(get(p))).join(","));
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
      countries: (p.country ? [p.country] : p.markets.length ? p.markets : p.hqCountry ? [p.hqCountry] : []).slice(0, 60),
      storeCount: p.storeCount, awsAccountId: p.awsAccountId || "",
    },
    contacts: [], stage: "lead", source: LEAD_SOURCE, assignee: String(email || "").toLowerCase(), customerAccount: null,
    prospectId: p.id,
  };
}

// ── Inbound leads → Prospects (TAM) (10 Nov 2026) ─────────────────────────
// A lead that comes in (the website form, or New lead on the Leads page) is
// matched to a TAM record using both the company name and the contact's
// business email domain (against the record's name and website), in the
// country the lead gives (any country when it gives none). No match: a new TAM
// record is made for that company and country, marked for enrichment. One lead
// per TAM record, so a second person from the same company and country joins
// that lead as a contact. Anyone from AWS is a contact on the AWS record, never
// a customer lead. Used by functions/lead-ingest.js and public/js/leads-page.js.
const FREE_EMAIL_DOMAINS = ["gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "hotmail.co.uk", "live.com", "live.co.uk", "msn.com", "yahoo.com", "yahoo.co.uk", "ymail.com", "icloud.com", "me.com", "mac.com", "aol.com", "proton.me", "protonmail.com", "gmx.com", "gmx.de", "mail.com", "zoho.com", "btinternet.com", "sky.com", "virginmedia.com", "web.de", "orange.fr", "free.fr", "qq.com", "163.com"];
function emailDomain(email) {
  const m = String(email == null ? "" : email).trim().toLowerCase().match(/@([a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,})$/);
  return m ? m[1].replace(/^www\./, "") : "";
}
// The domain of a work address; "" for a personal mailbox (gmail.com, outlook.com...).
function businessDomain(email) {
  const d = emailDomain(email);
  return d && !FREE_EMAIL_DOMAINS.includes(d) ? d : "";
}
function websiteHost(website) {
  const s = String(website == null ? "" : website).trim();
  if (!s) return "";
  try { return new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : `https://${s}`).hostname.toLowerCase().replace(/^www\./, ""); } catch { return ""; }
}
// The same organisation's domain: equal, or one inside the other (uk.acme.com and acme.com).
const sameDomain = (a, b) => Boolean(a && b) && (a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`));
// An AWS or Amazon address (aws.com, amazon.com, amazon.co.uk, amazon.de...).
const isAwsDomain = (d) => /(^|\.)(aws\.com|amazon\.(com|[a-z]{2}|co\.[a-z]{2}|com\.[a-z]{2}))$/.test(String(d == null ? "" : d).toLowerCase());
const AWS_PROSPECT_ID = "aws";
const AWS_COMPANY_KEYS = ["aws", "amazonwebservices"];
const isAwsProspect = (p) => Boolean(p) && (p.id === AWS_PROSPECT_ID || AWS_COMPANY_KEYS.includes(companyKey(p.name)));
const INBOUND_SOURCE = "Inbound lead";
const sameCountry = (a, b) => canonicalCountry(a).toLowerCase() === canonicalCountry(b).toLowerCase();

// The TAM record an inbound lead belongs to. rows are normalised prospects.
// Returns { prospect, how } ("name and email domain" | "email domain" | "name"),
// or { prospect: null, sameCompany } where sameCompany is the best match in
// another country (a template for that company's new country record), or null.
function matchProspect(rows, { name, email, country } = {}) {
  const nk = companyKey(name);
  const dom = businessDomain(email);
  const scored = [];
  for (const p of rows || []) {
    if (!p || isAwsProspect(p)) continue;
    const byName = Boolean(nk) && companyKey(p.name) === nk;
    const byDomain = Boolean(dom) && sameDomain(dom, websiteHost(p.website));
    if (byName || byDomain) scored.push({ p, score: (byDomain ? 2 : 0) + (byName ? 1 : 0) });
  }
  const best = (list) => list.slice().sort((a, b) => (b.score - a.score)
    || (Number(Boolean(b.p.leadId)) - Number(Boolean(a.p.leadId)))
    || (Number(sameCountry(b.p.country, b.p.hqCountry)) - Number(sameCountry(a.p.country, a.p.hqCountry)))
    || ((a.p.createdAtMs || 0) - (b.p.createdAtMs || 0)) || String(a.p.id).localeCompare(String(b.p.id)))[0] || null;
  const how = (s) => (s.score === 3 ? "name and email domain" : s.score === 2 ? "email domain" : "name");
  const want = canonicalCountry(country);
  const pick = best(want ? scored.filter((s) => sameCountry(s.p.country, want)) : scored);
  if (pick) return { prospect: pick.p, how: how(pick), sameCompany: null };
  const other = best(scored);
  return { prospect: null, how: "", sameCompany: other ? other.p : null };
}

// A new TAM record for an inbound lead's company in `country` ("" when the lead
// gave none), copying the company's name, website and industry from its record
// in another country when there is one. { id, fields } or null when it can't be one.
function prospectForInbound(company, country, template) {
  const c = company || {};
  const t = template || null;
  const where = canonicalCountry(country);
  const name = str(t ? t.name : c.name, LIMITS.name);
  if (!slugId(name)) return null;
  const input = { name, country: where || "-", website: (t && t.website) || c.website || "", industry: (t && t.industry) || c.industry || "", status: DEFAULT_STATUS, source: INBOUND_SOURCE };
  if (t) { input.subIndustry = t.subIndustry; input.hqCountry = t.hqCountry; input.markets = t.markets; }
  if (typeof c.storeCount === "number") input.storeCount = c.storeCount;
  const r = prospectFromInput(input);
  if (r.errors.length) return null;
  const fields = r.fields;
  if (!where) { fields.country = ""; fields.awsRegion = awsRegionForCountry(fields.hqCountry); }
  return { id: where ? prospectIdFor(name, where) : slugId(name), fields };
}

// The AWS record, made the first time someone from AWS comes in.
function awsProspectFields() {
  return { ...prospectFromInput({ name: "AWS", country: "-", website: "https://aws.amazon.com", status: "engaged", source: "AWS" }).fields, country: "", awsRegion: "" };
}
// An AWS person as a contact on the AWS record; lastContact is the day they came in (YYYY-MM-DD).
function awsContactFrom(contact, day) {
  const k = contact || {};
  return contactOf({ name: str(k.name, LIMITS.contactName), role: str(k.jobTitle || k.role, LIMITS.contactRole), lastContact: str(day, LIMITS.contactLast), email: str(k.email, LIMITS.contactEmail).toLowerCase() });
}
// Adds (or refreshes, matched on email, else name) one contact; keeps the newest 30.
function mergeContact(contacts, c) {
  const list = (contacts || []).map(contactOf);
  const same = (x) => (c.email ? String(x.email || "").toLowerCase() === c.email : companyKey(x.name) === companyKey(c.name));
  const i = list.findIndex(same);
  if (i >= 0) { const was = list.splice(i, 1)[0]; list.push(contactOf({ ...was, ...Object.fromEntries(Object.entries(c).filter(([, v]) => v)) })); }
  else list.push(c);
  return list.slice(-LIMITS.contacts);
}

// What to write for one inbound lead. prospects: normalised prospects; leads:
// normalised leads (leads-core normaliseLead); company: the lead's company
// fields; contact: the person who came in (or null). Returns one of
//   { kind: "aws", prospectId, prospect|null, createProspect: fields|null }
//   { kind: "lead", prospectId, prospect|null, createProspect: fields|null, how,
//     leadId, lead|null (the existing lead to add the contact to), linkProspect }
//   { kind: "none" }  (a name with no letters or digits: no TAM record can hold it)
function planInbound({ prospects, leads, company, contact } = {}) {
  const c = company || {};
  const email = (contact && contact.email) || "";
  const country = (Array.isArray(c.countries) && c.countries[0]) || "";
  if (isAwsDomain(emailDomain(email)) || AWS_COMPANY_KEYS.includes(companyKey(c.name))) {
    const aws = (prospects || []).find(isAwsProspect) || null;
    return { kind: "aws", prospectId: aws ? aws.id : AWS_PROSPECT_ID, prospect: aws, createProspect: aws ? null : awsProspectFields() };
  }
  const m = matchProspect(prospects, { name: c.name, email, country });
  let prospect = m.prospect;
  let createProspect = null;
  let prospectId = prospect ? prospect.id : "";
  if (!prospect) {
    const n = prospectForInbound(c, country, m.sameCompany);
    if (!n) return { kind: "none" };
    const clash = (prospects || []).find((p) => p.id === n.id);
    if (clash) { prospect = clash; prospectId = clash.id; } else { createProspect = n.fields; prospectId = n.id; }
  }
  const name = prospect ? prospect.name : createProspect.name;
  const where = prospect ? prospect.country : createProspect.country;
  // Network operator inquiries (leadType "franchise") are people, not companies: never a company's lead.
  const live = (leads || []).filter((l) => l && !l.test && l.leadType !== "franchise");
  const lead = (prospect && prospect.leadId && live.find((l) => l.id === prospect.leadId))
    || live.find((l) => l.prospectId === prospectId)
    || live.find((l) => !l.prospectId && companyKey(l.company.name) === companyKey(name)
      && (!where || !l.company.countries.length || l.company.countries.some((x) => sameCountry(x, where))))
    || null;
  const leadId = lead ? lead.id : leadIdForProspect(prospectId);
  return { kind: "lead", prospectId, prospect, createProspect, how: prospect ? (m.prospect ? m.how : "id") : "new", leadId, lead, linkProspect: !prospect || prospect.leadId !== leadId || prospect.status !== "converted" };
}

module.exports = { STATUSES, STATUS_KEYS, DEFAULT_STATUS, statusLabel, isStatus, SIZE_BANDS, SIZE_BAND_KEYS, sizeBandLabel, sizeBandFor, LIMITS, PRIORITIES, PRIORITY_KEYS, priorityLabel, INDUSTRIES, INDUSTRY_LABELS, UNASSIGNED_INDUSTRY, normaliseIndustry, COUNTRIES, canonicalCountry, AWS_REGIONS, awsRegionForCountry, parseList, parseStorePresence, parseStoreCount, normaliseUrl, normaliseLinkedinUrl, companyKey, slugId, prospectKey, prospectIdFor, normaliseAwsAccountId, AWS_ACCOUNT_ID_ERROR, prospectFromInput, normaliseProspect, EMPTY_FILTER, FILTER_KEYS, matchesFilter, filterProspects, isFilterEmpty, filterOptions, sanitiseSavedFilters, withSavedFilter, CSV_COLUMNS, csvCell, toCsv, LINKEDIN_COLUMNS, toLinkedInCsv, leadIdForProspect, LEAD_SOURCE, leadFieldsFromProspect, FREE_EMAIL_DOMAINS, emailDomain, businessDomain, websiteHost, sameDomain, isAwsDomain, AWS_PROSPECT_ID, AWS_COMPANY_KEYS, isAwsProspect, INBOUND_SOURCE, matchProspect, prospectForInbound, awsProspectFields, awsContactFrom, mergeContact, planInbound };
