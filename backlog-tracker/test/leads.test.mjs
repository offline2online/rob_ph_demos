// Unit tests for Promote › Leads: public/js/leads-core.js (the rules the page
// and the MCP tools share) and its generated CommonJS copy.   node leads.test.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import * as L from "../public/js/leads-core.js";
import { buildCopy } from "./leads-core-copy.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
let n = 0;
import * as P from "../public/js/industry-palette.js";
const t = (name, fn) => { fn(); n++; console.log(`  ok  ${name}`); };

t("the stages are the pipeline in order, ending in Closed Won and Lost", () => {
  assert.deepEqual(L.STAGES.map((s) => s.label), ["Lead", "Hot Lead", "Demo", "Post-demo", "Closed Won", "Lost"]);
  assert.equal(L.DEFAULT_STAGE, "lead");
});
t("the buying roles are the five the spec names", () => {
  assert.deepEqual(L.BUYING_ROLES.map((r) => r.label), ["Decision maker", "Champion", "Influencer", "Technical evaluator", "Procurement"]);
});
t("a complete form becomes a lead; blank contact rows are ignored", () => {
  const r = L.leadFromForm({
    name: " Acme Retail ", website: "acme.example", industry: "Grocery", countries: "UK, France; uk", storeCount: "1,200",
    contacts: [{ name: "Jo Bloggs", jobTitle: "CTO", buyingRole: "decision-maker", email: "jo@acme.example", linkedin: "linkedin.com/in/jo" }, { name: "", email: "" }],
    stage: "lead", source: "Website form", assignee: "Sam@PH.com",
  });
  assert.deepEqual(r.errors, []);
  assert.equal(r.fields.company.name, "Acme Retail");
  assert.equal(r.fields.company.website, "https://acme.example");
  assert.deepEqual(r.fields.company.countries, ["UK", "France"]);
  assert.equal(r.fields.company.storeCount, 1200);
  assert.equal(r.fields.contacts.length, 1);
  assert.equal(r.fields.contacts[0].linkedin, "https://linkedin.com/in/jo");
  assert.equal(r.fields.assignee, "sam@ph.com");
  assert.equal(r.fields.source, "Website form");
});
t("a missing name, a bad stage, role, email or store count are each refused", () => {
  const r = L.leadFromForm({ name: "", storeCount: "lots", stage: "won-ish", contacts: [{ name: "A", email: "nope", buyingRole: "boss" }] });
  assert.equal(r.errors.length, 5);
  assert.ok(r.errors.some((e) => /Company name/.test(e)) && r.errors.some((e) => /Store count/.test(e)) && r.errors.some((e) => /stage/.test(e)));
  assert.equal(L.leadFromForm({ name: "X", contacts: [{ jobTitle: "CFO" }] }).errors[0], "Contact 1 needs a name.");
});
t("AWS account ID on the company and each contact: 12 digits, tidied, optional, refused otherwise", () => {
  const r = L.leadFromForm({ name: "Acme", awsAccountId: "1234-5678-9012", contacts: [{ name: "Jo", awsAccountId: "210987654321" }, { name: "Sam" }] });
  assert.deepEqual(r.errors, []);
  assert.equal(r.fields.company.awsAccountId, "123456789012");
  assert.deepEqual(r.fields.contacts.map((c) => c.awsAccountId), ["210987654321", ""]);
  assert.equal(L.normaliseLead("l", { company: { name: "Acme", awsAccountId: "123456789012" }, contacts: [{ name: "Jo", awsAccountId: "210987654321" }] }).contacts[0].awsAccountId, "210987654321");
  assert.equal(L.leadFromForm({ name: "Acme", awsAccountId: "12" }).errors.length, 1);
  assert.equal(L.leadFromForm({ name: "Acme", contacts: [{ name: "Jo", awsAccountId: "abc" }] }).errors.length, 1);
  assert.equal(L.leadFromForm({ name: "Acme", contacts: [{ awsAccountId: "123456789012" }] }).errors[0], "Contact 1 needs a name.", "a row with only an account ID is not blank");
});
t("a stored contact keeps its enrichment through a form round trip", () => {
  const e = { at: "2026-11-05", source: "tech-stack", added: ["email"] };
  const r = L.leadFromForm({ name: "X", contacts: [{ id: "c9", name: "Jo", enrichment: e }] });
  assert.deepEqual(r.fields.contacts[0].enrichment, e);
  assert.equal(r.fields.contacts[0].id, "c9");
});
t("normaliseLead copes with a document missing most fields", () => {
  const l = L.normaliseLead("a", { company: { name: "Z" }, stage: "nonsense" });
  assert.equal(l.stage, "lead"); assert.deepEqual(l.contacts, []); assert.equal(l.company.storeCount, null); assert.equal(l.customerAccount, null);
});
t("groupByStage fills every lane, newest change first", () => {
  const mk = (id, stage, ms) => L.normaliseLead(id, { company: { name: id }, stage, updatedAt: ms });
  const lanes = L.groupByStage([mk("a", "demo", 1), mk("b", "demo", 5), mk("c", "closed-lost", 2)]);
  assert.deepEqual(Object.keys(lanes), L.STAGE_KEYS);
  assert.deepEqual(lanes.demo.map((l) => l.id), ["b", "a"]);
  assert.equal(lanes["hot-lead"].length, 0);
});
t("converting needs an account and lands in Closed Won", () => {
  assert.ok(L.conversionFields({}).error);
  assert.deepEqual(L.conversionFields({ name: "Acme Ltd", id: "acc_1" }).fields, { stage: "closed-won", customerAccount: { id: "acc_1", name: "Acme Ltd" } });
});
t("enrichment fills blanks and never overwrites what a person typed", () => {
  const m = L.mergeCompanyEnrichment({ name: "A", industry: "Grocery", countries: ["UK"], storeCount: 10, website: "https://a.example" }, { industry: "Retail", countries: ["uk", "France"], storeCount: 99 });
  assert.equal(m.company.industry, "Grocery"); assert.equal(m.company.storeCount, 10);
  assert.deepEqual(m.company.countries, ["UK", "France"]); assert.deepEqual(m.changed, ["countries"]);
  const blank = L.mergeCompanyEnrichment({ name: "A", industry: "", countries: [], storeCount: null }, { industry: "Retail", storeCount: 40 });
  assert.deepEqual(blank.changed.sort(), ["industry", "storeCount"]);
});
t("a website submission maps onto the lead form: source website, page and industry kept, test flag read", () => {
  const r = L.leadFromWebsite({ company: "Acme", email: "jo@acme.example", page: "/retail/", pageIndustry: "Retail", test: "1" });
  assert.deepEqual(r.errors, []);
  assert.equal(r.test, true);
  assert.equal(r.fields.source, "website"); assert.equal(r.fields.stage, "lead");
  assert.equal(r.fields.sourcePage, "/retail/"); assert.equal(r.fields.sourceIndustry, "Retail");
  assert.equal(L.leadFromWebsite({ company: "Acme", email: "jo@acme.example" }).test, false);
  const s = L.leadFromWebsite({ company: "Acme", email: "jo@acme.example", sourceLabel: "x".repeat(200), sourceDetail: " Personalisation " });
  assert.equal(s.fields.sourceLabel.length, 120); assert.equal(s.fields.sourceDetail, "Personalisation");
  assert.deepEqual([L.normaliseLead("a", {}).sourceLabel, L.normaliseLead("a", {}).websiteActivity], ["", []]);
  assert.equal(L.normaliseLead("a", { company: { name: "A" }, test: true }).test, true);
  assert.ok(L.leadFromWebsite({ email: "jo@acme.example" }).errors.length);
});
t("industry palette: aliases, source-industry fallback, grey for none, AA contrast in both themes", () => {
  const key = (lead) => P.leadIndustryEntry(lead).key;
  assert.equal(P.industryEntry("TELCO").key, "telco");
  assert.equal(P.industryEntry("Telco retail").key, "telco");
  assert.equal(P.industryEntry("Fuel").key, "convenience-fuel");
  assert.equal(P.industryEntry("convenience stores").key, "convenience-fuel");
  assert.equal(P.industryEntry("Retail Media").key, "retail-media");
  assert.equal(P.industryEntry("Quick service restaurants").key, "qsr");
  assert.equal(P.industryEntry("Retail").key, "other");
  assert.equal(P.industryEntry("").key, "other");
  assert.equal(key({ company: { industry: "Pharmacy" }, sourceIndustry: "Telco" }), "pharmacy", "own industry wins");
  assert.equal(key({ company: { industry: "" }, sourceIndustry: "telco" }), "telco", "falls back to the source industry");
  assert.equal(key({ company: { industry: "" }, sourceIndustry: "" }), "other");
  assert.equal(P.industryChipText({ company: { industry: "" }, sourceIndustry: "" }), "Other / not set");
  for (const e of [...P.INDUSTRIES, P.OTHER_INDUSTRY]) for (const th of ["light", "dark"]) {
    assert.ok(P.contrastRatio(e[th].fg, e[th].bg) >= 4.5, `${e.key} ${th} chip text contrast`);
  }
  assert.equal(new Set([...P.INDUSTRIES, P.OTHER_INDUSTRY].map((e) => e.light.bar)).size, P.INDUSTRIES.length + 1, "each industry has its own colour");
});
t("functions/leads-core.js is the generated copy of the page's leads-core.js", () => {
  const have = fs.readFileSync(path.join(here, "..", "functions", "leads-core.js"), "utf8");
  assert.equal(have, buildCopy(fs.readFileSync(path.join(here, "..", "public", "js", "leads-core.js"), "utf8")), "run: node test/leads-core-copy.mjs --write");
  const cjs = createRequire(import.meta.url)("../functions/leads-core.js");
  assert.deepEqual(cjs.STAGE_KEYS, L.STAGE_KEYS);
});
console.log(`${n} passed`);
t("mergeInbound adds new contacts once, fills blanks and counts every arrival", () => {
  const cur = L.normaliseLead("l1", { company: { name: "Acme", website: "", countries: ["UK"] }, contacts: [{ id: "a", name: "Jo", email: "jo@acme.example" }], websiteActivity: [{ at: "x" }] });
  assert.equal(cur.inboundCount, 1, "an older lead counts its website submissions");
  const m = L.mergeInbound(cur, { company: { website: "https://acme.example", countries: ["France"], storeCount: 10 } }, [{ id: "b", name: "Sam", email: "sam@acme.example" }, { id: "c", name: "Jo again", email: "JO@acme.example" }]);
  assert.deepEqual(m.contacts.map((c) => c.name), ["Jo", "Sam"]); assert.equal(m.added, 1);
  assert.equal(m.inboundCount, 2); assert.equal(m.company.website, "https://acme.example"); assert.deepEqual(m.company.countries, ["UK", "France"]); assert.equal(m.company.storeCount, 10);
  assert.equal(L.inboundLabel({ inboundCount: 2 }), "2 inbound"); assert.equal(L.inboundLabel({ inboundCount: 0 }), "");
  assert.equal(L.normaliseLead("x", { inboundCount: 5 }).inboundCount, 5);
});
console.log(`${n} passed (with inbound merge)`);
