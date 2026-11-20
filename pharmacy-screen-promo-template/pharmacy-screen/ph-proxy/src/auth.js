"use strict";
// Auth adapter: turns a request's Authorization header into an actor.
//   verify(headers) -> { uid, email, admin } | null   (null = not signed in)
// Firebase Auth is our test environment's; an AWS deployment supplies the
// same function over Cognito / its OIDC provider. The admin role is a custom
// claim (PH_ADMIN_CLAIM, default "admin") — never a list of addresses.
//
// A session started from Personalisation Hub (src/ph-session.js) carries
// ph: true, stores: [store codes] and sx, the second it ends; one past its sx
// is refused. requirePhSession: true refuses every other sign-in (the
// deployment has no sign-in of its own left).

// The session claims shared with config-api/src/adapters/auth.js (keep the two in step).
function actorFromClaims(decoded, { adminClaim = "admin", requirePhSession = false, now = () => Date.now() } = {}) {
  const ph = decoded.ph === true;
  if (requirePhSession && !ph) return null;
  if (ph && !(Number(decoded.sx) * 1000 > now())) return null;
  const stores = ph && Array.isArray(decoded.stores) ? decoded.stores.filter((s) => typeof s === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(s)) : [];
  return { uid: decoded.uid, email: decoded.email || decoded.phEmail || null, admin: decoded[adminClaim] === true, stores, ph };
}

function bearer(headers) {
  const h = headers && (headers.authorization || headers.Authorization);
  const m = typeof h === "string" ? /^Bearer\s+(.+)$/i.exec(h.trim()) : null;
  return m ? m[1] : null;
}

function firebaseAuthAdapter({ auth, adminClaim = "admin", requirePhSession = false, now }) {
  return {
    async verify(headers) {
      const token = bearer(headers);
      if (!token) return null;
      try {
        const decoded = await auth.verifyIdToken(token, true);
        return actorFromClaims(decoded, { adminClaim, requirePhSession, now });
      } catch {
        return null;
      }
    },
  };
}

module.exports = { firebaseAuthAdapter, actorFromClaims, bearer };
