"use strict";
// Cloud Functions (2nd gen) entry point for the PH API settings endpoints and
// the Location API proxy. One HTTPS function, `pharmacyScreenPhApi`, serves:
//   /api/settings/ph-api, /api/settings/ph-api/token   (admin)
//   /api/device/{UniqueDeviceID}/campaign_data          (screens)
//   /api/auth/ph-session                                (PH session -> editor session)
// Firebase Hosting rewrites those path prefixes to it (see README.md).
// The token is decrypted only here, in memory, per request.

const { onRequest } = require("firebase-functions/v2/https");
const { initializeApp, getApps } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { getAuth } = require("firebase-admin/auth");

const { createApi } = require("./src/create-api");
const { secretStoreFromEnv } = require("./src/secret-store");
const { firestoreSettingsStore, firestoreAuditLog } = require("./src/stores");
const { firebaseAuthAdapter } = require("./src/auth");
const { clientIpFromHeaders } = require("./src/client-ip");

let api = null;
function getApi() {
  if (api) return api;
  if (!getApps().length) initializeApp();
  const db = getFirestore();
  const env = process.env;
  api = createApi({
    env,
    settingsStore: firestoreSettingsStore({ db, docPath: env.PH_SETTINGS_DOC || "pharmacyScreen/private/settings/phApi" }),
    auditLog: firestoreAuditLog({ db, collectionPath: env.PH_AUDIT_COLLECTION || "pharmacyScreen/private/auditLog" }),
    secretStore: secretStoreFromEnv(env),
    auth: firebaseAuthAdapter({ auth: getAuth(), adminClaim: env.PH_ADMIN_CLAIM || "admin", requirePhSession: /^(1|true|yes)$/i.test(env.PH_REQUIRE_PH_SESSION || "") }),
    fetchImpl: globalThis.fetch,
    // PH session sign-in: a Firebase custom token carrying the role and
    // store claims (src/ph-session.js). Signing needs the function's service
    // account to hold roles/iam.serviceAccountTokenCreator on itself.
    mintSession: (uid, claims) => getAuth().createCustomToken(uid, claims),
  });
  return api;
}

exports.pharmacyScreenPhApi = onRequest({ region: process.env.PH_REGION || "us-central1", memory: "256MiB", concurrency: 80, maxInstances: 20 }, async (req, res) => {
  const out = await getApi().handle({
    method: req.method,
    path: req.path,
    headers: req.headers,
    body: req.body,
    // Not req.ip: that is the caller-written leftmost X-Forwarded-For entry
    // (src/client-ip.js explains which entry is trusted and why).
    ip: clientIpFromHeaders(req.headers, {
      trustedHops: process.env.PH_TRUSTED_PROXY_HOPS || 1,
      fallback: (req.socket && req.socket.remoteAddress) || "unknown",
    }),
  });
  res.status(out.status);
  for (const [k, v] of Object.entries(out.headers || {})) res.set(k, v);
  if (out.body === null || out.body === undefined) res.end();
  else res.send(JSON.stringify(out.body));
});
