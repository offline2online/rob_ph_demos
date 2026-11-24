// functions/marketplace-agreements.js — Promote › License Manager's sync from
// AWS Marketplace (SearchAgreements + GetAgreementContacts) and the manual link,
// reached through the partnerCentral function's /v1/licences routes.
// No Firebase, no AWS, no network: Firestore, ID tokens and fetch are stubbed.
// Run: node test/marketplace-agreements.test.js
"use strict";
const assert = require("assert");
const { createPartnerCentralApi } = require("../functions/partner-central");
const { licenceFromSummary, licenceDocId, LICENCE_OPERATIONS, AGREEMENTS } = require("../functions/marketplace-agreements");

function fakeDb(seed = {}) {
  const state = JSON.parse(JSON.stringify(seed));
  const col = (name) => {
    state[name] = state[name] || {};
    return {
      doc: (id) => ({
        async get() { const d = state[name][id]; return { exists: d !== undefined, data: () => d }; },
        async set(data, opts) { state[name][id] = opts && opts.merge ? { ...(state[name][id] || {}), ...data } : { ...data }; },
      }),
      async add(data) { const id = `a${Object.keys(state[name]).length}`; state[name][id] = data; return { id }; },
    };
  };
  return { collection: col, state };
}
const USERS = { "owner@example.com": { email: "owner@example.com", role: "admin" }, "ed@ph.example": { email: "ed@ph.example", role: "editor" }, "vi@ph.example": { email: "vi@ph.example", role: "viewer" } };
const STS_OK = `<AssumeRoleWithWebIdentityResponse><AssumeRoleWithWebIdentityResult><Credentials><AccessKeyId>ASIATEST</AccessKeyId><SecretAccessKey>secret</SecretAccessKey><SessionToken>tok</SessionToken><Expiration>2099-01-01T00:00:00Z</Expiration></Credentials></AssumeRoleWithWebIdentityResult></AssumeRoleWithWebIdentityResponse>`;

const SUMMARIES = [
  { agreementId: "agmt-1", acceptor: { accountId: "123456789012" }, status: "ACTIVE", agreementType: "PurchaseAgreement", startTime: "2026-11-01T00:00:00Z", proposalSummary: { offerId: "offer-1", resources: [{ id: "prod-1", type: "SaaSProduct" }] } },
  { agreementId: "agmt-2", acceptor: { accountId: "210987654321" }, status: "ACTIVE", agreementType: "PurchaseAgreement", startTime: 1793404800 },
];
function makeApi({ seed, contacts = {}, searchStatus = 200 } = {}) {
  const db = fakeDb(seed);
  const calls = [];
  const fetch = async (url, init) => {
    if (url.startsWith("https://sts.amazonaws.com")) return { ok: true, status: 200, text: async () => STS_OK };
    const target = init.headers["x-amz-target"];
    const body = JSON.parse(init.body);
    calls.push({ url, target, body, headers: init.headers });
    let status = 200, reply = {};
    if (target.endsWith(".SearchAgreements")) {
      if (searchStatus !== 200) { status = searchStatus; reply = { __type: "AccessDeniedException", message: "not allowed" }; }
      else reply = body.nextToken ? { agreementViewSummaries: [SUMMARIES[1]] } : { agreementViewSummaries: [SUMMARIES[0]], nextToken: "p2" };
    } else if (target.endsWith(".GetAgreementContacts")) {
      const c = contacts[body.agreementId];
      if (c instanceof Error) { status = 400; reply = { __type: "ValidationException", message: c.message }; } else reply = c || { agreementContacts: [] };
    }
    return { ok: status < 400, status, text: async () => JSON.stringify(reply) };
  };
  const api = createPartnerCentralApi({
    db, fetch, logger: { warn() {}, error() {}, info() {} },
    verifyIdToken: async (t) => { if (!t.startsWith("tok:")) throw new Error("bad"); return { email: t.slice(4) }; },
    resolveConsoleUser: async (e) => USERS[e] || null,
    getWebIdentityToken: async () => "google-oidc-token",
    now: () => new Date("2026-11-24T10:00:00Z"),
  });
  return { api, db, calls };
}
async function call(api, method, path, { token = "ed@ph.example", body } = {}) {
  const headers = { "x-firebase-id-token": token ? `tok:${token}` : "" };
  const req = { method, path: `/partnerCentral${path}`, body, get: (h) => headers[h.toLowerCase()] || "" };
  const res = { statusCode: 0, body: null, status(c) { this.statusCode = c; return this; }, set() { return this; }, json(b) { this.body = b; return this; } };
  await api.handle(req, res);
  return res;
}

const checks = [];
const check = (n, f) => checks.push([n, f]);

check("the operation list is closed and read-only", async () => {
  assert.deepStrictEqual(Object.keys(LICENCE_OPERATIONS).sort(), ["GetAgreementContacts", "SearchAgreements"]);
  assert.ok(Object.values(LICENCE_OPERATIONS).every((o) => o.readOnly));
  assert.strictEqual(AGREEMENTS.signingName, "aws-marketplace");
});

check("editors and admins may sync; viewers and strangers may not", async () => {
  const { api } = makeApi();
  assert.strictEqual((await call(api, "POST", "/v1/licences/sync", { token: "" })).statusCode, 401);
  const viewer = await call(api, "POST", "/v1/licences/sync", { token: "vi@ph.example" });
  assert.strictEqual(viewer.statusCode, 403);
  assert.match(viewer.body.error, /sync or link licences/);
  assert.strictEqual((await call(api, "POST", "/v1/licences/sync", { token: "owner@example.com" })).statusCode, 200);
});

check("sync pages through the agreements, reads each one's contacts and stores them raw", async () => {
  const contacts = { "agmt-1": { agreementContacts: [{ name: "Ann", emailAddress: "ann@acme-retail.com", companyName: "Acme Retail", country: "GB" }] }, "agmt-2": new Error("contacts not available") };
  const { api, db, calls } = makeApi({ contacts });
  const res = await call(api, "POST", "/v1/licences/sync");
  assert.strictEqual(res.statusCode, 200, JSON.stringify(res.body));
  assert.deepStrictEqual(res.body, { ok: true, count: 2, contactErrors: 1, truncated: false });
  const search = calls.filter((c) => c.target === "AWSMPCommerceService_v20200301.SearchAgreements");
  assert.strictEqual(search.length, 2, "two pages");
  assert.deepStrictEqual(search[0].body.filters, [{ name: "PartyType", values: ["Proposer"] }, { name: "AgreementType", values: ["PurchaseAgreement"] }]);
  assert.strictEqual(search[1].body.nextToken, "p2");
  assert.ok(calls.every((c) => c.url === "https://agreement-marketplace.us-east-1.amazonaws.com/"));
  assert.ok(calls.every((c) => /Credential=ASIATEST\/\d{8}\/us-east-1\/aws-marketplace\/aws4_request/.test(c.headers.authorization)), "signed for aws-marketplace");
  assert.deepStrictEqual(calls.filter((c) => c.target.endsWith(".GetAgreementContacts")).map((c) => c.body).sort((a, b) => a.agreementId.localeCompare(b.agreementId)), [{ agreementId: "agmt-1" }, { agreementId: "agmt-2" }]);
  const one = db.state.licences["agmt-1"];
  assert.strictEqual(one.awsAccountId, "123456789012");
  assert.strictEqual(one.offerId, "offer-1");
  assert.deepStrictEqual(one.productIds, ["prod-1"]);
  assert.strictEqual(one.startTime, "2026-11-01T00:00:00.000Z");
  assert.deepStrictEqual(JSON.parse(one.contactsRaw), contacts["agmt-1"]);
  assert.strictEqual(one.contactsError, null);
  assert.strictEqual(one.syncedBy, "ed@ph.example");
  const two = db.state.licences["agmt-2"];
  assert.match(two.contactsError, /ValidationException/);
  assert.ok(!("contactsRaw" in two), "a failed contacts read doesn't wipe earlier contacts");
  assert.strictEqual(two.startTime, "2026-10-31T00:00:00.000Z", "epoch seconds read as a time");
  assert.strictEqual(db.state.consoleConfig.licenceSync.count, 2);
  assert.ok(Object.values(db.state.partnerCentralAudit).some((a) => a.operation === "GetAgreementContacts" && a.service === "marketplace-agreements"), "every call is audited");
});

check("a failed sync says why on the page's status doc and keeps the manual links", async () => {
  const { api, db } = makeApi({ searchStatus: 403, seed: { licences: { "agmt-1": { agreementId: "agmt-1", manualLink: { prospectId: "acme" } } } } });
  const res = await call(api, "POST", "/v1/licences/sync");
  assert.strictEqual(res.statusCode, 502);
  assert.match(res.body.error, /AccessDeniedException/);
  assert.match(db.state.consoleConfig.licenceSync.lastError, /AccessDeniedException/);
  assert.deepStrictEqual(db.state.licences["agmt-1"].manualLink, { prospectId: "acme" });
});

check("a person links a licence to a TAM record, and can clear it", async () => {
  const { api, db } = makeApi({ seed: { licences: { "agmt-1": { agreementId: "agmt-1" } }, prospects: { "acme-united-kingdom": { name: "Acme Retail" } } } });
  let res = await call(api, "POST", "/v1/licences/link", { body: { agreementId: "agmt-1", prospectId: "acme-united-kingdom" } });
  assert.strictEqual(res.statusCode, 200, JSON.stringify(res.body));
  const link = db.state.licences["agmt-1"].manualLink;
  assert.strictEqual(link.prospectId, "acme-united-kingdom");
  assert.strictEqual(link.by, "ed@ph.example", "who linked it");
  assert.ok(link.at instanceof Date);
  assert.strictEqual((await call(api, "POST", "/v1/licences/link", { body: { agreementId: "agmt-1", prospectId: "nope" } })).statusCode, 404);
  assert.strictEqual((await call(api, "POST", "/v1/licences/link", { body: { agreementId: "agmt-9", prospectId: "acme-united-kingdom" } })).statusCode, 404);
  assert.strictEqual((await call(api, "POST", "/v1/licences/link", { body: { agreementId: "agmt-1", prospectId: "../x" } })).statusCode, 400);
  assert.strictEqual((await call(api, "POST", "/v1/licences/link", { token: "vi@ph.example", body: { agreementId: "agmt-1", prospectId: "" } })).statusCode, 403);
  res = await call(api, "POST", "/v1/licences/link", { body: { agreementId: "agmt-1", prospectId: "" } });
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(db.state.licences["agmt-1"].manualLink, null);
});

check("an unknown licence route is a 404, and the rest of Partner Central stays admin-only", async () => {
  const { api } = makeApi();
  assert.strictEqual((await call(api, "GET", "/v1/licences/sync")).statusCode, 404);
  assert.strictEqual((await call(api, "GET", "/v1/status")).statusCode, 403);
});

check("summary → licence fields and doc ids", async () => {
  assert.deepStrictEqual(licenceFromSummary({ AgreementId: "agmt-X", Acceptor: { AccountId: "123456789012" }, Status: "ACTIVE" }).awsAccountId, "123456789012");
  assert.strictEqual(licenceDocId("agmt/1 2"), "agmt_1_2");
});

(async () => {
  for (const [name, fn] of checks) {
    try { await fn(); console.log(`ok - ${name}`); } catch (err) { console.error(`FAIL - ${name}`); console.error(err); process.exitCode = 1; }
  }
})();
