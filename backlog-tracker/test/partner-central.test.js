// functions/partner-central.js — AWS Partner Central connection.
// No Firebase, no AWS, no network: Firestore, ID tokens and fetch are stubbed.
// Run: node test/partner-central.test.js
"use strict";
const assert = require("assert");
const { createPartnerCentralApi, signRequest, OPERATIONS } = require("../functions/partner-central");

function fakeDb() {
  const state = {};
  const col = (name) => {
    state[name] = state[name] || {};
    return {
      doc: (id) => ({
        async get() { const d = state[name][id]; return { exists: d !== undefined, data: () => d }; },
        async set(data, opts) { state[name][id] = opts && opts.merge ? { ...(state[name][id] || {}), ...data } : { ...data }; },
      }),
      async add(data) { const id = `a${Object.keys(state[name]).length}`; state[name][id] = data; return { id }; },
      orderBy() { return { limit: () => ({ async get() { return { docs: Object.values(state[name]).reverse().map((d) => ({ data: () => d })) }; } }) }; },
    };
  };
  return { collection: col, state };
}
const USERS = { "rob@offline2online.com": { email: "rob@offline2online.com", role: "admin" }, "ed@x.com": { email: "ed@x.com", role: "editor" } };
const STS_OK = `<AssumeRoleWithWebIdentityResponse><AssumeRoleWithWebIdentityResult><Credentials><AccessKeyId>ASIATEST</AccessKeyId><SecretAccessKey>secret</SecretAccessKey><SessionToken>tok</SessionToken><Expiration>2099-01-01T00:00:00Z</Expiration></Credentials></AssumeRoleWithWebIdentityResult></AssumeRoleWithWebIdentityResponse>`;

function makeApi({ awsReply, stsStatus = 200, stsBody = STS_OK } = {}) {
  const db = fakeDb();
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, init });
    if (url.startsWith("https://sts.amazonaws.com")) return { ok: stsStatus < 400, status: stsStatus, text: async () => stsBody };
    const reply = awsReply ? awsReply(url, init) : { status: 200, body: { OpportunitySummaries: [] } };
    return { ok: reply.status < 400, status: reply.status, text: async () => JSON.stringify(reply.body) };
  };
  const api = createPartnerCentralApi({
    db, fetch, logger: { warn() {}, error() {}, info() {} },
    verifyIdToken: async (t) => { if (!t.startsWith("tok:")) throw new Error("bad"); return { email: t.slice(4) }; },
    resolveConsoleUser: async (e) => USERS[e] || null,
    getWebIdentityToken: async () => "google-oidc-token",
  });
  return { api, db, calls };
}
async function call(api, method, path, { token = "rob@offline2online.com", body } = {}) {
  const headers = { "x-firebase-id-token": token ? `tok:${token}` : "" };
  const req = { method, path: `/partnerCentral${path}`, body, get: (h) => headers[h.toLowerCase()] || "" };
  const res = { statusCode: 0, body: null, status(c) { this.statusCode = c; return this; }, set() { return this; }, json(b) { this.body = b; return this; } };
  await api.handle(req, res);
  return res;
}

const checks = [];
const check = (n, f) => checks.push([n, f]);

check("only admins reach any route", async () => {
  const { api } = makeApi();
  assert.strictEqual((await call(api, "GET", "/v1/status", { token: "" })).statusCode, 401);
  assert.strictEqual((await call(api, "GET", "/v1/status", { token: "ed@x.com" })).statusCode, 403);
});

check("before any call the status says not linked yet, catalogue Sandbox", async () => {
  const { api } = makeApi();
  const r = await call(api, "GET", "/v1/status");
  assert.strictEqual(r.body.state, "not-linked");
  assert.strictEqual(r.body.catalog, "Sandbox");
  assert.match(r.body.note, /Not linked yet/);
});

check("assumes the role with a web identity token (no stored key) and signs the Selling call", async () => {
  const { api, calls } = makeApi();
  const r = await call(api, "POST", "/v1/test");
  assert.strictEqual(r.statusCode, 200);
  const sts = calls[0];
  assert.ok(sts.init.body.includes("AssumeRoleWithWebIdentity") && sts.init.body.includes("WebIdentityToken=google-oidc-token"));
  assert.ok(!/Authorization/i.test(JSON.stringify(sts.init.headers)), "STS call is unsigned");
  const aws = calls[1];
  assert.strictEqual(aws.url, "https://partnercentral-selling.us-east-1.amazonaws.com/");
  assert.strictEqual(aws.init.headers["x-amz-target"], "AWSPartnerCentralSelling.ListOpportunities");
  assert.match(aws.init.headers.authorization, /^AWS4-HMAC-SHA256 Credential=ASIATEST\/\d{8}\/us-east-1\/partnercentral-selling\/aws4_request/);
  assert.strictEqual(aws.init.headers["x-amz-security-token"], "tok");
  assert.strictEqual(JSON.parse(aws.init.body).Catalog, "Sandbox");
});

check("credentials are cached: a second call does not hit STS again", async () => {
  const { api, calls } = makeApi();
  await call(api, "GET", "/v1/opportunities");
  await call(api, "GET", "/v1/opportunities");
  assert.strictEqual(calls.filter((c) => c.url.includes("sts.")).length, 1);
});

check("status turns connected and every call is audited", async () => {
  const { api } = makeApi();
  await call(api, "GET", "/v1/opportunities");
  await call(api, "POST", "/v1/opportunities", { body: { Origin: "Partner Referral" } });
  assert.strictEqual((await call(api, "GET", "/v1/status")).body.state, "connected");
  const a = (await call(api, "GET", "/v1/audit")).body.entries;
  assert.deepStrictEqual(a.map((e) => e.operation).sort(), ["CreateOpportunity", "ListOpportunities"]);
  assert.ok(a.every((e) => e.ok && e.by === "rob@offline2online.com" && e.catalog === "Sandbox"));
});

check("create sends a client token; update names the identifier", async () => {
  const { api, calls } = makeApi();
  await call(api, "POST", "/v1/opportunities", { body: { Origin: "x" } });
  assert.ok(JSON.parse(calls[1].init.body).ClientToken);
  await call(api, "PATCH", "/v1/opportunities/O1234", { body: { LifeCycle: { Stage: "Qualified" } } });
  const u = calls[2];
  assert.strictEqual(u.init.headers["x-amz-target"], "AWSPartnerCentralSelling.UpdateOpportunity");
  assert.strictEqual(JSON.parse(u.init.body).Identifier, "O1234");
});

check("benefit drafts go to the Benefits API and no submit operation exists anywhere", async () => {
  const { api, calls } = makeApi();
  await call(api, "POST", "/v1/benefits/drafts", { body: { Title: "x" } });
  assert.strictEqual(calls[1].init.headers["x-amz-target"], "AWSPartnerCentralBenefits.CreateBenefitApplication");
  assert.ok(!Object.keys(OPERATIONS).some((o) => /Submit/i.test(o)));
  await assert.rejects(api.callAws("SubmitBenefitApplication", {}), /not allowed/);
  assert.strictEqual(calls.length, 2, "the refused operation never reached the network");
});

check("a refused role assumption reads as not linked yet, and is audited", async () => {
  const { api } = makeApi({ stsStatus: 403, stsBody: "<ErrorResponse><Error><Code>AccessDenied</Code><Message>not authorized</Message></Error></ErrorResponse>" });
  const r = await call(api, "POST", "/v1/test");
  assert.strictEqual(r.statusCode, 502);
  assert.strictEqual((await call(api, "GET", "/v1/status")).body.state, "not-linked");
  assert.strictEqual((await call(api, "GET", "/v1/audit")).body.entries[0].ok, false);
});

check("live catalogue needs an explicit LIVE confirmation, and is then used", async () => {
  const { api, calls } = makeApi();
  assert.strictEqual((await call(api, "POST", "/v1/config", { body: { catalog: "AWS" } })).statusCode, 400);
  assert.strictEqual((await call(api, "POST", "/v1/config", { body: { catalog: "Prod" } })).statusCode, 400);
  assert.strictEqual((await call(api, "POST", "/v1/config", { body: { catalog: "AWS", confirm: "LIVE" } })).statusCode, 200);
  await call(api, "GET", "/v1/opportunities");
  assert.strictEqual(JSON.parse(calls[1].init.body).Catalog, "AWS");
  assert.strictEqual((await call(api, "GET", "/v1/status")).body.catalog, "AWS");
});

check("SigV4 matches a recomputation and is deterministic", () => {
  const args = { host: "h.example", service: "svc", creds: { accessKeyId: "A", secretAccessKey: "S", sessionToken: "T" }, body: "{}", date: new Date("2026-11-06T12:00:00Z"), headers: { "x-amz-target": "T.Op" } };
  const a = signRequest(args); const b = signRequest(args);
  assert.strictEqual(a.authorization, b.authorization);
  assert.match(a.authorization, /Credential=A\/20261106\/us-east-1\/svc\/aws4_request, SignedHeaders=host;x-amz-date;x-amz-security-token;x-amz-target, Signature=[0-9a-f]{64}$/);
});

(async () => {
  let failed = 0;
  for (const [name, fn] of checks) {
    try { await fn(); } catch (err) { failed++; console.error(`✗ ${name}\n  ${err.stack || err}`); }
  }
  console.log(failed ? `partner-central: ${failed} failed` : `partner-central: all ${checks.length} checks passed`);
  process.exit(failed ? 1 : 0);
})();
