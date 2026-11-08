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

const crypto = require("crypto");

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

function signRequest({ method = "POST", host, path = "/", headers = {}, body = "", service, region = REGION, creds, date = new Date() }) {
  const amzDate = date.toISOString().replace(/[:-]|\.\d{3}/g, ""); // 20261106T120000Z
  const day = amzDate.slice(0, 8);
  const h = { ...headers, host, "x-amz-date": amzDate };
  if (creds.sessionToken) h["x-amz-security-token"] = creds.sessionToken;
  const names = Object.keys(h).map((k) => k.toLowerCase()).sort();
  const lower = Object.fromEntries(Object.entries(h).map(([k, v]) => [k.toLowerCase(), String(v).trim()]));
  const canonical = [method, path, "", names.map((n) => `${n}:${lower[n]}\n`).join(""), names.join(";"), sha256hex(body)].join("\n");
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
    return { catalog: CATALOGS.includes(d.catalog) ? d.catalog : "Sandbox", roleArn: String(d.roleArn || defaultRoleArn), updatedBy: d.updatedBy || null, updatedAt: iso(d.updatedAt) };
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

  // The single door to AWS. Refuses anything not in OPERATIONS.
  async function callAws(operation, payload, { by, config } = {}) {
    const spec = OPERATIONS[operation];
    const cfg = config || (await loadConfig());
    const started = now();
    if (!spec) {
      await audit({ operation, catalog: cfg.catalog, by: by || null, ok: false, error: "operation not allowed" });
      throw Object.assign(new Error(`operation not allowed: ${operation}`), { status: 400 });
    }
    const body = { Catalog: cfg.catalog, ...payload };
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

  async function requireAdmin(req, min = "admin") {
    const idToken = String(req.get("x-firebase-id-token") || "");
    if (!idToken) return { ok: false, status: 401, error: "sign in first" };
    let decoded;
    try { decoded = await verifyIdToken(idToken); } catch { return { ok: false, status: 401, error: "invalid sign-in" }; }
    const user = await resolveConsoleUser(decoded.email);
    if (!user) return { ok: false, status: 403, error: "not on the console user list" };
    if ((ROLE_RANK[user.role] || 0) < ROLE_RANK[min]) return { ok: false, status: 403, error: min === "admin" ? "only an admin can use the Partner Central connection" : "only an editor or admin can see the ACE opportunities" };
    return { ok: true, user };
  }

  async function handle(req, res) {
    const path = String((req.path || req.url || "/").split("?")[0]).replace(/^\/partnerCentral(?=\/|$)/, "").replace(/\/+$/, "") || "/";
    const who = await requireAdmin(req, /^\/v1\/ace(\/|$)/.test(path) ? "editor" : "admin");
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
      if (path === "/v1/opportunities" && req.method === "GET") return send(res, 200, await listOpportunities({}, ctx));
      if (path === "/v1/opportunities" && req.method === "POST") return send(res, 200, await createOpportunity(body, ctx));
      const m = /^\/v1\/opportunities\/([A-Za-z0-9._-]{1,64})$/.exec(path);
      if (m && req.method === "GET") return send(res, 200, await getOpportunity(m[1], ctx));
      if (m && req.method === "PATCH") return send(res, 200, await updateOpportunity(m[1], body, ctx));
      if (path === "/v1/benefits/drafts" && req.method === "POST") return send(res, 200, await createBenefitDraft(body, ctx));
      return send(res, 404, { error: "not found" });
    } catch (err) {
      return send(res, err.status || 500, { error: String(err.message || err).slice(0, 300) });
    }
  }

  return { handle, status, aceOpportunities, aceCreate, aceUpdate, aceOne, callAws, listOpportunities, getOpportunity, createOpportunity, updateOpportunity, createBenefitDraft };
}

module.exports = { createPartnerCentralApi, sanitiseAceInput, buildUpdate, buildCreate, EDITABLE, describeNetworkError, normaliseOpportunity, signRequest, OPERATIONS, SERVICES, CATALOGS, AUDIT, DEFAULT_ROLE_ARN };
