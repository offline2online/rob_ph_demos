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
    get: async () => ({ id, exists: col(name).has(id), data: () => col(name).get(id), ref: ref(name, id) }),
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
    assert.deepEqual(r.body, { found: true, name: "Greene King", industry: "Pubs & Hospitality", logos: { light: "https://brand.example/gk.svg", dark: "https://brand.example/gk-white.svg", icon: "https://www.greeneking.co.uk/icon.png" }, darkFromLight: false });
    r = res(); await api.handle(req({ company: "Someone Else", email: "jo@greeneking.co.uk" }, "k", "POST", BRAND), r);
    assert.equal(r.body.name, "Greene King", "matched by the work email's domain");
    r = res(); await api.handle(req({ company: "Corner Shop Co" }, "k", "POST", BRAND), r);
    assert.deepEqual(r.body, { found: true, name: "Corner Shop Co", industry: "Fuel & Convenience", logos: { light: "https://cornershop.example/logo.png", dark: "", icon: "https://cornershop.example/icon.png" }, darkFromLight: true });
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
  // ── Network operator inquiries (key "operator") from the Run Your Own RMN page's product tour gate (13 Nov 2026) ──
  const GATE = { lead_type: "operator", lead_source: "Run Your Own RMN page – product tour", full_name: "Alex Rivers", email: "alex@gmail.example", linkedin: "linkedin.com/in/alexrivers", operating_region: "Leeds and West Yorkshire", page: "/run-your-own-rmn/" };
  await test("each background on the gate form makes an individual Network operator inquiry lead, with no company, TAM record or AWS routing", async () => {
    for (const b of core.BACKGROUNDS) {
      const { db, api } = mkApi(); db.prospects.set("acme-uk", { ...UK });
      const r = res(); await api.handle(req({ ...GATE, background: b.label }), r);
      assert.equal(r.code, 201, b.label); assert.equal(r.body.leadType, "operator"); assert.equal(r.body.prospectId, undefined, "no TAM match");
      const d = db.docs.get(r.body.leadId);
      assert.equal(d.leadType, "operator"); assert.equal(d.stage, "applied", "the operator pipeline's first stage");
      assert.equal(d.company.name, "", "no company needed");
      assert.deepEqual(d.operator, { region: "Leeds and West Yorkshire", background: b.key, audience: "" });
      assert.equal(d.sourceLabel, "Run Your Own RMN page – product tour"); assert.equal(d.source, "website"); assert.equal(d.sourcePage, "/run-your-own-rmn/");
      assert.deepEqual(d.contacts.map((c) => [c.name, c.email, c.linkedin]), [["Alex Rivers", "alex@gmail.example", "https://linkedin.com/in/alexrivers"]]);
      assert.equal(d.prospectId, undefined); assert.equal(db.prospects.size, 1, "no TAM record created");
      const n = core.normaliseLead("x", d);
      assert.equal(core.leadName(n), "Alex Rivers"); assert.equal(core.companyLine(n), `Leeds and West Yorkshire · ${b.label}`);
    }
  });
  await test('"I am" is stored as audience (a key) from its label or key in any case; blank or unknown is ""; the two new backgrounds map to their keys', async () => {
    assert.deepEqual(core.BACKGROUNDS.map((b) => b.key), ["agency", "adtech", "retail-media", "creative-agency", "retail-owner", "marketing", "other"]);
    assert.deepEqual(core.AUDIENCES, [{ key: "individual", label: "An individual operator" }, { key: "team", label: "Part of an operator team" }, { key: "retailer", label: "A small to medium retailer" }]);
    const { db, api } = mkApi();
    const post = async (extra) => { const r = res(); await api.handle(req({ ...GATE, email: `p${db.docs.size}@x.example`, ...extra }), r); assert.equal(r.code, 201); return db.docs.get(r.body.leadId); };
    const d = await post({ audience: "A small to medium retailer", background: "Creative agency" });
    assert.equal(d.stage, "applied");
    assert.deepEqual(d.operator, { region: "Leeds and West Yorkshire", background: "creative-agency", audience: "retailer" });
    const n = core.normaliseLead("x", d);
    assert.equal(core.companyLine(n), "A small to medium retailer · Leeds and West Yorkshire · Creative agency", "the card's line: I am, then region and background");
    assert.equal(core.audienceLabel(n.operator.audience), "A small to medium retailer");
    assert.deepEqual((await post({ audience: "TEAM", background: "retail business owner or manager" })).operator, { region: "Leeds and West Yorkshire", background: "retail-owner", audience: "team" });
    assert.equal((await post({ audience: "an individual OPERATOR" })).operator.audience, "individual");
    assert.equal((await post({ audience: "A large enterprise" })).operator.audience, "", "an unknown audience is stored blank");
    assert.equal((await post({ audience: "" })).operator.audience, "");
    assert.equal(core.normaliseLead("y", { leadType: "operator", operator: { region: "Leeds", background: "adtech" } }).operator.audience, "", "a lead from before the field has none");
  });
  await test("a blank LinkedIn (or one that isn't an address) still makes the lead; a missing lead_source gets the gate's label", async () => {
    const { db, api } = mkApi();
    const a = res(); await api.handle(req({ ...GATE, linkedin: "", lead_source: "", background: "agency" }), a);
    assert.equal(a.code, 201); const d = db.docs.get(a.body.leadId);
    assert.equal(d.contacts[0].linkedin, ""); assert.equal(d.sourceLabel, core.OPERATOR_SOURCE_LABEL); assert.equal(d.operator.background, "agency");
    assert.equal(core.OPERATOR_SOURCE_LABEL, "Run Your Own RMN page – product tour");
    const b = res(); await api.handle(req({ ...GATE, email: "b@x.example", linkedin: "not a link" }), b);
    assert.equal(b.code, 201); assert.equal(db.docs.get(b.body.leadId).contacts[0].linkedin, "");
  });
  await test("a network operator applicant from an AWS address, or with a company field, is still a network operator inquiry", async () => {
    const { db, api } = mkApi(); db.prospects.set("acme-uk", { ...UK });
    const r = res(); await api.handle(req({ ...GATE, email: "pat@amazon.com", company: "Acme Telco" }), r);
    assert.equal(r.code, 201); assert.equal(db.docs.get(r.body.leadId).leadType, "operator");
    assert.equal(db.prospects.size, 1); assert.equal(db.prospects.get("aws"), undefined); assert.equal(db.prospects.get("acme-uk").leadId, undefined);
  });
  await test("the same person again (same email) adds activity to their lead; a company lead is never merged with it", async () => {
    const { db, api } = mkApi();
    await api.handle(req({ ...GATE, operating_region: "" }), res());
    const r = res(); await api.handle(req({ ...GATE, email: "ALEX@gmail.example", background: "Marketing", audience: "Part of an operator team" }), r);
    assert.equal(r.code, 200); assert.equal(r.body.created, false); assert.equal(db.docs.size, 1);
    const d = db.docs.get(r.body.leadId);
    assert.equal(d.inboundCount, 2); assert.equal(d.websiteActivity.length, 2);
    assert.deepEqual(d.operator, { region: "Leeds and West Yorkshire", background: "marketing", audience: "team" }, "blanks are filled");
    await api.handle(req({ ...FORM, email: "alex@gmail.example" }), res());
    assert.equal(db.docs.size, 2, "a company lead from the same email is a separate lead");
    await api.handle(req({ ...GATE, test: "1" }), res());
    assert.equal(db.docs.size, 3, "a test submission never merges with a real one");
  });
  await test("a gate submission with no name or email, or a bad email, is a 400", async () => {
    const { db, api } = mkApi(); const r = res();
    await api.handle(req({ lead_type: "Network operator inquiry" }), r); assert.equal(r.code, 400);
    await api.handle(req({ ...GATE, email: "nope" }), r); assert.equal(r.code, 400);
    assert.equal(db.docs.size, 0);
  });
  await test("company leads still create exactly as before, now typed as company", async () => {
    const { db, api } = mkApi(); const r = res(); await api.handle(req(FORM), r);
    const d = db.docs.get(r.body.leadId);
    assert.equal(d.leadType, "company"); assert.equal(d.stage, "lead"); assert.equal(d.company.name, "Acme Telco"); assert.equal(d.operator, undefined);
  });
  // The offer's retired key, spelt so the word itself never appears in backlog-tracker/.
  const RETIRED_KEY = ["fr", "anchise"].join("");
  await test("leadType operator, network operator or \"Network operator inquiry\" (either key) all land as a network operator inquiry in Applied", async () => {
    for (const body of [{ leadType: "operator" }, { lead_type: "Network operator inquiry" }, { lead_type: "operator" }, { leadType: "Network operator" }, { lead_type: "NETWORK OPERATOR INQUIRY" }]) {
      const { db, api } = mkApi(); const g = { ...GATE }; delete g.lead_type;
      const r = res(); await api.handle(req({ ...g, ...body }), r);
      assert.equal(r.code, 201, JSON.stringify(body)); assert.equal(r.body.leadType, "operator", JSON.stringify(body));
      const d = db.docs.get(r.body.leadId);
      assert.equal(d.leadType, "operator"); assert.equal(d.stage, "applied"); assert.equal(d.company.name, "");
      assert.deepEqual(Object.keys(d).filter((k) => k !== "operator" && /operator/i.test(k)), [], "the details are stored under operator only");
    }
    for (const v of ["", "Retail", "company", "Demo request", "cooperative", RETIRED_KEY]) assert.equal(core.leadTypeOf(v), "company", v);
    assert.equal(core.leadTypeLabel("operator"), "Network operator inquiry");
    assert.deepEqual(core.LEAD_TYPE_KEYS, ["company", "operator"], "the only keys");
  });
  await test("a POST carrying the retired key is a company lead (the old key is not accepted)", async () => {
    for (const k of ["leadType", "lead_type"]) {
      const { db, api } = mkApi(); db.prospects.set("acme-uk", { ...UK });
      const r = res(); await api.handle(req({ ...FORM, [k]: RETIRED_KEY }), r);
      assert.equal(r.code, 201, k); assert.notEqual(r.body.leadType, "operator", k);
      const d = db.docs.get(r.body.leadId);
      assert.equal(d.leadType, "company", k); assert.equal(d.stage, "lead"); assert.equal(d.company.name, "Acme Telco");
      assert.equal(d.operator, undefined); assert.equal(d[RETIRED_KEY], undefined);
    }
    const g = { ...GATE }; delete g.lead_type;
    const { db, api } = mkApi(); const r = res(); await api.handle(req({ ...g, leadType: RETIRED_KEY }), r);
    assert.equal(r.code, 400, "the gate's fields alone (no company) are not a company lead");
    assert.equal(db.docs.size, 0);
  });
  await test("no MCP lead tool text uses the offer's retired name, and leadType is company or operator", async () => {
    const tools = leadsTools({ textResult: (x) => x, toolError: (m) => ({ error: m }), audit: async () => {} });
    const text = JSON.stringify(tools.map((t) => ({ d: t.description, s: t.inputSchema })));
    assert.ok(!new RegExp(RETIRED_KEY.slice(0, 5), "i").test(text), "the retired word appears");
    assert.ok(/Network operator inquir/.test(text), "the new label is used");
    for (const name of ["list_leads", "create_lead", "create_leads"]) {
      const schema = JSON.stringify(tools.find((x) => x.name === name).inputSchema);
      assert.ok(schema.includes('"leadType":{"type":"string","enum":["company","operator"]'), name + " takes leadType company or operator");
    }
  });
  await test("list_leads and get_lead return the lead type and source, and list_leads filters by type", async () => {
    const db = fakeDb(); const api = createLeadIngest({ db, key: () => "k" });
    await api.handle(req(FORM), res()); await api.handle(req({ ...GATE, background: "retail media", audience: "A small to medium retailer" }), res());
    await api.handle(req({ ...GATE, full_name: "Sam Team", email: "sam@x.example", audience: "team" }), res());
    stubDb = db;
    const tools = leadsTools({ textResult: (x) => x, toolError: (m) => ({ error: m }), audit: async () => {} });
    const list = tools.find((t) => t.name === "list_leads"), get = tools.find((t) => t.name === "get_lead");
    const all = await list.run({});
    assert.deepEqual(all.leads.map((l) => [l.name, l.leadType]).sort(), [["Acme Telco", "company"], ["Alex Rivers", "operator"], ["Sam Team", "operator"]]);
    assert.equal((await list.run({ leadType: "operator" })).total, 2);
    const fr = await list.run({ audience: "retailer" });
    assert.equal(fr.total, 1, "list_leads filters by audience"); const v = fr.leads[0];
    assert.equal(v.audience, "retailer"); assert.equal(v.audienceLabel, "A small to medium retailer");
    assert.deepEqual((await list.run({ audience: "team" })).leads.map((l) => l.name), ["Sam Team"]);
    assert.equal((await list.run({ audience: "individual" })).total, 0);
    const co = (await list.run({ leadType: "company" })).leads[0];
    assert.equal(co.audience, null); assert.equal(co.audienceLabel, null);
    assert.ok(JSON.stringify(list.inputSchema).includes('"audience":{"type":"string","enum":["individual","team","retailer"]'), "list_leads takes an audience filter");
    assert.equal(v.leadTypeLabel, "Network operator inquiry"); assert.equal(v.sourceLabel, "Run Your Own RMN page – product tour"); assert.equal(v.source, "website");
    assert.equal(v.region, "Leeds and West Yorkshire"); assert.equal(v.background, "retail-media"); assert.equal(v.backgroundLabel, "Retail media");
    assert.equal((await list.run({ leadType: "company" })).leads[0].company, "Acme Telco");
    const one = await get.run({ leadId: v.id });
    assert.equal(one.leadType, "operator"); assert.equal(one.leadTypeLabel, "Network operator inquiry"); assert.equal(one.sourceLabel, "Run Your Own RMN page – product tour"); assert.equal(one.sourcePage, "/run-your-own-rmn/");
    assert.equal((await get.run({ company: "alex rivers" })).id, v.id, "found by the person's name");
  });
  assert.ok(core.leadFromWebsite({ company: "X", test: "on" }).test);
  console.log(`${n} passed`);
})().catch((e) => { console.error(e); process.exit(1); });
