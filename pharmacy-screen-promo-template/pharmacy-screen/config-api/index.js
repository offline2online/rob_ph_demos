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
//   PS_SCREEN_PAGE_URL   this site's screen page, which Download MP4 renders (src/video/); unset: Download MP4
//                        answers "not set up"
//
// Download MP4's worker, pharmacyScreenVideoWorker, is a Cloud Tasks queue function in the same codebase: the
// config API enqueues one task per video; the queue runs one at a time and never retries (src/video/jobs.js).

const { onRequest } = require("firebase-functions/v2/https");
const { onTaskDispatched } = require("firebase-functions/v2/tasks");
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
const { runVideoJob } = require("./src/video/jobs");
const { VideoError } = require("./src/video/render");

const REGION = process.env.PS_REGION || "australia-southeast1";
const VIDEO_WORKER = "pharmacyScreenVideoWorker";
// The worker's time limit: 15 minutes, as on AWS Lambda, inside the render lease (src/video/jobs.js LEASE_MS, 20 min).
const WORKER_SECONDS = 900;
// The download link on a finished job: a V4 signed URL that expires after an hour, as on AWS.
const LINK_SECONDS = 3600;

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
    video: {
      screenPageUrl: env.PS_SCREEN_PAGE_URL || "",
      dispatch: (jobId) => require("firebase-admin/functions").getFunctions()
        .taskQueue(`locations/${REGION}/functions/${VIDEO_WORKER}`)
        .enqueue({ jobId }, { dispatchDeadlineSeconds: WORKER_SECONDS }),
    },
  });
  // Not req.ip: the caller writes the leftmost X-Forwarded-For entry (src/rate-limit.js).
  handler = toNodeHandler(api, {
    clientIp: (req) => clientIpFromHeaders(req.headers, { trustedHops: env.PS_TRUSTED_PROXY_HOPS || 1, fallback: (req.socket && req.socket.remoteAddress) || "unknown" }),
  });
  return handler;
}

exports.pharmacyScreenConfigApi = onRequest(
  { region: REGION, memory: "256MiB", timeoutSeconds: 60, maxInstances: 10, minInstances: Math.min(count(process.env.PS_MIN_INSTANCES, 0), 10) },
  (req, res) => getHandler()(req, res)
);

// Download MP4's worker: renders one job (src/video/render.js: headless Chromium and ffmpeg, both from npm, loaded
// only here), puts the MP4 in the media bucket under exports/ and writes a one-hour signed download link on the job
// (signing needs Service Account Token Creator on the runtime service account, granted by the deploy's setup).
// The bucket's lifecycle rule (set by the deploy's setup) deletes exports after a day; exports older than a day are
// also deleted at the start of each run. One at a time, no retries, 15 minutes at most.
exports[VIDEO_WORKER] = onTaskDispatched(
  { region: REGION, memory: "4GiB", cpu: 2, timeoutSeconds: WORKER_SECONDS, maxInstances: 1, retryConfig: { maxAttempts: 1 }, rateLimits: { maxConcurrentDispatches: 1 } },
  async (req) => {
    if (!getApps().length) initializeApp();
    const env = process.env;
    const project = env.GCLOUD_PROJECT || env.GOOGLE_CLOUD_PROJECT || "";
    const bucket = getStorage().bucket(env.PS_MEDIA_BUCKET || `${project}-pharmacy-screen-media`);
    const store = createFirestoreStore(getFirestore(), { root: env.PS_FIRESTORE_ROOT || "pharmacyScreen" });
    const { cloudRender, removeFile } = require("./src/video/worker");
    await removeOldExports(bucket).catch((e) => logger.warn(`old exports not removed: ${e.message}`));
    await runVideoJob(String((req.data && req.data.jobId) || ""), {
      store,
      render: cloudRender(),
      upload: async (job, file, fileName, jobId) => {
        const path = `exports/${jobId}/${fileName}`;
        try {
          await bucket.upload(file, {
            destination: path,
            metadata: { contentType: "video/mp4", contentDisposition: `attachment; filename="${fileName}"`, cacheControl: "private, max-age=0" },
          });
        } finally {
          removeFile(file);
        }
        return { url: await signedLink(bucket.file(path), fileName) };
      },
      log: (level, msg) => (level === "error" ? logger.error(msg) : logger.warn(msg)),
    });
  }
);

// No Firebase download token: a token link never expires. A signed link that cannot be made (the runtime service
// account lacks Service Account Token Creator on itself) fails the job with a plain message rather than handing out
// a link that lives as long as the file.
async function signedLink(file, fileName) {
  try {
    const [url] = await file.getSignedUrl({ version: "v4", action: "read", expires: Date.now() + LINK_SECONDS * 1000, responseDisposition: `attachment; filename="${fileName}"` });
    return url;
  } catch (e) {
    logger.error(`video download link not signed: ${e.message}`);
    await file.delete().catch(() => {});
    throw new VideoError("not-signed", "The video was made but its download link could not be created. Ask an administrator to re-run the deploy's setup.");
  }
}

async function removeOldExports(bucket) {
  const [files] = await bucket.getFiles({ prefix: "exports/" });
  const cutoff = Date.now() - 24 * 3600 * 1000;
  await Promise.all(files.filter((f) => Date.parse(f.metadata.timeCreated) < cutoff).map((f) => f.delete().catch(() => {})));
}
