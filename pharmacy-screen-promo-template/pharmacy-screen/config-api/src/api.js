"use strict";

// The REST API, framework-neutral: createConfigApi(...) returns
//   handle({ method, path, headers, query, body }) -> { status, headers, body }
// where body in is a Buffer (or undefined) and body out is a JSON-able value
// or null. src/http.js adapts it to Node / Cloud Functions requests; an AWS
// Lambda adapter would map API Gateway events the same way.
//
// Routes (README.md → "API" has the full reference):
//   GET  /api/health
//   GET  /api/screens/{storeCode}[?promo=<promoId>]       public, published config only
//   /api/admin/...                                         admin role required
//     pharmacies, pharmacies/{id}, pharmacies/{id}/content/{promotionId}, pharmacies/{id}/logo
//     promotions, promotions/{id}
//     templates, templates/{id}, templates/{id}/clone, templates/{id}/backgrounds/{orientation}
//     services, services/{id}
//     audit

const { ApiError, bad } = require("./validate");
const { createConfigService } = require("./service");

const JSON_LIMIT = 2 * 1024 * 1024;

function createConfigApi({ store, blobs, auth, allowedOrigins = [], now, log = () => {} }) {
  const svc = createConfigService({ store, blobs, now, log });
  const origins = new Set(allowedOrigins.filter(Boolean));

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

  // ── dispatch ───────────────────────────────────────────────────────────
  const CREATED = Symbol("created");
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
      "Cache-Control": isPublic ? "public, max-age=15" : "no-store",
      ...corsHeaders(isPublic, headers.origin),
    };
    const reply = (status, body, extra = {}) => ({ status, headers: { ...base, ...extra }, body });

    if (method === "OPTIONS") {
      return reply(204, null, {
        "Access-Control-Allow-Methods": isPublic ? "GET, OPTIONS" : "GET, POST, PUT, PATCH, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": isPublic ? "Content-Type" : "Authorization, Content-Type, If-Match",
        "Access-Control-Max-Age": "600",
        "Cache-Control": "no-store",
      });
    }

    const matches = routes.filter((r) => r.re.test(path));
    if (!matches.length) return reply(404, errorBody(new ApiError(404, "not-found", `No route ${path}`)));
    const r = matches.find((m) => m.method === method);
    if (!r) return reply(405, errorBody(new ApiError(405, "method-not-allowed", `${method} is not allowed on ${path}`)), { Allow: matches.map((m) => m.method).join(", ") });

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
      const out = await r.handler({ actor, params, query, headers, body, json });
      if (out && out[CREATED]) return reply(201, out.value);
      return reply(200, out);
    } catch (err) {
      if (err instanceof ApiError) return reply(err.status, errorBody(err));
      log("error", `${method} ${path} failed: ${err && err.stack ? err.stack : err}`);
      return reply(500, errorBody(new ApiError(500, "internal", "Something went wrong")));
    }
  }

  return { handle, service: svc };
}

module.exports = { createConfigApi };
