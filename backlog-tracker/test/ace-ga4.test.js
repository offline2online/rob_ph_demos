// ACE stages -> GA4 Measurement Protocol (functions/ace-ga4.js) and the GA4
// client_id the website ingest stores (lead-ingest.js, leads-core.js).
// No network, no Firebase.
"use strict";
const assert = require("assert");
const Module = require("module");
let stubDb = null;
const origLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === "firebase-admin/firestore") return { FieldValue: { serverTimestamp: () => "SERVER_TS" }, getFirestore: () => stubDb };
  return origLoad.call(this, request, ...rest);
};
const ace = require("../functions/ace-ga4");
const core = require("../functions/leads-core");
const { createLeadIngest } = require("../functions/lead-ingest");

let n = 0;
async function test(name, fn) { await fn(); n++; console.log(`  ok  ${name}`); }

const OPP = { id: "O1", customer: "Acme Telco Ltd", website: "https://www.acme.example", awsAccountId: "", stage: "Technical Validation", lastModifiedDate: "2026-11-09T10:00:00Z" };
const LEAD = { id: "L1", stage: "demo", source: "website", sourceIndustry: "telco", company: { name: "Acme Telco", website: "acme.example", awsAccountId: "" },
  gaClientIds: [{ clientId: "111.1731000000", sessionId: "1731000100", leadSource: "interactive-product-tour", at: "2026-11-01T00:00:00Z" }] };

function fakeDb(leads) {
  const cols = { leads: new Map(leads.map((l) => [l.id, l])), aceGa4Sync: new Map() };
  return {
    cols,
    collection: (c) => ({
      get: async () => ({ docs: [...cols[c].entries()].map(([id, d]) => ({ id, data: () => { const { id: _x, ...rest } = d; return rest; } })) }),
      doc: (id) => ({ get: async () => ({ data: () => cols[c].get(id) }), set: async (p) => { cols[c].set(id, { ...(cols[c].get(id) || {}), ...p }); } }),
    }),
  };
}
function fakeFetch(answer) {
  const calls = [];
  const f = async (url, init) => { calls.push({ url, body: JSON.parse(init.body) }); return answer(url); };
  f.calls = calls;
  return f;
}
const quiet = { info() {}, warn() {}, error() {} };

(async () => {
  await test("milestones: qualified from any later stage, launched, won from the console lead", () => {
    assert.deepEqual(ace.milestones("Prospect", "lead"), []);
    assert.deepEqual(ace.milestones("Qualified", "lead"), ["qualified"]);
    assert.deepEqual(ace.milestones("Committed", "lead"), ["qualified"], "a skipped Qualified still counts");
    assert.deepEqual(ace.milestones("Launched", "closed-won"), ["qualified", "launched", "won"]);
    assert.deepEqual(ace.milestones("Closed Lost", "closed-lost"), []);
  });

  await test("matching: explicit id, then AWS account, then domain, then company name", () => {
    const opps = [OPP, { id: "O2", customer: "Other", website: "", awsAccountId: "123456789012" }];
    assert.equal(ace.matchOpportunity({ ...LEAD, aceOpportunityId: "O2" }, opps).id, "O2");
    assert.equal(ace.matchOpportunity({ ...LEAD, company: { ...LEAD.company, awsAccountId: "123456789012" } }, opps).id, "O2");
    assert.equal(ace.matchOpportunity(LEAD, opps).id, "O1", "acme.example = www.acme.example");
    assert.equal(ace.matchOpportunity({ ...LEAD, company: { name: "ACME TELCO LIMITED" } }, opps).id, "O1", "name ignores Ltd/Limited and case");
    assert.equal(ace.matchOpportunity({ ...LEAD, company: { name: "Nobody" } }, opps), null);
  });

  await test("payload: newest client_id, session_id, ace_stage, company_name, industry, lead_source; back-dated only within 72 h", () => {
    const now = Date.parse("2026-11-09T12:00:00Z");
    const b = ace.mpBody({ lead: LEAD, opp: OPP, milestone: "qualified", nowMs: now });
    assert.equal(b.client_id, "111.1731000000");
    assert.equal(b.events[0].name, "ace_opportunity_qualified");
    assert.deepEqual(b.events[0].params, { ace_stage: "qualified", company_name: "Acme Telco Ltd", industry: "telco", lead_source: "interactive-product-tour", engagement_time_msec: 1, session_id: "1731000100" });
    assert.equal(b.timestamp_micros, String(Date.parse(OPP.lastModifiedDate) * 1000));
    assert.equal(ace.mpBody({ lead: LEAD, opp: OPP, milestone: "qualified", nowMs: now + 5 * 86400e3 }).timestamp_micros, undefined);
  });

  await test("live catalogue: sends each milestone once, records it, and a re-run sends nothing", async () => {
    const db = fakeDb([{ ...LEAD, stage: "closed-won" }, { ...LEAD, id: "T", test: true }, { ...LEAD, id: "N", gaClientIds: [] }]);
    const fetch = fakeFetch(() => ({ status: 204, text: async () => "" }));
    const pc = { aceOpportunities: async () => ({ catalog: "AWS", opportunities: [{ ...OPP, stage: "Launched" }] }) };
    const job = ace.createAceGa4Job({ db, partnerCentral: pc, apiSecret: () => "s3cret", fetch, logger: quiet, now: () => new Date("2026-11-09T12:00:00Z") });
    const r1 = await job.run();
    assert.equal(r1.sent, 3);
    assert.deepEqual(fetch.calls.map((c) => c.body.events[0].name), ["ace_opportunity_qualified", "ace_opportunity_launched", "ace_opportunity_won"]);
    assert.ok(fetch.calls.every((c) => c.url.startsWith("https://www.google-analytics.com/mp/collect?measurement_id=G-LBEF15GKVQ&api_secret=s3cret")));
    assert.ok(fetch.calls.every((c) => c.body.client_id === "111.1731000000"), "test lead and lead without client id never sent");
    assert.deepEqual(Object.keys(db.cols.aceGa4Sync.get("O1").sent).sort(), ["launched", "qualified", "won"]);
    const r2 = await job.run();
    assert.equal(r2.sent, 0); assert.equal(fetch.calls.length, 3);
  });

  await test("sandbox catalogue: validation endpoint only, nothing recorded as sent", async () => {
    const db = fakeDb([LEAD]);
    const fetch = fakeFetch(() => ({ status: 200, text: async () => JSON.stringify({ validationMessages: [] }) }));
    const pc = { aceOpportunities: async () => ({ catalog: "Sandbox", opportunities: [OPP] }) };
    const r = await ace.createAceGa4Job({ db, partnerCentral: pc, apiSecret: () => "s", fetch, logger: quiet }).run();
    assert.equal(r.validated, 1); assert.equal(r.sent, 0);
    assert.ok(fetch.calls[0].url.startsWith("https://www.google-analytics.com/debug/mp/collect?"));
    assert.equal(db.cols.aceGa4Sync.size, 0);
  });

  await test("a failed live send is not recorded, so the next run retries it", async () => {
    const db = fakeDb([LEAD]);
    const fetch = fakeFetch(() => ({ status: 500, text: async () => "" }));
    const pc = { aceOpportunities: async () => ({ catalog: "AWS", opportunities: [OPP] }) };
    const r = await ace.createAceGa4Job({ db, partnerCentral: pc, apiSecret: () => "s", fetch, logger: quiet }).run();
    assert.equal(r.failed, 1); assert.equal(db.cols.aceGa4Sync.size, 0);
  });

  await test("no secret (or the deploy's \"unset\" placeholder): nothing is fetched", async () => {
    for (const secret of ["", "unset"]) {
      const fetch = fakeFetch(() => { throw new Error("must not fetch"); });
      const r = await ace.createAceGa4Job({ db: fakeDb([LEAD]), partnerCentral: {}, apiSecret: () => secret, fetch, logger: quiet }).run();
      assert.equal(r.skipped, "no secret");
    }
  });

  await test("leads-core: only a well-formed client_id is kept; one row per client, newest last, 10 max", () => {
    assert.equal(core.gaEntryFromWebsite({ gaClientId: "<x>" }), null);
    assert.equal(core.gaEntryFromWebsite({}), null);
    const e = core.gaEntryFromWebsite({ gaClientId: "1.1731000000", gaSessionId: "bad", leadSource: "industry-telco" }, "T");
    assert.deepEqual(e, { clientId: "1.1731000000", sessionId: "", leadSource: "industry-telco", at: "T" });
    let list = [];
    for (let i = 0; i < 12; i++) list = core.mergeGaClientIds(list, { clientId: `${i}.1731000000`, sessionId: "", leadSource: "", at: String(i) });
    assert.equal(list.length, 10); assert.equal(list[9].clientId, "11.1731000000");
    list = core.mergeGaClientIds(list, { clientId: "5.1731000000", at: "again" });
    assert.equal(list[9].at, "again"); assert.equal(list.filter((r) => r.clientId === "5.1731000000").length, 1);
    assert.deepEqual(core.normaliseLead("x", {}).gaClientIds, []);
  });

  await test("lead ingest: stores the website's GA4 ids on create and appends on a repeat; never for a test lead", async () => {
    const docs = new Map(); let i = 0;
    const db = { collection: () => ({
      get: async () => ({ docs: [...docs.keys()].map((id) => ({ id, data: () => docs.get(id), ref: { update: async (p) => Object.assign(docs.get(id), p) } })) }),
      add: async (d) => { const id = `l${++i}`; docs.set(id, d); return { id }; } }) };
    const api = createLeadIngest({ db, key: () => "k" });
    const res = () => { const r = { status(c) { r.code = c; return r; }, set() { return r; }, json(b) { r.body = b; return r; } }; return r; };
    const req = (body) => ({ method: "POST", path: "/leadIngest/v1/submit", body, get: (h) => (h.toLowerCase() === "x-lead-key" ? "k" : "") });
    const FORM = { company: "Acme", email: "a@acme.example", contactName: "Jo" };
    await api.handle(req({ ...FORM, gaClientId: "1.1731000000", gaSessionId: "1731000001", leadSource: "industry-telco" }), res());
    assert.equal(docs.get("l1").gaClientIds[0].clientId, "1.1731000000");
    await api.handle(req({ ...FORM, email: "b@acme.example", contactName: "Bo", gaClientId: "2.1731000000" }), res());
    assert.deepEqual(docs.get("l1").gaClientIds.map((g) => g.clientId), ["1.1731000000", "2.1731000000"]);
    await api.handle(req({ ...FORM, company: "Testco", test: true, gaClientId: "3.1731000000" }), res());
    assert.deepEqual(docs.get("l2").gaClientIds, []);
  });

  console.log(`ace-ga4: ${n} passed`);
})().catch((e) => { console.error(e); process.exit(1); });
