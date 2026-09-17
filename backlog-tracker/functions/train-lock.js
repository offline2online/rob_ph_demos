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

module.exports = {
  ON_TRAIN_STATUSES,
  IN_FLIGHT_TRAIN_STATUSES,
  isTrainRelevantItem,
  trainLockShouldClear,
};
