"use strict";
// PH session exchange: turns the Personalisation Hub session the editor is
// embedded in into a short-lived editor session.
//
//   POST /api/auth/ph-session  { token, host? }  ->  { ok, session }
//
// `token` is the signed-in user's PH session token, handed to the editor by
// the PH page that embeds it (window.postMessage, never a URL). It is an
// HS256 token only PH can verify, so this asks PH who it belongs to:
//
//   HQ Admin      GET {base}/auth-api/v1/me                 -> { email, id, role }
//   Retail Admin  GET {base}/retail-admin-api/v1/me/store   -> { dealer_code, glb_store_code, ... }
//
// PH's two APIs do not accept each other's tokens (checked on
// ph.mipharmacy.net, 21 Nov 2026), so which API answers 200 decides the role;
// `host` only says which to try first. The result is minted by `mint` (a
// Firebase custom token) with these claims:
//
//   HQ user      { ph: true, admin: true,  stores: [],            sx }
//   store user   { ph: true, admin: false, stores: ["VIC-MP-003"], sx }
//
// `sx` (seconds since epoch) is when the editor session ends: the PH token's
// own expiry, capped at maxSessionMs. Both APIs refuse a session past it
// (src/auth.js, config-api/src/adapters/auth.js), so a Firebase ID token
// refreshed in the browser cannot outlive the PH sign-in for long.
//
// The PH token is never stored, logged or returned.

const HOSTS = ["hq-admin", "retail-admin"];
const TOKEN_RE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const STORE_CODE_RE = /^[A-Za-z0-9_-]{1,64}$/;

class SessionError extends Error {
  constructor(status, code, message, headers) {
    super(message);
    this.status = status;
    this.code = code;
    this.headers = headers;
  }
}

// The token's own claims, read only AFTER PH accepted it (never trusted
// before that): the expiry and a stable user id for the audit log.
function payloadOf(token) {
  try {
    const json = Buffer.from(token.split(".")[1], "base64url").toString("utf8");
    const p = JSON.parse(json);
    return p && typeof p === "object" ? p : {};
  } catch {
    return {};
  }
}

function createPhSessionService({
  settings,
  mint,
  fetchImpl = globalThis.fetch,
  logger,
  now = () => Date.now(),
  timeoutMs = 8000,
  hqRoles = ["ADMIN"],
  maxSessionMs = 8 * 3600 * 1000,
  perClientLimit = 30,
  rateLimiter,
}) {
  const roles = new Set(hqRoles.map((r) => String(r).toUpperCase()));
  const limiter = rateLimiter || null;

  // -> { status, data } ; status 0 = PH could not be reached.
  async function ask(baseUrl, path, token) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await fetchImpl(`${baseUrl}${path}`, {
        method: "GET",
        headers: { accept: "application/json", authorization: `Bearer ${token}` },
        signal: ctl.signal,
        redirect: "error",
      });
      let json = null;
      try {
        json = await res.json();
      } catch {
        json = null;
      }
      return { status: res.status, data: json && typeof json === "object" ? json.data || json : null };
    } catch {
      return { status: 0, data: null };
    } finally {
      clearTimeout(timer);
    }
  }

  async function asHq(baseUrl, token) {
    const r = await ask(baseUrl, "/auth-api/v1/me", token);
    if (r.status !== 200 || !r.data) return { status: r.status };
    const role = String(r.data.role || "").toUpperCase();
    if (!roles.has(role)) return { status: 200, denied: "This Personalisation Hub account's role cannot open the editor" };
    return {
      status: 200,
      who: { kind: "hq", id: r.data.id, email: typeof r.data.email === "string" ? r.data.email : null, admin: true, stores: [] },
    };
  }

  async function asStore(baseUrl, token) {
    const r = await ask(baseUrl, "/retail-admin-api/v1/me/store", token);
    if (r.status !== 200 || !r.data) return { status: r.status };
    const code = [r.data.dealer_code, r.data.glb_store_code].map((v) => (typeof v === "string" ? v.trim() : "")).find((v) => STORE_CODE_RE.test(v));
    if (!code) return { status: 200, denied: "This store has no store code in Personalisation Hub" };
    return { status: 200, who: { kind: "store", id: payloadOf(token).user_id, email: null, admin: false, stores: [code] } };
  }

  async function exchange(body, { clientKey = "unknown" } = {}) {
    if (limiter) {
      const take = limiter.take(clientKey);
      if (!take.ok) throw new SessionError(429, "RATE_LIMITED", "Too many sign-in attempts. Try again shortly.", { "Retry-After": String(take.retryAfterSec) });
    }
    const token = body && typeof body.token === "string" ? body.token.trim() : "";
    if (!token || token.length > 4096 || !TOKEN_RE.test(token)) throw new SessionError(401, "PH_SESSION_REJECTED", "Personalisation Hub did not accept this session");
    if (logger && logger.addSecret) logger.addSecret(token);
    const host = body && HOSTS.includes(body.host) ? body.host : null;
    const order = host === "retail-admin" ? [asStore, asHq] : [asHq, asStore];

    const { baseUrls } = await settings.get();
    let unreachable = false;
    let denied = null;
    let who = null;
    outer: for (const baseUrl of baseUrls) {
      for (const check of order) {
        const r = await check(baseUrl, token);
        if (r.who) {
          who = r.who;
          break outer;
        }
        if (r.denied) denied = r.denied;
        else if (r.status === 0 || r.status >= 500) unreachable = true;
      }
      if (denied) break;
    }
    if (!who) {
      if (denied) throw new SessionError(403, "PH_ROLE_NOT_ALLOWED", denied);
      if (unreachable) throw new SessionError(502, "PH_UNREACHABLE", "Personalisation Hub could not be reached to check this session");
      throw new SessionError(401, "PH_SESSION_REJECTED", "Personalisation Hub did not accept this session");
    }

    const t = now();
    const exp = Number(payloadOf(token).exp);
    const until = Math.min(Number.isFinite(exp) && exp * 1000 > t ? exp * 1000 : t + maxSessionMs, t + maxSessionMs);
    const uidPart = String(who.id === undefined || who.id === null ? "" : who.id).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40) || "user";
    const uid = `ph-${who.kind}-${uidPart}`;
    const claims = { ph: true, admin: who.admin, stores: who.stores, sx: Math.floor(until / 1000) };
    if (who.email) claims.phEmail = who.email;
    let sessionToken;
    try {
      sessionToken = await mint(uid, claims);
    } catch (e) {
      if (logger) logger.error("[ph-session] could not mint a session token", e);
      throw new SessionError(503, "SESSION_SIGNING_FAILED", "The editor could not start a session. Tell an administrator.");
    }
    if (logger) logger.info("[ph-session] session started", JSON.stringify({ uid, role: who.kind, stores: who.stores }));
    return { token: sessionToken, role: who.kind, admin: who.admin, stores: who.stores, expiresAt: new Date(until).toISOString() };
  }

  return { exchange };
}

module.exports = { createPhSessionService, SessionError, HOSTS };
