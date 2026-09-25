// A card whose content a SIBLING's commit delivered follows that train — it
// goes live when the train merges, never on approval.
//
// The bug (25 Sep 2026, Backlog Tracker & FAQs): a shared-file batch put two
// tickets' changes into one commit (419bb79, "Backlog item:
// ORUeAQ4b3vmv2EhEni5O"), so the second and third tickets' patchFiles
// produced no diff against deploy/backlog-tracker-faqs. processApplyPatch's
// no-diff path flagged those cards (OhKUnoGbpUAeJiXiLIvc, yUISCow4tCg9uxnMJFOy)
// `noDeploymentRequired: true` with no deployCommit — the board's "genuine
// live-data-only change" shape — which (a) took them out of every train
// count, and (b) gave them the one-click "Confirm tested — mark Merged to
// Main" (`confirmTestedNoDeploy()` in public/js/app.js). Both read "Deployed
// / Main Branch (Live)" while their code sat unmerged on the branch; PR #211
// merged it later, and the Deploy run flagged the mismatch on both cards.
//
// The rule now: such a card is stamped with the commit that carried it
// (deployCommit = the sibling's sha, plus carriedByCommit/carriedByItem), so
// every membership check — onTrainItems() here, isTrainRelevantItem() in
// functions/train-lock.js, the board's trainItemsForProject() — counts it on
// the train, and finishTrain() flips it live with the rest. It never gets
// noDeploymentRequired unless the branch does not change its files at all,
// i.e. the content really is already on main.
//
// Layers under test: the pure decision (noDiffPatchFields), the pure
// membership predicates (onTrainItems, isTrainRelevantItem, carriedCardsOn),
// and carryingCommitOnTrain() against a disposable local git repo pair —
// never the real origin. run-backlog-automation.js is require()d, which is
// safe because its main() is guarded behind `require.main === module`.
//
// Run with:  node test/train-carried.test.js
"use strict";
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const {
  onTrainItems, backlogItemIdFromMessage, carryingCommitOnTrain, noDiffPatchFields, carriedCardsOn,
} = require("../scripts/run-backlog-automation.js");
const { isTrainRelevantItem, trainLockShouldClear } = require("../functions/train-lock");

let passed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed += 1; console.log(`  ok  ${name}`); }
  catch (err) { failures.push([name, err]); console.log(`FAIL  ${name}\n      ${err && err.message}`); }
}

// The real shapes from the incident, as the automation saw them at 02:20.
const SIBLING_ID = "ORUeAQ4b3vmv2EhEni5O";
const SIBLING_SHA = "419bb79c0ffee0000000000000000000000000000";
const BRANCH = "deploy/backlog-tracker-faqs";
const carriedCard = { id: "OhKUnoGbpUAeJiXiLIvc", projectId: "oTcLAbnhUUO2S7NkbsuV", status: "backlog", patchReady: true };
const carrying = { sha: SIBLING_SHA, itemId: SIBLING_ID };

// ── backlogItemIdFromMessage ────────────────────────────────────────────

test("reads the `Backlog item:` trailer off a train commit message", () => {
  assert.strictEqual(backlogItemIdFromMessage(`Show running app version in project header\n\nBacklog item: ${SIBLING_ID}\n`), SIBLING_ID);
});

test("a revert commit, or a commit with no trailer, has no item id", () => {
  assert.strictEqual(backlogItemIdFromMessage(`Revert "Show running app version"\n\nThis reverts commit ${SIBLING_SHA}.\n`), null);
  assert.strictEqual(backlogItemIdFromMessage("hand-pushed fix"), null);
  assert.strictEqual(backlogItemIdFromMessage(""), null);
  assert.strictEqual(backlogItemIdFromMessage(null), null);
});

// ── noDiffPatchFields: the decision ─────────────────────────────────────

test("THE TICKET: no diff because a sibling's commit carried the change -> the card rides on that commit, NOT noDeploymentRequired", () => {
  const { kind, fields } = noDiffPatchFields(carriedCard, carrying, { deployBranch: BRANCH, testVersion: "1.5.76", previewUrl: "https://example.test/train" });
  assert.strictEqual(kind, "carried");
  assert.strictEqual(fields.status, "ready-for-testing");
  assert.strictEqual(fields.deployCommit, SIBLING_SHA, "deployCommit is the carrying commit, so every train count includes it");
  assert.strictEqual(fields.carriedByCommit, SIBLING_SHA);
  assert.strictEqual(fields.carriedByItem, SIBLING_ID);
  assert.strictEqual(fields.deployBranch, BRANCH);
  assert.strictEqual(fields.testVersion, "1.5.76");
  assert.strictEqual(fields.previewUrl, "https://example.test/train", "a carried card gets the train's test link like any other");
  assert.ok(!("noDeploymentRequired" in fields), "the flag that handed the card the one-click Merged to Main button is never written here");
  assert.ok(!("deployCommits" in fields), "the sibling's commit is not this card's to revert, so it is not in deployCommits");
  assert.strictEqual(fields.patchReady, false);
  assert.strictEqual(fields.revertRequested, false);
});

test("a carrying commit with no trailer (pushed by hand) still carries the card, with no sibling id", () => {
  const { kind, fields } = noDiffPatchFields(carriedCard, { sha: "abc1234abc1234abc1234abc1234abc1234abc12", itemId: null }, { deployBranch: BRANCH });
  assert.strictEqual(kind, "carried");
  assert.strictEqual(fields.deployCommit, "abc1234abc1234abc1234abc1234abc1234abc12");
  assert.strictEqual(fields.carriedByItem, null);
});

test("no diff and the branch does not change these files at all -> the content is already on main: the one honest noDeploymentRequired", () => {
  const { kind, fields } = noDiffPatchFields(carriedCard, null, { deployBranch: BRANCH, mainPreviewUrl: "https://example.test/main" });
  assert.strictEqual(kind, "already-on-main");
  assert.strictEqual(fields.noDeploymentRequired, true);
  assert.strictEqual(fields.status, "ready-for-testing");
  assert.strictEqual(fields.previewUrl, "https://example.test/main");
  assert.ok(!fields.deployCommit, "nothing on any train: the board's one-click completion is correct for this card");
  assert.ok(!("carriedByCommit" in fields));
});

test("a re-patch identical to what the card already put on the branch stays on its own commits", () => {
  const rePatched = { ...carriedCard, deployCommits: ["own1", "own2"], deployCommit: "own2" };
  const { kind, commits, adopted, fields } = noDiffPatchFields(rePatched, carrying, { deployBranch: BRANCH });
  assert.strictEqual(kind, "already-on-train");
  assert.strictEqual(adopted, false);
  assert.deepStrictEqual(commits, ["own1", "own2"]);
  assert.strictEqual(fields.status, "ready-for-testing");
  assert.ok(!("deployCommit" in fields) && !("carriedByCommit" in fields) && !("noDeploymentRequired" in fields),
    "its own commits are untouched — the sibling's commit is irrelevant to a card that has its own");
});

test("a hand-pushed commit carrying THIS card's own trailer is adopted as its train commit (CLAUDE.md: 'Putting a commit on a deployment train by hand')", () => {
  const handSha = "feedfacefeedfacefeedfacefeedfacefeedface";
  const { kind, adopted, fields } = noDiffPatchFields(carriedCard, { sha: handSha, itemId: carriedCard.id }, { deployBranch: BRANCH, previewUrl: "https://example.test/train" });
  assert.strictEqual(kind, "already-on-train");
  assert.strictEqual(adopted, true);
  assert.strictEqual(fields.deployCommit, handSha);
  assert.deepStrictEqual(fields.deployCommits, [handSha], "now revertable as its own commit, exactly as if the automation had made it");
  assert.strictEqual(fields.carriedByCommit, null);
  assert.strictEqual(fields.carriedByItem, null);
});

// ── Membership: why the old shape escaped every train check ─────────────

test("the OLD no-diff shape (noDeploymentRequired, no deployCommit) was invisible to every train count — which is how it went live on its own", () => {
  const oldShape = { ...carriedCard, status: "ready-for-testing", noDeploymentRequired: true, deployBranch: BRANCH };
  assert.deepStrictEqual(onTrainItems([oldShape]), []);
  assert.strictEqual(isTrainRelevantItem(oldShape), false);
});

test("the NEW shape is on the train in Ready for Testing and Approved for Deployment, so finishTrain() flips it live with the rest", () => {
  const { fields } = noDiffPatchFields(carriedCard, carrying, { deployBranch: BRANCH });
  const testing = { ...carriedCard, ...fields };
  const approved = { ...testing, status: "ready-to-publish" };
  const sibling = { id: SIBLING_ID, projectId: carriedCard.projectId, status: "ready-to-publish", deployCommit: SIBLING_SHA, deployCommits: [SIBLING_SHA] };
  assert.deepStrictEqual(onTrainItems([testing]).map((i) => i.id), [carriedCard.id]);
  // Exactly the set finishTrain() receives: the carried card and the ticket
  // it rides on ship together, or not at all.
  assert.deepStrictEqual(onTrainItems([sibling, approved]).map((i) => i.id).sort(), [SIBLING_ID, carriedCard.id].sort());
  assert.strictEqual(isTrainRelevantItem(testing), true);
  assert.strictEqual(isTrainRelevantItem(approved), true);
});

test("a carried card still in Ready for Testing keeps Deploy to Main hidden, same as any other untested ticket on the branch", () => {
  const { fields } = noDiffPatchFields(carriedCard, carrying, { deployBranch: BRANCH });
  const testing = { ...carriedCard, ...fields };
  const sibling = { id: SIBLING_ID, status: "ready-to-publish", deployCommit: SIBLING_SHA };
  const onTrain = onTrainItems([sibling, testing]);
  // app.js's deployNotifyButtonHTML rule: every train item must be approved.
  assert.strictEqual(onTrain.every((i) => i.status === "ready-to-publish"), false);
});

test("once live, a carried card is off the train like any other shipped ticket", () => {
  const live = { ...carriedCard, status: "published-live", deployCommit: SIBLING_SHA, carriedByCommit: SIBLING_SHA, carriedByItem: SIBLING_ID, mergeCommit: "m1" };
  assert.deepStrictEqual(onTrainItems([live]), []);
  assert.strictEqual(isTrainRelevantItem(live), false);
  assert.strictEqual(trainLockShouldClear({ trainLocked: true, trainStatus: "idle" }, [live]), true);
});

// ── Failed testing on a carried card, and on the ticket it rides on ─────

test("Failed testing on a carried card holds the train until the automation detaches it, then lets go", () => {
  const sentBack = { ...carriedCard, status: "backlog", revertRequested: true, deployCommit: SIBLING_SHA, carriedByCommit: SIBLING_SHA, carriedByItem: SIBLING_ID };
  // Between the click and processRevertFromTrain's run the card still counts
  // (pendingTrainRevertsForProject on the board, the same check here) — the
  // board must not offer Deploy to Main in that window.
  assert.strictEqual(isTrainRelevantItem(sentBack), true);
  // What processRevertFromTrain writes for a carried card: detached, nothing
  // reverted — the sibling's commit is not this card's to take off.
  const detached = { ...sentBack, revertRequested: false, revertBlockedBy: [], deployCommit: null, carriedByCommit: null, carriedByItem: null };
  assert.strictEqual(isTrainRelevantItem(detached), false);
  assert.strictEqual(trainLockShouldClear({ trainLocked: true, trainStatus: "idle" }, [detached]), true);
});

test("carriedCardsOn() names the cards that lose their content when a commit is reverted — on-train riders only", () => {
  const riderTesting = { id: "r1", status: "ready-for-testing", carriedByCommit: SIBLING_SHA };
  const riderApproved = { id: "r2", status: "ready-to-publish", carriedByCommit: SIBLING_SHA };
  const riderLive = { id: "r3", status: "published-live", carriedByCommit: SIBLING_SHA };
  const riderElsewhere = { id: "r4", status: "ready-for-testing", carriedByCommit: "other-sha" };
  const ownCommit = { id: "o1", status: "ready-for-testing", deployCommit: SIBLING_SHA, deployCommits: [SIBLING_SHA] };
  const items = [riderTesting, riderApproved, riderLive, riderElsewhere, ownCommit];
  assert.deepStrictEqual(carriedCardsOn(items, [SIBLING_SHA]).map((i) => i.id), ["r1", "r2"]);
  assert.deepStrictEqual(carriedCardsOn(items, []), []);
  assert.deepStrictEqual(carriedCardsOn(items, ["nope"]), []);
  assert.deepStrictEqual(carriedCardsOn(null, [SIBLING_SHA]), []);
});

// ── carryingCommitOnTrain against a real (disposable, local-only) repo ──

function sh(cwd, cmd, args) {
  return execFileSync(cmd, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function makeDisposableRepoPair() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "train-carried-test-"));
  const bareOrigin = path.join(root, "origin.git");
  const work = path.join(root, "work");
  fs.mkdirSync(bareOrigin);
  fs.mkdirSync(work);
  sh(bareOrigin, "git", ["init", "--bare", "--quiet"]);
  sh(work, "git", ["init", "--quiet", "-b", "main"]);
  sh(work, "git", ["config", "user.name", "test"]);
  sh(work, "git", ["config", "user.email", "test@example.com"]);
  fs.writeFileSync(path.join(work, "shared.js"), "v1\n");
  fs.writeFileSync(path.join(work, "untouched.txt"), "same on both\n");
  sh(work, "git", ["add", "-A"]);
  sh(work, "git", ["commit", "-m", "initial commit", "--quiet"]);
  sh(work, "git", ["remote", "add", "origin", bareOrigin]);
  sh(work, "git", ["push", "-u", "origin", "main", "--quiet"]);
  return { root, work };
}

function commitFile(work, file, content, message) {
  fs.writeFileSync(path.join(work, file), content);
  sh(work, "git", ["add", "-A"]);
  sh(work, "git", ["commit", "-m", message, "--quiet"]);
  return sh(work, "git", ["rev-parse", "HEAD"]);
}

test("carryingCommitOnTrain(): finds the sibling's commit (and its id) that delivered the shared file, and null for a file the train never changed", () => {
  const { root, work } = makeDisposableRepoPair();
  const originalCwd = process.cwd();
  const branch = "deploy/carried-project";
  try {
    sh(work, "git", ["checkout", "-b", branch, "--quiet"]);
    const siblingSha = commitFile(work, "shared.js", "v2 — both tickets' change\n", `Show running app version\n\nBacklog item: ${SIBLING_ID}`);
    sh(work, "git", ["push", "-u", "origin", branch, "--quiet"]);
    sh(work, "git", ["checkout", "main", "--quiet"]);

    process.chdir(work);
    assert.deepStrictEqual(carryingCommitOnTrain(branch, ["shared.js"]), { sha: siblingSha, itemId: SIBLING_ID });
    assert.strictEqual(carryingCommitOnTrain(branch, ["untouched.txt"]), null, "the train does not change it: the content is already on main");
    assert.strictEqual(carryingCommitOnTrain(branch, []), null);
    assert.strictEqual(carryingCommitOnTrain(branch, ["shared.js", "untouched.txt"]).sha, siblingSha, "any changed path is enough");
  } finally {
    process.chdir(originalCwd);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("carryingCommitOnTrain(): a reverted commit no longer carries anything; a later hand-pushed commit (no trailer) does, with no sibling id", () => {
  const { root, work } = makeDisposableRepoPair();
  const originalCwd = process.cwd();
  const branch = "deploy/carried-project";
  try {
    sh(work, "git", ["checkout", "-b", branch, "--quiet"]);
    const siblingSha = commitFile(work, "shared.js", "v2\n", `Sibling fix\n\nBacklog item: ${SIBLING_ID}`);
    sh(work, "git", ["revert", "--no-edit", siblingSha, "--quiet"]);
    sh(work, "git", ["push", "-u", "origin", branch, "--quiet"]);
    sh(work, "git", ["checkout", "main", "--quiet"]);
    process.chdir(work);
    // Sibling reverted: shared.js on the branch equals main again, so a
    // no-diff patch here means "already on main", not "carried".
    assert.strictEqual(carryingCommitOnTrain(branch, ["shared.js"]), null);
    process.chdir(originalCwd);

    sh(work, "git", ["checkout", branch, "--quiet"]);
    const handSha = commitFile(work, "shared.js", "v3 by hand\n", "hand-pushed fix with no trailer");
    // A second ticket's commit on top, itself reverted: the newest SURVIVING
    // commit is the hand-pushed one, not the revert and not the reverted.
    const laterSha = commitFile(work, "shared.js", "v4\n", "Ticket B\n\nBacklog item: TICKETB");
    sh(work, "git", ["revert", "--no-edit", laterSha, "--quiet"]);
    sh(work, "git", ["push", "origin", branch, "--quiet"]);
    sh(work, "git", ["checkout", "main", "--quiet"]);
    process.chdir(work);
    assert.deepStrictEqual(carryingCommitOnTrain(branch, ["shared.js"]), { sha: handSha, itemId: null });
  } finally {
    process.chdir(originalCwd);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("carryingCommitOnTrain(): end to end, the incident's shape produces a carried card, never a noDeploymentRequired one", () => {
  const { root, work } = makeDisposableRepoPair();
  const originalCwd = process.cwd();
  const branch = "deploy/backlog-tracker-faqs";
  try {
    sh(work, "git", ["checkout", "-b", branch, "--quiet"]);
    const siblingSha = commitFile(work, "shared.js", "app.js with all three tickets' changes\n", `Show running app version in project header\n\nBacklog item: ${SIBLING_ID}`);
    sh(work, "git", ["push", "-u", "origin", branch, "--quiet"]);
    sh(work, "git", ["checkout", "main", "--quiet"]);
    process.chdir(work);

    // What processApplyPatch now does after `git add -A` staged nothing.
    const found = carryingCommitOnTrain(branch, ["shared.js"]);
    const { kind, fields } = noDiffPatchFields(carriedCard, found, { deployBranch: branch, testVersion: "1.5.76" });
    assert.strictEqual(kind, "carried");
    assert.strictEqual(fields.deployCommit, siblingSha);
    assert.strictEqual(fields.carriedByItem, SIBLING_ID);
    assert.ok(!("noDeploymentRequired" in fields));
    // ...and the board's Deploy gate / finishTrain now see it on the train.
    assert.strictEqual(onTrainItems([{ ...carriedCard, ...fields }]).length, 1);
  } finally {
    process.chdir(originalCwd);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

console.log(`\n${passed} passed, ${failures.length} failed\n`);
if (failures.length) {
  for (const [name, err] of failures) console.error(`--- ${name}\n${err && err.stack ? err.stack : err}\n`);
  process.exit(1);
}
