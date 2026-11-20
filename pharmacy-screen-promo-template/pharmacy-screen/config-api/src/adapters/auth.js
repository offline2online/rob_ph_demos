"use strict";

// Who is calling. Contract:
//
//   auth.identify(authorizationHeader) -> { uid, email, admin, stores, ph } | null
//
// null means no or invalid credentials (401). A valid caller without the
// admin role gets admin: false: 403 on every admin endpoint, except that a
// store user (stores: ["VIC-MP-003"], from a Personalisation Hub Retail Admin
// session; ph-proxy/src/ph-session.js) may read and edit their own
// pharmacies' overrides (src/api.js -> "store"). An AWS
// deployment adds a Cognito / OIDC adapter with the same one method.

function bearer(header) {
  const m = /^Bearer\s+(.+)$/i.exec(String(header || "").trim());
  return m ? m[1].trim() : null;
}

// Firebase Auth: a Firebase ID token whose custom claim `claim` (default
// "admin") is true. Set the claim with the Admin SDK
// (scripts/set-admin-claim.js); it reaches the user's token on their next
// sign-in or token refresh.
//
// A session started from Personalisation Hub carries ph: true, stores and sx
// (the second it ends); one past its sx is refused. requirePhSession: true
// refuses every other sign-in. Keep in step with ph-proxy/src/auth.js.
function actorFromClaims(decoded, { claim = "admin", requirePhSession = false, now = () => Date.now() } = {}) {
  const ph = decoded.ph === true;
  if (requirePhSession && !ph) return null;
  if (ph && !(Number(decoded.sx) * 1000 > now())) return null;
  const stores = ph && Array.isArray(decoded.stores) ? decoded.stores.filter((s) => typeof s === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(s)) : [];
  return { uid: decoded.uid, email: decoded.email || decoded.phEmail || null, admin: decoded[claim] === true, stores, ph };
}

function createFirebaseAuth(adminAuth, { claim = "admin", requirePhSession = false, now } = {}) {
  return {
    kind: "firebase",
    identify: async (header) => {
      const token = bearer(header);
      if (!token) return null;
      try {
        const decoded = await adminAuth.verifyIdToken(token, true);
        return actorFromClaims(decoded, { claim, requirePhSession, now });
      } catch {
        return null;
      }
    },
  };
}

// Fixed tokens, for tests and the local dev server only:
// { "<token>": { uid, email, admin, stores } }. Never used in a deployment.
function createStaticAuth(tokens) {
  const map = new Map(Object.entries(tokens || {}));
  return {
    kind: "static",
    identify: async (header) => {
      const token = bearer(header);
      const who = token && map.get(token);
      return who ? { uid: who.uid, email: who.email || null, admin: who.admin === true, stores: Array.isArray(who.stores) ? who.stores.slice() : [], ph: who.ph === true } : null;
    },
  };
}

module.exports = { createFirebaseAuth, createStaticAuth, actorFromClaims, bearer };
