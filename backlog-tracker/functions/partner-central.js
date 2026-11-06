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
// NOTE: target prefixes and signing names follow AWS's published service
// models for Partner Central. Verify them against the first real Sandbox call
// (README → "AWS Partner Central connection"); they are data here, not logic.
const SERVICES = {
  selling: { host: `partnercentral-selling.${REGION}.amazonaws.com`, signingName: "partnercentral-selling", target: "AWSPartnerCentralSelling" },
  benefits: { host: `partnercentral-benefits.${REGION}.amazonaws.com`, signingName: "partnercentral-benefits", target: "AWSPartnerCentralBenefits" },
};

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
    let result = null; let error = null; let httpStatus = null;
    try {
      const creds = await assumeRole(cfg.roleArn);
      const svc = SERVICES[spec.service];
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
      if (!r.ok) error = `${String(parsed.__type || `HTTP ${r.status}`).split("#").pop()}: ${String(parsed.message || parsed.Message || "").slice(0, 200)}`;
      else result = parsed;
    } catch (err) {
      error = String(err.message || err).slice(0, 300);
    }
    const ok = !error;
    await audit({ operation, catalog: cfg.catalog, roleArn: cfg.roleArn, by: by || null, ok, httpStatus, error, ms: now().getTime() - started.getTime(), target: payload && (payload.Identifier || null) });
    await recordState(ok
      ? { lastSuccessAt: now(), lastSuccessOperation: operation, lastSuccessCatalog: cfg.catalog, lastError: null }
      : { lastErrorAt: now(), lastError: error, lastErrorOperation: operation });
    if (!ok) throw Object.assign(new Error(error), { status: 502, awsStatus: httpStatus });
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
    else if (d.lastError) state = /AccessDenied|InvalidIdentityToken|NoSuchEntity|InvalidParameter|NotAuthorized|AccessDeniedException/i.test(d.lastError) ? "not-linked" : "error";
    return {
      state, // connected | not-linked | error
      catalog: cfg.catalog, roleArn: cfg.roleArn,
      lastSuccessAt: iso(d.lastSuccessAt), lastSuccessOperation: d.lastSuccessOperation || null,
      lastError: d.lastError || null, lastErrorAt: iso(d.lastErrorAt),
      note: state === "connected" ? null : "Not linked yet: link the Partner Central account to the AWS account and map the IAM role to a Partner Central user role (see backlog-tracker/deploy/aws/README.md), then press Test connection.",
    };
  }

  async function requireAdmin(req) {
    const idToken = String(req.get("x-firebase-id-token") || "");
    if (!idToken) return { ok: false, status: 401, error: "sign in first" };
    let decoded;
    try { decoded = await verifyIdToken(idToken); } catch { return { ok: false, status: 401, error: "invalid sign-in" }; }
    const user = await resolveConsoleUser(decoded.email);
    if (!user) return { ok: false, status: 403, error: "not on the console user list" };
    if ((ROLE_RANK[user.role] || 0) < ROLE_RANK.admin) return { ok: false, status: 403, error: "only an admin can use the Partner Central connection" };
    return { ok: true, user };
  }

  async function handle(req, res) {
    const path = String((req.path || req.url || "/").split("?")[0]).replace(/^\/partnerCentral(?=\/|$)/, "").replace(/\/+$/, "") || "/";
    const who = await requireAdmin(req);
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

  return { handle, status, callAws, listOpportunities, getOpportunity, createOpportunity, updateOpportunity, createBenefitDraft };
}

module.exports = { createPartnerCentralApi, signRequest, OPERATIONS, SERVICES, CATALOGS, AUDIT, DEFAULT_ROLE_ARN };
