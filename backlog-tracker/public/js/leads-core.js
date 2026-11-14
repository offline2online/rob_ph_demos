// Promote › Leads: the data rules behind the page (leads-page.js) and, as a
// generated CommonJS copy, the MCP tools (functions/leads.js). Pure functions
// only: no DOM, no Firestore, so test/leads.test.mjs drives them directly.
//
// One document per company (or, for a network operator inquiry, per person) in `leads/{id}`:
//   leadType       "company" (the default, a retail/company lead) or "operator" (an individual
//                  asking about becoming a network operator, from the Run Your Own RMN page's
//                  product tour gate; shown as "Network operator inquiry")
//   company        { name, website, industry, countries[], storeCount|null, awsAccountId (12 digits or "") }
//                  (name is required for a company lead; a network operator inquiry usually has none)
//   operator       { region, background, audience } on a network operator inquiry: where they plan to
//                  operate, their background (a BACKGROUNDS key) and who they are (an AUDIENCES key,
//                  "I am" on the form; "" on a lead that predates it); the person is the lead's single contact
//   contacts[]     { id, name, jobTitle, buyingRole, email, linkedin, awsAccountId (12 digits or ""), enrichment? }
//   stage          one of STAGES (a company lead) or OPERATOR_STAGES (a network operator inquiry)
//   source         where it came from ("Website form", "Manual", ...)
//   assignee       a member's email, or ""
//   customerAccount { id, name } once the lead has converted, else null
//   prospectId     the Prospects (TAM) record it belongs to (converted from, or matched when it came in), else absent
//   inboundCount   how many times someone from this company and country came in (website form or New lead)
//   enrichment     { at, by, techStack[], summary, sources[{source,status,message}] }
//   test           true for a lead submitted with the website's test flag
//   sourceLabel / sourceDetail  which website form ("Interactive product tour – Telco") and demo ("Personalisation"), "" when not sent
//   websiteActivity[]  { at (ISO), label, detail, page }, every website submission, the 20 newest
//   sourcePage / sourceIndustry  the page and industry a website lead came from
//   history[]      { at (ISO), by (email), kind, text }, the newest 100: notes and every change an agent or the board made
//   archivedAt / archivedByEmail  set when archived (recoverable); the board hides an archived lead
//   createdAt / updatedAt / stageChangedAt / createdByEmail / updatedByEmail

export const STAGES = [
  { key: "lead", label: "Lead" },
  { key: "hot-lead", label: "Hot Lead" },
  { key: "demo", label: "Demo" },
  { key: "post-demo", label: "Post-demo" },
  { key: "closed-won", label: "Closed Won" },
  { key: "closed-lost", label: "Lost" },
];
export const STAGE_KEYS = STAGES.map((s) => s.key);
export const DEFAULT_STAGE = "lead";

// Network operator inquiries (key "operator") are individuals, not companies: their own type and
// their own pipeline, so they are never mixed with retail/company leads.
export const LEAD_TYPES = [
  { key: "company", label: "Retail / company" },
  { key: "operator", label: "Network operator inquiry" },
];
export const LEAD_TYPE_KEYS = LEAD_TYPES.map((t) => t.key);
export const DEFAULT_LEAD_TYPE = "company";
export const OPERATOR_STAGES = [
  { key: "applied", label: "Applied" },
  { key: "screening", label: "Screening" },
  { key: "intro-call", label: "Intro call" },
  { key: "approved", label: "Approved" },
  { key: "not-a-fit", label: "Not a fit" },
];
export const OPERATOR_STAGE_KEYS = OPERATOR_STAGES.map((s) => s.key);
export const OPERATOR_DEFAULT_STAGE = "applied";
export const ALL_STAGE_KEYS = [...STAGE_KEYS, ...OPERATOR_STAGE_KEYS];
// "Your background" on the Run Your Own RMN page's gate form.
export const BACKGROUNDS = [
  { key: "agency", label: "Agency media or account management" },
  { key: "adtech", label: "Ad-tech sales or partnerships" },
  { key: "retail-media", label: "Retail media" },
  { key: "creative-agency", label: "Creative agency" },
  { key: "retail-owner", label: "Retail business owner or manager" },
  { key: "marketing", label: "Marketing" },
  { key: "other", label: "Something else" },
];
// "I am" on the same form: who is asking.
export const AUDIENCES = [
  { key: "individual", label: "An individual operator" },
  { key: "team", label: "Part of an operator team" },
  { key: "retailer", label: "A small to medium retailer" },
];
export const OPERATOR_SOURCE_LABEL = "Run Your Own RMN page – product tour";

export const BUYING_ROLES = [
  { key: "decision-maker", label: "Decision maker" },
  { key: "champion", label: "Champion" },
  { key: "influencer", label: "Influencer" },
  { key: "technical-evaluator", label: "Technical evaluator" },
  { key: "procurement", label: "Procurement" },
];
export const BUYING_ROLE_KEYS = BUYING_ROLES.map((r) => r.key);

export const HISTORY_LIMIT = 100;
export const NOTE_MAX = 2000;
export const LIMITS = { region: 200, name: 120, website: 300, industry: 120, source: 80, sourceLabel: 120, sourceDetail: 120, activity: 20, jobTitle: 120, email: 200, linkedin: 300, countries: 60, contacts: 25, country: 60 };

export const stageLabel = (key) => ([...STAGES, ...OPERATOR_STAGES].find((s) => s.key === key) || { label: String(key || "") }).label;
export const roleLabel = (key) => (BUYING_ROLES.find((r) => r.key === key) || { label: "" }).label;
// Any stage of either pipeline; isStageFor checks the lead's own pipeline.
export const isStage = (key) => ALL_STAGE_KEYS.includes(key);
export const isClosed = (stage) => stage === "closed-won" || stage === "closed-lost" || stage === "approved" || stage === "not-a-fit";

// "operator" (the network operator type) for anything naming an operator as a word
// ("operator", "network operator", "Network operator inquiry"), else "company".
// The website sends "operator". No other key is accepted for this type.
export const leadTypeOf = (v) => (/\boperator\b/i.test(String(v == null ? "" : v)) ? "operator" : DEFAULT_LEAD_TYPE);
export const leadTypeLabel = (key) => (LEAD_TYPES.find((t) => t.key === key) || LEAD_TYPES[0]).label;
export const stagesFor = (type) => (type === "operator" ? OPERATOR_STAGES : STAGES);
export const defaultStageFor = (type) => (type === "operator" ? OPERATOR_DEFAULT_STAGE : DEFAULT_STAGE);
export const isStageFor = (type, key) => stagesFor(type).some((s) => s.key === key);
// A background as the form sends it (its key or its label, any case) -> its key;
// "" when blank; "other" for anything else.
export function backgroundKey(v) {
  const s = String(v == null ? "" : v).trim().toLowerCase();
  if (!s) return "";
  const hit = BACKGROUNDS.find((b) => b.key === s || b.label.toLowerCase() === s);
  return hit ? hit.key : "other";
}
export const backgroundLabel = (key) => (BACKGROUNDS.find((b) => b.key === key) || { label: "" }).label;
// "I am" as the form sends it (its key or its label, any case) -> its key;
// "" when blank or not one of the options.
export function audienceKey(v) {
  const s = String(v == null ? "" : v).trim().toLowerCase();
  const hit = s && AUDIENCES.find((a) => a.key === s || a.label.toLowerCase() === s);
  return hit ? hit.key : "";
}
export const audienceLabel = (key) => (AUDIENCES.find((a) => a.key === key) || { label: "" }).label;
// What a card and the drawer call a lead: the company, or for a network operator inquiry the person.
export function leadName(l) {
  const c = (l && l.company) || {};
  if (c.name) return c.name;
  const p = l && Array.isArray(l.contacts) ? l.contacts[0] : null;
  return (p && (p.name || p.email)) || "Unnamed lead";
}

const str = (v, max) => String(v == null ? "" : v).trim().slice(0, max);

// "UK, France ; Germany" -> ["UK","France","Germany"] (no duplicates, in order).
export function parseCountries(v) {
  const parts = Array.isArray(v) ? v : String(v == null ? "" : v).split(/[,;\n]/);
  const seen = new Set();
  const out = [];
  for (const p of parts) {
    const c = str(p, LIMITS.country);
    if (c && !seen.has(c.toLowerCase())) { seen.add(c.toLowerCase()); out.push(c); }
  }
  return out.slice(0, LIMITS.countries);
}

export function parseStoreCount(v) {
  if (v === "" || v == null) return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[,\s]/g, ""));
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : NaN;
}

// A website or LinkedIn address as typed ("example.com") -> a full https URL,
// "" when blank, null when it can't be one.
export function normaliseUrl(v) {
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
export function normaliseAwsAccountId(v) {
  const s = String(v == null ? "" : v).trim();
  if (!s) return "";
  const digits = s.replace(/[\s-]/g, "");
  return /^\d{12}$/.test(digits) ? digits : null;
}

export function newContactId() { return `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`; }

export function blankContact() {
  return { id: newContactId(), name: "", jobTitle: "", buyingRole: "", email: "", linkedin: "", awsAccountId: "" };
}

export function blankLead(email = "", type = DEFAULT_LEAD_TYPE) {
  const leadType = type === "operator" ? "operator" : DEFAULT_LEAD_TYPE;
  return {
    leadType,
    company: { name: "", website: "", industry: "", countries: [], storeCount: null, awsAccountId: "" },
    contacts: [blankContact()],
    ...(leadType === "operator" ? { operator: { region: "", background: "", audience: "" } } : {}),
    stage: defaultStageFor(leadType), source: "Manual", assignee: email || "", customerAccount: null,
  };
}

// The text fields of the form -> the document's fields, or { errors }.
// `form` is what the page gathers: countries as a string, storeCount as typed.
// leadType "operator" (an individual): no company name is needed, the person
// is the first contact and must have a name, and region/background/audience are kept.
export function leadFromForm(form) {
  const errors = [];
  const f = form || {};
  const leadType = f.leadType === "operator" ? "operator" : DEFAULT_LEAD_TYPE;
  const operator = leadType === "operator";
  const name = str(f.name, LIMITS.name);
  if (!name && !operator) errors.push("Company name is required.");
  const website = normaliseUrl(f.website);
  if (website === null) errors.push("Website isn't a valid address.");
  const storeCount = parseStoreCount(f.storeCount);
  if (Number.isNaN(storeCount)) errors.push("Store count must be a number.");
  const companyAws = normaliseAwsAccountId(f.awsAccountId);
  if (companyAws === null) errors.push("Company AWS account ID must be exactly 12 digits.");
  const stage = f.stage == null || f.stage === "" ? defaultStageFor(leadType) : f.stage;
  if (!isStageFor(leadType, stage)) errors.push("Pick a stage from the list.");
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
  if (operator && !contacts.length && !errors.length) errors.push("Give the person's name.");
  if (errors.length) return { errors };
  return {
    errors: [],
    fields: {
      leadType,
      company: { name, website: website || "", industry: str(f.industry, LIMITS.industry), countries: parseCountries(f.countries), storeCount, awsAccountId: companyAws || "" },
      contacts,
      ...(operator ? { operator: { region: str(f.region, LIMITS.region), background: backgroundKey(f.background), audience: audienceKey(f.audience) } } : {}),
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
// lead_type (or leadType) "operator" / "Network operator inquiry" is the Run Your Own
// RMN page's gate: see operatorFromWebsite.
export const truthy = (v) => v === true || ["1", "true", "yes", "on"].includes(String(v == null ? "" : v).trim().toLowerCase());
export function leadFromWebsite(p) {
  const x = p || {};
  if (leadTypeOf(x.lead_type || x.leadType) === "operator") return operatorFromWebsite(x);
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

// The Run Your Own RMN page's product tour gate -> a network operator inquiry: an individual,
// no company. Fields: full_name (or fullName/contactName/name), email,
// linkedin (optional; an address that isn't one is dropped rather than losing
// the lead), operating_region (or operatingRegion/region/where_operate/location),
// background (a BACKGROUNDS key or label), audience ("I am": an AUDIENCES key or label), lead_source (stored as sourceLabel,
// "Run Your Own RMN page – product tour" when not sent), page and test.
export function operatorFromWebsite(p) {
  const x = p || {};
  const test = truthy(x.test);
  const email = str(x.email, LIMITS.email);
  const name = str(x.full_name || x.fullName || x.contactName || x.contact_name || x.name, LIMITS.name) || email.split("@")[0];
  const errors = [];
  if (!name) errors.push("Give the person's name or email.");
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push("That email address isn't valid.");
  if (errors.length) return { errors };
  const contact = { id: newContactId(), name, jobTitle: "", buyingRole: "", email, linkedin: normaliseUrl(x.linkedin || x.linkedIn || x.linkedin_url) || "", awsAccountId: "" };
  const region = str(x.operating_region || x.operatingRegion || x.region || x.where_operate || x.whereOperate || x.location, LIMITS.region);
  return {
    errors: [], test, contact,
    fields: {
      leadType: "operator",
      company: { name: "", website: "", industry: "", countries: [], storeCount: null, awsAccountId: "" },
      contacts: [contact],
      operator: { region, background: backgroundKey(x.background), audience: audienceKey(x.audience) },
      stage: OPERATOR_DEFAULT_STAGE, source: "website", assignee: "",
      sourcePage: str(x.page || x.pageUrl || x.page_url, 300), sourceIndustry: "", test,
      sourceLabel: str(x.lead_source || x.leadSource || x.sourceLabel || x.source_label, LIMITS.sourceLabel) || OPERATOR_SOURCE_LABEL,
      sourceDetail: str(x.sourceDetail || x.source_detail, LIMITS.sourceDetail),
    },
  };
}

// A stored document, tolerant of anything an older writer left out.
export function normaliseLead(id, d) {
  const x = d || {};
  const c = x.company || {};
  const leadType = x.leadType === "operator" ? "operator" : DEFAULT_LEAD_TYPE;
  const fr = x.operator && typeof x.operator === "object" ? x.operator : {};
  return {
    id,
    leadType,
    operator: leadType === "operator" ? { region: String(fr.region || ""), background: String(fr.background || ""), audience: audienceKey(fr.audience) } : null,
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
    stage: isStageFor(leadType, x.stage) ? x.stage : defaultStageFor(leadType),
    source: String(x.source || ""),
    assignee: String(x.assignee || ""),
    test: x.test === true,
    sourcePage: String(x.sourcePage || ""),
    sourceIndustry: String(x.sourceIndustry || ""),
    sourceLabel: String(x.sourceLabel || ""),
    sourceDetail: String(x.sourceDetail || ""),
    websiteActivity: (Array.isArray(x.websiteActivity) ? x.websiteActivity : []).filter((a) => a && typeof a === "object")
      .map((a) => ({ at: typeof a.at === "string" ? a.at : "", atMs: ms(a.at), label: String(a.label || ""), detail: String(a.detail || ""), page: String(a.page || "") })),
    prospectId: String(x.prospectId || ""),
    // Older leads have no count: their website submissions are what came in.
    inboundCount: typeof x.inboundCount === "number" && x.inboundCount > 0 ? Math.round(x.inboundCount) : (Array.isArray(x.websiteActivity) ? x.websiteActivity.length : 0),
    archived: !!x.archivedAt,
    history: (Array.isArray(x.history) ? x.history : []).filter((h) => h && typeof h === "object")
      .map((h) => ({ at: typeof h.at === "string" ? h.at : "", atMs: ms(h.at), by: String(h.by || ""), kind: String(h.kind || ""), text: String(h.text || "") })),
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
// type "operator" gives the operator pipeline's lanes; pass only that type's leads.
export function groupByStage(leads, type = DEFAULT_LEAD_TYPE) {
  const keys = stagesFor(type).map((s) => s.key);
  const lanes = Object.fromEntries(keys.map((k) => [k, []]));
  for (const l of leads || []) (lanes[l.stage] || lanes[defaultStageFor(type)]).push(l);
  for (const k of keys) lanes[k].sort((a, b) => (b.updatedAtMs - a.updatedAtMs) || leadName(a).localeCompare(leadName(b)));
  return lanes;
}

// One line of a lead's history, and the list after adding it (newest last, capped).
export function historyEntry(by, kind, text, at) {
  return { at: at || new Date().toISOString(), by: str(by, LIMITS.email), kind: str(kind, 30), text: str(text, NOTE_MAX) };
}
export function appendHistory(history, entry) {
  const list = Array.isArray(history) ? history.filter((h) => h && typeof h === "object") : [];
  return [...list, entry].slice(-HISTORY_LIMIT);
}

// A lead may only be marked converted by naming the customer account it became.
export function conversionFields(account) {
  const a = account || {};
  const name = str(a.name, LIMITS.name);
  const id = str(a.id, 100);
  if (!name && !id) return { error: "Name the customer account this lead became (a name, an id, or both)." };
  return { fields: { stage: "closed-won", customerAccount: { id, name: name || id } } };
}

// What the enrichment run adds to a company's own fields: only blanks are
// filled, so a figure a person typed is never overwritten. Returns the
// company fields to write and the keys that changed.
export function mergeCompanyEnrichment(company, found) {
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

// Someone else from a lead's company and country came in: keep what the lead
// has, fill its blank company fields, add each new contact (one already there,
// same email, else same name, is not added twice) and count the arrival.
// `cur` is the normalised lead; `fields` the incoming lead's fields. Returns
// { company, contacts, inboundCount, added } (added: how many contacts were new).
export function mergeInbound(cur, fields, newContacts) {
  const f = fields || {};
  const fc = f.company || {};
  const contacts = cur.contacts.map(({ enrichment, ...c }) => (enrichment ? { ...c, enrichment } : c));
  let added = 0;
  for (const c of newContacts || []) {
    if (!c || !c.name) continue;
    const dup = contacts.some((k) => (c.email && k.email && k.email.toLowerCase() === c.email.toLowerCase()) || (!c.email && k.name.toLowerCase() === c.name.toLowerCase()));
    if (!dup) { contacts.push(c); added++; }
  }
  const company = { ...cur.company };
  for (const k of ["website", "industry", "awsAccountId"]) if (!company[k] && fc[k]) company[k] = fc[k];
  if (company.storeCount == null && typeof fc.storeCount === "number") company.storeCount = fc.storeCount;
  company.countries = parseCountries([...company.countries, ...(fc.countries || [])]);
  return { company, contacts: contacts.slice(0, LIMITS.contacts), inboundCount: (cur.inboundCount || 0) + 1, added };
}

// "3 inbound" on a card and the summary; "" when nobody has come in.
export const inboundLabel = (l) => (l && l.inboundCount ? `${l.inboundCount} inbound` : "");

// A short line for a card: "250 stores · UK, France"; for a network operator inquiry
// "I am · Where they plan to operate · Background".
export function companyLine(l) {
  if (l && l.leadType === "operator") {
    const f = l.operator || {};
    return [audienceLabel(f.audience), f.region, backgroundLabel(f.background)].filter(Boolean).join(" · ");
  }
  const parts = [];
  if (l.company.storeCount != null) parts.push(`${l.company.storeCount.toLocaleString("en-GB")} ${l.company.storeCount === 1 ? "store" : "stores"}`);
  if (l.company.countries.length) parts.push(l.company.countries.slice(0, 3).join(", ") + (l.company.countries.length > 3 ? ` +${l.company.countries.length - 3}` : ""));
  return parts.join(" · ");
}
