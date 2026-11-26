"use strict";

// Cloud Functions (2nd gen) entry for our test environment, Firebase project
// rob-ph-demos. It only wires the Firebase adapters into the
// framework-neutral API; nothing here is API logic. An AWS deployment adds
// its own entry (Lambda handler) wiring DynamoDB/S3/Cognito adapters into the
// same createConfigApi().
//
// Configuration (all non-secret; see README.md → "Configuration"):
//   PS_ADMIN_CLAIM       custom claim that marks an admin        (default "admin")
//   PS_REQUIRE_PH_SESSION  "true": accept only sessions started from Personalisation Hub
//                        (ph-proxy/src/ph-session.js); every other sign-in gets 401 (default off)
//   PS_ALLOWED_ORIGINS   comma-separated origins for admin CORS  (default none)
//   PS_MEDIA_BUCKET      Cloud Storage bucket for logos/backgrounds, its own
//                        bucket so rules/storage.rules never replaces the
//                        default bucket's (default "<project>-pharmacy-screen-media")
//   PS_FIRESTORE_ROOT    top-level collection                    (default "pharmacyScreen")
//   PS_REGION            function region                         (default "australia-southeast1", like ph-proxy/)
//   PS_MIN_INSTANCES     instances kept warm                     (default 0; above 0 is a monthly cost, owner's call)
//   PS_RATE_LIMIT_SCREENS_PER_IP_PER_MIN  GET /api/screens/** per client address per minute, per instance (default 600)
//   PS_TRUSTED_PROXY_HOPS  X-Forwarded-For entries our platform appends (default 1; src/rate-limit.js)

const { onRequest } = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");
const { initializeApp, getApps } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { getStorage } = require("firebase-admin/storage");
const { getAuth } = require("firebase-admin/auth");

const { createConfigApi } = require("./src/api");
const { toNodeHandler } = require("./src/http");
const { createFirestoreStore } = require("./src/adapters/firestore-store");
const { createGcsBlobs } = require("./src/adapters/blobs");
const { createFirebaseAuth } = require("./src/adapters/auth");
const { clientIpFromHeaders } = require("./src/rate-limit");

const count = (v, d) => (Number.isFinite(Number(v)) && Number(v) >= 0 && String(v).trim() !== "" ? Math.floor(Number(v)) : d);

let handler;
function getHandler() {
  if (handler) return handler;
  if (!getApps().length) initializeApp();
  const env = process.env;
  const project = env.GCLOUD_PROJECT || env.GOOGLE_CLOUD_PROJECT || "";
  const bucket = getStorage().bucket(env.PS_MEDIA_BUCKET || `${project}-pharmacy-screen-media`);
  const api = createConfigApi({
    store: createFirestoreStore(getFirestore(), { root: env.PS_FIRESTORE_ROOT || "pharmacyScreen" }),
    blobs: createGcsBlobs(bucket),
    auth: createFirebaseAuth(getAuth(), { claim: env.PS_ADMIN_CLAIM || "admin", requirePhSession: /^(1|true|yes)$/i.test(env.PS_REQUIRE_PH_SESSION || "") }),
    allowedOrigins: String(env.PS_ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()),
    // Never log request bodies or headers: an Authorization header is a
    // credential. Only the route and the error.
    log: (level, msg) => (level === "error" ? logger.error(msg) : logger.warn(msg)),
    screensPerClientLimit: count(env.PS_RATE_LIMIT_SCREENS_PER_IP_PER_MIN, 600),
  });
  // Not req.ip: the caller writes the leftmost X-Forwarded-For entry (src/rate-limit.js).
  handler = toNodeHandler(api, {
    clientIp: (req) => clientIpFromHeaders(req.headers, { trustedHops: env.PS_TRUSTED_PROXY_HOPS || 1, fallback: (req.socket && req.socket.remoteAddress) || "unknown" }),
  });
  return handler;
}

exports.pharmacyScreenConfigApi = onRequest(
  { region: process.env.PS_REGION || "australia-southeast1", memory: "256MiB", timeoutSeconds: 60, maxInstances: 10, minInstances: Math.min(count(process.env.PS_MIN_INSTANCES, 0), 10) },
  (req, res) => getHandler()(req, res)
);
