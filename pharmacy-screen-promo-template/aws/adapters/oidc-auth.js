"use strict";

// Admin sign-in for the AWS deployment: an OpenID Connect ID token from
// Amazon Cognito (the default) or the retailer's own identity provider,
// sent as `Authorization: Bearer <ID token>`. Verified here with node:crypto
// against the issuer's published keys (JWKS); no library, no network call per
// request once the keys are cached.
//
// One verifier serves both back ends' auth contracts:
//   identify(authorizationHeader) -> { uid, email, admin } | null   config-api (src/adapters/auth.js)
//   verify(headers)               -> { uid, email, admin } | null   ph-proxy (src/auth.js)
// null = no or invalid token (401); admin false = signed in without the role (403).
//
// A token is accepted only when: its signature verifies with a key from the
// issuer's JWKS (RS256/384/512, ES256/384; never "none" or HMAC), `iss` is the
// configured issuer, `aud` includes the configured client id, it has not
// expired (60 s clock skew), and, when it says what it is (`token_use`,
// Cognito), it is an ID token.
//
// The admin role is a claim, never a list of addresses: `adminClaim` (Cognito:
// "cognito:groups", the default) must be true, equal `adminValue` (default
// "admin") or be a list / space- or comma-separated string holding it.

const crypto = require("node:crypto");

const ALGS = {
  RS256: { hash: "sha256", kty: "RSA" },
  RS384: { hash: "sha384", kty: "RSA" },
  RS512: { hash: "sha512", kty: "RSA" },
  ES256: { hash: "sha256", kty: "EC", ieee: true },
  ES384: { hash: "sha384", kty: "EC", ieee: true },
};
const SKEW_S = 60;

const b64json = (s) => JSON.parse(Buffer.from(s, "base64url").toString("utf8"));

function bearer(header) {
  const m = /^Bearer\s+(.+)$/i.exec(String(header || "").trim());
  return m ? m[1].trim() : null;
}

function isAdmin(value, adminValue) {
  if (value === true) return true;
  if (Array.isArray(value)) return value.map(String).includes(adminValue);
  if (typeof value === "string") return value === adminValue || value.split(/[\s,]+/).includes(adminValue);
  return false;
}

function createOidcAuth({
  issuer,
  audience,
  jwksUri,
  adminClaim = "cognito:groups",
  adminValue = "admin",
  fetchImpl = globalThis.fetch,
  now = () => Date.now(),
  jwksTtlMs = 6 * 3600 * 1000,
  refetchGapMs = 60 * 1000,
  log = () => {},
} = {}) {
  if (!issuer || !audience) throw new Error("oidc-auth: issuer and audience (the app client id) are required");
  const iss = String(issuer).replace(/\/+$/, "");
  const audiences = new Set(String(audience).split(",").map((s) => s.trim()).filter(Boolean));
  let keys = null; // Map kid -> KeyObject (+ jwk.alg)
  let fetchedAt = 0;
  let inflight = null;

  async function jwksUrl() {
    if (jwksUri) return jwksUri;
    const res = await fetchImpl(`${iss}/.well-known/openid-configuration`);
    if (!res.ok) throw new Error(`discovery returned ${res.status}`);
    const doc = await res.json();
    if (!doc.jwks_uri) throw new Error("discovery has no jwks_uri");
    jwksUri = doc.jwks_uri;
    return jwksUri;
  }

  async function loadKeys() {
    const res = await fetchImpl(await jwksUrl());
    if (!res.ok) throw new Error(`JWKS returned ${res.status}`);
    const { keys: list = [] } = await res.json();
    const map = new Map();
    for (const jwk of list) {
      if (!jwk.kid || (jwk.use && jwk.use !== "sig")) continue;
      try {
        map.set(jwk.kid, { key: crypto.createPublicKey({ key: jwk, format: "jwk" }), alg: jwk.alg || null, kty: jwk.kty });
      } catch {
        /* a key this runtime can't use is skipped */
      }
    }
    keys = map;
    fetchedAt = now();
    return map;
  }

  async function keyFor(kid) {
    const stale = !keys || now() - fetchedAt > jwksTtlMs;
    if (!stale && keys.has(kid)) return keys.get(kid);
    // Unknown kid: the issuer may have rotated. Refetch, at most once a minute.
    if (!stale && now() - fetchedAt < refetchGapMs) return null;
    inflight = inflight || loadKeys().finally(() => (inflight = null));
    try {
      return (await inflight).get(kid) || null;
    } catch (e) {
      log("warn", `oidc-auth: could not load signing keys (${e.message})`);
      return keys ? keys.get(kid) || null : null;
    }
  }

  async function verifyToken(token) {
    if (typeof token !== "string") return null;
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    let header, claims;
    try {
      header = b64json(parts[0]);
      claims = b64json(parts[1]);
    } catch {
      return null;
    }
    const alg = ALGS[header.alg];
    if (!alg || !header.kid) return null;
    const k = await keyFor(header.kid);
    if (!k || k.kty !== alg.kty || (k.alg && k.alg !== header.alg)) return null;
    const ok = crypto.verify(
      alg.hash,
      Buffer.from(`${parts[0]}.${parts[1]}`),
      alg.ieee ? { key: k.key, dsaEncoding: "ieee-p1363" } : k.key,
      Buffer.from(parts[2], "base64url")
    );
    if (!ok) return null;
    const t = Math.floor(now() / 1000);
    if (String(claims.iss || "").replace(/\/+$/, "") !== iss) return null;
    const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!aud.some((a) => audiences.has(a))) return null;
    if (typeof claims.exp !== "number" || claims.exp + SKEW_S < t) return null;
    if (typeof claims.nbf === "number" && claims.nbf - SKEW_S > t) return null;
    if (claims.token_use !== undefined && claims.token_use !== "id") return null;
    if (!claims.sub) return null;
    return claims;
  }

  async function actorFrom(token) {
    const claims = await verifyToken(token);
    if (!claims) return null;
    return { uid: claims.sub, email: claims.email || null, admin: isAdmin(claims[adminClaim], adminValue) };
  }

  return {
    kind: "oidc",
    verifyToken,
    identify: (authorizationHeader) => actorFrom(bearer(authorizationHeader)),
    verify: (headers) => actorFrom(bearer(headers && (headers.authorization || headers.Authorization))),
  };
}

// From the functions' environment (set by the CDK stack, infra/stack.js).
function oidcAuthFromEnv(env = process.env, deps = {}) {
  return createOidcAuth({
    issuer: env.PS_OIDC_ISSUER,
    audience: env.PS_OIDC_AUDIENCE,
    jwksUri: env.PS_OIDC_JWKS_URI || undefined,
    adminClaim: env.PS_ADMIN_CLAIM || "cognito:groups",
    adminValue: env.PS_ADMIN_VALUE || "admin",
    ...deps,
  });
}

module.exports = { createOidcAuth, oidcAuthFromEnv, isAdmin, bearer };
