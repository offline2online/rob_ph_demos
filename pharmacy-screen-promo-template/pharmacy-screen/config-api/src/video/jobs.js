"use strict";

// Download MP4 (admin editor → under the preview): an asynchronous job, because a render takes longer than either
// deployment lets one request run (Firebase Hosting's rewrites 60 s, API Gateway 30 s).
//
//   POST /api/admin/videos {pharmacyId, promotionId, orientation, occasion?}   201 {id, status: "queued", …}
//   GET  /api/admin/videos/{id}                                              {id, status, progress, fileName, url, error}
//
// status: queued → rendering → done (url: a short-lived download link) | failed (error: a plain message).
// One render at a time per deployment: a lease (collection videoLocks, doc "render") taken in the same transaction
// that creates the job and released when it ends; a second request meanwhile gets 429. The lease expires by itself
// (LEASE_MS) so a worker that died cannot block renders for ever. The worker (Firebase: a Cloud Tasks queue function,
// config-api/index.js; AWS: its own Lambda, aws/lambda/video-worker.js) runs runVideoJob() below.
//
// The video is made from the real screen page with the pharmacy's screen device ID (pharmacies.device), so its
// store name, opening hours and suburb come from Personalisation Hub through the PH API proxy exactly as on a
// screen; a pharmacy with no device ID cannot be exported (the button says so). It uses what is saved: the editor
// asks for unsaved changes to be saved first.

const { ApiError, bad } = require("../validate");
const { OCCASIONS } = require("../builtins");
const { MAX_SECONDS, videoFileName } = require("./format");

const JOBS = "videoJobs";
const LOCKS = "videoLocks";
const LOCK_ID = "render";
// The longest a render may hold the lease: the worker's own time limit (15 min on both deployments: AWS Lambda's
// limit, and timeoutSeconds 900 on Firebase's pharmacyScreenVideoWorker) and a margin, so a job that reads as failed
// is never still rendering. The editor stops waiting after the same time.
const LEASE_MS = 20 * 60 * 1000;
const OCCASION_NAMES = new Map(OCCASIONS);
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/** The job as the editor sees it: nothing about who asked or where the file is stored. */
function publicJob(id, j) {
  return {
    id,
    status: j.status,
    progress: j.status === "done" ? 1 : Math.max(0, Math.min(1, Number(j.progress) || 0)),
    orientation: j.orientation,
    seconds: j.seconds || null,
    fileName: j.status === "done" ? j.fileName : null,
    url: j.status === "done" ? j.url || null : null,
    error: j.status === "failed" ? j.error || "The video could not be made. Try again." : null,
  };
}

/**
 * screenPageUrl: the screen page the worker loads (this deployment's own pharmacy-screen.html); a string, or a
 * function returning one (the local dev server knows its port only once it listens).
 * dispatch(jobId): start the worker (a Cloud Tasks task, an asynchronous Lambda invoke); null when this deployment
 * has no worker, and then the endpoint answers 503.
 */
function createVideoJobs({ store, svc, screenPageUrl, dispatch, now = () => Date.now(), log = () => {} }) {
  const at = () => new Date(now()).toISOString();

  async function start(actor, body) {
    const pageBase = typeof screenPageUrl === "function" ? screenPageUrl() : screenPageUrl;
    if (!dispatch || !pageBase) throw new ApiError(503, "video-not-set-up", "Download MP4 is not set up on this deployment.");
    if (!body || typeof body !== "object") throw bad("Request body must be a JSON object");
    const orientation = body.orientation === "landscape" ? "landscape" : body.orientation === "portrait" ? "portrait" : null;
    if (!orientation) throw bad("orientation must be portrait or landscape");
    if (typeof body.pharmacyId !== "string" || !ID_RE.test(body.pharmacyId)) throw bad("pharmacyId is required");
    if (typeof body.promotionId !== "string" || !ID_RE.test(body.promotionId)) throw bad("promotionId is required");
    const occasion = body.occasion === undefined || body.occasion === null || body.occasion === "" ? "" : String(body.occasion);
    if (occasion && !OCCASION_NAMES.has(occasion)) throw bad(`occasion must be one of ${[...OCCASION_NAMES.keys()].join(", ")}`);
    const ph = await svc.getPharmacy(body.pharmacyId, actor);
    const promo = await svc.getPromotion(body.promotionId);
    if (!ph.device) throw new ApiError(409, "no-device", "Add this pharmacy's screen device ID in Settings first: the video uses its store's own name and opening hours from Personalisation Hub.");
    const q = new URLSearchParams({ device: ph.device, promo: promo.promoId, orientation, capture: "1" });
    if (occasion) q.set("occasion", occasion);
    const job = {
      status: "queued",
      progress: 0,
      pharmacyId: ph.id,
      storeCode: ph.storeCode,
      pharmacyName: ph.name,
      promotionId: promo.id,
      promotionName: occasion ? `${promo.name} ${OCCASION_NAMES.get(occasion)}` : promo.name,
      orientation,
      occasion: occasion || null,
      // What the job rendered from: the records' versions when it was asked for.
      pharmacyVersion: ph.version ?? null,
      promotionVersion: promo.version ?? null,
      url: null,
      pageUrl: `${pageBase}?${q}`,
      createdAt: at(),
      createdBy: (actor && (actor.email || actor.uid)) || null,
    };
    const id = await store.transaction(async (tx) => {
      const lock = await tx.get(LOCKS, LOCK_ID);
      if (lock && lock.until > now()) throw new ApiError(429, "video-busy", "A video is already being made. Try again in a minute.");
      const jobId = store.newId();
      tx.set(JOBS, jobId, job);
      tx.set(LOCKS, LOCK_ID, { jobId, until: now() + LEASE_MS });
      return jobId;
    });
    try {
      await dispatch(id);
    } catch (e) {
      log("error", `video job ${id} could not start: ${e && e.message}`);
      await finish(id, { status: "failed", error: "The video could not be started. Try again in a minute." });
      throw new ApiError(503, "video-not-started", "The video could not be started. Try again in a minute.");
    }
    return publicJob(id, job);
  }

  async function get(id) {
    if (!ID_RE.test(String(id || ""))) throw new ApiError(404, "not-found", "No such video");
    const j = await store.get(JOBS, id);
    if (!j) throw new ApiError(404, "not-found", "No such video");
    // A worker that died never writes its end: past the lease it reads as failed.
    if ((j.status === "queued" || j.status === "rendering") && Date.parse(j.createdAt) + LEASE_MS < now()) {
      return publicJob(id, { ...j, status: "failed", error: "The video took too long and was stopped. Try again." });
    }
    return publicJob(id, j);
  }

  /** Write the job's end and release the lease (if it is still this job's). */
  async function finish(id, fields) {
    await store.transaction(async (tx) => {
      const j = await tx.get(JOBS, id);
      const lock = await tx.get(LOCKS, LOCK_ID);
      if (j) tx.set(JOBS, id, { ...j, ...fields, finishedAt: at() });
      if (lock && lock.jobId === id) tx.delete(LOCKS, LOCK_ID);
    });
  }

  return { start, get, finish };
}

/**
 * The worker's whole job: read it, render it (render(job, onProgress) → {file, seconds}), store the file
 * (upload(job, file, fileName) → {url}), and write how it ended. Never throws: a failure is written on the job.
 */
async function runVideoJob(jobId, { store, render, upload, now = () => Date.now(), log = () => {} }) {
  const jobs = createVideoJobs({ store, now });
  const j = await store.get(JOBS, jobId);
  if (!j || j.status !== "queued") return { skipped: true };
  let lastWrite = 0;
  const progress = async (p) => {
    if (now() - lastWrite < 1000 && p < 1) return;
    lastWrite = now();
    const cur = await store.get(JOBS, jobId);
    await store.transaction(async (tx) => { tx.set(JOBS, jobId, { ...cur, status: "rendering", progress: Math.round(p * 100) / 100 }); });
  };
  try {
    await progress(0);
    const { file, seconds } = await render(j, progress);
    const fileName = videoFileName({ pharmacy: j.pharmacyName, promotion: j.promotionName, orientation: j.orientation, seconds });
    const { url } = await upload(j, file, fileName, jobId);
    await jobs.finish(jobId, { status: "done", progress: 1, seconds, fileName, url });
    return { ok: true, fileName };
  } catch (e) {
    const plain = e && e.code && typeof e.message === "string" && e.constructor && e.constructor.name === "VideoError";
    // The system's own reason (ffmpeg's ENOENT, its exit code and stderr tail) goes in the log and on the stored job
    // (errorDetail, never in publicJob), so an administrator can see why without the editor showing internals.
    const detail = String((e && (e.detail || e.message)) || e).slice(0, 1000);
    log("error", `video job ${jobId} failed: ${detail}`);
    await jobs.finish(jobId, { status: "failed", error: plain ? e.message : "The video could not be made. Try again.", errorDetail: detail });
    return { ok: false };
  }
}

module.exports = { createVideoJobs, runVideoJob, publicJob, JOBS, LOCKS, LEASE_MS, MAX_SECONDS };
