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
  const docs = new Map(); let i = 0;
  const mk = (id) => ({ id, data: () => docs.get(id), ref: { update: async (p) => { Object.assign(docs.get(id), p); } } });
  return { docs, collection: () => ({ get: async () => { const ds = [...docs.keys()].map(mk); return { docs: ds, forEach: (f) => ds.forEach(f) }; }, add: async (d) => { const id = `l${++i}`; docs.set(id, d); return { id }; } }) };
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
  await test("only POST /v1/submit is served", async () => {
    const { api } = mkApi(); const r = res();
    await api.handle(req(FORM, "k", "GET"), r); assert.equal(r.code, 405);
    await api.handle(req(FORM, "k", "POST", "/leadIngest/v1/other"), r); assert.equal(r.code, 404);
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
  assert.ok(core.leadFromWebsite({ company: "X", test: "on" }).test);
  console.log(`${n} passed`);
})().catch((e) => { console.error(e); process.exit(1); });
