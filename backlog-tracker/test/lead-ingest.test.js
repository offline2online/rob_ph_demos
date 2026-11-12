// Promote › Leads website ingest (functions/lead-ingest.js): key, mapping,
// test-lead mode, merging a repeat company. No network, no Firebase.
"use strict";
const assert = require("assert");
const Module = require("module");
// firebase-admin is not installed for the offline tests: stub the one module.
let stubDb = null;
const origLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === "firebase-admin/firestore") return { FieldValue: { serverTimestamp: () => "SERVER_TS" }, getFirestore: () => stubDb };
  return origLoad.call(this, request, ...rest);
};
const { createLeadIngest } = require("../functions/lead-ingest");
const core = require("../functions/leads-core");
const { leadsTools } = require("../functions/leads");

let n = 0;
async function test(name, fn) { await fn(); n++; console.log(`  ok  ${name}`); }

function fakeDb() {
  const cols = new Map(); let i = 0;
  const col = (name) => { if (!cols.has(name)) cols.set(name, new Map()); return cols.get(name); };
  const ref = (name, id) => ({
    id,
    set: async (d) => { col(name).set(id, { ...d }); },
    update: async (p) => { if (!col(name).has(id)) throw new Error(`no ${name}/${id}`); Object.assign(col(name).get(id), p); },
  });
  const snap = (name, id) => ({ id, data: () => col(name).get(id), ref: ref(name, id) });
  return {
    cols, docs: col("leads"), prospects: col("prospects"),
    collection: (name) => ({
      get: async () => { const ds = [...col(name).keys()].map((id) => snap(name, id)); return { docs: ds, forEach: (f) => ds.forEach(f) }; },
      add: async (d) => { const id = `l${++i}`; col(name).set(id, d); return { id }; },
      doc: (id) => ref(name, id),
    }),
  };
}
const res = () => { const r = { code: 0, body: null, status(c) { r.code = c; return r; }, set() { return r; }, json(b) { r.body = b; return r; } }; return r; };
const req = (body, key = "k", method = "POST", path = "/leadIngest/v1/submit") => ({ method, path, body, get: (h) => (h.toLowerCase() === "x-lead-key" ? key : "") });
const FORM = { company: "Acme Telco", website: "acme.example", email: "jo@acme.example", contactName: "Jo Bloggs", jobTitle: "CTO", page: "/telco/", pageIndustry: "Telco", storeCount: "300" };

(async () => {
  const mkApi = () => { const db = fakeDb(); return { db, api: createLeadIngest({ db, key: () => "k" }) }; };
  await test("a wrong or missing key is refused and nothing is stored", async () => {
    const { db, api } = mkApi(); const r = res();
    await api.handle(req(FORM, "nope"), r); assert.equal(r.code, 401);
    await api.handle(req(FORM, ""), r); assert.equal(r.code, 401);
    assert.equal(db.docs.size, 0);
  });
  await test("the deploy's \"unset\" placeholder is never a valid key", async () => {
    const db = fakeDb(); const api = createLeadIngest({ db, key: () => "unset" }); const r = res();
    await api.handle(req(FORM, "unset"), r); assert.equal(r.code, 401);
    assert.equal(db.docs.size, 0);
  });
  await test("only POST /v1/submit and /v1/brand are served", async () => {
    const { api } = mkApi(); const r = res();
    await api.handle(req(FORM, "k", "GET"), r); assert.equal(r.code, 405);
    await api.handle(req(FORM, "k", "POST", "/leadIngest/v1/other"), r); assert.equal(r.code, 404);
  });
  await test("the brand lookup returns a listed company's logos and nothing else, with the same key", async () => {
    const { db, api } = mkApi();
    const BRAND = "/leadIngest/v1/brand";
    db.prospects.set("greene-king-united-kingdom", { name: "Greene King", country: "United Kingdom", website: "https://www.greeneking.co.uk", industry: "Pubs & Hospitality", leadId: "lead1", notes: "private",
      enrichment: { logoUrl: "https://www.greeneking.co.uk/icon.png", logos: { light: "https://brand.example/gk.svg", dark: "" }, summary: "private research" } });
    db.docs.set("lead1", { company: { name: "Greene King" }, contacts: [{ name: "Private Person", email: "p@greeneking.co.uk" }], enrichment: { logos: { light: "", dark: "https://brand.example/gk-white.svg" } } });
    db.docs.set("lead2", { company: { name: "Corner Shop Co", industry: "Fuel & Convenience" }, enrichment: { logoUrl: "https://cornershop.example/icon.png", logos: { light: "https://cornershop.example/logo.png", dark: "javascript:x" } } });
    db.docs.set("lead3", { test: true, company: { name: "Test Co" }, enrichment: { logos: { light: "https://t.example/l.png" } } });
    let r = res(); await api.handle(req({ company: "Greene King" }, "nope", "POST", BRAND), r); assert.equal(r.code, 401);
    r = res(); await api.handle(req({}, "k", "POST", BRAND), r); assert.equal(r.code, 400);
    r = res(); await api.handle(req({ company: "greene king" }, "k", "POST", BRAND), r);
    assert.deepEqual(r.body, { found: true, name: "Greene King", industry: "Pubs & Hospitality", logos: { light: "https://brand.example/gk.svg", dark: "https://brand.example/gk-white.svg", icon: "https://www.greeneking.co.uk/icon.png" } });
    r = res(); await api.handle(req({ company: "Someone Else", email: "jo@greeneking.co.uk" }, "k", "POST", BRAND), r);
    assert.equal(r.body.name, "Greene King", "matched by the work email's domain");
    r = res(); await api.handle(req({ company: "Corner Shop Co" }, "k", "POST", BRAND), r);
    assert.deepEqual(r.body, { found: true, name: "Corner Shop Co", industry: "Fuel & Convenience", logos: { light: "https://cornershop.example/logo.png", dark: "", icon: "https://cornershop.example/icon.png" } });
    for (const company of ["Unknown Ltd", "Test Co"]) { r = res(); await api.handle(req({ company }, "k", "POST", BRAND), r); assert.deepEqual(r.body, { found: false }, company); }
    assert.equal(db.docs.size, 3, "a lookup stores nothing"); assert.ok(!JSON.stringify(r.body).includes("private"));
  });
  await test("a real submission becomes a Lead-lane website lead with page and industry", async () => {
    const { db, api } = mkApi(); const r = res();
    await api.handle(req(FORM), r);
    assert.equal(r.code, 201);
    const d = db.docs.get(r.body.leadId);
    assert.equal(d.source, "website"); assert.equal(d.stage, "lead"); assert.equal(d.test, false);
    assert.equal(d.sourcePage, "/telco/"); assert.equal(d.sourceIndustry, "Telco");
    assert.equal(d.company.name, "Acme Telco"); assert.equal(d.company.storeCount, 300);
    assert.equal(d.contacts[0].email, "jo@acme.example");
  });
  await test("sourceLabel/sourceDetail are stored; every submission adds website activity (20 newest); blanks only fill", async () => {
    const { db, api } = mkApi();
    const a = res(); await api.handle(req({ ...FORM, sourceLabel: "Interactive product tour – Telco", sourceDetail: "Personalisation" }), a);
    let d = db.docs.get(a.body.leadId);
    assert.equal(d.sourceLabel, "Interactive product tour – Telco"); assert.equal(d.sourceDetail, "Personalisation");
    assert.equal(d.websiteActivity.length, 1); assert.deepEqual(Object.keys(d.websiteActivity[0]).sort(), ["at", "detail", "label", "page"]);
    await api.handle(req({ ...FORM, sourceLabel: "Telco business model download" }), res());
    assert.equal(d.sourceLabel, "Interactive product tour – Telco"); assert.equal(d.sourceDetail, "Personalisation");
    assert.deepEqual(d.websiteActivity.map((x) => x.label), ["Interactive product tour – Telco", "Telco business model download"]);
    const n = core.normaliseLead("x", d); assert.equal(n.websiteActivity.length, 2);
    const v = leadsTools({ textResult: (x) => x, toolError: (x) => x, audit() {} }); assert.ok(v.length);
    for (let i = 0; i < 25; i++) await api.handle(req({ ...FORM, sourceLabel: "L" + i }), res());
    assert.equal(d.websiteActivity.length, 20); assert.equal(d.websiteActivity[19].label, "L24");
    // a lead from before the fields existed gets them filled on the next submission
    const b = res(); await api.handle(req({ ...FORM, company: "Old Co" }), b);
    const old = db.docs.get(b.body.leadId); old.sourceLabel = ""; old.sourceDetail = ""; delete old.websiteActivity;
    await api.handle(req({ ...FORM, company: "Old Co", sourceLabel: "Talk to us", sourceDetail: "Demo" }), res());
    assert.equal(old.sourceLabel, "Talk to us"); assert.equal(old.websiteActivity.length, 1);
  });
  await test("a submission without the new fields behaves as before", async () => {
    const { db, api } = mkApi(); const r = res(); await api.handle(req(FORM), r);
    const d = db.docs.get(r.body.leadId); assert.equal(d.sourceLabel, ""); assert.equal(core.normaliseLead("x", { company: { name: "A" } }).sourceLabel, "");
  });
  await test("a test flag marks the lead as a test lead", async () => {
    const { db, api } = mkApi(); const r = res();
    await api.handle(req({ ...FORM, test: "1" }), r);
    assert.equal(db.docs.get(r.body.leadId).test, true); assert.equal(r.body.test, true);
  });
  await test("a test lead never merges into a real lead of the same company, and vice versa", async () => {
    const { db, api } = mkApi();
    await api.handle(req(FORM), res()); await api.handle(req({ ...FORM, test: "true" }), res());
    assert.equal(db.docs.size, 2);
  });
  await test("the same company again updates the lead: new contact added, nothing duplicated", async () => {
    const { db, api } = mkApi(); const r = res();
    await api.handle(req(FORM), res());
    await api.handle(req({ ...FORM, email: "sam@acme.example", contactName: "Sam" }), r);
    assert.equal(r.code, 200); assert.equal(r.body.created, false);
    await api.handle(req(FORM), res());
    assert.equal(db.docs.size, 1);
    assert.deepEqual([...db.docs.values()][0].contacts.map((c) => c.email), ["jo@acme.example", "sam@acme.example"]);
  });
  await test("a missing company or bad email is a 400", async () => {
    const { api } = mkApi(); const r = res();
    await api.handle(req({ email: "jo@acme.example" }), r); assert.equal(r.code, 400);
    await api.handle(req({ ...FORM, email: "nope" }), r); assert.equal(r.code, 400);
  });
  await test("list_leads leaves test leads out", async () => {
    const db = fakeDb();
    const tool = leadsTools({ textResult: (x) => x, toolError: (m) => m, audit: async () => {} }).find((t) => t.name === "list_leads");
    const { api } = { api: createLeadIngest({ db, key: () => "k" }) };
    await api.handle(req(FORM), res()); await api.handle(req({ ...FORM, company: "Other", test: "1" }), res());
    stubDb = db;
    const out = await tool.run({});
    assert.deepEqual(out.leads.map((l) => l.company), ["Acme Telco"]);
  });
  // ── Matching to Prospects (TAM) (10 Nov 2026) ──
  const UK = { name: "Acme Telco", country: "United Kingdom", website: "https://www.acme.example", status: "targeted", hqCountry: "United Kingdom", industry: "Telco Retail" };
  await test("a lead whose name and email domain match a TAM record is linked to it (one lead per record)", async () => {
    const { db, api } = mkApi(); db.prospects.set("acme-uk", { ...UK });
    const r = res(); await api.handle(req({ ...FORM, country: "UK" }), r);
    assert.equal(r.code, 201); assert.equal(r.body.prospectId, "acme-uk"); assert.equal(r.body.matchedBy, "name and email domain"); assert.equal(r.body.prospectCreated, false);
    assert.equal(r.body.leadId, "prospect-acme-uk");
    const lead = db.docs.get("prospect-acme-uk"); assert.equal(lead.prospectId, "acme-uk"); assert.equal(lead.inboundCount, 1);
    assert.equal(db.prospects.get("acme-uk").leadId, "prospect-acme-uk"); assert.equal(db.prospects.get("acme-uk").status, "converted");
    assert.equal(db.prospects.size, 1);
  });
  await test("the email domain alone finds the record when the company is typed differently", async () => {
    const { db, api } = mkApi(); db.prospects.set("acme-uk", { ...UK });
    const r = res(); await api.handle(req({ ...FORM, company: "ACME Telecom Ltd", country: "United Kingdom", email: "jo@uk.acme.example" }), r);
    assert.equal(r.body.prospectId, "acme-uk"); assert.equal(r.body.matchedBy, "email domain");
  });
  await test("a second person from the same company joins the lead as a contact and the inbound count is 2", async () => {
    const { db, api } = mkApi(); db.prospects.set("acme-uk", { ...UK });
    await api.handle(req({ ...FORM, country: "UK" }), res());
    const r = res(); await api.handle(req({ ...FORM, country: "UK", email: "sam@acme.example", contactName: "Sam" }), r);
    assert.equal(r.code, 200); assert.equal(r.body.created, false); assert.equal(r.body.leadId, "prospect-acme-uk");
    assert.equal(db.docs.size, 1);
    const lead = db.docs.get("prospect-acme-uk");
    assert.deepEqual(lead.contacts.map((c) => c.email), ["jo@acme.example", "sam@acme.example"]);
    assert.equal(lead.inboundCount, 2); assert.equal(core.normaliseLead("x", lead).inboundCount, 2);
  });
  await test("a company not in the TAM gets a new record, marked for enrichment, linked to the lead", async () => {
    const { db, api } = mkApi();
    const r = res(); await api.handle(req({ ...FORM, company: "Brand New Co", email: "a@brandnew.example", website: "brandnew.example", country: "France" }), r);
    assert.equal(r.code, 201); assert.equal(r.body.prospectCreated, true); assert.equal(r.body.prospectId, "brandnewco-france");
    const p = db.prospects.get("brandnewco-france");
    assert.equal(p.name, "Brand New Co"); assert.equal(p.country, "France"); assert.equal(p.source, "Inbound lead");
    assert.equal(p.createdAt, "SERVER_TS", "a newly created record, which the enrichment trigger picks up"); assert.equal(p.leadId, "prospect-brandnewco-france"); assert.equal(p.website, "https://brandnew.example");
    assert.equal(db.docs.get("prospect-brandnewco-france").prospectId, "brandnewco-france");
  });
  await test("the same company in another country is matched or created against that country's record, as a separate lead", async () => {
    const { db, api } = mkApi(); db.prospects.set("acme-uk", { ...UK });
    await api.handle(req({ ...FORM, country: "UK" }), res());
    const r = res(); await api.handle(req({ ...FORM, country: "France", email: "pierre@acme.example", contactName: "Pierre" }), r);
    assert.equal(r.code, 201); assert.equal(r.body.prospectId, "acmetelco-france"); assert.equal(r.body.prospectCreated, true);
    const fr = db.prospects.get("acmetelco-france");
    assert.equal(fr.website, "https://www.acme.example"); assert.equal(fr.hqCountry, "United Kingdom"); assert.equal(fr.industry, "Telco Retail");
    assert.equal(db.docs.size, 2); assert.equal(db.docs.get("prospect-acmetelco-france").contacts[0].name, "Pierre");
    // and the next French person joins the French lead
    db.prospects.set("acme-de", { ...UK, country: "Germany" });
    const g = res(); await api.handle(req({ ...FORM, country: "Germany", email: "max@acme.example" }), g);
    assert.equal(g.body.prospectId, "acme-de"); assert.equal(db.docs.size, 3);
  });
  await test("with no country the lead matches on name and domain in any country; none at all makes a record without one", async () => {
    const { db, api } = mkApi(); db.prospects.set("acme-uk", { ...UK });
    const r = res(); await api.handle(req(FORM), r); assert.equal(r.body.prospectId, "acme-uk");
    const n = res(); await api.handle(req({ ...FORM, company: "Nowhere Ltd", email: "x@nowhere.example" }), n);
    assert.equal(n.body.prospectId, "nowhereltd"); assert.equal(db.prospects.get("nowhereltd").country, "");
  });
  await test("someone from AWS is a contact on the AWS record, never a lead; the same person again is refreshed, not repeated", async () => {
    const { db, api } = mkApi();
    const r = res(); await api.handle(req({ ...FORM, company: "Amazon Web Services", email: "pat@amazon.com", contactName: "Pat Lee", jobTitle: "Account Manager" }), r);
    assert.equal(r.code, 200); assert.equal(r.body.aws, true); assert.equal(r.body.leadId, null);
    assert.equal(db.docs.size, 0);
    const aws = db.prospects.get("aws"); assert.equal(aws.name, "AWS");
    assert.deepEqual(aws.contacts.map((c) => [c.name, c.role, c.email]), [["Pat Lee", "Account Manager", "pat@amazon.com"]]);
    await api.handle(req({ ...FORM, email: "pat@amazon.com", contactName: "Pat Lee", jobTitle: "Senior AM" }), res());
    await api.handle(req({ ...FORM, company: "Acme Telco", email: "kim@aws.com", contactName: "Kim" }), res());
    assert.deepEqual(db.prospects.get("aws").contacts.map((c) => [c.name, c.role]), [["Pat Lee", "Senior AM"], ["Kim", "CTO"]]);
    assert.equal(db.docs.size, 0);
  });
  await test("a lead from before matching (same company, no prospectId) is adopted rather than duplicated", async () => {
    const { db, api } = mkApi(); db.prospects.set("acme-uk", { ...UK });
    db.docs.set("old1", { company: { name: "Acme Telco", countries: ["United Kingdom"] }, contacts: [], stage: "demo", websiteActivity: [{ at: "2026-11-01T00:00:00Z", label: "x" }] });
    const r = res(); await api.handle(req({ ...FORM, country: "UK" }), r);
    assert.equal(r.body.leadId, "old1"); assert.equal(db.docs.size, 1);
    assert.equal(db.docs.get("old1").prospectId, "acme-uk"); assert.equal(db.docs.get("old1").inboundCount, 2);
    assert.equal(db.prospects.get("acme-uk").leadId, "old1");
  });
  assert.ok(core.leadFromWebsite({ company: "X", test: "on" }).test);
  console.log(`${n} passed`);
})().catch((e) => { console.error(e); process.exit(1); });
