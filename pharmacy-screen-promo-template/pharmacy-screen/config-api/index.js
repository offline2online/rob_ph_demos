"use strict";

// Cloud Functions (2nd gen) entry for our test environment, Firebase project
// rob-ph-demos. It only wires the Firebase adapters into the
// framework-neutral API; nothing here is API logic. An AWS deployment adds
// its own entry (Lambda handler) wiring DynamoDB/S3/Cognito adapters into the
// same createConfigApi().
//
// Configuration (all non-secret; see README.md → "Configuration"):
//   PS_ADMIN_CLAIM       custom claim that marks an admin        (default "admin")
//   PS_ALLOWED_ORIGINS   comma-separated origins for admin CORS  (default none)
//   PS_MEDIA_BUCKET      Cloud Storage bucket for logos/backgrounds, its own
//                        bucket so rules/storage.rules never replaces the
//                        default bucket's (default "<project>-pharmacy-screen-media")
//   PS_FIRESTORE_ROOT    top-level collection                    (default "pharmacyScreen")
//   PS_REGION            function region                         (default "us-central1", like ph-proxy/)

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
    auth: createFirebaseAuth(getAuth(), { claim: env.PS_ADMIN_CLAIM || "admin" }),
    allowedOrigins: String(env.PS_ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()),
    // Never log request bodies or headers: an Authorization header is a
    // credential. Only the route and the error.
    log: (level, msg) => (level === "error" ? logger.error(msg) : logger.warn(msg)),
  });
  handler = toNodeHandler(api);
  return handler;
}

exports.pharmacyScreenConfigApi = onRequest(
  { region: process.env.PS_REGION || "us-central1", memory: "256MiB", timeoutSeconds: 60, maxInstances: 10 },
  (req, res) => getHandler()(req, res)
);
