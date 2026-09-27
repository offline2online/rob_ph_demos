// Shared, pure "is this project's deployment train actually empty" logic —
// required by BOTH functions/index.js (a Cloud Function trigger reacting
// to backlogItems writes) and scripts/run-backlog-automation.js (a
// periodic sweep that can also do the git work a Cloud Function can't).
// No Firebase SDK, no git, no network — plain data in, plain answers out —
// specifically so it can be unit-tested with nothing but `node` (see
// test/train-lock.test.js).
//
// Background — the bug this exists to fix ("Ready for Dev CTA stays
// hidden after all train tickets are deleted (stuck trainLocked)"):
// projects/{id}.trainLocked latches true on the first approval
// (public/js/app.js's deployToFeature()) and, before this file existed,
// only ever cleared on a successful merge
// (scripts/run-backlog-automation.js's finishTrain()/reconcileMergedTrains()).
// Deleting every ticket that had been approved for deployment — or
// rejecting them all via "Failed testing", which reverts their commits off
// the branch — empties the train without ever merging anything, so the
// lock (and the "Ready for Dev"/"Groom Backlog" CTAs it hides, per
// isTrainLocked() in app.js) got stuck forever, with no ticket left in
// Ready for Testing or Approved for Deployment for Deploy to Main to act
// on either. See backlog-tracker/README.md and REQUIREMENTS.md → "The
// deployment train" for the full lifecycle this plugs a gap in.
"use strict";

// Statuses that put a card ON its project's integration branch, per
// public/js/app.js's own trainItemsForProject(): it has a real commit
// there AND is either still being tested or already approved to ship.
const ON_TRAIN_STATUSES = new Set(["ready-for-testing", "ready-to-publish"]);

// True if this backlogItems doc (plain data — before/after a write, or a
// doc read straight off a query) currently occupies its project's train,
// in the sense that matters for the lock: merging the branch right now
// would ship it, OR it's still waiting to come off the branch.
//
// Mirrors app.js's trainItemsForProject() (the first branch) and
// pendingTrainRevertsForProject() (the second): a card sent back with
// "Failed testing" writes revertRequested, but its commit does not
// actually leave the branch until run-backlog-automation.js's
// processRevertFromTrain finishes — successfully (both fields clear
// together) or blocked by a later ticket built on top of it
// (revertRequested stays true). Either way the branch still carries
// unapproved work until that resolves, so the train is not empty yet.
function isTrainRelevantItem(item) {
  if (!item) return false;
  if (item.deployCommit && ON_TRAIN_STATUSES.has(item.status)) return true;
  if (item.revertRequested && item.deployCommit) return true;
  return false;
}

// Train states that mean a deploy/merge is genuinely in flight for this
// project right now (processDeployTrain's own "deploying" while it merges
// main in, opens/updates the PR and waits on CI; "awaiting-human-merge"
// while a workflow-file-touching PR sits open for a person — see
// reconcileMergedTrains). Never race either of those by unlocking
// underneath them; they resolve through their own paths.
const IN_FLIGHT_TRAIN_STATUSES = new Set(["deploying", "awaiting-human-merge"]);

// The actual decision: given a project doc (plain data) and every
// backlogItems doc carrying that project's id (plain data, any order),
// should projects/{id}.trainLocked be cleared right now?
//
// This is the single source of truth both call sites use — the Cloud
// Function trigger (an immediate, targeted reaction to one item's write)
// and the periodic sweep (a safety net, and the only place that can also
// reset/archive the branch) — so there is exactly one place that says
// what "the train is empty" means, not two copies that can drift apart.
function trainLockShouldClear(project, items) {
  if (!project || !project.trainLocked) return false;
  if (IN_FLIGHT_TRAIN_STATUSES.has(project.trainStatus)) return false;
  return !(Array.isArray(items) ? items : []).some(isTrainRelevantItem);
}

// ── Handing the train over when the Deploy Routine can't ──────────────────
// A Deploy to Main click fires the Routine, which verifies the train, does
// the FAQ impact review, and finally PATCHes projects/{id}.trainReady so the
// pipeline merges. On 25 Sep 2026 the Routine did all of that except the
// last write: its own session permission layer refused the PATCH
// ("Modify Shared Resources"), it reported deployRoutine.status "error"
// honestly, and the approved ticket sat in Approved for Deployment with
// nothing left to move it — a person had to run dsp-board.yml's train_ready
// by hand. The flag is the pipeline's to set whenever the Routine can't:
// processDeployTrain re-checks everything the Routine's steps 1–2 check
// (every ticket's commit is on the branch, nothing still in testing)
// before it merges, and the FAQ review never gated the merge anyway.
//
// Plain data in, a reason string (or null) out. Used by functions/index.js's
// onDeployRoutineSettled (the moment the Routine reports) and by
// run-backlog-automation.js's reconcileDeployRequests (the safety net for a
// Routine that never reports, or was never fired). `deployRequestHandledAt`
// is stamped by processDeployTrain the moment it consumes a request, so a
// click that was already merged or refused is never handed over again.
const DEPLOY_ROUTINE_ABANDONED_MS = 25 * 60 * 1000; // the board treats the Routine as stale after 20
const DEPLOY_FIRE_GRACE_MS = 5 * 60 * 1000;

function toMillis(v) {
  if (!v) return 0;
  if (typeof v.toMillis === "function") return v.toMillis();
  if (typeof v.toDate === "function") return v.toDate().getTime();
  if (v instanceof Date) return v.getTime();
  if (typeof v === "number") return v;
  if (typeof v === "string") { const t = Date.parse(v); return Number.isNaN(t) ? 0 : t; }
  if (typeof v === "object" && typeof v.seconds === "number") return v.seconds * 1000;
  return 0;
}

// Never lets a Routine's free text carry a token or a URL onto the board.
function briefError(message) {
  return String(message || "").replace(/https?:\/\/\S+/g, "<url>").replace(/[A-Za-z0-9_-]{28,}/g, "…").slice(0, 200);
}

function trainHandoverReason(project, nowMs) {
  if (!project) return null;
  if (project.trainReady === true) return null;
  if (IN_FLIGHT_TRAIN_STATUSES.has(project.trainStatus)) return null;
  const requestedAt = toMillis(project.deployNotifyRequestedAt);
  if (!requestedAt) return null;
  if (toMillis(project.deployRequestHandledAt) >= requestedAt) return null;
  const now = typeof nowMs === "number" ? nowMs : Date.now();
  const routine = project.deployRoutine || null;
  if (!routine || toMillis(routine.firedAt) < requestedAt) {
    // Nothing was fired for this click yet (no credentials, or the fire is
    // still being set up): give it a few minutes, then deploy anyway.
    return now - requestedAt >= DEPLOY_FIRE_GRACE_MS
      ? "no Deploy Routine run was recorded for this Deploy to Main click"
      : null;
  }
  if (routine.status === "done" || routine.status === "error") {
    return `the Deploy Routine reported "${routine.status}" without setting trainReady` +
      (routine.errorMessage ? ` — ${briefError(routine.errorMessage)}` : "");
  }
  if (routine.status === "in-progress" && now - toMillis(routine.firedAt) >= DEPLOY_ROUTINE_ABANDONED_MS) {
    return "the Deploy Routine never reported back";
  }
  return null;
}

module.exports = {
  ON_TRAIN_STATUSES,
  IN_FLIGHT_TRAIN_STATUSES,
  DEPLOY_ROUTINE_ABANDONED_MS,
  DEPLOY_FIRE_GRACE_MS,
  isTrainRelevantItem,
  trainLockShouldClear,
  trainHandoverReason,
  toMillis,
};
