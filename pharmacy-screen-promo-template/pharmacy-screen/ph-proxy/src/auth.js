"use strict";
// Auth adapter: turns a request's Authorization header into an actor.
//   verify(headers) -> { uid, email, admin } | null   (null = not signed in)
// Firebase Auth is our test environment's; an AWS deployment supplies the
// same function over Cognito / its OIDC provider. The admin role is a custom
// claim (PH_ADMIN_CLAIM, default "admin") — never a list of addresses.

function bearer(headers) {
  const h = headers && (headers.authorization || headers.Authorization);
  const m = typeof h === "string" ? /^Bearer\s+(.+)$/i.exec(h.trim()) : null;
  return m ? m[1] : null;
}

function firebaseAuthAdapter({ auth, adminClaim = "admin" }) {
  return {
    async verify(headers) {
      const token = bearer(headers);
      if (!token) return null;
      try {
        const decoded = await auth.verifyIdToken(token, true);
        return { uid: decoded.uid, email: decoded.email || null, admin: decoded[adminClaim] === true };
      } catch {
        return null;
      }
    },
  };
}

module.exports = { firebaseAuthAdapter, bearer };
