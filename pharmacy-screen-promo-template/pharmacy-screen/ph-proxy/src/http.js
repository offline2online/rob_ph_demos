"use strict";
// Framework-free HTTP layer. handle({ method, path, headers, body, ip })
// resolves to { status, headers, body } so the same routes run on Cloud
// Functions (index.js), an AWS Lambda handler or a test without a server.
//
//   GET    /api/settings/ph-api                       admin  -> settings (token: set + last4 only)
//   PUT    /api/settings/ph-api   {baseUrls?, token?}  admin  -> save / replace (audit-logged)
//   DELETE /api/settings/ph-api/token                  admin  -> remove the token (audit-logged)
//   GET    /api/device/{UniqueDeviceID}/campaign_data  public -> trimmed store data via the proxy
//   POST   /api/auth/ph-session   {token, host?}        PH session -> editor session (src/ph-session.js)
//
// Error bodies are always { ok: false, error: { code, message } }.

const { SettingsError } = require("./settings-service");
const { SessionError } = require("./ph-session");

const SETTINGS_PATH = "/api/settings/ph-api";
const TOKEN_PATH = "/api/settings/ph-api/token";
const SESSION_PATH = "/api/auth/ph-session";
const DEVICE_PATH = /^\/api\/device\/([^/]*)\/campaign_data\/?$/;

function err(status, code, message, headers) {
  return { status, headers: headers || {}, body: { ok: false, error: { code, message } } };
}

function createHttpHandler({ settings, proxy, auth, logger, allowedOrigins = [], phSession = null }) {
  const origins = new Set(allowedOrigins.filter(Boolean));

  const cors = (origin, isPublic) => {
    if (isPublic) return { "Access-Control-Allow-Origin": origins.size && origin && origins.has(origin) ? origin : "*", Vary: "Origin" };
    if (origin && origins.has(origin)) {
      return { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Credentials": "true", Vary: "Origin" };
    }
    return { Vary: "Origin" };
  };

  async function requireAdmin(headers) {
    const actor = await auth.verify(headers);
    if (!actor) return { error: err(401, "UNAUTHENTICATED", "Sign in required") };
    if (!actor.admin) return { error: err(403, "FORBIDDEN", "Admin role required") };
    return { actor };
  }

  async function route({ method, path, headers, body, ip }) {
    const p = String(path || "").split("?")[0].replace(/\/+$/, "") || "/";
    const m = DEVICE_PATH.exec(p);
    if (m) {
      if (method !== "GET") return err(405, "METHOD_NOT_ALLOWED", "Use GET");
      let udid;
      try {
        udid = decodeURIComponent(m[1]);
      } catch {
        udid = "";
      }
      return proxy.getCampaignData(udid, { clientKey: ip || "unknown" });
    }
    if (p === SESSION_PATH) {
      if (!phSession) return err(404, "NOT_FOUND", "No such endpoint");
      if (method !== "POST") return err(405, "METHOD_NOT_ALLOWED", "Use POST");
      let json = body;
      if (Buffer.isBuffer(json)) json = json.toString("utf8");
      if (typeof json === "string") {
        try {
          json = JSON.parse(json);
        } catch {
          json = null;
        }
      }
      try {
        return { status: 200, body: { ok: true, session: await phSession.exchange(json, { clientKey: ip || "unknown" }) } };
      } catch (e) {
        if (e instanceof SessionError) return err(e.status, e.code, e.message, e.headers);
        throw e;
      }
    }
    if (p === SETTINGS_PATH || p === TOKEN_PATH) {
      const gate = await requireAdmin(headers);
      if (gate.error) return gate.error;
      try {
        if (p === SETTINGS_PATH && method === "GET") return { status: 200, body: { ok: true, settings: await settings.get() } };
        if (p === SETTINGS_PATH && (method === "PUT" || method === "POST")) return { status: 200, body: { ok: true, settings: await settings.save(body, gate.actor) } };
        if (p === TOKEN_PATH && method === "DELETE") return { status: 200, body: { ok: true, settings: await settings.removeToken(gate.actor) } };
        return err(405, "METHOD_NOT_ALLOWED", "Method not allowed");
      } catch (e) {
        if (e instanceof SettingsError) return err(e.status, e.code, e.message);
        throw e;
      }
    }
    return err(404, "NOT_FOUND", "No such endpoint");
  }

  return async function handle(req) {
    const headers = req.headers || {};
    const origin = headers.origin || headers.Origin || null;
    const isPublic = DEVICE_PATH.test(String(req.path || "").split("?")[0]);
    const base = { ...cors(origin, isPublic), "Cache-Control": "no-store", "Content-Type": "application/json; charset=utf-8", "X-Content-Type-Options": "nosniff" };
    if (req.method === "OPTIONS") {
      return {
        status: 204,
        headers: { ...base, "Access-Control-Allow-Methods": isPublic ? "GET, OPTIONS" : "GET, PUT, POST, DELETE, OPTIONS", "Access-Control-Allow-Headers": "Authorization, Content-Type", "Access-Control-Max-Age": "600" },
        body: null,
      };
    }
    let res;
    try {
      res = await route({ ...req, headers });
    } catch (e) {
      logger.error("[ph-api] unhandled", req.method, String(req.path || "").split("?")[0], e);
      res = err(500, "INTERNAL", "Unexpected error");
    }
    return { status: res.status, headers: { ...base, ...(res.headers || {}) }, body: res.body };
  };
}

module.exports = { createHttpHandler };
