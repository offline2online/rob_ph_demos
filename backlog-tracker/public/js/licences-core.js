// Promote › License Manager (#promote/license-manager): the rules behind
// licences-page.js. Pure functions only (no DOM, no Firestore), so
// test/licences.test.mjs drives them directly.
//
// A licence is one AWS Marketplace agreement for the product, written by the
// server sync (functions/marketplace-agreements.js) into `licences/{id}`:
//   agreementId, awsAccountId (the buyer's AWS account), status, agreementType,
//   offerId, productIds[], startTime, endTime (ISO strings), contactsRaw (the
//   GetAgreementContacts answer as JSON text, kept raw so a change in its shape
//   is a change to normaliseAgreementContacts here, never a re-sync),
//   contactsError, syncedAt, syncedBy, and manualLink { prospectId, by, at } | null
//   (a person's link from the review queue, written by the server route).
//
// The link to Prospects (TAM) and Leads is worked out here, every time the
// page draws, from the current TAM records, so a record added or corrected
// later links the licence with no re-sync:
//   1. a person's manual link;
//   2. the buyer's AWS account ID on a TAM record, a TAM contact or a lead;
//   3. the buyer's company name AND business email domain, where the domain
//      matches the record's website or an email format on the company's
//      profile (prospectCompanies/{id}.profile.emailFormats).
// Anything weaker (name only, domain only, nothing) goes to the review queue,
// with the name-only or domain-only records offered as suggestions: a wrong
// automatic link is worse than one a person confirms.
import { companyKey, slugId, businessDomain, websiteHost, sameDomain, canonicalCountry, isAwsProspect } from "./prospects-core.js";

export const MATCH = { linked: "linked", review: "review", awaiting: "awaiting" };
export const MATCH_LABELS = { linked: "Linked", review: "Needs review", awaiting: "Awaiting agreement" };
export const ONBOARDING_LABELS = { ready: "Ready for onboarding", "needs-contact": "No buyer contact", "": "" };
export const WON_STAGE = "closed-won";

const str = (v, max = 300) => String(v == null ? "" : v).trim().slice(0, max);
const firstOf = (o, keys) => {
  for (const k of keys) {
    const v = o && o[k];
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return "";
};
const msOf = (v) => {
  if (!v) return 0;
  if (typeof v.toMillis === "function") return v.toMillis();
  if (typeof v === "object" && typeof v.seconds === "number") return v.seconds * 1000;
  const t = Date.parse(String(v));
  return Number.isFinite(t) ? t : 0;
};
const awsId = (v) => String(v == null ? "" : v).replace(/\D/g, "").slice(0, 12);

// ── GetAgreementContacts → contacts ─────────────────────────────────────
// The answer's exact shape could not be checked against a live call yet, so it
// is read defensively: the list under any of the likely keys (or the answer
// itself as a list, or as one contact), camelCase or PascalCase fields.
const LIST_KEYS = ["contacts", "Contacts", "agreementContacts", "AgreementContacts", "buyerContacts", "BuyerContacts", "items", "Items"];
function contactList(raw) {
  if (Array.isArray(raw)) return raw;
  if (!raw || typeof raw !== "object") return [];
  for (const k of LIST_KEYS) if (Array.isArray(raw[k])) return raw[k];
  for (const k of ["contact", "Contact", "buyerContact", "BuyerContact"]) if (raw[k] && typeof raw[k] === "object") return [raw[k]];
  return firstOf(raw, ["email", "Email", "emailAddress", "EmailAddress"]) ? [raw] : [];
}
export function normaliseAgreementContacts(raw) {
  let data = raw;
  if (typeof data === "string") {
    try { data = data ? JSON.parse(data) : null; } catch { data = null; }
  }
  const out = [];
  for (const c of contactList(data)) {
    if (!c || typeof c !== "object") continue;
    const first = str(firstOf(c, ["firstName", "FirstName", "givenName", "GivenName"]), 80);
    const last = str(firstOf(c, ["lastName", "LastName", "familyName", "FamilyName"]), 80);
    const name = str(firstOf(c, ["name", "Name", "fullName", "FullName", "contactName", "ContactName"]), 160) || [first, last].filter(Boolean).join(" ");
    const email = str(firstOf(c, ["email", "Email", "emailAddress", "EmailAddress"]), 200).toLowerCase();
    const company = str(firstOf(c, ["companyName", "CompanyName", "company", "Company", "organization", "Organization", "organizationName", "OrganizationName"]), 200);
    const country = str(firstOf(c, ["country", "Country", "countryCode", "CountryCode"]), 60);
    const role = str(firstOf(c, ["role", "Role", "contactType", "ContactType", "type", "Type"]), 60);
    if (!name && !email && !company) continue;
    out.push({ name, email, company, country, role });
  }
  return out;
}

// The contact the licence is shown with: the first with a business address,
// then the first with any address, then the first.
export function buyerOf(contacts) {
  const list = Array.isArray(contacts) ? contacts : [];
  return list.find((c) => businessDomain(c.email)) || list.find((c) => c.email) || list[0] || null;
}

// ── Firestore doc → licence ─────────────────────────────────────────────
export function normaliseLicence(id, d) {
  const x = d || {};
  const m = x.manualLink && typeof x.manualLink === "object" ? x.manualLink : null;
  const contacts = normaliseAgreementContacts(x.contactsRaw);
  return {
    id: String(id),
    agreementId: str(x.agreementId, 120) || String(id),
    awsAccountId: awsId(x.awsAccountId),
    status: str(x.status, 40),
    agreementType: str(x.agreementType, 60),
    offerId: str(x.offerId, 120),
    productIds: Array.isArray(x.productIds) ? x.productIds.map((p) => str(p, 120)).filter(Boolean) : [],
    startMs: msOf(x.startTime), endMs: msOf(x.endTime),
    contacts,
    buyer: buyerOf(contacts),
    contactsError: str(x.contactsError, 300),
    manualLink: m && str(m.prospectId, 200) ? { prospectId: str(m.prospectId, 200), by: str(m.by, 200), atMs: msOf(m.at) } : null,
    syncedAtMs: msOf(x.syncedAt),
  };
}

// ── Email formats on a TAM company's profile → domains ──────────────────
// "first.last@acme.com", "{first}.{last}@acme.com", "@acme.com" or "acme.com".
export function emailFormatDomains(formats) {
  const out = [];
  for (const f of Array.isArray(formats) ? formats : []) {
    const s = String(f == null ? "" : f).trim().toLowerCase();
    const d = (s.includes("@") ? s.slice(s.lastIndexOf("@") + 1) : s).replace(/^www\./, "").replace(/[>\s)\]]+$/, "");
    if (/^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/.test(d) && !out.includes(d)) out.push(d);
  }
  return out;
}
// prospectCompanies docs ({ id, data }) → Map(company doc id → [domains]).
export function companyDomainIndex(companies) {
  const map = new Map();
  for (const c of Array.isArray(companies) ? companies : []) {
    const d = c && (c.data || c);
    const domains = emailFormatDomains(d && d.profile && d.profile.emailFormats);
    if (domains.length) map.set(String(c.id || slugId(d.name)), domains);
  }
  return map;
}

// ── Matching ────────────────────────────────────────────────────────────
const sameCountry = (a, b) => Boolean(a && b) && canonicalCountry(a).toLowerCase() === canonicalCountry(b).toLowerCase();
const domainsOf = (p, domainIndex) => {
  const out = [];
  const host = websiteHost(p.website);
  if (host) out.push(host);
  for (const d of (domainIndex && domainIndex.get(slugId(p.name))) || []) if (!out.includes(d)) out.push(d);
  return out;
};
const leadFor = (p, leads) => (p ? (leads.find((l) => p.leadId && l.id === p.leadId) || leads.find((l) => l.prospectId === p.id) || null) : null);

// Scores every TAM record against the licence's buyer: name = 1, domain = 2.
export function scoreProspects(licence, prospects, domainIndex) {
  const b = licence.buyer || {};
  const nk = companyKey(b.company);
  const dom = businessDomain(b.email);
  const want = canonicalCountry(b.country);
  const scored = [];
  for (const p of prospects || []) {
    if (!p || isAwsProspect(p)) continue;
    const byName = Boolean(nk) && companyKey(p.name) === nk;
    const byDomain = Boolean(dom) && domainsOf(p, domainIndex).some((d) => sameDomain(dom, d));
    if (byName || byDomain) scored.push({ prospect: p, score: (byDomain ? 2 : 0) + (byName ? 1 : 0), byName, byDomain });
  }
  return scored.sort((x, y) => (y.score - x.score)
    || (Number(sameCountry(y.prospect.country, want)) - Number(sameCountry(x.prospect.country, want)))
    || (Number(Boolean(y.prospect.leadId)) - Number(Boolean(x.prospect.leadId)))
    || String(x.prospect.id).localeCompare(String(y.prospect.id)));
}
const howOf = (s) => (s.byName && s.byDomain ? "Company name and email domain" : s.byDomain ? "Email domain only" : "Company name only");

// { status, how, prospect, lead, suggestions[{ prospect, how }] }
export function matchLicence(licence, { prospects = [], leads = [], domainIndex = new Map() } = {}) {
  const linked = (prospect, how, lead) => ({ status: MATCH.linked, how, prospect, lead: lead || leadFor(prospect, leads), suggestions: [] });
  if (licence.manualLink) {
    const p = prospects.find((x) => x.id === licence.manualLink.prospectId);
    if (p) return linked(p, "Linked by hand");
  }
  const acct = licence.awsAccountId;
  if (acct) {
    const p = prospects.find((x) => !isAwsProspect(x) && (x.awsAccountId === acct || (x.contacts || []).some((c) => c.awsAccountId === acct)));
    if (p) return linked(p, "AWS account ID");
    const l = leads.find((x) => x.company && x.company.awsAccountId === acct);
    if (l) {
      const lp = prospects.find((x) => x.id === l.prospectId || (l.id && x.leadId === l.id)) || null;
      if (lp) return linked(lp, "AWS account ID on the lead", l);
    }
  }
  const scored = scoreProspects(licence, prospects, domainIndex);
  if (scored.length && scored[0].score === 3) return linked(scored[0].prospect, howOf(scored[0]));
  return { status: MATCH.review, how: scored.length ? howOf(scored[0]) : "No TAM company found", prospect: null, lead: null,
    suggestions: scored.slice(0, 3).map((s) => ({ prospect: s.prospect, how: howOf(s) })) };
}

// "ready" when the licence is linked and has a buyer to contact; "needs-contact" when linked without one.
export function onboardingOf(match, buyer) {
  if (!match || match.status !== MATCH.linked) return "";
  return buyer && buyer.email ? "ready" : "needs-contact";
}

// ── Rows for the page ───────────────────────────────────────────────────
// One row per licence, then one per won lead that no licence is linked to yet.
export function buildRows({ licences = [], prospects = [], leads = [], companies = [] } = {}) {
  const domainIndex = companyDomainIndex(companies);
  const live = leads.filter((l) => l && !l.archived && !l.test);
  const rows = licences.map((lic) => {
    const m = matchLicence(lic, { prospects, leads: live, domainIndex });
    const b = lic.buyer || {};
    return {
      id: lic.id, kind: "licence", agreementId: lic.agreementId, awsAccountId: lic.awsAccountId, agreementStatus: lic.status,
      company: b.company || (m.prospect ? m.prospect.name : ""), contactName: b.name || "", contactEmail: b.email || "", country: b.country || "",
      match: m.status, how: m.how,
      prospectId: m.prospect ? m.prospect.id : "", prospectName: m.prospect ? m.prospect.name : "", prospectCountry: m.prospect ? m.prospect.country : "",
      leadId: m.lead ? m.lead.id : "", leadName: m.lead ? (m.lead.company && m.lead.company.name) || "" : "", leadStage: m.lead ? m.lead.stage : "",
      onboarding: onboardingOf(m, b), suggestions: m.suggestions, contactsError: lic.contactsError, manual: !!lic.manualLink,
      startMs: lic.startMs, endMs: lic.endMs,
    };
  });
  const withLicence = new Set(rows.map((r) => r.leadId).filter(Boolean));
  for (const l of live) {
    if (l.stage !== WON_STAGE || withLicence.has(l.id)) continue;
    const c = (l.contacts || []).find((k) => k.email) || (l.contacts || [])[0] || {};
    const p = prospects.find((x) => x.id === l.prospectId) || null;
    rows.push({
      id: `lead:${l.id}`, kind: "lead", agreementId: "", awsAccountId: awsId(l.company && l.company.awsAccountId), agreementStatus: "",
      company: (l.company && l.company.name) || "", contactName: c.name || "", contactEmail: c.email || "", country: ((l.company && l.company.countries) || [])[0] || "",
      match: MATCH.awaiting, how: "Won lead with no agreement yet",
      prospectId: p ? p.id : "", prospectName: p ? p.name : "", prospectCountry: p ? p.country : "",
      leadId: l.id, leadName: (l.company && l.company.name) || "", leadStage: l.stage,
      onboarding: "", suggestions: [], contactsError: "", manual: false, startMs: 0, endMs: 0,
    });
  }
  return rows;
}

export const reviewQueue = (rows) => (rows || []).filter((r) => r.kind === "licence" && r.match === MATCH.review);

export function summary(rows) {
  const list = rows || [];
  const lic = list.filter((r) => r.kind === "licence");
  return {
    licences: lic.length,
    linked: lic.filter((r) => r.match === MATCH.linked).length,
    review: lic.filter((r) => r.match === MATCH.review).length,
    awaiting: list.filter((r) => r.match === MATCH.awaiting).length,
    ready: lic.filter((r) => r.onboarding === "ready").length,
  };
}

// The sync's status doc (consoleConfig/licenceSync) → what the page says at the top.
export function syncStatusView(d) {
  const x = d || {};
  const okAt = msOf(x.lastSyncAt), errAt = msOf(x.lastErrorAt);
  if (!okAt && !errAt) return { state: "never", text: "Not synced from AWS Marketplace yet." };
  if (errAt && errAt >= okAt) return { state: "error", text: `The last sync from AWS Marketplace failed: ${str(x.lastError, 240) || "no reason given"}.`, atMs: errAt };
  const n = Number(x.count) || 0;
  const missing = Number(x.contactErrors) || 0;
  return { state: missing ? "partial" : "ok", atMs: okAt,
    text: `${n} ${n === 1 ? "agreement" : "agreements"} synced${missing ? `; contacts couldn't be read for ${missing}` : ""}.` };
}
