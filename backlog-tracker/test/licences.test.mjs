// public/js/licences-core.js — Promote › License Manager's rules: reading the
// GetAgreementContacts answer, linking a licence to Prospects (TAM) and Leads,
// the review queue and the won-lead rows. Pure functions, no DOM.
// Run: node test/licences.test.mjs
import assert from "node:assert/strict";
import {
  normaliseAgreementContacts, buyerOf, normaliseLicence, emailFormatDomains, companyDomainIndex,
  matchLicence, buildRows, reviewQueue, summary, onboardingOf, syncStatusView, MATCH,
} from "../public/js/licences-core.js";
import { normaliseProspect } from "../public/js/prospects-core.js";
import { normaliseLead } from "../public/js/leads-core.js";

const prospect = (id, d) => normaliseProspect(id, { status: "new", ...d });
const PROSPECTS = [
  prospect("acme-united-kingdom", { name: "Acme Retail", country: "United Kingdom", website: "https://www.acme-retail.example", leadId: "prospect-acme-united-kingdom" }),
  prospect("acme-germany", { name: "Acme Retail", country: "Germany", website: "acme-retail.example" }),
  prospect("globex-australia", { name: "Globex", country: "Australia", website: "globex.example", awsAccountId: "111122223333" }),
  prospect("initech-united-states", { name: "Initech", country: "United States", website: "initech.example" }),
  prospect("aws", { name: "AWS", country: "United States", website: "aws.example" }),
];
const LEADS = [
  normaliseLead("prospect-acme-united-kingdom", { company: { name: "Acme Retail", countries: ["United Kingdom"] }, stage: "closed-won", prospectId: "acme-united-kingdom", contacts: [{ name: "Ann", email: "ann@acme-retail.example" }] }),
  normaliseLead("prospect-umbrella", { company: { name: "Umbrella", countries: ["France"], awsAccountId: "999988887777" }, stage: "closed-won", prospectId: "umbrella-france", contacts: [{ name: "Ula", email: "ula@umbrella.example" }] }),
  normaliseLead("prospect-hooli", { company: { name: "Hooli", countries: ["United States"] }, stage: "closed-won", contacts: [{ name: "Hal", email: "hal@hooli.example" }] }),
  normaliseLead("prospect-test", { company: { name: "Test Co" }, stage: "closed-won", test: true }),
];
const lic = (id, d) => normaliseLicence(id, { agreementId: id, ...d });
const raw = (contacts) => JSON.stringify({ agreementContacts: contacts });

// ── GetAgreementContacts, read defensively ──
assert.deepEqual(normaliseAgreementContacts(raw([{ name: "Ann Smith", emailAddress: "Ann@Acme-Retail.example", companyName: "Acme Retail", country: "GB" }])),
  [{ name: "Ann Smith", email: "ann@acme-retail.example", company: "Acme Retail", country: "GB", role: "" }]);
assert.deepEqual(normaliseAgreementContacts({ Contacts: [{ FirstName: "Bo", LastName: "Li", EmailAddress: "bo@x.example", CompanyName: "X", CountryCode: "AU", ContactType: "Buyer" }] }),
  [{ name: "Bo Li", email: "bo@x.example", company: "X", country: "AU", role: "Buyer" }], "PascalCase and first/last names");
assert.deepEqual(normaliseAgreementContacts({ email: "c@y.example", company: "Y" }).map((c) => c.email), ["c@y.example"], "an answer that is one contact");
assert.deepEqual(normaliseAgreementContacts([{ email: "d@z.example" }]).map((c) => c.email), ["d@z.example"], "an answer that is a list");
assert.deepEqual(normaliseAgreementContacts("not json"), []);
assert.deepEqual(normaliseAgreementContacts(""), []);
assert.deepEqual(normaliseAgreementContacts({ contacts: [{}, null, { role: "x" }] }), [], "empty contacts are dropped");
assert.equal(buyerOf([{ email: "a@gmail.com" }, { email: "b@acme-retail.example" }]).email, "b@acme-retail.example", "a business address is preferred");
assert.equal(buyerOf([]), null);

// ── Email formats on a company profile ──
assert.deepEqual(emailFormatDomains(["first.last@Initech.example", "{first}@initech.example", "@corp.initech.example", "initech-mail.example", "junk", ""]),
  ["initech.example", "corp.initech.example", "initech-mail.example"]);
const companies = [{ id: "initech", data: { name: "Initech", profile: { emailFormats: ["first.last@initech-mail.example"] } } }];
assert.deepEqual(companyDomainIndex(companies).get("initech"), ["initech-mail.example"]);

// ── Matching ──
const ctx = { prospects: PROSPECTS, leads: LEADS.filter((l) => !l.test), domainIndex: companyDomainIndex(companies) };

// Name and business email domain, in the buyer's country: linked, with that record's lead.
let m = matchLicence(lic("agmt-acme", { contactsRaw: raw([{ name: "Ann", email: "ann@acme-retail.example", companyName: "ACME retail Ltd", country: "Germany" }]) }), ctx);
assert.equal(m.status, MATCH.review, "'ACME retail Ltd' is not the same company key as 'Acme Retail': name doesn't match, domain only");
m = matchLicence(lic("agmt-acme", { contactsRaw: raw([{ name: "Ann", email: "ann@uk.acme-retail.example", companyName: "Acme Retail", country: "United Kingdom" }]) }), ctx);
assert.equal(m.status, MATCH.linked);
assert.equal(m.prospect.id, "acme-united-kingdom", "the buyer's country picks the country record (a subdomain counts)");
assert.equal(m.how, "Company name and email domain");
assert.equal(m.lead.id, "prospect-acme-united-kingdom", "the TAM record's lead");
m = matchLicence(lic("agmt-acme-de", { contactsRaw: raw([{ email: "jo@acme-retail.example", companyName: "Acme Retail", country: "Germany" }]) }), ctx);
assert.equal(m.prospect.id, "acme-germany");
assert.equal(m.lead, null, "no lead on the German record");

// An email format on the company profile counts as the company's domain.
m = matchLicence(lic("agmt-initech", { contactsRaw: raw([{ email: "pat.lee@initech-mail.example", companyName: "Initech" }]) }), ctx);
assert.equal(m.status, MATCH.linked);
assert.equal(m.prospect.id, "initech-united-states");

// The buyer's AWS account ID on a TAM record, then on a lead.
m = matchLicence(lic("agmt-globex", { awsAccountId: "111122223333", contactsRaw: raw([{ email: "x@gmail.com", companyName: "Someone else" }]) }), ctx);
assert.equal(m.status, MATCH.linked);
assert.equal(m.prospect.id, "globex-australia");
assert.equal(m.how, "AWS account ID");

// Name only, domain only and nothing: the review queue, with suggestions.
m = matchLicence(lic("agmt-name", { contactsRaw: raw([{ email: "someone@gmail.com", companyName: "Globex" }]) }), ctx);
assert.equal(m.status, MATCH.review);
assert.deepEqual(m.suggestions.map((s) => [s.prospect.id, s.how]), [["globex-australia", "Company name only"]]);
m = matchLicence(lic("agmt-domain", { contactsRaw: raw([{ email: "it@initech.example", companyName: "Initech Holdings" }]) }), ctx);
assert.equal(m.status, MATCH.review);
assert.deepEqual(m.suggestions.map((s) => s.how), ["Email domain only"]);
m = matchLicence(lic("agmt-none", { contactsRaw: raw([{ email: "a@nowhere.example", companyName: "Nowhere" }]) }), ctx);
assert.equal(m.status, MATCH.review);
assert.equal(m.how, "No TAM company found");
assert.deepEqual(m.suggestions, []);
m = matchLicence(lic("agmt-aws", { contactsRaw: raw([{ email: "x@aws.example", companyName: "AWS" }]) }), ctx);
assert.equal(m.status, MATCH.review, "the AWS record is never a customer");

// A person's link wins over everything, and a link to a record that's gone falls back.
m = matchLicence(lic("agmt-none", { manualLink: { prospectId: "globex-australia", by: "ed@ph.example" }, contactsRaw: raw([{ email: "a@nowhere.example" }]) }), ctx);
assert.equal(m.status, MATCH.linked);
assert.equal(m.how, "Linked by hand");
m = matchLicence(lic("agmt-none", { manualLink: { prospectId: "deleted" }, contactsRaw: raw([{ email: "a@nowhere.example" }]) }), ctx);
assert.equal(m.status, MATCH.review);

// ── Onboarding ──
assert.equal(onboardingOf({ status: MATCH.linked }, { email: "a@b.example" }), "ready");
assert.equal(onboardingOf({ status: MATCH.linked }, null), "needs-contact");
assert.equal(onboardingOf({ status: MATCH.review }, { email: "a@b.example" }), "");

// ── Rows: licences, then won leads without an agreement ──
const licences = [
  lic("agmt-acme", { awsAccountId: "123456789012", status: "ACTIVE", contactsRaw: raw([{ name: "Ann", email: "ann@acme-retail.example", companyName: "Acme Retail", country: "United Kingdom" }]) }),
  lic("agmt-none", { contactsRaw: raw([{ name: "Nia", email: "nia@nowhere.example", companyName: "Nowhere" }]) }),
];
const rows = buildRows({ licences, prospects: PROSPECTS, leads: LEADS, companies });
const acme = rows.find((r) => r.id === "agmt-acme");
assert.deepEqual([acme.company, acme.contactName, acme.contactEmail, acme.awsAccountId, acme.match, acme.prospectName, acme.leadId, acme.onboarding],
  ["Acme Retail", "Ann", "ann@acme-retail.example", "123456789012", "linked", "Acme Retail", "prospect-acme-united-kingdom", "ready"],
  "the licence shows the company and contact, linked to the TAM company and lead, not by account ID only");
const awaiting = rows.filter((r) => r.match === MATCH.awaiting).map((r) => r.leadId).sort();
assert.deepEqual(awaiting, ["prospect-hooli", "prospect-umbrella"], "won leads with no licence are listed; one with a licence and test leads are not");
assert.deepEqual(reviewQueue(rows).map((r) => r.id), ["agmt-none"]);
assert.deepEqual(summary(rows), { licences: 2, linked: 1, review: 1, awaiting: 2, ready: 1 });

// A won lead whose AWS account ID is on the agreement is the licence's row, not an awaiting one.
const umbrella = buildRows({ licences: [lic("agmt-umb", { awsAccountId: "999988887777" })], prospects: [...PROSPECTS, prospect("umbrella-france", { name: "Umbrella", country: "France", leadId: "prospect-umbrella" })], leads: LEADS });
assert.equal(umbrella.find((r) => r.id === "agmt-umb").leadId, "prospect-umbrella");
assert.ok(!umbrella.some((r) => r.id === "lead:prospect-umbrella"));

// ── The licence doc ──
const n = normaliseLicence("agmt-1", { awsAccountId: "1234-5678-9012", startTime: "2026-11-01T00:00:00Z", manualLink: { prospectId: "", by: "x" } });
assert.equal(n.awsAccountId, "123456789012");
assert.equal(n.manualLink, null, "an empty manual link is no link");
assert.ok(n.startMs > 0);

// ── Sync status ──
assert.equal(syncStatusView(null).state, "never");
assert.equal(syncStatusView({ lastSyncAt: "2026-11-20T10:00:00Z", count: 3 }).text, "3 agreements synced.");
assert.equal(syncStatusView({ lastSyncAt: "2026-11-20T10:00:00Z", count: 1, contactErrors: 1 }).state, "partial");
const failed = syncStatusView({ lastSyncAt: "2026-11-20T10:00:00Z", lastErrorAt: "2026-11-21T10:00:00Z", lastError: "AccessDeniedException: no" });
assert.equal(failed.state, "error");
assert.match(failed.text, /AccessDeniedException/);

console.log("licences.test.mjs: ok");
