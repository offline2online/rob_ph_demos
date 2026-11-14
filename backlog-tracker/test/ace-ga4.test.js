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
    const db = fakeDb([{ ...LEAD, stage: "closed-won" }, { ...LEAD, id: "T", test: true }, { ...LEAD, id: "N", gaClientIds: [] },
      { ...LEAD, id: "F", leadType: "operator", gaClientIds: [{ clientId: "999.1731000000", sessionId: "", leadSource: "operator", at: "x" }] }]);
    const fetch = fakeFetch(() => ({ status: 204, text: async () => "" }));
    const pc = { aceOpportunities: async () => ({ catalog: "AWS", opportunities: [{ ...OPP, stage: "Launched" }] }) };
    const job = ace.createAceGa4Job({ db, partnerCentral: pc, apiSecret: () => "s3cret", fetch, logger: quiet, now: () => new Date("2026-11-09T12:00:00Z") });
    const r1 = await job.run();
    assert.equal(r1.sent, 3);
    assert.deepEqual(fetch.calls.map((c) => c.body.events[0].name), ["ace_opportunity_qualified", "ace_opportunity_launched", "ace_opportunity_won"]);
    assert.ok(fetch.calls.every((c) => c.url.startsWith("https://www.google-analytics.com/mp/collect?measurement_id=G-LBEF15GKVQ&api_secret=s3cret")));
    assert.ok(fetch.calls.every((c) => c.body.client_id === "111.1731000000"), "test lead, operator inquiry and lead without client id never sent");
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

  await test("lead ingest: stores the website's GA4 ids on create and appends on a repeat, through the TAM path and by name; never for a test lead", async () => {
    // Same shape as lead-ingest.test.js's fake: named collections, add / doc().set / doc().update.
    const cols = new Map(); let i = 0;
    const col = (name) => { if (!cols.has(name)) cols.set(name, new Map()); return cols.get(name); };
    const ref = (name, id) => ({ id, set: async (d) => { col(name).set(id, { ...d }); }, update: async (p) => { Object.assign(col(name).get(id), p); } });
    const db = { collection: (name) => ({
      get: async () => { const ds = [...col(name).keys()].map((id) => ({ id, data: () => col(name).get(id), ref: ref(name, id) })); return { docs: ds, forEach: (f) => ds.forEach(f) }; },
      add: async (d) => { const id = `l${++i}`; col(name).set(id, d); return { id }; },
      doc: (id) => ref(name, id) }) };
    const api = createLeadIngest({ db, key: () => "k" });
    const res = () => { const r = { status(c) { r.code = c; return r; }, set() { return r; }, json(b) { r.body = b; return r; } }; return r; };
    const req = (body) => ({ method: "POST", path: "/leadIngest/v1/submit", body, get: (h) => (h.toLowerCase() === "x-lead-key" ? "k" : "") });
    const FORM = { company: "Acme Telco", website: "acme.example", email: "jo@acme.example", contactName: "Jo", countries: "UK" };
    const leads = () => [...col("leads").values()].filter((l) => l.test !== true);
    let r = res(); await api.handle(req({ ...FORM, gaClientId: "1.1731000000", gaSessionId: "1731000001", leadSource: "industry-telco" }), r);
    assert.ok([200, 201].includes(r.code), JSON.stringify(r.body));
    assert.equal(leads().length, 1);
    assert.deepEqual(leads()[0].gaClientIds.map((g) => [g.clientId, g.sessionId, g.leadSource]), [["1.1731000000", "1731000001", "industry-telco"]]);
    r = res(); await api.handle(req({ ...FORM, email: "bo@acme.example", contactName: "Bo", gaClientId: "2.1731000000" }), r);
    assert.equal(leads().length, 1, "same company and country: one lead");
    assert.deepEqual(leads()[0].gaClientIds.map((g) => g.clientId), ["1.1731000000", "2.1731000000"]);
    r = res(); await api.handle(req({ ...FORM, email: "cy@acme.example", contactName: "Cy" }), r);
    assert.equal(leads()[0].gaClientIds.length, 2, "a submission without a client_id leaves the list alone");
    r = res(); await api.handle(req({ ...FORM, company: "Testco", website: "testco.example", email: "t@testco.example", test: true, gaClientId: "3.1731000000" }), r);
    const GATE = { lead_type: "operator", lead_source: "Run Your Own RMN page – product tour", full_name: "Alex Rivers", email: "alex@gmail.example", operating_region: "Leeds", background: core.BACKGROUNDS[0].label, page: "/run-your-own-rmn/" };
    r = res(); await api.handle(req({ ...GATE, gaClientId: "7.1731000000" }), r);
    r = res(); await api.handle(req({ ...GATE, gaClientId: "8.1731000000" }), r);
    const f = [...col("leads").values()].filter((l) => l.leadType === "operator");
    assert.equal(f.length, 1, "one operator inquiry per email");
    assert.deepEqual(f[0].gaClientIds.map((g) => g.clientId), ["7.1731000000", "8.1731000000"], "operator create and repeat both keep the GA4 id");
    const t = [...col("leads").values()].find((l) => l.test === true);
    assert.ok(t, "test lead stored"); assert.deepEqual(t.gaClientIds, [], "a test lead never carries a GA4 id");
  });

  await test("endpoint: POST with the board key runs the job and answers its summary; anything else is refused and runs nothing", async () => {
    const mkRes = () => { const r = { headers: {}, status(c) { r.code = c; return r; }, set(k, v) { r.headers[k] = v; return r; }, json(b) { r.body = b; return r; } }; return r; };
    const mkReq = (method, key) => ({ method, get: (h) => (h.toLowerCase() === "x-board-key" ? key : "") });
    let runs = 0;
    const pc = { aceOpportunities: async () => { runs++; return { catalog: "Sandbox", opportunities: [] }; } };
    const job = ace.createAceGa4Job({ db: fakeDb([LEAD]), partnerCentral: pc, apiSecret: () => "s", boardKey: () => "bk", fetch: fakeFetch(() => ({ status: 200, text: async () => "{}" })), logger: quiet });
    let r = mkRes(); await job.handle(mkReq("GET", "bk"), r); assert.equal(r.code, 405);
    r = mkRes(); await job.handle(mkReq("POST", "wrong"), r); assert.equal(r.code, 401);
    const unset = ace.createAceGa4Job({ db: fakeDb([LEAD]), partnerCentral: pc, apiSecret: () => "s", boardKey: () => "unset", logger: quiet });
    r = mkRes(); await unset.handle(mkReq("POST", "unset"), r); assert.equal(r.code, 401, "the deploy's \"unset\" placeholder is never a key");
    assert.equal(runs, 0);
    r = mkRes(); await job.handle(mkReq("POST", "bk"), r);
    assert.equal(r.code, 200); assert.equal(r.body.ok, true); assert.equal(r.body.catalog, "Sandbox"); assert.equal(runs, 1);
    assert.equal(r.headers["Cache-Control"], "no-store");
  });

  await test("trigger: aceToGa4 is an HTTP function called hourly by ace-ga4.yml, never a Cloud Scheduler job", () => {
    const fs = require("fs"); const path = require("path");
    const idx = fs.readFileSync(path.join(__dirname, "../functions/index.js"), "utf8");
    assert.match(idx, /exports\.aceToGa4 = onRequest\(/);
    assert.match(idx, /secrets: \[GA4_MP_API_SECRET, BOARD_API_KEY\]/);
    const wf = fs.readFileSync(path.join(__dirname, "../../.github/workflows/ace-ga4.yml"), "utf8");
    assert.match(wf, /cron: '\d+ \* \* \* \*'/, "hourly");
    assert.match(wf, /cloudfunctions\.net\/aceToGa4/);
    assert.match(wf, /X-Board-Key: \$BOARD_API_KEY/);
  });

  console.log(`ace-ga4: ${n} passed`);
})().catch((e) => { console.error(e); process.exit(1); });
