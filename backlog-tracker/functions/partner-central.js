"use strict";
// ── AWS Partner Central connection (Selling API + Benefits API) ───────────
// The console backend calls AWS Partner Central — ACE opportunities (Selling
// API) and funding drafts (Benefits API) — with NO long-lived AWS key
// anywhere. Each call:
//
//   1. asks Google for an OpenID Connect ID token for the function's own
//      service account (getWebIdentityToken, injected by index.js);
//   2. trades it at AWS STS (AssumeRoleWithWebIdentity — an unsigned call)
//      for credentials that live about 15 minutes, cached in memory only;
//   3. signs the Partner Central request with those credentials (SigV4,
//      implemented here with node:crypto so the function gains no
//      dependency).
//
// The role is defined as code in deploy/aws/partner-central-role.yaml.
//
// Safety rails, all asserted in test/partner-central.test.js:
//   • the catalogue is "Sandbox" unless an admin switches to "AWS" with an
//     explicit confirmation (partnerCentralState/config.catalog);
//   • the only Benefits operation this module can send is the one that
//     creates a DRAFT; there is no submit wrapper (OPERATIONS is a closed
//     list and callAws refuses anything outside it);
//   • every call, allowed or refused, is logged to partnerCentralAudit
//     (server-only); CloudTrail records the AWS side.
//
// Routes (Hosting rewrite /partnerCentral/** → this function), admin only:
//   GET   /v1/status                       connection status
//   POST  /v1/test                         assume the role + list 1 sandbox opportunity
//   GET   /v1/audit                        last 50 calls
//   POST  /v1/config   {catalog, confirm}  switch catalogue (AWS needs confirm:"LIVE")
//   GET   /v1/opportunities                list
//   GET   /v1/ace                          normalised rows for Promote › Leads (editors too)
//   GET   /v1/ace/{id}  POST /v1/ace  PATCH /v1/ace/{id}   one opportunity, create, update (editors; the
//                                          console's detail dialog; update is read-merge-write)
//   POST  /v1/opportunities                create
//   PATCH /v1/opportunities/{id}           update
//   POST  /v1/benefits/drafts              create a draft benefit application
//   GET   /v1/agent                        Partner Central agent: recent AI sessions + leads to link
//   POST  /v1/agent/messages {text, sessionId?, leadId?, opportunityId?}   ask the agent (sendMessage)
//   POST  /v1/agent/sessions/{id}          re-read a session from AWS (getSession)
//   POST  /v1/agent/sessions/{id}/approvals/{toolUseId} {decision: approve|reject, message?}
//                                          answer a write the agent is holding for approval
//                                          (a submit-like write is refused: drafts only)
//   POST  /v1/funding/{leadId}/check {opportunityId?}   AWS funding eligibility + drafts for a lead
//   POST  /v1/funding/{leadId}/refresh     re-read that check's agent session
//   POST  /v1/funding/{leadId}/poc-approved {amount?, currency?, reference?, clear?}  POC approved: claim sign-off due
//   POST  /v1/leads/{id}/enrich             send a lead to lead enrichment again (editors;
//                                          answered by pc-lead-enrich.js, wired in index.js)
//   POST  /v1/licences/sync  POST /v1/licences/link   Promote › License Manager (editors; the
//                                          AWS Marketplace agreements and their buyer contacts, read-only
//                                          on the AWS side; marketplace-agreements.js has its own closed list)

const crypto = require("crypto");
const { createLicenceSync } = require("./marketplace-agreements");

const DEFAULT_ROLE_ARN = "arn:aws:iam::817173160653:role/PH-Console-PartnerCentral";
const REGION = "us-east-1"; // Partner Central APIs are served from us-east-1 only
const CATALOGS = ["Sandbox", "AWS"];
const ROLE_RANK = { viewer: 1, editor: 2, admin: 3 };
const AUDIT = "partnerCentralAudit";
const STATE_DOC = ["partnerCentralState", "status"];
const CONFIG_DOC = ["partnerCentralState", "config"]; // server-only, so the LIVE confirmation cannot be bypassed from a browser

// The complete set of AWS operations this module may send. Adding one is a
// code change that shows up in review — there is deliberately no "submit".
const OPERATIONS = {
  ListOpportunities: { service: "selling" },
  GetOpportunity: { service: "selling" },
  CreateOpportunity: { service: "selling" },
  UpdateOpportunity: { service: "selling" },
  CreateBenefitApplication: { service: "benefits", draftOnly: true },
  // Lead enrichment and prospecting (functions/pc-lead-enrich.js): an engagement with a Lead
  // context, the prospecting task on it, and reading both back. Nothing that deletes, submits,
  // accepts or rejects an engagement.
  CreateEngagement: { service: "selling" },
  GetEngagement: { service: "selling" },
  StartProspectingFromEngagementTask: { service: "selling" },
  GetProspectingFromEngagementTask: { service: "selling" },
};
// Hosts are the documented dual-stack `*.api.aws` endpoints; the old
// `*.amazonaws.com` names do not resolve (that was the "fetch failed", 7 Nov
// 2026). Target prefixes were probed against the live endpoints: Selling is
// `AWSPartnerCentralSelling`, Benefits is `PartnerCentralBenefitsService`
// (an unknown prefix answers UnknownOperationException, a known one asks for
// a signature). They are data here, not logic.
const SERVICES = {
  selling: { host: `partnercentral-selling.${REGION}.api.aws`, signingName: "partnercentral-selling", target: "AWSPartnerCentralSelling" },
  benefits: { host: `partnercentral-benefits.${REGION}.api.aws`, signingName: "partnercentral-benefits", target: "PartnerCentralBenefitsService" },
};

// A network failure from fetch() is just "fetch failed"; the real reason is on
// err.cause (code, hostname, message). Make it readable for the audit row.
function describeNetworkError(err, host) {
  const c = (err && err.cause) || {};
  const code = c.code || err.code || "";
  const target = c.hostname || host || "";
  const detail = String(c.message || "").slice(0, 120);
  if (!code && !c.message && !(err && /fetch failed/i.test(String(err.message)))) return String((err && err.message) || err).slice(0, 300);
  return `Couldn't reach ${target}${code ? ` (${code})` : ""}${detail && detail !== code ? `: ${detail}` : ""}`.slice(0, 300);
}

// ── SigV4 ────────────────────────────────────────────────────────────────
const sha256hex = (s) => crypto.createHash("sha256").update(s).digest("hex");
const hmac = (key, s) => crypto.createHmac("sha256", key).update(s).digest();

// `query` is the canonical query string (keys sorted, RFC 3986-encoded), "" for none: S3 reads use it.
function signRequest({ method = "POST", host, path = "/", query = "", headers = {}, body = "", service, region = REGION, creds, date = new Date() }) {
  const amzDate = date.toISOString().replace(/[:-]|\.\d{3}/g, ""); // 20261106T120000Z
  const day = amzDate.slice(0, 8);
  const h = { ...headers, host, "x-amz-date": amzDate };
  if (creds.sessionToken) h["x-amz-security-token"] = creds.sessionToken;
  const names = Object.keys(h).map((k) => k.toLowerCase()).sort();
  const lower = Object.fromEntries(Object.entries(h).map(([k, v]) => [k.toLowerCase(), String(v).trim()]));
  const canonical = [method, path, query, names.map((n) => `${n}:${lower[n]}\n`).join(""), names.join(";"), sha256hex(body)].join("\n");
  const scope = `${day}/${region}/${service}/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256hex(canonical)].join("\n");
  let k = hmac(`AWS4${creds.secretAccessKey}`, day);
  for (const part of [region, service, "aws4_request"]) k = hmac(k, part);
  const signature = crypto.createHmac("sha256", k).update(toSign).digest("hex");
  lower.authorization = `AWS4-HMAC-SHA256 Credential=${creds.accessKeyId}/${scope}, SignedHeaders=${names.join(";")}, Signature=${signature}`;
  return lower;
}

// ── ACE opportunity rows for Promote › Leads ─────────────────────────────
// One flat row per opportunity, whatever shape the Selling API answered in.
// Field names follow the published model and are read defensively (first
// match wins): verify against the first real Sandbox call, like SERVICES.
const first = (...vals) => vals.find((v) => v !== undefined && v !== null && v !== "");
const text = (v, max = 200) => String(v == null ? "" : v).trim().slice(0, max);
const PC_OPPORTUNITY_URL = "https://partnercentral.awspartner.com/partnercentral2/s/opportunities/";

function expectedMonthly(project) {
  const spend = Array.isArray(project && project.ExpectedCustomerSpend) ? project.ExpectedCustomerSpend : [];
  let amount = 0; let currency = ""; let any = false;
  for (const s of spend) {
    const n = Number(s && s.Amount);
    if (!Number.isFinite(n)) continue;
    const f = String((s && s.Frequency) || "Monthly");
    amount += /month/i.test(f) ? n : /year|annual/i.test(f) ? n / 12 : 0;
    currency = currency || text(s.CurrencyCode, 3);
    any = any || /month|year|annual/i.test(f);
  }
  return any ? { amount: Math.round(amount * 100) / 100, currency: currency || "USD" } : null;
}

function normaliseOpportunity(summary, detail) {
  const o = { ...(summary || {}), ...(detail || {}) };
  const life = o.LifeCycle || o.Lifecycle || {};
  const team = Array.isArray(o.AwsTeam) ? o.AwsTeam : Array.isArray(o.AwsSalesTeam) ? o.AwsSalesTeam : [];
  const rep = team.find((m) => m && m.Email) || team[0] || null;
  const insights = o.AwsOpportunityInsights || o.Insights || {};
  const score = Number(first(insights.Score, insights.OpportunityScore, o.OpportunityScore));
  const id = text(o.Id || o.Identifier, 64);
  const customer = text(first(o.Customer && o.Customer.Account && o.Customer.Account.CompanyName, o.CustomerName), 160);
  return {
    id,
    name: text(first(o.Project && o.Project.Title, o.OpportunityTitle, o.PartnerOpportunityIdentifier, id), 200),
    customer,
    stage: text(life.Stage, 60),
    reviewStatus: text(life.ReviewStatus, 60),
    score: Number.isFinite(score) ? score : null,
    expectedMonthly: expectedMonthly(o.Project),
    targetCloseDate: text(life.TargetCloseDate, 10) || null,
    nextSteps: text(life.NextSteps, 2000),
    description: text(o.Project && o.Project.CustomerBusinessProblem, 2000),
    website: text(o.Customer && o.Customer.Account && o.Customer.Account.WebsiteUrl, 300),
    awsAccountId: text(o.Customer && o.Customer.Account && o.Customer.Account.AwsAccountId, 12),
    industry: text(o.Customer && o.Customer.Account && o.Customer.Account.Industry, 80),
    createdDate: text(o.CreatedDate, 30) || null,
    lastModifiedDate: text(o.LastModifiedDate, 30) || null,
    awsSeller: rep ? { name: text([rep.FirstName, rep.LastName].filter(Boolean).join(" ") || rep.Email, 120), email: text(rep.Email, 200), title: text(rep.BusinessTitle, 120) } : null,
    partnerCentralUrl: id ? `${PC_OPPORTUNITY_URL}${encodeURIComponent(id)}` : null,
  };
}

// ── Editing ACE opportunities from the console ───────────────────────────
// The console edits a small set of fields. UpdateOpportunity replaces whole
// sections, so an update is read-merge-write: GetOpportunity, overlay the
// changed fields on what AWS holds, send the writable parts back. Field names
// follow the published Selling API model and are UNTESTED against the live
// Sandbox until the Partner Central link works (like SERVICES above).
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const STAGES = ["Prospect", "Qualified", "Technical Validation", "Business Validation", "Committed", "Launched", "Closed Lost"];
const EDITABLE = ["name", "customer", "stage", "targetCloseDate", "nextSteps", "description", "website", "industry", "monthlyAmount", "currency"];

// Returns { values, errors } for the fields present in `input`. `creating`
// requires a title and customer.
function sanitiseAceInput(input, { creating = false } = {}) {
  const src = input && typeof input === "object" ? input : {};
  const values = {}; const errors = [];
  const str = (k, max) => { if (src[k] !== undefined && src[k] !== null) values[k] = text(src[k], max); };
  str("name", 200); str("customer", 160); str("nextSteps", 2000); str("description", 2000); str("website", 300); str("industry", 80);
  if (src.stage !== undefined && src.stage !== "") {
    const hit = STAGES.find((x) => x.toLowerCase() === String(src.stage).toLowerCase());
    if (hit) values.stage = hit; else errors.push(`stage must be one of ${STAGES.join(", ")}`);
  }
  if (src.targetCloseDate !== undefined) {
    const d = text(src.targetCloseDate, 10);
    if (d === "" ) values.targetCloseDate = ""; else if (ISO_DAY.test(d) && !Number.isNaN(Date.parse(d))) values.targetCloseDate = d; else errors.push("expected delivery date must be a date (YYYY-MM-DD)");
  }
  if (src.monthlyAmount !== undefined && src.monthlyAmount !== null && src.monthlyAmount !== "") {
    const n = Number(src.monthlyAmount);
    if (Number.isFinite(n) && n >= 0 && n < 1e12) values.monthlyAmount = n; else errors.push("monthly AWS revenue must be a number");
  }
  if (src.currency !== undefined) {
    const c = text(src.currency, 3).toUpperCase();
    if (/^[A-Z]{3}$/.test(c)) values.currency = c; else if (c) errors.push("currency must be a 3-letter code");
  }
  if (src.website && values.website && !/^https?:\/\//i.test(values.website)) values.website = `https://${values.website}`;
  if (creating) {
    if (!values.name) errors.push("title is required");
    if (!values.customer) errors.push("customer is required");
  } else {
    if (values.name === "") errors.push("title cannot be empty");
    if (values.customer === "") errors.push("customer cannot be empty");
  }
  return { values, errors };
}

const pick = (obj, keys) => Object.fromEntries(keys.filter((k) => obj && obj[k] !== undefined && obj[k] !== null).map((k) => [k, obj[k]]));
const ACCOUNT_KEYS = ["Address", "AwsAccountId", "CompanyName", "Duns", "Industry", "OtherIndustry", "WebsiteUrl"];
const LIFE_KEYS = ["Stage", "ClosedLostReason", "NextSteps", "TargetCloseDate"];
const PROJECT_KEYS = ["AdditionalComments", "ApnPrograms", "CompetitorName", "CustomerBusinessProblem", "CustomerUseCase", "DeliveryModels", "ExpectedCustomerSpend", "OtherCompetitorNames", "OtherSolutionDescription", "RelatedOpportunityIdentifier", "SalesActivities", "Title"];

function applyValues(cur, v) {
  const customer = { ...(cur.Customer || {}) };
  const account = pick(customer.Account, ACCOUNT_KEYS);
  if (v.customer !== undefined) account.CompanyName = v.customer;
  if (v.website !== undefined) { if (v.website) account.WebsiteUrl = v.website; else delete account.WebsiteUrl; }
  if (v.industry) account.Industry = v.industry;
  const life = pick(cur.LifeCycle || cur.Lifecycle, LIFE_KEYS);
  if (v.stage !== undefined) life.Stage = v.stage;
  if (v.nextSteps !== undefined) life.NextSteps = v.nextSteps;
  if (v.targetCloseDate !== undefined) { if (v.targetCloseDate) life.TargetCloseDate = v.targetCloseDate; else delete life.TargetCloseDate; }
  const project = pick(cur.Project, PROJECT_KEYS);
  if (v.name !== undefined) project.Title = v.name;
  if (v.description !== undefined) project.CustomerBusinessProblem = v.description;
  if (v.monthlyAmount !== undefined || v.currency !== undefined) {
    const spend = Array.isArray(project.ExpectedCustomerSpend) ? project.ExpectedCustomerSpend : [];
    const base = spend.find((s) => /month/i.test(String(s && s.Frequency))) || spend[0] || {};
    const next = { ...base, Frequency: "Monthly" };
    if (v.monthlyAmount !== undefined) next.Amount = String(v.monthlyAmount);
    if (v.currency) next.CurrencyCode = v.currency; else if (!next.CurrencyCode) next.CurrencyCode = "USD";
    if (!next.TargetCompany && account.CompanyName) next.TargetCompany = account.CompanyName;
    project.ExpectedCustomerSpend = [next, ...spend.filter((s) => s !== base)];
  }
  return { Customer: { ...pick(customer, ["Contacts"]), Account: account }, LifeCycle: life, Project: project };
}

// The UpdateOpportunity body: what AWS holds, with the changes overlaid.
function buildUpdate(identifier, cur, v) {
  return {
    Identifier: identifier,
    LastModifiedDate: cur.LastModifiedDate,
    ...pick(cur, ["PartnerOpportunityIdentifier", "OpportunityType", "Marketing", "NationalSecurity", "PrimaryNeedsFromAws", "SoftwareRevenue"]),
    ...applyValues(cur, v),
  };
}

// The CreateOpportunity body for a new Prospect.
function buildCreate(v) {
  const body = applyValues({
    Customer: { Account: { Address: { CountryCode: "GB" }, Industry: "Retail" } },
    LifeCycle: { Stage: "Prospect" },
    Project: { DeliveryModels: ["SaaS or PaaS"] },
  }, v);
  return { Origin: "Partner Referral", OpportunityType: "Net New Business", PrimaryNeedsFromAws: [], Marketing: {}, ...body };
}

// ── Partner Central agents MCP server (ticket Eo1w5YvY0Xw8YhHDalWj) ─────────
// AWS hosts an MCP server (JSON-RPC 2.0 over HTTPS, answers as JSON or SSE)
// that fronts the Partner Central agent: ask it in plain words to list
// opportunities, build a customer profile or draft an opportunity. Same
// keyless credentials and SigV4 as above, a different signing name. The
// server itself holds every write until the partner approves it: the reply
// has status "requires_approval" and a tool_approval_request block; the
// console shows that to an admin, and only the approval route below answers
// it. Nothing here approves on its own. Endpoint, signing name and the two
// tool shapes are from the AWS getting-started guide as mirrored by a public
// client; verify on the first Sandbox call, like SERVICES.
const AGENT_MCP = { host: `partnercentral-agents-mcp.${REGION}.api.aws`, path: "/mcp", signingName: "partnercentral-agents-mcp" };
const AGENT_TOOLS = ["sendMessage", "getSession"]; // the only MCP tools the console may call
const AGENT_SESSIONS = "partnerCentralAgentSessions"; // server-only, one doc per AI session id
const AGENT_SESSION_TTL_MS = 48 * 3600 * 1000; // AWS expires a session 48 hours after it starts
const AGENT_DECISIONS = ["approve", "reject"];
const AGENT_MESSAGE_MAX = 4000;
const SESSION_ID_RE = /^[A-Za-z0-9._:-]{1,128}$/;

// An MCP reply over SSE is "event: message\ndata: {json}\n\n" lines; the
// JSON-RPC response is the last data line carrying a result or an error.
function parseMcpBody(raw, contentType) {
  const body = String(raw || "");
  if (/text\/event-stream/i.test(String(contentType || "")) || /^\s*(event|data):/m.test(body) && !/^\s*[{[]/.test(body)) {
    let last = null;
    for (const line of body.split(/\r?\n/)) {
      const m = /^data:\s?(.*)$/.exec(line);
      if (!m) continue;
      try { const j = JSON.parse(m[1]); if (j && (j.result !== undefined || j.error !== undefined)) last = j; } catch { /* keep-alive or partial */ }
    }
    return last;
  }
  try { return body ? JSON.parse(body) : null; } catch { return null; }
}

// Pending writes in a reply: documented as {type:"tool_approval_request",
// toolUseId, toolName, parameters}; a getSession in TOOL_REQUEST state has
// them as tool-use events ({tool_use_id|toolUseId, name, input}).
function collectApprovals(node, needsApproval, out, seen, depth = 0) {
  if (!node || typeof node !== "object" || depth > 12) return;
  if (Array.isArray(node)) { node.forEach((n) => collectApprovals(n, needsApproval, out, seen, depth + 1)); return; }
  const id = text(first(node.toolUseId, node.tool_use_id), 128);
  const params = first(node.parameters, node.input);
  const isResult = node.output !== undefined || node.type === "tool_result" || node.type === "serverToolResult" || node.status === "success";
  if (id && !seen.has(id) && (node.type === "tool_approval_request" || (needsApproval && params && typeof params === "object" && !isResult && node.type !== "tool_approval_response"))) {
    seen.add(id);
    out.push({ toolUseId: id, toolName: text(first(node.toolName, node.name), 120) || null, parameters: params && typeof params === "object" ? params : {} });
  }
  for (const v of Object.values(node)) if (v && typeof v === "object") collectApprovals(v, needsApproval, out, seen, depth + 1);
}

// One shape for any tools/call result: { sessionId, status, text, approvals }.
// The agent's payload is either inline (result.sessionId/status/content) or a
// JSON string in result.content[0].text.
function parseAgentResult(result) {
  const r = result && typeof result === "object" ? result : {};
  const top = Array.isArray(r.content) ? r.content : [];
  let inner = null;
  const firstText = top.find((b) => b && typeof b.text === "string");
  if (firstText) { try { const j = JSON.parse(firstText.text); if (j && typeof j === "object" && !Array.isArray(j)) inner = j; } catch { inner = null; } }
  const src = inner || r;
  const blocks = inner ? (Array.isArray(inner.content) ? inner.content : []) : top;
  const status = text(first(src.status, src.stateType, r.status), 40) || "complete";
  const needsApproval = /requires_approval|TOOL_REQUEST/i.test(status);
  const parts = blocks.filter((b) => b && (b.type === "text" || b.type === undefined) && typeof b.text === "string").map((b) => b.text);
  let replyText = parts.join("\n\n");
  if (!replyText && !inner && firstText) replyText = firstText.text;
  if (!replyText) replyText = text(first(src.text, src.message), 20000);
  const approvals = []; const seen = new Set();
  collectApprovals(blocks, needsApproval, approvals, seen);
  if (!approvals.length && needsApproval && Array.isArray(src.events)) {
    for (let i = src.events.length - 1; i >= 0 && !approvals.length; i--) collectApprovals(src.events[i], true, approvals, seen);
  }
  return { sessionId: text(first(src.sessionId, r.sessionId), 128) || null, status, text: text(replyText, 20000), approvals, isError: r.isError === true };
}

// ── AWS funding drafts (ticket O37hnP69Cnn8N32HpHot) ─────────────────────
// A lead's "Check funding eligibility" asks the same agent, in one message
// carrying the account context, which funding programmes the opportunity
// qualifies for (POC, MAP, Innovation Sandbox credits and any other), what
// each could be worth, what budget is left where AWS says, and to DRAFT the
// POC funding and Innovation Sandbox credit applications. A draft the agent
// wants to create comes back as a write held for an admin's approval (the
// agent panel), and nothing that submits can be approved: isSubmitLike below,
// with the role's IAM deny on SubmitBenefitApplication as the second layer.
// The answer ends with a JSON block (FUNDING_SCHEMA_VERSION) that
// parseFundingReply reads defensively; the plain text is always kept too.
const FUNDING = "leadFunding"; // server-written, member-readable: leadFunding/{leadId}
const FUNDING_SCHEMA_VERSION = 1;
const FUNDING_PROGRAMS = [
  { key: "poc", name: "POC funding", draft: true },
  { key: "sandbox", name: "Innovation Sandbox credits", draft: true },
  { key: "map", name: "MAP (Migration Acceleration Program)", draft: false },
];
const FUNDING_STAGES = ["hot-lead", "demo", "post-demo"]; // a check is suggested from Hot Lead on (and whenever an ACE opportunity is linked)
function fundingProgramKey(name) {
  const s = String(name == null ? "" : name);
  if (/\bpoc\b|proof[\s-]*of[\s-]*concept/i.test(s)) return "poc";
  if (/sandbox|\bcredit/i.test(s)) return "sandbox";
  if (/\bmap\b|migration acceleration/i.test(s)) return "map";
  return "other";
}
// An operation that submits (or otherwise sends to AWS for review) is never approvable from the console.
function isSubmitLike(toolName, parameters) {
  if (/submit/i.test(String(toolName || ""))) return true;
  let p = "";
  try { p = JSON.stringify(parameters || {}); } catch { p = ""; }
  return /"(action|operation|status|stage)"\s*:\s*"[^"]*submit/i.test(p);
}
// The one message sent for a funding check: account context + the ask + the reply format.
function buildFundingPrompt({ lead, opportunityId, catalog }) {
  const l = lead && typeof lead === "object" ? lead : {};
  const c = l.company && typeof l.company === "object" ? l.company : {};
  const e = l.enrichment && typeof l.enrichment === "object" ? l.enrichment : {};
  const ctx = [
    ["Customer", text(c.name, 120)],
    ["Website", text(c.website, 300)],
    ["Industry", text(c.industry, 120)],
    ["Countries", Array.isArray(c.countries) ? c.countries.map((x) => text(x, 60)).filter(Boolean).join(", ") : ""],
    ["Stores", typeof c.storeCount === "number" ? String(c.storeCount) : ""],
    ["Customer AWS account ID", /^\d{12}$/.test(String(c.awsAccountId || "")) ? c.awsAccountId : ""],
    ["Console lead stage", text(l.stage, 40)],
    ["ACE opportunity ID", text(opportunityId, 64)],
    ["Company summary", text(e.summary, 1200)],
  ].filter(([, v]) => v).map(([k, v]) => `- ${k}: ${v}`).join("\n");
  return [
    `Check AWS partner funding for this account (${catalog} catalogue).`,
    "",
    "Account context:",
    ctx || "- (no details on the lead yet)",
    "",
    "1. Check eligibility for every funding programme that could apply: POC funding, MAP and Innovation Sandbox credits, and name any other programme that fits.",
    "2. Estimate the amount for each eligible programme, and give the remaining budget available where Partner Central shows it.",
    "3. Draft (create as DRAFT only) a POC funding application and an Innovation Sandbox credits application where eligible, with this account context attached. Never submit anything: the account lead reviews and submits each draft in Partner Central.",
    "",
    "End your answer with one fenced ```json block shaped exactly like:",
    `{"schemaVersion":${FUNDING_SCHEMA_VERSION},"programs":[{"program":"POC funding","eligible":true,"reason":"...","estimatedAmount":25000,"currency":"USD","budgetAvailable":null,"draftId":null}]}`,
    "Use null for any amount, budget or draft id you do not know; do not guess figures.",
  ].join("\n").slice(0, AGENT_MESSAGE_MAX);
}
const fundNum = (v) => { if (v === null || v === undefined || v === "") return null; const n = Number(String(v).replace(/[,\s]/g, "")); return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null; };
// The last fenced JSON block in the reply → programmes, coerced. { structured, programs }.
function parseFundingReply(replyText) {
  const s = String(replyText || "");
  const blocks = [...s.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)].map((m) => m[1]);
  let data = null;
  for (let i = blocks.length - 1; i >= 0 && !data; i--) {
    try { const j = JSON.parse(blocks[i]); if (j && typeof j === "object" && Array.isArray(j.programs)) data = j; } catch { /* not the block */ }
  }
  if (!data) return { structured: false, programs: [] };
  const programs = data.programs.filter((p) => p && typeof p === "object").slice(0, 12).map((p) => {
    const name = text(first(p.program, p.name), 120) || "Funding programme";
    const key = fundingProgramKey(name);
    return {
      key, name,
      eligible: p.eligible === true ? true : p.eligible === false ? false : null,
      reason: text(p.reason, 600),
      estimatedAmount: fundNum(p.estimatedAmount),
      currency: /^[A-Z]{3}$/.test(String(p.currency || "")) ? p.currency : "USD",
      budgetAvailable: fundNum(p.budgetAvailable),
      draftId: text(p.draftId, 128) || null,
    };
  });
  return { structured: true, programs };
}

const xmlTag = (xml, tag) => { const m = new RegExp(`<${tag}>([^<]*)</${tag}>`).exec(xml); return m ? m[1] : null; };

function createPartnerCentralApi({
  db, verifyIdToken, resolveConsoleUser, getWebIdentityToken,
  fetch: fetchImpl = globalThis.fetch, logger = console, now = () => new Date(),
  defaultRoleArn = DEFAULT_ROLE_ARN,
}) {
  let cached = null; // { creds, expiresAt } — memory only, never persisted
  const send = (res, status, body) => res.status(status).set("Cache-Control", "no-store").json(body);
  const iso = (v) => (v && typeof v.toDate === "function" ? v.toDate().toISOString() : v instanceof Date ? v.toISOString() : v || null);
  const ref = ([c, d]) => db.collection(c).doc(d);

  async function loadConfig() {
    const snap = await ref(CONFIG_DOC).get();
    const d = snap.exists ? snap.data() || {} : {};
    // autoPromote: lead enrichment may move a lead to Hot Lead (pc-lead-enrich.js); false switches it off.
    return { catalog: CATALOGS.includes(d.catalog) ? d.catalog : "Sandbox", roleArn: String(d.roleArn || defaultRoleArn), autoPromote: d.autoPromote !== false, updatedBy: d.updatedBy || null, updatedAt: iso(d.updatedAt) };
  }

  async function audit(entry) {
    try { await db.collection(AUDIT).add({ ...entry, at: now() }); } catch (err) { logger.warn("partnerCentralAudit write failed", { error: String(err) }); }
  }

  async function recordState(patch) {
    try { await ref(STATE_DOC).set(patch, { merge: true }); } catch (err) { logger.warn("partnerCentralState write failed", { error: String(err) }); }
  }

  // Short-lived credentials via AssumeRoleWithWebIdentity (no AWS signature).
  async function assumeRole(roleArn) {
    if (cached && cached.roleArn === roleArn && cached.expiresAt - now().getTime() > 120000) return cached.creds;
    const token = await getWebIdentityToken();
    const qs = new URLSearchParams({ Action: "AssumeRoleWithWebIdentity", Version: "2011-06-15", RoleArn: roleArn, RoleSessionName: "ph-console", WebIdentityToken: token, DurationSeconds: "900" });
    const r = await fetchImpl("https://sts.amazonaws.com/", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/xml" }, body: qs.toString() });
    const xml = await r.text();
    if (!r.ok) {
      const code = xmlTag(xml, "Code") || `HTTP ${r.status}`;
      const err = new Error(`AWS refused the role assumption (${code}): ${(xmlTag(xml, "Message") || "").slice(0, 200)}`);
      err.code = code;
      throw err;
    }
    const creds = { accessKeyId: xmlTag(xml, "AccessKeyId"), secretAccessKey: xmlTag(xml, "SecretAccessKey"), sessionToken: xmlTag(xml, "SessionToken") };
    const exp = Date.parse(xmlTag(xml, "Expiration") || "");
    if (!creds.accessKeyId || !creds.secretAccessKey || !creds.sessionToken) throw new Error("AWS STS answered without credentials");
    cached = { roleArn, creds, expiresAt: Number.isFinite(exp) ? exp : now().getTime() + 600000 };
    return creds;
  }

  // The single door to AWS. Refuses anything not in OPERATIONS. `sandbox: true`
  // forces the Sandbox catalogue whatever the live setting (test leads).
  async function callAws(operation, payload, { by, config, sandbox = false } = {}) {
    const spec = OPERATIONS[operation];
    const loaded = config || (await loadConfig());
    const cfg = sandbox ? { ...loaded, catalog: "Sandbox" } : loaded;
    const started = now();
    if (!spec) {
      await audit({ operation, catalog: cfg.catalog, by: by || null, ok: false, error: "operation not allowed" });
      throw Object.assign(new Error(`operation not allowed: ${operation}`), { status: 400 });
    }
    const body = sandbox ? { ...payload, Catalog: "Sandbox" } : { Catalog: cfg.catalog, ...payload };
    let result = null; let error = null; let httpStatus = null; let awsType = null; let host = null;
    try {
      const creds = await assumeRole(cfg.roleArn);
      const svc = SERVICES[spec.service];
      host = svc.host;
      const text = JSON.stringify(body);
      const headers = signRequest({
        host: svc.host, service: svc.signingName, creds, body: text, date: now(),
        headers: { "content-type": "application/x-amz-json-1.0", "x-amz-target": `${svc.target}.${operation}` },
      });
      const r = await fetchImpl(`https://${svc.host}/`, { method: "POST", headers, body: text });
      httpStatus = r.status;
      const raw = await r.text();
      let parsed = {};
      try { parsed = raw ? JSON.parse(raw) : {}; } catch { parsed = { raw: raw.slice(0, 200) }; }
      if (!r.ok) {
        awsType = String(parsed.__type || `HTTP ${r.status}`).split("#").pop();
        error = `${awsType}: ${String(parsed.message || parsed.Message || "").slice(0, 200)}`;
        logger.warn("partnerCentral AWS error", { operation, host, httpStatus: r.status, awsType, message: String(parsed.message || parsed.Message || "").slice(0, 200) });
      } else result = parsed;
    } catch (err) {
      const c = err && err.cause;
      if (c || /fetch failed/i.test(String(err && err.message))) {
        logger.error("partnerCentral network failure", { operation, host, code: c && c.code, hostname: c && c.hostname, cause: c && String(c.message || c), error: String(err.message || err) });
        error = describeNetworkError(err, host);
      } else error = String(err.message || err).slice(0, 300);
    }
    const ok = !error;
    await audit({ operation, catalog: cfg.catalog, roleArn: cfg.roleArn, by: by || null, ok, httpStatus, awsType, error, ms: now().getTime() - started.getTime(), target: payload && (payload.Identifier || null) });
    await recordState(ok
      ? { lastSuccessAt: now(), lastSuccessOperation: operation, lastSuccessCatalog: cfg.catalog, lastError: null }
      : { lastErrorAt: now(), lastError: error, lastErrorOperation: operation });
    if (!ok) throw Object.assign(new Error(error), { status: 502, awsStatus: httpStatus, awsType });
    return result;
  }

  // ── The wrappers the rest of the backend uses ──
  const listOpportunities = (query = {}, ctx) => callAws("ListOpportunities", { MaxResults: 20, ...query }, ctx);
  const getOpportunity = (identifier, ctx) => callAws("GetOpportunity", { Identifier: identifier }, ctx);
  const createOpportunity = (opportunity, ctx) => callAws("CreateOpportunity", { ClientToken: crypto.randomUUID(), ...opportunity }, ctx);
  const updateOpportunity = (identifier, changes, ctx) => callAws("UpdateOpportunity", { Identifier: identifier, ...changes }, ctx);
  // Draft only: CreateBenefitApplication does not submit. Submission stays a
  // person's click in Partner Central.
  const createBenefitDraft = (application, ctx) => callAws("CreateBenefitApplication", { ClientToken: crypto.randomUUID(), ...application }, ctx);

  // Promote › License Manager: AWS Marketplace agreements and their buyer
  // contacts, through the same short-lived credentials and audit log.
  const licences = createLicenceSync({
    db, sign: signRequest, fetch: fetchImpl, now, logger, audit,
    credentials: async () => assumeRole((await loadConfig()).roleArn),
  });

  async function status() {
    const cfg = await loadConfig();
    const s = (await ref(STATE_DOC).get());
    const d = s.exists ? s.data() || {} : {};
    let state = "not-linked";
    if (d.lastSuccessAt) state = d.lastError && iso(d.lastErrorAt) > iso(d.lastSuccessAt) ? "error" : "connected";
    else if (d.lastError) state = /AccessDenied|InvalidIdentityToken|NoSuchEntity|InvalidParameter|NotAuthorized|Unauthorized|Forbidden|UnrecognizedClient|not linked|not registered|not a partner/i.test(d.lastError) ? "not-linked" : "error";
    return {
      state, // connected | not-linked | error
      catalog: cfg.catalog, roleArn: cfg.roleArn,
      lastSuccessAt: iso(d.lastSuccessAt), lastSuccessOperation: d.lastSuccessOperation || null,
      lastError: d.lastError || null, lastErrorAt: iso(d.lastErrorAt),
      note: state === "connected" ? null : (state === "not-linked" && d.lastError ? `Not linked yet. AWS said: ${String(d.lastError).slice(0, 240)}. ` : "Not linked yet: ") + (d.lastError && state === "not-linked" ? "Link" : "link") + " the Partner Central account to the AWS account and map the IAM role to a Partner Central user role (see backlog-tracker/deploy/aws/README.md), then press Test connection.",
    };
  }

  // Normalised ACE rows: the list, then each opportunity's detail (which
  // carries the AWS team and score), a few at a time. A detail that fails
  // leaves that row with what the list gave. Cached for a minute.
  let aceCache = null;
  async function aceOpportunities(ctx) {
    if (aceCache && now().getTime() - aceCache.at < 60000) return aceCache.out;
    const summaries = [];
    let next;
    for (let page = 0; page < 4; page++) {
      const out = await listOpportunities({ MaxResults: 50, ...(next ? { NextToken: next } : {}) }, ctx);
      summaries.push(...(out.OpportunitySummaries || []));
      next = out.NextToken;
      if (!next) break;
    }
    const picked = summaries.slice(0, 100);
    const rows = new Array(picked.length);
    let cursor = 0;
    await Promise.all(Array.from({ length: Math.min(5, picked.length) }, async () => {
      while (cursor < picked.length) {
        const i = cursor++;
        let detail = null;
        try { detail = await getOpportunity(picked[i].Id, ctx); } catch { detail = null; }
        rows[i] = normaliseOpportunity(picked[i], detail);
      }
    }));
    const cfg = await loadConfig();
    const out = { catalog: cfg.catalog, truncated: summaries.length > picked.length || !!next, opportunities: rows.filter((r) => r.id), fetchedAt: now().toISOString() };
    aceCache = { at: now().getTime(), out };
    return out;
  }

  // One opportunity, normalised, straight from AWS (never the cache).
  async function aceOne(id, ctx) {
    const detail = await getOpportunity(id, ctx);
    return normaliseOpportunity(null, { Id: id, ...detail });
  }
  async function aceCreate(input, ctx) {
    const { values, errors } = sanitiseAceInput(input, { creating: true });
    if (errors.length) throw Object.assign(new Error(errors.join("; ")), { status: 400 });
    const out = await createOpportunity(buildCreate(values), ctx);
    aceCache = null;
    const id = text(out && (out.Id || out.Identifier), 64);
    if (!id) throw Object.assign(new Error("AWS created the opportunity but did not return its id"), { status: 502 });
    return { id, opportunity: await aceOne(id, ctx).catch(() => normaliseOpportunity(null, { Id: id, Project: { Title: values.name }, Customer: { Account: { CompanyName: values.customer } }, LifeCycle: { Stage: "Prospect" } })) };
  }
  async function aceUpdate(id, input, ctx) {
    const { values, errors } = sanitiseAceInput(input);
    if (errors.length) throw Object.assign(new Error(errors.join("; ")), { status: 400 });
    if (!Object.keys(values).length) throw Object.assign(new Error("nothing to change"), { status: 400 });
    const cur = await getOpportunity(id, ctx);
    await updateOpportunity(id, buildUpdate(id, cur, values), ctx);
    aceCache = null; // so the score and dates on the next table read are AWS's own
    return { opportunity: await aceOne(id, ctx) };
  }

  // ── Partner Central agent (the AWS-hosted MCP server) ──
  let rpcId = 0;
  // The single door to the agents MCP server: only AGENT_TOOLS, signed with
  // the same short-lived role credentials, audited like callAws.
  async function callAgent(tool, args, { by, config } = {}) {
    const cfg = config || (await loadConfig());
    const started = now();
    if (!AGENT_TOOLS.includes(tool)) {
      await audit({ operation: `agent:${tool}`, catalog: cfg.catalog, by: by || null, ok: false, error: "tool not allowed" });
      throw Object.assign(new Error(`agent tool not allowed: ${tool}`), { status: 400 });
    }
    const payload = { jsonrpc: "2.0", id: ++rpcId, method: "tools/call", params: { name: tool, arguments: { ...args, catalog: cfg.catalog }, _meta: { integrator: "Personalisation Hub", sourceProduct: "PH Agent Console" } } };
    let result = null; let error = null; let httpStatus = null; let rpcCode = null;
    try {
      const creds = await assumeRole(cfg.roleArn);
      const body = JSON.stringify(payload);
      const headers = signRequest({
        host: AGENT_MCP.host, path: AGENT_MCP.path, service: AGENT_MCP.signingName, creds, body, date: now(),
        headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      });
      const r = await fetchImpl(`https://${AGENT_MCP.host}${AGENT_MCP.path}`, { method: "POST", headers, body });
      httpStatus = r.status;
      const ctype = r.headers && typeof r.headers.get === "function" ? r.headers.get("content-type") : "";
      const raw = await r.text();
      const msg = parseMcpBody(raw, ctype);
      if (!r.ok) error = `HTTP ${r.status}: ${String((msg && msg.error && msg.error.message) || (msg && msg.message) || raw || "").slice(0, 200)}`;
      else if (!msg) error = "The Partner Central agent answered with something that is not JSON-RPC";
      else if (msg.error) { rpcCode = msg.error.code === undefined ? null : msg.error.code; error = `${rpcCode !== null ? `${rpcCode}: ` : ""}${String(msg.error.message || "error").slice(0, 200)}`; }
      else result = msg.result;
      if (error) logger.warn("partnerCentral agent error", { tool, httpStatus, rpcCode, error });
    } catch (err) {
      error = err && (err.cause || /fetch failed/i.test(String(err.message))) ? describeNetworkError(err, AGENT_MCP.host) : String((err && err.message) || err).slice(0, 300);
    }
    const ok = !error;
    await audit({ operation: `agent:${tool}`, catalog: cfg.catalog, roleArn: cfg.roleArn, by: by || null, ok, httpStatus, awsType: rpcCode === null ? null : String(rpcCode), error, ms: now().getTime() - started.getTime(), target: (args && args.sessionId) || null });
    await recordState(ok
      ? { lastSuccessAt: now(), lastSuccessOperation: `agent:${tool}`, lastSuccessCatalog: cfg.catalog, lastError: null }
      : { lastErrorAt: now(), lastError: error, lastErrorOperation: `agent:${tool}` });
    if (!ok) throw Object.assign(new Error(error), { status: 502 });
    return parseAgentResult(result);
  }

  const sessionRef = (id) => db.collection(AGENT_SESSIONS).doc(id);
  function sessionView(id, d) {
    const x = d || {};
    return {
      sessionId: id, catalog: x.catalog || null, status: x.status || null, lastReply: x.lastReply || "",
      leadId: x.leadId || null, leadName: x.leadName || null, opportunityId: x.opportunityId || null,
      createdBy: x.createdBy || null, createdAt: iso(x.createdAt), updatedAt: iso(x.updatedAt), expiresAt: iso(x.expiresAt),
      approvals: (Array.isArray(x.approvals) ? x.approvals : []).map((a) => ({ ...a, decidedAt: iso(a.decidedAt), requestedAt: iso(a.requestedAt) })),
    };
  }
  // A stored session may only be continued in the catalogue it started in and
  // within AWS's 48 hours; otherwise say so rather than silently start anew.
  async function loadSession(id, cfg) {
    if (!SESSION_ID_RE.test(String(id || ""))) throw Object.assign(new Error("unknown AI session id"), { status: 400 });
    const snap = await sessionRef(id).get();
    if (!snap.exists) throw Object.assign(new Error("This AI session was not started from the console"), { status: 404 });
    const d = snap.data() || {};
    if (d.catalog && d.catalog !== cfg.catalog) throw Object.assign(new Error(`This AI session belongs to the ${d.catalog} catalogue; the console now uses ${cfg.catalog}. Start a new session.`), { status: 409 });
    const exp = Date.parse(iso(d.expiresAt) || "");
    if (Number.isFinite(exp) && exp <= now().getTime()) throw Object.assign(new Error("This AI session has expired (AWS keeps a session for 48 hours). Start a new session."), { status: 410 });
    return d;
  }
  // Merge the reply into the session record: new pending approvals are added,
  // ones AWS no longer reports as pending stay as they were (decided or not).
  async function saveSession(id, prev, reply, extra) {
    const approvals = Array.isArray(prev && prev.approvals) ? prev.approvals.slice() : [];
    for (const a of reply.approvals) {
      if (!approvals.some((x) => x.toolUseId === a.toolUseId)) approvals.push({ ...a, state: "pending", requestedAt: now() });
    }
    const doc = { ...(prev || {}), ...extra, status: reply.status, lastReply: text(reply.text, 20000), approvals: approvals.slice(-50), updatedAt: now() };
    await sessionRef(id).set(doc, { merge: true });
    return doc;
  }
  // The AI Session ID is logged once against the linked lead (a line in its
  // history, which the lead card shows) — and against the opportunity on the
  // session record. Idempotent: loggedOnLead is set on the session.
  async function logSessionOnLead(id, d, by) {
    if (!d.leadId || d.loggedOnLead) return d;
    try {
      const ref = db.collection("leads").doc(d.leadId);
      const snap = await ref.get();
      if (!snap.exists) return d;
      const lead = snap.data() || {};
      const line = `Partner Central AI session ${id} (${d.catalog} catalogue)${d.opportunityId ? ` for ACE opportunity ${d.opportunityId}` : ""}, started from the console.`;
      const history = [...(Array.isArray(lead.history) ? lead.history : []), { at: now().toISOString(), by: String(by || "").slice(0, 200), kind: "note", text: line }].slice(-100);
      await ref.set({ history, aiSessionIds: [...new Set([...(Array.isArray(lead.aiSessionIds) ? lead.aiSessionIds : []), id])].slice(-50), updatedAt: now(), updatedByEmail: by || null }, { merge: true });
      await sessionRef(id).set({ loggedOnLead: true }, { merge: true });
      return { ...d, loggedOnLead: true };
    } catch (err) {
      logger.warn("partnerCentral could not log the AI session on the lead", { error: String(err) });
      return d;
    }
  }

  async function agentMessage(input, ctx) {
    const body = input && typeof input === "object" ? input : {};
    const message = String(body.text == null ? "" : body.text).trim();
    if (!message) throw Object.assign(new Error("Type a message for the Partner Central agent."), { status: 400 });
    if (message.length > AGENT_MESSAGE_MAX) throw Object.assign(new Error(`A message holds up to ${AGENT_MESSAGE_MAX} characters.`), { status: 400 });
    const cfg = await loadConfig();
    const sessionId = body.sessionId ? String(body.sessionId) : null;
    const prev = sessionId ? await loadSession(sessionId, cfg) : null;
    let leadId = text(body.leadId, 128);
    const opportunityId = text(body.opportunityId, 64);
    if (opportunityId && !/^[A-Za-z0-9._-]{1,64}$/.test(opportunityId)) throw Object.assign(new Error("That is not an ACE opportunity id."), { status: 400 });
    if (leadId && !/^[A-Za-z0-9_-]{1,128}$/.test(leadId)) throw Object.assign(new Error("That lead was not found."), { status: 404 });
    // An opportunity with no lead named: link the lead already matched to it.
    if (!leadId && opportunityId && !(prev && prev.leadId)) {
      try {
        const m = await db.collection("leads").where("aceOpportunityId", "==", opportunityId).limit(1).get();
        if (m.docs.length) leadId = m.docs[0].id;
      } catch { /* no match: the session still records the opportunity */ }
    }
    const reply = await callAgent("sendMessage", { content: [{ type: "text", text: message }], ...(sessionId ? { sessionId } : {}) }, { by: ctx.by, config: cfg });
    const id = reply.sessionId || sessionId;
    if (!id || !SESSION_ID_RE.test(id)) return { session: null, reply };
    let leadName = prev && prev.leadName || null;
    if (leadId && (!prev || prev.leadId !== leadId)) {
      const l = await db.collection("leads").doc(leadId).get().catch(() => null);
      if (!l || !l.exists) throw Object.assign(new Error("That lead was not found."), { status: 404 });
      const ld = l.data() || {};
      leadName = text((ld.company && ld.company.name) || (Array.isArray(ld.contacts) && ld.contacts[0] && ld.contacts[0].name) || leadId, 160);
    }
    const leadChanged = !!(leadId && prev && prev.leadId !== leadId);
    const extra = prev
      ? { ...(leadId ? { leadId, leadName } : {}), ...(leadChanged ? { loggedOnLead: false } : {}), ...(opportunityId ? { opportunityId } : {}) }
      : { catalog: cfg.catalog, createdBy: ctx.by, createdAt: now(), expiresAt: new Date(now().getTime() + AGENT_SESSION_TTL_MS), leadId: leadId || null, leadName, opportunityId: opportunityId || null, loggedOnLead: false };
    let doc = await saveSession(id, prev, reply, extra);
    doc = await logSessionOnLead(id, doc, ctx.by);
    return { session: sessionView(id, doc), reply };
  }

  async function agentRefresh(id, ctx) {
    const cfg = await loadConfig();
    const prev = await loadSession(id, cfg);
    const reply = await callAgent("getSession", { sessionId: id }, { by: ctx.by, config: cfg });
    const doc = await saveSession(id, prev, reply, {});
    return { session: sessionView(id, doc), reply };
  }

  // Answer one pending write. Only a toolUseId the console recorded as pending
  // for this session can be answered, and only once.
  async function agentDecide(id, toolUseId, input, ctx) {
    const body = input && typeof input === "object" ? input : {};
    const decision = String(body.decision || "");
    if (!AGENT_DECISIONS.includes(decision)) throw Object.assign(new Error("decision must be approve or reject"), { status: 400 });
    const cfg = await loadConfig();
    const prev = await loadSession(id, cfg);
    const approvals = Array.isArray(prev.approvals) ? prev.approvals.slice() : [];
    const i = approvals.findIndex((a) => a.toolUseId === toolUseId);
    if (i < 0) throw Object.assign(new Error("No such write is waiting for approval in this session."), { status: 404 });
    if (approvals[i].state !== "pending") throw Object.assign(new Error(`That write was already ${approvals[i].state}.`), { status: 409 });
    // Drafts only: a submit is never approved from the console (the account lead submits in Partner Central).
    if (decision === "approve" && isSubmitLike(approvals[i].toolName, approvals[i].parameters)) {
      await audit({ operation: "agent:approve", catalog: cfg.catalog, by: ctx.by, ok: false, error: "submit refused: drafts only", target: id, toolName: approvals[i].toolName || null, toolUseId });
      throw Object.assign(new Error("The console never submits: reject this, and submit the draft yourself in Partner Central."), { status: 403 });
    }
    const note = text(body.message, 1000);
    const block = { type: "tool_approval_response", toolUseId, decision, ...(note ? { message: note } : {}) };
    const reply = await callAgent("sendMessage", { content: [block], sessionId: id }, { by: ctx.by, config: cfg });
    approvals[i] = { ...approvals[i], state: decision === "approve" ? "approved" : "rejected", decidedBy: ctx.by, decidedAt: now(), ...(note ? { decisionNote: note } : {}) };
    await audit({ operation: `agent:${decision}`, catalog: cfg.catalog, by: ctx.by, ok: true, target: id, toolName: approvals[i].toolName || null, toolUseId });
    const doc = await saveSession(id, { ...prev, approvals }, reply, {});
    return { session: sessionView(id, doc), reply };
  }

  async function agentOverview() {
    const cfg = await loadConfig();
    const snap = await db.collection(AGENT_SESSIONS).orderBy("updatedAt", "desc").limit(20).get();
    const sessions = snap.docs.map((d) => sessionView(d.id, d.data())).filter((x) => x.catalog === cfg.catalog);
    let leads = [];
    try {
      const ls = await db.collection("leads").get();
      leads = ls.docs.map((d) => { const x = d.data() || {}; return { id: d.id, name: text((x.company && x.company.name) || (Array.isArray(x.contacts) && x.contacts[0] && x.contacts[0].name) || "", 160), archived: !!x.archived }; })
        .filter((l) => l.name && !l.archived).map(({ id, name }) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)).slice(0, 500);
    } catch { leads = []; }
    return { catalog: cfg.catalog, sessions, leads };
  }

  // ── AWS funding drafts for a lead (leadFunding/{leadId}) ──
  const LEAD_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
  const fundingRef = (leadId) => db.collection(FUNDING).doc(leadId);
  function fundingView(leadId, d) {
    const x = d || {};
    return {
      leadId, catalog: x.catalog || null, sessionId: x.sessionId || null, opportunityId: x.opportunityId || null,
      status: x.status || null, structured: x.structured === true, programs: Array.isArray(x.programs) ? x.programs : [],
      replyText: x.replyText || "", pendingApprovals: Number(x.pendingApprovals) || 0,
      checkedAt: iso(x.checkedAt), checkedBy: x.checkedBy || null,
      pocApproved: x.pocApproved ? { ...x.pocApproved, at: iso(x.pocApproved.at) } : null,
    };
  }
  async function loadFundingLead(leadId) {
    if (!LEAD_ID_RE.test(String(leadId || ""))) throw Object.assign(new Error("That lead was not found."), { status: 404 });
    const snap = await db.collection("leads").doc(leadId).get();
    if (!snap.exists) throw Object.assign(new Error("That lead was not found."), { status: 404 });
    const lead = snap.data() || {};
    if (lead.leadType === "operator") throw Object.assign(new Error("AWS funding applies to company leads only."), { status: 400 });
    return lead;
  }
  async function appendLeadHistory(leadId, line, by) {
    try {
      const ref = db.collection("leads").doc(leadId);
      const snap = await ref.get();
      if (!snap.exists) return;
      const lead = snap.data() || {};
      const history = [...(Array.isArray(lead.history) ? lead.history : []), { at: now().toISOString(), by: String(by || "").slice(0, 200), kind: "note", text: line }].slice(-100);
      await ref.set({ history, updatedAt: now(), updatedByEmail: by || null }, { merge: true });
    } catch (err) {
      logger.warn("partnerCentral could not add to the lead's history", { error: String(err) });
    }
  }
  const money = (n, cur) => `${cur || "USD"} ${Number(n).toLocaleString("en-US")}`;
  function fundingLine(cfg, programs, structured, pending) {
    const parts = structured ? programs.map((p) => `${p.name} ${p.eligible === true ? "eligible" : p.eligible === false ? "not eligible" : "unclear"}${p.estimatedAmount !== null ? `, est. ${money(p.estimatedAmount, p.currency)}` : ""}`) : ["answer in the agent panel"];
    return `AWS funding checked (${cfg.catalog} catalogue): ${parts.join("; ")}.${pending ? ` ${pending} draft${pending === 1 ? "" : "s"} wait${pending === 1 ? "s" : ""} for an admin's approval.` : ""} Drafts only; nothing was submitted.`.slice(0, 2000);
  }
  // Run the check: one new agent session, linked to the lead (and its ACE opportunity).
  async function fundingCheck(leadId, input, ctx) {
    const lead = await loadFundingLead(leadId);
    const body = input && typeof input === "object" ? input : {};
    const prevSnap = await fundingRef(leadId).get();
    const prev = prevSnap.exists ? prevSnap.data() || {} : {};
    const opportunityId = text(first(body.opportunityId, lead.aceOpportunityId, prev.opportunityId), 64);
    if (opportunityId && !/^[A-Za-z0-9._-]{1,64}$/.test(opportunityId)) throw Object.assign(new Error("That is not an ACE opportunity id."), { status: 400 });
    const cfg = await loadConfig();
    const out = await agentMessage({ text: buildFundingPrompt({ lead, opportunityId, catalog: cfg.catalog }), leadId, ...(opportunityId ? { opportunityId } : {}) }, ctx);
    const parsed = parseFundingReply(out.reply.text);
    const pending = out.session ? out.session.approvals.filter((a) => a.state === "pending").length : 0;
    const doc = {
      leadId, catalog: cfg.catalog, sessionId: out.session ? out.session.sessionId : null, opportunityId: opportunityId || null,
      status: out.reply.status, structured: parsed.structured, programs: parsed.programs, schemaVersion: FUNDING_SCHEMA_VERSION,
      replyText: text(out.reply.text, 6000), pendingApprovals: pending, checkedAt: now(), checkedBy: ctx.by,
    };
    await fundingRef(leadId).set(doc, { merge: true });
    await audit({ operation: "funding:check", catalog: cfg.catalog, by: ctx.by, ok: true, target: leadId });
    await appendLeadHistory(leadId, fundingLine(cfg, parsed.programs, parsed.structured, pending), ctx.by);
    return { funding: fundingView(leadId, { ...prev, ...doc }) };
  }
  // Re-read the check's session from AWS (a long answer, or after drafts were approved).
  async function fundingRefresh(leadId, ctx) {
    await loadFundingLead(leadId);
    const snap = await fundingRef(leadId).get();
    const prev = snap.exists ? snap.data() || {} : null;
    if (!prev || !prev.sessionId) throw Object.assign(new Error("Run Check funding eligibility first."), { status: 404 });
    const out = await agentRefresh(prev.sessionId, ctx);
    const parsed = parseFundingReply(out.reply.text);
    const doc = {
      status: out.reply.status, pendingApprovals: out.session.approvals.filter((a) => a.state === "pending").length,
      ...(parsed.structured ? { structured: true, programs: parsed.programs, replyText: text(out.reply.text, 6000) } : {}),
    };
    await fundingRef(leadId).set(doc, { merge: true });
    return { funding: fundingView(leadId, { ...prev, ...doc }) };
  }
  // The POC was approved by AWS (recorded by hand): the claim / proof-of-execution
  // sign-off document is due next, made by the aws-ace-poc-claim skill as before.
  async function fundingPocApproved(leadId, input, ctx) {
    await loadFundingLead(leadId);
    const body = input && typeof input === "object" ? input : {};
    const snap = await fundingRef(leadId).get();
    const prev = snap.exists ? snap.data() || {} : {};
    if (body.clear === true) {
      await fundingRef(leadId).set({ leadId, pocApproved: null }, { merge: true });
      await appendLeadHistory(leadId, "POC funding approval cleared.", ctx.by);
      return { funding: fundingView(leadId, { ...prev, pocApproved: null }) };
    }
    const amount = fundNum(body.amount);
    const currency = /^[A-Z]{3}$/.test(String(body.currency || "")) ? body.currency : "USD";
    const reference = text(body.reference, 80);
    if (reference && !/^[A-Za-z0-9._:/ -]{1,80}$/.test(reference)) throw Object.assign(new Error("Use letters, numbers and - . _ : / for the funding reference."), { status: 400 });
    const pocApproved = { at: now(), by: ctx.by, amount, currency, reference: reference || null };
    await fundingRef(leadId).set({ leadId, pocApproved }, { merge: true });
    await audit({ operation: "funding:poc-approved", by: ctx.by, ok: true, target: leadId });
    await appendLeadHistory(leadId, `POC funding approved${reference ? ` (${reference})` : ""}${amount !== null ? `, ${money(amount, currency)}` : ""}: the claim sign-off document (proof of execution) is due.`, ctx.by);
    return { funding: fundingView(leadId, { ...prev, pocApproved }) };
  }

  async function requireAdmin(req, min = "admin") {
    const idToken = String(req.get("x-firebase-id-token") || "");
    if (!idToken) return { ok: false, status: 401, error: "sign in first" };
    let decoded;
    try { decoded = await verifyIdToken(idToken); } catch { return { ok: false, status: 401, error: "invalid sign-in" }; }
    const user = await resolveConsoleUser(decoded.email);
    if (!user) return { ok: false, status: 403, error: "not on the console user list" };
    if ((ROLE_RANK[user.role] || 0) < ROLE_RANK[min]) return { ok: false, status: 403, error: min === "admin" ? "only an admin can use the Partner Central connection" : /^\/v1\/licences/.test(String(req.path || req.url || "").replace(/^\/partnerCentral/, "")) ? "only an editor or admin can sync or link licences" : "only an editor or admin can see the ACE opportunities" };
    return { ok: true, user };
  }

  async function handle(req, res) {
    const path = String((req.path || req.url || "/").split("?")[0]).replace(/^\/partnerCentral(?=\/|$)/, "").replace(/\/+$/, "") || "/";
    const who = await requireAdmin(req, /^\/v1\/(ace|licences)(\/|$)/.test(path) ? "editor" : "admin");
    if (!who.ok) return send(res, who.status, { error: who.error });
    const ctx = { by: who.user.email };
    const body = req.body || {};
    try {
      if (path === "/v1/status" && req.method === "GET") return send(res, 200, await status());
      if (path === "/v1/audit" && req.method === "GET") {
        const snap = await db.collection(AUDIT).orderBy("at", "desc").limit(50).get();
        return send(res, 200, { entries: snap.docs.map((d) => { const e = d.data() || {}; return { ...e, at: iso(e.at) }; }) });
      }
      if (path === "/v1/test" && req.method === "POST") {
        const out = await listOpportunities({ MaxResults: 1 }, ctx);
        return send(res, 200, { ok: true, opportunities: (out.OpportunitySummaries || []).length });
      }
      if (path === "/v1/config" && req.method === "POST") {
        const catalog = String(body.catalog || "");
        if (!CATALOGS.includes(catalog)) return send(res, 400, { error: "catalog must be Sandbox or AWS" });
        if (catalog === "AWS" && body.confirm !== "LIVE") return send(res, 400, { error: 'switching to the live AWS catalogue needs confirm: "LIVE"' });
        await ref(CONFIG_DOC).set({ catalog, updatedBy: who.user.email, updatedAt: now() }, { merge: true });
        await audit({ operation: "config:set-catalog", catalog, by: who.user.email, ok: true });
        return send(res, 200, { ok: true, catalog });
      }
      if (path === "/v1/ace" && req.method === "GET") return send(res, 200, await aceOpportunities(ctx));
      if (path === "/v1/ace" && req.method === "POST") return send(res, 200, await aceCreate(body, ctx));
      const a = /^\/v1\/ace\/([A-Za-z0-9._-]{1,64})$/.exec(path);
      if (a && req.method === "GET") return send(res, 200, { opportunity: await aceOne(a[1], ctx) });
      if (a && req.method === "PATCH") return send(res, 200, await aceUpdate(a[1], body, ctx));
      const f = /^\/v1\/funding\/([A-Za-z0-9_-]{1,128})\/(check|refresh|poc-approved)$/.exec(path);
      if (f && req.method === "POST") {
        if (f[2] === "check") return send(res, 200, await fundingCheck(f[1], body, ctx));
        if (f[2] === "refresh") return send(res, 200, await fundingRefresh(f[1], ctx));
        return send(res, 200, await fundingPocApproved(f[1], body, ctx));
      }
      if (path === "/v1/agent" && req.method === "GET") return send(res, 200, await agentOverview());
      if (path === "/v1/agent/messages" && req.method === "POST") return send(res, 200, await agentMessage(body, ctx));
      const g = /^\/v1\/agent\/sessions\/([A-Za-z0-9._:-]{1,128})$/.exec(path);
      if (g && req.method === "POST") return send(res, 200, await agentRefresh(g[1], ctx));
      const ap = /^\/v1\/agent\/sessions\/([A-Za-z0-9._:-]{1,128})\/approvals\/([A-Za-z0-9._:-]{1,128})$/.exec(path);
      if (ap && req.method === "POST") return send(res, 200, await agentDecide(ap[1], ap[2], body, ctx));
      if (path === "/v1/opportunities" && req.method === "GET") return send(res, 200, await listOpportunities({}, ctx));
      if (path === "/v1/opportunities" && req.method === "POST") return send(res, 200, await createOpportunity(body, ctx));
      const m = /^\/v1\/opportunities\/([A-Za-z0-9._-]{1,64})$/.exec(path);
      if (m && req.method === "GET") return send(res, 200, await getOpportunity(m[1], ctx));
      if (m && req.method === "PATCH") return send(res, 200, await updateOpportunity(m[1], body, ctx));
      if (path === "/v1/benefits/drafts" && req.method === "POST") return send(res, 200, await createBenefitDraft(body, ctx));
      if (path.startsWith("/v1/licences/")) {
        const out = await licences.handle(path, req, ctx);
        if (out) return send(res, 200, out);
      }
      return send(res, 404, { error: "not found" });
    } catch (err) {
      return send(res, err.status || 500, { error: String(err.message || err).slice(0, 300) });
    }
  }

  // The role's short-lived credentials, for the S3 export reader (pc-export.js). Never sent to a browser.
  const awsCredentials = async () => assumeRole((await loadConfig()).roleArn);

  return { handle, status, loadConfig, authorise: requireAdmin, licences, awsCredentials, fundingCheck, fundingRefresh, fundingPocApproved, agentMessage, agentRefresh, agentDecide, agentOverview, callAgent, aceOpportunities, aceCreate, aceUpdate, aceOne, callAws, listOpportunities, getOpportunity, createOpportunity, updateOpportunity, createBenefitDraft };
}

module.exports = { createPartnerCentralApi, buildFundingPrompt, parseFundingReply, isSubmitLike, fundingProgramKey, FUNDING, FUNDING_PROGRAMS, FUNDING_STAGES, FUNDING_SCHEMA_VERSION, parseAgentResult, parseMcpBody, AGENT_MCP, AGENT_TOOLS, AGENT_SESSIONS, sanitiseAceInput, buildUpdate, buildCreate, EDITABLE, describeNetworkError, normaliseOpportunity, signRequest, OPERATIONS, SERVICES, CATALOGS, AUDIT, DEFAULT_ROLE_ARN };
