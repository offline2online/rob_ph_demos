// functions/partner-central.js — AWS Partner Central connection.
// No Firebase, no AWS, no network: Firestore, ID tokens and fetch are stubbed.
// Run: node test/partner-central.test.js
"use strict";
const assert = require("assert");
const { createPartnerCentralApi, signRequest, normaliseOpportunity, sanitiseAceInput, OPERATIONS, parseAgentResult, parseMcpBody, AGENT_MCP, AGENT_TOOLS } = require("../functions/partner-central");

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
      orderBy() { return { limit: () => ({ async get() { return { docs: Object.entries(state[name]).reverse().map(([id, d]) => ({ id, data: () => d })) }; } }) }; },
      async get() { return { docs: Object.entries(state[name]).map(([id, d]) => ({ id, data: () => d })) }; },
      where(field, op, value) { return { limit: (n) => ({ async get() { return { docs: Object.entries(state[name]).filter(([, d]) => d && d[field] === value).slice(0, n).map(([id, d]) => ({ id, data: () => d })) }; } }) }; },
    };
  };
  return { collection: col, state };
}
const USERS = { "owner@example.com": { email: "owner@example.com", role: "admin" }, "ed@x.example": { email: "ed@x.example", role: "editor" } };
const STS_OK = `<AssumeRoleWithWebIdentityResponse><AssumeRoleWithWebIdentityResult><Credentials><AccessKeyId>ASIATEST</AccessKeyId><SecretAccessKey>secret</SecretAccessKey><SessionToken>tok</SessionToken><Expiration>2099-01-01T00:00:00Z</Expiration></Credentials></AssumeRoleWithWebIdentityResult></AssumeRoleWithWebIdentityResponse>`;

function makeApi({ awsReply, stsStatus = 200, stsBody = STS_OK } = {}) {
  const db = fakeDb();
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, init });
    if (url.startsWith("https://sts.amazonaws.com")) return { ok: stsStatus < 400, status: stsStatus, text: async () => stsBody };
    const reply = awsReply ? awsReply(url, init) : { status: 200, body: { OpportunitySummaries: [] } };
    return { ok: reply.status < 400, status: reply.status, headers: { get: (h) => (/content-type/i.test(h) ? reply.contentType || "application/json" : null) }, text: async () => (typeof reply.raw === "string" ? reply.raw : JSON.stringify(reply.body)) };
  };
  const api = createPartnerCentralApi({
    db, fetch, logger: { warn() {}, error() {}, info() {} },
    verifyIdToken: async (t) => { if (!t.startsWith("tok:")) throw new Error("bad"); return { email: t.slice(4) }; },
    resolveConsoleUser: async (e) => USERS[e] || null,
    getWebIdentityToken: async () => "google-oidc-token",
  });
  return { api, db, calls };
}
async function call(api, method, path, { token = "owner@example.com", body } = {}) {
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
  assert.strictEqual((await call(api, "GET", "/v1/status", { token: "ed@x.example" })).statusCode, 403);
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
  assert.strictEqual(aws.url, "https://partnercentral-selling.us-east-1.api.aws/");
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
  assert.ok(a.every((e) => e.ok && e.by === "owner@example.com" && e.catalog === "Sandbox"));
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
  assert.strictEqual(calls[1].init.headers["x-amz-target"], "PartnerCentralBenefitsService.CreateBenefitApplication");
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

check("a network failure reports the underlying cause (code and hostname), not just 'fetch failed'", async () => {
  const errors = [];
  const db = fakeDb();
  const fetch = async (url) => {
    if (url.startsWith("https://sts.amazonaws.com")) return { ok: true, status: 200, text: async () => STS_OK };
    throw Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error("getaddrinfo ENOTFOUND bad.example"), { code: "ENOTFOUND", hostname: "bad.example" }) });
  };
  const api = createPartnerCentralApi({
    db, fetch, logger: { warn() {}, error: (m, d) => errors.push([m, d]), info() {} },
    verifyIdToken: async (t) => ({ email: t.slice(4) }), resolveConsoleUser: async (e) => USERS[e] || null,
    getWebIdentityToken: async () => "t",
  });
  const r = await call(api, "POST", "/v1/test");
  assert.strictEqual(r.statusCode, 502);
  assert.match(r.body.error, /Couldn't reach bad\.example \(ENOTFOUND\)/);
  assert.doesNotMatch(r.body.error, /^fetch failed$/);
  const audit = (await call(api, "GET", "/v1/audit")).body.entries[0];
  assert.match(audit.error, /ENOTFOUND/);
  assert.strictEqual(errors[0][1].code, "ENOTFOUND");
  assert.strictEqual(errors[0][1].hostname, "bad.example");
  assert.match((await call(api, "GET", "/v1/status")).body.lastError, /ENOTFOUND/);
});

check("an AWS authorisation error reads as Not linked yet with AWS's own message", async () => {
  const { api } = makeApi({ awsReply: () => ({ status: 403, body: { __type: "com.amazon.coral.service#AccessDeniedException", message: "Account is not linked to Partner Central" } }) });
  const r = await call(api, "POST", "/v1/test");
  assert.strictEqual(r.statusCode, 502);
  assert.match(r.body.error, /AccessDeniedException: Account is not linked/);
  const s = (await call(api, "GET", "/v1/status")).body;
  assert.strictEqual(s.state, "not-linked");
  assert.match(s.note, /AWS said: AccessDeniedException: Account is not linked/);
  assert.strictEqual((await call(api, "GET", "/v1/audit")).body.entries[0].awsType, "AccessDeniedException");
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

const SUMMARY = { Id: "O1", LifeCycle: { Stage: "Qualified", ReviewStatus: "Approved", TargetCloseDate: "2026-12-31" }, Customer: { Account: { CompanyName: "Acme Retail" } }, Project: { Title: "Menu boards" } };
const DETAIL = { ...SUMMARY, Project: { Title: "Menu boards", ExpectedCustomerSpend: [{ Amount: "1200", CurrencyCode: "USD", Frequency: "Monthly" }, { Amount: "12000", CurrencyCode: "USD", Frequency: "Yearly" }] }, AwsTeam: [{ FirstName: "Ann", LastName: "Lee", Email: "ann@amazon.com", BusinessTitle: "Account Manager" }], AwsOpportunityInsights: { Score: 82 } };

check("the ACE rows join the list with each opportunity's detail", () => {
  const r = normaliseOpportunity(SUMMARY, DETAIL);
  assert.deepStrictEqual(
    { id: r.id, name: r.name, customer: r.customer, stage: r.stage, reviewStatus: r.reviewStatus, score: r.score, close: r.targetCloseDate, mo: r.expectedMonthly, seller: r.awsSeller.email },
    { id: "O1", name: "Menu boards", customer: "Acme Retail", stage: "Qualified", reviewStatus: "Approved", score: 82, close: "2026-12-31", mo: { amount: 2200, currency: "USD" }, seller: "ann@amazon.com" });
  assert.strictEqual(r.partnerCentralUrl, "https://partnercentral.awspartner.com/partnercentral2/s/opportunities/O1");
  const bare = normaliseOpportunity({ Id: "O2" }, null);
  assert.strictEqual(bare.awsSeller, null); assert.strictEqual(bare.score, null); assert.strictEqual(bare.expectedMonthly, null);
});

check("GET /v1/ace is open to editors but not signed-out callers, pages the list and fetches each detail", async () => {
  const { api, calls } = makeApi({ awsReply: (url, init) => (init.headers["x-amz-target"].endsWith("GetOpportunity") ? { status: 200, body: DETAIL } : { status: 200, body: { OpportunitySummaries: [SUMMARY] } }) });
  assert.strictEqual((await call(api, "GET", "/v1/ace", { token: "" })).statusCode, 401);
  const r = await call(api, "GET", "/v1/ace", { token: "ed@x.example" });
  assert.strictEqual(r.statusCode, 200);
  assert.strictEqual(r.body.opportunities.length, 1);
  assert.strictEqual(r.body.opportunities[0].awsSeller.name, "Ann Lee");
  assert.deepStrictEqual(calls.filter((c) => c.url.includes("selling")).map((c) => c.init.headers["x-amz-target"].split(".")[1]), ["ListOpportunities", "GetOpportunity"]);
  assert.strictEqual((await call(api, "POST", "/v1/opportunities", { token: "ed@x.example", body: {} })).statusCode, 403, "writes stay admin only");
});

check("a detail call that fails leaves the row with what the list gave", async () => {
  const { api } = makeApi({ awsReply: (url, init) => (init.headers["x-amz-target"].endsWith("GetOpportunity") ? { status: 500, body: { message: "boom" } } : { status: 200, body: { OpportunitySummaries: [SUMMARY] } }) });
  const r = await call(api, "GET", "/v1/ace");
  assert.strictEqual(r.statusCode, 200);
  assert.strictEqual(r.body.opportunities[0].customer, "Acme Retail");
  assert.strictEqual(r.body.opportunities[0].awsSeller, null);
});

// ── Editing from the console (detail dialog) ──
check("normalise carries the dates, next steps and description the dialog edits", () => {
  const r = normaliseOpportunity(SUMMARY, { ...DETAIL, CreatedDate: "2026-10-01T09:00:00Z", LastModifiedDate: "2026-11-05T10:00:00Z", LifeCycle: { ...SUMMARY.LifeCycle, NextSteps: "Send quote" }, Project: { ...DETAIL.Project, CustomerBusinessProblem: "Stale menus" } });
  assert.deepStrictEqual({ c: r.createdDate, u: r.lastModifiedDate, n: r.nextSteps, d: r.description }, { c: "2026-10-01T09:00:00Z", u: "2026-11-05T10:00:00Z", n: "Send quote", d: "Stale menus" });
});

check("sanitiseAceInput validates and requires title and customer only when creating", () => {
  assert.deepStrictEqual(sanitiseAceInput({}, { creating: true }).errors, ["title is required", "customer is required"]);
  assert.deepStrictEqual(sanitiseAceInput({ name: " A ", customer: "B", targetCloseDate: "2026-13-45x", stage: "Nope", monthlyAmount: "abc" }, { creating: true }).errors.length, 3);
  const ok = sanitiseAceInput({ nextSteps: "x", stage: "qualified", targetCloseDate: "2026-12-01", monthlyAmount: "300", currency: "gbp", website: "acme.com" });
  assert.deepStrictEqual(ok.errors, []);
  assert.deepStrictEqual(ok.values, { nextSteps: "x", stage: "Qualified", targetCloseDate: "2026-12-01", monthlyAmount: 300, currency: "GBP", website: "https://acme.com" });
  assert.deepStrictEqual(sanitiseAceInput({ name: "" }).errors, ["title cannot be empty"]);
});

check("PATCH /v1/ace/{id} reads, merges, writes UpdateOpportunity, drops the cache and returns the refreshed row", async () => {
  let score = 60; let nextSteps = "Old";
  const { api, calls } = makeApi({ awsReply: (url, init) => {
    const op = init.headers["x-amz-target"].split(".")[1];
    if (op === "GetOpportunity") return { status: 200, body: { ...DETAIL, LastModifiedDate: "2026-11-05T10:00:00Z", PartnerOpportunityIdentifier: "P1", OpportunityType: "Net New Business", LifeCycle: { ...SUMMARY.LifeCycle, NextSteps: nextSteps, ReviewComments: "read only" }, AwsOpportunityInsights: { Score: score } } };
    if (op === "UpdateOpportunity") { score = 75; nextSteps = JSON.parse(init.body).LifeCycle.NextSteps; return { status: 200, body: { Id: "O1" } }; }
    return { status: 200, body: { OpportunitySummaries: [SUMMARY] } };
  } });
  assert.strictEqual((await call(api, "GET", "/v1/ace", { token: "ed@x.example" })).body.opportunities[0].score, 60);
  assert.strictEqual((await call(api, "PATCH", "/v1/ace/O1", { token: "ed@x.example", body: { name: "" } })).statusCode, 400);
  const r = await call(api, "PATCH", "/v1/ace/O1", { token: "ed@x.example", body: { nextSteps: "Send quote", monthlyAmount: 500 } });
  assert.strictEqual(r.statusCode, 200);
  assert.strictEqual(r.body.opportunity.score, 75, "the score is re-read after the write");
  const upd = JSON.parse(calls.find((c) => c.init.headers && c.init.headers["x-amz-target"] === "AWSPartnerCentralSelling.UpdateOpportunity").init.body);
  assert.strictEqual(upd.Identifier, "O1"); assert.strictEqual(upd.LastModifiedDate, "2026-11-05T10:00:00Z");
  assert.strictEqual(upd.LifeCycle.NextSteps, "Send quote"); assert.strictEqual(upd.LifeCycle.Stage, "Qualified", "untouched fields are kept");
  assert.ok(!("ReviewComments" in upd.LifeCycle), "read-only parts are not sent back");
  assert.strictEqual(upd.Project.Title, "Menu boards"); assert.strictEqual(upd.Project.ExpectedCustomerSpend[0].Amount, "500");
  assert.strictEqual(upd.PartnerOpportunityIdentifier, "P1");
  assert.strictEqual((await call(api, "GET", "/v1/ace", { token: "ed@x.example" })).body.opportunities[0].score, 75, "the table read after a save is not the cached one");
  assert.strictEqual((await call(api, "PATCH", "/v1/ace/O1", { token: "", body: { nextSteps: "x" } })).statusCode, 401);
});

check("POST /v1/ace needs title and customer, creates a Prospect and returns the row", async () => {
  const { api, calls } = makeApi({ awsReply: (url, init) => {
    const op = init.headers["x-amz-target"].split(".")[1];
    if (op === "CreateOpportunity") return { status: 200, body: { Id: "O9" } };
    return { status: 200, body: { ...DETAIL, Id: "O9", LifeCycle: { Stage: "Prospect", ReviewStatus: "Pending Submission" }, Project: { Title: "Totems" }, Customer: { Account: { CompanyName: "Gamma" } } } };
  } });
  const bad = await call(api, "POST", "/v1/ace", { token: "ed@x.example", body: {} });
  assert.strictEqual(bad.statusCode, 400); assert.match(bad.body.error, /title is required; customer is required/);
  const r = await call(api, "POST", "/v1/ace", { token: "ed@x.example", body: { name: "Totems", customer: "Gamma", description: "Needs signage" } });
  assert.strictEqual(r.statusCode, 200); assert.strictEqual(r.body.id, "O9"); assert.strictEqual(r.body.opportunity.stage, "Prospect");
  const sent = JSON.parse(calls.find((c) => c.init.headers && c.init.headers["x-amz-target"] === "AWSPartnerCentralSelling.CreateOpportunity").init.body);
  assert.strictEqual(sent.Project.Title, "Totems"); assert.strictEqual(sent.Customer.Account.CompanyName, "Gamma"); assert.strictEqual(sent.LifeCycle.Stage, "Prospect"); assert.ok(sent.ClientToken);
});

check("GET /v1/ace/{id} is open to editors", async () => {
  const { api } = makeApi({ awsReply: () => ({ status: 200, body: DETAIL }) });
  const r = await call(api, "GET", "/v1/ace/O1", { token: "ed@x.example" });
  assert.strictEqual(r.statusCode, 200); assert.strictEqual(r.body.opportunity.customer, "Acme Retail");
});

check("SigV4 matches a recomputation and is deterministic", () => {
  const args = { host: "h.example", service: "svc", creds: { accessKeyId: "A", secretAccessKey: "S", sessionToken: "T" }, body: "{}", date: new Date("2026-11-06T12:00:00Z"), headers: { "x-amz-target": "T.Op" } };
  const a = signRequest(args); const b = signRequest(args);
  assert.strictEqual(a.authorization, b.authorization);
  assert.match(a.authorization, /Credential=A\/20261106\/us-east-1\/svc\/aws4_request, SignedHeaders=host;x-amz-date;x-amz-security-token;x-amz-target, Signature=[0-9a-f]{64}$/);
});


// ── Partner Central agent (AWS-hosted MCP server) ──
// A fake agent: the first message proposes a write and waits for approval; an
// approval response completes it. Replies use the "stringified" shape.
const agentPayload = (o) => ({ result: { content: [{ type: "text", text: JSON.stringify(o) }] } });
function agentReply({ onCall } = {}) {
  return (url, init) => {
    if (!url.startsWith("https://partnercentral-agents-mcp.us-east-1.api.aws/mcp")) return { status: 200, body: { OpportunitySummaries: [] } };
    const rpc = JSON.parse(init.body);
    if (onCall) onCall(rpc);
    const args = rpc.params.arguments;
    const first = args.content && args.content[0];
    if (rpc.params.name === "getSession") return { status: 200, body: { jsonrpc: "2.0", id: rpc.id, ...agentPayload({ sessionId: args.sessionId, status: "complete", content: [{ type: "text", text: "Session read." }] }) } };
    if (first && first.type === "tool_approval_response") return { status: 200, body: { jsonrpc: "2.0", id: rpc.id, ...agentPayload({ sessionId: args.sessionId, status: "complete", content: [{ type: "text", text: first.decision === "approve" ? "Draft opportunity created (not submitted)." : "Cancelled." }] }) } };
    if (/draft/i.test(first.text)) return { status: 200, body: { jsonrpc: "2.0", id: rpc.id, ...agentPayload({ sessionId: "sess-1", status: "requires_approval", content: [{ type: "text", text: "I will create this draft." }, { type: "tool_approval_request", toolUseId: "tu-1", toolName: "CreateOpportunity", parameters: { Title: "Test opportunity" } }] }) } };
    // SSE answer for a read
    const msg = { jsonrpc: "2.0", id: rpc.id, ...agentPayload({ sessionId: args.sessionId || "sess-2", status: "complete", content: [{ type: "text", text: "You have 2 open opportunities." }] }) };
    return { status: 200, contentType: "text/event-stream", raw: `event: message\ndata: ${JSON.stringify(msg)}\n\n` };
  };
}

check("agent routes are admin only", async () => {
  const { api } = makeApi({ awsReply: agentReply() });
  assert.strictEqual((await call(api, "POST", "/v1/agent/messages", { token: "", body: { text: "hi" } })).statusCode, 401);
  assert.strictEqual((await call(api, "POST", "/v1/agent/messages", { token: "ed@x.example", body: { text: "hi" } })).statusCode, 403);
  assert.strictEqual((await call(api, "GET", "/v1/agent", { token: "ed@x.example" })).statusCode, 403);
  assert.strictEqual((await call(api, "POST", "/v1/agent/sessions/sess-1/approvals/tu-1", { token: "ed@x.example", body: { decision: "approve" } })).statusCode, 403);
});

check("a read: signed tools/call sendMessage to the agents endpoint in the Sandbox catalogue, SSE answer parsed", async () => {
  const seen = [];
  const { api, calls, db } = makeApi({ awsReply: agentReply({ onCall: (r) => seen.push(r) }) });
  const r = await call(api, "POST", "/v1/agent/messages", { body: { text: "List my opportunities" } });
  assert.strictEqual(r.statusCode, 200, JSON.stringify(r.body));
  assert.strictEqual(r.body.reply.text, "You have 2 open opportunities.");
  assert.strictEqual(r.body.session.sessionId, "sess-2"); assert.strictEqual(r.body.session.catalog, "Sandbox");
  const sent = calls.find((c) => c.url === `https://${AGENT_MCP.host}${AGENT_MCP.path}`);
  assert.match(sent.init.headers.authorization, /\/us-east-1\/partnercentral-agents-mcp\/aws4_request/);
  assert.match(sent.init.headers.accept, /text\/event-stream/);
  assert.strictEqual(seen[0].method, "tools/call"); assert.strictEqual(seen[0].params.name, "sendMessage");
  assert.strictEqual(seen[0].params.arguments.catalog, "Sandbox"); assert.deepStrictEqual(seen[0].params.arguments.content, [{ type: "text", text: "List my opportunities" }]);
  assert.ok(Object.values(db.state.partnerCentralAudit).some((e) => e.operation === "agent:sendMessage" && e.ok));
  assert.ok(db.state.partnerCentralAgentSessions["sess-2"], "the AI session is recorded");
  assert.deepStrictEqual(AGENT_TOOLS, ["sendMessage", "getSession"]);
});

check("a write waits for an admin's approval, which is the only thing that answers it", async () => {
  const seen = [];
  const { api, db } = makeApi({ awsReply: agentReply({ onCall: (r) => seen.push(r) }) });
  const r = await call(api, "POST", "/v1/agent/messages", { body: { text: "Draft a test opportunity, do not submit" } });
  assert.strictEqual(r.statusCode, 200);
  assert.strictEqual(r.body.session.status, "requires_approval");
  assert.deepStrictEqual(r.body.session.approvals.map((a) => [a.toolUseId, a.toolName, a.state]), [["tu-1", "CreateOpportunity", "pending"]]);
  assert.strictEqual(seen.length, 1, "nothing is sent back to the agent until someone decides");
  assert.strictEqual((await call(api, "POST", "/v1/agent/sessions/sess-1/approvals/tu-9", { body: { decision: "approve" } })).statusCode, 404, "an unknown toolUseId is refused");
  assert.strictEqual((await call(api, "POST", "/v1/agent/sessions/sess-1/approvals/tu-1", { body: { decision: "override" } })).statusCode, 400, "only approve or reject");
  const ok = await call(api, "POST", "/v1/agent/sessions/sess-1/approvals/tu-1", { body: { decision: "approve" } });
  assert.strictEqual(ok.statusCode, 200, JSON.stringify(ok.body));
  assert.deepStrictEqual(seen[1].params.arguments.content, [{ type: "tool_approval_response", toolUseId: "tu-1", decision: "approve" }]);
  assert.strictEqual(seen[1].params.arguments.sessionId, "sess-1");
  const a = ok.body.session.approvals[0];
  assert.strictEqual(a.state, "approved"); assert.strictEqual(a.decidedBy, "owner@example.com");
  assert.strictEqual(ok.body.reply.text, "Draft opportunity created (not submitted).");
  assert.strictEqual((await call(api, "POST", "/v1/agent/sessions/sess-1/approvals/tu-1", { body: { decision: "reject" } })).statusCode, 409, "decided once only");
  assert.ok(Object.values(db.state.partnerCentralAudit).some((e) => e.operation === "agent:approve" && e.toolUseId === "tu-1"));
});

check("the AI session id is logged once on the linked lead (or the lead matched to the opportunity)", async () => {
  const { api, db } = makeApi({ awsReply: agentReply() });
  db.state.leads = { L1: { company: { name: "Acme Retail" }, history: [] }, L2: { company: { name: "Beta" }, aceOpportunityId: "O7", history: [] } };
  const r = await call(api, "POST", "/v1/agent/messages", { body: { text: "Build a customer profile", leadId: "L1", opportunityId: "O1" } });
  assert.strictEqual(r.statusCode, 200, JSON.stringify(r.body));
  assert.strictEqual(r.body.session.leadName, "Acme Retail"); assert.strictEqual(r.body.session.opportunityId, "O1");
  const h = db.state.leads.L1.history;
  assert.strictEqual(h.length, 1); assert.strictEqual(h[0].kind, "note"); assert.match(h[0].text, /Partner Central AI session sess-2 \(Sandbox catalogue\) for ACE opportunity O1/);
  assert.deepStrictEqual(db.state.leads.L1.aiSessionIds, ["sess-2"]);
  await call(api, "POST", "/v1/agent/messages", { body: { text: "And its funding?", sessionId: "sess-2" } });
  assert.strictEqual(db.state.leads.L1.history.length, 1, "not logged twice");
  const viaOpp = await call(api, "POST", "/v1/agent/messages", { body: { text: "Summarise", opportunityId: "O7" } });
  assert.strictEqual(viaOpp.body.session.leadId, "L2");
  assert.strictEqual(db.state.leads.L2.history.length, 1);
  assert.strictEqual((await call(api, "POST", "/v1/agent/messages", { body: { text: "x", leadId: "nope" } })).statusCode, 404);
  const ov = await call(api, "GET", "/v1/agent");
  assert.deepStrictEqual(ov.body.leads.map((l) => l.name), ["Acme Retail", "Beta"]);
  assert.ok(ov.body.sessions.some((x) => x.sessionId === "sess-2"));
});

check("an expired or other-catalogue session is refused, not silently replaced", async () => {
  const { api, db } = makeApi({ awsReply: agentReply() });
  db.state.partnerCentralAgentSessions = {
    old: { catalog: "Sandbox", expiresAt: new Date("2020-01-01T00:00:00Z"), approvals: [] },
    live: { catalog: "AWS", expiresAt: new Date("2099-01-01T00:00:00Z"), approvals: [] },
  };
  assert.strictEqual((await call(api, "POST", "/v1/agent/messages", { body: { text: "hi", sessionId: "old" } })).statusCode, 410);
  assert.strictEqual((await call(api, "POST", "/v1/agent/messages", { body: { text: "hi", sessionId: "live" } })).statusCode, 409);
  assert.strictEqual((await call(api, "POST", "/v1/agent/messages", { body: { text: "hi", sessionId: "never" } })).statusCode, 404);
  assert.strictEqual((await call(api, "POST", "/v1/agent/messages", { body: { text: "  " } })).statusCode, 400);
});

check("agent JSON-RPC errors surface and are audited", async () => {
  const { api, db } = makeApi({ awsReply: (url) => url.includes("agents-mcp") ? { status: 200, body: { jsonrpc: "2.0", id: 1, error: { code: -32001, message: "Authentication failed" } } } : { status: 200, body: {} } });
  const r = await call(api, "POST", "/v1/agent/messages", { body: { text: "hi" } });
  assert.strictEqual(r.statusCode, 502); assert.match(r.body.error, /-32001: Authentication failed/);
  assert.ok(Object.values(db.state.partnerCentralAudit).some((e) => e.operation === "agent:sendMessage" && !e.ok));
});

check("parseAgentResult reads both reply shapes and approval events", () => {
  const inline = parseAgentResult({ sessionId: "s", status: "requires_approval", content: [{ type: "text", text: "Proposed" }, { type: "tool_approval_request", toolUseId: "t1", toolName: "UpdateOpportunity", parameters: { a: 1 } }] });
  assert.strictEqual(inline.sessionId, "s"); assert.strictEqual(inline.text, "Proposed"); assert.strictEqual(inline.approvals[0].toolUseId, "t1");
  const events = parseAgentResult({ content: [{ type: "text", text: JSON.stringify({ sessionId: "s2", stateType: "TOOL_REQUEST", events: [{ data: { tool_use_id: "t2", name: "CreateBenefitApplication", input: { b: 2 } } }] }) }] });
  assert.deepStrictEqual(events.approvals, [{ toolUseId: "t2", toolName: "CreateBenefitApplication", parameters: { b: 2 } }]);
  const done = parseAgentResult({ content: [{ type: "text", text: JSON.stringify({ sessionId: "s3", status: "complete", content: [{ type: "serverToolUse", tool_use_id: "x", input: { q: 1 } }, { type: "text", text: "ok" }] }) }] });
  assert.deepStrictEqual(done.approvals, [], "a read tool in a complete reply is not an approval");
  assert.strictEqual(parseMcpBody("event: message\ndata: {\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{}}\n\n", "text/event-stream").id, 1);
  assert.strictEqual(parseMcpBody("not json", "application/json"), null);
});

(async () => {
  let failed = 0;
  for (const [name, fn] of checks) {
    try { await fn(); } catch (err) { failed++; console.error(`✗ ${name}\n  ${err.stack || err}`); }
  }
  console.log(failed ? `partner-central: ${failed} failed` : `partner-central: all ${checks.length} checks passed`);
  process.exit(failed ? 1 : 0);
})();
