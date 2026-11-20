"use strict";

// Who is calling. Contract:
//
//   auth.identify(authorizationHeader) -> { uid, email, admin } | null
//
// null means no or invalid credentials (401). A valid caller without the
// admin role gets admin: false (403 on every admin endpoint). An AWS
// deployment adds a Cognito / OIDC adapter with the same one method.

function bearer(header) {
  const m = /^Bearer\s+(.+)$/i.exec(String(header || "").trim());
  return m ? m[1].trim() : null;
}

// Firebase Auth: a Firebase ID token whose custom claim `claim` (default
// "admin") is true. Set the claim with the Admin SDK
// (scripts/set-admin-claim.js); it reaches the user's token on their next
// sign-in or token refresh.
function createFirebaseAuth(adminAuth, { claim = "admin" } = {}) {
  return {
    kind: "firebase",
    identify: async (header) => {
      const token = bearer(header);
      if (!token) return null;
      try {
        const decoded = await adminAuth.verifyIdToken(token, true);
        return { uid: decoded.uid, email: decoded.email || null, admin: decoded[claim] === true };
      } catch {
        return null;
      }
    },
  };
}

// Fixed tokens, for tests and the local dev server only:
// { "<token>": { uid, email, admin } }. Never used in a deployment.
function createStaticAuth(tokens) {
  const map = new Map(Object.entries(tokens || {}));
  return {
    kind: "static",
    identify: async (header) => {
      const token = bearer(header);
      const who = token && map.get(token);
      return who ? { uid: who.uid, email: who.email || null, admin: who.admin === true } : null;
    },
  };
}

module.exports = { createFirebaseAuth, createStaticAuth, bearer };
