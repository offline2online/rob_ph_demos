// GENERATED from public/js/leads-core.js by test/leads-core-copy.mjs.
// Do not edit: change the source and run  node test/leads-core-copy.mjs --write
"use strict";
// Promote › Leads: the data rules behind the page (leads-page.js) and, as a
// generated CommonJS copy, the MCP tools (functions/leads.js). Pure functions
// only: no DOM, no Firestore, so test/leads.test.mjs drives them directly.
//
// One document per company in `leads/{id}`:
//   company        { name, website, industry, countries[], storeCount|null, awsAccountId (12 digits or "") }
//   contacts[]     { id, name, jobTitle, buyingRole, email, linkedin, awsAccountId (12 digits or ""), enrichment? }
//   stage          one of STAGES
//   source         where it came from ("Website form", "Manual", ...)
//   assignee       a member's email, or ""
//   customerAccount { id, name } once the lead has converted, else null
//   prospectId     the Prospects (TAM) record it was converted from, else absent
//   enrichment     { at, by, techStack[], summary, sources[{source,status,message}] }
//   test           true for a lead submitted with the website's test flag
//   sourceLabel / sourceDetail  which website form ("Interactive product tour – Telco") and demo ("Personalisation"), "" when not sent
//   websiteActivity[]  { at (ISO), label, detail, page }, every website submission, the 20 newest
//   sourcePage / sourceIndustry  the page and industry a website lead came from
//   createdAt / updatedAt / stageChangedAt / createdByEmail / updatedByEmail

const STAGES = [
  { key: "lead", label: "Lead" },
  { key: "hot-lead", label: "Hot Lead" },
  { key: "demo", label: "Demo" },
  { key: "post-demo", label: "Post-demo" },
  { key: "closed-won", label: "Closed Won" },
  { key: "closed-lost", label: "Lost" },
];
const STAGE_KEYS = STAGES.map((s) => s.key);
const DEFAULT_STAGE = "lead";

const BUYING_ROLES = [
  { key: "decision-maker", label: "Decision maker" },
  { key: "champion", label: "Champion" },
  { key: "influencer", label: "Influencer" },
  { key: "technical-evaluator", label: "Technical evaluator" },
  { key: "procurement", label: "Procurement" },
];
const BUYING_ROLE_KEYS = BUYING_ROLES.map((r) => r.key);

const LIMITS = { name: 120, website: 300, industry: 120, source: 80, sourceLabel: 120, sourceDetail: 120, activity: 20, jobTitle: 120, email: 200, linkedin: 300, countries: 60, contacts: 25, country: 60 };

const stageLabel = (key) => (STAGES.find((s) => s.key === key) || { label: String(key || "") }).label;
const roleLabel = (key) => (BUYING_ROLES.find((r) => r.key === key) || { label: "" }).label;
const isStage = (key) => STAGE_KEYS.includes(key);
const isClosed = (stage) => stage === "closed-won" || stage === "closed-lost";

const str = (v, max) => String(v == null ? "" : v).trim().slice(0, max);

// "UK, France ; Germany" -> ["UK","France","Germany"] (no duplicates, in order).
function parseCountries(v) {
  const parts = Array.isArray(v) ? v : String(v == null ? "" : v).split(/[,;\n]/);
  const seen = new Set();
  const out = [];
  for (const p of parts) {
    const c = str(p, LIMITS.country);
    if (c && !seen.has(c.toLowerCase())) { seen.add(c.toLowerCase()); out.push(c); }
  }
  return out.slice(0, LIMITS.countries);
}

function parseStoreCount(v) {
  if (v === "" || v == null) return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[,\s]/g, ""));
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : NaN;
}

// A website or LinkedIn address as typed ("example.com") -> a full https URL,
// "" when blank, null when it can't be one.
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

// An AWS account ID is exactly 12 digits ("1234-5678-9012" and spaces are tidied
// to "123456789012"). "" when blank; null when it can't be one.
function normaliseAwsAccountId(v) {
  const s = String(v == null ? "" : v).trim();
  if (!s) return "";
  const digits = s.replace(/[\s-]/g, "");
  return /^\d{12}$/.test(digits) ? digits : null;
}

function newContactId() { return `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`; }

function blankContact() {
  return { id: newContactId(), name: "", jobTitle: "", buyingRole: "", email: "", linkedin: "", awsAccountId: "" };
}

function blankLead(email = "") {
  return {
    company: { name: "", website: "", industry: "", countries: [], storeCount: null, awsAccountId: "" },
    contacts: [blankContact()],
    stage: DEFAULT_STAGE, source: "Manual", assignee: email || "", customerAccount: null,
  };
}

// The text fields of the form -> the document's fields, or { errors }.
// `form` is what the page gathers: countries as a string, storeCount as typed.
function leadFromForm(form) {
  const errors = [];
  const f = form || {};
  const name = str(f.name, LIMITS.name);
  if (!name) errors.push("Company name is required.");
  const website = normaliseUrl(f.website);
  if (website === null) errors.push("Website isn't a valid address.");
  const storeCount = parseStoreCount(f.storeCount);
  if (Number.isNaN(storeCount)) errors.push("Store count must be a number.");
  const companyAws = normaliseAwsAccountId(f.awsAccountId);
  if (companyAws === null) errors.push("Company AWS account ID must be exactly 12 digits.");
  const stage = f.stage == null || f.stage === "" ? DEFAULT_STAGE : f.stage;
  if (!isStage(stage)) errors.push("Pick a stage from the list.");
  const contacts = [];
  const rows = Array.isArray(f.contacts) ? f.contacts : [];
  if (rows.length > LIMITS.contacts) errors.push(`A lead holds up to ${LIMITS.contacts} contacts.`);
  rows.forEach((c, i) => {
    const row = c || {};
    const cname = str(row.name, LIMITS.name);
    const blank = !cname && !str(row.email, LIMITS.email) && !str(row.jobTitle, LIMITS.jobTitle) && !str(row.linkedin, LIMITS.linkedin) && !str(row.awsAccountId, 20);
    if (blank) return; // an untouched row is not a contact
    if (!cname) { errors.push(`Contact ${i + 1} needs a name.`); return; }
    const email = str(row.email, LIMITS.email);
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push(`${cname}: that email address isn't valid.`);
    const linkedin = normaliseUrl(row.linkedin);
    if (linkedin === null) errors.push(`${cname}: LinkedIn isn't a valid address.`);
    const awsAccountId = normaliseAwsAccountId(row.awsAccountId);
    if (awsAccountId === null) errors.push(`${cname}: AWS account ID must be exactly 12 digits.`);
    const buyingRole = row.buyingRole || "";
    if (buyingRole && !BUYING_ROLE_KEYS.includes(buyingRole)) errors.push(`${cname}: pick a buying role from the list.`);
    const contact = { id: str(row.id, 40) || newContactId(), name: cname, jobTitle: str(row.jobTitle, LIMITS.jobTitle), buyingRole, email, linkedin: linkedin || "", awsAccountId: awsAccountId || "" };
    if (row.enrichment && typeof row.enrichment === "object") contact.enrichment = row.enrichment;
    contacts.push(contact);
  });
  if (errors.length) return { errors };
  return {
    errors: [],
    fields: {
      company: { name, website: website || "", industry: str(f.industry, LIMITS.industry), countries: parseCountries(f.countries), storeCount, awsAccountId: companyAws || "" },
      contacts,
      stage,
      source: str(f.source, LIMITS.source) || "Manual",
      assignee: str(f.assignee, LIMITS.email).toLowerCase(),
    },
  };
}

// A website form submission -> a lead's fields (Field mapping is the Leads
// form's own: the same names, so nothing is re-keyed). Accepts the lead form's
// keys (name/company, website, industry, countries, storeCount, contactName,
// jobTitle, email, linkedin) plus page, industry and test. `test` is true for
// true/"1"/"true"/"yes"/"on". Returns { errors } or { errors: [], fields, contact, test }.
// GA4 ids the website captured from the visitor's _ga cookies (ph-website PH GA4 snippet), so offline ACE stage changes
// can be sent to GA4 by Measurement Protocol (functions/ace-ga4.js). Validated, never invented: no consent, no id.
const GA_CLIENT_ID = /^\d{1,20}\.\d{9,11}$/;
const GA_SESSION_ID = /^\d{9,11}$/;
function gaEntryFromWebsite(p, at) {
  const x = p || {};
  const clientId = String(x.gaClientId || x.ga_client_id || "").trim();
  if (!GA_CLIENT_ID.test(clientId)) return null;
  const sessionId = String(x.gaSessionId || x.ga_session_id || "").trim();
  return { clientId, sessionId: GA_SESSION_ID.test(sessionId) ? sessionId : "", leadSource: str(x.leadSource || x.lead_source, LIMITS.source), at: at || new Date().toISOString() };
}
// Newest last, one row per clientId (a repeat refreshes it), the 10 newest kept.
function mergeGaClientIds(list, entry) {
  const rows = (Array.isArray(list) ? list : []).filter((r) => r && GA_CLIENT_ID.test(String(r.clientId || "")));
  if (!entry) return rows.slice(-10);
  return [...rows.filter((r) => r.clientId !== entry.clientId), entry].slice(-10);
}
const truthy = (v) => v === true || ["1", "true", "yes", "on"].includes(String(v == null ? "" : v).trim().toLowerCase());
function leadFromWebsite(p) {
  const x = p || {};
  const test = truthy(x.test);
  const contactName = str(x.contactName || x.contact_name || x.fullName || x.full_name, LIMITS.name);
  const r = leadFromForm({
    name: x.company || x.companyName || x.company_name || x.name,
    website: x.website, industry: x.industry, countries: x.countries || x.country, storeCount: x.storeCount || x.stores,
    contacts: [{ name: contactName || String(x.email || "").split("@")[0], jobTitle: x.jobTitle || x.job_title, email: x.email, linkedin: x.linkedin }],
    stage: DEFAULT_STAGE, source: "Website", assignee: "",
  });
  if (r.errors.length) return { errors: r.errors };
  const page = str(x.page || x.pageUrl || x.page_url, 300);
  return {
    errors: [], test,
    fields: {
      ...r.fields, source: "website", sourcePage: page, sourceIndustry: str(x.pageIndustry || x.page_industry || x.industry, LIMITS.industry), test,
      sourceLabel: str(x.sourceLabel || x.source_label, LIMITS.sourceLabel), sourceDetail: str(x.sourceDetail || x.source_detail, LIMITS.sourceDetail),
    },
    contact: r.fields.contacts[0] || null,
  };
}

// A stored document, tolerant of anything an older writer left out.
function normaliseLead(id, d) {
  const x = d || {};
  const c = x.company || {};
  return {
    id,
    company: {
      name: String(c.name || ""), website: String(c.website || ""), industry: String(c.industry || ""),
      countries: Array.isArray(c.countries) ? c.countries.map(String) : [],
      storeCount: typeof c.storeCount === "number" ? c.storeCount : null,
      awsAccountId: String(c.awsAccountId || ""),
    },
    contacts: (Array.isArray(x.contacts) ? x.contacts : []).map((k) => ({
      id: String((k && k.id) || ""), name: String((k && k.name) || ""), jobTitle: String((k && k.jobTitle) || ""),
      buyingRole: String((k && k.buyingRole) || ""), email: String((k && k.email) || ""), linkedin: String((k && k.linkedin) || ""),
      awsAccountId: String((k && k.awsAccountId) || ""),
      enrichment: k && k.enrichment && typeof k.enrichment === "object" ? k.enrichment : null,
    })),
    stage: isStage(x.stage) ? x.stage : DEFAULT_STAGE,
    source: String(x.source || ""),
    assignee: String(x.assignee || ""),
    test: x.test === true,
    sourcePage: String(x.sourcePage || ""),
    sourceIndustry: String(x.sourceIndustry || ""),
    sourceLabel: String(x.sourceLabel || ""),
    sourceDetail: String(x.sourceDetail || ""),
    gaClientIds: mergeGaClientIds(x.gaClientIds, null),
    websiteActivity: (Array.isArray(x.websiteActivity) ? x.websiteActivity : []).filter((a) => a && typeof a === "object")
      .map((a) => ({ at: typeof a.at === "string" ? a.at : "", atMs: ms(a.at), label: String(a.label || ""), detail: String(a.detail || ""), page: String(a.page || "") })),
    prospectId: String(x.prospectId || ""),
    customerAccount: x.customerAccount && typeof x.customerAccount === "object" ? { id: String(x.customerAccount.id || ""), name: String(x.customerAccount.name || "") } : null,
    enrichment: x.enrichment && typeof x.enrichment === "object" ? x.enrichment : null,
    tam: x.tam && typeof x.tam === "object" && !Array.isArray(x.tam) ? x.tam : null, // read-only: no TAM data model yet
    updatedAtMs: ms(x.updatedAt), createdAtMs: ms(x.createdAt), stageChangedAtMs: ms(x.stageChangedAt),
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

// { lead: [..], "hot-lead": [..], ... }: newest change first inside a lane.
function groupByStage(leads) {
  const lanes = Object.fromEntries(STAGE_KEYS.map((k) => [k, []]));
  for (const l of leads || []) (lanes[l.stage] || lanes[DEFAULT_STAGE]).push(l);
  for (const k of STAGE_KEYS) lanes[k].sort((a, b) => (b.updatedAtMs - a.updatedAtMs) || a.company.name.localeCompare(b.company.name));
  return lanes;
}

// A lead may only be marked converted by naming the customer account it became.
function conversionFields(account) {
  const a = account || {};
  const name = str(a.name, LIMITS.name);
  const id = str(a.id, 100);
  if (!name && !id) return { error: "Name the customer account this lead became (a name, an id, or both)." };
  return { fields: { stage: "closed-won", customerAccount: { id, name: name || id } } };
}

// What the enrichment run adds to a company's own fields: only blanks are
// filled, so a figure a person typed is never overwritten. Returns the
// company fields to write and the keys that changed.
function mergeCompanyEnrichment(company, found) {
  const c = company || {};
  const f = found || {};
  const out = { ...c };
  const changed = [];
  if (!c.storeCount && typeof f.storeCount === "number" && f.storeCount > 0) { out.storeCount = f.storeCount; changed.push("storeCount"); }
  if ((!c.industry) && f.industry) { out.industry = str(f.industry, LIMITS.industry); changed.push("industry"); }
  const have = new Set((c.countries || []).map((x) => x.toLowerCase()));
  const add = parseCountries(f.countries || []).filter((x) => !have.has(x.toLowerCase()));
  if (add.length) { out.countries = [...(c.countries || []), ...add].slice(0, LIMITS.countries); changed.push("countries"); }
  if (!c.website && f.website) { out.website = f.website; changed.push("website"); }
  return { company: out, changed };
}

// A short line for a card: "250 stores · UK, France".
function companyLine(l) {
  const parts = [];
  if (l.company.storeCount != null) parts.push(`${l.company.storeCount.toLocaleString("en-GB")} ${l.company.storeCount === 1 ? "store" : "stores"}`);
  if (l.company.countries.length) parts.push(l.company.countries.slice(0, 3).join(", ") + (l.company.countries.length > 3 ? ` +${l.company.countries.length - 3}` : ""));
  return parts.join(" · ");
}

module.exports = { STAGES, STAGE_KEYS, DEFAULT_STAGE, BUYING_ROLES, BUYING_ROLE_KEYS, LIMITS, stageLabel, roleLabel, isStage, isClosed, parseCountries, parseStoreCount, normaliseUrl, normaliseAwsAccountId, newContactId, blankContact, blankLead, leadFromForm, gaEntryFromWebsite, mergeGaClientIds, truthy, leadFromWebsite, normaliseLead, groupByStage, conversionFields, mergeCompanyEnrichment, companyLine };
