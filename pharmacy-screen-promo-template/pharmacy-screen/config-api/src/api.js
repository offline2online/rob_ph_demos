"use strict";

// The REST API, framework-neutral: createConfigApi(...) returns
//   handle({ method, path, headers, query, body }) -> { status, headers, body }
// where body in is a Buffer (or undefined) and body out is a JSON-able value
// or null. src/http.js adapts it to Node / Cloud Functions requests; an AWS
// Lambda adapter would map API Gateway events the same way.
//
// Routes (README.md → "API" has the full reference):
//   GET  /api/health
//   GET  /api/screens/{storeCode}[?promo=<promoId>]       public, published config only; per-client rate limit
//   POST /api/csp-report                                   public: Content-Security-Policy violation reports, logged
//   /api/admin/...                                         admin role required
//     pharmacies, pharmacies/{id}, pharmacies/{id}/content/{promotionId}, pharmacies/{id}/logo
//     promotions, promotions/{id}
//     templates, templates/{id}, templates/{id}/clone, templates/{id}/backgrounds/{orientation}
//     services, services/{id}
//     audit

const crypto = require("node:crypto");
const { ApiError, bad } = require("./validate");
const { createConfigService } = require("./service");
const { createRateLimiter } = require("./rate-limit");
const { createVideoJobs } = require("./video/jobs");

const JSON_LIMIT = 2 * 1024 * 1024;
// A CSP report is a few hundred bytes; anything bigger is not one.
const CSP_REPORT_LIMIT = 8 * 1024;
const CSP_REPORTS_PER_CLIENT_PER_MIN = 30;

// One violation report (report-uri's application/csp-report, or the Reporting API's application/reports+json)
// as a single short log line: the directive, the blocked origin (never the full URL, which can carry a query
// string), the page path, the source line and whether the policy was enforced. Everything in a report is written
// by the browser of whoever sent it, so every field is cut short and stripped to printable characters.
function cspReportLines(type, body) {
  let data;
  try {
    data = JSON.parse(body.toString("utf8"));
  } catch {
    return [];
  }
  const items = Array.isArray(data) ? data.filter((r) => r && r.type === "csp-violation").map((r) => r.body || {}) : data && typeof data["csp-report"] === "object" ? [data["csp-report"]] : [];
  const clip = (v, n = 80) => String(v === undefined || v === null ? "" : v).replace(/[^\x20-\x7e]/g, "?").slice(0, n);
  const originOf = (u) => {
    const v = String(u || "");
    if (/^(inline|eval|wasm-eval|trusted-types-[\w-]+|data|blob)$/.test(v)) return v;
    try {
      const url = new URL(v);
      return /^https?:$/.test(url.protocol) ? url.origin : url.protocol;
    } catch {
      return clip(v, 40);
    }
  };
  const pathOf = (u) => {
    try {
      return new URL(String(u)).pathname;
    } catch {
      return "";
    }
  };
  const lines = [];
  for (const r of items.slice(0, 5)) {
    const blocked = originOf(r["blocked-uri"] ?? r.blockedURL);
    // Browser extensions report into every page they touch; they say nothing about this site's policy.
    if (/^(chrome-extension|moz-extension|safari-web-extension|about):?$/.test(blocked)) continue;
    const directive = clip(r["effective-directive"] ?? r.effectiveDirective ?? r["violated-directive"], 40);
    const page = clip(pathOf(r["document-uri"] ?? r.documentURL), 80);
    const source = r["source-file"] ?? r.sourceFile;
    const line = r["line-number"] ?? r.lineNumber;
    const where = source ? ` at ${clip(pathOf(source) || originOf(source), 80)}${line ? `:${clip(line, 8)}` : ""}` : "";
    const disposition = clip(r.disposition || "report", 10);
    lines.push(`[csp] ${disposition} ${directive} blocked ${blocked} on ${page}${where}`);
  }
  return lines;
}
// How long a CDN may reuse a published screen config. Part of how soon an
// edit reaches a screen: this, plus the screen's config poll (js/live-data.js
// CONFIG_POLL_MS).
const PUBLIC_MAX_AGE = 5;

// screensPerClientLimit: GET /api/screens/** requests per client address per minute (per instance; 0 = no limit).
// Counted only when the entry point passes the address (req.ip): the Cloud Function and the Lambda do, the local
// dev servers don't. clock: milliseconds, for that limit (tests).
// video: {screenPageUrl, dispatch(jobId), now?} turns on Download MP4 (src/video/jobs.js); without it the two
// /api/admin/videos routes answer 503.
function createConfigApi({ store, blobs, auth, allowedOrigins = [], now, log = () => {}, screensPerClientLimit = 600, clock, video = {} }) {
  const svc = createConfigService({ store, blobs, now, log });
  const videos = createVideoJobs({ store, svc, screenPageUrl: video.screenPageUrl, dispatch: video.dispatch, now: video.now, log });
  const origins = new Set(allowedOrigins.filter(Boolean));
  const screensLimiter = createRateLimiter({ limit: screensPerClientLimit, now: clock });
  const cspLimiter = createRateLimiter({ limit: CSP_REPORTS_PER_CLIENT_PER_MIN, now: clock });

  const routes = [];
  // admin: true   the admin role only (the default).
  // store: true   also a store user (actor.stores, a Personalisation Hub
  //               Retail Admin session): the service narrows what they see
  //               and may change to their own pharmacies (service.js ->
  //               "store users").
  const route = (method, pattern, handler, { admin = true, raw = false, store = false } = {}) => {
    const keys = [];
    const re = new RegExp(
      "^" + pattern.replace(/\{(\w+)\}/g, (_, k) => (keys.push(k), "([^/]+)")) + "/?$"
    );
    routes.push({ method, re, keys, handler, admin, raw, store });
  };

  // ── public ─────────────────────────────────────────────────────────────
  route("GET", "/api/health", () => ({ ok: true }), { admin: false });
  route("GET", "/api/screens/{storeCode}", ({ params, query }) => svc.getScreenConfig(params.storeCode, query.promo), { admin: false });
  // Content-Security-Policy-Report-Only reports from the screen and the editor (firebase.json, aws/infra/stack.js).
  // Always 204, whatever arrives: a report never gets an error a browser would retry. Logged at warn level.
  route("POST", "/api/csp-report", ({ headers, body, ip }) => {
    if (body.length && body.length <= CSP_REPORT_LIMIT && (!ip || cspLimiter.take(String(ip)).ok)) {
      for (const line of cspReportLines(headers["content-type"], body)) log("warn", line);
    }
    return NO_CONTENT;
  }, { admin: false });

  // ── admin ──────────────────────────────────────────────────────────────
  // Optimistic concurrency: If-Match: "<version>" (or ?expectedVersion=, or
  // expectedVersion in the JSON body). A stale version gets 409.
  const v = (req) => {
    const raw = req.headers["if-match"] ?? req.query.expectedVersion;
    return raw === undefined ? undefined : String(raw).replace(/^W\//, "").replace(/"/g, "").trim();
  };

  const STORE = { store: true };
  route("GET", "/api/admin/me", ({ actor }) => actor, STORE);

  route("GET", "/api/admin/pharmacies", ({ actor }) => svc.listPharmacies(actor), STORE);
  route("POST", "/api/admin/pharmacies", ({ actor, json }) => created(svc.createPharmacy(actor, json())));
  route("GET", "/api/admin/pharmacies/{id}", ({ actor, params }) => svc.getPharmacy(params.id, actor), STORE);
  route("PATCH", "/api/admin/pharmacies/{id}", (r) => svc.updatePharmacy(r.actor, r.params.id, r.json(), v(r)), STORE);
  route("PUT", "/api/admin/pharmacies/{id}", (r) => svc.updatePharmacy(r.actor, r.params.id, r.json(), v(r)));
  route("DELETE", "/api/admin/pharmacies/{id}", (r) => svc.deletePharmacy(r.actor, r.params.id, v(r)));
  route("PUT", "/api/admin/pharmacies/{id}/content/{promotionId}", (r) => svc.setPharmacyContent(r.actor, r.params.id, r.params.promotionId, r.json(), v(r)), STORE);
  route("PUT", "/api/admin/pharmacies/{id}/logo", (r) => svc.setLogo(r.actor, r.params.id, r.headers["content-type"], r.body), { raw: true });
  route("DELETE", "/api/admin/pharmacies/{id}/logo", (r) => svc.removeLogo(r.actor, r.params.id));

  route("GET", "/api/admin/promotions", () => svc.listPromotions(), STORE);
  route("POST", "/api/admin/promotions", ({ actor, json }) => created(svc.createPromotion(actor, json())));
  route("GET", "/api/admin/promotions/{id}", ({ params }) => svc.getPromotion(params.id));
  route("PATCH", "/api/admin/promotions/{id}", (r) => svc.updatePromotion(r.actor, r.params.id, r.json(), v(r)));
  route("PUT", "/api/admin/promotions/{id}", (r) => svc.updatePromotion(r.actor, r.params.id, r.json(), v(r)));
  route("DELETE", "/api/admin/promotions/{id}", (r) => svc.deletePromotion(r.actor, r.params.id, v(r)));

  route("GET", "/api/admin/templates", () => svc.listTemplates(), STORE);
  route("POST", "/api/admin/templates", ({ actor, json }) => created(svc.createTemplate(actor, json())));
  route("GET", "/api/admin/templates/{id}", ({ params }) => svc.getTemplate(params.id));
  route("PATCH", "/api/admin/templates/{id}", (r) => svc.updateTemplate(r.actor, r.params.id, r.json(), v(r)));
  route("PUT", "/api/admin/templates/{id}", (r) => svc.updateTemplate(r.actor, r.params.id, r.json(), v(r)));
  route("DELETE", "/api/admin/templates/{id}", (r) => svc.deleteTemplate(r.actor, r.params.id, v(r)));
  route("POST", "/api/admin/templates/{id}/clone", (r) => created(svc.cloneTemplate(r.actor, r.params.id, r.json({ optional: true }))));
  route("PUT", "/api/admin/templates/{id}/backgrounds/{orientation}", (r) => svc.setBackground(r.actor, r.params.id, r.params.orientation, r.headers["content-type"], r.body), { raw: true });
  route("DELETE", "/api/admin/templates/{id}/backgrounds/{orientation}", (r) => svc.removeBackground(r.actor, r.params.id, r.params.orientation));

  route("GET", "/api/admin/services", () => svc.listServices(), STORE);
  route("POST", "/api/admin/services", ({ actor, json }) => created(svc.createService(actor, json())));
  route("GET", "/api/admin/services/{id}", ({ params }) => svc.getService(params.id));
  route("PATCH", "/api/admin/services/{id}", (r) => svc.updateService(r.actor, r.params.id, r.json(), v(r)));
  route("PUT", "/api/admin/services/{id}", (r) => svc.updateService(r.actor, r.params.id, r.json(), v(r)));
  route("DELETE", "/api/admin/services/{id}", (r) => svc.deleteService(r.actor, r.params.id, v(r)));

  route("GET", "/api/admin/audit", ({ query }) => svc.listAudit(query));

  // Download MP4: admin only (the default), one render at a time (src/video/jobs.js).
  route("POST", "/api/admin/videos", ({ actor, json }) => created(videos.start(actor, json())));
  route("GET", "/api/admin/videos/{id}", ({ params }) => videos.get(params.id));

  // ── dispatch ───────────────────────────────────────────────────────────
  const CREATED = Symbol("created");
  const NO_CONTENT = Symbol("no-content");
  function created(promise) {
    return Promise.resolve(promise).then((value) => ({ [CREATED]: true, value }));
  }

  function corsHeaders(isPublic, origin) {
    if (isPublic) return { "Access-Control-Allow-Origin": "*" };
    if (origin && origins.has(origin)) {
      return { "Access-Control-Allow-Origin": origin, Vary: "Origin", "Access-Control-Allow-Credentials": "false" };
    }
    return {};
  }

  function errorBody(err) {
    const body = { error: { code: err.code, message: err.message } };
    if (err.details !== undefined) body.error.details = err.details;
    return body;
  }

  async function handle(req) {
    const method = String(req.method || "GET").toUpperCase();
    const headers = Object.fromEntries(Object.entries(req.headers || {}).map(([k, val]) => [k.toLowerCase(), Array.isArray(val) ? val[0] : val]));
    let path = String(req.path || "/").split("?")[0].replace(/\/{2,}/g, "/");
    if (!path.startsWith("/api/") && path !== "/api") path = "/api" + (path.startsWith("/") ? path : "/" + path);
    const query = req.query || {};
    const isPublic = !path.startsWith("/api/admin");
    const base = {
      "Content-Type": "application/json; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
      // The published config: shared caches (the CDN) hold it PUBLIC_MAX_AGE
      // seconds; with the ETag below a screen's poll that finds nothing new
      // costs a 304 and no body.
      "Cache-Control": isPublic ? `public, max-age=${PUBLIC_MAX_AGE}` : "no-store",
      ...corsHeaders(isPublic, headers.origin),
    };
    const reply = (status, body, extra = {}) => ({ status, headers: { ...base, ...extra }, body });

    if (method === "OPTIONS") {
      return reply(204, null, {
        "Access-Control-Allow-Methods": isPublic ? (path === "/api/csp-report" ? "POST, OPTIONS" : "GET, OPTIONS") : "GET, POST, PUT, PATCH, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": isPublic ? "Content-Type" : "Authorization, Content-Type, If-Match",
        "Access-Control-Max-Age": "600",
        "Cache-Control": "no-store",
      });
    }

    const matches = routes.filter((r) => r.re.test(path));
    if (!matches.length) return reply(404, errorBody(new ApiError(404, "not-found", `No route ${path}`)));
    const r = matches.find((m) => m.method === method);
    if (!r) return reply(405, errorBody(new ApiError(405, "method-not-allowed", `${method} is not allowed on ${path}`)), { Allow: matches.map((m) => m.method).join(", ") });
    if (path.startsWith("/api/screens/") && req.ip) {
      const lim = screensLimiter.take(String(req.ip));
      if (!lim.ok) return reply(429, errorBody(new ApiError(429, "rate-limited", "Too many requests; slow down")), { "Retry-After": String(lim.retryAfterSec), "Cache-Control": "no-store" });
    }

    try {
      let actor = null;
      if (r.admin) {
        actor = await auth.identify(headers.authorization);
        if (!actor) throw new ApiError(401, "unauthenticated", "Sign in: send Authorization: Bearer <ID token>");
        const storeUser = !actor.admin && Array.isArray(actor.stores) && actor.stores.length > 0;
        if (!actor.admin && !(r.store && storeUser)) throw new ApiError(403, "forbidden", "This needs the admin role");
      }
      const m = r.re.exec(path);
      // Ids are store document ids: never let an encoded "/" (or anything
      // else odd) through to address some other path in the store.
      const params = {};
      for (const [i, k] of r.keys.entries()) {
        let val;
        try {
          val = decodeURIComponent(m[i + 1]);
        } catch {
          val = "";
        }
        if (!/^[A-Za-z0-9_-]{1,64}$/.test(val)) throw new ApiError(404, "not-found", `No ${k} ${JSON.stringify(String(val).slice(0, 64))}`);
        params[k] = val;
      }
      const body = req.body === undefined || req.body === null ? Buffer.alloc(0) : Buffer.isBuffer(req.body) ? req.body : Buffer.from(typeof req.body === "string" ? req.body : JSON.stringify(req.body));
      const json = ({ optional = false } = {}) => {
        if (!body.length) {
          if (optional) return {};
          throw bad("Request body must be a JSON object");
        }
        if (body.length > JSON_LIMIT) throw new ApiError(413, "too-large", "Request body is too large");
        const type = String(headers["content-type"] || "").toLowerCase();
        if (!type.startsWith("application/json")) throw new ApiError(415, "unsupported-media-type", "Send Content-Type: application/json");
        try {
          return JSON.parse(body.toString("utf8"));
        } catch {
          throw bad("Request body is not valid JSON");
        }
      };
      const out = await r.handler({ actor, params, query, headers, body, json, ip: req.ip });
      if (out === NO_CONTENT) return reply(204, null, { "Cache-Control": "no-store" });
      if (out && out[CREATED]) return reply(201, out.value);
      if (isPublic && method === "GET" && out !== null && out !== undefined) {
        const etag = `"${crypto.createHash("sha256").update(JSON.stringify(out)).digest("base64url").slice(0, 27)}"`;
        const asked = String(headers["if-none-match"] || "").split(",").map((t) => t.trim().replace(/^W\//, ""));
        if (asked.includes(etag) || asked.includes("*")) return reply(304, null, { ETag: etag });
        return reply(200, out, { ETag: etag });
      }
      return reply(200, out);
    } catch (err) {
      if (err instanceof ApiError) return reply(err.status, errorBody(err));
      log("error", `${method} ${path} failed: ${err && err.stack ? err.stack : err}`);
      return reply(500, errorBody(new ApiError(500, "internal", "Something went wrong")));
    }
  }

  return { handle, service: svc };
}

module.exports = { createConfigApi, cspReportLines };
