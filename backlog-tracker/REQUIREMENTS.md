# Backlog Tracker & FAQs — Requirements

Source: the actual implemented system as of 2026-09-08 (`backlog-tracker/`,
repo-root `faq/`, and this project's own board history) — this document
describes what is built and why, not an aspirational spec written ahead of
the code. Where a decision was made for a specific, non-obvious reason,
that reason is recorded so it isn't re-litigated or accidentally undone
later.

This is one project among several tracked on the same multi-project board
(see root `CLAUDE.md` → "Prototype Backlog"), but it is unusual among them:
it is the board **and** the tool the board runs on. Its own backlog items
are feature requests and bugs about the tracker itself and about the FAQ /
Help Center surface it also owns.

## Core principle

**The board should never be the bottleneck between "I thought of a fix" and
"it's actually live."** Every design decision below — real-time sync
instead of manual republish, automatic per-item notification, a
Firestore-backed API a Cloud Function can react to, and now a direct
Routine-fire integration — exists to shrink that gap. A prior version of
this system (a self-publishing Claude Artifact) could not close that gap on
its own because it had no server; this system can.

## Scope

This project owns:

1. **The backlog board app** (`backlog-tracker/public/`) — a multi-project
   Kanban board backed directly by Firestore, with realtime sync,
   dictation-assisted item capture, per-project docs/requirements/interface
   contracts, an archive, and both automatic and on-demand ways to alert
   Claude that work is ready.
2. **Its own Cloud Functions** (`backlog-tracker/functions/`) — the
   automation layer: per-item notification, per-project batch notification
   via a Claude Code Routine, and FAQ-article auto-review flagging.
3. **The FAQ / Help Center public site** (repo-root `faq/`) and its admin
   surface (this app's own "FAQ Center" page) — a separate consumer-facing
   product that happens to share this Firestore project and this backlog
   board, not a sub-feature of the tracker itself.

This project does **not** own the content or correctness of any other
project's backlog items (Live Visitor Profile, Experience Templates,
Products/Pricing & Asset Management, etc.) — it only owns the mechanism
that carries them.

## Data model

Firestore project: `backlog-tracker-e4ed2` — entirely separate from
`menu-board-demo`'s `rob-ph-demos` Firebase project (own database, own
Cloud Functions, own Hosting site, own IAM/billing; see
`backlog-tracker/README.md` → "Isolation from menu-board-demo").

### `projects/{projectId}`
```
{
  name: string,
  type?: "Platform" | "Internal operations", // required when a person creates a project; unset only on projects that pre-date the field (shown "Unassigned"). See "Platform and Internal operations". Writable over MCP (set_project_type)
  createdAt: timestamp,
  readmeMd?: string,              // LEGACY: README text from before docs/{kind}; read only when projects/{id}/docs/readme is missing
  requirementsMd?: string,        // LEGACY: Requirements text, same rule against docs/requirements
  docs?: { [kind: "readme" | "requirements"]: { chars: number, sha256: string, sourceCommit: string | null, updatedAt: timestamp } }, // pointers only; the text is in projects/{projectId}/docs/{kind} below. Writable over MCP (PROJECT_WRITABLE_FIELDS)
  description?: string,           // one or two sentences (max 300 chars) on what the project covers, surfaced by list_projects (set_project_description)
  trainStuckSince?: string | null,       // 16 Nov 2026 (RC6wVNJJcPjNTR5hov9W) — when the train entered a stuck state; automation-only (sweepStuckTrains), cleared when it ends. See "Stuck trains"
  trainStuckReason?: "conflict" | "awaiting-human-merge" | "tests-red-no-culprit" | "locked-unapproved" | "revert-blocked" | null,
  trainStuckEscalatedAt?: string | null, // set once per spell past TRAIN_STUCK_THRESHOLDS; its write posts one notify-webhook message (onTrainStuckEscalated)
  repoFolder?: string,            // repo-root-relative folder the project owns, no trailing slash — the join to GitHub that patchFiles paths resolve against
  repoFolderNotApplicable?: boolean, // true = deliberately no single folder (e.g. Backlog Tracker & FAQs)
  deployBranch?: string,          // the project's one integration branch, deploy/<folder> (the deployment train)
  docsSync?: {                    // outcome of the board docs sync (docs-sync-lib.js), after that project's train merge and whenever main moves; error is null on success, or { skipped, at, mergeCommit } when nothing could be synced
    mergeCommit?: string,         // main's head when the sync last ran
    requirementsCommit?: string | null, readmeCommit?: string | null, // each file's own last commit
    syncedAt?: timestamp, error?: string | null, errorAt?: timestamp | null, attemptedCommit?: string,
    mirroredDocs?: { docId: string, name: string, sourcePath: string, sourceCommit: string | null, ok: boolean, error: string | null }[], // one per mirror; a failed one does not stop the rest
    manifestPath?: string,        // the board-docs.json this sync reconciled (docs-sync-lib.js reconcileManifest); absent when the project has none
    unlisted?: { id: string, name: string }[], // up to 50 documents the manifest neither mirrors nor classifies (kind "generated" skipped)
  },
  startHereDocId?: string,        // "readme" | "requirements" | a projectDocs id — the manifest's startHere; written only by the sync, returned by list_projects, not in PROJECT_WRITABLE_FIELDS
  lastMergeCommit?: string,       // main's head at the project's last docs sync (written with docsSync)
  lastMergeAt?: timestamp,        // when that sync ran
  notifyRequestedAt?: timestamp,  // bumped by the "Notify Claude" button
  notifyRequestedByEmail?: string | null, // the signed-in member who clicked — per-member routine binding lookup, see notifyOnProjectReadyForReview below (VNE6dxMu3h6jO3g6FNNB)
  notifyItemIds?: string[] | null, // optional subset picked via the Backlog column's own checkboxes — see below
  notifyAutomationAt?: timestamp, // = notifyRequestedAt on the pipeline's own build requests (run-backlog-automation.js buildRequestFields): an agent ticket in one fires on its owner's Routine whoever clicked last. Automation only (firestore.rules). See "Agent tickets fire under their owner's own Claude account"
  deployNotifyRequestedAt?: timestamp, // bumped by "Notify Claude — Deploy", OR by the approve_deploy_to_main MCP tool — see "team access & the MCP server" below
  deployNotifyRequestedVia?: "mcp" | null, // set alongside deployNotifyRequestedAt only when approve_deploy_to_main wrote it; a console click explicitly clears it back to null, so it's always accurate, never stale from an earlier MCP call
  deployNotifyRequestedByEmail?: string | null, // the signed-in member who triggered this — either the approve_deploy_to_main caller, or (VNE6dxMu3h6jO3g6FNNB) a plain console click; audit trail on the project doc itself, alongside mcpAuditLog, and the per-member routine binding lookup
  groomRequestedAt?: timestamp,   // bumped by the "Groom Backlog" button
  groomRequestedByEmail?: string | null, // same per-member routine binding lookup, for the Groom Backlog button
  groomThreshold?: number,        // Groom Backlog shows only above this many Backlog tickets (default 5)
  groomBudget?: number,           // package complexity budget in points (default 10; small 1, medium 3, large 6)
  packageQueue?: [{id, name, itemIds, status: "queued"|"running"|"done"|"failed", startedAt?, finishedAt?, note?}], // packages built one at a time by functions/package-queue.js
  packageQueueRequestedByEmail?: string | null,
  routinePromptMd?: string,       // see "Per-project Routine instructions" below
  faqAutoFlagOnLive?: boolean,    // see "FAQ auto-review" below
  programId?: string,             // see "programs/{programId}" below
  releaseId?: string | null,      // see "releases/{releaseId}" below
  artifactUrl?: string,           // published Artifact link for this project — ⋮ → "View Artifact". Written directly (not via patchFiles/patchReady) by the Notify Claude Routine — see ROUTINE_INSTRUCTIONS.md → "Project Artifact"
  artifactUpdatedAt?: timestamp,  // set alongside artifactUrl, shown as "updated <date>" under the menu link
  // artifactVersions: subcollection projects/{id}/artifactVersions/{n} — append-only sign-off snapshots {version, projectId, sourceUrl, pinnedUrl, commitSha, frozen, signedOffBy, signedOffAt, note}; written only by the MCP server (snapshot_project_artifact), members read, no browser write (firestore.rules). The ⋮ menu's View Artifact row shows the latest as "v<n>, signed off <date>". See MCP.md → "Artifact snapshots on sign-off".
  notifyRoutine?: {                // set by notifyOnProjectReadyForReview on each fire
    status: "in-progress" | "done" | "error" | "stalled", // "stalled" is transient: the sweep notes the cards, then writes "done" (closedAt, stalledItemIds)
    firedAt: timestamp,
    closedAt?: timestamp,          // set by the automation sweep (closeNotifyRoutines) when it closes a per-item record
    stalledItemIds?: string[],     // sent cards whose session never reported within 25 minutes
    sessionId?: string,
    sessionUrl?: string,
    itemCount: number,
    sentItemIds: string[],
    finishedAt?: timestamp,        // set by the fired session itself, if it follows the hint; cleared on each new click
    errorMessage?: string,
    firedVia?: "member" | "shared" | "owner" | "member+owner" | "shared+owner", // which Routine credentials fired this — see notifyOnProjectReadyForReview / resolveRoutineCredentials below (VNE6dxMu3h6jO3g6FNNB); "owner" = agent tickets on their owner's binding (xFzQgynkoMdV33iWJFZq)
  },
  deployRoutine?: {                // same shape as notifyRoutine (including firedVia), set by notifyOnProjectReadyToDeploy — see README.md
    status: "in-progress" | "done" | "error",
    firedAt: timestamp,
    sessionId?: string,
    sessionUrl?: string,
    itemCount: number,
    finishedAt?: timestamp,
    errorMessage?: string,
    firedVia?: "member" | "shared" | "owner" | "refused", // "owner"/"refused": a train carrying agent tickets (xFzQgynkoMdV33iWJFZq)
  },
  // groomRoutine has the same shape (including firedVia) again, set by
  // notifyOnProjectReadyForGrooming — omitted here only because it predates
  // this schema block; see that function in functions/index.js directly.
  // It also carries note?: string — agent tickets left out of that groom.
  readyForTestingNotifyRequestedAt?: timestamp, // stamped by run-backlog-automation.js once per run per project, after it lands ticket(s) in Ready for Testing — see "The Ready for Testing hand-off" below
  readyForTestingNotifyItemIds?: string[],      // the ids that landed in that run
  readyForTestingNotifyRequestedByEmail?: string | null, // the member whose Notify Claude click started the build (per-member routine binding lookup, as above)
  readyForTestingPendingItemIds?: string[],     // landed ids parked until their tests and test links have finished (automation only)
  readyForTestingPendingSince?: timestamp,      // when the newest of them landed; the 40-minute limit counts from here
  readyForTestingWaitingOn?: { id: string, waitingOn: ("tests" | "link")[] }[], // why the hand-off is held, for whoever looks
  readyForTestingRoutine?: {       // same shape as notifyRoutine (including firedVia), set by notifyOnItemsReadyForTesting
    status: "in-progress" | "done" | "error",
    firedAt: timestamp,
    sessionId?: string,
    sessionUrl?: string,
    itemCount: number,
    sentItemIds: string[],
    finishedAt?: timestamp,
    errorMessage?: string,
    firedVia?: "member" | "shared" | "owner" | "member+owner" | "shared+owner", // "owner": agent tickets presented on their owner's binding (rFNYoDzDdDtQJpupDNpN)
    sessions?: { owner: string | null, itemIds: string[], sessionId: string | null, sessionUrl: string | null, error: string | null, firedVia: string }[], // one per session fired; reviewRoutine carries the same (see "Agent tickets fire under their owner's own Claude account")
  },
}
```
One doc per tracked project. A project with no doc but whose items
reference an unknown/missing `projectId` is grouped under a
client-synthesized `"General"` project (id literal `"general"`) rather than
silently dropping items — see `getRenderedProjects()`/
`ensureGeneralProjectDoc()` in `app.js`. That synthesis is guarded to only
fire once the real `projects` listener has actually delivered its first
snapshot, specifically to prevent a load-order race from ever permanently
writing a spurious `"general"` project doc (this happened once in
production on 2026-09-08 before the guard existed; the stray doc was
deleted by hand).

**Deploy queue and owned paths (wPoSOXfp8Em06Vzp3Cz7):**
`projects/{id}.ownedPaths` (string[], at most 30 repo-relative prefixes;
unset = the default in `functions/deploy-queue.js`, else `repoFolder/`) is
member-editable from the Docs page, like `repoFolder`.
`projects/{id}.trainHold` gains the value `"queued"` (automation-only, like
every train field). `settings/deployQueue` is
`{ entries: [{ projectId, projectName, deployBranch, enqueuedAt, progressKey,
progressAt, passedOverAt }], updatedAt }`, written by the automation's
service account only (no browser, an admin included). See "The deployment
train" → "Deploy queue".

### `releaseGroups/{groupId}` — projects that ship in one deployable (Flow 9/9, 16 Nov 2026)
```
{
  name: string,             // "PH Agent Console"
  deployBranch: string,     // "deploy/ph-agent-console" — the shared train's branch
  projectIds: string[],     // the member projects, in the order the train PR lists them
  createdAt: Timestamp,
}
```
Plus `projects/{id}.releaseGroupId` on each member, pointing back. Membership
needs both pointers (a group that doesn't list the project back doesn't
count). A member keeps its own Backlog, columns, docs, archive and owner, and
its own `deployBranch` stays on its doc, unused while it is in the group
(`run-backlog-automation.js`'s `withGroup()` overlays the group's branch and
keeps the project's own as `ownDeployBranch`, which is also what the repo
folder is derived from). Written only by an admin (Settings → Projects →
Release groups) or the board automation user (`firestore.rules`); members
read. See "Release groups — one deployable, one train" under "The deployment
train" for the behaviour; the logic is `functions/release-groups.js` (browser
copy `public/js/release-groups.js`).

### `backlogItems/{itemId}`
```
{
  projectId: string,
  title: string,       // short subject line — see "Titles" below
  desc: string,
  type: "feature" | "bug",
  category: string,    // one of CATEGORIES, see below
  status: "backlog" | "ready-for-testing" | "ready-to-publish" |
          "published-live" | "archived",
  createdAt: timestamp,
  updatedAt: timestamp,
  archivedAt?: timestamp,
  claudeNote?: string,          // short one-line status, shown nowhere but kept for history
  notes?: [{ author: "claude" | "viewer", text: string, at: timestamp, key?: string, firstAt?: string }], // append-only: every writer adds entries (arrayUnion / appendMissingElements), none resends the array; only a keyed backlog-automation note is ever replaced (one note per event, "Comments and notes")
  attachments?: [{ type: "image" | "video" | "file", contentType?: string, url: string, path: string, name: string, size: number, uploadedAt: timestamp }], // see "Attachments" below
  previewUrl?: string,          // a Ready for Testing card's own "Test this" link
  previewState?: "rebuilding" | "ready" | "stale" | null, // lmdwsP5ElY5Oh12N9Fex — whether a link that opens a checked-in build (GENERATED_BUILDS) already shows this ticket; null = no generated build, the card behaves as before. Written by run-backlog-automation.js only — see "Test/preview link"
  rebuildRequestedAt?: timestamp | null, // 19 Oct 2026 — when the automation last requested an automatic rebuild of this card; cleared once the request is answered (session started, card moved on) or reported as never started. Automation only
  statusEnteredAt?: timestamp,         // 16 Nov 2026 (RC6wVNJJcPjNTR5hov9W) — when the card entered its current column; stamped by onBacklogItemStatusEntered on every status change by any writer (backfill: scripts/backfill-status-entered.js). See "Card state line"
  buildAfterTrain?: boolean,           // 26 Oct 2026 — a build that came due while this project's release was closing (trainLocked); the automation starts it on the first run after the train merges and clears it (sweepDeferredBuilds). Set by the automation or by the board's Answer
  //   15 Nov 2026 (wPoSOXfp8Em06Vzp3Cz7): also set with patchReady when a BUILT patch became ready on a closing train — the patch is held on the card ("Built — joins the next release") and processApplyPatch lands it after the merge.
  sharedWith?: [{projectId, projectName, paths, conflictPaths, conflict}], // 15 Nov 2026 — files this landed ticket shares with another project's live train; conflict when the two tips do not merge cleanly (git merge-tree). Automation-only.
  foreignPaths?: [{projectId, projectName, paths}], // 15 Nov 2026 — files it changed that another project owns (projects.ownedPaths). A warning, never a refusal. Automation-only.
  rebuildAfterRevert?: boolean,        // queue a rebuild once this card's commits are off the train: automatic send-backs, the board's Failed testing (not "Blocking a release, not a rebuild") and the MCP fail_testing tool
  lastFire?: { status: "started" | "retrying" | "failed", at: timestamp, requestedAt, sessionId?, sessionUrl?, error?, attempts: number, deferrals: number, nextAttemptAt?: timestamp | null, firedVia?: string, model?: "standard" | "advanced" }, // 19 Oct 2026 — outcome of the latest Routine fire for this card, written by notifyOnProjectReadyForReview. `model` (18 Nov 2026) is the model requirement the session was fired with; `firedVia` is "advanced" when it went to the Advanced (Opus) Routine. Automation/function only
  buildAttemptId?: string,      // 14 Nov 2026 — the id of the build attempt this card is waiting on: notifyOnProjectReadyForReview writes a fresh one (16 hex chars, also on lastFire.buildAttemptId) each time a fire starts a session, and the fire text carries it. A failed fire leaves the earlier one current. Automation/function only — see "Heartbeats and build attempts"
  patchAttemptId?: string | null, // 14 Nov 2026 — the attempt id a build session hands its patch back under (same PATCH as patchFiles). processApplyPatch refuses the patch when it differs from buildAttemptId, and clears it when a patch lands. Automation only
  dependsOnItemIds?: string[],  // 14 Nov 2026 (build order) — the tickets (any project, at most 20) this one builds after. Filled from the Dependencies section at intake, by a build session that finds a real code dependency, by Edit item → Builds after, or over MCP. Browsers may write it (a list of at most 20 strings) — see "Build order"
  dependsOnSource?: "intake" | "build" | "manual" | null, // 14 Nov 2026 — who set dependsOnItemIds. Intake replaces only its own list; a "build" or "manual" list is only ever added to. Written by the intake trigger and MCP, never a browser (a pipeline field in firestore.rules)
  queuedAfter?: { itemId: string, title: string, at: timestamp } | null, // 14 Nov 2026 — a Ready for Dev click queued this ticket behind a same-area lane-mate; the automation starts it when that one lands or fails (sweepBuildQueue) and the card shows "Queued: builds after <title>". Function/automation only
  buildSession?: { status?: "done" | "error", finishedAt?, reportedAt?: timestamp, errorMessage?, heartbeatAt?: timestamp, phase?: "reading" | "building" | "testing" | "packaging", attemptId?: string }, // the session's own report. heartbeatAt/phase/attemptId (14 Nov 2026) are its heartbeat: written when it starts, at each phase change and at least every 10 minutes; a heartbeat counts only when attemptId equals the card's buildAttemptId. Automation/Routine identity only (a pipeline field in firestore.rules)
  previewStateAt?: string,      // ISO — when previewState last changed ("rebuilding" is aged from here)
  previewBuildWorkflow?: string | null, // e.g. "dsp-prototype.yml" — the workflow that rebuilds the bundle
  previewBuiltFrom?: string | null,     // build-info.json "commit" once ready: the source commit the bundle was built from
  previewSha?: string | null,   // the commit the pipeline's link is pinned to
  previewUpdatedAt?: string,    // ISO — when the pipeline last changed the link
  testSummary?: string,         // Ready for Testing card's primary text — see below
  kanbanKey?: string,           // VlBatzRVbPt6heAEp5mu — Send to Agent: the Staff Kanban ticket (PH-n) this agent ticket was made from (createdVia "send-to-agent", with ownerEmail = that ticket's assignee). The card shows a chip that opens it; a status change recounts that ticket (kanbanAgentRollup, functions/kanban-agent.js). Server-written; informational only (the roll-up reads kanbanTasks/{PH-n}.agentTickets). See kanban-staff-board/REQUIREMENTS.md → KB-AGENT-1
  noDeploymentRequired?: boolean, // set from the Edit item modal, or by the no-diff path when the content is already on main — see "No manual way to reach published-live exists" below for the one exception it carves out. The train wins over the flag: a card with a deployCommit is a train card whatever this says (isNoDeployCard() in app.js)
  testPassed?: boolean,         // DEPRECATED — the old per-card "Confirm tested" flag. Approval is the checkbox now (see "Approving out of Ready for Testing"); read-only leftover on old cards, never written
  testVersion?: string,         // backlog-tracker's own APP_VERSION, stamped once on first entry to Ready for Testing and carried unchanged through Approved for Deployment, Deployed/Main Branch (Live), and Archived — see "Test version" below
  effort?: "small" | "medium" | "large" | null,     // cwehxSMZv8noJQv5kB22 — real value from the Edit item modal; null/unset falls back to build-batches.js's estimateEffort() guess. See "Feed in requirements → suggested build batches" below
  priority?: "low" | "medium" | "high" | null,      // same ticket — real value from the Edit item modal; null/unset falls back to estimatePriority()
  model?: "standard" | "advanced" | null,           // t1CU2q6LlxGd5pFB9vwG — which Claude model must build and review it; unset = "standard". "advanced" = Claude Opus only. Set from New item / Edit item, or MCP create_backlog_item / update_backlog_item; when no person chose it, the classifier's suggestion (CCPnRjXOH4YMsfy3C49r). See "Per-ticket model requirement" below
  modelAuto?: boolean,          // CCPnRjXOH4YMsfy3C49r — true while `model` follows modelSuggested (set by the intake trigger, or by a person picking Auto); false when a person chose Standard/Advanced or an escalation raised it. A `model` with no modelAuto (set before this existed) counts as chosen
  modelSuggested?: { model: "standard" | "advanced", reasons: [{ key: "security" | "pipeline" | "migration" | "contract" | "multiProject" | "large" | "long", text: string }], version: number }, // the deterministic classifier's verdict (model-suggest.js), on create, every description save and once over the open Backlog. Pipeline field
  modelEscalatedAt?: timestamp, // when two counted send-backs or two refused patches raised a Standard ticket to Advanced (once). Pipeline field
  autoReview?: { commit: string, requestedAt: timestamp }, // the landed commit an automatic review was requested for (one per commit). Pipeline field
  toolsRetries?: number,        // the one automatic retry of a tools-unavailable ticket, after the project got its own Routine. Pipeline field
  ownerEmail?: string | null,   // xFzQgynkoMdV33iWJFZq — an agent ticket's owner (lowercased email): it fires only on that member's personal Routine, and only they can start it. Set by the server only (MCP ownedByMe; Send to Agent). Pipeline field — no browser writes it. See "Agent tickets fire under their owner's own Claude account"
  contractReview?: {            // ZmEWDC40NYOiojehfPjk — set when a ticket this one builds after (dependsOnItemIds) changed an interface contract on landing; cleared (null) when this ticket's own patch lands. Pipeline field (automation only). See "Owner scoping and contract-change review"
    status: "needs-review", upstreamItemId: string, upstreamTitle: string | null,
    commit: string, files: string[], summary: string, flaggedAt: string   // ISO
  } | null,
  builtByModel?: string,        // exact model id that built it (e.g. "claude-opus-5-5"), written by the build session with patchReady. Pipeline field (automation only)
  reviewedByModel?: string,     // exact model id that reviewed it, written by the Review Batch session with its review flag. Pipeline field (automation only)
  testRound?: number, // Testing rounds (hm84opFjizq3vekk0fC1): 1 on first arrival in Ready for Testing, +1 on each later arrival after a counted send-back. Pipeline field — automation only. See "Testing rounds"
  sendBacks?: [{ at: ISO string, by: "person" | "tests" | "review", who: string, category: string, line: string, counted: boolean }], // newest last, last 10 kept; written by the automation (processRevertFromTrain, ejectRedCulprits) and the MCP server (fail_testing) only
  sendBackCount?: number, // every send-back ever, not capped
  countedSendBacks?: number, // the send-backs that count towards the loop cap (counted: true)
  lastFailureReason?: { category: string, summary?: string, text: string, action: "failed-testing" | "ejected-from-train" | "review-kickback", at: timestamp, who?: string }, // XJoASicLGefL5c9fronl — structured reason from the most recent Failed testing/Eject from train; see "The deployment train" below. Never cleared automatically — only meaningful while status is "backlog"
  followUpOf?: string,          // id of the Ready for Testing ticket whose tester asked for "something more" (Failed testing → "It works, but I want something more"); the original stays on its train, this new ticket waits in Backlog. Not a pipeline field
  ejectedFromTrain?: boolean,   // FVrOIVAAp46NdcgGovMW — set by ejectFromTrain(), distinguishing an explicit release-unblocking eject from an ordinary Failed testing reject in the card's history; see "The deployment train" below

  // Notify Claude automation hand-off — see README.md "Notify Claude can't
  // push — how a fix actually reaches GitHub". A fired Routine session has
  // no GitHub credential (deliberately — backlogItems.desc is publicly
  // writable, so a malicious item could otherwise prompt-inject a fired
  // session into leaking one), so it writes what it built here instead of
  // pushing/merging itself; backlog-tracker/scripts/run-backlog-automation.js
  // (a scheduled GitHub Actions job with its own repo-native credentials,
  // no AI involved) does the actual push/PR/merge and clears these flags.
  patchFiles?: [{ path: string, content: string | null }],  // null content = delete that path
  patchCommitMessage?: string,
  patchDocsImpact?: string,     // build's one-sentence reason a docsImpact rule (board-docs.json) does not apply; lands the patch with a "Spec not updated" note, then cleared (not in itemPipelineFields)
  patchReady?: boolean,         // set true once patchFiles etc. are ready; cleared to false once the commit lands on the train
  patchBranch?: string,         // DEPRECATED — there is one branch per project now, not one per ticket. Still accepted from the Routine, ignored
  patchPrTitle?: string,        // DEPRECATED — a ticket has no PR of its own; the train's PR title is generated
  patchPrBody?: string,         // DEPRECATED — likewise
  mergeReady?: boolean,         // DEPRECATED — pre-train per-ticket merge path (processMergePr), kept only for cards in flight when the train shipped
  mergePrNumber?: number,       // DEPRECATED — which PR mergeReady refers to

  // The deployment train — see "The deployment train" below and
  // README.md → "The deployment train — one branch and one PR per project".
  // Every ticket a project builds is one commit on that project's single
  // integration branch, so tickets stack, are tested together, and ship as
  // one PR.
  deployBranch?: string,        // the integration branch this ticket was built on, e.g. "deploy/backlog-tracker-faqs"
  deployCommit?: string,        // its latest commit on that branch — the sha the Deploy flow verifies is an ancestor of the branch head
  deployCommits?: [string],     // every commit it has on the branch (a re-patch appends rather than rewriting)
  revertRequested?: boolean,    // Failed testing wrote it: take this rejected ticket's commits back off the branch
  revertBlockedBy?: [string],   // item ids whose later commits made that revert conflict; a human resolves, nothing is force-pushed
  // Each train card's own test result (19 Oct 2026) — written ONLY by
  // run-backlog-automation.js (itemPipelineFields in firestore.rules). The
  // card takes its worst workflow's state: failed, not-run, running,
  // starting, passed (not-applicable when its paths need no workflow). Set at
  // landing (processApplyPatch), kept current each sweep by
  // recordCardTrainTests (writes only on a change; a card with no record or
  // one for another sha is backfilled from its commit's files). Shown as a
  // chip on Ready for Testing / Approved for Deployment cards only while
  // trainTest.sha == deployCommit (public/js/card-test-status.js).
  trainTestReruns?: string[], // automation-written, last 20; dedupe and hand-off only. Per run: `<workflow>@<sha>:rerun:<runId>` / `:flaky:<runId>`, <sha> being the run's headSha (the card's commit, or a generated-only commit after it); the older bare `<workflow>@<sha>:rerun|flaky` is still read
  trainTest?: { sha, state, workflows: [{ workflow, label, state, runUrl, since }], since, updatedAt },
  // Who approved (19 Oct 2026): written in the batch that moves the card to
  // ready-to-publish — approvedByEmail lowercased, approvedAt a server
  // timestamp; rules require the caller's own email and request.time, and
  // only on that move. approvedVia (a non-browser route, e.g. dsp-board) is
  // never a browser's to write. Approved cards show "Approved by <email>".
  approvedByEmail?: string, approvedAt?: timestamp, approvedVia?: string,
  revertedCommits?: [string],   // the revert commits that took it off
  carriedByCommit?: string,     // this card has NO commit of its own: a sibling's commit on the branch already carried its change (a shared-file batch). deployCommit is that same sha, so the card is on the train like any other and goes live only when the train merges — see "A card carried by a sibling's commit follows that train" under "The deployment train"
  carriedByItem?: string | null, // the sibling's id from that commit's `Backlog item:` trailer (null for a commit with no trailer)
}
```

```
projects/{projectId} — the train's own state. Two different principals write
here and firestore.rules treats them differently: run-backlog-automation.js
writes as the Firebase SERVICE ACCOUNT (bypasses rules entirely), while the
Notify Claude Routine writes trainReady as the board automation USER
(board-automation@…, subject to rules — hence isBoardAutomation()). A human
editor may only latch trainLocked true, nothing else.
{
  repoFolder?: string,          // the project's folder in rob_ph_demos, repo-root-relative, no trailing slash
  repoFolderNotApplicable?: boolean, // explicit "this project has no single folder" (e.g. this project itself, which owns backlog-tracker/ and faq/) — distinct from repoFolder simply being unset
  deployBranch?: string,        // "deploy/<project-slug>", created from main on first use
  trainLocked?: boolean,        // a release is closing: no new ticket may join it, so the build CTAs hide
  trainReady?: boolean,         // the Deploy flow verified the train; the automation merges it. Set by the Routine — or by the pipeline itself when the Routine reported without setting it, never reported, or was never fired (trainHandoverReason in functions/train-lock.js)
  deployRequestHandledAt?: timestamp, // stamped by processDeployTrain as it consumes a Deploy to Main click, so that click is never handed over again once merged or refused
  trainPrNumber?: number,       // the train's single PR
  trainStatus?: "idle" | "deploying" | "conflict" | "awaiting-human-merge",
  trainNote?: string,           // why it isn't merged, when it isn't
  needsHumanMerge?: boolean,    // the train carries a .github/workflows/ change, so a person merges it
}
```
`repoFolder` is the link between a project on this board and its folder in
`rob_ph_demos`, read by `projectFolderOf()` in
`scripts/run-backlog-automation.js` to resolve a patch whose paths are
relative to the project's folder rather than the repo root. Unset, it falls
back to the deploy-branch slug and then to nothing — and "nothing" is how
PR #185 (22 Sep 2026) wrote seven tickets' files to the repo root and
overwrote the root `README.md` while every card read "Deployed / Main
Branch (Live)". It must therefore be set deliberately when a project is
created, and marked `repoFolderNotApplicable: true` instead of just left
unset for a project that genuinely owns no single folder (this one owns
both `backlog-tracker/` and `faq/`) — see README, "Adding a project". It is
not in the MCP server's `PROJECT_WRITABLE_FIELDS`, so an agent cannot set
it over MCP; **the New Project modal now asks for it at creation** (writing
`repoFolder`/`repoFolderNotApplicable` plus a `deploy/<folder>`
`deployBranch` together — `firestore.rules`' `isValidNewDeployBranch()`
allows a plain editor to name a brand-new project's `deployBranch` at
create time only, since there's no existing train yet to redirect), and
it's editable afterward from the project's Docs page. For a project
created before this shipped, that Docs page field (or a direct Firestore
write) is how it gets retrofitted.

`patchFilesLookFolderRelative()`, also in `scripts/run-backlog-automation.js`,
is the other half: when `projectFolderOf()` returns `null` for a project
(no `repoFolder`, or one that doesn't resolve to a real directory) AND the
item's `patchFiles` paths look like they were written relative to some
folder — none of their top-level path segments exist at the repo root —
`processApplyPatch` refuses the item instead of writing it as given:
`patchReady` is cleared and a note names the problem and how to fix it, so
a project missing this link can never again silently write to the repo
root the way PR #185 did.

**A declared `repoFolder` that doesn't exist yet is a new project, not a typo**
(3 Nov 2026): `pendingRepoFolderOf()` finds it and `placePatchInNewFolder()`
accepts a patch whose paths already start with `<repoFolder>/` (creating the
folder) or rewrites folder-relative paths under it. The PR #185 refusal now
applies only to a project with no `repoFolder` at all.

`CATEGORIES` (fixed set, `backlog-tracker/public/js/app.js`): `Pricing &
Offers`, `Product Assets`, `HQ Admin`, `Retail Admin`, `PH Website`,
`Backend / Infrastructure`, `Uncategorised`.

`systemStatus/docsSync` — state of the board docs sweep that syncs every
project's repo documents whenever `main` moves (members can read it; only
the automation writes it): `{ lastSyncedMain: string | null, attemptedMain:
string, attempts: number, failedProjects: string[], checkedAt: timestamp }`.
`lastSyncedMain` advances to `attemptedMain` only when every project
succeeded; otherwise the same head is retried, at most 5 attempts, and a new
head resets `attempts`. Per-project outcomes are `projects/{id}.docsSync`
above.

Status pipeline and what each transition means:

| Status | Column | Meaning |
|---|---|---|
| `backlog` | Backlog | Captured, not yet worked |
| `ready-for-testing` | Ready for Testing | Implemented and committed on the project's integration branch, awaiting human test |
| `ready-to-publish` | Approved for Deployment | Approved out of Ready for Testing via the project's own "Approved for Deployment" action |
| `published-live` | Deployed / Main Branch (Live) | Set only by `run-backlog-automation.js` after it actually merges the train's PR — see below, no manual button sets this (the one exception is a card with nothing on any train, flagged `noDeploymentRequired` — see "No manual way to reach `published-live` exists") |
| `archived` | (hidden from the board) | Set via the Archive action on a Deployed/Main-Branch card; reversible via Restore |

### `consoleUsers/{lowercasedEmail}`

The member list. **One doc per person, and it governs both halves of their
access**: opening the console in a browser, and connecting their own AI
agent to it over MCP. Replaced a hard-coded allowlist that had to be edited
in three files to add anyone.

```
{
  email: string,               // lowercased; must equal the doc id
  displayName?: string,
  role: "admin" | "editor" | "viewer",
  disabled?: boolean,          // keeps the row, removes all access
  mcpEnabled?: boolean,        // default true — false turns off the agent half only
  createdAt?: timestamp, createdBy?: string,
  updatedAt?: timestamp, updatedBy?: string,
}
```

| Role | Board | Manage members | Agent (MCP) |
|---|---|---|---|
| `admin` | read + write | yes | read + write |
| `editor` | read + write | no | read + write |
| `viewer` | read only | no | read only (`board.write` is never issued) |

- `firestore.rules` resolves `isBoardReader` / `isEditor` / `isAdmin` by
  reading this doc, so a change takes effect on the next request — no token
  refresh, no cache.
- The account owner is an admin by the `owner: true` custom claim on their
  Firebase Auth user (`isOwnerAccount()` in the rules, `isOwnerEmail()` in
  `functions/mcp-server.js`, `isOwnerUser()` in `auth-gate.js`), so an empty
  or mis-edited collection can never lock everyone out. The claim is
  optional — admins are ordinary `role: "admin"` rows — and is set only if
  the `CONSOLE_OWNER_EMAIL` / `CONSOLE_OWNER_ALIASES` repository secrets are
  (`scripts/set-owner-claim.js`). Before every rules deploy that script
  checks someone can still administer the console (an owner claim or an
  enabled admin row) and stops the deploy if not. An alias account with the
  claim also carries `aliasOf: <canonical>`.
  **No person's address is written anywhere in this repo** (root `CLAUDE.md`;
  `tools/check-personal-emails.js` enforces it). `board-automation@…` stays a
  named editor: it is a service identity, not a person.
- **A signed-in person may always read their OWN row.** `auth-gate.js` has
  to check membership before it can know whether the caller is a member;
  without that self-read every new member sees "not on the list" forever.
  Since 27 Sep 2026 the wall resolves in this order: the `consoleRole`
  claim on the cached ID token (no network), then this self-read over REST,
  then `POST /mcp/claims/sync` in the background; a listener refused by the
  rules reloads to the wall with the claim ignored once, never in a loop.
  Only admins may `list` the collection; any member may `get` a row.
- Storage rules cannot read Firestore, so membership also rides as a custom
  auth claim (`consoleRole`, `consoleEditor`) kept in step by the
  `syncConsoleUserClaims` trigger and `POST /mcp/claims/sync`.

### `docRevisions/{revisionId}`

What a documentation write replaced, recorded BEFORE it overwrote anything.

```
{
  target: "project.requirementsMd" | "project.readmeMd" | "projectDoc"
        | "projectDoc.deleted" | "interface" | "interface.deleted"
        | "skill" | "skill.deleted",
  projectId?: string, docId?: string, interfaceId?: string, skillId?: string,
  name?: string,                 // for display in a list
  contentMd: string,             // the content as it was before the write —
                                  // for "skill"/"skill.deleted" this is
                                  // JSON, not markdown: the replaced
                                  // {path,content}[] file set (or, for a
                                  // delete, {name,slug,summary,version,files})
  chars: number,
  replacedAt: timestamp, replacedByEmail: string, via: "mcp" | "console",
}
```

`"skill"`/`"skill.deleted"` (eKFIGtskqbnUTqUTBFBl) are written two ways: an
MCP-originated `update_skill`/`delete_skill` call
(`functions/mcp-server.js`) records its own revision inline, synchronously,
before its write commits — the only way it can hand the caller a
`revisionId` in the same response — and tags it `via: "mcp"`. A skill
edited directly on the console can't write `docRevisions` itself (denied
below, browser-side, same as every other write here), so
`functions/index.js`'s `onSkillWritten` trigger backfills the same trail
for it, tagged `via: "console"`, without ever double-recording an
MCP-originated change (it defers to whichever wrote first — see that
trigger's own comment for the exact rule). The Skills page's own
"Change history" view on each skill card reads this by `skillId`.

Append-only and written only by the server (admin SDK, bypasses rules);
readable by any member so the Docs page can show what changed. This is what
makes handing documentation write access to an agent safe — an agent that
truncates a 95 KB requirements document has not destroyed it — and it is the
reason the `delete_` tools exist at all.

### `searchIndex/{source:id}`, `searchIndexState/main`, `topicContext/{key}`, `searchRuns/{id}`

PH Agent Context (`functions/context`, requirements CTX-1 to CTX-24). Server
only: members read all four, no client writes any of them.

- `searchIndex/{source:id}`: one entry per source record. `source`
  (`ticket`, `kanban`, `project`, `concept`, `critique`, `faq`, `lead`,
  `prospect`, `support`, `document`, `skill`), `recordId`, `title`,
  `projectId`, `projectIds` (an interface's projects), `conceptId`, `status`,
  `type`, `owner`, `open`, `archived`, `updatedAt` and `createdAt`
  (milliseconds), `url` (the deep link), `access` (the read tool that guards
  it), `meta` (small extras: a blocker, decisions, a Kanban key), `chunks`
  (`[{h, t, v?}]`: heading, text, optional semantic vector), `hash` (of the
  indexed content), `embedder`, `truncated`, `indexedAt` (milliseconds) and
  `deleted` (a tombstone).
- `searchIndexState/main`: `backfilledAt`, `lastRunAt`, `report`, `removed`.
- `topicContext/{key}`: the warm cache. `key` (a hash of the caller's role,
  the sources that role may read, and the topic), `topic`, `ref`
  (`project:<id>`, `concept:<id>`, `lead:<id>` or `text:<words>`), `kind`,
  `entityKeys`, `role`, `visibility`, `pack` (the pack as JSON), `cited` (the
  keys of the records it is made from), `citedJson` (each with its version
  and score), `stale`, `staleSources`, `staleAt`, `builtAt`, `indexSeen`,
  `lastUsedAt`, `hits`, `misses`, `builds`, `lastBuildMs`, `lastTier`,
  `usedBy`.
- `searchRuns/{id}`: one row per `search_console` or `get_topic_context`
  call. `at`, `atMs`, `email`, `clientId`, `role`, `via`, `kind` (`search`
  or `topic`), `queryHash` (a keyed hash, never the query), `queryLength`,
  `filters`, `sourcesHit`, `results`, `durationMs`, `cacheTier`, `cacheHit`,
  `indexSize`.
- `contextSecrets/audit`: the key of that hash. No client reads or writes
  it.

### `mcpClients/{clientId}`, `mcpAuthCodes/{sha256}`, `mcpTokens/{sha256}`, `mcpAuditLog/{id}`

MCP server state — registered OAuth clients, and the hashed authorization
codes and access/refresh tokens standing behind every team member's agent.
Written only by the Cloud Function through the admin SDK. **`firestore.rules`
denies every client read and write of the first three outright**, and the
`boardApi` proxy's collection allowlist does not include them. `mcpAuditLog`
(one row per agent write: `{at, email, clientId, tool, itemId?, …}`) is
admin-readable and append-only from the server.

## The deployment train

**A failing ticket heals itself or asks a person; it never strands (26 Oct
2026).** From a review of 19–26 Oct (the full history is on the cards):
send-backs waited 26–38 minutes each for a run on main that the train had
already answered; one automatic rebuild was shared by every cause, so a
ticket that had merely conflicted once got "a person needs to look at it"
after a later test failure; a person's Failed testing waited for someone to
click Ready for Dev; a rebuild due while a release was closing said "click
Ready for Dev once the train has merged"; and the automation, which acts only
when it runs, waited on a GitHub schedule that ran every 20–90 minutes when
busy. Now:
- **Every train test run starts the automation when it finishes**: the
  `wake-automation` job in `e2e-quick.yml`, `firestore-rules-test.yml`,
  `kanban-staff-board-tests.yml` and `retail-media-insights-tests.yml` (not
  for pull requests), and in `dsp-prototype.yml` after a train bundle is
  pushed. The `*/2` schedule stays as the safety net.
- **No check on main when the train already proves main green**:
  `provenGreenMain` finds the nearest earlier card whose run passed with no
  merge of main between it and the culprit; both runs held the same main, so
  the culprit is sent back at once (`why: "train-green"`). A merge of main
  in between still runs the check on main below.
- **The revert happens in the same run as the send-back** (`main()`
  reverts what `ejectRedCulprits` returns), and the rebuild is queued
  straight after.
- **A card the workflow never runs for no longer stops the scan**: a
  docs- or faq-only ticket has no run of the console tests, and
  `pickRedCulprit` used to stop there, so a red ticket after it was never
  sent back. Cards whose commit's files don't need the workflow
  (`trainTestsFor`) are skipped like stale ones; a card whose run simply
  hasn't started still holds the tickets after it.
- **One plan for every automatic rebuild** (`selfHealPlan`): up to
  `MAX_AUTO_REBUILDS` (3) per ticket across all causes (test failure,
  same-lines conflict, migration number clash, intake section, docsImpact).
  Used up, the ticket is flagged `blocked: { reason: "waiting-on-input",
  setBy: "self-heal" }` with the reason, so the board shows it under
  "waiting on your answer" with an Answer button that rebuilds it.
- **Nothing waits on a person's answer (14 Nov 2026, Rob: "the tickets are
  still asking me random questions which block the backlog flow")**. Build
  sessions are told to decide and not ask: where a ticket leaves a choice
  open they take the best option, build it and state the assumption on the
  card ("Assumed:"), and they flag a card only for something only a person
  can supply (`ROUTINE_INSTRUCTIONS.md`, the build prompt in
  `functions/index.js`). A flagged question is answered on the automation's
  next run, not after 10 minutes. A build that never ran (usage limit,
  restart, refused fire: `blocked.kind` `never-ran`) asked nothing, so it is
  not "answered": it is tried again by itself after 30 minutes, then 1, 2, 4
  and every 6 hours, up to 12 times (`neverRanRetries`), and its flag says
  "Nothing to answer". A flag a person set (`setBy` an address) is never
  answered for them. Tests: `test/self-heal.test.js`.
- **A patch can be handed over as a commit (14 Nov 2026)**: a build session
  commits on its own branch, pushes, and writes only `patchCommit` (full id),
  `patchRef` and `patchBaseSha` on the card. `basePatchFilesFor` fetches the
  commit and `patchFilesFromCommit` reads every file it changes relative to
  the base into the same `[{path, content}]` list (null for a deleted path),
  so landing is unchanged. No file content goes through the board: no size
  limit, no patch parts, and no upload for a session's environment to
  refuse. Text files only; `patchFiles` remains the fallback. Only the
  automation account may write the two fields (`firestore.rules`). Tests:
  `test/patch-commit.test.js`.
- **A question never strands a ticket (30 Oct 2026)**: a card flagged
  `waiting-on-input` takes the senior agent's
  answer. `sweepAutoAnswers` (`autoAnswerPlan`) appends the note "Answer to
  the build's question (taken automatically…)" using
  `blocked.recommendation` (recorded by the build after consulting a
  higher-ranking agent) or, without one, the default "take the best option,
  state the assumption, do not ask again"; it clears the flag and requests a
  rebuild (held until the train merges when the release is closing). At most
  `MAX_AUTO_ANSWERS` (2) per ticket (`autoAnswers`). **After those two it
  goes to the senior model, not to a person (16 Nov 2026)**: the ticket is
  raised to Advanced (`model: "advanced"`, `modelEscalatedAt`; Claude Opus)
  and built `MAX_AUTO_RETRIES` (2) more times (`autoRetries`; the second 30
  minutes after the first), told to make the call itself. While any of this
  is still to come the card is not a question for anyone: its chip reads
  "Handled automatically", its line "Being rebuilt by itself" or "With the
  senior model to make the call", it waits on the automation, it is not in
  Needs attention and not in the "N waiting on your answer" count
  (`selfAnswering` in `card-state.js`, which also holds the limits). A build
  that never ran (`blocked.kind "never-ran"`) keeps its own 12 tries. A flag a
  person set (`setBy` an email address) is never answered for them.
- **A ticket that changes only test files approves itself (17 Nov 2026).**
  A flaky-test fix has nothing a person can try, yet seven of them sat in
  Ready for Testing for three hours waiting for a tick. `sweepAutoApprovals`
  (every automation run, after the cards' test results are recorded) moves a
  Ready for Testing ticket to Approved for Deployment when every file its
  commits changed is a test file (under a `test`, `tests`, `__tests__` or
  `e2e` folder, or named `*.test.*` / `*.spec.*`; `isTestOnlyChange`) and its
  own `trainTest` is `passed` for its `deployCommit`: not running, not
  borrowed from an older commit, not "not-applicable". It writes
  `approvedVia: "auto-test-only"` and a note saying why, and does **not** set
  `trainLocked`: more test fixes may still be building, and a lock would hold
  them for the next release. One product file in the ticket and it waits for
  a person as before. Deploy to Main is still a click, and Failed testing
  still takes it off the release. A flaky-test ticket the ledger raised and
  the build found already fixed (`noDeploymentRequired`, no commit,
  `autoRaised`, `flakyCaseId`) is closed the same way instead of waiting for
  "Confirm tested" (`autoConfirmNoChangePlan`). Tests: `test/auto-approve.test.js`.
- **A patch's `package.json` is merged, not rebuilt (17 Nov 2026).** Every
  ticket that adds a test appends to the same script line of
  `backlog-tracker/test/package.json`, so two tickets built side by side
  always conflict there when the second lands. `rebasePatchFilesOnto` now
  merges a conflicted `package.json` key by key (`mergePackageJsonPatch`,
  the same `mergeJsonThreeWay` a train's merge with main uses: both sides'
  added commands kept in a script's `&&` chain). Anything else both changed
  differently (a version, a dependency) is still a conflict and a rebuild.
  Before this a finished 78-minute Advanced build of the Dashboard page was
  discarded and started again over that one line.
- **One flaky-test ticket per case, by id, not by title (17 Nov 2026).** A
  build renames its ticket, so matching the open ticket by its "Flaky test:
  <case>" title filed a duplicate the moment each fix reached Ready for
  Testing (six in one morning). `casesNeedingTicket` matches by the ledger's
  `ticketId`, the ticket's `flakyCaseId` or the title, and once a case's fix
  has shipped only flakes seen after that count towards a new ticket.
- **A question that does reach a person is one sentence with options to
  click (16 Nov 2026).** Only when the senior model's tries are used up does
  the card wait on a person ("Needs your pick"). The Answer dialog then shows
  `personQuestion(item)`: the senior model's own `blocked.question` (one plain
  sentence, 240 characters at most) and `blocked.options` (2 to 4 choices,
  `[{label, recommended}]`, the recommended one shown first and marked), or,
  when it left none, the standard question "built N times … did not get
  through: <reason>. What should happen to it?" with "Try again on the senior
  model (recommended)" and "Park it: leave it in Backlog and stop trying".
  One click answers: an option is saved as the answer and the ticket is
  rebuilt; Park it clears the flag and builds nothing. Nothing has to be
  typed (typing stays possible). A dependency wait (`dependsOnItemIds`, `blocked.reason`
  `waiting-on-dependency`) is never a question: it shows "Waiting for: <title>",
  has no Answer button, and unblocks by itself when its dependencies have left
  Backlog. See "Build order" below for how dependencies are recorded and how
  a click orders the builds.
- **A rebuild due while the release is closing waits for the merge, not a
  click**: the card carries `buildAfterTrain: true` (set by `selfHealPlan`,
  `releaseDependents`, `sweepUnbuiltReports` or the board's Answer while
  `trainLocked`), and `sweepDeferredBuilds` requests its build on the first
  run after the train has merged (`deferredBuildOutcome`).
- **Failed testing rebuilds automatically**: the board's send-back writes
  `rebuildAfterRevert: true` (`sendBackFields`), so the ticket is rebuilt
  with the tester's Details as its brief once its commits are off the
  train — except for the category "Blocking a release, not a rebuild".
  When the release is closing (`trainLocked`), `processRevertFromTrain`
  sets `buildAfterTrain` instead of requesting the build: the release ships
  without the ticket and its rebuild follows the merge, rather than landing
  a fresh ticket on a train that is waiting to deploy.
- **A duplicate session's late patch is discarded**: a patch for a card
  already on the train whose `patchBaseSha` does not contain the card's own
  `deployCommit` (`latePatchFromDuplicateSession`) is dropped with one note,
  instead of a false "Not built … could not be carried" and a needless
  rebuild. A deliberate re-patch reads the branch after the card's commit and
  lands as before.
- **A revert that collides only in a document completes**: tickets on a
  train each add a line to the same dated list in REQUIREMENTS.md or
  README.md, so taking an earlier one off conflicted there even when its
  code reverted cleanly, and the train waited for a person.
  `tryAutoResolveRevertConflict` resolves a Markdown-only conflict where the
  revert only takes lines away (`resolveRevertDocConflict`: the current text
  minus the reverted commit's added lines); any other conflict, and any code
  file, still stops with `revertBlockedBy`.
- **A test run that never reached a result is started again**: a card
  whose run was cancelled or never started read "not-run" for good, held
  the culprit scan and waited for someone to approve it "with tests
  acknowledged". `retestUnrunWorkflows` (from `recordCardTrainTests`)
  starts each such workflow once more on the card's own commit through a
  throwaway `train-retest/<sha>` branch, notes the card, and deletes the
  branch once the run has a result (`trainTestReruns` keys
  `<workflow>@<sha>:retest` → `:retested`).
- **The deploy gate counts a pass on the head even while a duplicate runs**:
  Deploy to Main dispatches the train tests on the version-bump commit while
  the PR runs the same workflows on it; the gate read only the newest run, so
  a deploy held on a duplicate after the PR's run had passed (PR #474).
  `gateRunFor` takes the newest completed run on the head commit when the
  newest run is still going and that one passed.
- **When a build can't be started at all, the card asks for an answer**: a
  rebuild that never started after its retries (`sweepRebuildRequests`), or
  two build sessions that never reported back (`sweepSilentBuildSessions`),
  now set `blocked` waiting-on-input (`buildNeverRanBlock`) instead of a
  note asking for a click, so the card shows under "waiting on your answer"
  with the reason and an Answer button that builds it again. The retry
  counters reset once a rebuild starts or the ticket is flagged.
- **Build sessions run what CI runs**: `npm run test:offline` in
  `backlog-tracker/test` is the console tests without the emulator, kept
  equal to CI by `ci-coverage.test.js`.
- **A spent revert request never strands a card (30 Oct 2026, xzFgioRYWpdeDfUzzCmp)**:
  a card sent back whose revert conflicted, then rebuilt to identical
  patchFiles, went back to Ready for Testing still `revertRequested`, so
  approval refused it and every run retried the revert. An identical
  re-package (`noDiffPatchFields`, "already-on-train") now clears
  `revertRequested`, `revertBlockedBy` and `rebuildAfterRevert`, as a new
  commit does. `processRevertFromTrain` also clears the flag, with a note,
  on any card that is back in Ready for Testing or Approved
  (`staleRevertRequest`): every send-back moves the card to Backlog in the
  same write. `revertBlockedBy` names only the card's own project's tickets
  (`sameProjectIds`); a commit that reached the train through a main merge
  belongs to a ticket nobody on this train can send back. The Staff Kanban
  E2E loop raises one auto-fix ticket per failing case, naming every
  viewport it failed at (`groupByCase` in `scripts/kanban-e2e-heal.js`),
  not one per viewport.
Tests: `test/self-heal.test.js`, `test/train-carried.test.js` and
`test/kanban-e2e-heal.test.js` (in `test:train-lock`).

**A ticket is never sent back for a failure main already has (20 Oct
2026).** `kanban-staff-board/` reached main with no line in START-HERE.md's
deploy map, so `bt-handover-docs.test.js` was red on main itself, unseen
(main's push trigger only covered console paths). The train merged that main
in before NBQ1scD9GFEr6YbQxSYX landed, and the ticket was sent back,
reverted and rebuilt twice for a test it never touched. Now, once a
culprit's run has failed for good, `ejectRedCulprits` runs the same workflow
on the main commit that run contained (`mainBaseOf`: the merge base) before
acting — `baseCheckAction` decides: green there → sent back as before; red
(attempt 2, or attempt 1 re-run once) → **held**: the card stays where it
is, gets one note "Not sent back: main is broken, not this ticket" with the
failing test, and nothing is reverted; no run yet → started on exactly that
commit through a throwaway `train-base/<sha>` branch (no workflow runs on a
push there; it is deleted once read), waited on, and after an hour without a
run the card is sent back as before. Keys on `trainTestReruns`:
`<workflow>@<base>:base:<ms>` (dispatched), `<workflow>@<base>:base-red`
(held), `<workflow>@<mainHead>:resync`. While a card is held
(`heldForMain`), a merge of main right after it counts as its evidence
(`evidenceCandidates` with `mainMerges`), and once main's own run is green on
a newer commit the automation merges main into the train
(`syncTrainWithMain`) and re-runs the tests, so the card is re-judged with
the fix and nobody has to click anything. `firestore-rules-test.yml` now
also runs on a push to main for all of `backlog-tracker/**`, every
top-level `*/README.md`, every `board-docs.json` and `.github/workflows/**`.

**Every automatic send-back says why in one line (20 Oct 2026).**
`failureSummaryOf(runId)` reads `gh run view --log-failed` and
`failureSummaryFromLog` picks the failing test and its message (node:assert
FAIL / not ok, vitest, Playwright ✘, else the failing step), e.g.
"deployment train tests: START-HERE.md: the deploy map names every top-level
folder — the deploy map in START-HERE.md does not name kanban-staff-board/".
It is stored as `lastFailureReason.summary` and opens the send-back note as
a `Why:` line. On the board, `public/js/rejection-summary.js` turns the
thread into one line per rejection (automatic send-back, Failed testing,
Eject from train, held for main), newest first, shown above the comments in
the Edit item and Comments modals, and the latest one under the Backlog
card's failure badge. `get_backlog_item` returns the summary too.

**Revert re-tests the train; evidence excludes reverted work (19 Oct 2026).**
After a successful revert the automation starts the train tests on the new
head (`afterRevertDispatches`). A card's test verdict, for the auto-eject
(`ejectRedCulprits`) and the card's chip (`recordCardTrainTests`), comes from
`cardEvidenceRun`: the newest real run on the newest non-stale commit among
the card's own commit and the reverts / generated-only commits directly after
it. A run is stale when a commit at or before it was reverted by a later
commit, so a ticket is never blamed for an ejected ticket's failure.
A card whose every candidate is stale (`onlyStaleEvidence`: `revert(S)` on
a train B, S, L, M leaves L with only runs that held S) is covered by a later
card's green run, since that run held it too. A red run above it can't be
pinned on anyone until it has a verdict of its own (26 Oct 2026: M3Uysw3u was
sent back for a failure Lk5ojZ0t, two cards below it, had caused, because
the scan passed over the cards with only stale runs). So `scanRedTrain`
returns those cards as `unjudged`, and `rejudgeCards` re-tests each one:
`buildRejudgeCommit` reverts the reverted commits (`rejudgeReverts`, newest
first, a Markdown-only collision resolved as in a train revert) on top of the
card's own commit in a throwaway worktree, pushes it to
`train-rejudge/<sha12>`, and the workflow is dispatched there. The card's
`trainTestReruns` records `rejudge@<sha12>:<reverted sha7s>=<commit>`, and
that commit's run is the card's evidence, for the eject and the chip alike;
the eject note says what it was tested without. A second revert below the
card needs a new re-test. When the commit can't be built (a code collision,
or a push GitHub refuses) or the dispatch never produces a run within 20
minutes, the key reads `=none` and the card is passed over as before, so the
train never strands. `train-rejudge/*` branches are deleted once their card
has left the train. A card with no re-test yet borrows the nearest later
non-stale run on the branch (`borrowableShas`) for its chip only; a borrowed
failure is never used to blame the card. A card whose run is red, when the
newest non-stale run further up the train passed, shows that pass and links
it (`laterPassFor`). This is the chip's side of "fixed further up the train",
which already kept `pickRedCulprit` from blaming the card. On 26 Oct 2026
four Retail Media cards read "failed" under a green head, and approving them
asked for the tests to be acknowledged.

### Late arrivals (wPoSOXfp8Em06Vzp3Cz7, 15 Nov 2026)

On 14 Nov 2026 Backlog Tracker's train was locked at 23:34, its version bump
committed at 23:57, and a ticket still building landed at 00:05 on top of the
bump with a red docs test. Deploy to Main refused ("1 ticket still in Ready
for Testing") until a person sent the newcomer back.

- **Once a project's train is closing** (`trainLocked`, `trainReady`, or
  `trainStatus` deploying / awaiting-human-merge), a patch that becomes ready
  is **not landed**. `processApplyPatch` keeps the patch on the card
  (`patchReady` stays set), sets `buildAfterTrain`, notes it once, and the
  Backlog card shows **"Built — joins the next release"**.
- The first automation run after the train merges lands it like any other
  patch: carried onto the new main by `rebasePatchFilesOnto`, rebuilt once
  only if that conflicts. `finishTrain` asks for that run straight away.
- **Never on top of the version bump.** The one exception — a rebuild of a
  ticket the train's own tests sent back (`lastFailureReason.category
  "tests"`, with earlier `deployCommits`), or a re-patch of a card on the
  train — lands as before while the train is only locked, never once the
  deploy is under way.
- Rules: `functions/deploy-queue.js` → `lateArrivalAction`;
  `deferredBuildOutcome` leaves a held patch alone.

### Deploy queue (wPoSOXfp8Em06Vzp3Cz7, 15 Nov 2026)

There was no lock between projects, only the workflow's concurrency group.
On 14 Nov 2026 three trains deployed at once; each bumped `version.js` to
1.5.398, and every one after the first had to merge main, re-bump and re-run
a 33-minute suite. The Backlog Tracker train then sat conflicted for 90
minutes on the `APP_VERSION` line alone (PR #585) and its approved deploy
was dropped.

- **Deploy to Main enters `settings/deployQueue`** (written by the
  automation only), in click order. `processDeployTrain` checks it first.
- **Related trains go one at a time.** Two trains are related when the files
  they change against main overlap, or both change something under a folder
  that ships through the same deploy workflow (`backlog-tracker/` and
  `faq/` → `deploy-backlog-tracker.yml`). `version.js` never counts.
  Unrelated trains (Display Types and PH Website, say) run in parallel as
  before.
- A related train behind another is held with `trainHold: "queued"` and the
  note "Queued behind <project>'s deploy; starts by itself when that merges".
  The header shows **Queued…** and the note. It starts by itself:
  `finishTrain` takes the merged train off the queue and asks for the next
  run.
- **Nothing runs while queued**: main is not merged in, no suite is started
  and no version is bumped. At the head of the queue the order is: merge
  main (resolvers below), push, the train's tests on that head, then the
  bump. So the long suites run **once, on the final head**, and the bump
  is computed from main once. Pushing the bump does make GitHub start the
  same suites again on the train PR (a `pull_request` path filter looks at
  the PR's whole diff, not at the push), on a head that differs by
  `version.js` alone. The deploy does not wait for that repeat
  (`withoutGateTestedChecks`, 16 Nov 2026; PR #613 was green at 19:44 and
  merged at 20:04 after a 30-minute repeat): when the only change since the
  head the gate passed is `version.js`, the PR's checks from the gate's own
  workflows are left out of the wait, pass or fail. Every other check on the
  PR, and every required check (`REQUIRED_TRAIN_CHECKS`), still has to pass.
- **A stalled head is passed over.** A queue head with no progress (its
  status, hold, PR or branch head unchanged) for 60 minutes, or parked on a
  conflict, is passed over: related trains behind it go, it keeps its place
  for a retry, and its note says why. A conflicted entry nobody retries is
  dropped after a day.
- **`version.js` never conflicts.** `tryAutoResolveTrainMergeConflict`
  resolves a conflict confined to the `APP_VERSION` line by taking main's
  file; the bump is recomputed afterwards. Anything else differing in that
  file is left for a person.

### Card state line (RC6wVNJJcPjNTR5hov9W, 16 Nov 2026)

The board held most of what a person needs about a stuck ticket as separate
chips, in notes, or not at all (how long a card had sat in its column, a fire
being retried, a rebuild waiting for the release, why Deploy to Main was
missing), and agents explained it after the fact ("Stuck on a stale flag, not
a code problem", about 5 hours). Now:

- **Time in column.** `backlogItems.statusEnteredAt` is stamped with the
  server clock on every status change by every writer (board, MCP,
  automation, Cloud Functions) by one trigger, `onBacklogItemStatusEntered`
  in `functions/index.js`; a writer that stamps it in the same write is left
  alone. Cards without it fall back to `updatedAt`, then `createdAt`;
  `scripts/backfill-status-entered.js` (dry run by default, `--apply` to
  write, idempotent) copies `updatedAt` onto non-archived cards. The card
  shows the age beside the type badge ("2 h", "3 d"), in the warning colour
  past its column's threshold. The thresholds are one exported table,
  `AGE_THRESHOLDS` in `public/js/card-state.js`: Backlog blocked on a
  person 24 h, building 2 h, Ready for Testing 24 h, Approved 12 h.
- **One status line per card.** `cardState(item, project, now, ctx)` in
  `public/js/card-state.js` (plain ESM; `functions/card-state.js` is its
  generated CommonJS copy, `scripts/gen-card-state-cjs.sh`, and a test fails
  if they drift) returns `{state, line, waitingOn, since, ageMs, warn,
  action}`, `waitingOn` being one of nobody, tester, approver, decision,
  automation, another ticket, another project. The card shows the line as
  its first row under the title. It replaced the plain "Coming off the
  branch…", "Still on the branch — blocked by…", "Revert requested — locked"
  and "Waiting for Deploy to Main" lines; the detailed chips (blocked flag
  with Answer, round chip, build order, train tests, Sent to Claude with its
  heartbeat) stay. Examples: "Building · testing · heard from 3 min ago",
  "Queued: builds after <title>", "Waiting for your answer · 2 d", "Ready to
  test · round 2 · 5 h", "Approved · waits for <title> to be approved",
  "Rebuild waits for this release to merge", "Being taken off the release ·
  blocked by <title>", "Deploying · tests running 12 min", "Live · deploy
  checked". Every status × flag combination maps to exactly one line
  (`test/card-state.test.mjs` enumerates them). A field from a later ticket
  that a card lacks is simply absent; the function still answers.
- **The header says why Deploy to Main is not offered** (`deployGate` →
  `deployGateHintHTML` in `app.js`): "Deploy to Main appears when <title> is
  approved or sent back", "…when the revert of <title> finishes", "Tests
  failing: <workflow> — <ticket> is being sent back" (or "nobody is pinned as
  the cause yet"). The queued case keeps its own "Queued behind …" line. A
  stuck train adds how long it has been stuck.

### Needs attention (RC6wVNJJcPjNTR5hov9W, 16 Nov 2026)

A section on the **Dashboard** (`#dashboard`) and on no other page
(kBJU2GCKW9S6XGWTwK8T, 17 Nov 2026; it used to sit above the projects on the
Agent Board): above the KPI tile sections, in normal flow (nothing
`position: fixed`), collapsed to "Needs attention 0" and "Nothing waiting on
you." when empty. It is drawn from the tickets the console already holds and
redraws as cards change, with no Firestore listener of its own.
It lists, across all projects, everything waiting on a person (tester,
approver, decision) or stuck past its threshold, oldest first:
ticket or train, its status line, who it waits on, its age, and one button
for the usual next action — Answer (the blocked flag's Answer dialog, opened
on the Dashboard); Open, Approve and Test open the Agent Board and scroll to
the card (Test also opens the card's test link in a new tab, when it has
one); Deploy opens the Agent Board and starts the project's own Deploy to
Main, only when the header offers it, otherwise it scrolls to the project. **Waiting on me** narrows it to cards the signed-in member filed
(and that wait on a person) or, for an editor or admin, everything waiting on
a tester or approver. `needsAttention()` and `waitingOnMe()` in
`card-state.js`; the same list is `get_pipeline_health` over MCP.

### Stuck trains (RC6wVNJJcPjNTR5hov9W, 16 Nov 2026)

Five train states had no clock and no alert (a train red from 05:10 to 20:25
on 29 Oct 2026): `trainStatus` "conflict", "awaiting-human-merge",
`trainHold` "tests-red" (or `trainTestsRed`) with no ticket pinned as the
cause, a locked train with an unapproved ticket, and a revert blocked by a
later ticket (`revertBlockedBy`). Every automation pass
(`sweepStuckTrains` in `run-backlog-automation.js`, deciding with
`trainStuckPatch` in `card-state.js`) stamps `projects/{id}.trainStuckSince`
and `trainStuckReason` when one starts, `trainStuckEscalatedAt` once it has
lasted 2 hours (locked with an unapproved ticket: 12 hours,
`TRAIN_STUCK_THRESHOLDS`), and clears all three when it ends; a different
reason restarts the clock. Past its threshold the train appears in Needs
attention with the reason. The escalation write makes `onTrainStuckEscalated`
(`functions/index.js`) post **one** message through the existing notify
channel (`NOTIFY_WEBHOOK_URL`, normally Slack); with no webhook configured the
Needs attention strip is the alert (the row shows a bell icon). No repeats
within a spell.

### Shared files between trains (wPoSOXfp8Em06Vzp3Cz7, 15 Nov 2026)

Nobody could see that two trains touched the same files until
`trainStatus: "conflict"` at deploy time (14 Nov 2026: all three trains
changed `MCP.md` and `version.js`; 6 of 98 main-into-train merges since
20 Oct conflicted).

- **When a patch lands**, its files are compared with every other project's
  live train (`git diff --name-only origin/main...origin/deploy/<other>`).
  Each overlap is written to the ticket as `sharedWith` and one note names
  the files. The card shows **"Also changed on <project>'s train"**
  (Material Symbols `call_split`; hover lists the files) in Ready for
  Testing and Approved, and the project header shows **"Shares files with
  <project>'s train"** while any card has it.
- The two train tips are also merged with `git merge-tree`. If they
  conflict, the chip is in the warning colour and reads **"Conflicts with
  <project>'s train: <files>"**, so it is fixed before either is approved.
- **Owned paths.** `projects/{id}.ownedPaths` lists the repo-relative
  prefixes a project owns (default: its `repoFolder/`; editable on the Docs
  page under the repo folder). Defaults: Backlog Tracker & FAQs
  `backlog-tracker/`, `faq/`, `docs/`, `CLAUDE.md`, `.github/workflows/`;
  Staff Kanban `kanban-staff-board/`, `backlog-tracker/functions/kanban`,
  `backlog-tracker/public/js/kanban/`, `backlog-tracker/public/css/kanban.css`;
  PH Website `ph-website/`. The longest matching prefix owns a file. A
  landed patch that changes a file another project owns gets
  `foreignPaths`, a note and the chip **"Changes <project>'s files:
  <paths>"**, so the tester knows that project's train will need a sync. A
  warning, never a refusal.
- Rules: `functions/deploy-queue.js` (`sharedWithEntries`,
  `foreignOwnedPaths`, `parseMergeTreeConflicts`); view:
  `public/js/train-overlap.js`.

### Build order (14 Nov 2026, ticket ZE8h8cfaezOb0eTsRjSH)

A Ready for Dev click used to start one session per ticket, four at a time,
in array order, all from the same base. Nothing decided order: 104 tickets
(8%) carry "Not built: since this patch was written … changed … in the same
places" because siblings built in parallel collided, and dependants were
sent before their dependency and wasted a session. The rules, all in
`functions/build-order.js` (pure, shared by the trigger, MCP, the automation
and `test/build-order.test.js`):

- **Dependencies are data at intake.** On a create or a description edit
  (board, MCP `create_backlog_item` / `update_backlog_item`, the intake
  trigger `onBacklogItemDependencies`), the Dependencies section is read:
  20-character ticket ids (any project; an id that names no ticket stays
  prose) and the exact titles of open tickets in the same project (quoted,
  or verbatim for a title of four words or more). They are stored in
  `dependsOnItemIds` with `dependsOnSource: "intake"`. Intake replaces only
  its own list; a list a build session (`"build"`) or a person
  (`"manual"`) set is merged, never overwritten. A reference that would
  close a loop is left out.
- **Settable by hand.** Edit item → **Builds after** searches open tickets
  (this project first) and refuses a loop with the loop named ("A waits for
  B waits for A"). MCP `create_backlog_item` / `update_backlog_item` take
  `dependsOnItemIds` with the same check; `get_backlog_item` and
  `list_backlog_items` return `dependsOn` (id, title, status).
- **A click builds in order** (`notifyOnProjectReadyForReview`, so the board
  click, `send_to_build` and a Groom package batch alike): a ticket whose
  dependency is in the same click, or still in Backlog, is not fired but
  held (`blocked: {reason: "waiting-on-dependency", note: "Waiting for:
  <titles>", setBy: "build-order"}`) and released by `releaseDependents` /
  `sweepDependencyWaits` when the dependency reaches Ready for Testing. A
  dependency on the train, approved or live (or archived, or deleted) holds
  nothing. When a held ticket's dependency was not sent and is not
  building, the click says so: `projects/{id}.notifyRoutine.buildOrder`
  `{summary, heldItemIds, queuedItemIds, notSent, at}` ("2 held: they need
  "X", which was not sent"), shown beside the Ready for Dev button for two
  hours; when nothing could start, `notifyRoutine` is an error saying that.
- **Same-area tickets go three at a time; different areas stay parallel.**
  Tickets that share a groom area (`groomAreas`), a file path (by file name;
  `index.js` and the like keep their folder; Markdown files don't count), a
  named function (camelCase, eight characters or more) or a quoted spec
  section (`→ "Section"`) in their Outcome or Spec reference form a lane.
  A lane fires its first three tickets (`LANE_WIDTH` in
  `functions/build-order.js`; priority high → medium/unset → low, then
  oldest first) and queues the rest, each behind the ticket three places
  ahead of it (`queuedAfter`; the card shows "Queued: builds after <title>",
  not blocked, no Answer button). Builds an earlier click is still running
  count towards the three. Until 16 Nov 2026 a lane built one at a time:
  seven flaky-test tickets sent in one click were a six-hour chain, although
  each changed a different test case. Two lane-mates built side by side
  collide only when they change the same lines (a patch is carried onto the
  train by a three-way merge); that ticket is rebuilt automatically against
  the train as it then is, which takes no longer than the wait it replaced.
  Order that matters is a dependency, not a lane.
  `sweepBuildQueue` (every automation run) starts a queued ticket when the
  one ahead of it lands, fails (its current attempt reports error or done
  without a patch, its fire failed, or it is blocked), is archived or
  deleted, or after three hours; it builds on the train tip after that. A
  report from before the ticket's latest fire is the previous attempt's and
  does not count: the ticket is being rebuilt, so the one behind it keeps
  waiting (16 Nov 2026: it was let go and queued again every run, 139 notes
  in three hours and no build). The queue writes one note per card, replaced
  each time.
  Lanes are decided without a model call. `FANOUT_CONCURRENCY` (4) still
  caps how many fire at once.
- **Deadlock check.** `sweepDependencyWaits` rewrites a waiter's flag when a
  dependency is itself blocked on a person: "Waiting for <title>, which is
  blocked: it needs a decision …" (`blocked.stuckOn`), and restores it when
  that is settled. An archived or deleted dependency releases the waiter
  with a note. A loop a build session created is flagged on every ticket in
  it as a question (`waiting-on-input`, setBy `dependency-cycle`, never
  auto-answered or turned back into a wait).
- **Fire text.** A fired ticket's prompt lists "Already landed and in your
  base: …" — each dependency on the train or live, with its commit — so the
  session reads those commits instead of rediscovering them.
- **Card.** A Backlog card with dependencies still in Backlog shows "After:
  <title>" (+N); the hover lists every dependency with its status.
- **Rules.** Browsers may write `dependsOnItemIds` (a list of at most 20
  strings); `dependsOnSource` and `queuedAfter` are pipeline fields.

Ticket ZmEWDC40NYOiojehfPjk (owner scoping) builds on this: it adds owner
permissions and the contract-change flag, not a second link field.

### Flaky tests: retry once, record, ticket at three

**A red train means a real defect (14 Nov 2026).** Between 24 Oct and 14 Nov
the console suite failed 44 of 352 runs, and 21 of the 23 failures with a
readable log were Playwright timing, not defects. Each cost a 33-minute
re-run of everything. The rules now:

- **Only UI tests retry, once, inside the run.** A Playwright-driven case
  that fails is run once more in the same run: `test/ui/flaky.mjs`
  (`retryCase`) for the console click-through scenarios, the Staff Kanban
  suites' own `withRetry` (console and prototype), and `test/ui/run-ui.mjs`
  for the small UI files, which re-runs the file. A pass on the retry does
  not fail the run. A failure on the retry fails it as before. Unit, rules,
  MCP and docs tests never retry (`test/ui-retry.test.mjs` checks both).
- **Every flake is written down.** The run uploads a `flaky-tests-<job>`
  artifact (`flaky-tests.json`: suite, case id, viewport, first failure) and
  its job summary says "Flaky this run: TC-55 desktop-1280, passed on retry".
- **The board keeps a ledger.** After each train test run the automation
  (`sweepFlakyTests`, logic in `scripts/flaky-ledger.js`) reads the artifacts
  of the finished `firestore-rules-test.yml` and `kanban-staff-board-tests.yml`
  runs it has not read yet and updates `settings/flakyTests`:
  `{ cases: [{ id, suite, profile, count, seenAt[], lastSeenAt, lastRunUrl,
  lastError, ticketId }], processedRuns[], updatedAt }`, the 50 most recent
  cases, keyed by case id so one case's viewports count together. Members
  read it; only the automation (service account) writes it.
- **The health strip shows it.** "Flaky tests: N this week" (flakes in the
  last 7 days) at the end of the pipeline health strip; with any, it is a
  button that opens the list of cases (count this week, viewport, last seen,
  last run, ticket). With none it reads 0 and opens nothing.
- **Three flakes of one case in 7 days file ONE Backlog bug** in Backlog
  Tracker & FAQs, titled "Flaky test: <case>", with the four intake sections
  filled. Never a second while one is open (Backlog, Ready for Testing or
  Approved for Deployment). It is not started automatically.
- **A wall-clock limit never decides a train.** KB-SCALE times the 2,000 and
  5,000-ticket boards against the 39-ticket board on the same runner and
  limits the ratio; cases wait on the condition they assert (`eventually`,
  `until`), and the harness waits for the console to have started before a
  case's first selector (`appRendered`).
- **Each test file runs in exactly one job of one workflow per train.** The
  console workflow runs as five parallel jobs, each with a time limit:
  `rules` (emulator), `offline` (unit, MCP, train, docs), `ui-console`,
  `ui-touch`, `ui-kanban`. `ui-touch` runs as three parts and `ui-kanban`
  as four, side by side (16 Nov 2026: the run took 28 minutes because
  `ui-kanban` did, and one deploy waited for it up to four times). A part is
  every n-th file (`UI_SHARD=i/n`, `test/ui/run-ui.mjs`) or every n-th
  profile of the viewport matrix (`KB_SHARD=i/n`, `profiles.mjs`), so the
  parts together run every file and every case in every profile exactly
  once; `test/ui-shards.test.js` fails if the workflow's part count and its
  `i/n` disagree. The train still reads the workflow's one
  conclusion. `firestore-rules-test.yml` owns the console's Staff Kanban
  suite (`test/ui/staff-kanban.test.mjs`); `kanban-staff-board-tests.yml`
  owns the prototype suite (`kanban-staff-board/test`) and starts only for a
  `kanban-staff-board/` change, no longer for every `backlog-tracker/` one.
  `test/ci-coverage.test.js` fails on a file in two jobs or a job with no
  timeout.
- **The run the automation dispatches on the train's head commit is the
  gate.** The `pull_request` runs GitHub creates on a bot-opened train PR are
  held as `action_required` and may never execute (PR #585). They are neither
  a pass nor a failure and nothing waits for them; `approveHeldRuns` stays as
  best effort (`test/train-housekeeping.test.js`).
- **`train-base/*` branches are deleted** once their run has a conclusion
  (after 10 minutes, so the base check is read first) and in any case after
  24 hours (`sweepBaseRefs`; first-seen times in
  `systemStatus/pipeline.trainBaseRefsSeen`).

**A failed train test is re-run once (19 Oct 2026).** `trainRunVerdict(run)`
returns `running`, `passed`, `rerun` (failure / timed_out / startup_failure
on attempt 1), `failed` (the same on attempt 2+) or `none`; "once" is
GitHub's `run_attempt`, no card field. `ejectRedCulprits` re-runs the
culprit's deciding run (`rerunTrainRun`, `gh run rerun <id> --failed`, never
twice per sweep) and notes the card, and sends it back only on `failed` (or
if the re-run cannot start, saying so). A pass on attempt 2+ after the
automation's re-run puts a "Passed on re-run" note on the card. In
`reportTrainTestResults` a `rerun` head run counts as still running;
`trainFailureNotes` decides the notes from who owns the tested commit.
`backlogItems.trainTestReruns` (automation-written, last 20) records the
re-run **per run**: `<workflow>@<sha>:rerun:<runId>` when the automation
re-runs a run and `<workflow>@<sha>:flaky:<runId>` when it then passes, with
`<sha>` the run's `headSha`. That is the card's own commit or, for a DSP
ticket, the generated-only prototype rebuild after it, so
`reportTrainTestResults` stamps the key on the card that `trainRunOwner`
attributes the run to, not only on the card whose `deployCommit` equals the
sha. Keys written before this are the bare `<workflow>@<sha>:rerun` /
`:flaky` and still count. A run on a stale commit (one a later revert made
stale, see above) is not re-run: the card is judged on the newer run. The
keys only stop duplicate notes and tell the hand-off a re-run is pending;
they are not a pipeline field and `firestore.rules` is unchanged.
`rerunPending(card, shas)` matches a key on any commit attributed to the card
(`deployCommit`, the non-stale `evidenceCandidates`, its newest
`deployCommits` entry), supplied by `attributedShasFor` for the hand-off.

**The train is brought up to date with main before any ticket lands (1 Oct
2026).** `processApplyPatch` now calls `syncTrainWithMain` first: a train
with no ticket of its own is fast-forwarded to main; a train carrying
tickets gets main merged in (same derived-file resolvers as the Deploy
step), and a real conflict is surfaced on the card and the project right
then — the item stays patch-ready and lands by itself once a person
resolves the branch. Because a Routine hands back whole files it read from
the branch, `rebasePatchFilesOnto` then carries each file's edits onto
whatever the sync brought in with a three-way merge (base: the branch tip
before the sync; ours: the synced file; theirs: the Routine's file), so
main's newer content is never silently overwritten; an edit that collides
with main's clears patchReady with a note asking for a rebuild. This is the
fix for the 30 Sep 2026 incident (ticket Hdt4M6dEGe7uN8dmS8mT): the train
sat four commits behind main, the ticket's full-file patch landed on the
stale base, and Deploy to Main stopped on a conflict in
`backlog-tracker/MCP.md` that a person had to merge by hand. Tests:
`test/train-sync.test.js`.

**Append-only conflicts keep both additions (29 Oct 2026).** When the
three-way merge in `rebasePatchFilesOnto` conflicts on a path in
`UNION_MERGE_PATHS` (`backlog-tracker/test/**/*.test.{js,mjs}`, `**/*.md`),
the file is merged again with `git merge-file --diff3` and every conflict
hunk is checked: if each side's lines are the base's lines with lines added
(no base line changed or removed), the hunk becomes the base with both
sides' additions, the branch's before the patch's, and an addition identical
on both sides kept once (`unionInsertedLines`). In the pinned tool list of
`test/mcp-client.test.mjs` (`UNION_MERGE_LISTS`) the same rule applies name
by name, a name going onto the line of the name before it and the gap kept
sorted when every side was sorted (`unionInsertedListNames`). The file is
used only if every hunk resolves and, for JavaScript, the result passes
`node --check` (`parsesAs`); otherwise it is the same-lines conflict it was,
and the ticket rebuilds. A union-merged file counts as rebased, and
`rebasePatchFilesOnto` returns it in `unioned` (`{path, hunks}`), which the
card's "Committed to …" note lists as "Union-merged …" (`unionMergeNote`).
Not covered: Cloud Functions code such as `functions/kanban.js`'s tools
array, and merging main into a train (`syncTrainWithMain`, Deploy to Main).
Evidence: Staff Kanban, 29 Oct 2026 — 8 parallel tickets each appended to
the same files; one landed per round, the rest rebuilt, about 4 hours lost.
Tests: `test/train-sync.test.js`.

**Automatic rebuilds after a refused patch are requested, not started**
(19 Oct 2026, ticket mLCZgemj4wQEW6PTQru1; evidence: OanRebXyEryAXBQrBsVe,
whose rebuild after a migration-number clash never ran because the Routine
fire endpoint answered 429, and `autoRebuilds` of 1 meant nothing retried).
A refusal that rebuilds (migration clash, same-lines conflict, unfilled
intake section, unmet docsImpact; also a released dependant) writes a note
saying the rebuild was *requested*, and `flushBuildRequests` stamps
`rebuildRequestedAt` on the card before the project write. The function
records each fire's result on the card as `lastFire` (surviving the next
request overwriting `projects/{id}.notifyRoutine`). A 429, a 5xx or no
answer is `retrying`: the sweep (`sweepRebuildRequests`) re-requests it once
`nextAttemptAt` passes — 3 attempts, 5 then 10 minutes apart; other 4xx are
`failed` immediately. Fires are spaced 1.5 s apart and, after a 429, the rest
of the batch is deferred (up to 6 deferrals) rather than fired into it. Each
sweep, a Backlog card whose `rebuildRequestedAt` is over 30 minutes old with
no session started since and no patch handed over is first asked for again
(up to `REBUILD_START_RETRIES` = 2, counted in `rebuildStartRetries`; 25 Oct
2026). A started session that goes quiet is restarted once
(`buildSessionRetries`), then marked `buildSession.status: "error"` with a
note, which releases the project's hand-off (`sweepSilentBuildSessions`);
"quiet" is judged from the session's heartbeat, not its start time — see
"Heartbeats and build attempts" below. A
dispatched baseline check on main that is still running after
`BASE_CHECK_GIVE_UP_MS` is treated as never run and the culprit is sent back.
Only then does a card get one note — "The
automatic rebuild requested at <time> never started (<error>). Click Ready
for Dev to build it again." — and `rebuildRequestedAt` is cleared, so it is
posted once. Tests: `test/rebuild-requests.test.js` (which cards are
noted, the wording), `test/notify-fanout.test.js` (retry policy, `lastFire`).

#### Heartbeats and build attempts (stuck detection, 14 Nov 2026)

A build session that died (container restart, timeout) used to be noticed
after 75 minutes and restarted after 90, and the restart often overlapped a
session that was only slow: "hasn't reported back" notes were on 39 tickets
and "A second build session" notes on 14. The rules, all in
`functions/notify-routine.js` (pure) and applied by `sweepSilentBuildSessions`:

- **Heartbeat.** Every build session PATCHes `buildSession.heartbeatAt`,
  `buildSession.phase` (`reading`, `building`, `testing`, `packaging`) and
  `buildSession.attemptId` on its ticket when it starts, at each phase change
  and at least every 10 minutes while a long command runs. The fire text
  carries the rule (`heartbeatHint` in `functions/index.js`) and so does
  `ROUTINE_INSTRUCTIONS.md` → "Heartbeat and build attempt". Only the
  automation/Routine identity may write these fields (`firestore.rules`,
  `itemPipelineFields`).
- **Silence is measured from the heartbeat.** No first heartbeat within 10
  minutes of `lastFire.at` (`FIRST_HEARTBEAT_MS`): started again, with one
  note. A heartbeat and then none for 20 minutes (`HEARTBEAT_SILENT_MS`):
  one note, "Build session went quiet 20 minutes ago during <phase>; starting
  it again", then started again. A session that is beating is never
  restarted, however long it runs, up to 3 hours from its fire
  (`BUILD_CEILING_MS`); at the ceiling the card is flagged waiting on a
  person (`blocked.reason: "waiting-on-input"`) and nothing is restarted.
  The retry cap is unchanged: one restart (`BUILD_SESSION_RETRIES`), then the
  card is marked errored and flagged.
- **A fire from before heartbeats** (no `lastFire.buildAttemptId`) was never
  told to beat and keeps the old rule: restarted after 90 minutes of no report.
- **No duplicate builds.** Each fire that starts a session gets a
  `buildAttemptId`; the card stores the current one. A heartbeat from an
  earlier attempt's session does not count, so a superseded session cannot
  hide the new one's silence. A session reads its card before packaging and
  stops with a note if `buildAttemptId` is no longer its own or the card has
  gained a `deployCommit` since it started; it sends `patchAttemptId` with
  its patch, and `processApplyPatch` refuses a patch whose `patchAttemptId`
  differs from the card's `buildAttemptId` (`staleAttemptPatch`): nothing
  lands, the patch files are dropped, one note is written and no rebuild is
  started, because the current attempt's session is the one being waited for.
  A patch with no `patchAttemptId` (hand-made, or from an older session) is
  not stale. `inFlightItemIds` also treats a beating card as in flight
  however old its fire is, so a further Ready for Dev click never starts a
  second session for it.
- **The project record** (`notifyRoutine`) stays open past the 75-minute
  stall window while a sent card is still beating (`notifyRoutineOutcome`),
  up to the same 3-hour ceiling.
- **The card.** While building, the "Sent to Claude — locked" line adds the
  phase and the age of the last heartbeat ("Testing · heard from 3 min ago");
  after 10 minutes without one that line turns to the warning colour
  (`--warning`). A card whose session is beating stays locked past 75
  minutes. The project header's "Build didn't report back N" chip counts
  heartbeat-silent sessions (no first heartbeat in 10 minutes, or none for
  20) as well as the tickets of a stalled record.
- **Build sessions run the affected tests; the train runs everything.** A
  session runs the suites for the paths it changed plus the fast offline
  checks (`npm run test:fast`, and `npm run test:fast-ui` for a
  `backlog-tracker/public/` change), not every suite in the repo. The long
  suites are train-only unless the ticket touches them: the ph-website tour
  (`ph-website/tests/tour.test.mjs`, 10+ minutes) and the Staff Kanban
  viewport matrix (`test/ui/staff-kanban.test.mjs`; a session runs its quick
  profiles). `BUILD_SESSION_FAST=1`, set only by those two commands, is what
  skips them; CI and the train never set it. The build note lists what was
  and was not run.

Tests: `test/build-heartbeat.test.js` (the windows, the notes, the ceiling,
the stale-attempt refusal through the real `processApplyPatch`),
`test/notify-fanout.test.js` (the fire carries the attempt id and the card
stores it), `test/ui/console-click.test.mjs` ("Build heartbeat" scenarios),
`test/firestore-rules.test.js` (a browser cannot write the heartbeat or
either attempt id).

**Every ticket a project builds is one commit on that project's single
long-lived integration branch, `deploy/<project-slug>`** (on the project
doc as `deployBranch`, created from `main` on first use). There is no
per-ticket branch and no per-ticket PR.

The old model gave each ticket its own branch cut from `main`, so two
tickets alive at once drifted apart and nothing in the pipeline ever
brought them back together — the Routine has no push credential by design,
and the merge step only ran `gh pr merge`. The second PR to merge was
therefore conflicted, the merge failed, the card sat in Approved for
Deployment with a note, and a human resolved it by hand (PR #77, then #141
and #139 on 15 Sep 2026). `version.js` made it structural rather than
occasional: every PR bumped `APP_VERSION` on the same line, so *any* two
open PRs conflicted on that file alone.

Requirements that follow from it:

- **Build on the branch head, never on `main`.** `patchFiles` are
  full-file overwrites, so a fired session must read every file it
  overwrites from `<deployBranch>`, not `main` (see
  `ROUTINE_INSTRUCTIONS.md` step 3) — otherwise its commit silently
  reverts whatever landed on the branch since. The commit message carries
  a `Backlog item: <id>` line, so exact-id lookup works via
  `git log --grep` and needs no GitHub API.
- **A re-patch appends, never rewrites.** `deployCommits[]` grows;
  `deployCommit` is the latest. History on a shared branch is never
  rewritten and the branch is never force-pushed, except by the post-merge
  reset (with `--force-with-lease`).
- **One version bump per deployment, not per ticket.** `processDeployTrain`
  reads `APP_VERSION` off `main`, increments the third number and commits
  that on the branch just before opening the PR. Tickets must not include
  `version.js` in `patchFiles`.
- **Nothing leaves Ready for Testing rejected without coming off the
  branch.** A card in Backlog must never have live commits on a train, or
  a rejected ticket ships in the next deploy anyway. Failed testing writes
  `revertRequested`; `processRevertFromTrain` reverts the card's commits,
  newest first, and pushes. If a later ticket built on top of it the revert
  conflicts: nothing is force-pushed, the card is still sent back, and
  `revertBlockedBy` names the tickets a human must decide about (send them
  back too, or fix the branch by hand). The card shows that state, and
  Deploy to Main stays hidden until it clears.
- **A card carried by a sibling's commit follows that train.** A
  shared-file batch delivers two tickets' content in one commit, so the
  second ticket's `patchFiles` produce no diff against the branch. That
  card has no commit of its own, but its change IS on the branch — inside
  the sibling's commit — so `processApplyPatch` stamps it with that commit
  (`carryingCommitOnTrain()`: `deployCommit` = the carrying sha, plus
  `carriedByCommit`/`carriedByItem` as the explicit marker, and never
  `deployCommits`, which is what a revert takes off) and it is on the train
  like any other ticket — checkbox approval, Failed testing, "Waiting for
  Deploy to Main", a test link pinned to the carrying commit (never a
  branch URL, which githack caches), and `finishTrain` flips it to
  `published-live` when the train merges, not before. Until 25 Sep
  2026 the no-diff path flagged such a card `noDeploymentRequired` instead,
  which handed it the board's one-click "Confirm tested — mark Merged to
  Main": OhKUnoGbpUAeJiXiLIvc and yUISCow4tCg9uxnMJFOy read Deployed / Main
  Branch (Live) while their code sat unmerged on
  `deploy/backlog-tracker-faqs` inside 419bb79 (ORUeAQ4b3vmv2EhEni5O's
  commit, which reached `main` later as PR #211); the Deploy run flagged
  both. Consequences: Failed testing on a carried card never reverts the
  sibling's commit — `processRevertFromTrain` detaches the card (it becomes
  a plain Backlog ticket) and names the ticket to send back if the content
  itself must go; reverting the carrying commit sends every card riding on
  it back to Backlog too (`detachCarriedCards`); a card that gets a commit
  of its own on a re-patch stops being carried; and a no-diff whose
  carrying commit carries THIS card's own `Backlog item:` trailer (pushed
  by hand, never stamped) is adopted as its train commit. The no-diff path
  sets `noDeploymentRequired` only when the branch does not change the
  patched files at all — the content is already on `main`, so "nothing to
  deploy" is true. `test/train-carried.test.js` pins all of this.
- **Deploy merges the whole branch, so it is offered only when the whole
  branch is approved.** See "The single Deploy CTA" below.
- **`trainReady` is written by the Routine, not by the service account.**
  This distinction matters in `firestore.rules`: guarding every train field
  as "only writable by something that bypasses rules" silently denied the
  Routine's own `trainReady` PATCH, so Deploy to Main fired the Routine,
  the Routine was refused, nothing was dispatched, and the card sat in
  Approved for Deployment while the button spun and reverted. Fixed by
  letting the board automation account through that guard; the two human
  editor accounts are still held to it.
- **The only conflict path left is `main` moving under the branch**, which
  takes someone pushing straight to `main` in this project's files. It is
  never resolved automatically — the merge aborts, `trainStatus` goes
  `conflict` with a `trainNote`, and nothing is merged or moved — except
  for two derived files that are rebuilt rather than merged:
  `faq/data/index.json`, and a checked-in build output both sides rebuilt
  (`GENERATED_BUILDS`). For the build output the train's copy is taken
  from `HEAD:<path>`, never from the index's "ours": when both sides
  rebuilt under different hashed names git reports rename/rename and
  writes a two-way merge with conflict markers into both names, which is
  what `git checkout --ours` kept on 25 Sep 2026 and shipped as a bundle
  that threw on load (PR #216; the hosted DSP prototype was blank until a
  forced rebuild twelve hours later). The resolver now refuses if any
  output still carries a marker and spoils the build stamp so the next
  scheduled rebuild regenerates the bundle from the merged source.
- **A train carrying a `.github/workflows/` change is never merged by the
  pipeline** (`needsHumanMerge`): the PR is left open at
  `trainStatus: "awaiting-human-merge"`, and `reconcileMergedTrains` records
  every ticket as live on its own once GitHub reports the merge — no second
  click.

### Staff Kanban E2E on every train (self-healing)

- A train whose diff against main touches `backlog-tracker/` or
  `kanban-staff-board/` runs the console's Staff Kanban suites
  (`staff-kanban`, `kanban-mcp`, `kanban-rules`, inside the console tests); one
  that touches `kanban-staff-board/` also runs the prototype e2e suite. Since
  14 Nov 2026 a `backlog-tracker/`-only change no longer starts the prototype
  suite: it reads nothing there, and the test plan ran twice per train. They
  run at each stage: on each landing in Ready for Testing, on each push to the
  train, and as the gate before Deploy to Main. Any project's train, not only
  Staff Kanban's.
- A failing case (after the single automatic re-run) is raised as a bug ticket
  (`e2eAutoFix`: case id, viewport, failure, run, causing ticket; label "E2E
  auto-fix"), approved for development and sent to build automatically, and
  built onto the SAME train branch. The suite re-runs; the loop repeats until
  green. The fix card is approved by the green run.
- A fix ticket never blocks a card or a workflow. Only Deploy to Main waits for
  green. Original tickets and fixes merge together in one PR.
- Safety stop: a case still failing after 3 fix attempts is flagged for Rob
  (`flaggedForRob`, with the attempt history) on the fix card and the causing
  ticket; the rest of the train keeps going.
- Visibility: the project header shows `kanbanE2e` — running, healing n bugs,
  green or flagged — with the per-suite detail on hover; auto-raised tickets
  carry the "E2E auto-fix" label.
- A red the heal owns is not also ejected by `ejectRedCulprits`.

## Approving out of Ready for Testing

**The checkbox is the approval.** A Ready for Testing card has one CTA —
**Failed testing** — and a checkbox; ticking it (or the column header's
select-all) and clicking the project's **"Approved for Deployment — N
selected"** is what advances it to `ready-to-publish`.

This replaced two gates standing between a tested ticket and Approved for
Deployment: a per-card `testPassed` flag set by a "Confirm tested" click,
*and* the checkbox, which narrowed the batch but did nothing at all until
the tick was there. Two controls for one decision. **No copy changed** —
every column label, button label and hint reads exactly as it did; what
changed is which control approves.

- **Only ticked items are approved.** The "an empty selection means
  everything" rule that Backlog's Ready for Dev button uses is deliberately
  *not* shared here: with no tick and no `testPassed`, an empty selection
  carries no signal that anyone looked at anything. Over-firing a build is
  cheap; over-approving a release is not.
- Nothing ticked → the button is hidden, per the same
  hidden-when-nothing-to-do rule every CTA on this header follows (and
  exactly what it did before when nothing was `testPassed`).
- **Failed testing has two outcomes** (dialog select "What happened?",
  `public/js/follow-up.js`). **"Something's wrong — send it back"** (the
  default) behaves as it always has: Backlog, `revertRequested`,
  `lastFailureReason` and the "Failed testing [category]" note; the reason
  category applies to this choice only. **"It works, but I want something
  more"** leaves the card in Ready for Testing with its commit on the train
  (it can still be approved) and, in one `writeBatch`, files a new Backlog
  ticket (same project and category, `type: "feature"`, `followUpOf` = the
  original's id, Dependencies and Spec reference naming the original) plus a
  note on each card. Nothing else is written on the original.
- **Failed testing is always offered** on a Ready for Testing card (it used
  to hide once "Confirm tested" had been clicked; there is no such click
  now). Its **send it back** choice writes `revertRequested` (see "The
  deployment train" above); **It works, but I want something more** does not:
  the card keeps its status and commit and the details become a new
  Backlog ticket. It now also asks for a structured reason category
  alongside the free-text explanation (`lastFailureReason`,
  XJoASicLGefL5c9fronl — see "Structured Failed testing / Eject from train
  reason" below).
- A **genuine** no-deploy card — `noDeploymentRequired` with nothing on any
  train (`isNoDeployCard()` in `app.js`) — is untouched by all of this: no
  checkbox, and it keeps its own separate "Confirm tested — mark Merged to
  Main" button straight to `published-live`. A card that has a
  `deployCommit`, its own or a sibling's it rides on (`carriedByCommit`),
  is a train card whatever the flag says: checkbox, Failed testing, and
  live only when the train merges.
- **Pulling a ticket back out after approval** has two paths now. The
  **← back arrow** on an Approved for Deployment card still sends it to
  Ready for Testing exactly as it always has — its commit stays on the
  branch, which is correct — and **Failed testing** there does the revert
  and the send-back, same two clicks as before, still the right path when
  the ticket genuinely needs another look. **Eject from train**
  (FVrOIVAAp46NdcgGovMW) is the new, explicit one-click alternative,
  offered directly on the Approved for Deployment card itself
  (`ejectFromTrain()` in `app.js`): it exists for the *different* case this
  two-step path never named as its purpose — a ticket that keeps failing
  and is blocking a whole release's Deploy gate (Ready for Testing must be
  empty before Deploy to Main even appears), where the goal is "get this
  off the train so everyone else can ship" rather than "let me look at this
  again." Same underlying hand-off as Failed testing (`revertRequested` →
  `processRevertFromTrain`) — no automation change needed — but skips the
  intermediate Ready for Testing hop and tags the card `ejectedFromTrain:
  true` plus its own `lastFailureReason.action: "ejected-from-train"`, so
  the card's history reads as a deliberate ejection, not a test failure.
  `trainLockShouldClear` (`functions/train-lock.js`) already only clears a
  project's lock once every train-relevant item is gone, so ejecting one
  stuck ticket can never itself reopen Backlog to new work while others are
  still mid-build — "without unblocking the build" falls out of that
  existing check for free, nothing extra was needed to guarantee it.

### Structured Failed testing / Eject from train reason (XJoASicLGefL5c9fronl)

Both Failed testing and Eject from train now open a two-field dialog
(`showFieldDialog` in `app.js`, extended with a `type: "select"` field kind
for this) instead of a single free-text prompt: a fixed category
(`FAILURE_REASON_CATEGORIES` — "Doesn't work as described", "Wrong /
unexpected behavior", "Visual or layout issue", "Missing a case the ticket
asked for", "Broke something else (regression)", "Blocking a release, not a
rebuild", "Other") plus the existing free-text details. Both are written to
the card: the category+text folded into the usual `notes` entry (so the
human-readable history is unchanged in spirit, just tagged), and the
structured `{category, text, action, at}` stored separately as
`lastFailureReason` — see "Data model" → `backlogItems/{itemId}` above.
Shown as a badge on the Backlog card (`last-failure-badge`) while the
category is set and the card is in `backlog`.

**This is what closes the reject/rebuild loop.**
`ROUTINE_INSTRUCTIONS.md`'s "For each Backlog item found" step 2 (investigate)
tells a re-fired Notify Claude session to read `lastFailureReason` before
starting work on a re-patch, so it targets the SPECIFIC thing that failed
last time instead of re-guessing from the original `desc` alone — the field
is never cleared automatically, so a session re-investigating an item is
expected to check whether `notes` shows a later successful pass since
`lastFailureReason.at` before treating it as still-current.

`testPassed` is never written anywhere now. Old cards carrying it are
simply ignored; there was nothing to migrate.

### Testing rounds (hm84opFjizq3vekk0fC1, 15 Nov 2026)

A ticket that bounced between Backlog and Ready for Testing used to look like
any other: the number of times it was sent back was worked out from note text
and shown only inside the Edit and comment modals, the automatic rebuild
budget (`autoRebuilds`) was never shown, and a person's Failed testing
rebuilt with no cap at all. The loop is now stored and shown.

- **Stored** (pipeline fields, `firestore.rules` → `itemPipelineFields`; a
  browser never writes them): `testRound`, `sendBacks` (last 10, newest
  last, `{at, by, who, category, line, counted}`), `sendBackCount` (every
  one) and `countedSendBacks`. Logic: `functions/test-rounds.js`, shared by
  the automation and the MCP server; the board's read side is
  `public/js/test-rounds-view.js`.
- **Who records a send-back.** `ejectRedCulprits` (by `tests`) and MCP
  `fail_testing` (by `person`) write theirs at once. The board's Failed
  testing and Eject from train keep their existing write (`lastFailureReason`,
  now with the tester's email as `who`), and a Review Batch kick-back writes
  `lastFailureReason.action: "review-kickback"`; `processRevertFromTrain`
  turns each into a `sendBacks` entry when it takes the ticket off the train,
  skipping one already recorded with the same `at`.
- **Rounds.** Arriving in Ready for Testing (`processApplyPatch`, the no-diff
  path) sets `testRound` to `max(testRound, countedSendBacks + 1)`.
- **Not the ticket's fault, not counted**: category "Blocking a release, not
  a rebuild", a ticket held because main was broken ("Not sent back: main is
  broken"), and a red that passed when re-run (flaky). Each is recorded with
  `counted: false`, adds no round and shows greyed in the list.
- **On the card, every column**: a "Round N" chip (Material Symbols
  `replay`) from round 2, warning colour from round 3. Hover lists every
  send-back (when, who, category, one line); a tap opens the same list on
  the card. A Ready for Testing card from round 2 shows "Sent back last
  time: <line>" under its title. The Ready for Testing header shows "N in a
  testing loop" when a card is at round 3 or later; it toggles a filter to
  those cards (per viewer, not saved).
- **The cap.** On the 3rd counted send-back (person, tests and review
  together) the ticket is not rebuilt: it stays in Backlog with
  `blocked: {reason: "needs-decision", setBy: "test-rounds", note: "Sent back
  3 times. Decide: rewrite the ticket, split it, or build it on the Advanced
  model…"}` and a note listing the three reasons. Answer, clearing the flag
  (×, which for this flag also requests the build) or Ready for Dev builds it
  again; the next cap is at 5, then 7. This replaces `autoRebuilds` for
  send-backs, so there is one number: a test send-back no longer spends
  `autoRebuilds`, which is left to the other automatic rebuilds (a conflict,
  a migration number clash). A Review Batch's own third kick-back still
  blocks as before (`reviewBounceCount`).
- **Over MCP**, `get_ready_for_testing_board` returns `testRound`,
  `sendBackCount`, `inTestingLoop` and `lastSendBack` per card and lists
  looping tickets first.
- **Report.** The project's ⋮ menu → **Testing loops**: tickets with 2 or
  more counted send-backs in the last 30 days, with round, reasons, time
  from first build to approval and the last send-back date. Read-only, the
  Archived tickets table.
- **Backfill.** Cards from before this read their loop from notes with
  `rejectionsOf`'s rules (the same counts; `test/test-rounds.test.js`), and
  their first recorded send-back stores the lot.
  `scripts/backfill-test-rounds.js` stores it on every non-archived ticket at
  once: run it from the deploy session of the train that ships this
  (`BOARD_API_KEY=… node backlog-tracker/scripts/backfill-test-rounds.js
  --apply`; without `--apply` it only counts).

### Release groups — one deployable, one train (Flow 9/9, 16 Nov 2026)

**Rule of thumb: one deployable, one train.** Staff Kanban and Backlog
Tracker & FAQs were two projects on the board but one deployable — the
console: same Hosting site, same `deploy-backlog-tracker.yml`, same
`version.js`, same test suites. On two trains they were tested apart and met
for the first time on main (14 Nov 2026: both trains carried a bump to
1.5.398 and both changed `public/index.html` and `MCP.md`). A release group
joins such projects' trains and nothing else. Projects that are merely
related (shared docs, an interface contract) are not grouped; they rely on
the deploy queue and shared-file warnings. PH Website (its own WordPress
deploy) and Display Types, Retail Media Insights and the archived projects
stay on their own trains.

For a project in a group, everything that read the train "for a project"
reads it for the group (`functions/release-groups.js`):
- **One branch**: a patch from any member lands on the group's
  `deployBranch` (`withGroup()` in `run-backlog-automation.js`), and test
  links are re-pointed across every member's Ready for Testing cards.
- **One lock**: the first approval in any member locks Ready for Dev in all
  of them (`deployToFeatureNow` writes `trainLocked` on every member;
  `isTrainLocked` reads any). The lock clears when the shared train is empty
  (`onBacklogItemTrainLockRecompute`, `reconcileLockedTrains` — which sweeps
  the group once, on every member's tickets, so a member whose own tickets
  are gone never resets the branch the other member's tickets are on).
- **One Deploy to Main**: offered on every member when every ticket on the
  shared train, in every member, is approved and no member has one in Ready
  for Testing. When only the other project holds it, the member's header
  shows a disabled Deploy to Main with the reason ("Waiting for Staff Kanban:
  <title> is in Ready for Testing"). From either member it does the same
  thing; a run processes the group's train once (`trainKeyOf`).
- **One PR, one bump**: `processDeployTrain` opens one PR titled
  "Deploy <group name> — N tickets", listing tickets by project, and bumps
  `version.js` once. `finishTrain` flips cards in every member, syncs each
  member's docs and clears every member's train state. All train state
  (`trainStatus`, `trainNote`, `trainTestsRed`, `trainPrNumber`, …) is written
  to every member (`patchTrainProjects`), so each header shows the shared
  train.
- **Reverts**: `revertBlockedBy` may name a ticket in the other member; the
  note says which project ("k (Staff Kanban: <title>)").
- **Deploy queue, late arrivals and shared files** (see "Deploy queue",
  "Late arrivals", "Shared files between trains"): a group is one entry in
  `settings/deployQueue` — a click on the other member drops its group-mate's
  entry (`withoutGroupMates`), so a group never queues behind itself — and
  the queued, deploying and conflict states are written to every member.
  `finishTrain` takes every member off the queue and lands patches held for
  the next release ("Built — joins the next release") from every member.
  `trainOverlapFor` never names a group-mate in "Also changed on …" or
  "Changes <project>'s files", and compares other projects on the branch
  they really build on (their group's, when they have one).
  `sweepStuckTrains` reads every member's cards for a grouped train.
- **Unchanged per project**: approve_for_deployment and fail_testing, each
  project's Backlog, columns, docs and archive. (approve_for_deployment's
  lock, like the board's click, is written to every member.)

**Board.** Each member's header shows "Ships with <other project(s)> ·
<group name>" and the shared train's state. **Settings → Projects → Release
groups** (admin only): create a group (name, branch, first project), add or
remove a project — refused while the group's train or the project's own
train has tickets on it. Removing a project puts it back on its own
`deployBranch`, which was never changed.

**MCP.** `list_projects` returns `releaseGroup {id, name, projectIds}` and
the train's `deployBranch`; `get_approved_for_deployment_board` with a
`projectId` shows the shared train's column and reports readiness for the
whole group, with `blockedBy` naming what in the other project holds it;
`approve_deploy_to_main` works from any member. The Deploy Routine's fire
text names the group's branch and lists every member's approved tickets.

**Migration (done by the deploy session once this is live and both trains
are empty):** create "PH Agent Console" (`deploy/ph-agent-console`) with
Backlog Tracker & FAQs (`oTcLAbnhUUO2S7NkbsuV`) and Staff Kanban
(`New5VKTF2QBqT3T4YEla`). The old branches `deploy/backlog-tracker-faqs`
and `deploy/kanban-staff-board` are left in place, unused — not deleted. If
either train is not empty, it is not migrated and the ticket says what is on
it.

## The single Deploy CTA, and closing the train

**Deploy to Main is shown only when every ticket on the train is
approved** — i.e. Approved for Deployment has cards and Ready for Testing
is empty for that project. The label, count pill and hidden-when-
nothing-to-do rule are unchanged; only the condition is new.

The reason it cannot simply merge what is approved: the whole project
builds onto one branch, so merging it ships everything on it. With 8
approved and 2 still in Ready for Testing, a merge would carry all 10. The
2 must be approved or rejected first, and the button's absence is what
enforces that.

*Accepted trade-off:* in that state the button is absent and nothing on
screen names the 2 as the blocker. Those 2 cards are sitting visibly in
Ready for Testing with their own CTAs, which is the board telling the story
without new copy. Revisit only if people actually get stuck.

**The Backlog locks at first approval, not at first test** (`trainLocked`).
While tickets sit only in Ready for Testing nothing has been committed to,
so builds continue and new tickets may join the branch — everything on it
is still under test. The moment the first ticket is approved the train is
closing: **Ready for Dev** and **Groom Backlog** hide for that project, so
no new ticket can join this release. Finish what's left in Ready for
Testing (approve it, or reject it, which takes it off the branch), and
Deploy to Main appears. On merge the branch is reset to `main`,
`trainLocked` clears, and Ready for Dev returns.

Without this the train never closes: an agent finishes ticket 11 while the
first 10 are being tested, its card appears in Ready for Testing, and the
Deploy button disappears again — a treadmill where a project with steady
build throughput can never reach a deployable state.

Backlog cards themselves stay fully usable while locked — add, edit,
comment, delete all work. Only *starting a build* is held. `trainLocked` is
the one train field the browser may write, and only in one direction: it
latches true from `deployToFeature()`, and only the backend clears it
(`firestore.rules`) — see below for what "the backend" now means.

**Deleting or rejecting every ticket on a locked train also clears the
lock, not only a successful merge.** Before 17 Sep 2026 the only thing
that ever cleared `trainLocked` was a merge finishing
(`finishTrain()`/`reconcileMergedTrains()` in
`run-backlog-automation.js`) — so deleting every approved ticket (or
sending them all back with Failed testing, which reverts their commits off
the branch) emptied the train without ever merging, and the lock got stuck
forever with nothing left in Ready for Testing or Approved for Deployment
for Deploy to Main to act on either (this happened for real on this
project, Backlog Tracker & FAQs). Fixed by a shared pure predicate,
`functions/train-lock.js`'s `trainLockShouldClear(project, items)` — true
when a project is locked, isn't mid-deploy or awaiting a human PR merge,
and none of its items still occupy the train (a live commit and
ready-for-testing/ready-to-publish status, or a rejected card whose revert
hasn't finished/is blocked) — used from two places:

- `functions/index.js`'s `onBacklogItemTrainLockRecompute` (a
  `backlogItems` write trigger) reacts the instant a write drops the item
  that was keeping the train non-empty.
- `run-backlog-automation.js`'s `reconcileLockedTrains()` (every scheduled
  run) is the safety net, and also does the git side a Cloud Function
  can't: `archiveAndResetOrphanedBranch()` tags any commits the
  integration branch holds that never reached `main` as
  `archive/<branch>-<date>` (pushed before resetting), covering both a
  card deleted outright with its commit still live on the branch, and
  revert-then-reverted history that nets to zero content but is still real
  history worth keeping a pointer to. As a safety net the sweep now adopts a hand-pushed commit that carries an unstamped card's `Backlog item:` trailer (stamping `deployCommit`) instead of resetting; otherwise it archives the branch and notes the affected cards.

Either path also resets a stale `trainStatus`/`trainNote` (e.g. a
`"conflict"` left over from before the tickets were removed) back to
`idle`/empty, and the project header shows a "Train locked: …" line
(`trainLockedNoteHTML()` in `app.js`) any time the lock is actually hiding
Ready for Dev/Groom Backlog, so this can't go silently stuck again without
being visible on the board itself. See `README.md` → "trainLocked clearing
isn't only a successful-merge thing any more" and
`test/train-lock*.test.js`.

The result is that a project header shows exactly one CTA at a time, and it
is the next thing to do:

| State | CTA shown |
|---|---|
| Backlog has items, no release in flight | **Ready for Dev** |
| Items ticked in Ready for Testing | **Approved for Deployment** |
| Ready for Testing empty, items approved | **Deploy to Main** |
| Deploy in flight | spinner / session link |

*Known risk:* a slow-to-test ticket holds the whole project's Backlog while
it sits there. The way out already exists and needs nothing new — Failed
testing sends it back and off the branch, unblocking the deploy without
unblocking the build. If that bites in practice, the next option is a
per-project override on the lock; deliberately not built now.

**The left-arrow does NOT exist on every card past Backlog — two cases
deliberately have no "move back" at all**, both fixed 2026-09-13 after a
report that tickets taken from Backlog were "going back to Backlog":

- **A Ready for Testing card can never move back to Backlog.** Unlike
  Approved-for-Deployment→Ready-for-Testing above, this transition has no
  safe semantics: a Ready for Testing card always has real, live commits on
  its project's integration branch, and a bare move to Backlog does nothing
  to take them off it — the rejected ticket would still ship in the next
  deploy, with nothing on the resulting Backlog card even hinting at it.
  **Failed testing** is the supported way out, precisely because it does
  that second half (`revertRequested` — see "The deployment train" above)
  as well as recording why. No automation step ever moves a card backward
  on its own (see `run-backlog-automation.js`), so this was always a manual
  click; `cardHTML`'s `canLeft` excludes `ready-for-testing` outright,
  removing the only path capable of producing it.
- **A locked card's left-arrow is suppressed too** (`canLeft && !isLocked`
  in `cardHTML`) — concretely, an Approved-for-Deployment card the Routine
  has confirmed mergeable (`isDeploying`, `mergeReady: true`) is genuinely
  mid-merge; moving it back to Ready for Testing in that window races
  `backlog-automation.yml`'s own status write to `published-live` —
  whichever lands last wins, which looks exactly like the card "reverting
  on its own" even though a click caused it.

**Test version (`testVersion`)** — a small badge on the card ("Test
version: v1.5.2") naming backlog-tracker's own `APP_VERSION`
(`public/js/version.js`) at the moment the card first reached Ready for
Testing. Since a `public/` change with no version bump is otherwise
invisible even once merged and deployed (see "always bump the version"
in `ROUTINE_INSTRUCTIONS.md`), this gives whoever's testing a concrete
number to check against the live footer before they start — the same
purpose the footer's own version string already serves, just carried onto
the ticket itself.

- **Set once, then carried through unchanged** — never recomputed on
  later moves. The normal automated path
  (`run-backlog-automation.js`'s `processApplyPatch`) reads
  `public/js/version.js` straight off disk right after applying
  `patchFiles` — i.e. the version on the integration branch the ticket is
  actually testable at — and stamps it alongside the `ready-for-testing`
  status write. (Tickets no longer bump the version themselves; the train
  does it once at deploy time, so this is the version the branch already
  carried.) The rarer manual path — a Backlog card moved straight to Ready
  for Testing via the right-arrow button, bypassing the pipeline entirely
  — stamps the frontend's own currently-loaded `APP_VERSION` the same way
  (`moveItem()`, only on the forward direction; sending a card back from
  Approved for Deployment leaves an existing `testVersion` untouched).
- Carries through Approved for Deployment and Deployed/Main Branch (Live)
  unmodified, and appears as its own **Version** column in the Archived
  table (`archiveRowHTML()`) once a card is archived — so the version a
  ticket was tested against stays visible for the life of the card, not
  just while it's on the active board.
- A card stamped before this feature shipped (or one whose entry to Ready
  for Testing predates it) simply has no `testVersion` — the badge and
  the Archive column both render nothing (`—` in the table) rather than a
  placeholder.

**No manual way to reach `published-live` exists — except for a card with
nothing to actually deploy.** An "Approved for Deployment" card normally
shows a passive "Waiting for Deploy to Main" hint instead of a button.
There used to be a per-card "Merge to main" button, which wrote `status:
"published-live"` directly with no connection to whether the PR was
actually merged on GitHub — removed after that let cards read "Merged to
Main" while their PRs sat open. The project's own "Deploy to Main" header
action (`requestDeployNotify` in `app.js`) is now the only trigger for an
ordinary card; it fires the Routine, which sets `projects/{id}.trainReady`
once it has confirmed every ticket really is on the integration branch and
nothing on that branch is still in testing, and only
`run-backlog-automation.js` (see "Notify Claude can't push" in README.md)
flips `status` to `published-live`, after the real merge succeeds. **The
Routine is not a single point of failure for that flag** (25 Sep 2026: a
Deploy run passed every check and its own session permission layer then
refused the `trainReady` PATCH, stranding an approved DSP ticket): when the
Routine reports done or error without setting it, never reports back, or
was never fired, the pipeline sets it itself —
`trainHandoverReason()` in `functions/train-lock.js`, applied by
`functions/index.js`'s `onDeployRoutineSettled` and by
`run-backlog-automation.js`'s `reconcileDeployRequests` (which reads every
project, locked or not) — and
`processDeployTrain` re-checks the Routine's own step 1 (every
`deployCommit` is an ancestor of the branch) and step 2 (nothing still in
testing) before merging. A consumed click is stamped
`deployRequestHandledAt` so it can never re-arm the train.

The one deliberate exception is `noDeploymentRequired` (set from the Edit
item modal — a plain checkbox, self-service, not something only the
Routine can flip): a card whose fix is a live data/config change only —
nothing that ever touches GitHub — genuinely has no PR for the deploy gate
to check in the first place, so gating it on "Deploy to Main" would just
wait forever on a merge that will never happen, and it never has anything
to gain from the Feature Branch stage either. Such a card is excluded from
the "Approved for Deployment" pool entirely (no checkbox, and it is the one
Ready for Testing card that still has an approve button of its own) and
instead shows its own separate "Confirm tested — mark Merged to Main"
button; `confirmTestedNoDeploy()` writes
`status: "published-live"` directly, the same way the old, removed "Merge
to main" button used to — the difference being this is only ever offered
on a card that has already told the board there's no PR to fake being
merged. Any card without the flag still goes through the full
Ready for Testing → Approved for Deployment → Main pipeline exactly as
described above; this does not change behavior for the common case.

**The flag alone is not enough — the train wins over it.** `isNoDeployCard()`
(`app.js`) is `noDeploymentRequired && !deployCommit`, and it — not the bare
flag — is what offers the button, excludes a card from the approval pool,
and guards `confirmTestedNoDeploy()`'s write. A card with a `deployCommit`
has code on an integration branch that is not on `main` yet, whether that
commit is its own or a sibling's it rides on (`carriedByCommit`, see "The
deployment train"), so it keeps the train's controls and reaches
`published-live` only through `finishTrain`. This is the rule the 25 Sep
2026 incident was missing: the automation's no-diff path flagged two
carried cards `noDeploymentRequired`, the button appeared, and both read
"Merged to Main" a day before their train merged.

`published-live` is treated as the one **irreversible** transition of the
four for automation purposes (see "FAQ auto-review" below) — the other
three can still be reverted or corrected without anything external having
already happened.

**Ready for Testing card text (`testSummary`)**: a card's raw `desc` — the
original, often unpolished, typed-or-dictated request that started the
ticket — is what a Backlog card shows, but it stops being the most useful
thing to read once the ticket is actually implemented. Whoever opens the
PR for a ticket (in practice, the Notify Claude Routine) is expected to
also set `testSummary`: a clear, standalone description of what changed,
plus concrete steps to test it. Once a card reaches Ready for Testing, the
card's hover popover shows `testSummary` (when set) first, then the
original `desc` under "Original request:" rather than discarding it (cards
show their title only — see "Board cards show the title only"). A card with no `testSummary` set (an older ticket, or one
worked outside this flow) just keeps showing `desc` as before — this is a
progressive enhancement, not a required field.

### `programs/{programId}`
```
{
  name: string,
  createdAt: timestamp,
}
```
A purely organizational grouping *above* projects — a program/product has
no columns, status, or pipeline of its own; it only exists to group related
projects under a shared heading on the board (a client can have several
concurrent prototypes/projects under one program, e.g. several menu-board
variants under "Menu Board"). A project's own `programId` (see above) is
optional and points here. Created either inline from the New Project
modal's "+ New program…" option, or from an existing project's Docs page —
both offer the same "pick an existing program, or create one on the spot"
picker. Deleting a program isn't wired up from either UI yet; a project
whose `programId` points at a since-deleted program doc is treated exactly
like one with no `programId` at all (falls into "Ungrouped").

### `releases/{releaseId}`
```
{
  name: string,                    // up to 120 chars
  version: string | null,          // optional, up to 40 chars
  status: "draft" | "live",        // only ever advances draft -> live
  order: number,                   // max(existing) + 1 at creation (1 for the first); immutable
  createdAt: timestamp,
  updatedAt: timestamp,
  createdByEmail?: string,
  updatedByEmail?: string,
  madeLiveAt: timestamp | null,
}
```
A named, ordered product release. Managed from the hamburger menu's
**Releases** page (every release newest-first; **+ New release** takes a
name and optional version; a draft row's **Mark live** confirms, then sets
`status: "live"` and `madeLiveAt`; a live row has no action). The
**current live release** is the one with the highest `order` among those
with `status == "live"`.

- **A project may be assigned to one** — `projects/{id}.releaseId`
  (nullable), from the project's Docs page → **Release**. The assignment
  scopes the release's Help Centre audit (see "Release audit" below): the
  audit reads these projects' tickets, README and Requirements. It no longer
  holds or releases anything (the per-ticket FAQ proposals it used to hold
  back were removed 2 Nov 2026).
- **An FAQ article may be bound to a range** —
  `faqArticles.introducedInReleaseId` / `removedInReleaseId` (both
  nullable), from the article editor's "Article properties" group. An
  article applies to a release of order *n* when its introduction release's
  order is `<= n` (or unset) and its removal release's order is `> n` (or
  unset). One canonical definition, `articleAppliesToRelease` in
  `public/js/app.js`, duplicated inline in `faq/js/faq-data.js` and
  `functions/mcp-server.js` (separate deployables) — keep the three in step.
- **Where the range is applied**: the public help centre (`faq/js/faq-data.js`
  reads `faq/data/releases.json`, exported by `scripts/faq-export.js`; the
  reader's `?release=<id or version>` or, by default, the current live
  release) and the MCP server's `search_faq` / `get_faq_article` (optional
  `release` argument, same default). With no releases at all, or none live
  and none asked for, nothing is filtered.
- **Rules**: read `isBoardReader()`; create/update/delete `isEditor()`;
  update may not change `order` and may not move a live release back to
  draft (`releaseStatusOnlyAdvances()`).
- **Backfill**: `scripts/backfill-release-binding.js` (`--report-only` for a
  dry run) sets `introducedInReleaseId` to the current live release on every
  article that has none; never overwrites an existing binding.

### `interfaces/{interfaceId}`
```
{
  name: string,
  projectIds: [string, string],   // the two endpoint ids (project OR concept ids; unique across both)
  endpoints: [{type: "project"|"concept", id}, {type, id}],  // absent on older docs = two projects
  history: [{at, reason, from, to, byEmail}],  // every re-point (promote, demote, by hand), append-only
  contentMd: string,
  createdAt: timestamp,
  updatedAt: timestamp,
  // Set only on an interface copied from a repo file (interface-mirror-lib.js):
  sourcePath: string,             // repo-root path of the file this record copies
  sourceCommit: string,           // last commit that touched that file when copied
  syncedAt: timestamp,
  syncError: string | null,       // why the last sync was refused, with the commit
  overwroteEdit: {byEmail, at, revisionId} | null,  // a board edit the sync replaced; its text is in docRevisions
}
```
`shared/board-interfaces.json` (`{"interfaces":[{"id","path"}]}`) lists the
interfaces that mirror a repo file; whenever main moves, the docs sync copies
each from its file, keeps the replaced text as a `docRevisions` entry
(`via: "docs-sync"`), reads it back byte for byte, and clears `sourcePath` on
one no longer listed. A maintained contract document between exactly two endpoints, each a project
or a Concept Incubator concept, visible and editable from either end's page
(a project's Docs page, a concept's detail page). **Dependencies follow the
item through its life** (ticket 30aL4C1YLrRKYuxPyl8d): promoting a concept
re-points its interfaces to the new project, and **Demote to concept** (a
project's Docs page, or MCP `demote_project`) creates a concept carrying the
project's README, Requirements and additional documents (`concepts.documents`,
`concepts.demotedFromProjectId`), re-points the project's interfaces to it,
then archives the project (never deletes it; its tickets and `docRevisions`
stay). Each move is appended to the interface's `history`. The live, board-native
counterpart to a shared markdown file in the repo (e.g.
`shared/interface-contract.md` between Live Visitor Profile and Experience
Templates). Keep both in sync; treat a divergence as a bug in whichever is
stale.

### `projectDocs/{docId}`
```
{
  projectId: string,
  name: string,
  contentMd: string,
  createdAt: timestamp,
  updatedAt: timestamp,
  updatedByEmail?: string,         // who last wrote it (a member's email, or "backlog-automation" for a mirror; the sync sets it on every mirror write)
  // Mirror fields, set when the document is kept in step with a repo file
  // by the post-merge docs sync (docs-sync-lib.js); absent on a hand-written document:
  sourcePath?: string,             // repo-root-relative file this document mirrors
  sourceSlices?: { start: string, end?: string }[], // only these line ranges of the file are mirrored
  sourcePrefix?: string,           // prepended verbatim to the mirrored text
  sourceCommit?: string,           // last commit that touched sourcePath
  // Set by the board-docs.json reconcile (the repo wins for these):
  mirrorKey?: string,              // the manifest entry's key; how a mirror is found again (never by sourcePath alone)
  manifestPath?: string,           // the board-docs.json that declares it (mirrors and boardDocs entries)
  status?: "current" | "working" | "superseded", // declared status
  statusNote?: string,             // boardDocs entry's note
}
```
**A document with `sourcePath` is a mirror and is read-only over MCP**:
`update_project_document` and `delete_project_document` (and
`update_interface` / `delete_interface` for an interface record that
carries `sourcePath`) refuse it — a rename included, since the sync treats
a changed name as drift — write nothing and record no revision. The same
holds for `set_project_requirements` / `set_project_readme` when
`projects/{id}/docs/{kind}.sourcePath` or `projects/{id}.docsSync.
requirementsCommit` / `readmeCommit` is set. Every change to a mirror is
kept by the `onProjectDocWritten` trigger (`projectDocs/{docId}`): on an
update where `contentMd` changed, or on a delete, it adds one `docRevisions`
entry `{target: "projectDoc" | "projectDoc.deleted", docId, projectId, name,
contentMd, chars, replacedAt, replacedByEmail, via: "trigger"}` holding the
BEFORE text. Creations, empty previous text, unchanged text and non-mirror
documents record nothing. Sync writes to Requirements/README stay
unrecorded (800k characters may not fit through a trigger event).

**The rules enforce the same thing in the database** (`firestore.rules` →
`projectDocs`). On a document that has a `sourcePath`, no caller but the
board automation user (`isAutomationAccount()`, which the docs sync signs in
as) may change `contentMd`, `name`, `sourcePath`, `sourceSlices`,
`sourcePrefix` or `sourceCommit` — the owner account included, the repo wins
for everyone. Only the automation user may create a document that carries
those source fields, or add them to one that lacks them: mirrors are declared
in the repo. Creating, editing and deleting a document without `sourcePath`
is unchanged, and any editor may still delete a mirror, so a person can
retire one the repo's mirror list no longer names. The service account
bypasses rules. Cases are in `test/firestore-rules.test.js`
(`npm run test:rules`).

A generic, named document belonging to exactly one project — an API spec,
an architecture decision record, any technical or architectural document
that isn't the project's own `requirementsMd` or `readmeMd` fields. Listed
under "Additional documents" on that project's Docs page, add/edit/delete
inline via a modal, same UI pattern as Interfaces but anchored to a single
project rather than shared between two. Exists so a project's *complete*
documentation lives on one page instead of scattered across the repo,
per-project Firestore fields, and this collection.

### `projects/{projectId}/docs/{kind}`
```
{
  contentMd: string,               // the whole document, up to 800,000 chars
  sourcePath?: string,             // repo file it was synced from, e.g. "backlog-tracker/README.md"
  sourceCommit?: string | null,    // commit the text came from
  chars: number,                   // contentMd.length
  sha256: string,                  // hex of the UTF-8 text, so a copy can be checked without reading it
  updatedAt: timestamp,
  updatedByEmail: string,          // the member, "sync-board-docs" or "backlog-automation"
}
```
`kind` is `readme` or `requirements`. One document per kind under the
project, so each has Firestore's 1 MiB to itself; the project doc keeps
only the `docs` pointers above. Written by `scripts/sync-board-docs.js`,
the post-merge docs sync and the `set_project_readme` /
`set_project_requirements` MCP tools. Readers use this document and fall
back to the project's legacy `readmeMd` / `requirementsMd` only when it is
missing.

### `skills/{skillId}`
```
{
  name: string,
  slug: string,                   // lowercase [a-z0-9-]+, unique, immutable once created
  summary: string,
  version: string,
  files: [ { path: string, content: string }, ... ],  // 1-20 entries, each content up to 100,000 chars
  owningTeam?: "Product/Design" | "Engineering" | "Cybersecurity" | null,
  createdAt: timestamp,
  updatedAt: timestamp,
  createdByEmail: string | null,
  updatedByEmail: string | null,
  createdVia: "console" | "mcp",
  lastWriteVia: "console" | "mcp",
  // Skill feedback loop (Gcc30u2bQEJwEdUTN6X8) — see "Skill feedback loop" below.
  misses?: [ { text: string, source: "build" | "review", phase?: "build" | "deploy",
               ticketId?: string, prNumber?: number, projectId?: string,
               reportedByEmail: string | null, reportedVia: "mcp" | "console", at: timestamp }, ... ],
  lastMissAt?: timestamp,
  // Periodic skill-review nudge (eKslgrwgRJtoxyx0oNSV) — see that section below.
  lastReviewedAt?: timestamp,
  lastReviewedByEmail?: string,
  reviewCadenceDays?: number,      // default 60 if unset
  reviewDeployThreshold?: number,  // default 15 if unset
}
```
An organisation-wide, shared library of packaged instructions any team
member's AI agent can pull in over MCP — deliberately **not** scoped to a
project (no `projectId` field at all), unlike `projectDocs`/`interfaces`
above. Reached from the hamburger menu's **Skills** entry. Read is any
signed-in member including a viewer (`firestore.rules`' `isBoardReader()`);
write is editor and up (`isEditor()`). `firestore.rules` only checks the
`files` list's own shape/length (it has no way to iterate a variable-length
list and re-check every element without unrolling every possible index);
the real per-file content cap (`SKILL_FILE_MAX = 100000`) is enforced in
`functions/mcp-server.js`'s `validateSkillFiles` and mirrored in the
console's own Add/Edit skill modal. See "Functional requirements — team
access & the MCP server" below for the five MCP tools, and
`backlog-tracker/README.md` → "Skills library" for the seed script that
inserts the starting "Personalisation Hub Front & Design" (`ph-designer`)
skill.

`owningTeam` (tGsm6lsBRsGtyoMZS3rn) is informational only — soft ownership,
so it carries no write-permission enforcement of its own; any editor may
still create/update/delete any skill regardless of who "owns" it. Shown as
a small badge on the skill's card and on `list_skills`/`get_skill`;
settable from the Add/Edit skill modal or `upload_skill`/`update_skill`.
`firestore.rules`, `functions/mcp-server.js`'s `SKILL_OWNING_TEAMS` and the
console modal's own `<select>` must be kept in step if this list changes.

`lastWriteVia` records which path made the most recent write — distinct
from `createdVia`, which never changes after creation. It exists so
`functions/index.js`'s `onSkillWritten` trigger can tell a console-made
edit from an MCP-made one without a Firestore query (see `docRevisions`
above for why that distinction matters); it isn't otherwise surfaced in
the UI.

### `concepts/{conceptId}`
```
{
  name: string,
  type?: "Platform" | "Internal operations", // required on create (the rules refuse a concept without one, except a demotion of a project that has none); carries over on promotion. See "Platform and Internal operations"
  readmeMd: string,                // up to 800,000 chars
  requirementsMd: string,           // up to 800,000 chars — saved independently of readmeMd
  comments: [ { author: "viewer" | "claude" | string, text: string, at: timestamp }, ... ],
  status: "active" | "promoted",    // moves active -> promoted exactly once, never back
  promotedProjectId: string | null,
  promotedAt: timestamp | null,
  createdAt: timestamp,
  updatedAt: timestamp,
  createdByEmail: string | null,
}
```
A home for an early-stage idea ("spitball") that needs further shape before
it earns official project status — deliberately **not** scoped to a
project (no `projectId` field), the same way `skills` isn't, and held apart
from `backlogItems` so exploring it never touches the pipeline board.
Reached from the hamburger menu's **Concept Incubator** entry, directly
under Agent Console. Read is any signed-in member; create/update/delete is
editor and up (`firestore.rules`' `match /concepts/{conceptId}`). `status`
can only move `active` → `promoted` — the rules refuse the write back the
other way — and a `promoted` concept can't be deleted at all, since it's
the provenance record for a real project's README/requirements. See
**Critiques.** `conceptCritiques/{id}` holds `{conceptId, role (free text, up to
80, may be empty = "Unspecified"), reviewer, verdict (will-work | wont-work |
conditional), summary, argumentsFor[], argumentsAgainst[], assumptions[],
recommendations[{id, text, status: pending|accepted|rejected, decidedBy,
decidedAt, target, revisionId}], status (open|addressed|dismissed),
reviewedRevision{fingerprint, conceptUpdatedAt}, via, createdAt}`. Read is any
member; create/update/delete is editor and up (`firestore.rules`). The
synthesis is deterministic and shared by the board and MCP
(`public/js/concept-critiques.js`, mirrored in `functions/concept-critiques.js`).
Accepting an adjustment writes the previous Requirements to `docRevisions`
(`via: "board"`, the only revision a browser may create) and appends the
change under "## Critique adjustments"; rejecting changes nothing. MCP:
`add_concept_critique`, `list_concept_critiques`, `synthesise_concept_critiques`.

`backlog-tracker/README.md` → "Concept Incubator" for the console UI and
the promotion flow (`promoteConceptToProject` in `public/js/app.js`), which
also writes the new `projects/{id}` doc, seeded with this concept's
`readmeMd`/`requirementsMd` verbatim so nothing is re-keyed.

The Promote pop-up never ends silently (21 Oct 2026): Enter in the name box
submits; the "Repo folder: <slug>/" line under the name updates as it is
typed (`pickRepoFolder`); while it runs the button reads "Promoting…" with a
spinner, progress shows ("Creating project…", "Raising tickets 12/27…") and
Cancel/×/backdrop/Escape are disabled; a concept that is no longer loaded
shows an error alert instead of closing. Before submitting, backdrop/Escape
still close it.

`comments` mirrors `backlogItems.notes`' shape exactly (`author`/`text`/
`at`, appended via `arrayUnion` with a literal client `Date`, never
`serverTimestamp()`, which Firestore rejects inside an array element) —
the discussion thread the ticket that asked for this wanted retained
across sessions.

Deliberately not built yet: no MCP tools (a member's agent can read/write
every other documentation surface in this app but not a concept), and no
`docRevisions` change history the way Skills/Requirements/README get — the
comment thread is this collection's own running record instead.

### `faqCategories/{id}` and `faqArticles/{id}`
```
faqCategories/{id}: { name, icon, description, order, parentId?, hiddenFromWebsite?: boolean, createdAt, updatedAt }
faqArticles/{id}: {
  categoryId, programId (nullable), projectId (nullable), title, slug, summary, bodyMd,
  introducedInReleaseId (nullable), removedInReleaseId (nullable),   // see `releases` above
  docType: "faq" | "how-to" | "reference" | "explanation",
  keywords: string[], status: "draft" | "published", needsReview: boolean,
  hiddenFromWebsite?: boolean,   // see "Hidden from the website" below; a live field, never in pendingRevision
  seoTitle?: string (≤60), metaDescription?: string (≤155), directAnswer?: string (≤300),
  questionVariants?: string[] (≤20), articleType?: "guide" | "faq" | "reference",   // SEO & agent fields — see "FAQ revision review" → SEO & agent fields
  order, createdAt, updatedAt, publishedAt,
  pendingRevision?: {              // see "FAQ revision review" below
    title, summary, bodyMd, keywords?: string[], docType?,
    seoTitle?, metaDescription?, directAnswer?, questionVariants?, articleType?,   // a key present wins on promotion (null clears); absent leaves the live value
    reason, sourceItemIds?: string[], sourceProjectId?, sourcePrNumbers?: number[],
    proposedBy: "claude" | string, proposedVia?: "mcp", proposedAt: ISO string,
    reviewStatus: "awaiting-review" | "approved", approvedAt?, approvedBy?,
    editedBy?, editedAt?, isNew?: boolean,
  },
  previousRevision?: { title, summary, bodyMd, replacedAt, sourceItemIds?, wasNew?, revertOf? },
  reviewComments?: { author, text, at }[],   // via comment_on_faq_revision (MCP) — not yet rendered by the console
  lastPromotedAt?,
}
faqDeletedArticles/{id}:   { title, categoryId, deletedAt, deletedBy }  // tombstone the console writes BEFORE deleteDoc; seed-faq-data.js and faq-sync.js never recreate a tombstoned id. Permanent: rules let an editor create/refresh one, nobody delete one
faqDeletedCategories/{id}: { name, deletedAt, deletedBy }              // same, for a category
```
Consumer-facing content for the FAQ / Help Center — see that section below.
`bodyMd` (the field name predates this and is kept for compatibility) now
holds one of two shapes, told apart by a leading `<`: real HTML from the
FAQ admin's rich-text (Quill) editor, or legacy markdown-ish text from
before that editor existed — see "Rich-text article body" below.

`docType` is this article's Diátaxis classification per
[`../docs/CONTRIBUTING-docs.md`](../docs/CONTRIBUTING-docs.md) §2 — set
from a select in the FAQ admin's article editor, defaulting to `"faq"`
for a new article (missing on any article written before this field
existed; treated as `"faq"` client-side in that case, same default).
Rendered as a small type badge on the public article page and in
category article-listing rows (`faq/js/faq-data.js`'s `docTypeLabel()`)
so the distinction is visible to readers, not just an internal tag.

### Hidden from the website (15 Nov 2026, ticket `3HabqHlC4WwL137CYTv1`)

Articles for a feature that hasn't launched yet are written in advance and
used to answer support email, but must not appear on the website until the
feature launches. `hiddenFromWebsite: true` can be set on:

- **a category** — hides it, every folder under it and every article in either;
- **a folder** (a category with a `parentId`) — hides it and its articles;
- **an article** — hides that article only.

The rule is in one place, `functions/faq-feed.js` (`hiddenCategoryIds`,
`isHiddenFromWebsite`; the console mirrors it in `faqCategoryHiddenFromWebsite`
/ `faqArticleHiddenFromWebsite`). Hidden content keeps its `status`; a hidden
article can be published. What each reader sees:

| Reader | Hidden content |
|---|---|
| Support Centre on personalisationhub.com (`/help-api/data/*` feed, and the `faq/data` export it falls back to) | Left out entirely, categories and folders included. The Support Centre drafts any page it had published for it. |
| Public help search, article and MCP (`/help-api/search`, `/help-api/article`, personalisationhub.com/mcp) | Left out. |
| Anonymous Firestore `get` of the article (`firestore.rules`) | Refused for an article hidden by its own flag. |
| Support Inbox (`functions/support-mail.js`) | **Used**: a hidden published article is in the catalogue the reply is written from, with an empty `url`, and the drafting prompt says not to name or link it. The console shows it as "(not on the website)" under the draft. |
| FAQ Management (console) | Shown, with a "Hidden from website" badge on the article row and the category heading, and a `visibility_off` icon in the folder tree. No "View live" link and no WordPress status badge. |
| Board MCP (`search_faq`, `get_faq_article`, `list_faq_categories`) | Shown, with `hiddenFromWebsite` (effective) on each. |

**Setting it.** In FAQ Management: the article editor's Status & publishing
group ("Hide from website"), and the category edit form (pencil beside a
category or folder heading). Over MCP: `create_faq_article` takes
`hiddenFromWebsite`, and `set_faq_visibility` sets it on an article, folder or
category (`list_faq_categories` gives the ids). Hiding is always allowed over
MCP. Showing is launching, so over MCP it is refused for a published article
and for a category or folder; a person does that in FAQ Management. A draft
article can be un-hidden over MCP because a person still has to publish it.
Changing the flag on published content pings the Support Centre to re-read
the feed (`articleChangesPublished` / `categoryChangesPublished`).

### FAQ category icons draw on the website and in the console (15 Nov 2026)

The website draws category icons as inline SVG from a fixed set
(`faq/js/icons.js`, mirrored in `ph-website/snippets/ph-support-centre/main.php`);
any other name draws as "?". The console draws them with the Material Symbols
font, loaded as an `icon_names` subset. The category icon picker used to offer
24 names, 18 of which the website drew as "?", and four icons the live
categories use (`install_desktop`, `manage_accounts`, `smartphone`,
`integration_instructions`) were missing from the console's subset, so FAQ
Management showed the bare word. The picker (`FAQ_CATEGORY_ICONS`) now offers
exactly the website's category icons, all of them are in the font subset, and
`test/icon-font.test.mjs` fails if the picker, a `faq/data` category, the
website set or the font subset drift apart.

### Rich formatting in article bodies

The FAQ Center's Quill editor registers three formats beyond Quill 1.3.7's
stock set, because `docs/CONTRIBUTING-docs.md` §5.4 requires all three of
them in customer-facing documentation and none of them survived being typed
into the editor before this existed:

| Format | Authored as | Stored as | Styled by |
|---|---|---|---|
| Table | Toolbar table button → one row per line, cells split on `\|`, first line the header | `<div class="faq-table"><table><thead>…</tbody></table></div>` | `faq/css/faq.css`, `.article-body table` |
| Code | Toolbar inline-code and code-block buttons (Quill built-ins) | `<code>` / `<pre class="ql-syntax">` | same file, `.article-body code` / `pre` |
| Callout | Toolbar "Callout" picker — Note / Important / Warning | `<div class="callout callout-note">` | same file, `.article-body .callout` |

Each table in the editor carries its own toolbar: **+ Row above / + Row below / − Delete row** and **+ Column left / + Column right / − Delete column**. They act on the cell last clicked (highlighted), so rows and columns can be inserted between existing ones and the selected row/column is the one deleted; with no cell selected they append / remove the last. The header row is never deleted. (`faqTableAddRow` etc. in `app.js`; covered by `test/faq-editor-load.test.mjs`.)

They are registered as real Quill blots (`FaqCalloutBlot`, `FaqTableBlot` in
`app.js`) rather than raw HTML pasted into the body, because Quill silently
normalises away any element it has no blot for the first time it re-parses
the DOM — an article written with a hand-pasted `<table>` would lose it on
the next edit. A table is a `BlockEmbed` (atomic, `contenteditable="false"`,
edited through its own dialog) for the same reason: Quill 1.x has no table
model, so letting a caret into a cell is what breaks the structure.

The class names are a contract between the editor and both renderers (the
public site's `.article-body` CSS and the admin's own "View live" preview) —
change one, change all three. Headings also run to H4 (§3's floor), and
`blockquote` is exposed in the toolbar since the public CSS already styled
it.

### Pipeline state on the card (`prUrl` / `prNumber` / `mergedAt`)

`run-backlog-automation.js` records the pull request on the item as it
goes: `prUrl` + `prNumber` when it opens the PR, and both of those plus
`mergedAt` when it merges. The board renders them as a link on the card
itself (`prBadge` in `app.js`), reading *open* or *merged*.

This exists because the PR number used to live only inside a `notes`
entry's free text — finding a card's PR meant reading its notes or
searching GitHub, and a card in Approved for Deployment gave no sign of
whether its PR was open, green or already merged.

### The no-diff path: on its own commits, carried by a sibling, or already on main

`processApplyPatch` handles `patchFiles` that produce no diff against the
train in three different ways (`noDiffPatchFields()`, pure, tested in
`test/train-carried.test.js`):

- **Already on its own commits** — the card has `deployCommits` there (a
  re-patch matched what it had already put on the branch), or the newest
  train commit touching its files carries this card's own `Backlog item:`
  trailer (pushed by hand and never stamped on the card — adopted as its
  `deployCommit`). Back to Ready for Testing on those commits.
- **Carried by a sibling's commit** — the branch does change the patched
  files, and the newest surviving (non-reverted) commit touching them is
  someone else's: the expected second half of a shared-file batch. The card
  gets `deployCommit` = that sha plus `carriedByCommit`/`carriedByItem` and
  is on the train like any other ticket — see "A card carried by a
  sibling's commit follows that train". This used to set
  `noDeploymentRequired`, which is the bug that let a card go
  `published-live` from the board before its train merged.
- **Already on `main`** — the branch does not change the patched files at
  all. Nothing was pushed and nothing will be, so `noDeploymentRequired:
  true` is honest here, and the card's one-click completion
  (`confirmTestedNoDeploy`) is offered in **both** Ready for Testing and
  Approved for Deployment (`noDeployPending` in `app.js`); before that it
  appeared only in Ready for Testing, so such a card sitting in Approved
  for Deployment could only be finished by moving it backwards a column
  first. Its test link is pinned to `main`'s head commit.

### The FAQ editor's sidebar groups replaced the single Advanced panel

The article editor used to keep every secondary field (category, doc
type, linked project/program, slug, keywords, status, needs-review) in
one slide-out "Advanced settings" panel with its own modal backdrop —
which had previously needed a `pointer-events: none` fix
(`.faq-advanced-backdrop`) after the backdrop was found to swallow the
first click on the editor's own Save button, since it covered the whole
page including that button. The panel is gone now: those fields live in
a right-hand sidebar of three independently expand/collapsible named
groups ("Article properties", "Search & keywords", "Status &
publishing" — `setFaGroupOpen`/`resetFaGroups` in `app.js`) that sit
alongside the main content rather than sliding over it, so there is no
backdrop and no click-swallowing class of bug to guard against here
anymore. Article properties opens by default (category is required for
a new article); the other two groups start collapsed, reset every time
the editor opens regardless of what was left open on a previous
article.

### A patch touching `.github/workflows/` cannot be delivered by the board

`backlog-automation.yml` pushes with its own run's `GITHUB_TOKEN`, and
GitHub refuses any push from that credential that creates or updates a
file under `.github/workflows/`. There is no `permissions:` key that
grants it — `workflows` exists for GitHub Apps, not for the Actions
token — so this is a hard limit, not a misconfiguration.

`run-backlog-automation.js` therefore checks `patchFiles` for that prefix
before doing any git work and refuses the item outright, writing the
reason onto the card and clearing `patchReady`. It refuses the **whole**
item rather than pushing the rest: a patch is one change, and half of one
is worse than none — the item that prompted this added a Cloud Function
declaring a new secret in the same breath as the workflow step that
creates it, so shipping only the function would have broken every later
deploy.

Landing such a change needs a human credential (or a workflow-scoped
token) to open the PR. Making the pipeline capable of it means editing
`backlog-automation.yml` to push with such a token — which the pipeline
cannot do to itself either, so that one edit is always manual.

### Failed automation attempts are recorded on the card (`patchAttempts`)

A failure inside `processApplyPatch` used to be logged by `main()`'s
per-item catch and nothing more: the step still exited 0, the item kept
`patchReady: true`, and the board showed a greyed, locked *In development*
card retrying every two minutes indefinitely with no visible reason. Two
real items sat like that for hours (2026-09-12/13).

Now each failure increments `backlogItems.patchAttempts` and appends a
note — on the first failure, so the reason is visible immediately, and
again on the attempt that gives up; in between it only counts, so a flaky
run can't bury the card. After `MAX_PATCH_ATTEMPTS` (5) the job clears
`patchReady` and says so, leaving the packaged work on the card untouched.
Every path that finishes successfully resets the counter to 0.

### The REST prime asks only for the fields the board draws

`primeFromRest("backlogItems", …)` passes `BACKLOG_ITEM_RENDER_FIELDS` as a
`mask.fieldPaths` projection. Firestore's REST list endpoint pages by
payload size rather than document count, and a `backlogItems` document
carries `patchFiles` — entire file contents, 180KB at a time — that
nothing in the UI renders. Unmasked, priming that one collection took 7
round trips and about 12 seconds; masked it is a single small page.

It is an **inclusion** list: a field added later and not listed is absent
until the listener delivers. That is a self-healing gap of a second or
two rather than a permanent bug, but a new rendered field belongs in that
array too.

**`faqArticles` is deliberately not masked**, even though `bodyMd` is the
other big payload (up to 20KB an article). The editor fills itself from
`bodyMd` when an article is opened, so priming without it would let
someone open an article before the listener arrives, see an empty body,
and save that emptiness over the real one. Masking it would need the
editor to refuse to open until `liveCollections.has("faqArticles")`.

The listener cannot be projected this way at all — the web SDK has no
`select()` — so it still pulls the full documents.

### First paint comes from REST, not from the realtime channel

`app.js` fires one REST read per collection at startup (`primeFromRest`)
and renders whatever comes back; `onSnapshot` then replaces it silently
once it connects. Realtime remains the source of truth.

This exists because the realtime channel is not reliably prompt.
Measured on the live board (13 September 2026, reproduced in two
browsers on two profiles): the `Listen` requests connect and then
deliver nothing for about a minute while the board shows *0 items*.
Forcing the long-polling transport removed one 45-second stall and
exposed others (30s, 11s) — the transport was never the real problem.

Plain REST on the same network, measured in the same page while the
board was still empty: `projects` in 600ms, `backlogItems` in 1.7s, an
ordered query over all 110 documents in 3.2s. The data was always
seconds away; only the channel carrying it was slow.

The invariant: a REST response must never overwrite fresher listener
data. Each listener calls `liveCollections.add(<name>)` the first time
it delivers, and a REST response for an already-claimed collection is
discarded. A failed REST read is a `console.warn` and nothing more —
the board then waits for `onSnapshot` exactly as it used to.

### Firestore uses the long-polling transport (`experimentalForceLongPolling`)

`app.js` creates its Firestore instance with
`initializeFirestore(app, { experimentalForceLongPolling: true })` rather
than plain `getFirestore(app)`.

Measured on a cold load of the live board (13 September 2026): the first
`Listen` request errors after 219ms, the SDK opens a second at 1.7s, and
that one hangs for **45 seconds** delivering nothing before giving up. The
board showed *0 items* for about a minute on every load, in two different
browsers, while the same data over plain REST came back in ~200ms — long
enough to read as broken rather than slow.

`experimentalAutoDetectLongPolling` has been the default since v9.22 and
does not help: it detects a stream that fails outright, not one that
connects and then delivers nothing. Forcing the transport skips the
doomed attempt — first snapshot in **2.9s** on the same cold page and
network.

The trade-off is that updates arrive on a hanging GET instead of a live
stream, so they are marginally less immediate. For a board whose realtime
requirement is "a card moved column", that is worth it. If the board is
ever served to users on a network where streaming works well, re-measure
before reverting — the numbers above are the bar to beat.

### Firestore rules

Prototype-stage: open, unauthenticated read/write on every collection
(`backlog-tracker/firestore.rules`), with light shape validation on
`create`/`update` (required fields present, bounded string lengths, `type`/
`status` restricted to their enum values). This is a deliberate, documented
posture for an internal tool at this stage — tighten with Firebase Auth
before this is exposed beyond the team. It is also what makes the
Routine-fire automation possible without issuing it any credentials: the
REST API is reachable with a plain `curl`, no service account needed.

## Functional requirements — the board (`backlog-tracker/public/`)

- **Realtime, not republish-based.** Every write is live for every open tab
  via `onSnapshot()` — there is no "forgot to republish" failure mode the
  prior Artifact-based board had.
- **Multi-project.** Each project renders as its own collapsible section
  with its own four-column pipeline and its own Archive. Projects sort by
  most-recent item activity (created/updated/archived), not creation order,
  so adding an item to a project brings it to the top.
- **Program/Product grouping (optional).** A project can optionally belong
  to a `programs` doc (see Data model above) purely for display — no
  columns/status of its own. While zero programs exist, the board renders
  exactly as it always has, flat, with no visual change at all. Once at
  least one program exists, projects render under named-program headings
  (alphabetical), followed by an "Ungrouped" section — only shown if it has
  members — for anything with no `programId`. Set from the New Project
  modal at creation time, or from an existing project's Docs page at any
  time; both offer "+ New program…" to create one inline without leaving
  the flow.
- **New item capture is voice-first (20 Oct 2026, ticket NBQ1scD9GFEr6YbQxSYX),
  matching the Kanban prototype's "+ New task".** The "+ New backlog item"
  modal opens with one **Record item** button above every field (the
  in-textarea mic is gone from this modal only; the Edit item and
  quick-comment modals keep theirs). Click to record (microphone requested
  first, via `createDictationController`, which keeps recording across the
  browser's silence auto-stops): the button turns red with "Stop recording"
  and a ticking "Listening · 0:12", and the words appear live in a
  transcript box. On stop an agent ("Writing the ticket…") fills **Title**
  (filler stripped, ≤72 chars), **Description** (tidied sentences, routing
  talk such as "it's urgent" removed), **Type** (Feature/Bug) and **Area**
  (`suggestCategory()`); each filled field gets a violet outline and an
  "Agent" pill, a toast says how many, and the button reads "Record
  again / Replaces the details below". A "Fill in the ticket from this
  description" button runs the same agent on typed text. The agent is the
  `niAgent.draft()` seam in `app.js` (today `localAgentDraft()`), so a
  Claude call can replace it without touching the UI. Field order: Record,
  Title (required), Description (required, 10000), Type (full-width
  toggle), Area (select of `CATEGORIES`); submit uses the edited Title and
  Area and falls back to `generateTitle()` / `suggestCategory()` only when
  blank. The primary button and heading follow the type ("Create feature" /
  "Raise bug", "New feature" / "New bug"). Cancel and the primary button
  sit in a sticky bar at the bottom of the modal (a bottom sheet on a
  phone, above the tab bar, honouring the safe-area inset). Errors (blocked
  permission, no device, unsupported browser, network, nothing heard) show
  inline under the button. Tests: `test/ui/new-item-voice.test.mjs` (1280
  and 390 px) and `test/dictation.test.mjs`. Correcting title and
  category to the real answer remains a mandatory step of every backlog
  sweep (manual or automated).
- **Titles must be short, specific subject lines**, not a truncated dump of
  the raw description. The client's own auto-generated title
  (`generateTitle()`) is a placeholder — first ~70 characters of the
  description with an ellipsis — explicitly not meant to be the final
  title. Whoever actually investigates an item (a person, or the Notify
  Claude Routine) is responsible for rewriting it to something that reads
  as an actual subject line at a glance, on every item touched, even if the
  placeholder already looks reasonable — consistency across the board
  matters more than skipping an occasional no-op rewrite.
- **Selecting a subset of Backlog for Notify Claude.** Every Backlog card
  carries its own checkbox, and the Backlog column header carries a
  "select all" checkbox for that project — purely viewer-local, in-memory
  UI state (see `selectedNotifyIds` in `app.js`), not written to Firestore
  until a Notify Claude click actually happens. With nothing checked,
  Notify Claude behaves exactly as before (sends the whole column,
  `notifyItemIds` cleared); with one or more checked, the button's own
  label/count reflect the selection and the click narrows the fire to just
  those items (see `notifyItemIds` above and "Notify Claude" below) — for
  sending only some of what's typed/dictated so far without waiting to
  clear the rest of the column out first. The selection clears itself once
  the click is sent.
- **Quick comment, separate from editing.** Each card carries a small
  comment-bubble icon that opens a comment-only modal — just the same
  `notes`-array write the Edit item modal's own Comments block already does
  (`addItemComment()`), without pulling in title/desc/type/category editing
  at all. It sits in the card's bottom-right corner now (in `.card-move`,
  alongside archive/delete), not the bottom-left row next to the category
  badge where it used to blend into the row of muted utility icons — styled
  as its own filled, rounded pill (`.quick-comment-btn`) with a soft shadow
  and a gentle hover/press scale, carrying its own comment count so its
  purpose (and that there's already a comment or two) reads at a glance.
  The pencil icon (`edit-item-btn`) still opens the full Edit item modal,
  comments section included, for anyone who wants both in one place.
- **Mic dictation** requests microphone permission before starting Web
  Speech recognition, with specific, visible error states (blocked
  permission, no device, no browser support, no internet after repeated
  network errors) rather than failing silently. **Once the mic is on it
  stays on until the user stops it** (the mic button, closing the form, or
  submitting): every session the browser ends on its own — silence
  timeout, cloud-session limit, a transient network error — is restarted
  immediately with the text so far carried across, and a long silence only
  shows a soft "still listening, not hearing anything yet" hint, never a
  stop (1.5.47 and earlier gave up after four silent restarts, which read
  as dictation "pausing and cutting out"). **While the mic is on the page
  holds a Screen Wake Lock** (`navigator.wakeLock`, Chrome Android and
  iOS 16.4+; requested inside the mic click, released on stop) so an idle
  phone doesn't turn its screen off and kill recognition with it; the
  browser drops the lock whenever the page is hidden, so it is
  re-requested when the page is visible again, and a session that ended
  while hidden (screen off, app switch — Chrome reports the lost mic as
  `not-allowed`/`audio-capture`, which is not treated as a denial then) is
  parked rather than restarted and resumed on that same visibility change.
  Desktop and iOS run one real
  `continuous` session — results walked from `e.resultIndex`, each final
  committed once, a redelivered duplicate final dropped — while Android
  Chrome, whose continuous mode duplicates text, runs a fresh
  non-continuous session per utterance instead. The recogniser opens the
  microphone itself; no `getUserMedia` track is fed in, since the
  pre-processed audio (noise suppression / echo cancellation / AGC) 1.5.47
  handed to `start(MediaStreamTrack)` made transcription worse, not
  better. Language defaults to `en-GB` and the engine to Chrome's cloud
  recogniser; Settings → Dictation holds per-browser (`localStorage`,
  never Firestore) overrides for language (`bt-dictation-lang`) and engine
  (`bt-dictation-engine`: auto / cloud / on-device — the last uses Chrome
  139+'s `processLocally` model with Chrome 142+ phrase biasing toward this
  board's own vocabulary). Final results get spoken-punctuation
  replacement ("full stop", "comma", "new line", "new paragraph",
  "question mark", "exclamation mark"), sentence-casing, and a small
  correction map for product terms; text already in the field is preserved
  verbatim, line breaks included. Originally New Item's description field
  only; `createDictationController()` in `app.js` factors this into a
  reusable per-field controller (its own independent
  recognition/listening/error state via closure, not shared module
  globals) so the quick-comment modal and the Edit item modal's own
  comment box each get an identical mic button too — starting or stopping
  dictation on one field never touches another's state, and starting one
  field's mic halts any other (Chrome runs one recognition per page, so
  two restart loops would otherwise fight over it).
- **Dictation never cuts off by itself (1.5.267, 20 Oct 2026).** Reported
  live: the mic "cuts off and stops listening after a certain amount of
  time". A session the browser ends on its own restarts the *same*
  recognition instance synchronously in `onend` (what iOS Safari needs —
  it refuses a new instance created outside the click gesture), falling
  back to a fresh instance after a short delay when `start()` throws or
  the engine reports `network` / `not-allowed` / `audio-capture` on a run
  whose microphone already worked (each retried up to three times before a
  visible message). A once-a-second watchdog catches the stall that fires
  no event at all (iOS Safari, WebAudio/web-speech-api#96): interim words
  left unfinalized for 4 s are committed as shown and the session is
  replaced, and a session with no event of any kind for 20 s is quietly
  replaced. Words shown as interim text are never taken back by a
  restart — a session that ends without finalizing them commits them.
  The stop click finalizes the words in flight (`stop()`, with a 3 s grace
  that keeps what was shown); adding a ticket, adding a comment or closing
  the form `halt()`s instead — the instance is aborted with its handlers
  detached, so the microphone is released at once and nothing writes into
  a field that is being cleared. Typing into the field mid-dictation keeps
  the edit (it becomes the new starting text) and listening resumes
  1.2 s after the last keystroke. `window.__btDictationLog` in the browser
  console lists the last 200 dictation events (starts, ends, error codes,
  watchdog restarts) for diagnosing a report. Tested by
  `test/dictation.test.mjs` against a scripted recogniser.
- **Every mic writes each phrase once, Android included (21 Oct 2026).**
  Reported from an Android phone on the Staff Kanban's Record task: "add
  add add a new add a new Epic…". Android Chrome in continuous mode
  reports every in-progress guess as a final, each the whole utterance so
  far. `public/js/dictation-results.js` reads results for every mic in the
  console (`createDictationController()` and the Staff Kanban's recorder):
  Android, from the user agent or its client hints, never runs continuous
  mode; results are walked from `e.resultIndex` but never past a final not
  yet committed, and never back over one already committed; a final that
  only carries the previous final of the same session further replaces it,
  and one that repeats it, or is an earlier shorter guess, is dropped. That
  covers an Android device whose user agent doesn't say so ("Desktop site",
  tablets): after two such finals in one session the page stops using
  continuous mode for the rest of the visit. Tested by
  `test/dictation-results.test.mjs` (the reported sequence),
  `test/dictation.test.mjs` and KB-C7/KB-C8 in
  `test/ui/staff-kanban.test.mjs`.
- **App name and global navigation.** The app itself (browser tab, `<h1>`,
  footer) is titled **"PH Agent Console"** — distinct from any one
  project's own name on the board (e.g. the "Backlog Tracker & FAQs"
  project this very document tracks). The topbar carries only the
  hamburger menu button, the "PH Agent Console" logo/title itself (a text
  placeholder until a real logo image ships), and the primary
  **+ New project** action; every global (not per-project) destination
  lives in a left-hand nav drawer opened by that hamburger (320px wide),
  which slides in over the board and closes on a backdrop click, Escape,
  or picking an item. The logo/title is itself also clickable, from any
  page in the app, to the same destination as the drawer's own home
  link — a second, always-visible way back that doesn't require opening
  the drawer first.
  - **Agent console** (the drawer's own "home" link, first item) — closes
    whichever sub-page is currently open and returns to the board.
    Replaces the "← Back to board" button every sub-page (Docs, Archive,
    Archived projects, the two FAQ pages below) used to carry
    individually — the drawer itself stays reachable from any sub-page
    already (it's part of the fixed topbar, not `#projects-root`), so one
    shared way back covers all of them.
  - **FAQ Management**, then **Skills** (the organisation-wide skills
    library — see "Data model" → `skills/{skillId}` and "Functional
    requirements — team access & the MCP server" above), then
    **Settings** — see "FAQ / Help Center" below. (Archived projects is
    not its own drawer entry — it's a "View archived projects" link inside
    Settings, per the FAQ admin pages' own note that the drawer lists a
    fixed, small set of destinations.)
  All four sit flat, in that order, as plain sibling items — no section
  heading grouping Settings/FAQ Management apart from the rest, since that
  grouping previously read as "FAQ Management lives under Settings" even
  though the two are independent destinations. This replaced three
  competing topbar buttons for the same reason the per-project header
  below already collapsed to one primary CTA + a menu.
- **Header actions**, in order: **Ready for Dev** (own button, shows the
  live Backlog count; not buried in a menu — fires the Routine's
  investigate-and-fix flow, see "Notify Claude" below — the function/doc
  names kept their original "notify" naming even after the button itself
  was relabeled; hidden while the train is locked — see "The single Deploy
  CTA, and closing the train" above), **Approved for Deployment** (shown
  only once at least one Ready for Testing card is ticked — see "Approving
  out of Ready for Testing" above; a pure board status batch write, no
  Routine involved), **Deploy to Main** (same gradient
  treatment as Ready for Dev, shown only when every ticket on the project's
  train is approved — see "The single Deploy CTA" above), **+ New
  backlog item**, then a **⋮** options menu holding everything else
  (Archived tickets, Requirements/Docs, interface contracts, and — when
  the project has one — a **View Artifact** link, see "Project Artifact"
  below).
  Mobile (<640px) stacks each gradient button as its own full-width row
  above the New item / ⋮ row rather than squeezing controls onto one line;
  the board's four columns stack vertically instead of forcing horizontal
  scroll.
- **Notify Claude progress**: the button shows a spinning "Working…" state
  the instant it's clicked — a client-local optimistic state, since
  `projects/{id}.notifyRoutine` (written by the Cloud Function reacting to
  the click) can lag the click itself by a second or more. Once that doc
  lands with `status: "in-progress"`, the real state takes over: still
  spinning, sized to the batch actually sent, copy still "Working…" until
  a session id has resolved from the Routine fire response — once it has,
  the button's own copy flips to **"Deving…"** and the button itself
  becomes the click target for `sessionUrl` (`target="_blank"`), rather
  than a separate "View session" link next to a disabled button. Anything
  added to Backlog after that click surfaces as its own small,
  still-clickable **Notify Claude — N new** CTA next to it, rather than
  being folded into a count that would otherwise conflate "already being
  worked" with "brand new." A fired session is
  asked (in the fire request's own `text`) to flip `notifyRoutine.status`
  to `"done"`/`"error"` itself when it finishes; the client additionally
  treats any `"in-progress"` older than 25 minutes as over on its own
  initiative, so a session that crashes can never wedge the button in a
  permanent spinning state.
  **Per-item builds (one session per ticket) report on the card, and the
  server keeps the time** (19 Oct 2026): a session sets
  `backlogItems.buildSession.status` to `done`/`error`, and
  `onBacklogItemBuildReported` (functions/index.js) stamps
  `buildSession.reportedAt` with the server clock. The board counts a
  session as finished when `reportedAt` (else the session's own
  `finishedAt`, display only) is at or after `notifyRoutine.firedAt`;
  sessions take `finishedAt` from `date -u`, but a wrong guess no longer
  keeps "Deving…" spinning. Each automation sweep (`closeNotifyRoutines`
  in run-backlog-automation.js, rules in `functions/notify-routine.js`)
  closes every `in-progress` record: `status: "done"` + `closedAt` once
  every sent card has left Backlog, has `patchReady` or has a report after
  the fire; after 25 minutes with a card that did none of those it notes
  that card ("The build session started at … never reported back…"),
  records `stalledItemIds` and closes the record. While building, the
  button reads "Deving… · N min" with the finished count, its tooltip lists
  each sent ticket as building / reported / landed (after 15 minutes
  "still building — open session"), and a stalled record shows a
  non-spinning **"Build didn't report back"** chip linking to the card.
- **Docs page** (per project, via ⋮) is the single-page home for
  everything documenting that project, in this order: a **Program /
  Product** picker (`programId`, see "Program/Product grouping" above),
  the project's **README** (`readmeMd` — its primary tracking document,
  shown first among the documents themselves), free-text **Requirements**
  (`requirementsMd` — this document's own live counterpart), an
  **Additional documents** list (any other technical or architectural
  document, backed by the `projectDocs` collection — see Data model
  above), **Routine instructions**, **FAQ review automation** toggle (see
  below), and **Interfaces with other projects** (list + add/edit, backed
  by the `interfaces` collection). All of it lives here rather than
  scattered across repo files, so a project's complete documentation is one
  page away from its board.
  **Repo mirrors are read-only here** (`public/js/docs-view.js`): a
  document, interface, README or Requirements record with a `sourcePath` is
  a copy a docs sync rewrites from that repo file after each merge to main,
  so an edit saved on the page would be silently overwritten. It shows a
  "Mirror of <path>" chip and an "Open in GitHub" link instead of Edit
  (Remove asks first); the README/Requirements boxes go read-only with no
  Save; an interface whose `syncError` is set shows the chip in red; and no
  save handler writes a mirror (`mirrorEditRefusal`). Documents list the
  project's `startHereDocId` first, the rest by name, and fold documents
  with `status: "superseded"` into a collapsed "Superseded (N)" section.
- **Project Artifact** (`artifactUrl`/`artifactUpdatedAt` on the project
  doc): an optional link to a Claude-published Artifact for this project —
  a live mockup, dashboard, or prototype the Notify Claude Routine builds
  and keeps up to date across runs, republishing to the same URL rather
  than a fresh one each time (see ROUTINE_INSTRUCTIONS.md → "Project
  Artifact" for the exact mechanism). The board itself never creates or
  edits this — it only reads the two fields. When `artifactUrl` is set,
  the ⋮ menu shows **View Artifact ↗** (opens in a new tab, with an
  "updated `<date>`" sub-line from `artifactUpdatedAt`); when unset, it
  shows a plain, non-clickable "No artifact yet" row (unlike the interface
  contract's empty state, there's no in-app action to create one — only
  the Routine sets these fields, as a direct Firestore write like
  `groomedSummary`, never via `patchFiles`/`patchReady` since it isn't a
  code change to this repo).
- **Archive**: a Merged-to-Main card can be archived (sets `status:
  "archived"` + `archivedAt`, not deleted); each project's own Archived
  page is sortable/filterable by type, area, and free text, with a Restore
  action back to `published-live`. Deletion is reserved for Backlog cards
  only.
- **"No deployment required"** (Edit item modal): a checkbox for a fix
  that's a live data/config change only — nothing that ever needs a code
  push or a deploy, e.g. a Firestore-only edit. Any card carrying it shows
  a small "No deployment required" badge; once it reaches Ready for
  Testing, it's excluded from the checkbox approval pool entirely (see
  "Approving out of Ready for Testing" above) and instead
  shows its own separate "Confirm tested — mark Merged to Main" button,
  which moves it straight to `published-live` — see "No manual way to
  reach `published-live` exists" above for why this one case is safe to
  bypass the deploy gate. Self-service, not something only the Notify
  Claude Routine sets — anyone can check it from the Edit item modal on
  any non-archived card, same as title/description/type/category.
- **Edit + comments**: every non-archived card has an edit icon (with a
  comment-count badge once it has any) opening a modal to change
  title/description/type/category, plus a comments thread. `notes` existed
  in the schema from the start but was previously write-only from the
  board's own UI — only the Routine ever wrote to it, via direct Firestore
  PATCHes; this is the first UI to read or write it. A viewer's own comment
  is `{author: "viewer", text, at}` appended via `arrayUnion` — `at` is a
  plain client `Date`, not `serverTimestamp()`, since Firestore rejects a
  server-timestamp sentinel inside an array element.
  **Notes are append-only everywhere and never rewritten whole** (19 Oct
  2026): `notes` is the card's audit trail, and whole-array writes by the
  automation and Routine sessions erased it on seven cards. The console and
  MCP `add_item_comment` use `arrayUnion`; `run-backlog-automation.js`'s
  `appendNote`/`patchItem` and the Routine (`ROUTINE_INSTRUCTIONS.md` →
  Setup → "Append a note") send only the new entries in one
  `documents:commit` with an `appendMissingElements` transform and
  `currentDocument.exists: true`. Tests: `notes-append.test.js`,
  `notes-append-emulator.test.js`.
  **One automation note per event, updated in place** (15 Nov 2026, Flow
  6/9, `jKM13xJ7PxW9THm3YQ9g`): a card's state used to be read from notes
  that repeated and contradicted each other (one test failure wrote three or
  four notes; a bystander on a red train got the same note four or five
  times). An automation note may carry `key` and `firstAt`
  (`notes[]: {author: "backlog-automation", text, at, key?, firstAt?}`), and
  `appendNote(item, text, {key})` with a key already on the card replaces
  that note's text and `at`, keeping `firstAt`: `patchItem` sends one
  `:commit` that first removes the stored entry (`removeAllFromArray`) and
  then appends the new one. Only `backlog-automation` notes are matched;
  people's and Claude's notes never carry a key and are never touched. Keys:
  - `train-test:<deployCommit>:<workflow>` — one train-test failure on its
    own ticket: "failed, re-running (<test>)" → "failed twice … checking it
    is this ticket's" → "Sent back automatically …" or "Passed on re-run …
    (flaky: <test>)" or "Not sent back: main is broken". Every failure note
    names the failing case and assertion (`failureSummaryOf`, the run's
    `--log-failed`; a flaky pass reads attempt 1's log). The owner is never
    asked to use Failed testing: the automation sends it back itself.
  - `train-red:<branch>:<spell start>` — a card on a red train that did not
    cause it gets one note for the whole red spell
    (`projects/{id}.trainRedSpell: {since, cause}`, set by
    `reportTrainTestResults` when `trainTestsRed` first fills, cleared when it
    empties), updated as the spell goes on and closed with "Train was red
    for 2 h 10 min because of <ticket>; green again". A failure on a commit
    that is no ticket's own says it cannot be pinned on one ticket and who
    is asked to look (whoever approves the project's Deploy to Main).
  - `build-silent:<buildAttemptId>` — the 75-minute "hasn't reported back"
    and the "never reported back. Starting it again" of one build attempt.
  - `revert:<oldest deployCommit>` — one revert request: taken off, blocked
    (a changed blocker updates the note), no longer needed. A re-patch that
    lands identical to the train while that revert is pending clears
    `revertRequested` in the same write and says so on the request's note,
    so the card never reads "Moved back to Ready for Testing" followed by
    "Could not take this ticket off the train".
  The Edit item modal lists people's and Claude's notes open, newest first,
  and the automation's under a collapsed **Pipeline history (N)** button
  (newest first, one entry per key). MCP `get_backlog_item` returns notes as
  stored, plus `key` and `firstAt` where set. Tests: `note-keys.test.js`,
  the console-click "Pipeline history" scenario.
- **Test/preview link**: a Ready for Testing card gets a "Set test link"
  button; once set (via `showPromptDialog()` — see "In-app dialogs replace
  window.confirm/prompt/alert" below — prefilled with an editable template
  when nothing's set yet), it becomes a "Test this →" button opening `previewUrl` in a new
  tab, with a pencil icon to change it. The convention is a
  `rawcdn.githack.com/offline2online/rob_ph_demos/<commit-sha>/<path>` link
  (see root `CLAUDE.md`) — **`rawcdn.githack.com`, not `raw.githack.com`**:
  the latter proxies through jsDelivr's CDN cache (up to ~7 days), so a
  link set right after one push can keep showing that first commit even
  after later pushes update the file, with no visible error.

  **The ref is always a commit sha, never a branch name — `rawcdn.githack.com`
  caches a branch URL indefinitely too, just as badly.** Measured twice:
  22 Sep 2026 on the DSP project (a built bundle's fixed-path
  `demo/api-snapshot.json` kept serving a day-old capture across several
  pushes) and 25 Sep 2026 on this project's own train (a plain static page,
  `faq/css/faq.css` — commit `7b09a4b` changed its base font size and the
  branch URL still served the pre-change file 20 minutes later, while the
  commit-sha URL for the same file was correct immediately —
  `mIHraVz8fQXRe549UYD1`). There is no page plain enough to be exempt from
  this. `processApplyPatch` builds `previewUrl` against the commit it just
  made on the train (`guessPreviewUrl(patchedFiles, sha, ...)`, not the
  branch), and `repointTrainPreviewUrls` re-points every *other* Ready for
  Testing card already on that train to the new head sha each time another
  ticket lands, so every card's link keeps showing the full combination
  that will ship — the same job the DSP project's own rebuild-then-relink
  step (`dsp-prototype.yml`, `npm run board:tickets --relink-prototype
  <sha>`) already did for its checked-in build bundle; that is now one
  instance of this general rule, not a special case of it. A previewUrl a
  human set by hand through "Set test link" (anything that isn't one of
  this pipeline's own two auto-generated shapes) is left untouched rather
  than overwritten.

  **"Rebuilding test link…" — a link into a checked-in build says whether
  the build includes the ticket (`lmdwsP5ElY5Oh12N9Fex`).** When a link
  opens a generated build (`GENERATED_BUILDS`, today the DSP prototype),
  it is live the moment the ticket lands but pinned to the ticket's own
  commit, which still holds the PREVIOUS bundle until `dsp-prototype.yml`
  rebuilds and re-points it. Testers failed tickets on that old bundle
  (`k1ZIa7lksk9gQjTVrLgN`, `OtNAsifjp3ZUtDEsdzu0`), each costing a revert,
  re-patch and rebuild. So `processApplyPatch` (and the no-diff carried
  path) sets `previewState: "rebuilding"` exactly when the patch leaves a
  build stale AND the pipeline's link opens that build's output; any other
  link gets `null`. `refreshPreviewBuildStates()` then runs every pass,
  reads `build-info.json` at the link's commit and tests
  `git merge-base --is-ancestor <ticket commit> <build-info commit>`:
  included → `"ready"` (+ `previewBuiltFrom`); not included → `"rebuilding"`,
  or `"stale"` plus ONE note linking the workflow's Actions page after
  `PREVIEW_REBUILD_STALE_MS` (20 minutes). A stale card turns `"ready"` when
  a later build includes it; a card that leaves testing or whose link stops
  opening a build goes back to `null`; an unreadable build-info or unknown
  ref changes nothing. While any card is rebuilding the run asks for the
  next one at once rather than waiting on the throttled schedule.
  The card (`testLinkRowHTML`, driven by `previewBuildStatus`): rebuilding
  hides "Test this →" behind a status line ("Rebuilding test link… usually
  1-2 minutes") and **disables Failed testing** (`failTestingButtonHTML`);
  stale brings the link back with a warning and the workflow link, re-enables
  Failed testing and adds a sentence to its dialog; ready shows "Includes this
  ticket · built from <sha7> · updated …". The client ages "rebuilding" itself
  (`PREVIEW_REBUILD_STALE_MS` matches the automation's), so a stopped
  automation never hides a link for good. A person's "Set test link" writes
  `previewState: null`. `repointTrainPreviewUrls` also writes `previewSha`
  and `previewUpdatedAt` (still no note). Tests:
  `test/preview-build-state.test.js`, `test/preview-build-card.test.mjs`.

  **`guessPreviewUrl` picks the page, not just a changed file.** A ticket
  that changes an `.html` file links to that page. A ticket that changes
  only a stylesheet or a script links to the nearest `index.html` above
  those assets — the page that actually renders them — because otherwise
  such a ticket got no usable link at all: the first ticket through the
  deployment train (`iaX9egVd8k8gFOd27LCn`, tripling the console logo)
  touched only `styles.css`, so "Test this →" opened a GitHub *source
  listing* and there was no way to see whether the logo had changed. Only
  a change with no page above it at all (`scripts/`, `functions/`) falls
  back to a link to the branch itself, since there is no single commit to
  pin a no-page change to.

  One limit worth knowing for backlog-tracker's own UI: a githack preview
  is served from a different origin than the board, so Firebase Auth
  sign-in may be refused there unless that host is an authorised domain.
  Whatever renders before the sign-in wall is still testable (the sign-in
  card and its logo); anything behind it needs the deployed board.

  This restores what the old Claude Artifact board's per-card
  quick-launch link used to do, closing the gap `CLAUDE.md`'s "Prototype
  Backlog" section had documented ("No `testUrl` field or quick-launch icon
  on cards") since the migration off the Artifact.
**Removed: the per-project "Deployments" page and its `deployments`
collection.** Grouped tickets meant to ship together with a live checklist
of which had reached "Approved for Deployment", plus a "Notify Claude to
merge" action scoped to the group. Removed by explicit request (its owner
found the ⋮ menu entry confusing and wasn't using it) — nothing else
depended on the `deployments` collection or `deploymentId` field, and
`patchFiles`' own "give every item in a shared-file batch the same full
combined content" convention (`ROUTINE_INSTRUCTIONS.md` → "Group
multi-item fixes into one deployment") is a separate, code-level mechanism
in `run-backlog-automation.js` that never depended on this page either.

### Board cards show the title only; the description is on hover

Every card on the Agent Board, in every column, shows its title and badges
but not the description text. The text appears in a popover when the
pointer is over (or keyboard focus is on) the title (`.card-title-hover` /
`.card-desc-pop` in `public/css/styles.css`). On a touch screen a tap on
the title opens the ticket detail, which shows the full description.

- What the popover holds: the description; for a Ready for Testing or
  Approved card with a `testSummary`, the summary first and then
  "Original request:" with the description.
- The popover is `position: fixed`, placed by `placeCardDescPop()` in
  `app.js` and kept inside the viewport, because the column's scrolling
  list (`.col-list`, `overflow: auto`) clips anything positioned inside it.
- Release 1.5.381 did this for the Backlog column only and drew the popover
  inside the column. Both were fixed on 10 Nov 2026 (1.5.383 and the
  release after it): the request was for every ticket on the board.
  `test/ui/console-click.test.mjs` → "Board cards: title only in every
  column" checks every column and that the popover is unclipped.

### Tickets never scroll left or right on a board (15 Nov 2026)

A ticket on the Agent Board or the Staff Kanban only ever scrolls up and
down under a finger, never sideways (ticket jcQCHLGeLP50iOeh1ZnJ).

- **Agent Board**: a column's list (`.col-list`) is `overflow-x: hidden`.
  Its `overflow-y: auto` alone made the x axis scrollable too, so a ticket
  whose button row (`.card-move`) was a few pixels wider than the column
  (at 1024 px, the iPad's landscape width) let the whole column pan
  sideways. The card's footer and button row now wrap instead of widening
  the ticket (`public/css/styles.css`).
- **Staff Kanban**: a ticket (`.kb-card`) is `touch-action: pan-y` at every
  width, not only on a phone, and keeps a long title or label inside its
  column (`min-width: 0`, `overflow-wrap: anywhere`). A sideways swipe that
  starts on a ticket does nothing; on a tablet the board itself still
  scrolls sideways (six columns don't fit) from the column headers and the
  gaps between columns, and under a card being dragged at the edge
  (KB-BOARD-4 in `kanban-staff-board/REQUIREMENTS.md`).
- Tested by `test/ui/ticket-detail-overflow.test.mjs` (part of
  `test:ui:console`) at 390, 820, 1024, 1180 and 1440 px: no column of
  tickets scrolls sideways, no ticket is wider than its column, and every
  Staff Kanban ticket is `pan-y`.

### A Backlog card locks while a fix is in flight

`cardHTML`'s `isInDevelopment` (`isBacklog && item.patchReady`) covers the
window between the Routine writing `patchFiles`/`patchReady: true` (see
"Notify Claude can't push" in README.md) and `backlog-automation.yml`
actually opening the PR and flipping `status` to `ready-for-testing` — a
short window (the workflow polls every ~2 minutes) but one with real,
already-written work behind the card. In that window the card:

- Drops its checkbox, edit/comment pencil, quick-comment icon, move-forward
  arrow, and delete button entirely — nothing on it is a live control.
- Renders greyed out (`.card-in-development`) with a passive "In
  development — locked" line where the move-forward arrow would be,
  the same "status line instead of a live control" treatment
  `merge-pending-hint` already used for a Live-on-Feature-Branch card.
- Unlocks itself automatically the instant `status` moves off `backlog` —
  no separate flag to clear, since `isInDevelopment` is derived, not
  stored.

A card with `patchReady` false (the normal case — not yet picked up, or
already past this stage) is unaffected; this only ever applies to a
Backlog card mid-handoff.

This logic itself was already correct and live on `main` (verified by
diffing the deployed commit's `app.js`/`styles.css` against what's
described here) when it was reported as "not working on Board" — the
actual defect was Firebase Hosting caching (see README.md → "Deployment"),
not this feature. Re-verify against the live footer's version badge before
assuming a change like this one isn't live; a browser can hide a real
deploy for up to an hour without `Cache-Control` pinned on `html`/`js`/`css`.

**A real gap this left uncovered: the window between "Notify Claude" being
clicked and the Routine actually writing `patchFiles`/`patchReady`.**
`isInDevelopment` needs `patchReady`, which the Routine only sets once it's
fully finished investigating and packaging a fix — for however long that
session is still running (a few minutes, sometimes longer), a card it was
sent doesn't have `patchReady` yet and was, until this was noticed and
fixed, still a fully live control: editable, movable, deletable, exactly as
if nothing were happening to it. `cardHTML`'s `isSentToClaude` closes this:
`isBacklog && !isInDevelopment && project.notifyRoutine.status ===
"in-progress" && !isStale && project.notifyRoutine.sentItemIds.includes(item.id)`
(same 20-minute staleness guard as the Notify Claude button's own spinner,
so a crashed or ancient run can't wedge a card locked forever). It gets the
identical treatment — no checkbox/edit/comment/move/delete, greyed out via
`.card-in-development`, a passive "Sent to Claude — locked" line — and
folds into `isLocked` alongside `isInDevelopment`/`isDeploying`, so every
control that already checked `isLocked` (the quick-comment icon, the edit
pencil) picked this up for free; only the checkbox/delete/move-forward
conditions, which checked `isInDevelopment` directly rather than
`isLocked`, needed their own explicit `&& !isSentToClaude`.

**The mirror-image case, `isDeploying` (`isLiveBranch && item.mergeReady`),
covers the same kind of window at the *other* end of the pipeline**: on a
pre-train card whose own PR the Deploy flow confirmed green and wrote
`mergeReady: true` for, the card is genuinely mid-merge — `backlog-automation.yml` will pick
it up on its next poll and merge it, moving `status` to `published-live`.
Until then the card gets the identical treatment as an `isInDevelopment`
one (same `.card-in-development` class, same dropped controls), with its
usual `merge-pending-hint` ("Waiting for Deploy to Main") replaced by a
"Deploying — locked" line. It unlocks the instant `status` moves off
`ready-to-publish`, the same derived-not-stored way `isInDevelopment` does.
Pairs with the project-level "Deploy to Main" button's own spinner
(`projects/{id}.deployRoutine` — see README.md), so both the button that
triggered the deploy and the specific card(s) it's deploying now show it's
actually in flight, where before neither did.

### In-app dialogs replace window.confirm/prompt/alert

`backlog-tracker/public` has no native `confirm()`/`prompt()`/`alert()` call
left anywhere (verified by `grep`). A native dialog blocks every script on
the page for as long as it's open — including anything driving the board
programmatically, like a Claude Code session — which is what froze the tab
mid-deploy on 12 September (the project header's own "Approved for
Deployment" confirm), and it can't be styled, validated, or dismissed
except through its own OK/Cancel. One small modal (`#dialog-backdrop` in
`index.html`) plus four thin Promise-returning wrappers in `app.js` now
cover every shape the native calls did:

- `showAlert(message, opts?)` — OK only, no Cancel. Replaces `alert()`.
- `showConfirmDialog(message, opts?)` — resolves `true` (OK) or `false`
  (Cancel/Escape/backdrop click/✕). Replaces `confirm()`; `opts.danger`
  renders the OK button in `--danger` red for a destructive action.
- `showPromptDialog(message, defaultValue?, opts?)` — resolves the typed
  string, or `null` if cancelled, matching `prompt()`'s own contract.
  `opts.multiline`/`opts.rows` renders a `<textarea>` instead of a single
  `<input>` (used by the FAQ table editor's row-text field).
- `showFieldDialog({title, fields, ...})` — for more than one field at
  once (the FAQ image-insert dialog's URL + alt text); resolves an object
  keyed by each field's `id`, or `null` if cancelled.

All four drive the same one panel/state (`openDialog()`/`closeDialogWith()`
in `app.js`) — only one can be open at a time, matching how the native
versions behaved too. Every call site that used to be a plain synchronous
`if (confirm(...))`/`const x = prompt(...)` is now `await`ed, which meant
promoting several previously-synchronous event handlers (the projects-root
delegated click handler, a few modal button handlers) to `async` — nothing
else about their control flow changed, since each wrapper's resolved value
matches its native counterpart's return contract exactly (`showConfirmDialog`
→ boolean, `showPromptDialog` → string-or-null).

### Attachments (files, videos & screen recordings)

The Edit item modal's own **Attachments** block (below Comments), the
quick-comment modal and the New Item form let anyone attach files or a
screen recording directly to a ticket:

- **Attach file** — a file picker that takes several files at once: any
  image (PNG, JPEG, GIF, WebP, HEIC…), any video (MP4, MOV, WebM…), PDF,
  text (TXT, CSV, Markdown, logs), zip, JSON and Word/Excel/PowerPoint
  files. Each is uploaded to Firebase Storage the instant it is chosen.
  Images are capped at 15 MB, everything else at 100 MB. A file of another
  type, or over its cap, is named in a message and skipped; the others
  still upload. Where the browser leaves a file's type empty, it is read
  off the extension. The list of types and caps is
  `public/js/item-attachments.js`, kept in step with `storage.rules`
  (ticket AveRUvb8zcijYoamN2RN, 17 Nov 2026 — it used to take images only,
  so a screen recording saved as an MP4 could not be picked).
- **Record screen** — captures the browser's own share-picker via
  `navigator.mediaDevices.getDisplayMedia` and records it with
  `MediaRecorder`, in the first format the browser can make (WebM/VP9,
  WebM, then MP4 — Safari makes only MP4, and asking it for WebM used to
  make the button do nothing); clicking **Stop recording** (or ending the
  share from the browser's own "Stop sharing" bar) finalizes and uploads
  the clip the same way. No third-party recording library or separate
  screen-capture tool needed. Where a browser can't record a page's screen
  (iPhone and iPad), it says so and suggests recording with the device's
  own screen recorder and adding the video with **Attach file**.

Both write to Storage under `attachments/{itemId}/{fileName}` and append
`{type, contentType, url, path, name, size, uploadedAt}` (see the
`backlogItems` schema above; `type` is `"image"`, `"video"` or `"file"`,
and older entries have no `contentType`) onto the item. An image shows as a
thumbnail, a video as an inline player and any other file as a file icon
that opens it — the file itself never touches Firestore, only its
resulting metadata does, the same "small bounded value on the doc, real
payload elsewhere" split every Firestore-backed app needs past a few
hundred KB. Removing an attachment deletes both the Storage object and its
array entry; a Storage-delete failure (e.g. `storage.rules` not deployed
yet) is logged, not surfaced, since an orphaned file is harmless and the
board's own state is what the array entry actually governs.

A card with at least one attachment shows a small 📎N count on the board
next to its comment icon — the same "count badge next to the icon that
opens the thing" pattern the pencil's own comment count already used.

**Requires Firebase Storage enabled for `backlog-tracker-e4ed2`** (a
one-time manual step, same as Cloud Functions needed — see README.md's
"Attachments" section) and `storage.rules` in the deploy workflow's
`--only` list alongside `firestore:rules`; without either, uploads fail
until fixed. `storage.rules` mirrors `firestore.rules`' open-but-validated
posture: open read, write gated on size (< 100MB) and content-type
(`image/*`, `video/*`, `text/*`, PDF, zip, JSON and Office files) rather
than by who's writing — same prototype-stage,
no-auth caveat as everything else in this app.

### Skills page: change history (eKFIGtskqbnUTqUTBFBl)

Each skill card's own **Change history** button lazily loads and lists that
skill's `docRevisions` (`skillId` filter, newest-replaced-first) — who
changed it, when, and via console or MCP (see "Data model" →
`docRevisions`/`skills` above for how a console-made change gets into this
trail at all, since the browser can't write `docRevisions` directly).
**View changes** on a row renders a per-file added/removed/changed diff
between that revision's file set and whatever replaced it (the next-newer
revision, or the skill's current live files for the most recent one) — a
line-level diff (`lineDiffHTML`/`skillFileSetDiffHTML` in `app.js`) built
on the same `lcsDiff` longest-common-subsequence engine the FAQ revision
reviewer's word-level diff already uses, just split on lines instead of
words so a code/markdown file's newlines survive the render. Both the
revision list and an opened diff are fetched/computed on demand and cached
per skill for the page's lifetime, not re-fetched every time
`renderSkillsPage()` redraws the list (which happens on every Firestore
update to any skill).

### Platform and Internal operations

Every concept and project carries a **type**: exactly one of `Platform` (the
Personalisation Hub product) and `Internal operations` (how PH runs
internally: Staff Kanban, RevOps, customer care, FAQs/help centre, the
backlog tracker and related tooling). Never both. The word is "Platform",
not "Product". Ticket ufOwuueuj1f5vmeN0xi2.

- **Required on create.** New concept, New project and the MCP
  `create_concept` refuse a missing type ("Choose a type");
  `firestore.rules` (`entityTypeOk`) refuses it for any person. The
  automation user and the synthetic `general` project are exempt, and a
  concept made by demoting a project carries the project's type (or none).
- **Promotion carries it over.** The Promote modal pre-fills the concept's
  type and locks it; a concept with no type lets the person choose one,
  which is then written to both the project and the concept.
- **Shown and filtered.** A type badge sits on every concept card, every
  project header and the project's Settings page; the concept list has a
  Type filter (All, Platform, Internal operations, Unassigned) and the board
  header filters projects the same way. The type is editable from the
  concept's page (until promoted) and the project's Settings page.
- **Existing items ship unset.** An item with no type reads as `""`
  (`typeOf` in `public/js/entity-type.js`), carries an **Unassigned** badge
  and appears in BOTH map views so it can be sorted. The older name-based
  `INTERNAL_RE` list still keeps its matches off the Platform map.
- **Two maps, one toggle.** The Concept Incubator hero has a Platform /
  Internal operations toggle (remembered per browser). The Platform view is
  the map described below, showing Platform and unassigned items. The
  Internal operations view (`public/js/internal-map.js`) is a separate,
  fixed-layout map following Rob's sketch of 30 Oct 2026, left to right:
  Customer Success (Clients, one agent per client, the feature request queue
  that agents vote on and prioritise, Case studies), PH in the middle,
  Sales on the right (PH website, Sales agents, Prospects & brands, Ads,
  Social posts & PR, Support email); **Feature Release** along the top
  (prioritised requests, a release pipeline with a gate, live releases) is
  **step 2**; the **FAQs DB** under PH (connected to PH by API, to live
  releases, Support email and the PH website) is **step 1**; a dotted line
  runs from PH releases to Ads, Social posts and PR. There are no notes
  under the sketch (the September focus notes were personal and were
  removed). Internal operations
  and unassigned concepts and projects sit in a strip under the sketch.
  It is not pinned or saved (no Re-arrange, History or release filter).
- **Sales process** (ticket 3FXpHzR1vEqhXzyiyEis, 6 Nov 2026; replaces the
  five Sales lanes of 6nnKlR0vVtRjNBnRUQzc). One lane under the three columns
  reads as a single process, process first and documents second, in two rows
  of five steps: TAM database, TAM awareness campaigns, industry-page
  conversion (calculator download or demo request), Prospect / Hot Prospect,
  ACE opportunity created, live meetings, live demos, customer internal
  approval, proof of concept, rollout to the full estate. The matching AWS
  ACE stage is written above each step (Prospect, Qualified, Technical
  Validation, Business Validation, Committed, Launched). Supporting detail
  (TAM enrichment and freshness, score tracking, funding status on the lead
  card) is a note inside the relevant step, never a lane. **Documents are not
  lanes**: each is its own node, in its own colour, hung under the step that
  creates it and drawn only where needed: industry one-pager and the
  customised, logo-branded prospect pack at Prospect / Hot Prospect (made
  before the ACE opportunity, used to define and attach to it). The
  AWS funding line, which starts at ACE Technical / Business
  Validation (the arrow leaves that step, not the ACE opportunity): one
  combined "Funding prompted & eligibility check" box, then the POC funding
  draft, Sandbox credit draft and Claim sign-off document, each noting the
  skill and template that produce it. The lane title says the documents are
  auto-created and then provided manually by the account owner. There is no
  Manual submission or Funding status box. (Ticket X5dIkrYoD3z6Z22k4YWX.) A legend separates process steps from documents. A
  document not tied to a step is not shown. **TAM profile and branded demo**
  (ticket pNbib8Ith2yaS0KxcXnY): the TAM step's note records that each company
  profile keeps the latest logo, the company's email formats (e.g.
  firstname.lastname@domain; several formats or domains allowed) and an
  auto-generated org chart (structure, who reports to whom), all refreshed by
  the monthly research agent; the industry-page conversion step's note records
  that a visitor who starts the walkthrough demo is identified by matching
  their email to the TAM email formats, and the demo is then branded with that
  company's logo and company info and uses the walkthrough for its industry.
  This is a diagram only; none of the integrations is built.
- **Bridge links.** An internal operations item that connects to the
  platform is drawn as a dashed **bridge node** inside the PH box (Embedded
  support, MCP Access, PH releases), not as a second copy of a platform item;
  clicking one opens the Platform map. Bridge nodes are drawn on the
  Internal operations view only.
- **MCP.** `list_projects`, `get_project_docs`, `list_concepts` and
  `get_concept` return `type` (null when unset); `list_concepts` takes an
  optional `type` filter; `create_concept` requires `type`;
  `set_concept_type` (refused once promoted) and `set_project_type` change it.
- Tests: `test/entity-type.test.mjs`, `test/firestore-rules.test.js`,
  `test/mcp-server.test.js`, `test/ui/console-click.test.mjs`.

### Concept Incubator hero — the live system map

The top of the Concept Incubator page is ONE shared system map (C4-style
system context; `public/js/system-map.js`, test `test/system-map.test.mjs`),
not one diagram per concept or project. It is rebuilt on every change to
`projects`, `concepts`, `interfaces` and `releases`.

- **Nodes**: the PH core backbone (Campaigns & Experiences, Agent Harness
  (LangChain), MCP Access, Vector Database, Devices & Touchpoints, Store
  Data, Live Visitor Profile — fixed in `SYSTEM_MAP_CORE`, not board
  entries), every non-archived PH product project and every un-promoted
  product concept. Internal items are left out (`INTERNAL_RE`: the
  Backlog Tracker & FAQs project / PH Agent Console, PH Brand, Customer
  Support, Customer Success, PH Team — ticket bqSmBpSKbJgnsRQ6HG0d), and
  Live Visitor Profile is drawn once, as a concept, in the PH Core slot. Status styling: **Live** (core, or a project whose
  release is live), **Project**, **Concept**, **External**. A project shows
  its release ("Release 5.0") beside its name.
- **Hover description**: hovering a project or concept node shows, besides
  the full name, status and release, a one- or two-sentence description
  (`shortDescription()`): a project's `description` (set on its Docs page);
  a concept's `description`, else the first prose lines of its README. A
  node with neither says "No description yet — add one on the Docs page."
  so the gap is visible. Click-through to the landing page is unchanged.
- **Lines**: one per interface contract (`interfaces`), labelled with the
  contract's optional `flowLabel`, else its name; clicking opens the
  contract. A new contract adds a line with no code change. The platform's
  own structure and how a named project/concept plugs into it live in
  `SYSTEM_MAP_LINKS` (decided on ticket YyZwqyUOvEmkivV31jzo): Profile →
  Campaigns (personalised), Store Data → Campaigns (localised), Harness
  creates/optimises Campaigns, Campaigns → Devices, Devices → Vector DB →
  Harness (the closed insights loop, drawn heavy), DSP demand (Campaigns,
  orange) and supply (Devices → DSP, green), Experience Templates fed by
  Profile, Store Data and Products & Pricing, Retail Media Insights reading
  the Vector DB.
- **Concepts and externals drawn by the map itself** (ticket
  M3SX6sWxRuNpr6jp5Pam): Concept nodes Custom & Edge Models, Digital
  Identity & Resolution, a single Offsite (Meta, YouTube) box, Federated PH
  Instance (`SYSTEM_MAP_CONCEPTS`; a board project/concept of the
  same name replaces the built-in one), PH Core nodes Check-in and Brand
  Guidelines, and External nodes Salesforce CRM, Amazon Connect and Advertiser (`SYSTEM_MAP_EXTERNALS`). Their labelled lines
  are `EXTRA_LINKS`. A red dashed **PII boundary** (a band along the bottom) encloses
  the identity vault, Salesforce and Amazon Connect; Live Visitor Profile,
  Agent Harness, agents and Campaigns stay outside it — agents never
  cross it. Federation is shown only as two lines to MCP Release, outside the platform box, to its left: Advertiser (external) and Federated PH Instance
  (concept). The earlier retailer / partner / advertiser PH instance boxes
  and the Data Clean Room were removed (ticket 6auvMEuRHAhgl8r8HC1x).
- **Release filter**: picking a release dims everything except its
  projects, the lines touching them and their other ends.
- **Clicking a node** opens its landing page (`artifactUrl`), else the
  project's Docs page / the concept's detail page.

- **Fit to page** (ticket bqSmBpSKbJgnsRQ6HG0d; its Data Clean Room node was
  superseded and removed): The map never scrolls sideways: the SVG's
  viewBox scales the whole map to the container width on load and resize
  and the hero grows taller instead; labels are cut to short forms with
  the full text in the tooltip; zoom (+/−, Ctrl+scroll), drag-to-pan and
  Fit are available, and the default view is the whole map.

**Incremental updates, not a rebuild (ticket `tXFTzQ4wZkpCf2gvB0YP`).** The map's
data model — `SYSTEM_MAP_CORE`/`_CONCEPTS`/`_EXTERNALS`/`_LINKS` plus the
board's projects, concepts, releases and interface contracts — is separate
from rendering. Positions are **pinned**: Firestore `systemMap/layout` holds
`pinned.{wide,narrow}` (`{nodes:{id:{x,y}}, cy, hn}`), the `snapshot` of what
each node and line said when last saved, and a `rev`. A pinned node never
moves; the platform stays put; a new node is placed in free space around the
pinned ones; the drawing only grows downwards. An editor's tab saves when
something differs, and each save appends a create-only `systemMapRevisions`
doc (author, reason, mode, minimal `changes` list — add/update/remove/move of a
node or line — and `prevPinned`). **History** lists them; **Roll back
positions** restores `prevPinned` (nodes and lines follow the board's data, so
only positions roll back). **Re-arrange** is the only action that lays the whole
map out afresh. Agents change the data (the constants above or the board), never
the drawing code. Rules: `systemMap/layout` and `systemMapRevisions` (editors
write; revisions are never edited). Test: `test/system-map.test.mjs`
("incremental, pinned").


### Concept Incubator page

Two pages, mirroring the Skills list/Docs-page split above: **Concept
Incubator** (`openConceptIncubatorPage`) lists every `concepts` doc as a
card (name, Active/Promoted status, last updated) with a **+ New concept**
button that asks only for a name — README/requirements/discussion are
filled in afterward. Clicking a card opens its own detail page
(`openConceptDetailPage`, not URL-routed, same as the per-project Docs
page it's laid out like):

- **README** and **Requirements** blocks each save independently
  (`setConceptReadme`/`setConceptRequirements`) — the "update specific
  requirements incrementally" behaviour the ticket that built this asked
  for; saving one never touches the other.
- **Discussion** is a comment thread (`concept.comments`, rendered with the
  same `eiNoteRowHTML` row markup `backlogItems.notes` already uses) with a
  composer that has its own dictation-mic instance
  (`createDictationController`), same as every other comment box in this
  console.
- **Promote to project…** (still-active concepts only) opens a modal
  asking only for the project name (defaulted to, and kept as, the
  concept's own name); program and release are optional and can be set
  later from the project's Docs page. There is no repo-folder field.
  Submitting is one click and calls `promoteConceptToProject`, which: picks
  a free repo folder from the name (`pickRepoFolder` in
  `public/js/promote-plan.js`: slug, then `-2`, `-3`…) and links it as
  `repoFolder` with `deployBranch` `deploy/<folder>` (the folder itself is
  committed by the first ticket that lands — the browser cannot write to
  GitHub); creates the `projects` doc seeded with the concept's
  `readmeMd`/`requirementsMd` and documents; flips the concept to
  `status: "promoted"`. **It raises no tickets** (3 Nov 2026: splitting
  the text filed 41 junk tickets for work already live): the new project's
  Backlog starts empty and tickets are filed deliberately afterwards. A
  confirmation dialog says so.
  **Bulk select on the Backlog column**: ticking cards shows Archive N /
  Delete N in the column header, each behind one confirmation (Backlog
  cards only).
- **Delete this concept** — active concepts only; a promoted concept's
  delete control is hidden and its rules write is refused regardless, since
  it is the provenance record for the project it became.

A promoted concept renders read-only past the discussion thread (README/
Requirements textareas disabled, their Save buttons and the Promote/Delete
blocks hidden) and shows a "Promoted to project `<name>`" line linking the
reader to the fact that the project's own Docs page is now the source of
truth — the concept itself is kept, never archived or deleted, as the
record of where that project's README/requirements came from.

Every write on this page is gated the same `[data-editor-only]` +
`requireConceptEditor()` way as the Skills page's own writes (sign-in
first, then refuse a `viewer` role with an explanatory alert) — reading the
list and an individual concept's README/requirements/discussion needs only
sign-in.

### Feed in requirements → suggested build batches (z1Q6fxo0yTjamxVMWQK5)

A project's **⋮ → Feed in requirements** action (per the header's "one
primary CTA, everything else in ⋮" convention — see root `CLAUDE.md`)
opens a modal where several requirements can be pasted at once — one per
blank-line-separated paragraph (`splitRequirementsText` in
`public/js/build-batches.js`) — and previewed, before anything is created,
as **suggested build batches**: grouped by `category` (the board's
existing proxy for "shared area/files" — the same signal a grooming pass
already corrects, per "Every card carries a category" in root `CLAUDE.md`),
each item additionally tagged with a rough small/medium/large effort
estimate AND a rough low/medium/high priority estimate
(`estimateEffort`/`estimatePriority`, cwehxSMZv8noJQv5kB22 — both keyword-
and, for effort, length-based heuristics; a starting point, not a real
estimate, same spirit as `suggestCategory`). Items within a batch sort
highest-priority-first, then smallest-effort-first (`PRIORITY_ORDER`/
`EFFORT_ORDER` in `build-batches.js`); a batch also reports
`priorityCounts` alongside `effortCounts`. **Create items** then runs the
same `addItem()`/`generateTitle()`/`suggestCategory()` pipeline the
single-item New Item form uses, once per pasted requirement, into that
project's Backlog, now ALSO persisting the previewed `effort`/`priority`
onto the created card (`addItem`'s optional `extra` param) rather than
computing them for the preview and discarding them at create time — nothing
is auto-approved or auto-sent to Ready for Dev; the output is meant to help
a person decide what to send for development as one bunch, not to act on
its own. `effort`/`priority` are real, first-class fields on a
`backlogItems` doc: `item.effort || estimateEffort(item)` and
`item.priority || estimatePriority(item)` — a real value, set from the Edit
item modal's own `effort`/`priority` selects (`null` = "Unset — use the
automatic guess"), always wins over the heuristic. Shown as a badge on a
Backlog card only when a real value is set (an unset/guessed value isn't
worth a badge on every card). `clusterBacklogItems`/`estimateEffort`/
`estimatePriority`/`splitRequirementsText` are pure, dependency-free
functions (`public/js/build-batches.js`, no Firebase, no DOM) so they're
unit-testable with plain `node` (`test/build-batches.test.mjs`) — same
"pure logic split out for testability" pattern `functions/train-lock.js`
already uses.

### Skill feedback loop (Gcc30u2bQEJwEdUTN6X8)

A running, append-only list of real misses on `skills/{id}.misses` (see
"Data model" → `skills/{skillId}` above for the shape) — when a build
failure or a review finding (security/scalability, etc.) surfaces
something the governing skill should have prevented, it's tagged against
that skill so its owning team gets a real list of gaps to improve it
against, instead of guessing. Two write paths, both appending the same
shape via `FieldValue.arrayUnion` (never a read-modify-write — two misses
reported around the same moment must never clobber each other), neither
touching the skill's own `updatedAt`/content (a miss report and an authored
edit are two distinct signals, never conflated):

- **`report_skill_miss`** (MCP, `board.write`) / **`list_skill_misses`**
  (MCP, `board.read`) — any team member's agent, e.g. after a build failure
  it just fixed, or after finding something in review. `functions/mcp-server.js`.
- **The console itself** — any signed-in member (not editor-gated; tagging
  a gap isn't editing the skill) via the Skills page's **Report a miss**
  button, same shape, `reportedVia: "console"`.
- **The Deploy flow's own phase-bound skill review**
  (`ROUTINE_INSTRUCTIONS.md`'s DEPLOY block, e.g. a cybersecurity/
  scalability skill applied to the combined train diff) — the fired
  Routine session has no MCP session of its own, so it writes the same
  shape directly via a Firestore REST PATCH with its board-automation
  credential, `reportedVia: "routine"` implicitly (no `reportedByEmail`).

`get_skill` additionally returns `missCount`. The Skills page renders each
skill's misses in an expandable **Misses (N)** panel (newest first),
alongside the **Report a miss** button.

### Periodic skill-review nudge (eKslgrwgRJtoxyx0oNSV)

Lighter-weight companion to the skill feedback loop above: rather than
waiting for a specific miss, nudges an owning team to deliberately revisit
a skill on a cadence — whichever of two signals trips first:

- **Day-based cadence** — `daysSinceReview >= reviewCadenceDays` (default
  `SKILL_REVIEW_DEFAULT_CADENCE_DAYS = 60`), measured from
  `lastReviewedAt`, or `createdAt` if the skill has never been explicitly
  reviewed (a skill with neither field — from before this existed — gets no
  nudge rather than a false "overdue since the epoch").
- **Deploy-count proxy** — `deploysSinceReview >= reviewDeployThreshold`
  (default `SKILL_REVIEW_DEFAULT_DEPLOY_THRESHOLD = 15`), counted as the
  number of `backlogItems` that reached `status: "published-live"` (by
  `mergedAt`) since that same baseline. This repo has no single
  cross-project "train count" to read — each project runs its own
  independent deployment train — so a shipped ticket is the concrete,
  countable unit every train actually produces; it is deliberately NOT
  scoped to whether this specific skill was bound to the phase that shipped
  each one (`settings/phaseSkillBindings` changes over time and a shipped
  ticket doesn't record which bindings were active for it), so treat this
  as a nudge to go look, not a precise metric.

Computed on read, not by a new Cloud Function or scheduled job —
`skillReviewStatus` in `functions/mcp-server.js`, called from `list_skills`
and `get_skill` (`reviewDue`/`daysSinceReview`/`deploysSinceReview`/
`lastReviewedAt` on each result), backed by ONE `backlogItems` query per
call (`loadPublishedMergeDates`) reused across every skill being scored,
not one query per skill. **`mark_skill_reviewed`** (MCP, `board.write`) —
also callable from the Skills page's own **Mark reviewed** button — sets
`lastReviewedAt`/`lastReviewedByEmail` and optionally overrides
`reviewCadenceDays`/`reviewDeployThreshold` for that skill; deliberately
does not touch `updatedAt`/files, same "reviewing isn't editing" separation
the skill feedback loop's own writes keep. The Skills page's own **Review
due** badge is a client-side, day-cadence-only approximation
(`skillReviewBadgeHTML` in `app.js`) — it does not reimplement the
deploy-count half, so the complete due-ness logic lives in exactly one
place (`functions/mcp-server.js`) rather than two that could drift; the MCP
tools are the authoritative source.

## Functional requirements — notification & automation (Cloud Functions)

Three Cloud Functions, all in `backlog-tracker/functions/index.js`:

1. **`notifyOnProjectReadyForReview`** (`onDocumentUpdated` on `projects`)
   — the **Notify Claude** button's function, and the only notify path
   left. Fires once when `notifyRequestedAt` is bumped to a genuinely new
   value (guards against re-firing on an unrelated project edit like a
   rename) — not once per backlog item. An earlier version had a second
   function, `notifyOnBacklogItemCreated`, that posted automatically on
   every single new item; removed because it was noisy — one Slack message
   per line typed or dictated, long before a project was actually ready
   for anyone to look at. Fetches everything currently in that project's
   Backlog column — or, when `projects/{id}.notifyItemIds` is a non-empty
   array (set alongside `notifyRequestedAt` by the Backlog column's own
   per-card checkboxes and its column-header "select all"), just that
   hand-picked subset instead, re-checked against what's actually still in
   Backlog at fire time. An unset/null/empty `notifyItemIds` means "send
   everything", the original default — **fires the Routine first, then
   posts to Slack** (order
   matters — reversed from an earlier version — so a resolved session link
   can ride along in the Slack message), each independently (either
   no-ops on its own if its secret(s) aren't set, never blocking the
   other):
   - Fires a **Claude Code Routine's API trigger** directly — `POST` to
     `https://api.anthropic.com/v1/claude_code/routines/{id}/fire` with a
     bearer token and the required `anthropic-version: 2023-06-01` and
     `anthropic-beta: experimental-cc-routine-2026-04-01` headers (the
     version header is not optional — its absence is the single most
     likely cause if this ever silently stops working; reproduce with
     `curl` directly against the fire endpoint before re-patching this
     function). Configured via two Firebase secrets,
     `CLAUDE_ROUTINE_FIRE_URL` and `CLAUDE_ROUTINE_TOKEN`, synced from
     GitHub Actions repo secrets the same way `NOTIFY_WEBHOOK_URL` already
     is — the shared, project-wide fallback. **Per-member routine binding**
     (VNE6dxMu3h6jO3g6FNNB): before falling back to those two secrets, the
     shared `resolveRoutineCredentials(db, triggeredByEmail, sharedFireUrl,
     sharedToken)` (used by all three notify functions below) reads
     `routineBindings/{email}.fireUrl`/`.token` (server-only; a legacy
     `consoleUsers/{email}.routineFireUrl`/`.routineFireToken` pair is
     honoured once and migrated) for the
     member who clicked — `notifyRequestedByEmail` on this function,
     `deployNotifyRequestedByEmail`/`groomRequestedByEmail` on the other
     two, written by the board's own click handlers
     (`public/js/app.js`'s `requestNotify`/`requestDeployNotify`/
     `requestGroom`) — and uses that member's own Routine when both fields
     are set, so their board clicks fire a session under their own Claude
     account/usage instead of the shared one. A member sets this once via
     the MCP tools `get_routine_setup_instructions`/`set_my_routine_binding`
     (`functions/mcp-server.js` — see "Functional requirements — team
     access & the MCP server" below); falls back to the shared secrets on
     any read failure, a missing/half-set binding, or an unattributed
     click, so this is purely additive. Which one actually fired is
     recorded as `firedVia: "member" | "shared"` on
     `notifyRoutine`/`deployRoutine`/`groomRoutine` below. The Routine's own
     prompt (owned at claude.ai/code/routines, not in
     this repo) carries the actual investigate → fix → note →
     move-to-Ready-for-Testing workflow; this function's only job is
     telling it which project and what's in Backlog. This is the half that
     closes the loop without a human relaying anything. The fire response's
     `claude_code_session_id` field (confirmed by a live `curl` test
     against the real endpoint — a research-preview API, so re-confirm the
     response shape with `curl` if session links ever stop appearing
     before assuming the code is wrong) becomes `https://claude.ai/code/
     <id>`, stored on `projects/{id}.notifyRoutine.sessionUrl` for the
     board's own spinner/link UI (see "Notify Claude progress" above) and
     included in the Slack message below.
   - Posts a plain webhook (`NOTIFY_WEBHOOK_URL` secret) — a Slack message
     reading "Claude was assigned N items from the Backlog for
     '\<project\>'. Click here to track their progress: \<sessionUrl\>"
     (falls back to `"(session link unavailable)"` if the Routine secrets
     are configured but no id came back, or `"(Routine fire not
     configured — no Claude session started)"` if they aren't set at all),
     or whatever else the secret points at. Still needs a human (or a
     separately-configured relay) to actually act on it; it's the "tell
     someone something happened" side-channel, not the mechanism that gets
     Claude's attention.
   - Writes `projects/{id}.notifyRoutine` (`status: "in-progress"` on a
     successful fire, `"error"` with `errorMessage` otherwise; `firedAt`,
     `sessionId`/`sessionUrl`, `itemCount`, and `sentItemIds` — the exact
     item ids this click sent, used to compute "new since last notify" on
     the client) so the board's Notify Claude button can show real
     progress instead of going silent after the click. The fire request's
     `text` asks the fired session to PATCH this back to `"done"`/`"error"`
     with a `finishedAt` when it stops; see "Notify Claude progress" above
     for the client-side staleness fallback that covers a session running
     an older prompt without that instruction, or one that crashes.

2. **`notifyOnProjectReadyToDeploy`** (`onDocumentUpdated` on `projects`) —
   the **Notify Claude — Deploy** button's function. Same trigger shape as
   `notifyOnProjectReadyForReview` above (fires once on a genuinely new
   `deployNotifyRequestedAt`, posts to `NOTIFY_WEBHOOK_URL` if set, fires
   the same Routine via `CLAUDE_ROUTINE_FIRE_URL`/`CLAUDE_ROUTINE_TOKEN` if
   set — either independent of the other), but for the opposite end of the
   pipeline: it queries `status == "ready-to-publish"` (Approved for
   Deployment) instead of `backlog`. **The fire `text` is a self-contained
   "DEPLOY REQUEST" block, not the usual "N items in Backlog" shape** —
   it explicitly states these items are already implemented, tested, and
   confirmed, names the project's integration branch, tells the fired
   session not to investigate or re-implement them, and — since the fired
   session has no GitHub-authenticated tooling and can't merge anything
   itself (see "Notify Claude can't push" in README.md) — asks it to verify
   the train over plain git (every item's `deployCommit` is an ancestor of
   the branch, nothing on the branch is still `ready-for-testing`), then
   PATCH `projects/{id}.trainReady: true`, or leave the items as
   `ready-to-publish` with a note if it can't.
   `backlog-tracker/scripts/run-backlog-automation.js` (via
   `.github/workflows/backlog-automation.yml`, a scheduled job with its own
   GitHub Actions-native credentials, no AI involved) is what actually
   merges the train's single PR and flips every ticket on it to
   `published-live`. This was a
   deliberate design choice over relying on the Routine's
   own shared prompt (see "The Notify Claude Routine" below) to infer a
   deploy request from a differently-shaped fire, since that prompt is
   written and tested only for the Backlog-investigation shape — editing it
   is outside this repo's reach anyway (it lives at claude.ai/code/routines),
   so the fire `text` itself carries the full self-contained instructions
   instead. Same per-project `routinePromptMd` addendum mechanism as
   `notifyOnProjectReadyForReview` (see "Per-project Routine instructions"
   below) — prepended the same way, ahead of the DEPLOY REQUEST block.

3. *(Removed 2 Nov 2026.)* `onBacklogItemPublishedLive` used to promote
   approved FAQ proposals and, behind `faqAutoFlagOnLive`, flag articles
   when a ticket reached Merged to Main. A ticket moving through the
   pipeline now triggers **no** FAQ work; the Help Centre is audited once
   per release instead — see "Release audit".
4. **`onFaqArticleRevisionApproved`** (`onDocumentUpdated` on
   `faqArticles`) — the other half of the same rule: when
   `pendingRevision.reviewStatus` flips to `"approved"` it promotes the
   revision immediately — approval is the only gate. `promoteFaqRevisionIfReady`
   is a transaction that re-reads the article, writes the live fields,
   keeps `previousRevision`, and (for a release-audit proposal) appends a
   `went-live` line to the audit's log.

### Release audit (Live on AWS Marketplace → audit → review → publish)

**Why (2 Nov 2026, ticket `oGRC10ZobaV4BBkLC16X`).** Customers get a
feature only after engineering finalises it and the release is live on AWS
Marketplace, so a help-article update proposed when a ticket merges is too
early and mostly irrelevant. The per-ticket check (the Deploy flow's FAQ
impact review step, the `onBacklogItemPublishedLive` trigger and the
`faqAutoFlagOnLive` flag) was removed for every project.

**The release status.** `releases/{id}.status` is `draft` or `live`; `live`
is shown as **Live on AWS Marketplace** (the stored key is unchanged so the
rules, the public help centre and MCP `search_faq` keep working). An editor
sets it from the Releases page (**Mark live on AWS Marketplace**, one-way,
confirmed). `firestore.rules` already refuses going back.

**The trigger.** `onReleaseMarkedLive` (`functions/index.js`) creates
`releaseAudits/{releaseId}` — `status` `requested` → `running` (it stamps the
session link) → `done` / `failed`, `requestedAt`, `requestedByEmail`,
`projectIds`, `checkedArticleCount`, `checked` (every article read and its
outcome), `summary`, and an append-only `log` — and fires the Routine with
`=== RELEASE AUDIT REQUEST ===` (`functions/release-audit.js`). It uses
`create()`, so a re-delivered event never starts a second audit.

**The audit agent** (`ROUTINE_INSTRUCTIONS.md` → "The 'Release Audit'
flow"). Reads what shipped — the release's Merged-to-Main tickets, its
projects' README and Requirements, release-notes documents — and reads every
help article. It writes only proposals, never live fields:
- *update*: `faqArticles.pendingRevision` with `sourceReleaseId` (no
  `sourceItemIds`);
- *new article*: a draft article whose `pendingRevision.isNew` is true;
- *retire*: `faqArticles.retireProposal {reason, sourceReleaseId,
  reviewStatus}`.

**The review view.** `#releases/<id>/audit` (Releases → **Help Centre
audit**) shows the batch grouped as Proposed updates / New articles / Articles
to retire. Per row: **Review side by side** (the existing old-vs-new diff
view), **Approve**, **Edit**, **Reject**; plus **Approve selected** /
**Reject selected**. Approving an update or new article publishes it straight
away (`promoteFaqRevisionIfReady`, previous text kept for revert); approving
a retirement unpublishes the article (`status: "draft"`, `retiredAt`);
rejecting discards the proposal (a new-article draft is deleted).

**The audit log.** `releaseAudits/{id}.log` records `audit-requested`,
`audit-started`, `audit-finished` / `audit-failed`, then per article
`approved` / `rejected` / `edited` / `retire-approved` / `retire-rejected`
with who and when, and `went-live` when it was published. The view shows the
log and a "what was checked" list.

**Public Support Centre.** Approved changes publish to the Help Centre
(`faq/`, via the hourly export) now. The Support Centre is moving to native
WordPress pages driven through the Elementor MCP under the PH Website
project; that hand-off follows the "Support non-GitHub projects: Elementor MCP
deployment" ticket and is not built here — approval timing (after the release
is live) is what keeps the content in step with the release being marketed.

**Tests.** `test/release-audit.test.mjs` (classification, log shape on both
sides, fire text, and guards that the per-ticket flow stays removed).

### WordPress publish status in FAQ Management (3 Nov 2026, ticket `LYbxv1nqC3EaJ53ryaa8`)

Publishing to WordPress is **not** done from the console. The "PH Support
Centre" snippet on personalisationhub.com pulls the console's export
(`faq/data`) hourly and creates, updates and retires the Help articles itself
(all fields, sanitising, image copy, link rewrite, 301s, revisions, URL map).
The console holds no WordPress credential and never writes to WordPress; an
earlier push publisher (`help-publisher.js`, `faq-wp-publish.js`) duplicated
that sync and was reverted. Content stays mastered here; release-audit
approvals reach WordPress through the export with no extra step.

FAQ Management only **reads** the public, read-only endpoint
`GET https://personalisationhub.com/wp-json/ph-help/v1/published` (cached
5 minutes on the WordPress side): `{lastSync, pending, failed: [articleId…],
articles: [{id, url, wpId, hash, updatedAt}]}`, where `hash` is the
`contentHash` WordPress last synced (first 16 hex chars of sha256 of
`bodyMd`, as `scripts/faq-export.js` computes it; the page computes the same
digest in the browser). It is fetched client-side on opening the page and
every 5 minutes while it is open (`public/js/wp-publish-status.js`). Each
article shows a badge in the list and in the editor's "Live at" line:

- **Live**: present, and its hash equals the article's current contentHash.
- **Waiting**: published and in range here, but absent or with an older hash
  (WordPress picks it up within about 2 hours: hourly export, then hourly sync).
- **Failed**: its id is in `failed`.
- **Not published**: draft, retired, or outside the live release's range
  (same range rule as `articleAppliesToRelease`; no live release means no
  range filter).
- **Status unavailable**: the endpoint could not be read (blocked, non-200,
  malformed). The page still loads.

"Live at" uses the endpoint's `url`, falling back to
`https://personalisationhub.com/support-centre/article.html?id=<id>`. The
page header shows "Last WordPress sync: <time>". Tests:
`test/wp-publish-status.test.mjs` and two scenarios in `test/ui/console-click.test.mjs`.

### Public help search for AI agents (3 Nov 2026, ticket `5pNsaRPdnruE0n6Gnd25`)

A public, read-only, no-sign-in endpoint so AI assistants can answer from the
published help articles without crawling pages. `functions/help-search.js`
(the `helpSearch` function), served on the console's Hosting site at
`/help-api/**`:

- `GET /help-api/search?q=…&release=…&limit=…` — ranked results, each with
  `title`, `directAnswer`, `summary`, `url` (the
  personalisationhub.com/support-centre/ URL from the WordPress site's public
  `GET /wp-json/ph-help/v1/published` map, cached 5 minutes, falling back to
  `/support-centre/article.html?id=<id>`), `articleType` (falling back to `docType`), `category` (the top-level category, as in the Support Centre breadcrumb), `folder` (only when the article sits in a folder) and `lastUpdated`.
- `GET /help-api/article?id=…|slug=…` — the full article (`format=md` or
  `Accept: text/markdown` gives real markdown with the source URL, as does the
  MCP `get_help_article`): the article's WordPress markdown twin
  `<url>?format=md` (cached 5 minutes), or, when WordPress can't be reached or
  the article has no recorded URL, an HTML-to-markdown conversion of the body
  (`functions/html-to-md.js`: headings, lists, tables, links, code). The JSON
  `bodyMd` is the stored body unchanged.
- `POST /help-api/mcp` — a stateless, public, read-only remote MCP server
  (9 Nov 2026: it presents itself as `personalisation-hub` / "Personalisation Hub"
  (`websiteUrl` https://personalisationhub.com, version 2.1.0). `initialize`
  `instructions` say what the platform is, which tool answers what, and the
  rules: cite returned URLs, never invent prices, use only what the tools
  return. `resources/list` and `resources/read` serve the site's `/llms.txt`
  and, once the site serves it, `/llms-full.txt` as `text/plain`, proxied and
  cached 5 minutes like the tools; `prompts/list` answers `[]`.)
  (streamable HTTP, no sign-in) serving exactly the ten tools the WebMCP
  tools on the site pages define: `describe_platform`, `list_industries`,
  `get_industry`, `get_feature`, `search_help`, `get_help_article`,
  `start_free_trial`, `book_demo`, `get_installation_spec`, `calculate_business_model` (5 Nov 2026: the business model calculator — lists the supported industries and their inputs, returns an estimate and a calculator link pre-filled with the figures; the .xlsx download stays gated on the person's own name, company, work email and consent), (3 Nov 2026,
  "Public read-only remote MCP server"; the install spec 4 Nov 2026, "Agent-ready
  installation spec" — the AWS Marketplace listing, pricing, prerequisites,
  CloudFormation launch steps and parameters, verification and recovery,
  with anything not yet public marked `unconfirmed`). It holds no content of its own: `tools/list` is
  `GET https://personalisationhub.com/wp-json/ph-agent/v1/tools` and
  `tools/call` is `GET …/tools/{name}?args=<json>`, always to that fixed
  origin and only for those ten names (anything else is a JSON-RPC
  `-32602` without a request to the site). The result is passed through
  unchanged, so it matches the WebMCP tools exactly, and it is always live
  published content (blog posts, pages, industries, and help articles after
  the hourly help sync), never a copy or a build-time export. **Cached 5
  minutes per (tool, args)** with `X-Cache: HIT|MISS` (a request is a HIT only
  if every upstream answer came from the cache); **4 s timeout** and a
  256 KB size cap, then a plain `isError` result (`tools/list` a `-32603`
  error); a **failed fetch is remembered for 30 seconds only**, and the last
  good answer is kept and served in the meantime. Arguments longer than 2,000
  characters are refused. The 30-a-minute MCP rate limit below applies.
  `/llms.txt` lists the server URL (For AI agents section).
- **Never returned:** drafts, retired articles, anything outside the requested
  release (default: the live release; `release` takes an id or version, same
  resolution and range check as `search_faq`), and `pendingRevision` text. Only live fields are read.
- **Rate limit** per address and per endpoint class, per instance: 60 a
  minute for search and article, 30 a minute for `/mcp` (separate budgets, so
  one cannot use up the other). Over the limit is a 429 with `Retry-After`,
  `Cache-Control: no-store` and a JSON `rate_limited` body; every response
  carries `X-RateLimit-Limit|Remaining|Reset`. **Cache** the published set for
  60 s and each identical search *and* article for 60 s (`X-Cache: HIT|MISS`,
  `Cache-Control: public, max-age=60`). The WebMCP tools on site pages call
  these same endpoints, so they share the limits and the cache (the remote MCP
  server's own site-read cache is the 5-minute one above).
- **The published URL map is resilient** (3 Nov 2026): if
  `personalisationhub.com/wp-json/ph-help/v1/published` fails to load, that
  failure is remembered for 30 seconds only (not the 5-minute success TTL),
  a refresh that fails keeps the last good map, and results or articles built
  with no map at all (every link the `article.html?id=` fallback) are not put
  in the result cache, so they recover as soon as the map does.
- **Monitoring and alerts** (3 Nov 2026, ticket `jB00AFT7B5KPB8kOnWng`): each
  instance counts requests, 429s and 5xx in 5-minute windows. 50 or more 429s
  is an `abuse` alert (naming the top clients, kept in memory only); 5 or more
  5xx, or 20% of at least 20 requests, is an `errors` alert. Each posts once to
  `NOTIFY_WEBHOOK_URL` (the channel Notify Claude uses, so it reaches Rob) and
  logs at error level, then stays quiet 30 minutes per kind. An alert that
  fails to send never affects the request. **Test it:** `POST` the
  `helpApiTestAlert` function (not on the public Hosting site) with the
  `X-Board-Key` header; a "Test alert" message should arrive in the channel
  (the response says `webhookConfigured`).
- **Usage log:** one `helpSearchLog` document per search (normalised query,
  release, result count, `zeroResults`, `via` http|mcp, cached; no address).
  Members can read it; only the server writes. The release audit's fire text
  lists the most-asked zero-result queries of the last 90 days as content gaps
  (`zeroResultQueries` in `release-audit.js`).
- Scoring is the Support Centre's exactly: filler words are dropped first
  (`STOP_WORDS` in `help-search.js`, the list the WordPress search uses; a query
  of only stop words keeps its original terms), then every remaining query term
  (over 1 character) must match; per term title +12 if it starts with it, else +8 if it contains
  it; keyword +5; question variant +4; summary +2; sorted by score, then
  article `order`. No body or direct-answer scoring.
- Falls under the go-live security review (public read-only endpoints).

**Live data feed and refresh ping (4 Nov 2026, ticket `tvqrtjTYu1icx9fHrydq`).**
A publish, approval, edit or retire reaches personalisationhub.com/support-centre/
in about two minutes, without waiting for the hourly export and WordPress's
hourly sync (up to two hours before):

- `GET /help-api/data/index.json`, `/data/releases.json` and
  `/data/articles/<id>.json` serve the published content in `faq/data`'s own
  shape and file layout. The field allow-list is the export script's, shared
  by code (`functions/faq-feed.js`: `articleRecord`, `categoryRecord`,
  `releaseRecord`, `serializeIndex`; `scripts/faq-export.js` and
  `faq-index-lib.js` use the same functions), so the WordPress sync reads it
  unchanged. Published articles only: never a draft, retired article,
  `pendingRevision`, `retireProposal` or any editor-only field. `Cache-Control:
  public, max-age=60` and an `ETag` (`If-None-Match` gives 304); the help API's
  per-address rate limit applies. Its `generatedAt` is the newest article
  `updatedAt` so the ETag only changes when content does.
- Firestore triggers on `faqArticles` and `faqCategories`
  (`pingSupportCentreOnArticleChange`, `pingSupportCentreOnCategoryChange`)
  fire only when the public projection changes (status, body, title, order,
  category, release range, the SEO/agent fields; a draft or `pendingRevision`
  edit does not). They call `POST https://personalisationhub.com/wp-json/ph-help/v1/refresh`
  with no body: 4 s timeout, failures logged and never retried. Debounced across
  instances through `settings/faqRefreshPing`: edits within 5 s share one call,
  and calls are at least 60 s apart (an edit inside the gap fires when it ends).
  The endpoint itself is added on the WordPress side (PH Website ticket
  "Support Centre syncs from the live help feed on refresh").
- The hourly export to GitHub is unchanged: it stays the versioned record and
  the fallback source. **Functions changes go live on the next
  `deploy-backlog-tracker.yml` run on `main`.**

**Tests.** `test/help-search.test.js`, `test/faq-feed.test.js` (allow-list,
published-only, ETag, retire, change detection, debounce, timeout).

### FAQ revision review (Deploy → propose → approve → go live)

**SEO & agent fields (3 Nov 2026, ticket `rri7DngI2ccd7q4uYdk6`).** Help
articles move to native WordPress pages but stay managed here, so each
`faqArticles` doc carries the five fields the WordPress Support Centre needs
for SEO and agent output: `seoTitle` (≤ 60 chars), `metaDescription` (≤ 155),
`directAnswer` (one or two plain-text sentences, ≤ 300, shown at the top of
the help-centre article), `questionVariants` (≤ 20 ways users ask it) and
`articleType` (`guide` → HowTo, `faq` → FAQPage, `reference` → TechArticle).
The URL slug is the existing `slug`. SEO title, meta description and slug
default to the title/summary/auto-slug when empty (the publish step applies
the default; nothing is stored). Empty fields are not written. The editor's
**SEO & agents** group shows live character counts (red at the limit) and
"SEO fields: N of 5 complete". The fields travel in `pendingRevision` like
the rest, appear in the review diff, are copied to the live article on
promotion (a key present on the proposal wins, `null` clears it, an absent key
leaves the live value alone), are carried by `faq-export.js` into
`faq/data/articles/<id>.json` (only when set) and read back by `faq-sync.js`.
MCP `create_faq_article` / `update_faq_article` accept them (update still only
parks a pending revision) and `get_faq_article` reports `missingSeoFields`.
The release Help Centre audit flags articles missing them.

**A description is never cut mid-word** (13 Nov 2026). When an article has no
`metaDescription` and its summary is longer than 155 characters, the export
and the live feed add a derived `seoDescription`: the summary cut at the last
word boundary that fits, ending "…" (`descriptionFromSummary` in
`functions/faq-feed.js`). The Support Centre reads `seoDescription` before
`metaDescription`, so it never falls back to its own 155-character cut. It is
derived on every export, never stored in Firestore and never read back by
`faq-sync.js`; an editor's `metaDescription` suppresses it.
`test/faq-copy.test.js` checks every published article's description, and
that the offer's retired name (use "brand"), client names and US spellings stay out of
published copy.

**Why.** A ticket merging to `main` changes what the product does; the
public help centre describes what the product does. The old
`faqAutoFlagOnLive` toggle only ever said "something in this project
changed, look at every article" — the reviewer then had to work out what,
and nothing helped them write the fix. Now the Deploy flow itself does the
reading and the writing, and the human only judges.

**Who writes the proposal.** The "Notify Claude — Deploy" Routine, in the
Deploy flow's step 3b (`ROUTINE_INSTRUCTIONS.md` → "FAQ impact review").
For each item's confirmed PR it reads the real diff (`git diff
main...<branch>`, plain git — works without `api.github.com`), reads the
in-scope articles, and only where it can point at diff lines that make the
current text wrong writes `pendingRevision` (the complete proposed title/
summary/body, a `reason`, the `sourceItemIds`) and `needsReview: true`.
The live fields are never touched by the Routine. It also appends a note to
each ticket naming the articles it proposed for, so the person who clicked
Deploy knows there's something waiting.

**Scope is the product/program, not the whole help centre.** Candidate
articles are those whose `programId` equals the project's `programId`,
plus any whose `projectId` is the project itself. A project without a
`programId` scopes to its `projectId`-linked articles only (the Routine
says so in its note — fix it on the project's Docs page, don't widen the
rule). Articles of other products/programs are never touched even when the
diff clearly affects them; the Routine names them in its report for a
human to handle. The deploy fire `text` carries a `Product/Program:` line
as a hint; Firestore is the authority.

**A program with zero scoped articles is a configuration gap, not "nothing
to review".** Every `faqArticles` doc predating this requirement could sit
with no `programId` at all, in which case the query above returns nothing
for every project under that program on every deploy, forever, with no
visible symptom — exactly what happened to "PH Agent Console" (backlog
item `GiceSVMWdEiETinAVLVM`). The article editor (and `create_faq_article`
over MCP) now requires a `programId` on every new/edited-and-saved article
so this can't recur (see `faq/README.md` → "Article scoping"), and the
Deploy flow's step 3b report distinguishes "0 articles changed by this
train" from "0 articles scoped to this program at all" — see
`ROUTINE_INSTRUCTIONS.md` → "FAQ impact review (Deploy flow, step 3b)" for
the exact check.

**Review UI** (FAQ Management → row badge **Proposed update** → ⋮ →
**Review proposed update**, `#faq-revision-review-page`): the reason, the
source ticket(s) with their live pipeline status, and two views — *Changes*
(paragraph-level diff of the rendered text, word-level highlighting inside
a reworded paragraph, unchanged runs collapsed) and *Before / After*
(both versions rendered through the same `renderFaqBodyMd()` as the public
site). Actions:

- **Approve** → `pendingRevision.reviewStatus: "approved"` (+
  `approvedAt`/`approvedBy`). The badge becomes **Approved · awaiting
  merge**; the page says exactly which tickets it is waiting on. If every
  ticket is already live it publishes immediately.
- **Reject** → deletes `pendingRevision`, clears `needsReview`. For a
  proposal that created a new draft article (`isNew`), rejecting deletes
  the draft. On an approved proposal the same button reads **Withdraw
  approval**.
- **Edit proposal** → opens the normal article editor loaded with the
  *proposed* text; **Save proposal** writes back to `pendingRevision`
  (never the live fields) and resets `reviewStatus` to `awaiting-review`,
  because what was approved is no longer what would go live.

**Go-live = approved AND every source ticket `published-live`** (or
`archived`, which only follows live), whichever comes last;
`promoteFaqRevisionIfReady` copies the proposal into the live fields,
stores what it replaced as `previousRevision`, clears `pendingRevision`
and `needsReview`, stamps `lastPromotedAt`, and publishes a proposal-
created draft. The hourly `faq-content.yml` export then carries it into
`faq/data/` for the static site (and the article page's own Firestore
freshness check shows it sooner). A source ticket that no longer exists
doesn't block promotion. **Revert last auto-update** (⋮ on a row with a
`previousRevision`) swaps the previous text back and keeps the replaced
text as the new `previousRevision`, so it can be undone again.

**Rules.** `firestore.rules` → `isValidPendingRevision` /
`isValidPreviousRevision` validate the shape (required `title`, `bodyMd`,
`reviewStatus` in the two allowed values, size caps) for writes from the
console, the Routine's board-automation user, and the MCP write tools
below; Cloud Functions bypass rules. `sourceItemIds`, when present, must be
non-empty (≤ 50 entries) — but the field itself is optional: the Deploy
flow's own proposals always set it (it's what promotion keys go-live on),
while an MCP-originated proposal (`update_faq_article`, below) omits it
entirely, since no backlog ticket triggered it. `faq-sync.js` merges and
never touches these fields; `faq-export.js` exports only the live fields,
so a proposal never leaks onto the public site. Parking or rejecting a proposal bumps
`updatedAt` but is not a live edit: `faq-sync.js` treats an article as
edited in the console only when its live fields no longer hash to the
`contentHash` its last sync stored (`scripts/faq-sync-lib.js` →
`editedSinceSync`), so a repo fix still reaches an article with a pending
revision (13 Nov 2026).

**Also written by a person's own agent, via MCP.** Two write tools on
`functions/mcp-server.js` (see "Functional requirements — team access & the
MCP server" above) reuse this exact mechanism rather than a second one:

- `create_faq_article` writes a brand-new `faqArticles` doc directly with
  `status: "draft"` — no `pendingRevision` involved, since nothing is live
  yet to protect. `categoryId` must name an existing `faqCategories` doc;
  `slug` is derived from the title (or given explicitly) and de-duplicated
  with a `-2`, `-3`, … suffix rather than rejected; `docType` must be one of
  the four Diátaxis types (`docs/CONTRIBUTING-docs.md` §2), defaulting to
  `"faq"`. `programId` must resolve to one — either passed directly, or
  derived from `projectId`'s own `programId` when `programId` is omitted —
  refused otherwise, so an article can never be created invisible to every
  project's FAQ impact review (see "FAQ / Help Center" → article scoping,
  and `faq/README.md`). A person still reviews and publishes it from FAQ
  Management like any other draft — this tool never writes
  `status: "published"`.
- `update_faq_article` proposes a change to an existing article the same
  way the Deploy flow's Routine does (step 3b), except: `proposedBy` carries
  the caller's real signed-in email rather than the literal `"claude"`, with
  an additional `proposedVia: "mcp"` so the review page's "Proposed by" line
  and any audit query can tell the two paths apart; `reason` is a required
  parameter, stored verbatim; `sourceItemIds` is omitted, so approving it
  promotes on the very next hourly export rather than waiting on a ticket's
  train. Only `title`/`summary`/`bodyMd`/`keywords`/`docType` are revisable
  this way — `categoryId`, `slug`, `projectId` and `programId` are live-only
  fields `pendingRevision` was never built to carry (`promoteFaqRevisionIfReady`
  doesn't apply them), so changing those stays a direct console edit. Calling
  it again while a proposal is `awaiting-review` builds on that proposal's
  text, not the stale live text — the same rule `ROUTINE_INSTRUCTIONS.md`
  gives the Routine for a second deploy touching the same article. It
  refuses outright if the existing proposal is already `reviewStatus:
  "approved"`, the same "don't overwrite a human's sign-off" rule the
  Routine follows.
- `list_pending_faq_revisions` / `get_faq_revision` read the same
  `pendingRevision` map regardless of which path wrote it, for a caller to
  see what's awaiting review and diff old vs. new.
- `comment_on_faq_revision` appends `{author, text, at}` to a new
  `reviewComments` array on the article — the console's review page doesn't
  render this thread yet, so treat it as an audit trail for now, not a live
  conversation.

No MCP tool can write `reviewStatus: "approved"`, `status: "published"`,
touch `previousRevision`, or delete an article — approving and publishing
stay human, in the console, exactly as for every other MCP write tool (see
"Functional requirements — team access & the MCP server" for the
`board.write` gate and attribution guarantees that apply here too).

### The Notify Claude Routine — a thin bootstrap, not the source of truth

The Routine itself (name "Backlog tracker investigation", owned at
claude.ai/code/routines, id `trig_01R9N68hfzqQCF8RUssQYE8b` as of this
writing) is a **fire-on-demand, non-persistent** Routine — each fire spins
up a completely fresh Claude Code session with no memory of any previous
run.

Its own stored prompt is deliberately kept **short and nearly static**: it
just identifies the board, then tells the fired session to fetch
`backlog-tracker/ROUTINE_INSTRUCTIONS.md` from this repo's `main` branch
(a plain, unauthenticated `GET` against
`raw.githubusercontent.com/offline2online/rob_ph_demos/main/backlog-tracker/ROUTINE_INSTRUCTIONS.md`)
and follow that file exactly. **That file, not the Routine's own prompt,
is the real, versioned, PR-reviewable specification of what a fired
session does** — investigate, package a fix as `patchFiles`/`patchReady`
(or `projects/{id}.trainReady` for the Deploy flow), report a summary,
never push or call a GitHub write API itself. See that file for the full
current behavior rather than duplicating it here — this section only
documents *why the split exists*.

This split exists because a Routine's own prompt can only be edited by
someone with UI/API access at claude.ai/code/routines — an agent session
without that access (which is the normal case; a session working in this
repo cannot call `update_trigger` on a routine it didn't itself create via
that same tool) is stuck asking a human to paste in every change by hand.
Moving the actual behavior into a repo file means changing it is an
ordinary PR, reviewed and merged like anything else, and it takes effect
on the very next fire — no manual step, no waiting on someone to visit
claude.ai. **To change how the Routine behaves, edit
`ROUTINE_INSTRUCTIONS.md` and open a PR — do not try to edit the Routine's
own stored prompt** for anything other than the bootstrap mechanism itself
(e.g. if that file's URL or path ever moves).

### Per-project Routine instructions (`routinePromptMd`)

The Routine's own prompt above is shared across every project on the
board — it can't hold project-specific detail (a different branch
convention, which slice of the repo a project owns) without becoming
unreadable. Each project's Docs page has its own **Routine instructions**
field (`projects/{id}.routinePromptMd`, plain markdown, optional and blank
by default) for exactly that. Both **Notify Claude** and **Notify Claude —
Deploy** prepend this same field's content — if non-blank — to their fire
request's `text`, wrapped in
`=== PROJECT-SPECIFIC INSTRUCTIONS FOR "<project>" ===` /
`=== END PROJECT-SPECIFIC INSTRUCTIONS ===` markers, ahead of the usual
"Project X has N items in Backlog" list (or, for a deploy fire, ahead of
the DEPLOY REQUEST block — see `notifyOnProjectReadyToDeploy` above). The
Routine's own prompt is instructed to treat a present block as
authoritative additional context that supplements — never replaces — the
required steps above (still PATCH the same fields, still open a PR the
same way). Most projects leave this blank; that's the expected default,
not a gap.

## Functional requirements — team access & the MCP server

Full walkthrough in [`MCP.md`](./MCP.md); this is the requirement, not the
manual.

**The requirement.** A person added to the platform must be able to connect
their own AI agent to the PH Agent Console and use it as a tool, signing in
with the credentials they already have — Google, or an email and password —
with no key to mint, paste, share or rotate, and with everything their agent
does attributed to them.

**Reading ticket history.** `list_backlog_items` (scope `board.read`, so
viewers too) must let an agent read every ticket and find why one failed:

- *Paging.* Input `cursor` (opaque string); every response returns
  `nextCursor` (string, or `null` on the last page). Order is fixed: updatedAt
  newest first, then ticket id A–Z. `limit` defaults to 25, maximum 100.
  `matched` is the total across pages; a full walk returns each match once
  (a ticket updated mid-walk can move). An undecodable cursor is a tool error,
  "cursor is not valid — start again without one".
- *Timestamps.* `updatedAt` may be a Timestamp, Date or ISO-8601 string
  (`run-backlog-automation.js` writes strings); the sort key falls back to
  `createdAt`, then 0, and summaries show the real value.
- *Archived.* `includeArchived` defaults to true with `search`, false
  without; `status` decides when given. Archived tickets left out that matched
  every other filter are counted in `archivedHidden`.
- *Comments.* `searchIn` is an array of `title`, `desc`, `notes` (default
  `["title","desc"]`); an unknown value is a tool error. With `search`, each
  item carries `matchedIn` and a `snippet` of up to 200 characters. All new
  inputs are validated in code.
- *Read limit.* If the read reaches `MAX_READ_DOCS` (1,500) the response has
  `truncated: true`; pass `projectId`.
- `get_backlog_item` returns `lastFailureReason` `{category, summary, text, action, at}`
  (ISO `at`; `summary` is the one-line why, null for a person's rejection), or `null`.

No new tool and no write path. Tests: `test/mcp-server.test.js`.

**Membership.** `User Management → Users` (admin-only) writes
`consoleUsers` docs; that one row grants browser access and agent access
together. Roles as in "Data model" above. A member with no Google account is
provisioned with `POST /mcp/admin/provision` (creates their Firebase Auth
login) and then Firebase's own password-reset email, which is also what
verifies their address — no password is ever typed or sent on their behalf.

**Transport and auth.** `functions/mcp-server.js`, served at
`<console origin>/mcp` via hosting rewrites, is:

- an **MCP server** speaking JSON-RPC over Streamable HTTP, stateless (no
  session, no server-initiated SSE — `GET /mcp` answers `405`);
- its own **OAuth 2.1 authorization server**: RFC 9728 + RFC 8414 discovery,
  RFC 7591 dynamic client registration, mandatory PKCE `S256`, RFC 7009
  revocation, 1-hour access tokens, 60-day rotating refresh tokens.

Required properties, each covered by `test/mcp-server.test.js`:

1. **The agent never holds a Firebase credential.** A Firebase ID token is
   accepted at exactly one endpoint, from the browser, and traded
   immediately for this server's own token.
2. **Only hashes are stored.** Codes and tokens exist in Firestore as
   SHA-256 doc ids; the raw secret only ever exists in the response that
   issued it.
3. **Codes are single-use**, enforced in a transaction.
4. **Refresh tokens rotate** — using one revokes it.
5. **Membership is re-checked on every call.** Removing someone, disabling
   them, switching their agent off or demoting them to viewer takes effect
   on the next request, not at token expiry.
6. **`board.write` is never issued to a viewer**, whatever the client asks
   for — filtered at issue time and again at use time.
7. **An unauthenticated call answers `401` with a `WWW-Authenticate` header
   pointing at the resource metadata**, which is how a client discovers
   where to sign in.

**Tool surface — and its hard limit.** Read: `whoami`, `list_projects`,
`list_backlog_items`, `get_backlog_item`, `get_ready_for_testing_board`,
`get_approved_for_deployment_board`, `get_project_docs`,
`list_project_documents`, `get_project_document` (documents listed without text,
searched, and read a page or section at a time — see MCP.md),
`list_doc_revisions`, `get_doc_revision`, `search_faq`, `get_faq_article`,
`list_pending_faq_revisions`, `get_faq_revision`, `list_skills`, `get_skill`,
`list_skill_misses`, `get_routine_setup_instructions`, `list_concepts`,
`get_concept`.
Write (editor/admin only) — tickets: `create_backlog_item` (always into
`backlog`), `update_backlog_item` (title, desc, type, category, model only),
`archive_backlog_items` / `delete_backlog_items` (Backlog tickets only, by id,
single or batch; refused for any ticket past Backlog; logged to mcpAuditLog),
`add_item_comment`; documentation: `set_project_requirements`,
`set_project_readme`, `set_project_artifact`, `create_project_document`,
`update_project_document`, `delete_project_document`, `create_interface`,
`update_interface`, `delete_interface`; Concept Incubator:
`add_concept_comment`, `set_concept_description`, `set_concept_readme`, `set_concept_requirements`
(the last two refused once a concept's `status` is `"promoted"` — see
"Concept Incubator page" and `concepts/{conceptId}` above); help centre:
`create_faq_article`
(always `status: "draft"`), `update_faq_article` (always a `pendingRevision`,
never the live fields), `comment_on_faq_revision` — see "FAQ revision
review" under "Functional requirements — FAQ / Help Center" below for what
these two collections' write tools do and don't do; skills library:
`upload_skill`, `update_skill`, `delete_skill`, `report_skill_miss`,
`mark_skill_reviewed`; your own routine binding: `set_my_routine_binding`;
release (admin only, deliberate exceptions — see below): `send_to_build`, `approve_for_deployment`, `fail_testing`, `approve_deploy_to_main`.
A concept has no `list_backlog_items`-shaped tool of its own — it has no
`backlogItems` until it's promoted to a real project (see "Concept
Incubator page" above), which is also why there is no `create_concept` or
`promote_concept_to_project` tool: this server has no `create_project`
tool either, so a project's or concept's own creation/promotion stays a
board/human action.

**The two `board.read` "board" tools above are also composable — they are
MCP Apps** (SEP-1865, extension `io.modelcontextprotocol/ui`, spec
2026-01-26). `get_ready_for_testing_board` and
`get_approved_for_deployment_board` each carry `_meta.ui.resourceUri`
(plus the deprecated flat `_meta["ui/resourceUri"]`) naming a
`ui://backlog-tracker/ready-for-testing` /
`ui://backlog-tracker/approved-for-deployment` resource the server lists
and serves through `resources/list` / `resources/read` — declared under
`capabilities.resources` in `initialize` — with `mimeType:
"text/html;profile=mcp-app"` and its sandbox settings under `_meta.ui`
(`prefersBorder: true`; `csp.resourceDomains` = Google Fonts for Roboto
only; no `connectDomains`, the view fetches nothing itself). Each tool's
result carries the column as `structuredContent` (`kind`, `projectId`,
`projectLabel`, `count`, `items[]` with `id`, `project`, `title`, `type`,
`category`, `testSummary`, `desc`, `previewUrl`, `previewState`/`previewSha`/
`previewUpdatedAt` (the test link's rebuild state), `trainTest` (the card's own
test run while it describes the commit now on the train: `state` and
`workflows[]` of `name`/`conclusion`/`runUrl`), `testVersion`, `board`,
and for Approved for Deployment `onTrain`/`deployCommit`/`prNumber`/
`deployBranch` plus top-level `readyToDeploy`/`readyLine`) and the same
JSON as a text block for the model. A host that supports MCP Apps
(claude.ai, Claude Desktop) fetches the view, renders it in a sandboxed
iframe inline in the conversation, and delivers the result to it over the
SEP-1865 postMessage protocol (`ui/initialize` →
`ui/notifications/initialized`, then `ui/notifications/tool-result`); the
view (`functions/mcp-app-views.js`, one self-contained HTML document,
inline CSS/JS, PH tokens layered over the host's style variables for
light/dark) renders the cards (title, testSummary/desc, type/area, test
link, testVersion, a link back to the ticket, train/PR context and the
deploy-readiness line for Approved for Deployment), reports its size
(`ui/notifications/size-changed`), opens links through the host
(`ui/open-link`), answers `ui/resource-teardown`, and offers Refresh
(re-running the same read-only tool via `tools/call` through the host)
only where the host advertises `serverTools`. Read-only in the fullest
sense: no `<form>`, no write, every user-authored string reaches the DOM
via `textContent`, and a URL becomes an `href` only when it parses as
`https://` (the server already nulls anything else in
`structuredContent`). Claude Code does not render MCP Apps yet — its CLI
validates and forwards the binding and advertises the extension only
behind its own host switch (anthropics/claude-code#95149) — so there the
tools answer as text. The first cut (PR #208, 24 Sep 2026) returned an
embedded `text/html` content block instead of any of this, which no host
renders; `test/mcp-server.test.js` covers the wire contract and
`test/mcp-app-view.test.mjs` drives the view in Chromium under a scripted
host. `get_approved_for_deployment_board` additionally reports, per project,
whether that project's whole train is ready for `approve_deploy_to_main`
below (only meaningful with a `projectId` filter — it is a per-project
question).

**The Ready for Testing hand-off — the column is presented without being
asked for (30 Sep 2026).** The view alone is not what the composable UI
tickets asked for; they asked for it to appear when a build lands. So:
`run-backlog-automation.js` collects every card it moves into Ready for
Testing in a run (its own commit, or carried by a sibling's) and, once per
project at the end of its apply-patch loop, parks their ids in
`readyForTestingPendingItemIds` (with `readyForTestingPendingSince` = now).
**The hand-off waits for the build to be checked (19 Oct 2026):** a step in
`main()` that runs every run, after the sweeps that write `trainTest`
(card-test-status) and `previewState` (test-link-rebuild-state), applies the
pure `nextHandOff`: it drops parked cards no longer in Ready for Testing
(clearing the hold unstamped if none remain), keeps the `batchStillBuilding`
hold, and otherwise holds while any card is waiting (`handOffWaitingOn`:
tests missing, for an older commit, running or starting, or `not-run` less
than 10 minutes old; a failed run whose automatic re-run is pending, i.e. a
`:rerun` key on any commit attributed to the card and the recorded run still
attempt 1; link `rebuilding`), recording `readyForTestingWaitingOn`
and asking for a follow-up run. When nothing is waiting, or the parked ids
are 40 minutes old, it stamps
`projects/{id}.readyForTestingNotifyRequestedAt` (a real timestamp) with
`readyForTestingNotifyItemIds` and `readyForTestingNotifyRequestedByEmail`
(the member whose Notify Claude click started the build).
`notifyOnItemsReadyForTesting` (`functions/index.js`) fires once on a new
stamp: it re-reads the named cards, keeps only those still in Ready for
Testing on that project, resolves the Routine credentials exactly like the
other notify functions (`resolveRoutineCredentials` — the requester's own
binding first, the shared secrets otherwise), fires the Routine with a
data-only `=== READY FOR TESTING for "<project>" (projectId: <id>) ===`
text (per ticket: id, type, title, test link, test version, ticket link,
summary, and two state lines: `Tests: passed | failed — <run url> | not run |
still running | none needed for these files` and `Test link: ready (build of
<sha7>) | still rebuilding — don't test it yet`; Slack gets the same short
state), records `projects/{id}.readyForTestingRoutine` (same shape as
`notifyRoutine`), and posts the same to `NOTIFY_WEBHOOK_URL` when set. The
fired session follows `ROUTINE_INSTRUCTIONS.md` → "The 'Ready for Testing'
flow": it calls `get_ready_for_testing_board` (when the Routine has the PH
Agent Console connector attached) so a host that renders MCP Apps shows the
cards inline, or presents the column as text from Firestore otherwise;
it writes nothing to any ticket. The Deploy flow does the same with
`get_approved_for_deployment_board` as its first action. One fire per run
per project, never one per ticket. Tests:
`test/ready-for-testing-trigger.test.js`.

**The skills library is organisation-wide, not per-project** — `list_skills`
(light summaries) and `get_skill` (full file contents, by id or slug) need
only `board.read`, so a viewer can read every skill the same as an editor
can; `upload_skill` (new skill, slug must be unique), `update_skill`
(rename/re-version/replace the whole file set — never a merge) and
`delete_skill` need `board.write`. `update_skill`/`delete_skill` record the
file set they replace to `docRevisions` first (`target: "skill"` /
`"skill.deleted"`), same recoverability pattern as the documentation tools
above, and `list_doc_revisions`/`get_doc_revision` take an optional
`skillId` filter alongside `projectId`/`docId`/`interfaceId` to find one.
Per-file content is capped at `SKILL_FILE_MAX` (100,000 characters), up to
20 files per skill — generous enough for the seeded `ph-designer` skill
(6 files, ~75 KB total, largest file ~17 KB) with headroom to spare.
`upload_skill`/`update_skill` also take an optional `owningTeam` (one of
`SKILL_OWNING_TEAMS`) — see "Data model" → `skills/{skillId}` above.
`report_skill_miss`/`list_skill_misses` and `mark_skill_reviewed` are the
skill feedback loop and periodic review nudge tools (Gcc30u2bQEJwEdUTN6X8 /
eKslgrwgRJtoxyx0oNSV) — see "Skill feedback loop" / "Periodic skill-review
nudge" above for what they do; `list_skills`/`get_skill` additionally
return `missCount` and `reviewDue`/`daysSinceReview`/`deploysSinceReview`.

**Per-member routine binding (`get_routine_setup_instructions`,
`set_my_routine_binding`, VNE6dxMu3h6jO3g6FNNB)** — the one MCP tool pair
that changes board behaviour without itself being a board action: it lets
a member register their OWN Claude Code Routine (fire URL + API-trigger
token) so board clicks THEY make fire a session under their own account
instead of the shared `CLAUDE_ROUTINE_FIRE_URL`/`CLAUDE_ROUTINE_TOKEN`
secrets — see "Functional requirements — notification & automation" above
for `resolveRoutineCredentials`, the function all three notify Cloud
Functions share to resolve this. `get_routine_setup_instructions` is
`board.read` (anyone may read how to set this up); `set_my_routine_binding`
is `board.write` and, deliberately, **write-only** — it stores
`fireUrl`/`token` onto the CALLER'S OWN `consoleUsers/{email}` row (never
anyone else's — there is no `email` argument) and no tool, including
`whoami`, ever returns them; `whoami.hasRoutineBinding` reports only
whether one is set. Passing both `fireUrl`/`token` as `""` clears the
binding. This does not violate "no tool may... fire the Notify Claude
Routine directly" (see that rule, and its one exception
`approve_deploy_to_main`, further below) — it changes which credentials a
LATER board click will use, it never fires a Routine itself.

**Guided Routine setup on connect (BXkUvoayo98j744RUCy8, 13 Nov 2026).**
When a member with `board.write` connects and has no binding (the same
check as `whoami.hasRoutineBinding`, including the legacy `consoleUsers`
fields), `initialize` puts `ROUTINE_SETUP_INSTRUCTIONS` (one sentence, so the
whole text still fits the 3,700 characters a host delivers whole) in front of
the server instructions. It tells the agent to offer setup at the start of
the conversation, before other work, and to follow
`get_routine_setup_instructions`'s `agentGuidance`: present the steps one at a
time, waiting for the person after each: (1) open `https://claude.ai/code/routines`
signed in with their own Claude account and create a Routine; (2) paste the
bootstrap prompt, shown as a copyable code block; (3) add an API trigger and
copy the fire URL (ends in `/fire`) and the token (shown once); (4) paste
both back, then the agent calls `set_my_routine_binding` once and `whoami` to
confirm `hasRoutineBinding` is true. The agent never asks for the token again
or repeats it. If the person declines, the agent reminds them once in that
conversation that their board clicks keep using the shared Routine until it
is set up. `get_routine_setup_instructions` also returns `routinesUrl`, a
`walkthrough` array (`{step, say, link?, copy?}`) and the `agentGuidance`
rules above. The standing instructions were tightened by about 140
characters to make room; no tool was dropped from them. A bound member
or a viewer gets the standard instructions unchanged. A failed binding read
at `initialize` is logged and the block is left out; connecting never fails
because of it.

**Phase-bound skills (`settings/phaseSkillBindings`, l5mjAANU0dfveGhxmDjm)**
let a shared skill be applied automatically as part of an existing pipeline
phase, without adding board columns/stages of its own: a single doc,
`{ build: string[], deploy: string[] }` of `skills.slug` values, that
`notifyOnProjectReadyForReview` (build phase) and
`notifyOnProjectReadyToDeploy` (deploy phase) each read and prepend as a
pointer block to the Routine fire `text` — the same "hand the Routine
extra context" mechanism `routinePromptMd` already uses, just
organisation-wide rather than per-project, since "the engineering skills"
and "the cybersecurity/scalability review skills" are fixed sets, not
something that varies project to project. See
`backlog-tracker/ROUTINE_INSTRUCTIONS.md` → "Check for phase-bound skills
too" for exactly what a fired session does with it — in short, it fetches
each named skill fresh via its existing board access rather than the
Cloud Function embedding full skill content in the fire text (the same
"don't duplicate 'how' text" reasoning the Deploy flow's own request text
already follows). No console UI manages this doc yet (edited directly in
Firestore); `BOARD_API_COLLECTIONS` in `functions/index.js` includes
`skills`/`settings` so the fallback `boardApi` proxy path can read them
too.

**Documentation is full read/write by requirement.** A project's docs are
meant to be kept current by whoever is doing the work, agents included, with
no credential beyond the OAuth session. Consequences that are requirements,
not implementation detail:

1. **A write replaces the whole document.** No append/patch tool exists —
   partial-update semantics over markdown invite an agent to mangle a
   document it only half read.
2. **Nothing a write replaces is lost.** The previous content goes to
   `docRevisions` first (append-only, written only by the server, readable
   by any member); a delete records the whole document the same way. This is
   what makes the two `delete_` tools acceptable, and they are the only
   tools carrying `destructiveHint`.
3. **Ceilings differ by where the content lives.** Requirements/README are
   fields on `projects/{id}` and share its 1 MiB document limit → 800k
   characters. `projectDocs`/`interfaces` content is capped at 20k, matching
   `firestore.rules`, so an agent can never author a document a person is
   then unable to save an edit to from the Docs page.

**No tool may merge a train, approve a ticket out of Ready for Testing,
change a card's status, write a train field, fire the Notify Claude Routine
directly, publish or approve an FAQ article, or trigger a campaign — with
one deliberate, narrowly-scoped exception each for firing and for changing
what fires.** `set_my_routine_binding` (VNE6dxMu3h6jO3g6FNNB, see above)
is the second: it changes which credentials a LATER click will use, but
never fires anything itself. **`send_to_build` and `approve_for_deployment`
(20 Oct 2026, ticket `Ysh0yuU9z643E0uisr51`)** are the other two, admin-only
and each exactly the board's own click for tickets named by id: `send_to_build`
writes `notifyRequestedAt` / `notifyItemIds` (Ready for Dev; refuses a locked
train and blocked, packaged, already-building or non-Backlog tickets);
`approve_for_deployment` moves Ready for Testing tickets to Approved for
Deployment with the approver stamped and `trainLocked` set (refuses tickets
not in Ready for Testing or marked for revert, and tickets whose train tests
are not green unless `acknowledgeTests` is true). **`fail_testing`** (25 Oct 2026)
is the board's Failed testing → send back for named Ready for Testing tickets,
admin only: status `backlog`, `revertRequested`, `lastFailureReason`, a note
and `rebuildAfterRevert` (the rebuild queues itself after the revert); it
refuses any ticket not in Ready for Testing or already reverting, writing
nothing, and logs the reason to `mcpAuditLog`. These refuse the whole call
on any failing ticket and log to `mcpAuditLog`; no MCP tool moves a card any
other way. `approve_deploy_to_main`
(`board.write` **and the `admin` role**, since 27 Sep 2026) fires the exact same trigger the
console's own **Deploy to Main** button writes
(`projects/{id}.deployNotifyRequestedAt`); it never merges anything
itself — the existing Routine still verifies the train and the existing
pipeline still does the real merge, exactly as if a person had clicked the
button. It enforces the same condition that shows that button at all
(every ticket on the project's deployment train already Approved for
Deployment, and Ready for Testing empty for that project — mirrored
server-side by `deployGuardForProject`, so calling the tool directly can
never fire a deploy the console's own button would currently be hiding)
and refuses otherwise, naming what's blocking it. Every call is logged to
`mcpAuditLog` under the caller's email, same as any other write. Beyond
this one trigger, campaign triggering stays on the triggered Routine and
the release pipeline keeps its human gates — an agent files, reads,
enriches, documents and comments; it does not ship. `create_faq_article`
only ever writes `status: "draft"`; `update_faq_article` only ever writes
`pendingRevision`/`needsReview`, never `reviewStatus: "approved"` and never
the live article fields.

This is a requirement about the surface, not a convention.
`update_backlog_item`'s schema has no `status`. The documentation tools do
write to `projects` — `requirementsMd`, `readmeMd` and `artifactUrl` live
there — so the guarantee is enforced rather than incidental: a single
`updateProjectFields` guard is the only path to a project write through the
documentation tools, and it throws on any field outside
`PROJECT_WRITABLE_FIELDS` (documentation fields only; no `deployBranch`,
`trainReady`, `trainStatus`, `trainPrNumber`, `trainNote`, `trainLocked`,
`needsHumanMerge`, `notifyRequestedAt` or `deployNotifyRequestedAt` —
`approve_deploy_to_main` writes that last one, but through its own
dedicated code path, never through `updateProjectFields`, so the allowlist
itself stays exactly as narrow as before). The test suite asserts the
allowlist's contents, that the guard throws when handed a train field,
that no documentation tool's schema can even express one, that a full pass
of the documentation tools leaves a project's `deployBranch` untouched,
and that `approve_deploy_to_main`, `send_to_build` and `approve_for_deployment`
are the only `board.write` tools whose names may contain a
deploy/merge/approve/build/trigger verb, all three admin-only.

**Attribution and audit.** Every write records the person's email on the
document (`createdByEmail`, `updatedByEmail`, a comment's `author`) and
appends an `mcpAuditLog` row. The board's comment thread shows that email
rather than a generic "Comment".

**Self-service.** Every member sees `Settings → Connect your AI agent`: the
server URL, how to add it to a client, the list of agents they have
connected, and a per-client disconnect. An admin can additionally disconnect
anyone else's.

## Functional requirements — FAQ / Help Center

Two surfaces sharing this same Firestore project:

- **Public site** (repo-root `faq/`, published via GitHub Pages, separate
  from this app's Firebase Hosting): front page with search + category
  grid, a category page, an article page, and a full search-results page.
  Styling follows this repo's own best-effort Personalisation Hub brand
  tokens (teal `#169bc2`, Roboto, Material Symbols) — not verified
  pixel-for-pixel against the real personalisationhub.com WordPress theme,
  since that domain is blocked by this sandbox's network egress policy.
- **Embedding**: this site is iframed into personalisationhub.com's public
  WordPress/Elementor marketing site — a **different design system
  entirely** from the HQ Admin/Retail Admin platform app, which this
  project has no relationship to. Only the very top of that WordPress page
  (its own Elementor-managed header) is not this site's content; everything
  below, footer included, is this iframe's own. `isEmbedded()`
  (`faq/js/faq-data.js`, checks `window.self !== window.top`) suppresses
  only this site's own header bar when actually framed, while a direct/
  standalone visit keeps full branding.
- **Admin**: two nav-drawer destinations (global, not per-project — an
  article can link to any one project or none), replacing a single
  combined "FAQ Center" page:
  - **Settings** — category management (name, icon, description, display
    order). A category's icon is picked from a curated `<select>` of
    Material Symbols names (`FAQ_CATEGORY_ICONS` in `app.js`) with a live
    preview swatch, rather than typing a raw icon name from memory — a
    category's *current* icon is always included in its own dropdown even
    if it falls outside the curated list, so nothing silently changes on
    save just because it predates this picker.
  - **FAQ Management** — articles only (title, slug, category, optional
    linked project, summary, a rich-text body — see "Rich-text article
    body" below, search keywords, draft/published status, `needsReview`).
- **Rich-text article body**: the article editor's body field is a real
  rich-text editor (Quill, loaded via CDN — headers, bold/italic/
  underline/strike, alignment, ordered/bullet lists, link, image, video,
  clear formatting), not a plain textarea. An "Edit" / "View live" toggle
  replaces the old always-visible side-by-side textarea + preview — "View
  live" renders through the exact same `renderFaqBodyMd()`/CSS the public
  site uses, since Quill's own editing chrome doesn't look like the real
  article page. **Images insert via a URL prompt, not a file picker** —
  Quill's default embeds a file as base64, which can push a single article
  well past Firestore's 1MiB document limit. **The image toolbar button
  also prompts for alt text** and sets it on the inserted `<img>` —
  `docs/CONTRIBUTING-docs.md` §6/§5.6 makes alt text mandatory on every
  informative image; capturing it at insertion time (rather than relying
  on an editor to remember to add it, or a later audit to catch its
  absence) is how that rule is actually enforced here.
  - **Loading an article into Quill is a rewrite, not an `innerHTML`.**
    Quill 1.3.7 only edits DOM it built itself, and both naive ways of
    handing it a saved article lost content in production on 2026-09-17
    (seven articles' Steps/Before-you-begin/Related lists collapsed to an
    empty paragraph, then saved back that way): `root.innerHTML = html`
    drops from Quill's model whatever it can't hold (whitespace text nodes
    inside an `<ol>`, a `<p>` inside an `<li>`) while leaving it on screen
    until the first keystroke wipes it; a bare `clipboard.convert()` is a
    paste parser that adds layout-dependent blank lines, splits
    `<li><p>` into extra items, and (via the table blot's `value()`)
    reduced every table cell to plain text. `faqSetEditorHtml` in `app.js`
    therefore (1) rewrites the sanitised HTML into the shape Quill can
    represent first (`faqHtmlForQuill`: whitespace between blocks and
    inside lists/tables removed, paragraphs inside a list item folded into
    the item, a nested list lifted out as indented items of the parent
    list's type), (2) loads it through `clipboard.convert()` +
    `setContents()` with Quill's `matchSpacing` matcher removed so model
    and DOM agree from the first moment, and (3) compares the characters
    that came out with the characters that went in and shows
    `#fa-load-notice` above the body if they differ — a lossy load is
    visible before Save, never silent. Table cells hold HTML fragments,
    not text, so links/bold/code inside tables round-trip. Two known
    simplifications remain, both text-preserving: a paragraph break
    inside a list item becomes a space, and a nested `<ul>` inside an
    `<ol>` item becomes lettered sub-items (`ql-indent-1`; the public
    site's `faq.css` numbers those correctly). `test/faq-editor-load.test.mjs`
    opens every article in `faq/data/articles/` in the real editor code
    against real quill@1.3.7 and fails on any lost word, list item, table,
    callout, code block or heading.
  - **Format migration is lazy, not a one-time script.** `bodyMd` (kept as
    the field name for compatibility) holds either real HTML (new) or
    legacy markdown-ish text (everything written before this editor
    existed) — told apart by a leading `<`. Opening a legacy article runs
    it through the old markdown-ish renderer once to load it into Quill as
    proper rich text; saving from there writes real HTML back, upgrading
    that one article in place. Nothing forces every existing article
    through this at once.
  - **Sanitized at render time, not trusted at write time.** `bodyMd` is
    real HTML now, and this app's `faqArticles` Firestore rules are wide
    open (see "Firestore rules" above) — a rewritten field can't assume it
    only ever came from this editor's toolbar. Both the admin's own "View
    live" preview and the public site's article page run any HTML-shaped
    body through DOMPurify (CDN) before it ever touches `innerHTML`; if
    DOMPurify fails to load, the fallback is to escape the whole thing
    (inert, visible-but-not-live) rather than inject it unsanitized.
    DOMPurify's default tag allowlist excludes `<iframe>` (needed for
    Quill's video embeds), added back via `ADD_TAGS` — but its `src` isn't
    restricted to a known-safe host by DOMPurify itself for tags it allows,
    so both `renderBodyMd` (`faq/js/faq-data.js`) and its admin-preview
    mirror `renderFaqBodyMd` (`app.js`) install a `uponSanitizeElement` hook
    (`installIframeAllowlist`/`ALLOWED_IFRAME_HOSTS`) that strips any
    `<iframe>` whose `src` host isn't `www.youtube.com`,
    `www.youtube-nocookie.com`, or `player.vimeo.com` — the only hosts
    Quill's own video format ever normalizes a pasted link to. This closed
    a real gap once the FAQ site went public (`faq/`, on GitHub Pages,
    world-readable) on top of `faqArticles`' already-open write rules: an
    iframe pasted straight into Firestore could otherwise point at any
    host. Moving `faqArticles` writes behind real auth (so this stops being
    reachable by an anonymous write at all) is a separate, larger change —
    see "Firestore rules" above — that needs a decision on the auth model
    (this pipeline's own automation currently authenticates via the open
    REST API, per README.md's "Notify Claude can't push") before anyone
    starts on it.
- **Why `projectId` on an article**: the categorization-by-project hook
  that the auto-review automation (above) actually uses — an article
  documents a specific project's feature, so that project's own shipped
  changes are what should make the article's accuracy suspect.
- **Seeding**: `scripts/seed-faq-data.js` (insert-only, safe to re-run
  against an *edit* — not against a *delete*, see below) — 9 categories,
  108 articles, a verbatim import of the real Personalisation Hub Help
  Center from a Freshdesk Solutions export. Not placeholder content.
  `deploy-backlog-tracker.yml`'s step runs only when a manual dispatch's
  `seed_faq` input is ticked (XFeVboxWduEPT2zGcj8y, 25 Sep 2026, corrected
  the same day) — `create()`-if-missing can't tell "never existed" from
  "deliberately deleted in the console," so running it on every deploy
  resurrected any article/category someone had just deleted the moment the
  next unrelated change shipped. The first fix gated it on
  `workflow_dispatch` alone, which is exactly how the pipeline runs this
  workflow after every train merge, so the seed kept running. Independently
  of the gate, a deleted id can no longer be recreated by anything: the
  console writes a tombstone (`faqDeletedArticles/{id}`,
  `faqDeletedCategories/{id}` — see the data model) before deleting, and
  both the seed and `faq-sync.js` skip tombstoned ids. A train that
  changes `faq/data/` also gets its repo → Firestore sync dispatched by
  `finishTrain` (a GITHUB_TOKEN merge fires no push event), so a content
  ticket's edit reaches the console before the next hourly export would
  otherwise overwrite it with Firestore's older copy.
- **Version display**: both `faq/` and `backlog-tracker/public/` render a
  small hand-maintained `APP_VERSION` in their footer (`js/version.js` in
  each, independent per site since they deploy separately) — bumped by
  hand on meaningful changes; no build step exists to derive it
  automatically.

## Project freeze ("Finalised")

A permanent freeze on a project, distinct from `trainLocked` (the temporary
lock while a release closes). Backlog-tracker projects only: the Staff Kanban
has no finalised state and staff tasks are unaffected.

- **Data:** `projects/{id}.finalised` is `{version, at, byEmail, artifactUrl,
  artifactUpdatedAt}` while frozen and `null` otherwise. `finalisedLog` is an
  append-only array of `{action: "finalise"|"unfreeze", version, at, byEmail,
  via: "board"|"mcp", reason?}`; an unfreeze always carries a `reason`. `version`
  counts the project's freezes (1, 2, …) and pins the artifact link and update
  time the project had at that moment. A fuller versioned artifact snapshot
  (the separate "Versioned artifact snapshot" ticket, not yet on the board)
  will hang off the same `finalised.version`.
- **While frozen:** the board hides Ready for Dev and refuses **+ New backlog
  item** with a message; `create_backlog_item` and `send_to_build` refuse with
  the same message; `firestore.rules` denies a browser `backlogItems` create
  for the project; `notifyOnProjectReadyForReview` ignores a build request.
  The board shows a **Finalised vN** badge and `list_projects` returns
  `finalised`.
- **Who:** admin only. The project's ⋮ menu has **Finalise project…** /
  **Unfreeze project…** (reason required), and MCP has `finalise_project` and
  `unfreeze_project`; both are logged to `mcpAuditLog` and `finalisedLog`.
  `firestore.rules` lets only an admin change `finalised` / `finalisedLog`.
- **First use:** Display Types & DSP Integration and Retail Media Insights &
  Analytics Dashboards, once their pre-freeze code reviews are complete.

## Non-GitHub deployment targets (Elementor / WordPress)

A project's `deployTarget` is `github` (default; every existing project) or
`elementor`. An `elementor` project (first: PH Website, personalisationhub.com)
has no repo, deploy branch or train: the build output is an **artifact**
(`kind` page | post | template | media, with Elementor JSON or text) linked on
the ticket as its test link, and approval publishes it through the Elementor
MCP. GitHub-only UI (deploy branch, train status, e2e, repo-synced README,
Deploy to Main) is gated on `usesGithub(project)`.

Pure logic lives in `functions/elementor-deploy.js` (tested by
`test/elementor-deploy.test.js`, no network):

- `publishArtifact` creates (`elementor-create-page`) or updates
  (`elementor-publish-document`) and returns the ticket fields to merge:
  `publishedUrl`, `wpId`, `deployVersion` and an append-only `deployHistory`
  (each entry keeps the previous version's snapshot). `dryRun` calls nothing.
- `rollback` restores the previous snapshot as a new version.
- `prePublishChecks` holds an item in Ready for Testing when a blocked
  client/brand name appears (whole word, case-insensitive).
- Recurring jobs: `nextRunAt` (weekday/hour in `Australia/Sydney` plus a random
  jitter window, DST-correct) and `scheduledRunRecord`, which auto-publishes
  only when the project's `autoPublish` AND the job's `autoPublish` are set and
  the checks pass, otherwise leaves the run in Ready for Testing.

Status: the module and tests have landed. Still to wire (follow-up tickets):
the project setting in the New Project / Docs UI, the Approve → publish
trigger and Cloud Scheduler job runner, per-ticket deployment log display, and
release-report/count support for `elementor` projects.

## Non-goals / explicitly out of scope

- ~~**Authentication/authorization.** Everything here is open by design at
  this stage.~~ **Superseded.** The console is behind a managed member list
  (`consoleUsers` above) with three roles, enforced in `firestore.rules`,
  `storage.rules` and the MCP server alike. What remains out of scope is
  anything richer: per-project permissions, groups, SSO/SAML, or an
  approval workflow for adding someone.
- **This project does not decide what other projects' backlog items should
  say or how they should be prioritized.** It only carries them.
- **The FAQ site's own visual match to the real WordPress theme** is a
  best-effort approximation, not a verified pixel match — this sandbox
  cannot reach personalisationhub.com to check.

## Known gaps / open questions

1. The Routine-fire integration depends on a research-preview Anthropic API
   whose exact endpoint/header requirements have already changed once
   silently (the `anthropic-version` header). Treat any future "Notify
   Claude does nothing" report as an API-shape question first — reproduce
   with a direct `curl` against the fire endpoint before assuming the bug
   is in this repo's code.
2. `NOTIFY_WEBHOOK_URL`'s target is still whatever it happens to point at
   (Slack, by default) — unlike the Routine-fire half of the same click,
   the webhook post still fundamentally depends on a human (or a
   separately-built relay) to act on it. This was previously also fired
   per-item automatically; removed as too noisy (see "notification &
   automation" above) — resolved, not left open, but noting the tradeoff:
   a project that wants Claude's attention on every single new item, not
   just a batched Notify Claude click, has no built-in way to get that now.
3. No automated check keeps a project's repo-native `REQUIREMENTS.md` (this
   file, for this project) and its Firestore `requirementsMd` field in
   sync beyond "whoever edits one remembers to update the other." Treat a
   divergence as a bug in whichever copy is stale, same as the
   `interfaces` contracts.
4. The FAQ site's brand palette has never been checked against the real
   WordPress theme (network-blocked from this sandbox) — screenshots or
   the theme's actual token values would let it be tightened.

## Per-ticket model requirement

Ticket t1CU2q6LlxGd5pFB9vwG (13 Nov 2026). Some tickets (permission
boundaries, credentials, firing authorisation) must be built and reviewed on
the most capable Claude model. Two tickets said so in a free-text
"MODEL REQUIREMENT: Opus" line that nothing enforced; the requirement is now a
field.

- **Field**: `backlogItems.model` — `"standard"` (default; unset means
  standard) or `"advanced"` (Claude Opus only). Browsers may write it
  (`firestore.rules` accepts only those two values or null).
- **Set it**: New item → Model, Edit item → Model, or MCP
  `create_backlog_item` / `update_backlog_item` (`model`). `list_backlog_items`
  and `get_backlog_item` return it; `get_backlog_item` also returns
  `builtByModel` / `reviewedByModel`.
- **Card**: an Advanced ticket shows an "Advanced · Opus" chip (Material
  Symbols `psychology`) in every column; its hover, and the Edit item modal,
  say which model built and reviewed it. Standard tickets show nothing.
- **Build**: `perItemFireText` adds `modelRequirementBlock(item)`
  (`functions/model-requirement.js`) to each ticket's fire. A Standard ticket
  gets one line asking the session to record `builtByModel`; an Advanced one
  gets the rule — build on Opus, or hand the build to an Opus subagent, or do
  not build and flag the card `blocked: {reason: "model-unavailable"}`
  (`ROUTINE_INSTRUCTIONS.md` → "Per-ticket model requirement").
- **Backstop**: `run-backlog-automation.js` refuses an Advanced ticket's patch
  whose `builtByModel` is not an Opus (`modelGuardRefusal`): nothing lands,
  `patchReady` is cleared, the card is flagged `model-unavailable` with a note,
  and it is not rebuilt automatically.
- **Judged by what was fired** (18 Nov 2026, ticket 6Nia0yWu8yAL3STGh96R).
  Each fire records the requirement it carried as `lastFire.model`. When the
  card's `model` is the classifier's (`modelAuto: true`), the guard judges the
  patch against `lastFire.model` for the attempt that handed back
  (`requiredModelForBuild`: `patchAttemptId`, else `buildAttemptId`, must
  match `lastFire.buildAttemptId`). A person's choice or an escalation is
  judged as it stands; with no fire record, the card's model, as before.
  Advanced means Claude Opus, strictly: any other model is refused. On 18 Nov
  2026 two finished, tested Standard builds (x3MqwdJx…, SYkk20sr…) were
  refused as "needs Opus" because their own hand-over wording ("the
  `ANTHROPIC_API_KEY` function secret, already set"; "No new secret or
  index") made the classifier re-mark them Advanced in the same write as
  `patchReady`.
- **The Advanced (Opus) Routine** (18 Nov 2026). The fire endpoint takes
  only `text`, so a Routine's model is fixed where it is created. An admin
  can create a second Routine at claude.ai/code/routines with Claude Opus as
  its model and the same bootstrap prompt, and register its API trigger with
  the MCP tool `set_advanced_routine_binding` (admin only, write-only, fire
  URL on `api.anthropic.com` only; `""`/`""` clears it). It is stored at
  `modelRoutineBindings/advanced` `{fireUrl, token, boundAt, boundByEmail}`,
  which has no rule in `firestore.rules`, so no browser can read or write it
  and no tool returns it. When it is set, a Ready for Dev click sends each
  Advanced ticket that would otherwise fire on the shared Routine to it
  (`advancedRoutineFor` in `functions/index.js`), while Standard tickets fire
  on the shared Routine, all in parallel as before (one session per ticket).
  The card's `lastFire.firedVia` reads `"advanced"` and the project's
  `notifyRoutine.firedVia` `"shared+advanced"` for a mixed click. A project's
  own Routine, the clicker's own binding and an owner's agent ticket keep
  their Routine (they may carry tools or an account the Opus Routine lacks),
  and those sessions still delegate to an Opus subagent from the fire text.
  Without the binding nothing changes: the shared Routine plus the
  delegation block. Build fires only; Review Batch and Deploy fires are
  unchanged (an Advanced ticket's review is still delegated, and a non-Opus
  review does not count).
- **Flag**: a `model-unavailable` card shows "Not built: needs Opus" with the
  clear (×) control and no Answer button (there is no question). Notify Claude
  skips it like any blocked card; clearing the flag puts it back in the queue.
- **Review**: the Review Batch fire tags each ticket `[Model: Advanced …]` or
  `[Model: Standard]`. An Advanced ticket is reviewed on Opus only; with none
  available its flag is `reviewStatus: "blocked"` with `reviewReason`
  `model-unavailable: needs Claude Opus`, shown as "Review blocked: needs
  Opus". Every reviewed ticket records `reviewedByModel`.
- `builtByModel` and `reviewedByModel` are pipeline fields
  (`itemPipelineFields()` in `firestore.rules`): only the automation user
  writes them.

### The advisor model: Fable (23 Nov 2026)

Ticket MoCADJ47kT9a77tg4cfW. When a ticket raises a question, or needs
analysis or support before it can be built (a choice left open, a blocker,
something to clarify or investigate), the board calls on Fable
(`claude-fable-5-2`) as the advisor, and the build carries on with its advice.

- **In every build fire**: `modelRequirementBlock(item)` ends with
  `advisorBlock(item)` (`functions/model-requirement.js`), an
  `=== ADVISOR: Fable (claude-fable-5-2) ===` block, on Standard and Advanced
  tickets alike. Constants: `ADVISOR_MODEL` (`claude-fable-5-2`),
  `ADVISOR_AGENT_MODEL` (`fable`, the Agent tool's alias),
  `ADVISOR_NOTE_PREFIX` (`[advisor · claude-fable-5-2]`).
- **What the session does** (`ROUTINE_INSTRUCTIONS.md` → "The advisor model
  (Fable)"): asks the advisor through the Agent tool with model `fable`,
  appends its advice to the card as a note starting
  `[advisor · claude-fable-5-2]`, and builds on its recommendation, saying
  under "Assumed:" what it took. If a person alone can supply what is
  missing, the flag carries the advisor's recommendation in
  `blocked.recommendation`, which `sweepAutoAnswers` takes as the answer.
  With no advisor available the session decides itself and says so.
- **Fable never builds or reviews.** The build and the review run on the
  ticket's model. An Advanced ticket is never built on Fable:
  `isAdvancedModelId` does not match it, so `modelGuardRefusal` refuses such
  a patch, and `isAdvisorModelId` names the advisor. `builtByModel` /
  `reviewedByModel` record the model that did the work, never the advisor.
- Tests: `test/model-flow.test.js` ("advisor").

### Chosen per ticket automatically (16 Nov 2026)

Ticket CCPnRjXOH4YMsfy3C49r ("Flow 8/9", 14 Nov 2026 board flow review).
The Model field was set by hand and nothing chose it, nothing escalated, the
review had no guard, skills were one global list, and tickets were fired at
sessions without the tools they needed (7MbGv2fT… "Not built" four times for
want of the WordPress MCP; v8q30p66… four builds for basic errors).

- **Suggested at intake.** `public/js/model-suggest.js` (ESM, shared with the
  browser; `functions/model-suggest.js` is its generated CommonJS copy,
  `scripts/gen-model-suggest-cjs.sh`, and `test/model-suggest.test.js` fails
  if they drift) is a deterministic classifier, no model call. A ticket is
  Advanced when its title or description names permission or security code
  (`firestore.rules`, `storage.rules`, `auth-gate.js`, OAuth/PKCE,
  `consoleUsers`, access/refresh/ID tokens, secrets), the release pipeline
  (`run-backlog-automation.js`, `train-lock.js`, `.github/workflows/`), a data
  migration or backfill, an interface contract (`shared/`, `` `interfaces` ``),
  files under two or more projects' owned paths (`ownedPaths`, else
  `repoFolder`), effort Large, or is over 2,500 characters with five or more
  numbered build items in its Outcome. Otherwise Standard. The verdict and
  every reason that fired are stored as `modelSuggested`.
- **What it reads** (version 2, 18 Nov 2026). The keyword rules read the
  title and the description without its **Test steps** and **Dependencies**
  sections: those say how to test the ticket and what it needs (another
  ticket, a secret that already exists), not what it changes, and a build
  session writes them at hand-over. The Outcome and Spec reference are read
  as before. Negation is not read: a keyword counts wherever it appears in
  the title, Outcome or Spec reference, so "Reject requests with no auth
  token" and "Users without admin role must not see secrets" stay Advanced
  (a negating rule tried on 18 Nov 2026 was dropped at review because it
  marked such security tickets Standard). The version
  bump makes `sweepModelSuggestions` score every open Backlog ticket again
  once; a person's choice is untouched.
- **Held while a build is in flight** (18 Nov 2026). While a build of the
  ticket is under way (`buildInFlight`: `patchReady` is set, or the current
  attempt's fire started a session that has not reported done or error
  since), the trigger records the new `modelSuggested` but leaves `model` as
  the build was fired with. Once nothing holds it, the next write to the card
  brings `model` in line with the suggestion (`modelSuggestNeeded`), so a
  rebuild is fired on it.
- **Who sets `model`.** The `onBacklogItemModelSuggest` trigger runs on a
  create and on every save of the title, description, area or effort (Backlog
  only). If no person chose a model, `model` takes the suggestion with
  `modelAuto: true`. A person's choice (New item / Edit item Standard or
  Advanced, MCP `model: "standard" | "advanced"`) writes `modelAuto: false`
  and is never overridden; picking **Auto** (the default, MCP
  `model: "auto"`) hands it back. The automation's `sweepModelSuggestions`
  scores every open Backlog card without a `modelSuggested` once.
- **Card and forms.** An automatic Advanced chip reads "Advanced · Opus
  (auto: touches security rules)" (the first reason; all of them on hover);
  an escalated one "Advanced · Opus (raised after 2 failed rounds)". New item
  and Edit item show the suggestion beside the select ("Suggested: Advanced —
  touches security rules"), worked out live from the form.
- **Escalation.** A Standard ticket with two counted send-backs (Failed
  testing, a train test ejection, a review kick-back — "Testing rounds") is
  raised in `processRevertFromTrain`; one whose patch was refused twice
  (`autoRebuilds`) in `selfHealPlan`. Both happen before the next rebuild
  fires: `model: "advanced"`, `modelAuto: false`, `modelEscalatedAt`, and the
  note "Raised to Advanced after 2 failed rounds". Once per ticket
  (`modelEscalation` in `functions/model-requirement.js`).
- **Review guard.** An Advanced ticket whose `reviewedByModel` is set and is
  not an Opus counts as not reviewed (`reviewNeedsOpus` / `reviewedForCommit`):
  the card's review flag reads "Review blocked: needs Opus", Review Batch
  picks it up again, and the Ready for Testing hand-off waits for it. A review
  with no recorded model (older reviews) is not refused.
- **Review without a click.** When an Advanced ticket, or any ticket scored
  for `security` or `pipeline`, lands on the train, the automation stamps
  `autoReview {commit, requestedAt}` and writes the project's
  `reviewRequestedAt` with `reviewScope {itemIds, requestedAt}` carrying the
  same timestamp. `notifyOnProjectReviewBatch` reviews only those tickets
  when the two match; a person's own Review Batch press (a newer
  `reviewRequestedAt`) reviews the whole batch as before. One automatic
  review per landed commit; `handOffWaitingOn` holds the Ready for Testing
  presentation on "review" until it is done (up to the hand-off's usual
  limit). A kick-back counts as a send-back. Standard tickets keep the
  manual button.
- **Skills per project and per kind of work.** `settings/phaseSkillBindings`
  takes optional `byProject[projectId]` and `byArea[category]` entries, each
  `{build?: slug[], deploy?: slug[]}` (a plain array is read as `build`),
  added to the global lists. A ticket that changes rendered UI (a UI area, or
  its Outcome mentions a page, modal, button, CSS…) always gets
  `ph-designer`. Each build fire lists the union with the reason for each
  ("- ph-designer: this ticket changes rendered UI"), and the card records the
  slugs on `lastFire.skills` (`functions/skill-bindings.js`). MCP
  `set_phase_skill_bindings` takes `projectId` or `area`; Settings → Skills
  lists every binding. The old shape is read as before.
- **Required tools.** `projects/{id}.requiredConnectors` (up to 10 short
  names, e.g. `["wordpress-mcp"]`; Docs page → Required tools) goes into every
  build fire as the session's first step: check it can reach them; if not,
  flag `blocked {reason: "tools-unavailable", missing: [...]}` and stop. The
  card reads "Not built: this session has no wordpress-mcp" with the clear
  (×) control and no Answer button, and it shows on Needs attention
  (`card-state.js`). The automation never answers it as a question; it
  retries it once by itself only when the project has been given its own
  Routine since the flag (`toolsRetryPlan`).
- **A project's own Routine.** `projectRoutineBindings/{projectId}` =
  `{fireUrl, token, boundAt, boundByEmail}`, set or removed by an admin on the
  project's Docs page and readable by nobody (`firestore.rules`); the project
  doc only gets `routineBoundAt`. When set, the project's build, review,
  deploy and Ready for Testing fires use it before the clicker's own binding
  or the shared Routine (`resolveProjectRoutineCredentials`); agent tickets
  still fire on their owner's binding. No read path returns it.
- **What ran.** Card hover and Edit item: "Built on <model> · reviewed on
  <model> · skills: <list>". The project's ⋮ menu → **Builds by model** shows
  the last 30 days of tickets per `builtByModel`: tickets (Advanced among
  them), testing rounds, rounds per ticket and rebuilds (send-backs plus
  automatic rebuilds) (`buildsByModel`).
- **Fields.** `modelSuggested`, `modelEscalatedAt`, `autoReview` and
  `toolsRetries` are pipeline fields; `modelAuto` is a person's to write
  (boolean). Project: `requiredConnectors` (members, ≤10), `routineBoundAt`
  (admin), `reviewScope` (automation only).

## Agent tickets fire under their owner's own Claude account

Ticket xFzQgynkoMdV33iWJFZq (15 Nov 2026). An agent ticket carries an owner,
and every Routine session for it runs under that owner's own Claude account:
never the shared project token, and never on someone else's click.

- **Field**: `backlogItems.ownerEmail` (lowercased). A pipeline field in
  `firestore.rules` (`itemPipelineFields()`): no browser writes it, so nobody
  can tag a ticket with another person's account. It is set by the server:
  MCP `create_backlog_item` / `update_backlog_item` with `ownedByMe: true`
  (the caller only; claiming an existing ticket needs it to be in Backlog
  and filed by the caller, or an admin; `ownedByMe: false` releases the
  caller's own, an admin may release anyone's), and by Send to Agent
  (VlBatzRVbPt6heAEp5mu) when it creates tickets from a Kanban ticket.
- **Rule** (`functions/owner-firing.js`, applied in `functions/index.js`):
  - **Ready for Dev** (`notifyOnProjectReadyForReview`): an agent ticket
    fires on its owner's binding (`ownerRoutineCredentials`, the
    `routineBindings/{owner}` lookup with no shared fallback) when the
    owner clicked (`notifyRequestedByEmail`), or when the request is the
    pipeline's own automatic rebuild (`notifyAutomationAt` equal to
    `notifyRequestedAt`, written only by `run-backlog-automation.js`).
    Anyone else's click, including an admin's `send_to_build`, is refused:
    a ticket the click named gets `lastFire.status: "refused"`
    (`reason: "not-owner"`) and the project's `notifyRoutine.errorMessage`
    says why; one only swept up by a whole-column click is left alone.
    An owner with no usable binding (none, or not on `api.anthropic.com`)
    gets nothing fired (`reason: "no-binding"`). Untagged tickets in the
    same click fire exactly as before (clicker's binding, else shared).
  - **Deploy to Main** (`notifyOnProjectReadyToDeploy`): a train carrying
    agent tickets deploys only when the clicker owns every one of them, on
    their binding. A train mixing two owners' agent tickets, someone else's
    click, or an owner with no binding is refused: nothing fires and
    `deployRoutine` is `status: "error"` with the reason.
  - **Groom Backlog** (`notifyOnProjectReadyForGrooming`): other members'
    agent tickets are left out of the session; the clicker's own are
    included only through their binding, and the session then runs on it.
    What was left out is on `groomRoutine.note`; nothing left fires nothing.
  - **Review Batch** (`notifyOnProjectReviewBatch`) and the **Ready for
    Testing presentation** (`notifyOnItemsReadyForTesting`), ticket
    rFNYoDzDdDtQJpupDNpN (16 Nov 2026): these are sessions about tickets
    that are already built, so an agent ticket in the batch is reviewed or
    presented under its owner's own account too. The batch is split
    (`planOwnedSessions` in `functions/owner-firing.js`,
    `ownerSessionGroups` in `functions/index.js`): the untagged tickets are
    one session on the clicker's (or build requester's) binding, else the
    shared Routine, exactly as before; each owner's agent tickets are one
    session on that owner's binding and nothing else, whoever pressed
    Review Batch, so a batch mixing two owners fires one session per owner.
    Unlike Ready for Dev, someone else's press is not refused: these steps
    are pipeline gates on finished work, like the automatic rebuild, and
    refusing them would leave an agent ticket unreviewable by anyone but
    its owner. An owner with no usable binding gets nothing fired for their
    tickets, never the shared token: each such card gets a note "Not
    reviewed: …" / "Not presented: …" with the build's no-binding message,
    and `reviewRoutine.errorMessage` / `readyForTestingRoutine.errorMessage`
    carries it. Both records gain `sessions: [{owner, itemIds, sessionId,
    sessionUrl, error, firedVia}]` (one per session fired), keep the first
    session's `sessionId`/`sessionUrl` on top, and `firedVia` reads
    `"owner"` or `"<member|shared>+owner"` when agent tickets were in it.
    Known limit: with several sessions, whichever finishes first marks the
    record `done`.
  - **Exempt, on purpose**: **Run E2E** (`notifyOnProjectRunE2E`) and the
    **release audit** (`onReleaseMarkedLive`) still run as one session on
    the clicker's binding, else the shared Routine. Neither is a session
    about a ticket: Run E2E names no ticket and runs a project's test
    suites, writing only `projects/{id}.e2eStatus`; the release audit
    reviews Help Centre articles against a whole release (every project and
    owner in it) and writes only proposals on `faqArticles` and the
    `releaseAudits` record, never a ticket. Splitting either per owner would
    run the same suite, or audit the same articles, once per owner, with
    competing results on one shared record.
- **Board** (`public/js/owner-fire.js`, `app.js`): an agent ticket shows an
  owner chip (`person`). In Backlog, a viewer who may not start it (someone
  else's, or their own with no binding) sees its Ready for Dev checkbox
  disabled, with an info icon whose tooltip says why and links to
  Settings → My Claude Routine; Ready for Dev counts and sends only what the
  viewer may start. Deploy to Main and Groom Backlog are disabled the same
  way when the rule would refuse them. Whether the viewer has a binding
  comes from `GET /mcp/me/routine-binding`, asked once, only when an agent
  ticket is on screen. The server refuses anything the board gets wrong.
- **Settings → My Claude Routine** (`#settings/routine`, every member): the
  self-service setup that replaces the MCP-only path. Four steps: create a
  Routine at claude.ai/code/routines, paste the bootstrap prompt (shown, with
  Copy prompt), add an API trigger, paste its fire URL and token and Save.
  Status says Connected or Not set up; Disconnect clears it. Served by
  `/mcp/me/routine-binding` in `functions/mcp-server.js`: `GET` returns only
  `hasRoutineBinding`, `boundAt` and the bootstrap prompt; `POST {fireUrl,
  token}` (editor or admin; both empty clears) writes the signed-in member's
  own `routineBindings/{email}` through the same `writeRoutineBinding` and
  validation as `set_my_routine_binding`, and is audited in `mcpAuditLog`
  (`via: "console"`). The URL and token are never sent back.
- **Known limit**: over MCP, only the owner's own agent may change an agent
  ticket (see "Owner scoping and contract-change review" below). A person
  editing in the console is not limited yet: any editor can still change an
  agent ticket's text there, which its owner's Routine then reads.
- **Tests**: `test/owner-firing.test.js` (the rule, the Ready for Dev,
  Deploy, Groom, Review Batch and Ready for Testing handlers, Run E2E's
  exemption, the endpoint) and `test/owner-fire.test.mjs` (the board's half), both in
  `npm run test:routine-binding`; `firestore-rules.test.js` (`ownerEmail` and
  `notifyAutomationAt` are not a browser's); the console-click scenario
  "agent tickets: owner-only Ready for Dev, set up My Claude Routine".

## Owner scoping and contract-change review

(16 Nov 2026, ticket ZmEWDC40NYOiojehfPjk.) Builds on "Agent tickets fire
under their owner's own Claude account" above (the owner is
`backlogItems.ownerEmail`) and on "Build order" (the blocks / blocked-by link
is `dependsOnItemIds`; there is no second dependency field).

**Read everything, change only your own.** Every member's agent reads the
whole project over MCP: every ticket in full (`get_backlog_item`,
`list_backlog_items`, both now returning `ownerEmail` and `contractReview`),
the project's docs and its interface contracts, so it can see cross-cutting
impact. It changes only tickets its own member owns:

- `update_backlog_item`, `archive_backlog_items`, `delete_backlog_items` and
  `set_blocked` on another member's agent ticket are refused with a message
  naming the owner, and nothing changes (archive and delete refuse the whole
  call). The rule is `ownerEditRefusal` in `functions/owner-firing.js`.
- An admin's agent is refused like anyone else's (each agent is one owner's
  session). The one exception is releasing a ticket (`update_backlog_item`
  with only `ownedByMe: false`), which an admin may still do.
- An untagged ticket (no `ownerEmail`) stays open to every editor's agent.
- `add_item_comment` and `clear_blocked` stay open to every member: a comment
  is how one owner tells another about an impact on their work.
- A build fire naming someone else's agent ticket (a click by anyone but its
  owner) is refused as before, and the refusal is now also appended to the
  card's comments ("Not built: Only … can start this agent ticket").

**Contract-change review flag.** When a ticket's patch lands on its train
and that commit changes an interface contract, every open ticket (Backlog,
Ready for Testing or Approved for Deployment) whose `dependsOnItemIds` names
it is flagged:

- What counts as a contract: `shared/interface-contract.md`,
  `shared/board-interfaces.json`, and any file that manifest lists
  (`interfaces[].path`, read before and after the commit). An edit made
  straight to an `interfaces` record on the board belongs to no ticket's
  build and flags nothing.
- The flag is `backlogItems/{id}.contractReview` (data model below), with a
  summary such as `shared/interface-contract.md (+4 −1; sections: Attribute
  envelope)`: line counts and the Markdown headings the change falls under.
  The dependent also gets a note, and the upstream card a note listing the
  tickets it flagged. Nothing else on a dependent is touched: the upstream
  ticket's session never edits it.
- The card shows a warning chip **Needs review: upstream contract changed**
  (Material Symbols `sync_problem`; hover = which ticket changed what).
- The dependent's next build fire carries a block
  `=== UPSTREAM CONTRACT CHANGED: REVIEW THIS TICKET ===` with the change,
  so its owner's own session reviews and updates it. The flag clears when
  that ticket's own patch lands (a commit, or a no-diff patch meaning nothing
  needed to change), with a note.
- A dependent already in Ready for Testing keeps the chip until it is sent
  back and rebuilt; nothing rebuilds it automatically.
- Code: `functions/contract-review.js` (pure rules, the record, the notes and
  the fire block), `contractChangeOf` / `flagContractDependents` in
  `scripts/run-backlog-automation.js` (called after a ticket's commit lands),
  `contractReviewBlock` in `functions/index.js`'s build fire text.
  `contractReview` is a pipeline field in `firestore.rules`: no browser can
  set, fake or dismiss it.
- **Tests**: `test/contract-review.test.js` (the rules, `contractChangeOf`
  against a real git repo, `flagContractDependents` against an in-memory
  Firestore; in `npm run test:routine-binding`), `test/owner-firing.test.js`
  (the MCP refusals, the refused-fire note, the fire block),
  `firestore-rules.test.js` (`contractReview` is not a browser's) and the
  console-click scenario "contract-change review: a flagged dependent shows
  Needs review".

## Blocked tickets: answering from the card

A Backlog ticket a build session blocked with a question (`blocked.reason`
`waiting-on-input` or `needs-decision`, with a `blocked.note`) is answered on
the board in one step.

- The card's blocked flag shows an **Answer** button (Material Symbols
  `forum`), whether or not intake sections are missing. It opens the Resolve
  modal, which shows `blocked.note`, then takes the answer (typed or dictated).
- Send appends a note "Answer to the build's question: <answer>" from the
  signed-in member, clears `blocked`, and, if the project's train is not
  locked, requests a build of that card alone (`notifyRequestedAt` +
  `notifyItemIds: [id]`). Any missing intake sections are asked next.
- **Ready for Dev counts only buildable cards**: not blocked, not `patchReady`.
  When the only Backlog cards are blocked, the header shows a non-clickable
  "N waiting on your answer" chip instead; the "needs your decision" chip is
  unchanged. A selection of only blocked cards writes no notify request.
- When a notify request finds only blocked cards, `notifyOnProjectReadyForReview`
  writes `notifyRoutine: {status: "error", errorMessage: "Every selected ticket
  is waiting on your answer — answer it on the card", firedAt}`.
- Build sessions end a waiting-on-input note with "Answer on the card (Answer
  button)" (`ROUTINE_INSTRUCTIONS.md`).
- **Layout: no overlaps, platform centred** (ticket A7y6SzunFfQdmJHubw9K):
  `layoutSystemMap()` centres the Personalisation Hub platform boundary
  (the core nodes, in a fixed three-column cluster wide enough for line
  labels) in the drawing and places every other node by a collision-avoiding
  search: the free spot nearest where it belongs, with a margin so no two
  boxes overlap. The drawing grows taller until all fit. A wide width
  (>= 1100 px) puts projects and concepts beside the platform; a narrow one
  stacks them above and below, and the layout is redone on resize when it
  crosses that width. Each line then takes the bow that clears other boxes,
  and its label sits on a clear stretch of line (or just beside it, in a
  narrower, taller form if needed) with a background, clear of every node
  and every other label. `test/system-map.test.mjs` asserts no node boxes
  overlap, the platform is centred, and no label overlaps a node or another
  label, at 390, 820, 1180, 1440 and 1920 px, for a sparse, typical and
  full board.

## Own name (first and last)

Any member can set their own **First name** and **Last name** in the profile menu (**Save name**). The console stores `firstName`, `lastName` and `displayName` (first + last) on `consoleUsers/{email}`; the Name column of **Settings → Users** shows `displayName` (falling back to first + last), and initials/avatars use it too. `firestore.rules` lets a member update only those three fields on their own row, each a bounded string (60/60/120 characters). Test: `test/avatar-rules.test.mjs`.

## Profile photos (avatars)

Any member can upload, replace or remove their own profile photo from the profile menu (**Profile photo → Upload photo / Remove**); an admin can set or clear anyone's from **User Management → Users**. The browser crops to a centred square and scales to 256×256 JPEG (~0.85) before upload; images over 10 MB and non-images are refused inline and nothing is uploaded.

- **Storage**: `avatars/{lowercased email}.jpg`. `storage.rules`: read for any member; write/delete only by the owner of that address or an admin; under 2 MB, `image/jpeg`.
- **Record**: `consoleUsers/{email}.photoUrl` + `photoUpdatedAt` (`?v=` cache-bust). `firestore.rules`: a member may change only `lastLoginAt`, `photoUrl` and `photoUpdatedAt` on their OWN row (`photoUrl` ≤ 1000 chars, bucket `avatars` URL or `""`; `photoUpdatedAt == request.time`); admins may write both on any row.
- **Owner accounts with no row**: the two owner accounts are admitted by the rules without a `consoleUsers` row, so saving the photo URL would fail on a missing document. `saveMemberPhotoFields()` reads the caller's own row first; when there is none and the caller is one of the two owner accounts, it creates the row (`role: admin`, `mcpEnabled: true` — `false` would cut the owner's MCP agent off, since `functions/mcp-server.js` honours it for owners too) carrying the photo; Remove clears it the same way. It does not depend on the cached console role or on inferring "missing" from an update's error code — the first fix (1083b14, 31 Oct 2026) did both and still failed live. Any other refusal is shown with its error code. Covered by `test/ui/avatars.test.mjs` and the owner cases in `test/firestore-rules.test.js`.
- **Fallback**: uploaded photo → Google sign-in photo (own avatar only) → coloured circle with the first-name initial.
- **One component**: `public/js/avatar.js` `avatarHTML(email, size)`, repainted in place when a member row changes (a per-document `onSnapshot` per email). Used on the topbar button, profile menu, card notes/comments (Edit item, quick comment, concept discussion), Team rows and system-map revision history. 24px on cards/notes, 28px in lists, 32–40px in the profile menu and Team list.

## Live whiteboard

A full-screen, shareable whiteboard for sketching ideas in meetings. Started from a **whiteboard icon in the top bar, immediately left of the notifications bell** (8 Nov 2026; it was the last item of the **Build** menu). The Whiteboard access level in a role still hides the icon.

- **Starting one**: the top-bar **Whiteboard** icon (`#whiteboard-btn`, handler in `app.js`) writes `whiteboards/{id}` with `{shared: true, createdAt}` and opens `whiteboard.html?b={id}&new=1` **in a new tab** (23 Oct 2026): the tab is opened empty on the tap itself, while it is still a user gesture, because popup blockers and iPad Safari refuse one opened after the write, then pointed at the board; a blocked popup falls back to this tab, and a failed create closes the empty tab. The console stays where it was. A write still pending after 15 s says "Couldn't start a whiteboard" instead of leaving the tap looking dead, and the button is re-enabled once the board is opened, and when Back restores the console from the back-forward cache (the same-tab fallback). `id` is 20 random letters/digits from the platform CSPRNG (`newBoardId()` in `public/js/whiteboard-core.js`). Each click makes a new board.
- **Page**: `public/whiteboard.html` (+ `js/whiteboard.js`, `js/whiteboard-core.js`, `css/whiteboard.css`). Standalone — it loads no console code and needs **no sign-in**; the id in the link is the credential. A link whose `b` is not a 20-character id, or whose board is missing or has `shared: false`, shows "This whiteboard link isn't valid" and no tools.
- **Share panel**: shown on a board's first open (`new=1`) and from the **Share** button. Holds the board's link, **Copy link** ("Link copied.") and, where the browser has `navigator.share`, **Share…** (the device share sheet). Panel is a bottom sheet on a phone.
- **Tools**: pen (6 colours, 3 sizes), eraser (drag across a stroke; removes the whole pen-down gesture), hand tool / hold Space / middle or right drag to pan, Ctrl/⌘ + wheel or two-finger pinch to zoom (0.1×–8×), wheel to scroll, **Reset view** (fits the drawing and turns auto-fit on), **Undo** (this window's last gesture; Ctrl/⌘ Z), **Clear** (asks first; removes every stroke for everyone). The canvas is unbounded; strokes are stored in world coordinates.
- **Back to the console** (`#wb-home`, 23 Oct 2026): the PH Agent Console logo sits top left and links to `./` (the console), so a person who opened a board from the Build menu can click straight back. Below 1480 px wide the tool bar drops under the logo so the two never overlap.
- **Auto-fit view** (default, 22 Oct 2026): every window frames all drawn strokes centred below the toolbar, easing toward the framed view each frame (`fitView()` in `whiteboard-core.js`, zoom capped at 2× in and `MIN_ZOOM` out; an empty board is 1:1). It refits on every snapshot (so all viewers follow a drawer), on resize, and when this window's pen, eraser or pinch ends; it is held still mid-gesture so the board never moves under the pen. Bottom-right group: **fit** (`#wb-fit`, auto-fit toggle, `aria-pressed`), **zoom out** (`#wb-zoom-out`), **zoom in** (`#wb-zoom-in`) about the middle of the board area. Manual Move/pan, wheel, pinch and the zoom buttons turn auto-fit off; **Reset view** and the fit button turn it on. Auto-fit is per window, not stored.
- **Toolbar fits every screen, never scrolls** (22 Oct 2026): labels show from 1200 px; below that the tools are icons only, and from 820 px down the separators go, the gaps tighten and Share is icon-only, so an iPad in portrait (768 px) keeps one row. Narrower still (phones), the bar wraps onto further rows. The share panel and **Reset view** follow the bar's real bottom edge (`--wb-bar-bottom`).
- **Touch taps act when the finger lifts** (`public/js/touch-click.js`, shared with the console's sidebar): iPad WebKit drops some taps' clicks and delivers others late — a colour tapped just before drawing reached the page after the stroke began, so the stroke kept the old colour. A touch or pen tap that lifts on the button it started on clicks it in `pointerup` (keeping the user gesture Copy link and Share… need) and the browser's own click for that tap is swallowed.
- **Sync**: strokes are `whiteboards/{id}/strokes/{strokeId}` = `{g, color, size, pts, t}` (`g` gesture id, `pts` flat `[x0,y0,x1,y1,…]` rounded to 0.1, `t` client ms for ordering). Every open copy has an `onSnapshot` on the collection. A stroke is saved when the pen lifts, and every ~1.5 s while a long one is still being drawn; one document holds at most 1500 numbers. A second finger cancels the stroke in progress and starts a pinch.
- **Rules** (`firestore.rules` → "Whiteboard"): a board doc may be `get` by anyone with a valid id; only members `list` boards, create one (`keys` = `shared`, `createdAt`; no email or name is stored) or flip `shared`; only an admin deletes one. While `shared == true`, anyone may read, create and delete strokes (so link holders can also erase and clear, by design — a public scratchpad); strokes are validated (`g` ≤ 40 chars, `#rrggbb` colour, size 0–200, 2–4000 numbers in pairs) and never updated. With `shared: false` only members read. Boards cannot be enumerated by non-members, so an id can be given but not found.
- **Not built yet**: a control to turn sharing off or list/delete old boards (the `shared` field and rules are ready for it); remote cursors; text and shapes.
- **Tests**: `test/whiteboard-core.test.mjs` (ids, links, zoom, chunking, hit-testing), `test/whiteboard-rules.test.js` (emulator; part of `npm run test:rules`), `test/ui/whiteboard.test.mjs` (Chromium, 1280 and 390 px; part of `test:ui`), `test/ui/whiteboard-tablet.test.mjs` (iPad sizes 768–1366 px by real touch: the menu item, a dropped click, Back and tap again; draw, colour, size, undo, pinch, Move, reset, eraser, dot, clear, share; plus the toolbar fitting with no sideways scroll from 390 to 1920 px; part of `test:ui`).

## Docs page layout (31 Oct 2026)

- A project's Docs page has tabs General, README, Requirements, Documents,
  Interfaces and Revisions; every existing control (including editing, mirror
  read-only rules and the document/interface modals) keeps working.
- README and Requirements render as Markdown in PH typography; Markdown is
  escaped before formatting. Edit toggles the textarea; mirrors have no Edit.
- Documents, Interfaces and Revisions are AG Grid tables with search and
  column sort, with a plain-table fallback when the grid script cannot load.
- Revisions lists `docRevisions` for the project (document, kind, when, by,
  via, size), newest first, read-only, without document text.
- Explanatory copy is shown as (i) info tooltips. Agent/MCP access to the docs
  is unchanged.

## User Management section

- **Names and initials (8 Nov 2026).** A member has a `firstName` and `lastName`
  (each up to 60 characters, set by an admin); `displayName` is kept as the two
  joined, so tickets, MCP and the Team page read it unchanged. In User Management
  → Users the name is a button that opens the Manage panel (the same as "⋯") where
  an admin edits first/last name, photo and access. Every avatar without a photo
  shows first + last initials (`initialOf` in `avatar.js`; for a member with only
  a `displayName`, the first and last words), so "Duy" and "Duong" no longer both
  show "D".

- **User Management is the first tab of Settings (4 Nov 2026)**, visible to
  admins only, with two sub-tabs: **Users** and **Roles** (`#settings/user-management/<users|roles>`;
  a role's own page is `#settings/user-management/roles/<id>`; the old
  `#user-management/*` links redirect). There is no User Management, Roles or
  Permissions item in the left nav and no standalone Permissions section.
  Settings tabs use PH Core's campaign-editor tab style (46px, underline ink
  bar, the active tab in brand teal with a 10% tint). The remaining tabs keep
  their order after it: Projects, Releases, Skills & phase bindings,
  Automations, Integrations & MCP. A non-admin opens Settings on Projects.
- The Users page is an AG Grid table with columns name, email, role, status and
  last active; sortable, filterable per column, searchable, paginated; styled to
  the Personalisation Hub table conventions (`ph-designer`).
- Add User opens a side panel to add a member and assign a role. An admin can
  change a role inline or for selected rows in bulk, and deactivate (and
  reactivate) one or many users. Deactivating sets `consoleUsers.disabled`, which
  the console rules and the MCP server already treat as no access, and signs the
  user's agents out. Changes are written to `consoleUsers` and persist.
- The Roles page is an AG Grid table of internal IAM roles (Admin, Product,
  Designer, Engineer, Security by default) with columns role name, description,
  users and last modified. Admins can create, edit, clone and delete roles; the
  UI calls them "roles", never "personas". Names are unique ignoring case.
  Deleting a role is refused ("Role in use") while any user is assigned to it.
  Roles live in the `roles` collection (members read, admins write); a user's
  assignment is `consoleUsers.roleId`, set from the Users grid's "Assigned role"
  column, and drives the Users count.
- **Permissions (1 Nov 2026; moved onto the role page 4 Nov 2026).** Permissions
  are edited only inside a role: the edit icon on the Roles grid opens the role
  page (name, description, then every console section grouped as the sidebar is,
  Build / Promote / Support / Settings, then Other, each No access / View / Edit /
  Admin, and **Save role**). There is no comparison matrix. The sections carry the
  sidebar's own names and order: Agent Board, Staff Kanban, Concepts, Whiteboard
  (Build); Brand Guidelines, Leads (Promote); Help Centre (Support); Settings,
  Settings > User Management, Releases, Skills & phase bindings (Settings);
  Project docs (Other, no menu item). The list is **derived from the menu**:
  `permissions.js` names the known sections, and any sidebar button no section
  owns is added to Roles at load (`discoverNavSections`), in its menu group, so a
  new menu item appears in Roles without editing the file (a role's grant for its
  first sibling in the group carries to it until set). `test/permissions.test.mjs`
  reads `index.html` and fails if a menu button, name, group or order differs.
  Settings sub-tabs Projects, Automations and Integrations stay under Settings.
  Leads has its own key, `promote-leads`; a role saved before it existed follows
  its old `promote` grant, so Brand Guidelines and Leads both keep it. Stored as `roles/{id}.permissions`
  (`{sectionKey: level}`); a role with no map gets Edit everywhere except User
  Management (none). The logic is `public/js/permissions.js`. Enforcement, in
  the console UI: a section with No access is hidden from the nav and search and
  its URL shows a "No access" notice; below Edit, the section's add/save
  controls are removed and its guards refuse the write; a member with no
  assigned role is unrestricted as before. The **Admin role** is always Admin
  and its column is locked, and a member whose fixed console role is `admin`
  always keeps User Management whatever their assigned role says, so nobody can
  lock themselves out. The fixed `viewer` console role never exceeds View. Only
  an admin can change a role's permissions. Admin level currently differs from
  Edit only by unlocking user and role management; it is reserved for
  per-section admin controls.
  **Limit:** this is UI enforcement. `firestore.rules` still gate data by the
  fixed admin/editor/viewer role, not per section, so it is access control for
  the console's screens, not a data boundary.
## Console navigation and Settings (31 Oct 2026)

- The primary nav has four groups: **Build** (Agent Board, Staff Kanban,
  Concepts, Whiteboard), **Support** (Help Centre; labelled Publish before 4 Nov 2026) and **Settings**. Releases and Skills are reachable only
  from Settings. Settings is not in the profile menu. On a phone the tab bar is
  Build, Publish, Settings, Search, Profile.
- Settings has a sub-menu at `#settings/<page>`: Projects (names, descriptions,
  types, repository folders), Releases (versions, names, dates, status),
  Skills & phase bindings (the skills bound to the Build and Deploy phases, and
  the skills library), Automations (Notify Claude, Groom Backlog, Batch review,
  Run E2E with trigger, skills and binding) and Integrations & MCP (agent
  connections, Media Studio API keys, dictation). Each page is an AG Grid
  table with a count line; explanations are info tooltips, not text under a
  table. No internal project names appear in UI copy.
- Reloading `#settings/<page>` or `#user-management` reopens the same page.
- **The sidebar opens and closes like Gmail's** (1024px and up, 17 Nov 2026,
  mUjtN0QWAnN9J3kK3LZC). The menu button at the sidebar's top left folds it to
  a 70px icon rail and expands it again; the page reflows to the rail, the
  icons keep their place, and the choice is remembered in that browser
  (`bt-nav-collapsed`). While it is a rail, resting the mouse on it (150ms) or
  tabbing into it opens it over the page at full width with a shadow, without
  moving the page, and it folds back when the pointer leaves. Touch never
  opens it this way: a tap on a rail icon goes to that page. The topbar
  hamburger is not shown at this width. Below 1024px the overlay drawer and
  the phone tab bar are unchanged.
- Out of scope: redesigning the Agent Board, Staff Kanban, Concepts or Help
  Centre pages.

### Stale page after a release: the real cause of the dead iPad menu (6 Nov 2026)

The iPad's left-hand menu went dead after releases five times (20 Oct to
6 Nov 2026). The tap fixes below were real but were not the cause. The
console's page is requested as `/`, and `firebase.json` had no Cache-Control
rule for that path (`**/*.@(html|js|css)` does not match a bare `/`), so
Firebase's default let the browser keep the page for up to an hour, while the
scripts are always fetched fresh. After any release that changed the page's
markup (new menu items on 1, 4 and 5 Nov), an iPad ran the old page with the
new scripts. `app.js` reached for a menu button the old page did not have and
stopped: the board still showed, but the menu and much of the console never
wired up. Chromium tests always load fresh files, so none caught it.

Rules:

- **`firebase.json` sends `Cache-Control: no-cache, must-revalidate` for `/`,
  `**/` and every `.html`.** The page is asked for on every load. Never let a
  page that loads module scripts be cached.
- **Scripts and stylesheets are kept for a year** (`public, max-age=31536000,
  immutable`, 18 Nov 2026). Until then they were `no-cache` too, and a reload
  of the console asked the server for about 56 files, each waiting on an
  answer and queuing behind the others (measured on the live console: about
  370 ms a file, first cards after roughly seven seconds on that connection).
  This is safe only because of the next rule: the page names every script and
  stylesheet by its build's content stamp, so a stamped URL never changes
  what it answers, and a new release's page asks for URLs no cache holds.
  **A first-party script or stylesheet must never be requested without the
  stamp**: it would be kept for a year. `scripts/build-console.js` fails the
  build on one it can see, `test/ui/minified.test.mjs` fails on one the
  running console asks for, and `test/ui/stale-page.test.mjs` fails if any
  rule lets a page be kept.
- **Every script and stylesheet URL carries the build's id** (17 Nov 2026,
  after Dashboard and Support Inbox did nothing on the iPad while the menu
  items from before that release worked, and a fresh tab didn't help: the
  iPad was running the new page with old scripts). `scripts/build-console.js`
  stamps `?v=<id>` (a hash of the files being deployed) onto every
  `src`/`href` to `js/` and `css/` in the pages and onto every relative
  `import` in the scripts, in the uploaded copy only. A page can then only
  load the scripts it was built with. The build fails if any relative
  import is left unstamped, since a module loaded under two URLs would run
  twice. `test/ui/minified.test.mjs` checks every first-party file the
  console requests carries the stamp and none loads twice. A lazily loaded
  module is matched in tests by its path, never by the full URL.
 (`reloadOnceAfterBootFailure` in
  `auth-gate.js`): when `app.js` fails to load, the console reloads the page
  once, stamped in `sessionStorage` so that a real fault (a bad deploy, no
  network) shows "The console didn't finish loading" after one try instead
  of reloading in a loop.
- `test/ui/stale-page.test.mjs` (in `npm run test:ui`) checks the headers,
  serves a stale page on first load at iPad landscape and portrait, and
  requires one self-reload and a working menu by touch afterwards; and that
  a page broken on every load stops after one reload. On the code before
  this fix it fails exactly the way the iPad did: the board shows, and
  tapping Staff Kanban in the menu does nothing.
- When a menu or page "stops working on the iPad" right after a release, ask
  whether a reload fixes it. If it does, look at caching and start-up
  errors before tap handling.

#### The reverse: a newer page with older scripts (14 Nov 2026)

After the Support Inbox release its menu item showed on the iPad and tapping
it did nothing: the previous page stayed. The item is plain markup, so it
shows as soon as the page is new; the handler is in `app.js`. A page from the
new release with scripts held from the one before gives exactly that, and it
is reproduced by serving today's page with the previous release's `app.js`.
The live files themselves were fine: fetched from the live site and run in a
real WebKit engine as four iPads, the item opened the page.

Rules:

- **Every sidebar item the page has must have been given a click handler by
  the scripts.** `auth-gate.js` watches the wiring while `app.js` starts
  (`watchMenuWiring`). An item left without a handler means the page is newer
  than the scripts: the console reloads once by itself (the same stamped
  reload as above), and if the item is still unwired it shows "The console
  has been updated, and this browser is still holding part of the previous
  version, so <item> can't open yet" with a Reload button, and shows it
  again whenever that item is tapped. A menu item is never silently dead.
- A sidebar item is therefore wired with its own `addEventListener("click")`,
  not by a delegated listener on the sidebar.
- `test/ui/stale-page.test.mjs` part 4 serves a page with a menu item the
  scripts don't know, in landscape and portrait: one self-reload, then the
  notice, the tap, the Reload button, and the rest of the menu working.
- **Chromium is not the iPad's engine.** `.github/workflows/console-webkit.yml`
  runs `test/ui/webkit-ipad.test.mjs` in Playwright's WebKit with iPad
  profiles: every sidebar item opens its page by touch and the page it came
  from is gone, then the Support Inbox journey. It runs against the sources,
  the minified build, and the files fetched from the live console. Run it
  (Actions → "Console on WebKit (iPad)") when something is reported dead on
  the iPad, before changing any code. It is WebKit, not iPad Safari itself.

### Modals and drawers: one set of rules (9 Nov 2026)

Every dialog and side drawer (`.modal-panel` in a `.modal-backdrop`) is handled
console-wide by `public/js/modal-polish.js` and the "Modals and drawers" block of
`public/css/apple.css`, so a new modal follows them without extra code:

- **Save only when something changed.** A Save / Create / Add / Submit button
  starts disabled and turns on when a field differs from how the dialog opened
  (a new form starts empty, so it is off until a value is typed; putting the
  value back turns it off again). Opt out with `data-no-dirty`.
- **The action row is sticky** at the bottom of the dialog, so Save is always in view.
- **The x is the last control in the header, top right**, a round grey button
  (44px on touch), and always closes its dialog (a fallback closes the backdrop
  if the page's own handler did not).
- Apple-style presentation: 18px radius, blurred sticky header and footer, soft-filled fields.

Tests: `test/ui/console-click.test.mjs` -> "Modals: Save is off until something changes...".

### iPad taps: every control must work on every tap (3 Nov, 5 Nov 2026)

The iPad lost taps in the console four times: 20 Oct and 21 Oct (Staff Kanban
link), 3 Nov (Staff Kanban and Concepts in the sidebar), and 5 Nov ("many of
the links": the Settings and User Management tabs and the new pages added on
4 Nov). Chromium with touch emulation never reproduces it, so the early
tickets closed as "could not reproduce". The cause is iPad WebKit, not the
layout: it drops some taps' clicks, sends `pointercancel` instead of
`pointerup` when a finger rolls slightly, and delivers a late click re-aimed at
whatever is under the finger after the page has changed. The 3 Nov fix covered
the sidebar only, so every control added afterwards was unprotected; that is
why it came back.

Rules:

- **One console-wide handler, not per control.** `nav-shell.js` calls
  `installTouchTaps()` (`public/js/touch-click.js`) for the whole document. A
  touch or pen tap that lifts within 10 px and 800 ms on the control it
  started on clicks that control there and then. It tracks **both** Pointer
  Events and Touch Events, times taps with `performance.now()` (never
  `Event.timeStamp`), and swallows the browser's own click for that tap
  **wherever it lands** within 40 px and 1 s, so the tap never acts twice.
  It never prevents `touchend`'s default: doing so made the browser drop the
  click of a second tap on the same spot within about 100 ms, which broke
  opening a Staff Kanban card straight after closing a ticket. The tap's
  compatibility `mousedown`/`mouseup` are swallowed the same way: they arrive
  after the handler has acted and land on whatever is now under the finger,
  so a backdrop that closes on `mousedown` used to close the overlay the tap
  had just opened (Search in the sidebar and a Leads tile both opened and
  shut at once, 5 Nov 2026). A keyboard click, which has no coordinates, is never swallowed. The
  guard is disarmed by the next touch, so it can never eat the next tap's
  own click: before that existed it did, and Staff Kanban cards (`<article>`,
  not a tap target) failed to open when tapped just after closing a ticket.
- **What it covers** (`TAP_TARGETS`): `button`, `a[href]`, `[role=button|tab|
  menuitem|option|link]`, `summary`, checkbox and radio inputs (and a `label`
  for one), and anything marked `[data-touch-tap]`. Checkboxes, radios and
  their labels are the exception to "clicked on lift": the browser's own click
  toggles them, and only if it has not arrived 350 ms after the lift (WebKit
  dropped it) does the handler click them. Swallowing a duplicate click
  reverts a checkbox, which is how Staff Kanban's Settings switches turned
  themselves back on 5 Nov 2026. A new control written as
  one of those is covered with no extra wiring. A clickable element that is
  not (a `div` or `li` with a click handler) must get `data-touch-tap`, or
  better, be a `<button>`. Text fields, selects and contenteditable areas are
  never covered: they need the native tap for focus and the keyboard.
- **Act on `click`, not `mousedown`.** The handler sends a `click`, and the
  browser's own `mousedown` for a tap is the event WebKit is least reliable
  about. A control that must act on `mousedown` (a picker that keeps an
  input's focus) goes inside
  `[data-native-tap]`, which keeps the browser's own handling: Staff Kanban's
  mention picker and ticket picker. `test/touch-guard.test.mjs` fails the
  build on any new `mousedown`/`mouseup` handler until it has been reviewed
  and listed there.
- Do not stop propagation of `pointerdown`/`pointerup`/`touchstart`/
  `touchend` on `window` or `document`, and do not add a capture-phase
  `click` listener on `window` that stops propagation for controls: either
  one disables the handler for the whole console.
- **Tests, both in `npm run test:app-boots`, so in CI on every console pull
  request and train, where a red result holds Deploy to Main:**
  `test/touch-guard.test.mjs` (no browser) checks the handler is installed
  console-wide, that `TAP_TARGETS` was not narrowed, that the four WebKit
  failure modes are still handled, and the `mousedown` review list.
  `test/ui/nav-touch.test.mjs` (Chromium) checks that a tap which opens an
  overlay (Search, a Leads tile) leaves it open, that a checkbox toggles
  exactly once, and that the next tap's own click survives. It also taps
  every visible sidebar item from
  the board, Staff Kanban and Settings, and every visible tab on the Settings
  and User Management pages, at 1180×820, 1024×768 and 820×1180. It does this
  under each simulated WebKit failure: the native click dropped everywhere,
  `pointercancel`, Touch Events only, and a late re-targeted click. Each tap
  must leave the console in the state a real click does and run the handler
  exactly once. Its targets are found on the page, not listed, so a new
  sidebar item or tab is tested automatically. A page with a new kind of
  control (not a sidebar item or a tab) adds its start page to `PLAN` there.
- A change to the sidebar, `touch-click.js`, `nav-shell.js`, overlays, or any
  global `click`/`pointer*`/`touch*` listener is not done until both pass.
  Chromium passing a plain tap proves nothing about the iPad.

### Post-deploy check: the live console must serve the deploy (9 Nov 2026)

A green `firebase deploy` is not proof the console shows the change. On 9 Nov 2026
a report said shipped ACE/Leads changes (PR #553 and later) were not visible; the
live files did match `main` (same `APP_VERSION`, the new `.ace-grid` rule present),
so the deploy path (hosting target `console`, site `backlog-tracker-e4ed2`, public
dir `console-dist`) is correct and the gap was that nothing proved it.

- `scripts/build-console.js` writes `build-info.json` (`commit`, `tree`, `version`) into the
  uploaded copy; `firebase.json` serves it `no-store`.
- `deploy-backlog-tracker.yml` runs `scripts/verify-live-deploy.js` after `firebase deploy`: it
  fetches the live `/build-info.json` and `/js/version.js` (cache-busted, retried for ~3 minutes)
  and fails the run unless tree and version match what was just deployed.
- A failed live check is recorded as a failed deploy, so `deployedAppVersion` and `deployedTree`
  are not written and the next push redeploys instead of skipping as "already live".
- Test: `test/verify-live-deploy.test.js`.
- Not yet done: holding a train's tickets at "Merged to Main" until this check passes
  (`finishTrain` in `run-backlog-automation.js` sets `published-live` at merge).

## Promote section: Brand Guidelines (5 Nov 2026)

- A **Promote** group sits in the sidebar between Build and Publish (a
  Promote tab on a phone). Its first item is **Brand Guidelines**
  (`#promote/brand-guidelines`, `public/js/promote-section.js`). Its section
  key for roles is `promote` (labelled Brand Guidelines; Settings → User Management → Roles); a hash under
  `#promote/` routes to it.
- The page is **read-only** and shows two `projectDocs` rows found by
  `mirrorKey` (`brand-guidelines`, `brand-requirements`), which mirror
  `backlog-tracker/promote/brand-guidelines.md` and `brand-requirements.md`
  (declared in `board-docs.json`, copied on every merge to main). The
  sync's "Copy of…" line is hidden. Until the first sync it says the
  guidelines haven't arrived yet.
- The content is the PH Brand concept's README and Requirements as of
  5 Nov 2026, including the **founder tone of voice** section. Industry and
  vertical content is **not held** in the guidelines: they link to the
  personalisationhub.com industry pages. Logos, AWS Marketplace logos and
  the templates page are reachable from the guidelines (Brand assets and
  Reusable templates sections).
- **Agents read the guidelines over MCP** with `list_project_documents` and
  `get_project_document` on the Backlog Tracker & FAQs project; no new tool.
- **Leads** sits beneath it (next section): an entry in `PROMOTE_PAGES` and a
  nav button.
- Tests: `test/promote-section.test.mjs`, `test/permissions.test.mjs`, a
  scenario in `test/ui/console-click.test.mjs` and a page in
  `test/ui/mobile-shell.test.mjs`.

## Brand Guidelines › Partners: one co-branding page per partner (19 Nov 2026)

- Brand Guidelines has a **Partners** subsection: one page per retail network
  or other partner, listed at the foot of the Brand Guidelines page and opened
  at `#promote/brand-guidelines/partners/<slug>` (back link to Brand
  Guidelines; same `promote` permission). The first is **miPharmacy**.
- Each partner page is a repo file, `backlog-tracker/promote/partners/<slug>.md`,
  declared in `board-docs.json` with the mirror key `brand-partner-<slug>`.
  The page lists whatever `brand-partner-*` mirrors exist
  (`partnersFrom` in `public/js/promote-section.js`), so **adding a partner is
  a new file and a manifest entry, never a code change**. A superseded mirror
  is not listed.
- The file starts with a `<!-- partner … -->` block (`name`, `industry`,
  `summary`, `industryUrl`, `logoLight`, `logoDark`), which the page reads and
  does not show. The page draws the co-brand lockups from it: partner leads
  and Personalisation Hub leads, each on a light and a dark surface, using
  the official PH logo files (`public/img/brand/`, copied from the `ph-brand`
  skill) and the partner's files from Brand assets. Until a partner's logo
  file is supplied (an empty `logoLight` / `logoDark`), its slot shows a
  labelled empty box; a logo is never drawn or typed.
- Sections every partner page carries: who leads, by audience; co-brand logo
  lockups; colour hierarchy; naming, wording and tone; approved claims and
  outcomes (linking to the partner's industry page on personalisationhub.com
  as the single source of truth); co-branded templates, with finalised
  shared pieces added to Brand templates as reference templates.
- Agent-only detail sits between the agent-only markers and is hidden on the
  page (as for the main guidelines). **Agents read a partner page over MCP**
  with `list_project_documents` / `get_project_document` on this project
  (the `ph-brand` skill and Aidan use the same documents); no new tool.
- Tests: `test/promote-section.test.mjs` and a scenario in
  `test/ui/console-click.test.mjs`.

## Brand Guidelines › Markets: cultural and communication guidelines per market (19 Nov 2026)

- Brand Guidelines has a **Markets** subsection, built like Partners: one page
  per market, listed at the foot of the Brand Guidelines page (under Partners)
  and opened at `#promote/brand-guidelines/markets/<slug>` (back link to Brand
  Guidelines; same `promote` permission). The first are **Thailand**,
  **Singapore** and the **United States**.
- Each market page is a repo file, `backlog-tracker/promote/markets/<slug>.md`,
  declared in `board-docs.json` with the mirror key `brand-market-<slug>`. The
  page lists whatever `brand-market-*` mirrors exist (`marketsFrom` in
  `public/js/promote-section.js`), so **adding a market is a new file and a
  manifest entry, never a code change**. A superseded mirror is not listed.
- The file starts with a `<!-- market … -->` block (`slug`, `name`,
  `countries`, `region`, `spelling`, `currency`, `summary`), which the page
  reads and does not show. `countries` lists every way a lead's or TAM
  company's country may be written (ISO codes and names, for example
  `US, USA, United States, United States of America, America`).
- Sections every market page carries: **Communication style** (directness,
  formality, forms of address, deference to seniority); **Cultural
  sensitivities** (topics, imagery, colours, symbols and gestures to avoid;
  religious and royal sensitivities where relevant); **Local conventions**
  (spelling, currency, date and number formats, units); **Business
  etiquette** (follow-up pace, how hard to sell, relationship versus straight
  to the point); **Regulatory notes** (what affects claims and data use in
  advertising). Agent-only detail (`## For agents`) sits between the
  agent-only markers and is hidden on the page, as for the main guidelines.
- **Agents read a market page over MCP** with `list_project_documents` /
  `get_project_document` on this project (the `ph-brand` and collateral
  skills use the same documents); no new tool.
- **Aidan picks the market by country** (SUP-AID-49): branded collateral
  (SUP-AID-30) takes the company's country from Prospects (TAM) or Leads and
  finds the market page whose `countries` names it (`marketFor` in
  `functions/market-core.js`; case, dots and accents ignored). The whole page,
  agent-only detail included, goes into the prompt as `<market>` beside the
  brand skill, the industry and the prospect; it wins on tone and local
  conventions, the brand skill and the industry page win on product facts and
  claims, and "Personalisation Hub" keeps its spelling everywhere. The run
  records `aidan.collateral.market` (`{slug, name}`, or `{missing: <country>}`)
  and its timeline line says which page it followed.
- **No page for that market**: the default brand guidelines apply (the prompt
  says so) and the collateral is still sent. Aidan's self-check files a
  **Missing market page** ticket on this project (SUP-AID-50), one per
  country: a later request for the same country comments on it instead, and
  another country never matches it.
- Tests: `test/market-core.test.js`, `test/promote-section.test.mjs`, the
  Markets scenario in `test/ui/console-click.test.mjs`, and two whole runs in
  `test/support-mail.test.js` (Thai and US companies, and a Malaysian one with
  no page).

## Promote section: Leads (5 Nov 2026)

- **Promote › Leads** (`#promote/leads`, nav item beneath Brand Guidelines,
  own `promote-leads` permission section: viewers read, editors change). One card
  per company on a Kanban in the style of the Staff Kanban; lanes **Lead, Hot
  Lead, Demo, Post-demo, Closed Won, Lost** (`STAGES` in `leads-core.js`).
- **Data**: `leads/{id}` = `company {name (required), website, industry,
  countries[], storeCount}`, `contacts[]` (up to 25; `name`, `jobTitle`,
  `buyingRole` one of decision maker, champion, influencer, technical
  evaluator, procurement; `email`, `linkedin`), `stage`, `source` (e.g. Website
  form), `assignee` (a member's email), `customerAccount {id, name}` once
  converted, `enrichment`, and the usual created/updated stamps. Members read;
  editors write (`firestore.rules` → `isLead`, with the cases in
  `test/firestore-rules.test.js`).
- **Moving a card**: drag it to another lane, or use its "Move to" select
  (touch). The write is live for every open tab.
- **Priority within a lane (15 Nov 2026)**: a lane reads top to bottom as the
  order to deal with its leads, so the top card is the one to work next. An
  editor drags a card up or down its own lane (a line shows where it will land),
  or drops it at a chosen place in another lane; the lead summary's **Priority**
  row says "N of M in <stage>" with **Move to top / Move up / Move down**
  (44px buttons, the touch and keyboard route), and Alt+Arrow Up/Down on a
  focused card does the same. The order is `leads/{id}.rank`, a number, lower
  is higher (`firestore.rules` → `isLead` allows it, number or absent).
  `leads-core.js` → `compareInLane` sorts ranked leads first by rank, then
  unranked ones newest change first (the order every lane had before);
  `planLaneOrder` writes one midpoint rank when both neighbours are ranked and
  otherwise renumbers that lane in steps of 1024, in one batch, writing only
  the leads whose rank changes. A lead moved to another stage with the Stage
  select (or no drop position) goes to the top of that lane (`topRank`). An
  agent's `update_lead_stage` leaves `rank` alone. Tests: `test/leads.test.mjs`
  and the "drag a lead up its lane" scenario in `test/ui/console-click.test.mjs`, and the `rank` rule in `test/leads-rules.test.js` (emulator, `npm run test:rules`). Over MCP an agent manages
  the whole pipeline with the board's permissions (editor writes, viewer reads),
  each write attributed to the member's email: `list_leads` (filters stage,
  company, assignee, source, industry, free text `q`; `limit`/`offset`; archived
  leads only with `includeArchived`), `get_lead`, `create_lead` / `create_leads`
  (stage defaults to `lead`; a company name that already exists, case-insensitive,
  archived included, is refused and the existing lead returned), `update_lead`,
  `update_lead_stage`, `add_lead_contact` / `update_lead_contact` /
  `remove_lead_contact` (buying roles), `add_lead_note`,
  `link_lead_customer_account` (records the account and moves the lead to Closed
  Won unless `moveToClosedWon` is false) / `unlink_lead_customer_account`,
  `link_lead_prospect` / `unlink_lead_prospect` (sets `prospectId` on the lead and
  `leadId` on the prospect; one lead per prospect), `archive_lead` /
  `restore_lead` (`archivedAt`; the board hides archived leads) and `delete_lead`
  (admin only, permanent, needs `confirm: true`). Every MCP change appends
  `{at, by, kind, text}` to the lead's `history` (newest 100), shown on the
  lead drawer as "Notes and history"; the board's own edits are not logged
  there. The website capture that creates leads writes the same `leads` documents.
- **Enrichment (agent-led, 10 Nov 2026)**: `functions/lead-enrich.js`. It
  replaced the website + BuiltWith lookup, which saved an enriched date but no
  data when no BuiltWith key was stored. No paid data provider is used and no
  email address is needed:
  - **Research**: an agent (Claude, `claude-opus-5-5`, with the server-side web
    search and web fetch tools, under the `ANTHROPIC_API_KEY` secret Staff
    Kanban's agent fill already uses) researches the company by name and, when
    known, website, and answers with industry, countries/markets, HQ city and
    country, store count, employees, revenue, tech stack, vendors, the LinkedIn
    company page, a short summary, a logo link, up to five recent news items
    (title, link, date, source) and the most recent financials (summary,
    period, source links and dates), plus any other facts (owner, founded…).
    The company's home page (the agent's website when none is known) is read
    directly for its description, LinkedIn link and declared icon. Without
    the key the agent reports "not set up" and only the website is read.
  - **Retail media and personalisation (11 Nov 2026)**: the same run also
    researches what the sales team needs: `retailMedia` (whether the company
    runs or is building a retail media network, its name, who powers it, its
    channels), `personalisation`, `inStoreDigital` (screens, signage, menu
    boards, kiosks and their suppliers), `loyalty`, `primaryCloud`, `estate` (sites by
    brand and by managed / leased), `strategy` (priorities, investment, cost
    pressures), `fit` (why it is or is not a prospect), `talkingPoints[]` (up
    to six openers for a first meeting or email, each tied to a finding) and
    `people[] {name, title, linkedin, note}` (up to ten senior people who own
    or influence those areas, including announced appointments, from public
    sources; they are
    shown under "Key people" and are not added as contacts). All are kept in
    the `enrichment` map on the lead and the TAM record; `primaryCloud` also
    fills the company profile when blank. `get_lead` returns them as
    `research`.
  - **The workspace (11 Nov 2026)**: an Anthropic key created for the whole
    organisation, not inside one workspace, is refused unless each request
    names the workspace ("This API key is not scoped to a workspace"). Every
    live run failed that way after the 10 Nov release, while the record still
    showed an enriched date because the home page had been read. The
    `ANTHROPIC_WORKSPACE_ID` repository secret holds that workspace's ID
    (Claude Console, Settings, Workspaces); the deploy syncs it ("unset" when
    absent) and research and Staff Kanban's agent fill send it as the
    `anthropic-workspace-id` header. A key created inside a workspace needs
    no ID.
  - **A failed run says so (11 Nov 2026)**: the run is `done` only when the
    agent answered. Otherwise `enrichment.request.status` is `error`, its
    message gives the reason and what to do (key refused, no workspace, rate
    limit or credit, timed out), and the page shows it under the button.
    What the home page gave (description, icon) is still kept.
  - **The agent call**: streamed (a research turn runs for minutes; the first
    version's unstreamed 150 s limit was too short), up to 22 searches and 10
    page reads (12,000 tokens each), the conversation cached
    (`cache_control`) so the loop's re-reads bill at the cache rate: a
    measured run fell from 0.7–1.6 million full-price input tokens to about
    0.9 million cached plus 80 thousand written, roughly a quarter of the
    cost (about one US dollar a company at November 2026 prices). Searches
    and
    fetches, a paused turn resumed up to four times within seven minutes. The
    answer's text blocks are joined as written (web-search citations split a
    sentence across blocks, and a newline between them broke the JSON). Notes
    with no readable JSON go through one short call with no tools that turns
    them into the JSON.
  - **Checking it live**: `.github/workflows/lead-enrich-probe.yml` runs the
    real agent call for one company on a runner
    (`scripts/lead-enrich-probe.js`) and lists the live functions' recent
    agent failures. Logs are public, so it prints sizes and timings only.
    Run it when enrichment is reported broken, before reading code.
  - **Checked against a real company (11 Nov 2026)**: four runs on one
    pub-company lead were graded against an independent web research pass.
    What that changed: the agent now names its `sector` from the nine
    industries itself (the free-text industry had been filed under Quick
    Service Restaurants); countries lose anything in brackets; long text is
    cut at a sentence or word, never mid-word (`clip`); the brief requires
    separate searches for competitors' media networks, for roles being hired
    and for the executive team and recent appointments, lists only people
    confirmed in role in the last eighteen months, and does not describe sold
    brands as current. Runs differ in what they find, so a refresh **merges**
    people (by name, 12) and news (by link, 10, newest first) with what was
    there, as tech stack and vendors already did. Still not reliably found
    from public sources: primary cloud, till and CRM suppliers, LinkedIn
    profiles for most people. Treat people, figures and dates as leads to
    check, not as verified.
  - **The check before research (12 Nov 2026)**: nothing is spent on
    research until the record passes a screen. Free rules first
    (`obviousSpam`: a name that isn't a name, a link, a placeholder such as
    "test", an obvious pitch, a disposable email domain), with no model call.
    Then one small call (`claudeScreen`, `claude-sonnet-5-5` at low effort,
    three searches at most) decides two things: is this a real trading
    organisation, and does it operate, license or supply media to physical
    customer-facing sites. Only "yes" to both goes on to research; "can't
    confirm" counts as no. A record that fails gets
    `enrichment.request.status: "skipped"` and `enrichment.screen {at, ok,
    real, physicalRetail, sites, reason, by}`, no enriched date, and the page
    shows the reason with the button reading **Research anyway**, which
    queues the run with `force: true` and skips the screen. A record that
    passed is not screened again. If the screen itself fails, nothing is
    researched and the record says why. Only the company name, website,
    country and the contacts' business email domains are sent, never a
    person's name or address, and the form's text is treated as data. It
    applies to automatic runs and to the button alike, on leads and TAM
    records. `lead-enrich-probe.yml`'s `screen` input tries it on named
    companies.
  - **Logos for the walkthrough demo (12 Nov 2026)**: besides the square
    icon (`enrichment.logoUrl`), each run looks for the company's full logo
    as image files: `enrichment.logos {light, dark}`, the version for light
    backgrounds and the white or reversed version for dark ones. Sources, in
    order: the links the agent saw in a fetched page (`logoLight`,
    `logoDark`: the company's own header, footer, brand or press page, or
    Wikimedia Commons; in the first real run the agent gave none, since
    it reads page text, not image tags), then the home page's own `<img>`
    tags that say "logo" and the logo its structured data declares
    (`pageLogos`; a file name saying white, light, reverse, negative or
    inverse is the dark-background one), then Wikimedia Commons' file search
    (`commonsLogos`: a file counts only when its title has every word of the
    company's name and "logo"; SVG first). `lead-enrich-probe.yml`'s `logos`
    input tries this on named companies with no model call. An address is kept only when it
    answers as an image (public addresses only); a later run that finds none
    keeps the earlier ones. They are saved on the lead and on its TAM
    record, shown on both ("Logos for the walkthrough demo", one on a light
    tile and one on a dark tile) and returned by `get_lead`. **Copied into
    the console's storage** (`keepLogos` / `storeLogo`): each logo and the
    icon is downloaded (public addresses only, image types only, 1.5 MB at
    most) and saved to Firebase Storage at `brand/<company>/<light|dark|
    icon>-<hash of the bytes>.<ext>` with a download token, and that address
    is what the record and the brand lookup carry, so a demo keeps working
    when the company moves its file. `enrichment.logoSources {light, dark,
    icon}` records where each came from. The same image is copied once: a
    refresh that finds the same source keeps the stored address. An SVG that
    carries script or event handlers is not copied, and when a copy fails
    (storage down, too big) the original address is kept instead.
    **`POST /leadIngest/v1/brand`** (the website's `X-Lead-Key`, body
    `{company, email?, country?}`) is how a walkthrough demo gets them: it
    matches the company as an inbound lead is matched (name, or the work
    email's domain, in the TAM; else a lead by name) and answers `{found,
    name, industry, logos: {light, dark, icon}, darkFromLight}`, or
    `{found: false}`. A separate dark-background file is rare (none was
    found for eight large retailers tested on 12 Nov 2026; a light one for
    five): when `dark` is empty and `light` is set, `darkFromLight` is true
    and the demo shows the light logo in white (CSS `filter: brightness(0)
    invert(1)`) or on a white tile, as the console's own dark tile does.
    A logo a person set on the company profile is used as `light`. Nothing
    else about the record is returned, test and archived leads are never
    matched, and the call is server-to-server so the list of companies never
    reaches a browser. The tour on personalisationhub.com does not call it
    yet (a PH Website ticket).
  - **A missing website is worked out (13 Nov 2026)**: with no website on
    the record, the run finds one in this order: the contacts' business email
    domain when its home page answers (free; 90), the check's own answer
    (`website`, `websiteConfidence`), then the research's. The record's
    Website is filled only when it was blank, on the lead and its TAM record,
    and `enrichment.websiteGuess {url, confidence (0-100), from, at}` says
    how sure the run is and where the address came from; the page shows
    "Found automatically, N% sure (from …)". A website a person typed is
    never replaced.
  - **The free basics when research is held back (13 Nov 2026)**: a real
    company the check holds back (no physical sites found) used to be left
    with an empty record and only the reason (a tour lead tested on 12 Nov).
    It now gets, at no research cost: its website, icon and logos (copied to
    storage), LinkedIn page, sector, and a one-line description (the check's
    `summary`, else the home page's). `enrichment.level` is `light` until a
    full run makes it `full`; the request is still `skipped`, the message
    reads "Full research was held back: … Press Research anyway to run the
    full research", and the page says "Basic profile only". Spam and
    companies the check cannot find still get nothing. `get_lead` now
    returns `research` (with `lastRun`, `check`, `level`, `websiteGuess`)
    for a lead no run has filled, so the reason a run stopped can be read.
    `lead-enrich-probe.yml`: `pipeline` runs the whole new-lead flow on an
    in-memory record with the real key; `lead_status` reports what the last
    run on a lead did.
  - **Stored logos are static PNGs (14 Nov 2026)**: the first live trial
    showed an animated logo at the top of the lead. The site's only icon was
    a 16×16 animated GIF (10 looping frames) served as `image/x-icon`, and
    the lead header and board tile used that icon. Now: every copy is
    converted to a PNG with transparency kept (`toStaticPng`, sharp: an SVG
    is drawn at up to 800 px, a GIF gives its first frame), saved as
    `brand/<company>/<kind>-<hash>.png`; a file is read for what it is, not
    what it is labelled; an animated file (`isAnimated`: a multi-frame GIF,
    an SVG with animation) is never linked as it is, so when it can't be
    converted there is no logo; a copy made before this change (`.svg`,
    `.ico`) is redone on the next run. The lead header, the board tile, the
    TAM record's header and the company profile use the full logo
    (`logos.light`) when there is one, and the icon only when there is not.
    The Prospects (TAM) grid's Company column is the reverse (19 Nov 2026,
    ticket 7WzEEYuL5VusytvpC6iO): a 20px icon left of the company name, the
    icon (`logoUrl`) first and `logos.light` only when there is no icon,
    since a full wordmark is unreadable at that size. A record with neither,
    or whose image fails to load, shows the name alone, so the column shows
    at a glance which companies enrichment found a logo for. The cell is
    redrawn on every snapshot, so an icon appears as soon as a run saves it.
  - **A lead and its TAM record carry the same information (14 Nov 2026)**:
    Convert to lead copied six company fields and left the rest on the TAM
    record (contacts, research, logos, priority, insights, notes), and the new
    lead was then researched a second time. Now, whenever the two are linked
    (a TAM record converted to a lead, a lead matched to or filed under a TAM
    record, either linked later over MCP), the function that watches both
    collections brings them into step (`linkMerge` / `syncLinked` in
    `lead-enrich.js`, run from `onEnrichWrite`): company fields fill each
    other's blanks; contacts missing on one side are added to the other
    (matched on email, else name); the research goes to the side that has
    none or an older copy (each record keeps its own run record); and the
    lead gets `tam`, a readable copy of the TAM-only fields (country,
    priority, sub-industry, HQ country, other markets, store presence, size,
    ownership, insights, decision makers, LinkedIn, AWS region, vendors,
    campaigns, source, notes), shown as "TAM record" in the lead's detail
    view and returned by `get_lead` as `tamRecord`. Editing the TAM record
    refreshes that copy. Nothing a person typed is replaced. A new record
    that already carries research after this step is not researched again.
    Test leads and network operator inquiries are left alone.
    `firestore.rules` allows `tam` (a map) on a lead so an editor's save
    keeps it. `lead-enrich-probe.yml`: `sync_lead` runs the step for a pair
    linked before it existed.
  - **What a refresh keeps (14 Nov 2026)**: a second live run on one lead
    replaced a site count dated June 2026 with one dated February 2026, and
    listed one person twice under two spellings, which pushed another off the
    list. Now the site count kept is the one whose source is dated later
    (`newerCount`: count, breakdown and source together, on the company field
    too; with no dates to compare the new run's figure stands), and people
    are matched on first initial and surname (`personKey`, `mergePeople`),
    keeping a LinkedIn link or note only the earlier entry had.
  - **Only the company's own logo (14 Nov 2026)**: a refresh stored a
    campaign graphic as a company's logo, because the first rule took the
    first image on the home page whose markup said "logo" (a home page also
    shows partners', campaigns' and awards' logos). `chooseLogos` now takes,
    in order: the logo the site declares in its structured data; an image in
    the site's header; an image elsewhere only when its file is named for the
    company and "logo" (the name without where it trades or how it is
    incorporated, `coreName`: "7-Eleven Australia" is "7eleven"). An alt text
    naming the company is not enough outside the header. Wikimedia Commons is
    then asked for the name as given and again without the country, since a
    country arm rarely has a logo file of its own. Nothing found means no
    logo, and the initials show. Logos chosen under the first rule are not
    carried forward (`enrichment.logoRule`, now 2): the next run replaces or
    removes them. An `.ico` icon is a container the image library cannot
    read, so the PNG inside it is used (`icoPng`); one holding only bitmaps
    is not copied and keeps its address. Tried on ten real sites: a logo for
    six, the right file for the two that had gone wrong.
  - **A run always finishes** (15 Nov 2026): the triggers are stopped by the
    platform after 540 seconds, the most a Firestore-triggered function may
    run. A bank's research ran past that twice; the platform killed it, so
    nothing was saved and the record said "running". The research now stops
    gathering 380 seconds after the run starts (`RESEARCH_WINDOW_MS`), and
    what it had found by then (its notes, the pages it searched and read) is
    turned into the record by one short call with no tools (`notesOf`, at
    most 70 seconds). The run's message says it ran out of time and that
    Refresh info runs it again. A run left "running" for over 10 minutes
    still counts as stale and does not block a new one. The first run after
    this (the same bank) finished in 6 min 45 s with a full profile but no
    site count and one person, so the brief now runs as **two halves at
    once** (`claudeResearchSplit`, `RESEARCH_HALVES`): the estate (the site
    count first, the breakdown, where it trades, the people; 10 searches, 5
    page reads) and the market (summary, size, logos, retail media and
    competitors, personalisation, in-store digital, loyalty, strategy, news,
    financials, facts, fit, talking points; 14 searches, 6 page reads).
    Tried on the same bank from a runner: 344 s, 561 sites, eight news
    items. Each half's own fields win when they
    are put together (`mergeHalves`); people are listed once each. When one
    half fails the other is kept and the record says some fields may be
    missing.
  - **One run per company**: a website lead for a company not yet in the TAM
    creates the TAM record and the lead together; the lead's run fills both,
    so the new TAM record does not start a second one.
  - **Logo**: the site's apple-touch-icon, else its icon, else the agent's logo
    link, else `/favicon.ico` when it is an image. Stored as
    `enrichment.logoUrl`; shown on the lead drawer and form, and on the TAM
    record's header (the profile's own logo wins when set).
  - **When it runs**: by itself when a lead or a Prospects (TAM) record is
    created (Firestore triggers `enrichLeadOnWrite` / `enrichProspectOnWrite`,
    test leads skipped), and when an editor presses **Enrich** (before the
    first run) or **Refresh info** (after it) on the lead drawer, the lead form
    or the TAM record. The button calls `POST /leadEnrich/v1/enrich`
    `{leadId}` or `{prospectId}`, which only queues the run
    (`enrichment.request {id, status: "queued", by}`, 202); the trigger runs
    it (`running` → `done` / `error`), and the page shows "Researching…" and
    then the findings through its own snapshot. A second click while a run is
    underway queues nothing; a run stuck over 10 minutes no longer blocks one.
  - **Where it writes**: the record and the record it is linked to (a lead's
    `prospectId`, a prospect's `leadId`). On a lead: `company.industry`,
    `storeCount`, `countries` (added to), `website` (when blank) and the
    `enrichment` map `{at, by, summary, logoUrl, hq, employees, revenue,
    techStack[], vendors[], linkedinCompany, news[], financials, facts[],
    sources[], filled, companyFieldsAdded, request}`. On a prospect:
    `industry` (one of the nine), `hqCountry`, `storeCount`, `linkedinUrl`,
    `website` (when blank), `markets` and `vendors` (added to), the same
    `enrichment` map, and on the company's shared profile
    (`prospectCompanies/{companyDocId}`) `summary`, `logoUrl`, `latestNews`,
    `techStack` (added to) and `lastResearchedAt`.
  - **Never blanks, never overwrites a person**: a field changes only when it
    is blank or still holds the value enrichment itself wrote last time
    (`enrichment.filled`, `filledProfile`); lists only grow; an empty answer
    keeps the earlier summary, news, financials and logo. Contacts are not
    changed.
  - Only public addresses are fetched (private, loopback and metadata
    addresses, and redirects to them, are refused); every link the agent gives
    is kept only if it is http(s). The BuiltWith key slot under Settings →
    Integrations & MCP is no longer used by enrichment.
  - Each run costs one agent call with up to 8 searches and 6 fetches; the
    triggers run at most 3 at a time, so loading the starter set enriches its
    records gradually.
- **Converting**: **Convert and link account** needs the customer account's
  name and/or id, moves the lead to Closed Won and stores `customerAccount`,
  shown on the card. The RevOps lifecycle's customer account record is not in
  this console yet, so the link is the id and name as given.
- **Website leads and test mode** (`functions/lead-ingest.js`, served at
  `POST /leadIngest/v1/submit`): personalisationhub.com's lead forms (the
  industry pages, telco and retail first) post server-to-server with the
  `X-Lead-Key` header, which must equal the `LEAD_INGEST_KEY` secret (set it
  with `firebase functions:secrets:set LEAD_INGEST_KEY`; the website holds
  the same value, never a browser). The body uses the Leads form's own names
  (`company`, `website`, `industry`, `countries`, `storeCount`, `contactName`,
  `jobTitle`, `email`, `linkedin`) plus `page`, `pageIndustry` and `test`.
  It creates the lead in the Lead lane with `source: "website"`, `sourcePage`
  and `sourceIndustry`, or, for a company already there, fills blanks and adds
  the contact (since 10 Nov 2026 "already there" means the same Prospects (TAM)
  record: see "Leads: inbound leads matched to Prospects (TAM)" below). Optional `sourceLabel` and `sourceDetail` (≤120 chars each, e.g.
  "Interactive product tour – Telco" and the demo "Personalisation") are stored
  on a new lead and fill blanks on a repeat; every submission also appends
  `{at, label, detail, page}` to `websiteActivity` (20 newest). The lead summary's
  Source shows "label · detail" and a Website activity list (newest first);
  `list_leads` returns all three. A submission with `test` true (a hidden form field the test
  link's URL parameter switches on) stores `test: true`: it is never merged
  with a real lead, is refused by Enrich, is left out of `list_leads`, and shows in the
  pipeline with a Test badge like any lead (the Leads/Test buttons and bulk
  delete were removed 6 Nov 2026: lead capture testing is finished; delete a
  test lead by hand from its summary). Leads
  send no notifications and feed no report today, so a test lead has nothing
  else to be excluded from.
- **Leads: Network operator inquiries (13 Nov 2026, tickets oed8cP8XYutjPTbQKui7,
  6b5y1gKRyX41YlEbm0V3 and LxEl9BwUwujmmz1YoE6C)**.
  The Run Your Own RMN (Run Your Own Retail Media Network) page on
  personalisationhub.com, at `/run-your-own-rmn/`, gates its product tour
  behind a form, and the people who fill it in are individuals asking about the
  network operator offer, not companies. They are their own **lead type** and
  their own pipeline, so they are never mixed with retail/company leads.
  - **Name and key (6b5y1gKRyX41YlEbm0V3)**: everything a person sees calls
    this type **Network operator inquiry** (the label, `leadTypeLabel`, the board
    chip, the lead detail's Type, MCP `list_leads`/`get_lead`), the board switch
    **Companies / Network operators**, the form **New network operator
    inquiry**, the detail's section **Network operator**, and the default source
    label **Run Your Own RMN page – product tour**. The internal names follow:
    the `leadType` key is `"operator"`, the Firestore field is `operator
    {region, background, audience, networkIndustry, message, form}`, the constants are `OPERATOR_*`, the website intake
    function is `operatorFromWebsite`, and the DOM ids and CSS classes use
    `operator`. The offer's retired name appears nowhere in `backlog-tracker/`
    (code, rules, tests, MCP text or docs). No data was migrated: no live lead of
    this type existed when the key changed (confirm at deploy that `leads` holds
    no document with another key for this type).
  - **Data** (`leads-core.js`): every lead has `leadType`, `"company"` (the
    default; a lead saved before this has none and reads as company) or
    `"operator"`. A network operator inquiry needs no company name, website or industry
    (`company.name` is ""); the person is its single contact (`name`, `email`,
    `linkedin`), and `operator {region, background, audience}` holds where they plan to
    operate (≤200 chars), their background and who they are. The background
    (`BACKGROUNDS`) is one of, in this order, `agency` (Agency media or
    account management), `adtech` (Ad-tech sales or partnerships), `retail-media`
    (Retail media), `creative-agency` (Creative agency), `retail-owner` (Retail
    business owner or manager), `marketing` (Marketing), `other` (Something
    else); a value that is none of them is stored as `other`. **"I am"
    (14 Nov 2026)** is `audience` (`AUDIENCES`): `individual` (An individual
    operator), `team` (Part of an operator team) or `retailer` (A small to
    medium retailer). It is stored as the key; a blank or unknown value is
    stored as "", and a lead saved before the field existed has none and reads
    as "" (nothing was migrated). Its stages are `OPERATOR_STAGES`:
    **Applied** (`applied`, where it starts), **Screening**, **Intro call**,
    **Approved**, **Not a fit**. `firestore.rules` → `isLead` checks the type,
    allows a blank company name only on an `operator` lead, keeps each type to its
    own stages, and limits `operator` to `region`, `background`, `audience`
    (one of the three keys, or ""), `networkIndustry` (a string ≤120),
    `message` (a string ≤1,000) and `form` (`request`, `tour` or "").
  - **Website intake** (`POST /leadIngest/v1/submit`, same key): a body with
    `lead_type` (or `leadType`) of `operator`, `network operator` or "Network
    operator inquiry" (any case; `leadTypeOf` matches the word "operator") is a
    network operator inquiry. The website sends `leadType: "operator"`. No other
    key is accepted for this type: any other value, including the offer's retired
    key, is a company lead (and `company`, which the website may fill with the
    person's name, is ignored for an operator lead). Fields: `full_name` (or `fullName`/`contactName`/`name`), `email`,
    `linkedin` (optional; a value that isn't an address is dropped, not
    refused), `operating_region` (or `operatingRegion`/`region`/`where_operate`/
    `location`), `background` (a key above or the form's label), `audience`
    ("I am": a key above or the form's label, any case; the website sends the
    label), `lead_source`
    (stored as `sourceLabel`; "Run Your Own RMN page – product tour" when not sent),
    `page` and `test`. `source` is `website`; each submission adds to
    `websiteActivity`. A name or an email is required and a bad email is a 400.
    It never reads or writes Prospects (TAM), is never routed to the AWS record,
    is never matched to a company lead, and is never enriched (the trigger skips
    it; the Enrich route refuses it). The same email again (same test flag) is
    the same person: their lead's inbound count and activity grow and blank
    region/background/audience are filled. **The website side** posts these fields from
    the Run Your Own RMN page's gate (PH Website project, `ph-website/`); the console
    accepts them as named above.
  - **Board**: a **Companies / Network operators** switch above the board
    (with counts; remembered per browser in `localStorage` `bt-leads-type`) shows
    one pipeline at a time with its own lanes. A network operator card shows the
    person, a "Network operator inquiry" chip, I am · region · industry they want to run · background (each
    only when given) and the source;
    its summary shows the person, Network operator (I am, region, industry they want to run, background, message), Lead
    (type, stage, assignee, source, source page, dates), website activity and
    history, with no company, AWS team or research, and no Enrich button. New lead
    on that view opens the form as **New network operator inquiry**: the
    person's full name, email and LinkedIn, "I am" (a select: Not given or one
    of the three options), where they plan to operate,
    background and the pipeline; no company fields, research or customer account.
  - **MCP** (`functions/leads.js`): `list_leads` and `get_lead` return
    `leadType`, `leadTypeLabel`, `name` (the company, or the person),
    `region`, `background`, `backgroundLabel`, `audience` and `audienceLabel`
    (both null when not given, and on a company lead) alongside `source` /
    `sourceLabel`; `list_leads` takes a `leadType` filter and an `audience`
    filter (`individual`, `team` or `retailer`). `create_lead(s)` take
    `leadType: "operator"` with the person as the only contact plus `region`,
    `background` and `audience` (no company needed); `update_lead` edits region,
    background and audience but refuses a type change; `update_lead_stage` accepts only the
    lead's own pipeline's stages; `get_lead`/the others find a network operator inquiry by
    the person's name; `link_lead_customer_account` and `link_lead_prospect`
    refuse a network operator inquiry.
  - **Industry they want to run and their message (15 Nov 2026, ticket
    hnHZrt9GT1SaGBb6NI1a)**. The Run Your Own RMN page's **Request further
    information** form asks for "Industry you want to run your network in"
    (required on the site) and an optional message; the FAQ promises an
    information pack for that industry and then a 20-minute call. The website
    sends them as `network_industry` and `message`, with `form: "request"` (the
    product tour gate sends `form: "tour"`).
    - **Data**: `operator.networkIndustry` is free text, ≤120 characters (the
      site sends one of its twelve industries or "Other: <text>");
      `operator.message` is ≤1,000 characters (longer is cut, not refused);
      `operator.form` is `request`, `tour` or "" (anything else is stored as "").
      Older leads have none of the three: nothing is migrated and
      `normaliseLead` reads each as "".
    - **Intake** (`operatorFromWebsite`): reads `network_industry` (or
      `networkIndustry`), `message` and `form`. On a repeat submission from the
      same email, a new industry replaces the stored one (a blank one is filled;
      a submission without one leaves it), `form` follows the newest submission
      that sends one, and a new message never overwrites the first: when the lead
      already has a different message, the new one is added to its history as a
      note by `website`, "Website message (YYYY-MM-DD): …". A lead with no
      message yet takes the new one as its message.
    - **Board**: the operator card's line reads I am · region · industry they
      want to run · background, skipping blanks (`companyLine`). The summary's
      Network operator section adds **Industry they want to run** (after
      region) and **Message** (last, as a stacked row, only when there is one).
      The New network operator inquiry form (and its edit) has an **Industry
      they want to run** text field (≤120); the message and form have no input
      and an edit keeps them. Built from the existing `ap-row` field and
      `stackRow`, no new components.
    - **MCP**: `list_leads` and `get_lead` return `networkIndustry`, `message`
      and `form` on operator leads (null when blank; absent on company leads);
      `list_leads` takes an optional `networkIndustry` filter (case-insensitive
      contains; only operator leads match) and its `q` also searches both;
      `create_lead(s)` and `update_lead` accept `networkIndustry` and
      `message`.
    - Either side can ship first: the console ignores fields it doesn't know,
      and an older console ignores these.
  - Tests: `test/lead-ingest.test.js` (every background, blank LinkedIn, AWS
    address, repeat person, industry and message on first and repeat
    submissions and the 1,000-character cut, company leads unchanged, the MCP
    views and filters),
    `test/lead-enrich.test.js` (never researched), the network operator cases in
    `test/firestore-rules.test.js`, and the "network operator inquiries" scenario in
    `test/ui/console-click.test.mjs`.
- Tests: `test/leads.test.mjs`, `test/lead-enrich.test.js` (the agent stubbed), the "company research" scenario in `test/ui/console-click.test.mjs`, `test/lead-ingest.test.js`, the Leads tools in
  `test/mcp-server.test.js` and `test/mcp-client.test.mjs`, a scenario in
  `test/ui/console-click.test.mjs`.

## Promote section: Prospects (TAM) (5 Nov 2026)

- **Promote › Prospects (TAM)** (`#promote/prospects`, nav item directly below
  Leads) is the global prospects database: every possible target company for
  Personalisation Hub, in one filterable AG Grid, so the team can size the
  market, find targets and turn them into leads. It is its own permission
  section, `prospects` (User Management › Roles): No access hides the nav
  entry and blocks the route; View hides the checkboxes, **Convert to lead** and
  Set status; roles saved before it existed keep Edit.
- **Data** (one record per company per country, 6 Nov 2026): `prospects/{id}` =
  `name` and `country` (both required; the country this record covers),
  `website`, `industry` (category), `subIndustry` (sub-category), `hqCountry`
  (the head-office country), `markets[]` (other countries operated in; the HQ
  country is always included), `awsRegion` (derived from `country`, falling
  back to `hqCountry`), `storeCount`, `storePresence` (the count as written,
  e.g. "100+ stores" or "~2,800"; `storeCount` is parsed from it when none is
  sent), `sizeBand` (unknown / small 1-49 / mid 50-249 / large 250-999 /
  enterprise 1,000+, derived from the store count), `ownership`, `priority`
  (high, medium or low), `insights` (up to 2000 characters), `decisionMakers`
  (target roles, text), `linkedinUrl` (normalised to
  `https://www.linkedin.com/company/<slug>/`; only `/company/` or `/showcase/`
  URLs are accepted, search and profile URLs are rejected), `linkedinOrgId`
  (digits only), `linkedinVerified`, `contacts[]` (up to 30 of `{name, role,
  lastContact}`, text only), `vendors[]`, `campaigns[]`, `status` (new,
  researching, targeted, engaged, converted, disqualified), `leadId`, `source`,
  `notes` and the usual stamps. **"The same prospect" is the same company
  (name matched ignoring case and punctuation) in the same country, read from
  the fields, never the doc id**: ALDI is three records (ALDI · Australia,
  ALDI · Netherlands, ALDI · Germany). New docs get the id
  `slugId(name)-slugId(country)`; existing docs keep theirs, and a doc without
  `country` reads as its first market (then `hqCountry`). Nothing is deleted
  or reseeded: the target lists are re-imported by an agent over MCP. Rules:
  `prospects-core.js`, copied to `functions/prospects-core.js` by
  `node test/prospects-core-copy.mjs --write`. Members read; editors write
  (`firestore.rules` → `isProspect`: size limits on every text field, priority
  in the list, `linkedinUrl` a LinkedIn company or showcase page,
  `linkedinOrgId` digits, `contacts` at most 30; a new record must name its
  country, older ones without one still update).
- **Grid** (6 Nov 2026): the same AG Grid pattern as User Management › Users
  (`ag-theme-alpine um-grid`; **one header row** (8 Nov 2026): each filterable
  column's heading is its filter, with the column name as the placeholder (no
  separate "Company" label, no floating-filter row, no header menu, so no
  duplicate filters), plus a sort button; header height 44, row height 48; pagination 25/50/100/250 at the bottom). The count
  ("129 Prospects", or "N of 129 Prospects" when filtered) sits above the grid
  with Saved filters, Columns, Export CSV and **Export for LinkedIn** on the
  right. **There is no separate search box: all filtering is in the column
  headings** (Company's heading is its search box), the pick-lists (Country,
  Industry, Priority, Status, AWS region, Size band) are tick-box lists with a
  Clear button once something is ticked (never toggles), and every text and
  number filter shows a small clear (×) button once it has a value;
  clicking it clears that column's filter and the count updates. Shown by
  default: Company, Country, Industry, Priority, Stores, LinkedIn (an icon link
  to the company page, or empty), Status, then the ⋯ menu. Hidden by default
  (Columns chooser): Sub-industry, HQ country, AWS region, Size band, Store
  presence, Ownership, Insights (truncated, full text in a tooltip), Decision
  makers, Contacts (count), Source, Current vendors, Campaigns. Priority, Size
  band, AWS region and Status filter as dropdowns. Long values truncate with a
  tooltip. At 1280 px the default columns fit without horizontal scrolling.
  **Clicking a company name opens a right-hand drawer** (like the Leads summary
  drawer) showing every field, the contacts table and the insights; editors
  change Priority there directly (saved on change) and use Edit for the rest
  (contacts one per line as `name | role | last contact`; a search URL in the
  LinkedIn field or letters in the organisation id are refused; changing the
  company or country to one that already exists is refused). **Saved filters**
  (named; the grid's filter model and sort; kept in the browser) are saved,
  applied and deleted from one menu. **Export CSV** exports the rows the
  filters match (cells that start like a formula are prefixed so a spreadsheet
  shows text). **Export for LinkedIn** exports the selected rows, or with none
  selected the filtered rows, as a CSV in LinkedIn Campaign Manager's Matched
  Audiences company list format: `companyname, companywebsite,
  companyemaildomain, linkedincompanypageurl, stocksymbol, industry, city,
  state, companycountry, zipcode` (blank where unknown; `companycountry` is the
  record's country; the email domain is the website's host). Editors also get a
  checkbox column (header box selects the page) and, with rows selected, a bulk
  bar: **Set status** and **Export selected**. **Convert to lead appears only in
  a row's pinned-right "⋯" menu** (no button in the row, none in the bulk bar),
  which also has View lead, Set status, Open details and Open website. The
  Converted status is set only by Convert to lead, so it is not offered under
  Set status. View-only roles get no checkboxes, no Convert, no Set status and
  no editing in the drawer. Help is an info tooltip beside the title; there is
  no explanatory copy under the grid.
- **Convert to lead**: writes one Leads card (stage Lead, source "Prospects
  (TAM)", assigned to the person, `prospectId` on the lead) whose id is derived
  from the prospect (`prospect-<id>`), sets the prospect's `leadId` and status
  Converted, and the row then offers **View lead**. One lead per record: a
  company in three countries converts to up to three leads, each covering its
  own country. Converting twice, or from
  two tabs, writes the same lead: a prospect can never become two leads. The
  lead's summary drawer shows a Prospect record link back.
- **Company research (10 Nov 2026)**: every record is researched by an agent
  when it is created, and the company detail view has **Enrich** (before the
  first run) / **Refresh info** (after it) for editors. The Profile tab's
  **Company research** card shows the findings (summary, HQ, size, tech stack
  and vendors, recent news and recent financials with links and dates, when it
  was updated), and the header shows the logo. The record keeps them in an
  `enrichment` map (allowed by `isProspect` in `firestore.rules`). See
  "Promote section: Leads" → "Enrichment (agent-led)" for what is written where.
- **Data in**: the empty page offers **Load starter set** (editors): about 60
  well-known retail and related operators worldwide (`prospects-seed.js`),
  store counts rounded public figures marked source "Starter set
  (approximate)". It is a start, not a verified dataset; vendors and campaigns
  start blank. Loading twice adds nothing. Agents add and enrich companies over
  MCP: `list_prospects` (all filters, including `country` and `priority`;
  returns every field) and `upsert_prospects` (up to 50 per call, accepts all the
  fields above, matched on name + country or on `id`, a country is required to
  add a record, only the fields sent change, nothing deleted; it cannot set
  `leadId` or convert). The starter set loads one record per company in its
  head-office country.
- Tests: `test/prospects.test.mjs`, the Prospects tools in
  `test/mcp-server.test.js` and `test/mcp-client.test.mjs`,
  `test/permissions.test.mjs`, `test/promote-section.test.mjs`, a scenario in
  `test/ui/console-click.test.mjs`.

## AWS Partner Central connection

The console backend can securely call AWS Partner Central (Selling API for ACE
opportunities, Benefits API for funding drafts) with no long-lived AWS keys.

- Keyless: Google OIDC -> `AssumeRoleWithWebIdentity` -> short-lived credentials; the IAM role is code in `deploy/aws/partner-central-role.yaml`, least privilege (AWS-managed opportunity policy; benefits create/update only, submit denied).
- Wrappers: list/get/create/update opportunity; create draft benefit application only, never submit.
- Sandbox catalogue by default; the live AWS catalogue only by an explicit admin `LIVE` confirmation.
- Settings shows connected / not linked yet / error, the catalogue, the last successful call and an audit log of every call (`partnerCentralAudit`); CloudTrail records the AWS side.
- Dependency (manual): link the Partner Central account to the AWS account and map the role to a Partner Central user role.
- **ACE opportunities table (Promote › Leads, 6 Nov 2026)**: under the leads board, `#ace-section` lists PH's AWS ACE opportunities laid out like Partner Central's opportunities list: opportunity, customer, ACE stage, review status, opportunity score, expected monthly AWS revenue, target close date and AWS account manager (with a mailto icon, subject "<opportunity> – <customer>"). A summary block counts rows by ACE stage and by review status. Each row opens the matching lead card (customer name = lead company name) and the opportunity in Partner Central. Rows come from `GET /partnerCentral/v1/ace` (list + per-opportunity detail through the Selling API, normalised in `normaliseOpportunity`, cached 60 s); that one read route is open to editors and admins, every write stays admin only. Rules in `public/js/ace-core.js`; tests `test/ace.test.mjs`, `test/partner-central.test.js`. **Restyled as the PH list page (7 Nov 2026)**: title row like the other list pages: "AWS ACE opportunities", ONE count pill (`5`, with a muted `Sandbox` flag on the Sandbox catalogue, `first 100 shown` when truncated) and a Refresh text button (`refresh` icon) on the right, no divider (8 Nov 2026: the count was shown three times, as "5 Opportunities", an Opportunities KPI and a "Prospect 5" stage pill, so the Opportunities KPI and the stage pills were removed); three KPI cards in one row: Expected monthly AWS revenue (one figure per currency), Approved, Needs action (Action Required + Rejected). The table is an AG Grid (`ag-theme-alpine um-grid`, `public/js/ace-grid.js`, lazy loader from `docs-grid.js`; 40px header and floating filter row, 42px rows, no checkbox column, pagination of **50** only above 50 rows, auto height so the page scrolls, not the grid; the ACE stage and Review status select filters list every value, not only those present). Columns: Opportunity (one line, ellipsis, full title in a tooltip, teal link to Partner Central in a new tab, pinned left on phones), Customer, ACE stage (pill, select filter), Review status (dot: green Approved; amber Pending Submission/Submitted/In review; red Action Required/Rejected; select filter), Score (hidden when no row has one), Monthly AWS revenue, Target close date (past dates in the error colour with the tooltip "Past target close date"), AWS account manager (name + email icon; "Not assigned" muted), Lead ("Lead card" link or muted "No lead"), and a pinned-right ⋯ menu (View in Partner Central, Email AWS account manager, Open lead card; unavailable items are hidden). The row menu button is `.ace-manage`, not `.um-manage`, which `permissions.js` hides for people without User Management edit rights. States: grid loading overlay; empty state (`handshake` icon, "No ACE opportunities yet."); error or 403 as an alert with Retry. Works in light and dark (text contrast ≥ 4.5:1) with no horizontal page overflow at 375px. Pure rules (`kpis`, `reviewTone`, `isPastDate`) are in `ace-core.js`.
- **ACE opportunities managed in the console (7 Nov 2026)**: an opportunity is viewed and managed inside the console, never by a link out to AWS. Columns now read **Customer, Opportunity, Score, ACE stage, Review status, Monthly AWS revenue, Expected delivery date (the ACE target close date), Created, Last updated, AWS account manager, Lead**; Score is always shown, directly right of the Opportunity column (8 Nov 2026). The grid (`.ace-grid`) has 12px padding inside its own grey border, so the header row, filters and ⋯ buttons do not sit on the boundary. The opportunity name is a button that opens the detail dialog (`public/js/ace-detail.js`, shell `#ace-backdrop`; also the first item of the ⋯ menu): every table value is editable except the ones AWS owns (Review status, Score, the dates it stamps, the AWS account manager, which are shown read-only), plus Next steps, Customer business problem and website. **Save to ACE** sends only the changed fields to `PATCH /partnerCentral/v1/ace/{id}`; the server reads the opportunity, overlays the changes and sends `UpdateOpportunity` (read-merge-write, read-only parts not sent back), drops the table cache and answers with the opportunity re-read from AWS, so the status line says "Saved to AWS ACE. Score N." and the table row updates with the refreshed score. **New opportunity** (header button, editors) opens the same dialog empty; an empty save says "Enter a title and customer."; **Create in ACE** posts `POST /partnerCentral/v1/ace` (title and customer required, created as Prospect). `GET /partnerCentral/v1/ace/{id}` returns one opportunity; all three `/v1/ace` routes are open to editors and admins (the older `/v1/opportunities` routes stay admin only) and still use only the closed `OPERATIONS` list. **Documents**: the dialog lists, attaches (PDF, Office, image or zip, up to 50 MB; checked in `checkDocument`) and removes files, with a download link each, in Firebase Storage `ace/{opportunityId}/{timestamp}-{name}` (`storage.rules`, editors; `public/js/ace-docs.js`). The Selling API cannot attach files, so documents stay in the console and are not sent to AWS. Limits: the UpdateOpportunity/CreateOpportunity payloads and the end-to-end run against the Sandbox catalogue (create, attach, edit, see it in Partner Central, score refresh) are untested live until the Partner Central role link works (`deploy/aws/README.md`). Tests: `test/ace.test.mjs`, `test/partner-central.test.js`, `test/ui/console-click.test.mjs` (dialog scenario).

### Prospects (TAM): company detail view (6 Nov 2026)

- A company name in the Prospects grid is a button that opens that company's
  detail view in place (the grid hides; **All prospects** returns). The row
  "⋯" menu has **Open company profile** too. A lead's company has the same
  detail (the lead card finds it by the company name's key).
- Four tabs (`public/js/prospect-detail.js`, rules in
  `public/js/prospect-detail-core.js`, tests `test/prospect-detail.test.mjs`
  and the Prospects scenario in `test/ui/console-click.test.mjs`):
  **Profile** (summary, logo, industry, markets, tech stack, existing vendors
  = the grid's `vendors`, primary cloud, email formats, likely products, latest
  news, staff owner, last researched); **Org chart** (collapsible reporting
  tree, a card per person with photo or initials, name, title and a buying-role
  badge: decision maker, champion, influencer, technical evaluator,
  procurement); **AWS account team** (role, role on the deal, one-click
  `mailto:` icon, which customer contacts each person engages); **Documents**
  (industry one-pager, prospect pack, deck, business case, funding document:
  versioned, dated, tagged, with who it was shared with and a "Shared with
  AWS" flag; earlier versions are folded under the current one).
- **Lead overlay**: a person whose email matches a contact on the linked lead
  is highlighted as a **Lead contact**; engagement (demo, calculator download,
  website form, meeting) is recorded on the person, and "Demo" is added when
  the lead is at the Demo stage or later. Gaps are flagged ("No decision maker
  engaged yet").
- **Data: the company's detail is stored once per company, not per country.**
  Prospects are one record per company per country (ALDI · Australia, ALDI ·
  Netherlands), but the org chart, the AWS account team, the ACE opportunity
  and the document library belong to the company. They live in
  `prospectCompanies/{companyKey(name)}` (the name's lower-case letters and
  digits, cut at 60: `aldi`) as `{ name, profile, people[] (up to 100),
  awsTeam[] (30), aceOpportunity ({id, sellerName, sellerEmail} or null),
  documents[] (100) }`, and every country record of that company, and its
  lead's card, reads and writes that one document, so ALDI · Australia and
  ALDI · Netherlands show the same org chart. The country record keeps its own
  fields (country, status, priority, stores, contacts, insights, vendors,
  AWS account ID). `firestore.rules` `isProspectCompany`: members read,
  editors write, the id must match `^[a-z0-9]{1,60}$`, unknown fields are
  refused. The profile says when the detail is shared. A name with no letters
  or digits has no key and cannot hold detail.
- **AWS account ID** (Rob, 6 Nov 2026): `awsAccountId`, exactly 12 digits,
  optional ("1234-5678-9012" is tidied to digits), on the prospect record, on
  each contact of a prospect, on the lead's company, on each lead contact and
  on each person in the org chart. Editable in the prospect's All fields
  drawer and Edit profile, the lead form and the Add person form; shown in the
  profile, the lead summary and the org chart cards; a column in the CSV export;
  carried onto a lead when a prospect is converted. Validated by
  `normaliseAwsAccountId` (page, MCP `upsert_prospects` and `list_prospects`)
  and by `firestore.rules` for the prospect, the lead's company and the first
  ten entries of a lead's contacts and of an org chart's people (rules cannot
  loop and 1000 expressions are the ceiling per request, measured: an org chart
  of 20 people checked in full already exhausts it), with
  `test/firestore-rules.test.js` covering each.
- **ACE**: the opportunity's seller is shown as the AWS account manager
  ("From the ACE opportunity"); a manual row with the same email wins. Until
  the ACE opportunities sync writes `aceOpportunity`, an editor sets the seller
  in Edit profile.
- **Lead card**: a lead whose company has detail shows a compact block: buying-role
  counts, the first gap, and up to four AWS contacts with email icons.
- Not done: MCP tools for the company detail (`upsert_prospects` writes the grid
  fields and the AWS account ID only and leaves `prospectCompanies` untouched).

### Prospects (TAM): filters, industry taxonomy and pinned header (7 Nov 2026)

- **Whole-page scroll, pinned header (8 Nov 2026).** The grid is `domLayout:
  "autoHeight"`, so all rows of the page (50 by default; selector
  25/50/100/250) are on the page and the document scrolls, with no inner scroll
  area. The grid's column header and filter row (`.ag-header`) are
  `position: sticky` under the console header (`--sticky-topbar-h`); the grid's
  `overflow` ancestors are set to `visible` so the page is the sticky container.
  This replaces the 7 Nov viewport-tall flex page. Checked in
  `test/ui/console-click.test.mjs`.
- **One filter pattern for every primary column** (Country, Industry, Priority,
  Status, AWS region, Size band): a searchable multi-select (`ListFilter` in
  `prospects-page.js`) with the complete option list, a search box that narrows
  it, ticks, a Clear button and Escape to close. Styled with the console's
  tokens (6px radius, 13px, `--primary`). Country lists every country
  (`COUNTRIES`, plus any odd value already in the data; UK/USA/UAE fold into
  the list's spelling). A saved filter in the old shapes (`{value}` or a text
  filter) still loads.
- **Industry taxonomy** is the nine industries on
  personalisationhub.com/industries/ (6 Nov 2026), in site order, display name
  stored, slug the stable key: Fuel & Convenience, Pubs & Hospitality, Telco
  Retail, Pharmacy, Retail Media, Grocery & Supermarkets, Fashion & Department
  Stores, Quick Service Restaurants, Banking, plus **Unassigned** (blank) in the
  filter. `normaliseIndustry` (`prospects-core.js`, copied to
  `functions/prospects-core.js`) maps older wording to one of the nine and
  anything that fits none (Electronics, Home improvement, Sports, Beauty…) to
  blank, never a new industry. It runs on read (`normaliseProspect`), on every
  write (`prospectFromInput`, so `upsert_prospects`) and on the industry filter
  of `list_prospects`. Stored legacy values are rewritten when a record is next saved.

### Prospects (TAM): Contacts tab and the LinkedIn extension (17 Nov 2026)

Ticket OGwD3FC6iThTwMpsCKic. Companies and contacts, the usual CRM model.

- **Two tabs** under the page title: **Companies** (`#promote/prospects`, the grid,
  drawer and detail view above, unchanged) and **Contacts**
  (`#promote/prospects?tab=contacts`). The same `prospects` permission section
  covers both.
- **Data**: `prospectContacts/{id}` = `name` (required), `role` (the role or LinkedIn
  headline), `companyName`, `prospectId` and `companyKey` (the TAM record and its
  company key; both empty = **Unmatched**), `linkedinUrl` (a person's profile,
  normalised to `https://www.linkedin.com/in/<slug>/`; company pages and searches
  are refused), `email`, `notes`, `lastContact`, `source` (TAM spreadsheet, Added by
  hand, LinkedIn URL, Chrome extension), `removed`, and the usual stamps. **One
  person, one record**: a contact with a profile is stored under `li-<slug>`, and
  an add is matched to an existing contact by the profile URL, else (for a contact
  with no profile yet) by the same name at the same company; a match is updated,
  never duplicated. Removing a contact sets `removed: true` and keeps the record.
  Rules: `public/js/prospect-contacts-core.js`; `firestore.rules` →
  `isProspectContact` (members read, editors write, unknown fields refused, the id
  `^[A-Za-z0-9_-]{1,220}$`, the URL a profile URL).
- **The list**: an AG Grid like the Companies grid (`ag-theme-alpine um-grid`, 50
  rows a page, whole-page scroll). Columns: Name (opens the contact), Role,
  Company (opens the company's detail on its Contacts tab; an unmatched contact
  shows an **Unmatched** pill and the company as written), LinkedIn (an icon link to
  the profile), Added (newest first). Every column sorts. Above it: the count
  ("12 Contacts", "3 of 12 Contacts"), a search box (name, role, company, email), a
  company filter (All companies, **Unmatched**, then each company with contacts),
  **Add from URL** and **Add contact** (editors).
- **The company record shows its contacts**: the company detail view has a
  **Contacts** tab (Profile, Contacts, Org chart, AWS account team, Documents)
  listing that company's contacts (every country record of a company shares them,
  by company key) with LinkedIn and email links, **Add contact** (company
  preselected) and each name opening the contact.
- **Initial seed: the TAM spreadsheet.** Its contacts were imported onto the
  company records (`prospects/{id}.contacts[]`, 361 people on 146 records on 17
  Nov 2026). They are copied into `prospectContacts` under
  `tam-<prospectId>-<name key>`, matched to that record, the first time an editor
  opens Prospects (TAM), and any added to a record later are copied the next time;
  ids already there (removed ones included) are skipped, so nothing is copied
  twice or brought back.
- **Adding later**: (1) **Add contact**: name, role, company (a TAM company, or
  Unmatched), LinkedIn URL, email, notes. (2) **Add from URL**: a pasted profile
  URL opens the same form with the link saved and the name guessed from it, to
  confirm the company and role; a URL already on file opens that contact. (3) the
  **Chrome extension** (`chrome-extension/`, loaded unpacked; only the account
  owner installs it): on a LinkedIn profile, one click reads the name, headline,
  current company and profile URL from the page (`linkedin-reader.js`) and hands
  them to a signed-in console tab (an open one is reused, else one opens behind)
  by calling `window.__phAddProspectContact`, which `prospects-page.js` defines. The
  console saves it with that person's own sign-in and permissions, matched to a
  TAM company by name (exact, without legal or filler words such as PLC, Ltd,
  Group, Retail, or one name inside the other; of several country records, the
  head-office one), else Unmatched; clicking again on the same profile updates
  the contact. An existing contact keeps a company someone linked by hand. One
  profile per click, only on a click: no background or bulk reading, no
  scrolling or opening other pages (LinkedIn's terms). The extension holds no
  credential; its permissions are `activeTab`, `scripting` and the console's two
  addresses. A green ✓ and a note on the LinkedIn page say Added / Updated and the
  company; a red ! says why not (not a profile, console not signed in, view-only role).
- Not done: MCP tools for contacts (agents still see the record's own
  `contacts[]` through `list_prospects` / `upsert_prospects`).
- Tests: `test/prospect-contacts.test.mjs` (the rules, the import, matching,
  dedupe, the extension's reader on saved markup and its manifest) and the
  Contacts scenario in `test/ui/console-click.test.mjs`.

### Leads: Apple-style board, form and detail view (10 Nov 2026)

Ticket iAY4X9RF5K16vLEGYswi applies the console's design rules 1-11 (ticket
5TbkrO71BsFoaKiclUvO) to Promote › Leads as markup and layout changes, not an
overlay. Presentation only: every field, action and datum is still there.

- **Board**: no sideways scroll at any width. The lanes wrap (container query on
  `.leads-board-wrap`: 6 across from 1100px of board, 3 from 760, 2 from 560, else
  1). Lanes are neutral (no coloured top borders; an uppercase title and a count
  pill); tiles are white inset cards on an 8pt grid: logo (or initials) and name,
  the industry chip (neutral, the industry's colour only on its dot), the inbound
  pill, a one-line company line, the account summary (buying roles as plain text,
  the first gap, the AWS team's names) and assignee and source. A tile holds no
  links: emailing the AWS team is done from the detail view. **New lead** is the
  one primary action (top right; on a phone, sticky at the bottom above the tab
  bar); the ACE section's New opportunity is a secondary button and its KPI icons
  are neutral. The page title carries an (i) with what the page does. Empty
  state: one line, "No leads yet", and a New lead action.
- **AWS tile**: one inset grouped disclosure row (AWS, count, chevron); each
  person a row with an email button and Attach to account; the attach form is
  rows. Its status line is a status, never turned into an (i).
- **Detail view** (`#lead-summary-panel`): header with the company logo (56px,
  initials when there is none), name, company line and industry chip; then inset
  grouped cards in this order: **Contacts** (inbound count beside the title; each
  contact a row with role pill, job title, email, and 44px email and LinkedIn
  buttons — the LinkedIn button shows LinkedIn's own "in" mark in LinkedIn blue
  (`linkedinLink` in `ap-components.js`, an inline SVG because Material Symbols
  has no brand logos; 17 Nov 2026), never a generic open-in-new-tab symbol, and
  opens the profile in a new tab; "No contacts yet" with Add contact), **AWS team** (the company's
  `awsTeam` plus the ACE seller, each with an email button), **Company research**
  (summary, facts, LinkedIn, tech stack, Updated with the sources in its (i);
  a failed source stays visible), **Recent news**, **Recent financials · period**
  (the three inside `#lead-sum-research`), then **Lead** (Stage select, assignee,
  inbound, source, created/updated, customer account), **Company**, TAM record,
  Prospect record, Website activity, Notes and history. Links use the accent.
  Actions: Delete (red text, left), Refresh info, Edit (primary). A bottom sheet
  on a phone, a right-hand drawer otherwise; both open with a short transition.
- **Form**: a sheet of grouped rows (label left, field right, 44px rows):
  Company, one card per contact (Remove contact in red at its foot), Add contact,
  Pipeline, then for a saved lead the research cards with Enrich / Refresh info,
  and Customer account (Linked account as a value row, then the convert rows).
  Save stays off until something changes (modal-polish.js). The form's Delete
  asks to confirm on its own button (it used to arm the drawer's).
- **Shared components**: `public/js/ap-components.js` (`group`, `row`,
  `stackRow`, `lineRow`, `iconLink`, `pill`, `tip`) with the styles in
  `css/apple.css` → "Inset grouped cards and rows" (`.ap-group`, `.ap-row`,
  `.ap-row-btn`, `.ap-icon-btn`, `.ap-pill`, `.ap-status`, `.ap-empty`,
  `.ap-field`). Any page may build from them.
- Light and dark (`data-theme="dark"`), reduced motion respected, 44px targets.
  Test: `test/ui/leads-apple.test.mjs` at 390/820/1180/1440 px in both themes.

### Leads: inbound leads matched to Prospects (TAM), one lead per company per country, AWS as its own record (10 Nov 2026)

- **Matching.** A lead that comes in (the website form, `functions/lead-ingest.js`,
  or **+ New lead** on the Leads page) is matched to a Prospects (TAM) record using
  both the company name (`companyKey`, ignoring case and punctuation) and the
  contact's **business** email domain (personal mailboxes such as gmail.com are
  ignored), against the record's name and website host (a subdomain counts:
  `uk.acme.com` matches `acme.com`). A name and domain match beats a domain-only
  match, which beats a name-only match. The lead's country (its first country) picks
  that country's record; with no country, the best match in any country is used
  (a record that already has a lead first, then the head-office country's record).
  Rules: `planInbound` / `matchProspect` in `public/js/prospects-core.js` (copied to
  `functions/prospects-core.js`).
- **No match**: a new TAM record is created for that company in that country (no
  country when none was given), source "Inbound lead", copying the website,
  industry, HQ country and markets from the company's record in another country when
  there is one. Creating it starts enrichment (`enrichProspectOnWrite`, which runs
  for every new TAM record; see "Promote section: Leads" → Enrichment). It is linked to the lead.
- **One lead per company per country.** The lead belongs to its TAM record
  (`prospectId`; the record's `leadId`, status Converted, as Convert to lead does). A
  new lead gets the id `prospect-<recordId>`, the same as Convert to lead, so the two
  can never make two leads. A lead from before this change for the same company and
  country (no `prospectId`) is adopted rather than duplicated.
- **The next person from the same company and country is added as a contact** on
  that lead (not twice: same email, else same name), blank company fields are
  filled, and the lead's **`inboundCount`** goes up by one. The card and the lead
  summary show it ("2 inbound"). A lead saved before the count existed shows its
  number of website submissions. From the New lead form, the person is added to the
  existing lead and its summary opens saying so.
- **AWS.** AWS is a TAM record of its own (`prospects/aws`, name "AWS", source
  "AWS", no country). Anyone with an AWS or Amazon address (aws.com, amazon.com,
  amazon.co.uk, amazon.de…), or a company named AWS / Amazon Web Services, lands as a
  contact on that record (`{name, role, lastContact, email}`; the same email again
  refreshes it; the newest 30 kept), never as a customer lead. The **AWS tile** above
  the Leads lanes lists them; an editor uses **Attach to account** to pick a customer
  company (any TAM record or lead) and an AWS role, which adds the person to that
  company's AWS account team (`prospectCompanies/{companyKey}.awsTeam`, source
  manual; `withAwsPerson` in `prospect-detail-core.js`), shown on the company detail's
  AWS account team tab and the lead card. Attaching the same person again changes
  only their role. The website form is the same for everyone.
- **Prospect contacts carry an email** (optional; the Edit drawer's contacts line is
  `name | role | last contact | AWS account ID | email`), so an AWS person keeps an
  address to be attached with.
- Test leads (`test: true`) are never matched to a TAM record or a real lead.
- Rules: `isLead` allows `inboundCount` (a whole number ≥ 0); a new record may be created without a
  country only when its source is "Inbound lead" or "AWS". Cases in
  `test/firestore-rules.test.js`.
- Not done: the MCP tools (`create_lead`, `upsert_prospects`) do not match or group;
  they behave as before.
- Tests: `test/lead-ingest.test.js` (the five test steps against the website
  endpoint), `test/prospects.test.mjs` (matching and planning), `test/leads.test.mjs`
  (`mergeInbound`), `test/prospect-detail.test.mjs` (`withAwsPerson`), a scenario in
  `test/ui/console-click.test.mjs`.

## Promote section: Conversion Funnel (9 Nov 2026)

- **Promote › Conversion Funnel** (`#promote/conversion-funnel`, nav item directly
  below Prospects (TAM); `public/js/funnel-page.js`, rules in `funnel-core.js`,
  tests `test/funnel.test.mjs` and the "Conversion Funnel" click-through
  scenario). Its own permission section (`conversion-funnel`, inherits
  Prospects (TAM)), read-only.
- **Nine stages, top to bottom:** ad impressions, click-throughs (Google Ads);
  site visits, demo requests, calculator / model downloads (GA4); ACE
  opportunities created, open, closed (won or lost); deployed (Launched). Each
  row shows the count, the % of the previous stage, the % of the top, and a
  funnel bar. "Closed" is measured against "created" (an opportunity leaves
  "open" when it closes), and its tooltip says so. Counts recalculate live as
  any filter changes; no explanatory copy on the page, only info tooltips.
- **Filters (all combinable):** date range (local calendar days, quick ranges)
  with **Compare to previous period** (same number of days straight before; per
  stage the previous count, the change and the change in percentage points),
  industry, channel / source (Google Ads, Organic, Direct, Referral, AWS
  Marketplace), campaign, ad group / creative, company, region / country,
  content touched. An ad group / creative filter only exists in the ad data, so
  it empties the ACE stages. No match shows an empty state, not an error.
- **Data:** stages 1-5 are daily rows in the **`funnelDaily`** collection
  (`{date "YYYY-MM-DD", source, channel, campaign, adGroup, creative, industry,
  country, content, company}` plus the source's numbers), readable by members,
  **writable only by the server** (rules deny clients). Stages 6-9 use the
  console's ACE opportunities (`/partnerCentral/v1/ace`) joined by company name
  to Leads (channel, content) and Prospects (TAM) (industry, country, campaigns).
  "Calculator / model downloads" counts file downloads plus benefits calculator uses.
- **The daily ingest (19 Nov 2026, ticket T6f4GeJZGg0OgntUpzPq;
  `functions/funnel-ingest.js`, HTTP function `funnelIngest`)** fills
  `funnelDaily`. Each row names its `source`:
  - `ga4-total`: one row a day, GA4 `users` for the whole site. Unique visitors
    are this figure, never a sum of slices (users are not additive).
  - `ga4-site`: day × country × channel × campaign: `visits` (GA4 sessions) and
    `users`.
  - `ga4-industry`: day × industry × country: real page views of
    `/industries/<slug>/` pages (`pageViews`) and their `users`; the industry is
    read from the page path, not inferred from a dimension. Page views add up
    across rows; users do not (a person who views two industries is a user on
    both rows).
  - `ga4-industry-total`: one row a day, GA4 `users` over every `/industries/*`
    page together (GA4 de-duplicates them): the people who saw an industry page.
  - `ga4-industry-users`: day × industry, no country: GA4 `users` per industry.
    GA4 cannot group pages by industry, so a person who views several pages of
    one industry may still count once per page here.
  - `ga4-events`: day × country × industry (the event's `industry` parameter):
    `walkthroughs` (product_tour_start), `calculatorUses` (calculator_use),
    `demoRequests` (demo_request), `downloads` (file_download), `leadForms`
    (lead_created).
  - `google-ads`: day × campaign × ad group: `impressions`, `clicks`, read
    through the Google Ads account linked to the GA4 property (no country:
    Google Ads metrics have none in GA4).
  - `leads`: day × industry × country × channel: `leads` from the console's
    `leads`; test and archived leads are never counted.
  - `ace`: day × industry: `aceCreated`, while Partner Central answers.
- **Days** are calendar days in the configured zone (`timeZone`, default
  Australia/Sydney, set to match the GA4 property's zone, which is the zone GA4
  reports its dates in); the console's own records are bucketed in that zone
  too. Never UTC.
- **Runs:** no Cloud Scheduler job and no new workflow: the hourly `aceToGa4`
  call (`.github/workflows/ace-ga4.yml`) runs the ingest when one is due. The
  first run backfills 90 days; after that a run every 6 hours or more replaces
  the last 3 days (GA4 keeps settling for about 48 hours). A run from the
  hourly call has a 150-second budget, so the workflow's request (320 s) never
  times out: sources it had no time for are listed in `deferred` and run on the
  next hourly call, and the backfill counts as done only once every GA4 source
  has succeeded. A run by hand has no budget. By hand: POST
  `funnelIngest` with `X-Board-Key` and `{"mode": "backfill"}` (90 days) or
  `{"mode": "daily"}`. A run replaces a source's rows for its days, so re-running
  never double counts.
- **Credentials:** GA4 is read with the Cloud Function's own service account
  (Application Default Credentials, `analytics.readonly`). It needs Viewer on
  GA4 property 473743482 (personalisationhub.com) and the Google Analytics Data
  API enabled on the project; Google Ads needs the Ads account linked to that
  property. `consoleConfig/funnelIngest` may override `ga4PropertyId` and
  `timeZone`.
- **A failed source is flagged, never a silent 0.** `consoleConfig/funnelIngest`
  records each source's `ok`, `error` and `lastSuccessAt`. A failing source
  keeps its earlier rows. The page's count line ends "Updated <local date and
  time>" (GA4's last good update), and a failure shows in the status line
  ("GA4 didn't update (…); last good update …"); the Dashboard tile shows
  "Data not updated" in place of its trend, its status turns red, and its
  summary panel carries the same text; the earlier figures stay.
- **Times:** days and dates are the viewer's local time, never UTC.

## PH Agent Context (19 Nov 2026)

A unified search and topic-context layer over the console
(`functions/context`, walkthrough in [`MCP.md`](./MCP.md) → "PH Agent
Context"). Aidan and any member's agent can pull everything relevant to a
topic in one call, and a topic used recently is recalled from a cache. It
extends Code Mode and the per-source searches; it replaces none of them.

### What Code Mode can reach

- **CTX-1** A Code Mode script can call, read-only and scoped to the
  caller's role like every script tool: `list_project_documents` (with
  `query`), `get_project_document`, `list_concept_critiques`,
  `list_support_threads`, `get_support_thread`, `list_aidan_runs`,
  `list_script_runs`, `list_search_runs`, `search_console` and
  `get_topic_context`. Every argument a signature names is checked against
  the real tool's schema (`test/code-mode.test.js`).
- **CTX-2** The Support Inbox tools return no email address (each is
  replaced by `[address]`), the customer's name but not their address, and
  never a thread marked spam. `list_script_runs` returns a script's source
  only when asked, cut at 2,000 characters.

### The index

- **CTX-3** One index, `searchIndex`, covers: agent board tickets in every
  project including archived ones, with descriptions and comments; Staff
  Kanban tasks with their comments; projects; concepts (description,
  README, Requirements, documents, discussion) and their critiques; help
  centre articles; leads; prospects (TAM); Support threads; project
  documents (Requirements, README, mirrors, board documents, interface
  contracts); and skills.
- **CTX-4** Ranking is hybrid: BM25 over the text (a title word counting
  three times) plus a vector similarity, combined 65 to 35, then a recency
  boost of at most 30% that fades over about 45 days. Every record has a
  local vector computed with no network. When the semantic embedder
  answers, each chunk also stores a semantic vector; a search uses them
  only when at least 90% of the chunks it ranks have one, and local vectors
  throughout otherwise. An unchanged chunk keeps its vector. A record is
  indexed, and search works, whether or not the embedder is reachable. A
  document is indexed up to 200,000 characters in at most 130 chunks.
- **CTX-5** Filters: source, project, concept, status, type, owner, a date
  range on the last change, open or closed, and archived. With no query the
  result is what the filters match, newest first. A filter that is not
  understood is refused with a message that says what is accepted.
- **CTX-6** The index is written on write. A Firestore trigger per source
  collection re-indexes the one record that changed; a write that changes
  nothing the index holds is dropped before any read; a deleted record
  leaves a tombstone. Trigger events may arrive late, twice or out of
  order: the trigger reads the record as it is now, every entry carries the
  time its source was read, and an entry is never replaced by one made from
  an earlier read. A query never reads a source collection: a server
  instance reads the index once, then only entries indexed since, at most
  every 10 seconds.
- **CTX-7** `scripts/context-backfill.js` indexes existing data and removes
  entries whose record has gone. It is safe to run again (an unchanged
  record is not written), is a dry run unless `--apply` is given, and
  prints counts only. It runs after every successful console deploy.
- **CTX-8** Aidan's lookup of a project's open tickets is an indexed query
  on `searchIndex` (source, project, open), not a read of every ticket the
  project ever had. Until the first full backfill has finished it uses the
  old read. A ticket filed seconds ago may not be in the index yet; the
  lookup by the gap's own key (SUP-AID-39) reads tickets directly and still
  finds it.
- **CTX-9** **Role scoping.** Each source is guarded by an existing read
  tool. A caller's search, pack or script includes a source only when
  `tools/call` would let that caller call the tool: the `board.read` scope
  and the tool's role, the same test, re-evaluated on every call. A caller
  never receives a record they could not read one call at a time.
- **CTX-10** **Personal fields.** A lead and a prospect are indexed by
  company-level fields only: never contacts, decision makers, the org chart
  or profile links. Every email address in any indexed text is removed. A
  help article's pending revision, a test lead and a spam thread are never
  indexed.
- **CTX-11** `search_console` (an MCP read tool and a script tool) takes a
  query, filters and a limit (default 10, max 50) and returns ranked hits,
  each with `source`, `id`, `title`, `snippet`, `score`, a deep link `url`
  and `updatedAt`, plus how many matched and how many were left out.

### Topic context

- **CTX-12** `get_topic_context` (an MCP read tool, a script tool and the
  `topic_context` insight) takes a topic as free text, or a project, concept
  or lead by id or name. Names resolve the way `resolveProjectRef` resolves
  them: the id, then the name exactly, then starting with it, then
  containing it as whole words; two candidates at a tier is no match and
  the topic is treated as free text. A name found inside a longer topic must
  be at least two words or eight letters, and a lead is matched only by its
  whole name or the start of it.
- **CTX-13** It returns a compact, ranked, deduplicated pack of at most
  20 KB: a summary; the key records per source with deep links; open items;
  blockers; recent decisions; what is new, updated or removed since the pack
  was last built; and related topics. Every list is capped and says how many
  items were left out (`more`, and `omitted` in total). The pack is built
  from the index alone, with no model call.

### Caching

- **CTX-14** **Hot tier.** Each server instance keeps the last 200 packs
  and searches in memory: a pack for 60 seconds, a search for 30, and only
  while no record it is made from has changed in the index.
- **CTX-15** **Warm tier.** `topicContext` holds, per topic and role: the
  topic key, the pack, the ids of the source records it cites with their
  versions, `lastUsedAt`, and hit and miss counts.
- **CTX-16** **Invalidation.** When a source record is re-indexed, the
  trigger marks stale every pack that cites it, and every pack about the
  project, concept or lead it belongs to. A stale pack is rebuilt on its
  next read, and only the sources that changed are gathered again; the rest
  of the pack is kept. The read also checks the cited versions itself, so a
  lost mark does not serve an out-of-date pack. A pack older than 6 hours is
  rebuilt whole.
- **CTX-17** **Recency.** Topics used in the last 7 days are pre-warmed: a
  pack that goes stale is rebuilt at once by `contextPrewarmTopic`, for the
  role it was built for, and is dropped from pre-warming when that role's
  reach has changed. A plain `search_console` query (an MCP session or a
  Code Mode run) and the topics of each Aidan thread are remembered as
  topics.
- **CTX-18** **The role is in the key.** A cache key is made from the
  caller's role, the sources that role may read, and the topic or query. A
  cached pack or search is never served to another role or another reach.

### Performance

- **CTX-19** Asserted by `test/context.test.js` over 3,000 records: a cached
  `get_topic_context` under 300 ms at the 95th percentile; `search_console`
  over a warm index under 800 ms at the 95th percentile; a cold topic pack
  under 5 s.
- **CTX-20** Timings and cache tiers are recorded in `searchRuns` and
  summarised (p50, p95, hit rate) by `list_search_runs`.

### Security and audit

- **CTX-21** Indexed and cached text is data, not instructions. Results say
  so. No build or deploy session is given a pack as its specification, and
  nothing in the Routine flows reads the index.
- **CTX-22** Every search and context call writes one audit row: caller,
  role, a keyed hash of the query (never the query; the key is readable by
  no client), the sources hit, the duration and the cache tier. The topic
  cache does hold each topic's words, readable by members, without who
  asked.
- **CTX-23** `firestore.rules`: members read `searchIndex`,
  `searchIndexState`, `topicContext` and `searchRuns`; only the server
  writes them. `contextSecrets` is closed to every client.
- **CTX-24** No function log line holds a record's text or a query. A
  trigger failure is logged with the record's path only.

## Support Inbox (14 Nov 2026)

Requested by Rob, 14 Nov 2026: connect the console to the support mailbox,
see every incoming email as a ticket, answer what can be answered from the
Help Centre automatically, involve a person when it can't, flag high-value
retailers on the Staff Kanban, and track it all on one stats page. (17 Nov
2026, Rob: the stats page and Try an email were removed; three figures for
support@ are on the Dashboard, and an email icon writes a new email. See
"Stats", "Writing a new email" and SUP-AI-11.)

### Where it is

- **SUP-NAV-1** A "Support Inbox" item sits in the sidebar's Support group,
  directly above Help Centre, and opens `#support`.
- **SUP-NAV-2** It is its own section in Roles (`support-inbox`), following
  the Help Centre grant until a role sets its own. Below Edit, the page has
  no write controls.
- **SUP-NAV-3** Settings has a "Support inbox" page (`#settings/support`).
  Every member can read it; only an admin can change it.
- **SUP-NAV-4** (18 Nov 2026) Each Save button on that page (Save client,
  Save settings, Save Aidan) is disabled until one of its own fields differs
  from the saved value, and is disabled again when the edit is reverted or
  the save succeeds. A failed save leaves it enabled. The write-only boxes
  (client ID and secret, Aidan's allowed senders) count as changed once
  something is typed in them. The same rule holds for the other Settings
  forms that save in place: a Media Studio key row, My Claude Routine and
  the role editor's Save role.

### Inboxes (17 Nov 2026)

Mail reaches the one connected mailbox through three addresses: support@,
hello@ and aidan@ (at personalisationhub.com). Each has its own tab.

- **SUP-INB-1** The page has three inbox tabs, named exactly **Support
  Inbox**, **Hello** and **Aidan**, in that order. Support Inbox is the one
  the page opens on (`#support`); the others are `#support/hello` and
  `#support/aidan`.
- **SUP-INB-2** An email is filed by the address it was written to, read
  from its own To and Cc headers, and from Delivered-To / X-Original-To
  where the mail server recorded one (a Bcc). The connected mailbox's own
  address is never used: every message is delivered to it. support@ files
  under Support Inbox, hello@ under Hello, aidan@ (To or Cc) under Aidan.
  The alias must be on personalisationhub.com or the connected mailbox's
  domain; a `+tag` after the name is ignored.
- **SUP-INB-3** An email written to more than one alias is in each of those
  tabs (support@ with aidan@ in Cc is in Support Inbox and Aidan). It is one
  ticket: a reply, note or status change made in one tab shows in the other.
  The ticket's header names the inboxes it is in.
- **SUP-INB-4** An email that names none of the three is in Support Inbox.
  So is every ticket filed before the tabs existed.
- **SUP-INB-5** A ticket keeps its inboxes for the life of the thread. A
  later customer email that names another alias adds that inbox; one that
  names none changes nothing.
- **SUP-INB-6** Each tab is a separate inbox: its own list and search, and
  its own thread view (`#support/<inbox>/ticket/<id>`, Back returns to that
  inbox). The header line counts the inbox on show. `#support/ticket/<id>`
  still opens any ticket, under its own inbox's tab. Only the Support Inbox
  has queues and their counts (SUP-INB-9).
- **SUP-INB-7** The Dashboard's three Support tiles count the Support
  Inbox only. Mail written only to hello@ or aidan@ is in none of its figures.
- **SUP-INB-8** Only a ticket in the Support Inbox can be answered without a
  person. With sending switched on, a draft for mail written only to hello@
  or aidan@ still waits for a person to approve it.
- **SUP-INB-9** Hello and Aidan are plain inboxes (18 Nov 2026, ticket
  2sRT2IJNDUpZbO3xvdUx), not support queues. Neither tab shows the queue
  strip, a triage badge (category, high value, automated, sorting), the AI
  summary, a suggested reply or its confidence, Raise on Staff Kanban or a
  Staff Kanban link, Resolve, "Answered by AI", assignment, Insert from the
  Help Centre, the ticket key or the ticket's history lines. The Support
  Inbox tab is unchanged.
- **SUP-INB-10** A plain inbox lists every email of that inbox that is
  neither spam nor archived (SUP-INB-20), newest first, whatever its support
  status, each with the sender, the subject, the
  date and **Unread** (in bold and as a word). Unread means the sender's
  latest email is newer than our last reply and than the last time this
  browser opened the thread; opening a thread reads it. The header line
  reads "N unread". Search reads the sender, subject and text.
- **SUP-INB-11** A plain inbox's thread shows the emails and internal
  notes, with **Reply**, **Save as internal note** and **Mark as spam**
  (which asks first) for a member with Edit. Spam and Archived
  (SUP-INB-20) are the only other views
  (`#support/<inbox>?queue=spam`, a "Spam (N)" button under the list when
  there is any, with Not spam on the thread); a link to any other queue of a
  plain inbox opens its emails. A reply is sent as a person's own words.
- **SUP-INB-12** In Aidan, every thread also carries Aidan's state in the
  list and on the thread: no action and why (including "this email has no
  @Aidan request" when Aidan was never asked), queued, working, replied,
  ingested, needs a person or failed. A replied thread shows his reply.
- **SUP-INB-13** An email in the Support Inbox and a plain inbox shows the
  view of the tab it was opened from: with triage in Support Inbox, plain in
  Hello or Aidan. It is one ticket either way (SUP-INB-3).
- **SUP-INB-14** (18 Nov 2026, ticket mMQ4yBYu4uwvOSHK9WlA) **Mark as spam
  is on every thread in all three tabs**: Support Inbox, Hello and Aidan,
  for a member with Edit. It asks first in each, then does the same thing
  whichever tab it was clicked in (SUP-TKT-5): the ticket's status becomes
  Spam and the thread moves to Gmail's Spam. Spam is the ticket's one
  status, so a thread in two or three tabs leaves every one of them at once
  and is in each tab's Spam. **Not spam** is on the spam thread in the same
  place, in every tab, with no confirmation, and puts it back in all of
  them.
- **SUP-INB-15** In Aidan, a thread marked as spam (from any tab) reads
  **"Aidan: no action — spam"** in the list and on the thread. A request
  Aidan had queued on it is cancelled and never runs; the confirmation says
  so first ("Aidan's request on it is cancelled."), and the thread then
  reads "The request waiting on this thread was cancelled." See SUP-AID-35.
- **SUP-INB-16** (18 Nov 2026, ticket b3NmU4mdmiGOZgHLURgK) **Selecting
  several threads.** For a member with Edit, every list in all three tabs
  (each Support Inbox queue, Hello, Aidan, and their Spam and Archived
  lists) has a labelled checkbox beside each row and a **Select all**
  checkbox above the list, which ticks or unticks every row shown (with a
  search, the rows that match). The checkbox is its own control: ticking it
  never opens the thread, and the row still opens the thread without
  ticking anything. A viewer sees no checkboxes.
- **SUP-INB-17** With one or more rows ticked, a selection bar above the
  list shows "N selected", that list's actions and **Clear**:
  - every inbox: **Mark as spam** (one confirmation for the batch, naming
    how many and how many of Aidan's waiting requests are cancelled),
    **Mark as read**, **Mark as unread**;
  - Support Inbox also: **Resolve**, **Assign to** (a member, or No one),
    **Move to** (Needs a person, Waiting on customer) and **Raise on Staff
    Kanban** (asks once; one Staff Kanban ticket per selected support
    ticket, and a ticket that already has one keeps it);
  - Hello and Aidan also: **Archive** (SUP-INB-20); Aidan also **Dismiss
    Aidan's state** (SUP-INB-21);
  - a Spam list: **Not spam** only; an Archived list: **Move to inbox** and
    Mark as spam.
- **SUP-INB-18** An action applies to every selected thread through
  `POST /supportMail/v1/tickets/bulk` (`{ids, action, …}`, editor, at most
  50 ids a call; the page sends 25 at a time), never one call per thread.
  Each thread is changed by the same code as its single action (so spam
  moves the Gmail thread and cancels Aidan's queued request, as SUP-INB-14
  and 15 say), and one failing does not stop the rest. The page then shows
  **one result message** under the bar with what was done to how many and
  how many failed ("3 emails marked as spam.", "2 tickets resolved. 1
  failed: …").
- **SUP-INB-19** The selection clears after an action, on **Clear**, and
  on changing tab or queue (or opening a thread). A redraw from new data (a
  sync, another person's change) keeps it: every ticked thread still in
  the list stays ticked, and one that left the list is dropped from it.
- **SUP-INB-20** **Archive** takes a Hello or Aidan email out of its list
  without changing its support status (`archived` on the ticket). Archived
  emails are under an "Archived (N)" button below the list
  (`#support/<inbox>?queue=archived`), where **Move to inbox** puts them
  back; a new email from the sender brings the thread back by itself. The
  Support Inbox has no Archive: it resolves, and archiving never changes
  which Support Inbox queue a ticket is in.
- **SUP-INB-21** **Dismiss Aidan's state** clears what Aidan recorded on a
  thread only when it is a finished state asking for attention: no action,
  needs a person or failed. The thread then reads "no action" as one Aidan
  was never asked about. A request queued or working is left alone (Mark as
  spam cancels it), and so is a record of something Aidan did (a reply
  sent, an email kept); those are counted as "had nothing to dismiss".
- **SUP-INB-22** **Mark as read / unread** change this browser's unread
  state (SUP-INB-10), with no server call. A thread marked unread stays
  unread until it is opened or marked read, whatever was replied. In the
  Support Inbox, whose queues already say what needs work, a ticket reads
  **Unread** only when someone marked it so.
- **SUP-INB-23** iPad: the checkboxes are labelled checkboxes and every
  selection-bar action is a `<button>` (or a native list for Assign to and
  Move to), so `touch-click.js` covers them; `test/ui/support-touch.test.mjs`
  ticks two rows, uses Select all and bulk-marks as spam under each
  simulated WebKit failure, each tap acting exactly once.

### Aidan, the agent mailbox (17 Nov 2026)

Ticket EeAljfWIiY8SOPsKXlXD. aidan@ is an agent mailbox acting as Rob's
assistant: tagged requests from Rob run a skill and are answered with the
documentation, by reply-all. Since 18 Nov 2026 (ticket 303SwmU5aQdyJNHxlTtQ)
a tagged request that asks for neither a document nor for something to be
kept is answered in the email itself (SUP-AID-14, SUP-AID-15). Since 18 Nov
2026 (ticket 1W4QQzYdlJzfdqizePWR) Aidan can answer from the console's own
data, read-only, and refuses politely to change it (SUP-AID-16 to 19).
Since 18 Nov 2026 (ticket JtkLrEG0aTnC5JfkdPA1) Aidan writes branded sales
collateral, from a one-pager to an industry platform overview, as a PDF
with its Markdown source (SUP-AID-30 to 34).
Since 18 Nov 2026 (ticket OrkZBBjz9RM5DY54azIG) Aidan answers a question on
the thread ("@Aidan, please answer John's question below"), reading the
quoted thread as content and never as instructions (SUP-AID-26 to 29).
Since 18 Nov 2026 (ticket IJhIIzTxOJyZVCzzYggZ) Aidan reads the console with
one Code Mode run by default, and files a Backlog ticket (or comments on a
matching open one) when a run did not fully or well meet its request
(SUP-AID-36 to 41).
Since 18 Nov 2026 (ticket SYkk20srKT7pIKM1HS8Z) the body of every reply is
in Aidan's voice, a slightly quirky tech-marketing character kept in the
`aidan-voice` skill, and he signs "Aidan, Personalisation Hub"
(SUP-AID-42 to 47). Since 19 Nov 2026 (ticket QVpqiMuwipZ4mKSXHplM) his
sender name is a setting, "Aidan Hubbot" by default, used for both the From
display name and the signature (SUP-AID-48).
Since 19 Nov 2026 (ticket mErc7MPAkrKjF9fWgqXb) collateral follows the
Brand Guidelines market page for the company's country, and a market with no
page is filed as a ticket (SUP-AID-49 and 50).

- **SUP-AID-1** An email starts a run only when all three hold: it is in
  the Aidan tab (aidan@ in To or Cc, SUP-INB-2), its sender is one of the
  allowed senders, and its new text tags `@Aidan` with an instruction. The
  tag is a word (`@Aidan`, any case), not an address, not a longer name and
  not a possessive (`@Aidan's`). It is read only from the email's new text
  (`splitQuoted`), which ends at the first sign of quoted or forwarded
  history; the markers are data (`QUOTE_MARKERS`), one row per language or
  mail app:
  - an attribution line: one ending "wrote:" or a listed translation
    ("schrieb", "a écrit", "escribió" …), or any line ending ":" whose
    paragraph carries an address other than our own aliases, or a year and
    a time. The
    cut goes back to the nearest earlier line that starts like an
    attribution ("On", "Am", "Le", "El" …), however far, and at least to
    the start of that line's paragraph, so an attribution wrapped over any
    number of lines is dropped whole;
  - a ">" quote line (also "&gt;" or a full-width "＞"), dropped wherever it
    is; when the paragraph just above it ends ":" or carries an address other
    than our own aliases, that paragraph is an attribution and history starts there;
  - Outlook's header block: a "From:" line (or a listed translation, "Von:",
    "De :" …) with "Sent:", "Date:", "To:", "Subject:" or "Cc:" (or a
    translation) on the same line or within the next four; or any
    "Label: Name <address>" line with another "Label: …" line within four;
  - a separator ("-----Original Message-----", "Forwarded message" and their
    translations), a forward opener ("Begin forwarded message:" and
    translations) or a line of ten or more underscores.
  Lines are compared without zero-width characters, with any Unicode space
  as a space and any line ending (CRLF, CR, LF, Unicode separators) as one.
  format=flowed text is un-wrapped first. An HTML body is cut at its first
  quote container (`<blockquote>`, `<hr>`, `.gmail_quote`, `.gmail_attr`,
  `#divRplyFwdMsg`, `#appendonsend`, `type=cite`, Apple, Yahoo, Thunderbird,
  ProtonMail and Outlook mobile containers) before it is read as text, and
  then the same line rules apply. When an email has both a plain-text and an
  HTML body, the tag must be new text with an instruction in both, or
  nothing runs. An email with no new text (a blank reply-all, an
  attachment-only reply, a forward with no comment) has no tag: it never
  falls back to the whole text. A tag below an attribution, a header
  block or a separator is history too; one below a bare ">" quote with no
  attribution above it is new text (an inline answer). A tag is an instruction only when
  what follows it asks for something. Text that opens with an
  acknowledgement ("thanks", "great", "hi" …) is an instruction only when one
  of its clauses opens with a request to write or keep something ("thanks,
  now send the summary") or asks something (it has a "?", or a clause opens
  with "please", "can you", "confirm", "let me know", "tell me" or a question
  word: "hi, please confirm you received this"); "@Aidan thanks, the AWS
  onboarding pack was great, I'll check it again tomorrow" is not one. Other
  text is an instruction when it has an action verb (send, write, draft,
  store, keep …), is three or more words, or is two words and a question
  ("any update?"). A tag that is not an instruction is recorded as "Aidan: no
  action" with that reason and does not run. Where a quote format is not
  recognised at all, SUP-AID-12 is the safeguard.
- **SUP-AID-2** Only the author of the tagged email counts. A tag written by
  someone who is not allowed does nothing, even on a thread an allowed
  sender started; an allowed sender may tag Aidan on a thread someone else
  started.
- **SUP-AID-3** A plain Cc with no tag, a tag from anyone else, a tag with
  no instruction, an email with more than one From address (or more than one
  From header), machine-sent mail and mail the mailbox sent never start a run and never get a reply.
  The email stays in the Aidan tab. A refused tag is shown on the ticket
  ("Aidan: no action") with the reason.
- **SUP-AID-4** Before a run, the sender is checked again against the
  current allowed list (and SUP-AID-1 and SUP-AID-12 are decided again from
  Gmail's own copy of the email and the thread as it is then), and Gmail must
  have verified the From address. Only the topmost `Authentication-Results`
  header is read (Gmail adds its own above every header the email arrived
  with; the Gmail API's `payload.headers` keeps that order and the run passes
  them through untouched). It is parsed as RFC 8601 says
  (`parseAuthResults`): comments, nested and with escapes, are removed and
  quoted strings, with escapes, are one value before the header is split on
  ";", so a "dmarc=pass" or ";" inside either is never a result; a method
  result counts only at the start of a resinfo element; a property value
  (`smtp.mailfrom`, `header.from`, `header.d`, `header.i`) is one whole
  value; an unbalanced comment or quote, a malformed element or a repeated
  property refuses the email. The verdict (`authVerdict`): the authserv-id
  must be exactly `mx.google.com` (no other host, no `*.google.com`); more
  than one DMARC result is refused; a DMARC result whose `header.from` is
  not exactly the From domain is refused; DMARC pass passes; any DMARC
  result other than pass or none (fail, quarantine, reject, temperror,
  permerror …) is final. With DMARC none (the domain publishes no policy) or
  no DMARC result, a DKIM pass whose signing domain (`header.d`, else the
  domain of `header.i`) is exactly the From domain, or an SPF pass whose
  `smtp.mailfrom` domain is exactly the From domain, passes. Domains match
  exactly: a parent or child domain never does. Headers further down are
  never read. Otherwise nothing is done.
- **SUP-AID-5** For a write or a store, the skill is the one the
  instruction names (by slug or name), or else the one Claude picks from the
  skills library. A store with no matching skill sends nothing and goes to
  Needs a person. A write with no matching skill is tried as an answer
  (SUP-AID-14); when the email can't answer it, nothing is sent and the
  ticket goes to Needs a person. An answer needs no skill.
- **SUP-AID-6** A request to write produces the documentation with that
  skill from the email, its attachments (text, PDF and images; at most 8
  files and 20 MB) and the skill's kept reference material. Any instruction
  with a verb to send, write, draft, create, prepare, produce, generate,
  build, make, reply, email, share, forward, summarise, revise or redo is a
  write, even when it also says "keep" or "add" ("send the pack, keep it
  short for the skill reviewers"). It is sent at once, with no approval
  step, as a reply on the same thread to everyone on the email: the
  sender's verified From address and the rest of To in To, the original Cc
  in Cc, never the mailbox or our own aliases, at most 50 people. Reply-To
  is not verified, so it is ignored: it neither replaces the sender nor adds
  anyone. It comes from the connected mailbox as
  "Aidan Hubbot", signed "Aidan Hubbot, Personalisation Hub" (SUP-AID-47, SUP-AID-48), with the document attached as a
  Markdown file, and is marked `Auto-Submitted: auto-generated`. A verb to
  add, update, edit, fix, turn, convert, include, attach or compile
  something is a write too. "This email", "your reply" and "by email" name
  things: they are not a verb to email or reply. A question, or a request to
  confirm receipt, is an answer even with one of these verbs in it
  (SUP-AID-14).
- **SUP-AID-7** The sent reply is filed on the ticket and shown in the Aidan
  tab with who it went to and the file attached. The ticket is resolved by
  Aidan.
- **SUP-AID-8** A request to store (with no write verb: starting "store",
  "save", "ingest", "remember" or "contribute"; or "keep", "add" or "file"
  with a skill, references, a library or "for later"; or "store / keep /
  save this … for the X skill") keeps the email and its attachments as reference
  material for that skill (`skillReferences`); PDFs and images are kept in
  Storage. Later runs of the skill read it. The ticket is marked
  **Ingested** and no email is sent.
- **SUP-AID-9** The allowed senders are runtime configuration only: they are
  never in the repository, its tests, fixtures, docs or commit messages. An
  admin sets them in Settings › Support inbox › Aidan; they are kept in
  `supportSecrets/aidan`, which no client can read or write, and are only
  ever shown masked to an admin (members see how many there are). With none
  set, or Aidan switched off, nothing runs.
- **SUP-AID-10** Runs happen in the scheduled sync, one per sync; "Sync now"
  files and queues but does not run. A thread runs Aidan five times at most.
  A whole run fits inside the `supportMail` function's 540 seconds: it runs
  before triage and only in the sync's first two minutes (otherwise it waits
  for the next sync), the skill choice has one minute and the document four,
  neither model call is retried, and a sync that ran Aidan leaves triage to
  the next sync. An answer has two minutes, after the Help Centre engine's
  three calls of 40 seconds at most (SUP-AID-21), the console plans and the
  one Code Mode run of 10 seconds (SUP-AID-36). A run still `working` 15 minutes after it started was cut
  off: the next sync (scheduled or "Sync now") moves it to Needs a person
  with that reason, and it is never started again.
- **SUP-AID-11** Queueing is idempotent. Each email is decided once per
  ticket, in a transaction (`aidanSeen` keeps the last 50 decided ids), so
  the schedule and "Sync now" on another instance filing the same email
  can't queue it twice. A job is claimed by moving it from queued to
  working in a transaction, so only one instance runs it and sends. While a
  run is queued or working on a thread, a new request there is not queued
  (a note on the ticket says to send it again once Aidan has answered), and
  a refused tag doesn't overwrite the run's status.
- **SUP-AID-12** Defence in depth, for quoted text in a format SUP-AID-1
  doesn't recognise: an instruction is refused when its text, compared
  ignoring case, spacing, punctuation, zero-width characters and Unicode
  lookalike forms (NFKC), appears in a display name or address in the
  email's From, To, Cc, Reply-To or Sender headers (RFC 2047 encoded names
  decoded), or appears in a text that also tags Aidan: the subject of a
  reply or forward, or an earlier inbound email on the thread that someone
  who is not allowed wrote. An earlier email is the allowed sender's own
  only when it came from an allowed address and Gmail verified it when it
  was filed (`senderVerified` on the message, SUP-AID-4); even then its
  quoted part is someone else's. Mail the mailbox sent is not compared.
  This is decided when the email is filed and again when the run starts.
  The refusal says why, so an owner asking for something a client asked
  for in the same words can rephrase it.
- **SUP-AID-13** The tag, the From address and the defence in depth are
  read from Gmail's own copy of the email (`mailFacts`: every body, every
  From header, the address headers), not from the stored text, both when
  the email is filed and when the run starts. A From header that holds more
  than one address, or an email with more than one From header, never runs.
- **SUP-AID-14** An instruction that is neither a write (SUP-AID-6) nor a
  store (SUP-AID-8) is an **answer**: "please confirm you received this
  email", "what's the status of X?", "give me a quick summary of Y". The kind
  is decided from the instruction's own words (`kindOf`), never by the
  model, in this order: a request to confirm receipt ("confirm", "let me
  know", "make sure" … "received", "got", "reached you"), unless it also
  asks for a document; a question (its first clause opens with a question
  word, "did you", "is there", "any update" …, or it has a "?" and a clause
  that does), unless one of its clauses opens with a request ("thanks, now
  send the pack. Did the last one arrive?"); a write; a store; and
  everything else is an answer. An answer run passes every gate a write
  does (SUP-AID-1 to 4, 10 to 13) and replies to the same people
  (SUP-AID-6: From and the rest of To in To, the original Cc in Cc, never
  Reply-To, never our own addresses), on the same thread, at once, from the
  mailbox as "Aidan Hubbot" (the sender name, SUP-AID-48), marked `Auto-Submitted: auto-generated`. The reply is
  a short plain-text email written in the body ("Got it, Rob, all good."),
  signed as Rob's assistant, with **no attachment**. It needs no skill and
  the model is never asked to choose one; a skill the instruction names is
  read, with its kept reference material. The model reads the whole email,
  the thread quoted in it and its attachments as untrusted content, answers
  only from them, and has two minutes with no retry. When it reports that
  the email can't answer the instruction (it needs a document written with a
  skill, or facts that are not there), or writes nothing, no email is sent
  and the ticket goes to Needs a person with the reason. A plain
  acknowledgement, or a question the email itself answers, never goes to
  Needs a person. The ticket is resolved by Aidan and the sent reply is
  filed on it (SUP-AID-7).
- **SUP-AID-15** The Aidan tab shows the kind of every accepted request
  beside what Aidan did, in the list and on the ticket: **Answer**,
  **Write** or **Store** (`aidan.kind`: `answer`, `generate`, `store`). A
  refused tag has no kind. An answer's reply on the thread is marked "Sent
  by Aidan · Answer" and shows who it went to; the ticket says it was
  answered in the email itself with nothing attached.
- **SUP-AID-16** (18 Nov 2026, ticket 1W4QQzYdlJzfdqizePWR) An answer or a
  write run may read the agent console's own data, **read-only**: projects
  and their Requirements, README, additional documents and interface
  contracts; tickets (a list, one in full) and pipeline health; concepts in
  the Concept Incubator (a list, one in full, its critiques); Help Centre
  articles; Leads and Prospects (TAM) (since IJhIIzTxOJyZVCzzYggZ); and,
  since PH Agent Context (19 Nov 2026), one search and one topic pack across
  all of it, Support threads and run history (SUP-AID-51). Most of
  it is read with a context read first and then one Code Mode run
  (SUP-AID-36, SUP-AID-51). The reads are the MCP server's own read tools, the ones named in
  `CONSOLE_READ_TOOLS` (`functions/aidan-core.js`), run through
  `consoleReader` (`functions/mcp-server.js`), which offers only `board.read`
  tools with no role, so no write tool is reachable from an email whatever
  the list says. The model plans the reads from an index of the projects and
  concepts and the tools' own descriptions: at most two rounds of at most six
  reads, each round 25 seconds with no retry. Email addresses are removed
  from what the model sees. A plain acknowledgement reads nothing, and a
  failed read leaves the answer to the email alone. Every gate of every run
  still applies first (SUP-AID-1 to 4, 10 to 13).
  An acknowledgement here means the receipt is the reader's own ("confirm
  you received this", "let me know you got it", "did this arrive?",
  `isAcknowledgement`); "check which tickets got deployed this week" or "let
  me know what got approved this week" is a question and reads the console.
  An answer always may read the console. A write (a skill's document) reads
  it only when the instruction is clearly about the console
  (`writeReadsConsole`: it names tickets, the backlog, a concept, the
  pipeline or a column, the Help Centre, a README, an interface contract or
  "the console"); "requirements" or "project" alone don't count, since a
  requirements document or a project plan is a document of its own. A write
  no skill matches is tried as an answer, and reads the console like one.
  Tickets and pipeline health are read one project at a time
  (`list_backlog_items` and `get_pipeline_health` without a `projectId` are
  dropped from the plan, `PROJECT_SCOPED_READS`), so one read is never every
  ticket in the console. The answer (or the document) sees at most 40,000
  characters of any one read and 120,000 characters of console data in all
  (`CONSOLE_READ_CHARS`, `CONSOLE_DATA_BUDGET`, `consoleBlock`); a read that
  comes back longer is cut, and reads past the total are left out. The plan's
  second round sees at most 6,000 characters of each earlier read.
- **SUP-AID-17** An answer written from console data is short and in the
  body when it fits roughly a page (3,000 characters, 45 lines); a longer one
  is attached as a Markdown file with a summary of at most two lines in the
  body and a line naming the file. Tickets, projects and concepts are named
  by their titles: an id in the reply (or the attachment) is replaced by its
  title, or dropped when unknown, unless the instruction asks for ids.
  The same holds for a write that used console data: the reply text and the
  attached document both have ids replaced by titles (`stripIds`, unless the
  instruction asks for ids), so it never rests on the prompt alone. A title
  is put in as written, whatever characters it holds.
- **SUP-AID-18** A reply that carries console data goes only to the allowed
  senders on the email (the sender, and any other allowed sender in To or
  Cc). Anyone else copied in (a client, a partner) is left off, and the
  ticket's event line says how many. A reply from the email alone keeps the
  reply-all of SUP-AID-6 and SUP-AID-14. The ticket records what was read
  (`aidan.console`: the number of reads and the tools) and any attachment
  (`aidan.document`).
  Decided 18 Nov 2026 (review of the first build): a write reads the console
  only when its instruction is clearly about the console (SUP-AID-16), so a
  document that merely names a client ("write the POC summary for Kestrel",
  even when a Kestrel project exists) still goes to everyone on the email as
  it always has. When a write does use console data, its prompt says the
  reply goes only to the people allowed to instruct Aidan, not to everyone
  on the email (`docSystemFor`), matching what is sent. The other option,
  reading the console before every write and only correcting the prompt,
  was not taken: it would silently stop a client in Cc receiving documents
  they were sent before.
- **SUP-AID-19** Aidan never creates, updates, archives, approves or deploys
  anything from an email. (His own self-improvement ticket, SUP-AID-38, is
  not one an email asks for: it is decided in code from how the run went.) A request to do so on the console ("create a
  ticket for …", "update the README", "move that card", "deploy …"), decided
  from the instruction's own words (`consoleChangeRequest`: a clause that
  opens with a change verb whose object is a console thing; see below) or by the plan
  (`changeRequested`), gets a short fixed reply to the allowed senders on the
  email saying Aidan can only read the console and has changed nothing
  (`aidan.readOnly`). No model writes it. A question about how to do it ("how
  do I create a ticket?") is answered.
  The console thing must be the head of the object: followed by the end of
  the clause or a preposition ("a ticket for …", "the favicon ticket to
  Ready for Testing", "the Customer Support concept to a project", "the
  Help Centre article about pricing"). A console word that only describes
  the next noun is a document Aidan writes, not refused: "create a project
  plan for Kestrel", "create a requirements document for Heron", "create a
  one-page project overview", "create a board pack". A bare "FAQ" or
  "article" is a document too ("create a FAQ for the client", "add a FAQ
  section to the proposal"); a Help Centre, help or FAQ article is the
  console's. Every verb needs a console object, deploy, merge, approve and
  archive included ("approve this", "archive this email", "merge the two
  proposals", "deploy the docs to the client site" are not refused);
  "deploy … to main" or "merge … into main" is refused whatever it names.
  "Open a ticket" makes one; "open the Backlog Tracker README and summarise
  it" reads it; "update me on …" asks for news.
- **SUP-AID-20** (18 Nov 2026, ticket rVv1x2N8xlKAZs0gpkRx) **One answering
  engine.** A question about the platform in an answer run is answered by
  the same match-and-draft pipeline as the Support Inbox
  (`functions/answer-core.js`, SUP-AI-7, SUP-AI-8, SUP-AI-10): matched
  against the whole published Help Centre, drafted from the best article,
  drafted again from the best 2 or 3 when confidence is under 80%. The same
  prompts, the same catalogue (hidden-from-website articles included) and
  the same limits; neither path has a copy of its own. The same question
  from a customer to support@ and tagged for Aidan by an allowed sender
  gets the same matched articles and the same reply body.
- **SUP-AID-21** Every answer run that asks something is put to that engine
  first, with the tagged email alone (its quoted history and the rest of the
  thread are not read, except as SUP-AID-26 to 28 say when the instruction
  refers to the thread). Not put to it: an acknowledgement ("please confirm
  you received this"), and an instruction that names a skill (answered with
  that skill, SUP-AID-14). When the Help Centre answers it (about the
  platform, not spam, the articles fully answer it, at least one article
  cited), Aidan replies with that answer. Otherwise, or when the engine
  cannot be reached, the run carries on exactly as before: the console
  (project and documentation questions, SUP-AID-16) and the email
  (SUP-AID-14). The engine's calls are not retried and take 40 seconds each
  at most (three at most), so the run still fits the function (SUP-AID-10).
- **SUP-AID-22** Aidan applies **none of the Support Inbox's sending gates**
  (SUP-AI-2, SUP-AI-3, SUP-INB-8): no confidence threshold, no auto-send
  switch, no once-per-thread limit. He always replies to an allowed sender
  when the Help Centre answers. The Support Inbox's own gates are unchanged.
- **SUP-AID-23** The Help Centre reply is sent in the email itself with no
  attachment, to everyone on the email (the Help Centre is public, so nobody
  is left off, unlike SUP-AID-18), from the mailbox as "Aidan Hubbot" (SUP-AID-48). It opens
  "Hi <first name>," (no "Thanks for your email."), carries the engine's
  reply body with any greeting or sign-off the model wrote removed
  (SUP-AI-9), and names each cited article by its title: a line "Help Centre
  article(s):" with the title and link of every cited article the body does
  not already name. An article hidden from the website is never named in the
  email. The confidence is never written in the email.
- **SUP-AID-24** The ticket keeps what the answer was written from
  (`aidan.helpCentre`: `confidence`, `confidenceSteps`, `articles [{id,
  title, url}]`, `question`). On the ticket in the Aidan tab, under what
  Aidan did ("Aidan answered from the Help Centre, in the email itself, to N
  people on this email."), the confidence shows as a word and a number
  (SUP-AI-10) beside "From:" and the matched articles (links; a hidden one
  as text marked "not on the website"), with the change when articles were
  combined. An answer that did not come from the Help Centre shows neither.
- **SUP-AID-25** `test/fixtures/support-eval.json` passes through both
  paths: `scripts/support-eval.js` runs every fixture as a customer's email
  to support@ and as the same email tagged "@Aidan, …", judged by the same
  rules (SUP-AI-12), and `test/answer-core.test.js` runs both paths over the
  fixtures with a stand-in model on every train.
- **SUP-AID-26** (18 Nov 2026, ticket OrkZBBjz9RM5DY54azIG) **Instruction
  vs content.** The instruction is only ever the allowed sender's new text,
  read and gated as SUP-AID-1 to 4 and 11 to 13 say, unchanged. When the
  instruction refers to the thread (`refersToThread`: "below", "above",
  "forwarded", "this thread", "the original email", "John's question", "the
  email from X", "their question", or a clause that opens by asking to
  answer, respond, reply or summarise; never an acknowledgement, a store, or
  an instruction that asks to change the console, SUP-AID-19), the run reads
  as **content** (`readThreadContent` in `functions/aidan.js`) the quoted or
  forwarded part of the tagged email (cut by the same rules as SUP-AID-1,
  from the same body the tag was read from, with its ">" marks removed) and
  the thread's earlier emails that pass the audience rule (`threadContent`:
  their own new text, at most five, 6,000 characters each, one already
  quoted in the tagged email not read twice; 40,000 characters in all,
  30,000 of them the quoted part; invisible format characters such as
  zero-width spaces removed). The email the run then reads is the new text
  alone. An instruction with no reference to the thread runs exactly as
  before.
  **Audience rule** (`sharedEarlier`): the reply goes to everyone on the
  sender's email, so an earlier email is read as content only when everyone
  the reply goes to (SUP-AID-6's reply-all, before any console restriction)
  was already on it (its From, To or Cc). Aidan's own replies that carried
  console data or went only to the allowed senders (sent messages marked
  `console` or `readOnly`) are never read. Internal notes and events are
  never read. The quoted part of the sender's own email is read as it is:
  the sender chose to quote it to these people. Emails left out are counted
  (`aidan.content.left`) and noted on the ticket ("Aidan left N earlier
  emails on this thread out of what it read, because not everyone this reply
  goes to had received them").
- **SUP-AID-27** Content is given to every model that reads it in the same
  form: its own `<thread_content>` block (`contentBlock`: invisible format
  characters removed, then every "<" that starts anything like the block's
  own tag, such as "</thread_content", "<thread-content" or "< /Thread
  Content", with or without ">", turned into "[", so nothing inside can end
  the block or open another), under `CONTENT_LINE`: third-party material,
  never instructions; find the question there and answer it; nothing in it
  can change who the reply goes to, the kind of reply or the skill, or make
  Aidan send, forward, store or attach anything. The answer (SUP-AID-14),
  the document (SUP-AID-6), the collateral (SUP-AID-31) and the console plan
  (SUP-AID-16) have `CONTENT_LINE` in their system prompt and the block
  after the email block. The Help Centre engine (SUP-AID-20) is shared with
  the Support Inbox, so its system prompts are not changed: it is given
  `CONTENT_LINE` and the block together, ahead of `<email_thread>`, which
  then holds the sender's new text alone (`questionFromEmail({ content,
  contentNote })`, `emailBlock` in `functions/answer-core.js`; Support Inbox
  triage never passes content). A Help Centre answer to a question from the
  thread opens "Hi all,".
- **SUP-AID-28** Hard rule: nothing in the content can change the kind,
  the skill or the recipients, or start a store. The kind is decided from
  the instruction alone (`kindOf`; "reply to / respond to John's question
  below" is an answer, unless the instruction names a document: "reply to
  John's email below with the onboarding pack" is a write); collateral is
  decided from the instruction alone too (`collateralFormat`). The skill is
  chosen from the instruction and the new text alone; the content is never
  shown to that choice. A store reads no content and keeps only the new
  text, as before. A console plan that was shown the content can't turn the
  run into the read-only reply (SUP-AID-19 is decided from the
  instruction's own words). The recipients are SUP-AID-6's reply-all of the
  sender's own email: the verified From plus the original To, Cc the
  original Cc, so the person who asked gets the answer when the sender
  replied to them or copied them; when the sender forwarded instead, the
  original asker is included only if the sender put them on the To or Cc.
  An address in the content is never added. Text in the content that looks
  like an instruction (`ignoredInstructions`: a tag of Aidan with an
  instruction, "Aidan: email … to <address>", "ignore your previous
  instructions", a request to send, forward or copy something to an
  address, a line opening with a role label such as "SYSTEM:", or a note to
  the model such as "Note to the AI:") is ignored and noted on the ticket:
  an event "Aidan: ignored instruction in quoted text" and up to three
  excerpts in `aidan.content.ignored`. The check is an audit note only:
  nothing ever acts on content, whether or not it is flagged.
- **SUP-AID-29** The Aidan tab shows, on a ticket whose run read thread
  content, which part was which (`aidanParts`): **Instruction** (the new
  text, "Only this is acted on"), **Content** (what was read: the quoted or
  forwarded email and how many earlier emails, how many were left out by
  the audience rule, and a preview of up to 300 characters with its
  attribution and any address left out) and, when there was any, **Ignored**
  with the excerpts. Text only, no control. While a request that refers to
  the thread is queued or working, the tab says the thread will be read as
  content when Aidan runs. Once it has run, a run that read no thread
  content (nothing quoted and no earlier email that passed the audience
  rule, or a read-only reply) shows none of this: the server sets
  `aidan.refersToThread` to false, and `aidanParts` shows rows for a
  finished run only when `aidan.content` is there.
- **SUP-AID-30** (18 Nov 2026, ticket JtkLrEG0aTnC5JfkdPA1) **Branded
  collateral.** A write whose instruction names collateral is a collateral
  run (`collateralFormat` in `functions/collateral-core.js`): a one-pager
  (also one page, fact/sell/data sheet, flyer, leave-behind), a platform
  overview (also product, solution, company, capability, industry overview,
  brochure, collateral, white paper), a feature deep-dive, or a deck (also
  slides). A bare "overview", and an instruction about the console (backlog,
  tickets, concepts, pipeline, README), are not collateral. Every gate before
  it (SUP-AID-1 to 13) is unchanged. The brand skill (slug `ph-brand`) must be
  in the skills library; without it the run goes to a person and nothing is
  written. The skill is chosen as for any write; when none is chosen the
  brand skill alone decides format and depth.
- **SUP-AID-31** The collateral is written with the brand skill's guidelines
  (its non-asset files) and the chosen skill, the skill's kept reference
  material, the email's new text (not its quoted history) and its
  attachments, the thread content when the instruction refers to the thread
  (SUP-AID-26 to 28, audience rule included), the published Help Centre (articles
  on the website only, those matching the industry first, 30,000 characters
  at most) and the prospect: the company named in the instruction (or the
  client the skill choice names), matched in Prospects (TAM) then Leads, of
  which only **name, industry and country** are read; never revenue, store
  counts, contacts, notes, insights or end-customer data. The industry is the
  one named in the instruction (the nine on personalisationhub.com), else the
  record's. No console plan runs, so the reply goes to everyone on the email
  like any write. The prompt sets a length per format (one page; three to
  five pages; three to six pages; six to ten landscape pages), global
  positioning, the banned internal names, the retailer's own vertical, no
  invented facts and no call to action of its own. One model call, 4 minutes,
  medium effort.
- **SUP-AID-32** What the model wrote is cleaned in code before it is printed
  or sent (`guardCollateral`), document, title and reply alike: a sentence
  that names Sydney, Australia or Australian is dropped (when the prospect is
  Australian, only one that places Personalisation Hub there: based,
  headquarters, founded, office, origin); a sentence or table row naming an
  internal project (the console's project names and a fixed list: PH Agent
  Console, Backlog Tracker, Staff Kanban, Concept Incubator …) is dropped;
  the brand skill's renames are applied (PH Core, Autonomous Shopfront,
  Context360, Live Visitor Profile, menu board project); no long dash (en
  dash, em dash, horizontal bar) survives: a spaced one or an em dash becomes
  a comma, one in a range "to" ("3 to 5", "Monday to Friday", "9am to 5pm"),
  and one between other words a hyphen ("end-to-end"). The counts are kept on
  the ticket, and the Aidan tab's Removed row says "sentences naming Sydney or
  Australia" for the first rule.
- **SUP-AID-33** The collateral is printed to PDF on the server
  (`functions/collateral-pdf.js`, headless Chromium, JavaScript off, no
  request but data: URIs and the brand font, 60 seconds at most; at the limit
  Chromium is killed and closed before the run is told, so a hung print never
  leaves a browser running) from a page
  laid out by the brand skill (`functions/collateral-layout.js`): light
  surface, Kantumruy Pro with its fallback
  stack, the four-colour bar once, the skill's full-colour logo file (never
  redrawn), an eyebrow with the format and industry, "Prepared for
  <company>", one teal accent, the CTA "Try free on AWS Marketplace →"
  linking to the trial with "Or book a demo at personalisationhub.com", and a
  footer with personalisationhub.com and the page number on every page. A4
  portrait; a deck is A4 landscape with one page per `##` section. A
  `collateral*.css` file in the brand skill is applied after the defaults.
  The reply goes to everyone on the email (as SUP-AID-7) with the PDF
  (`application/pdf`) and the Markdown source (`text/markdown`) attached.
  When the PDF can't be made, nothing is sent: the ticket goes to Needs a
  person with the reason, and the cleaned Markdown is kept as an internal
  note on the thread. The whole run stays inside the function's 540 seconds
  (start within 2 minutes, skill choice 1, document 4, PDF 1); a run cut off
  anyway goes to a person (SUP-AID-11).
- **SUP-AID-34** A sent collateral run is filed on the ticket as
  `aidan.collateral` and kept as a reference example for the skill used: a
  `skillReferences` document with `source: "aidan-collateral"`, `example:
  true`, `format`, `industry`, the cleaned Markdown as its text and the PDF in
  Storage under `skill-references/<skillId>/<referenceId>/`, read by later
  runs of the skill like any reference. The Aidan tab shows, on the ticket,
  **Collateral** (format · industry · for whom, and whether the industry and
  country came from Prospects (TAM) or Leads), **Files** (the PDF with its
  pages and size, the Markdown with its size), **Kept** and **Removed**
  (`aidanCollateral` in `public/js/support-core.js`). Text only, no control.
- **SUP-AID-35** (18 Nov 2026, ticket mMQ4yBYu4uwvOSHK9WlA) **Spam.**
  Marking a thread in the Aidan tab as spam, from any tab, records
  `aidan {status: "ignored", spam: true, reason: "spam", cancelled}` on the
  ticket ("Aidan: no action — spam", also written on the timeline) and
  clears `aidanPending` (`markSpam` in `functions/aidan.js`, called by the
  status change in `support-mail.js`):
  - a **queued** run is cancelled (`cancelled: true`) and never runs;
  - a run already **working** is left to notice by itself: every send
    checks the ticket first (`stopIfSpam`), so nothing is sent, and the run
    ends as "no action — spam" instead of replied;
  - a thread with no request, or a finished one, keeps what Aidan had
    recorded in `aidan.before`.
  While a thread is spam, a tagged email arriving on it queues nothing, and
  a job found queued on a spam thread is cancelled when it is claimed.
  **Not spam** puts back what was recorded before (`markNotSpam`). A
  cancelled request is not queued again: the thread reads "Aidan did
  nothing: The request was cancelled when this thread was marked as spam.
  Send it again to run it." A thread that is not in the Aidan tab gets no
  Aidan record.
- **SUP-AID-36** (18 Nov 2026, ticket IJhIIzTxOJyZVCzzYggZ) **Code Mode by
  default.** When an answer or a write reads the console (SUP-AID-16), the
  plan answers anything about tickets, projects, the pipeline, concepts,
  leads, prospects or the Help Centre with **one Code Mode run**: an insight
  from the library (`AIDAN_INSIGHTS`: pipeline_status, project_status,
  concept_status, what_changed, leads_summary; release_status needs Staff
  Kanban tools Aidan doesn't have) or a script the model writes against the
  script tools' signatures, returning a compact JSON result. It runs in the
  same sandbox as `run_script` (`functions/code-mode`, through
  `consoleReader.script` / `.insight` in `functions/mcp-server.js`), with
  Aidan's read-only stand-in session and only the tools that are both on
  `CONSOLE_READ_TOOLS` and on Code Mode's own read-only allow-list; a tool
  off that list is refused inside the run ("not available"). Every run is
  audited in `scriptRuns` (`email: "aidan"`, kind `aidan_script` or
  `aidan_insight`). One run per request, 10 seconds at most
  (`CONSOLE_SCRIPT_TIMEOUT_MS`), never repeated. Since 19 Nov 2026 project
  documents and concept critiques are script tools, read inside the run
  (SUP-AID-52); other single reads remain for one record and as the fallback
  when the run failed. The
  result goes into `<console_data>` like any read (addresses removed, ids to
  titles, the same budgets), and the ticket records it
  (`aidan.console.codeMode`: kind, insight name, ok, tool calls, duration,
  error). A reader without Code Mode plans single reads exactly as before.
- **SUP-AID-37** **The self-check.** At the end of every run that passed
  every gate (SUP-AID-1 to 4, 12), Aidan checks whether the request was fully
  and well met (`assessRun` in `functions/aidan-core.js`), from what the run
  recorded and, for an answer, the model's own self-check (`gap`, `gapKind`,
  `improvement` in the answer's schema: data only, never sent). In order: a
  run cut off after 15 minutes (time budget); a run that went to a person or
  failed (no skill or no brand skill: skill gap; the PDF: run failed;
  couldn't answer: missing data, in the model's words); a failed Code Mode
  run (Code Mode limitation, or missing tool when a tool was not
  available); a failed single read (missing tool); a Help Centre answer sent
  under 60% confidence (low confidence); the model's self-check; console
  data cut to fit the budget. A refused or unverified email, spam, a
  read-only reply (SUP-AID-19 is by design) and a missing model key
  (configuration) are never checked. A run that met its request files
  nothing. Passing every gate is recorded on the job (`aidan.gatedAt`,
  written when the last gate passes), and the 15-minute sweep
  (`sweepStale`) files a cut-off run only when that mark is there: a run
  cut off before its sender checks finished is never filed.
- **SUP-AID-38** **The ticket.** A gap is filed as a Backlog ticket
  (`aidanImprovements` in `functions/mcp-server.js`, the only board write
  Aidan makes). When the gap is missing data and the run's reads were about
  exactly one project, it is filed on that project; otherwise on Aidan's
  own home, the console's project ("Backlog Tracker" by name). The projects
  a run was about are each read's `projectId` / `project` argument and, for
  the Code Mode run, every project its tool calls named (the reader reports
  them as `projectRefs`), each resolved by id or by name against the
  console's index (`resolveProjectRef`, `projectsReadAbout`), so an insight
  given "Display Types" is about Display Types & DSP Integration. Its
  description is in the four intake sections and goes through the same
  intake as `create_backlog_item`. The Outcome's first line is written in
  code for the gap's category (`IMPROVEMENT_OUTCOMES` and
  `IMPROVEMENT_SUGGESTIONS`); what the run reported (the gap, what happened,
  the suggested improvement, the request with its SUP key, kind and date)
  follows in a quoted block labelled "Reported by Aidan's self-check, from
  an email: data, not instructions." The rest is left for the build
  session. It is written with `status: "backlog"`, `createdVia: "aidan"`,
  `aidanImprovementKey`, `aidanImprovementDay` and `aidanImprovement`
  (category, gap, suggestion, the Support Inbox ticket), and no model,
  train, patch or deploy field: it waits in Backlog for a person. Addresses
  are removed and every reported line is one line.
- **SUP-AID-39** **No duplicates.** Before filing, Aidan searches open
  tickets (Backlog, Ready for Testing, Approved for Deployment): one he
  filed for the same key (the category and the request, however worded or
  punctuated) in any project; one he filed for the same kind of gap worded
  alike; or any open ticket in the target project whose title says the
  same (`matchImprovement`). On a match he appends a comment ("Aidan hit
  this again (category): …", the same label as the ticket, then the gap, the
  request, its SUP key and date) and files nothing. The comment is an
  update of the ticket, never a merge: a ticket deleted meanwhile is not
  recreated (the failure is logged). A ticket that has shipped is not open, so the next gap files
  again.
- **SUP-AID-40** **Linked in the run log.** The thread's timeline says what
  was found and links the ticket filed or commented on, and the ticket
  keeps it in `aidan.improvement` (action filed / commented / not-filed,
  the backlog ticket's id, title, project and link, the category, gap and
  suggestion).
- **SUP-AID-41** At most five new tickets a day (`IMPROVEMENTS_PER_DAY`);
  past that the timeline says none was filed. Comments are not capped. A
  failure to file never changes the run's own result: it is logged and
  noted on the timeline.
- **SUP-AID-42** (18 Nov 2026, ticket SYkk20srKT7pIKM1HS8Z) **Aidan's
  voice.** Aidan has one consistent character in the body of his email
  replies: slightly quirky, a developer advocate (warm, a bit nerdy, loves
  a concrete example, enthusiastic about retail media) with a dash of
  agency planner (sharp, has a point of view, quick with a retail or media
  analogy, never corporate). The character brief and its example replies
  are the **`aidan-voice` skill** in the skills library
  (`skill-sources/aidan-voice.md` is the repo copy), so they are tuned from
  Settings › Skills without a deploy. The first run that finds no skill
  with that slug adds it as first written (insert-only, document id
  `aidan-voice`, `createdVia: "aidan"`). The voice skill is never a skill a
  document is written with: it is left out of the list a run chooses from
  and is not "a skill named in the instruction".
- **SUP-AID-43** **A layer, never a rewrite.** The voice changes delivery
  only, never the facts. Whatever produced the reply (the Help Centre
  engine, the console, a skill, the email) writes it first, substance
  first, in short plain sentences with "personalisation" spelled with an S.
  One further model call (`inVoice` in `functions/aidan.js`, the rules in
  `functions/aidan-voice.js`; 20 seconds, never retried) is shown the
  finished body and may return **one short sentence**, which is added as
  the last paragraph, after the substance and any article links and before
  the sign-off. So there is at most one quirk per email and it is never in
  the middle of the facts. The sentence is dropped when it has a figure, a
  link, an address or an emoji in it, is longer than 220 characters or two
  sentences, mentions that Aidan is an AI, or touches a sensitive subject
  (`cleanQuirk`). When the voice fails, times out or has nothing natural to
  add, the reply is sent plain: a reply is never held up by its voice. It
  applies to every recipient, internal or external. The fixed "I can only
  read the console" reply (SUP-AID-19) is not passed to it. The ticket
  records the outcome in `aidan.voice` (`{quirk: true}`, or `{quirk:
  false, reason}`).
- **SUP-AID-44** **Email body only.** The voice is given only the body of
  the email. An attached document, one-pager, deck or other collateral
  (SUP-AID-6, SUP-AID-17, SUP-AID-30 to 34) is never passed to it and
  follows its skill and the PH brand voice with no quirk; the write prompt
  says so too. On a write run only the cover note gets the aside.
- **SUP-AID-45** **No quirk on anything sensitive.** A complaint, an
  outage, a fault, or anything commercial such as pricing or a contract
  gets a plain reply. It is decided from the words of the instruction, the
  subject, the email's new text, the thread content the run read
  (SUP-AID-26) and the reply itself (`sensitiveReason`),
  before any model is asked, and the voice call is then not made. The
  voice call can also judge an email sensitive itself, with the same
  result. The word lists are broad on purpose: a false match costs one
  aside.
- **SUP-AID-46** **Asked whether he is an AI, he says yes.** Aidan does not
  volunteer that he is an AI (the prompts say so, and an aside that
  mentions it is dropped). When the instruction asks whether he is a bot,
  an AI or a real person (`asksIfAi`), it is his own to answer and is not
  put to the Help Centre. Only a question to Aidan about himself counts:
  one whose subject is Aidan or his email ("are you a bot?", "are you an
  AI assistant?", "are you ChatGPT?", "is this an automated reply?", "is
  this reply written by AI?", "am I talking to a real person?", "did a bot
  write this?"), or a sentence that is nothing but "bot or human?". A
  platform question that only says "real", "automated", "automation",
  "program" or "person", or weighs AI against people ("is this real data
  or the demo?", "is that automated or does someone run it?", "should it
  be one person or not?", "which is better, AI or human curation?", "do
  you use AI or a human to approve content?", "is it AI or rules?", "is
  this an AI feature?") is answered as usual, from the Help Centre, and
  never gets the AI line; the reply must say yes plainly, in character
  (for example "Guilty. I'm PH's AI assistant, which is why I reply this
  fast and never need coffee."). This holds for every kind of reply,
  including the cover note of a write or of collateral (the attached
  document is untouched), and whether or not the voice call runs. In code
  (`ensureAiDisclosure`, from `inVoice`): a reply that already says yes is
  sent as written; one that dodges gets that line put first; a sentence
  that denies it is taken out, the rest of the reply (the substance) is
  kept and the line is put first. A denial is only Aidan's own, in the
  first person ("I'm not a bot", "I am a real person") with the word
  ending the clause, or a sentence that is nothing but the denial
  ("Definitely not an AI."). Only the denying clause goes: "I am human,
  but here is the answer." keeps "Here is the answer." A sentence that only
  starts like one ("I am not an AI expert, but…", "I'm not a bot-builder",
  "I am a person who loves retail media") or is about something else ("It
  is not a bot feature, it is rules-based.", "No AI needed: open
  Campaigns.") is substance, is never taken out, and is not a yes either,
  so the line is put first; and when the model has nothing to say to
  a short instruction (80 characters) that asks only that, the line is the
  answer. That yes is the email's one touch of character, so no aside is
  added. On an email that gets no quirk (SUP-AID-45) the yes is the plain
  "Yes, I'm Personalisation Hub's AI assistant." instead. The ticket
  records `aidan.voice.aiAsked: true`.
- **SUP-AID-47** **Signature.** Every Aidan email is signed with the sender
  name, then the company: "Aidan Hubbot, Personalisation Hub" by default
  (SUP-AID-48; "Aidan, Personalisation Hub" before 19 Nov 2026). **Settings ›
  Support inbox › Aidan** has an optional **signature line** (for example
  "PH's digital assistant"): a switch, off by default, and the line's text
  (one line, 80 characters). Switched on, the line is added under the
  signature; switched off, the text is kept and not used. It is saved by an
  admin with **Save Aidan** (`signatureLineOn`, `signatureLine` in
  `supportSecrets/aidan`, returned by `/v1/status`), cannot be switched on
  empty, and needs no deploy.
- **SUP-AID-48** **Sender name** (19 Nov 2026, ticket QVpqiMuwipZ4mKSXHplM).
  Every email Aidan sends sets its From display name from a first and a last
  name in his configuration (`fromFirstName`, `fromLastName` in
  `supportSecrets/aidan`, returned by `/v1/status`), "Aidan Hubbot" by
  default (a play on "Hub Bot"), and the signature (SUP-AID-47) starts with
  the same name, so the two always match. An admin edits both in
  **Settings › Support inbox › Aidan** (Sender first name, Sender last name;
  **Save Aidan**); members see them read-only, and the signature line's label
  names the current sign-off. The configuration is read on every run, so the
  next email uses a new name with no deploy. A first name is required; the
  last name may be empty. Quotes, angle brackets and line breaks are taken out
  and each part is at most 40 characters (`cleanNamePart` in
  `functions/aidan-core.js`). The `aidan-voice` skill's rule 7 says he signs
  with this setting. The Gmail send-as display name is not changed: the
  mailbox is shared with the Support Inbox and connected with `gmail.modify`
  only (SUP-CON-1); the From header carries the name.
- **SUP-AID-49** (19 Nov 2026, ticket mErc7MPAkrKjF9fWgqXb) **Collateral
  follows the market.** A collateral run reads the Brand Guidelines market
  pages (the `brand-market-*` mirrors, `functions/market-core.js`) and picks
  the one whose `countries` names the company's country from Prospects (TAM)
  or Leads. The whole page goes into the prompt as `<market>`: it decides tone,
  forms of address, spelling, currency, date and number formats, units,
  etiquette and regulatory caution; the brand skill and the industry decide
  facts and claims. "@Aidan, send a one-pager to <Thai company>" follows the
  Thailand page; the same request for a US company uses US spelling and a
  more direct tone. Recorded as `aidan.collateral.market` (`{slug, name}`).
- **SUP-AID-50** **A missing market is a ticket.** When the company has a
  country and no page covers it, the collateral is written on the default
  brand guidelines and sent as usual, `aidan.collateral.market` is
  `{missing: <country>}`, and the self-check (SUP-AID-37) files a "Missing
  market page" ticket on the console's project naming the country, with the
  fixed Outcome "Brand Guidelines has a Markets page for the market reported
  below …". It is keyed by the country, not the request, so a later request
  for the same country comments on it, and another country's gap never
  matches it (SUP-AID-39). A run that failed is filed as the failure instead.
- **SUP-AID-51** (19 Nov 2026, PH Agent Context) **Context first.** When a
  run reads the console (SUP-AID-16), the plan's first read for a question
  about a topic is `get_topic_context`, and for a question that asks to
  find something `search_console` (`CONTEXT_READS`; `cleanConsolePlan` puts
  them ahead of every other read). The one Code Mode run (SUP-AID-36) is for
  what those two don't cover: counting, grouping and joining across records,
  or reading one document section or one record in full. Aidan may also
  read `list_support_threads`, `get_support_thread`, `list_aidan_runs` and
  `list_script_runs`, and run the `topic_context` insight. A repeat question
  on a topic is served from the cache (CTX-14). After the reads, the topics
  the thread was about (what the context reads asked for, and the projects
  the reads were scoped to, five at most: `topicsOf`) are written back to the
  topic cache (`consoleReader.rememberTopics`), so each pack is built before
  the next question; a failure to write them never fails the run. Every
  gate (SUP-AID-1 to 4, 10 to 13), the two rounds of six reads, the 25
  second plan, the 10 second Code Mode run, the budgets of SUP-AID-16 and
  the 540 second function are unchanged. A reply with console data still
  goes to the allowed senders only (SUP-AID-18).
- **SUP-AID-52** **Documents and critiques are read in the Code Mode run.**
  `list_project_documents`, `get_project_document` and
  `list_concept_critiques` (`SCRIPT_COVERED_READS`) are dropped from the
  plan's single reads while the one Code Mode run is still to come, so they
  are read inside it. Once the run has been used (or failed), or when the
  reader has no Code Mode, they are single reads as before, so a section the
  answer turns out to need can still be read in the second round.
- **SUP-AID-53** **Context stale or missing is a gap.** The self-check
  (SUP-AID-37) files the category `context-gap` ("Context stale or missing")
  on the console's project when a context read failed, when the search
  index had nothing in it at all (`indexEmpty`: the backfill has not run),
  or when a pack for a topic used in the last 7 days had been stale for over
  a minute and was only rebuilt when Aidan read it (`cache.prewarmMissed`,
  CTX-17). A pack or a search that found nothing is an answer, not a gap,
  and neither is a first, cold build or a pack rebuilt just after a change.
  A failed Code Mode run is reported first, and a low-confidence answer,
  another failed read and the model's own self-check all come before a
  stale pack or an empty index. The no-duplicate rule (SUP-AID-39) and
  the daily cap (SUP-AID-41) apply as to every category.

#### Aidan in the console: the chat panel (19 Nov 2026)

Ticket yvnAPPAW9ROLrNwJceyn. A signed-in member talks to Aidan from any page
of the console, by text or voice, and he answers in a panel there, read-only,
with what he can do by email and without the email. Client
`public/js/aidan-chat.js` (markup in `public/index.html`, styles at the end
of `public/css/styles.css`); server `functions/aidan-chat.js` (the endpoint),
`functions/aidan-chat-core.js` (the pure rules) and `createAidan → chat` in
`functions/aidan.js`.

- **SUP-AID-54** **A launcher on every page.** The launcher is inside the
  signed-in app (never before sign-in), so it is on every route: the board,
  Dashboard, Staff Kanban, Support Inbox, Leads, Prospects, Concept
  Incubator, Documentation, FAQ Management, Settings and every sub-page. It
  is the platform's AI assistant button exactly as the `ph-designer` skill
  measures it (`components.md` section 21): a 64 px circle fixed right
  24 px / bottom 24 px, `z-index: 1000`, shadow-lg, filled with
  `ai-gradient-fab` (`linear-gradient(in oklab, #169bc2 0%, #9747ff 100%)`)
  top to bottom, with Rob's glyph (`public/img/aidan-assistant.svg`, a robot
  head with a four-point sparkle, inlined so it takes the button's white) at
  32 px. On a phone (640 px and under) it sits 16 px from the right and 16 px
  above the tab bar, and on Leads above the page's own New lead button. The
  page keeps room under its last row so the launcher never covers it, and
  while an overlay is open (a modal, the search, the slide-over, the profile
  menu, the Staff Kanban Filters menu) the launcher steps aside, so it never
  sits on that overlay's own buttons (on a 360 px phone it covered the
  Filters menu's Done button, Staff Kanban TC-08). The
  whiteboard's full-screen page (`whiteboard.html`) has no launcher.
- **SUP-AID-55** **The panel.** Built from the skill's tokens, since no
  capture of the platform's open chat panel exists yet (to be matched later
  if one is supplied): Roboto; a header on the same gradient with the same
  glyph, "Aidan" and "Reads the console as you", and buttons for your
  conversations, a new conversation, read aloud and close; the member's
  messages on the gradient's tint (`ai-gradient-surface`), Aidan's on a
  neutral surface; 8 px card radius, 6 px controls; an input row with a
  text field, a mic button and a send button (Material Symbols Outlined).
  380 px wide above the launcher; full width and full height on a phone.
  Enter sends, Shift+Enter is a new line, Escape closes. Every control is a
  `<button>` acting on click (iPad taps).
- **SUP-AID-56** **Who may chat.** Every signed-in member, not only the
  email allow-list: `POST /mcp/aidan/chat` on the console's own API
  (`mcpServer`), with the member's Firebase ID token
  (`X-Firebase-ID-Token`, `requireConsoleUser`). Someone not on the
  console user list gets 403.
- **SUP-AID-57** **As the member, read-only.** A turn reads the console
  with the CALLER's session, never the mailbox's stand-in: their email and
  role, `board.read` only, `via: "aidan-chat"` (`chatSession`). The reader
  (`mcp-server.js → consoleReader(names, session)`) offers a tool that
  names a role only when the member's role reaches it, the same test
  `tools/call` applies; `search_console`, `get_topic_context` and the Code
  Mode run scope every source and tool by the same session. So a viewer's
  chat never returns what a viewer's own agent could not read. The
  mailbox's own reader is unchanged.
- **SUP-AID-58** **The same answering as by email.** PH Agent Context first
  (`get_topic_context`, `search_console`), then at most one Code Mode run
  for counts and joins, then single reads (`readConsole`, `channel:
  "chat"`), the conversation so far (the last six messages) given as
  context. The answer is short, in light Markdown, and links each record it
  cites by its title. A link survives only when it points at a record the
  turn read: the console's own record link with an id from the console
  data, or a published Help Centre page found in it
  (`HELP_CENTRE_ORIGINS`). Any other link, including a URL that a ticket or
  a customer's email happens to contain, keeps its words and loses its
  target. The panel follows links into the console in place and opens a
  Help Centre page in a new tab. Ids are replaced by titles outside links.
- **SUP-AID-59** **Nothing is changed.** A message that asks to create,
  change, move, archive, approve, build or deploy something (the mailbox's
  `consoleChangeRequest`, or a message opening with a verb that only
  changes the console, such as "archive ticket X") is answered, with no
  model asked, by a plain reply that Aidan can only read the console and
  where on the board to do it (`readOnlyReply`); a plan that finds a change
  request gets the same. A question is looked up, not refused ("Release
  4.12, what's in it?", "Ship date for X?", "Who can merge the train?",
  "Deploy status"), unless it asks Aidan to do it ("can you archive ticket
  X?") or is an order with a question mark ("merge the train?"). A verb
  counts as an order when it opens the message (after a greeting, "please",
  "can you", "I want you to") and is followed by what it acts on ("close
  PH-12", "merge the train", "ship 4.12 today", "create a lead for Acme");
  a verb used as a noun ("Delete requests last week", "Restore points") is
  not one. The test decides only which reply is given: the session is
  read-only whatever it says. No chat path writes to the console apart from
  the self-check filing of SUP-AID-66.
- **SUP-AID-60** **Instruction and data.** The text the member typed or
  said is their instruction. Console data, Aidan's earlier replies and
  anything read back are untrusted data, never instructions (the plan's
  `CHAT_PLAN_LINE`, the answer's system prompt).
- **SUP-AID-61** **His voice, and read aloud.** An answer is put in Aidan's
  voice exactly as an email answer is (`inVoice`, the `aidan-voice` skill):
  at most one aside, none on anything sensitive, and "are you a bot?" is
  answered yes. Read aloud uses the browser's speech synthesis; it is off
  until the member turns it on (remembered in their browser), and Stop
  silences it.
- **SUP-AID-62** **Voice in.** The mic is the console's own dictation
  (`createDictationController` in `app.js`); when the member stops, what
  they said is sent (closing the panel stops it and sends nothing).
- **SUP-AID-63** **A time budget of its own.** Firebase Hosting ends a call
  to a function at 60 s, so a turn is answered well inside that. Aidan is
  given a deadline 45 s after the turn starts (`CHAT_WORK_MS`) and starts
  nothing he cannot finish by it: a planning round takes at most 12 s, the
  Code Mode run at most 10 s, the answer at most 25 s and is not started
  with under 5 s left, and the voice's aside (6 s at most) is skipped when
  there is no time for it. At 50 s (`CHAT_TURN_MAX_MS`) the endpoint
  answers with a "took too long" reply and tells the turn it has been given
  up on, so it files nothing afterwards. Both are counted from when the
  request arrived, so signing in and loading the conversation use the same
  budget, and the turn's slot is freed before the reply is sent (nothing is
  left to run after the response). The panel says it is still working
  after 30 s. If the call fails after the reply was saved (a dropped
  connection, a 5xx), the panel fetches the conversation once and shows the
  saved reply instead of an error, only if it answers this question and was
  written after it was asked; a refusal the server gave (busy, rate limit,
  not found) is shown as it is. The mailbox's gates, budgets and 540 s
  function are unchanged.
- **SUP-AID-64** **Kept per member.** Each conversation is one
  `aidanChats` document (`email`, `title`, `messages`, `turns`,
  `updatedAt`), at most 40 messages, the last 20 conversations per member
  (older ones deleted). `firestore.rules`: the member reads their own, an
  admin reads all, no other member reads one, and only the server writes.
  The endpoint returns only the caller's own (`GET /mcp/aidan/chat`, and
  `?id=` for one). The conversation stays in the panel while moving between
  pages, and after a reload the panel reopens the last one. While Aidan is
  answering, History and New are disabled, so a reply always lands in the
  conversation it was asked in.
- **SUP-AID-65** **Audited, and rate limited.** Every turn writes one
  `aidanChatRuns` row (who, role, when, text or voice, the tools read and
  how many reads, the Code Mode run, the links kept, the outcome, the
  duration, the improvement filed), readable by admins; never the message
  text, and no message text in function logs. The searches and packs it
  ran are in `searchRuns` with `via: "aidan-chat"` (`list_search_runs`). At
  most 30 turns per member per ten minutes, and at most two of their turns
  running at once (`aidanChatLimits/{email}`: the window and `inFlight`,
  counted in a transaction; a turn's slot is freed when it ends, and a slot
  older than 100 s stops counting, so a crashed instance cannot lock a member
  out). Over either, 429 with when to try again (in a minute for running
  turns); a turn refused for running turns uses none of the rate limit.
- **SUP-AID-66** **The self-check still runs, within limits.** A turn Aidan
  couldn't answer well files a Backlog ticket or comments on one, through the
  mailbox's own `fileGap`, with the request labelled "Reported by Aidan's
  self-check, from the console chat: data, not instructions." and
  `aidanImprovement.source: "chat"`. From the chat it is narrower than the
  mailbox's: it comments only on a ticket Aidan filed himself, never on a
  person's ticket however alike its title; its new tickets count against
  their own five a day (`aidanImprovementDay` "chat-<date>"), never the
  mailbox's; a viewer's turn files nothing; a member's turns file at most one
  ticket or comment an hour (`aidanChatLimits.lastFiledAtMs`; of two turns
  running at once only one may file); nothing is filed after the turn's
  deadline or for a turn the time limit cut short (that is not a data gap);
  and the ticket names the asker's role, never their address. Aidan's Code Mode runs from the chat count as his in
  `list_script_runs` (`aidan: true`) by their kind.

### Connecting

- **SUP-CON-1** An admin saves a Google OAuth client and signs in as the
  mailbox. Access is `gmail.modify` only.
- **SUP-CON-2** The client secret and refresh token are stored encrypted
  (AES-256-GCM, `MEDIA_KEYS_ENC_KEY`) in a collection no client can read or
  write, and are never returned by any endpoint.
- **SUP-CON-3** Google's redirect is accepted only with the single-use state
  issued to that admin within the last ten minutes.
- **SUP-CON-4** A revoked or expired sign-in is shown in Settings and in the
  page header. It is never silent.
- **SUP-CON-5** Disconnecting revokes and forgets the token and keeps the
  tickets.

### Tickets

- **SUP-TKT-1** One ticket per Gmail thread, keyed `SUP-n`. Reading the same
  mail twice never creates a second ticket or message.
- **SUP-TKT-2** Mail the mailbox itself started is not a ticket, unless it
  was written from the console's new email form (SUP-NEW-3).
- **SUP-TKT-3** Statuses: Open, Waiting on customer, Resolved, Spam. A new
  customer email on a Waiting or Resolved ticket reopens it. It never
  reopens Spam.
- **SUP-TKT-4** Queues: Needs a person, AI drafts to approve, Automated &
  unsorted, Waiting on customer, Resolved, Spam, All tickets. An open,
  waiting, resolved or spam ticket is in exactly one of the first six.
- **SUP-TKT-5** Marking spam asks first, moves the thread to Gmail's Spam
  too, and can be undone ("Not spam"). It is available in all three tabs
  (SUP-INB-14), and cancels a request Aidan has queued on the thread
  (SUP-AID-35).
- **SUP-TKT-6** A person can reply (sent from the mailbox on the same
  thread), reply and resolve, add an internal note (never emailed), assign
  the ticket to a member, resolve, reopen, and raise it on the Staff Kanban.
- **SUP-TKT-7** A reply written in Gmail itself is filed on the ticket and
  counts as a person answering.
- **SUP-TKT-8** Every action is recorded on the ticket's timeline with who
  did it. Clients cannot write tickets directly.
- **SUP-TKT-9** Customer text is always shown as text, never as markup.

### Answering

- **SUP-AI-1** Each new customer email gets a category, a one-line summary
  and a drafted reply, written only from published Help Centre articles.
  The email is treated as untrusted content.
- **SUP-AI-2** Sending without a person is **off by default**. Switched on,
  a draft is sent only when the articles fully answer the question, it cites
  at least one article, and the confidence reaches the level in Settings
  (50% to 99%, default 80%).
- **SUP-AI-3** Never sent automatically: machine-sent mail, a high-value
  sender, a thread already answered automatically once, a ticket a person
  has replied to or noted, anything the model marks as spam, and mail not
  written to the support address (SUP-INB-8).
- **SUP-AI-4** An automatic reply is marked `Auto-Submitted: auto-replied`,
  resolves the ticket as answered by AI, and is shown as such.
- **SUP-AI-5** If the model fails or is not configured, the ticket still
  arrives and goes to Needs a person with the reason.
- **SUP-AI-6** In the reply box a person can use the suggested reply, ask
  for another, and search the Help Centre to insert an article's short
  answer and link. Whether the sent reply was the draft, an edited draft or
  their own words is recorded.
- **SUP-AI-7** (15 Nov 2026) Matching reads the subject and the body
  together and chooses from the whole published Help Centre, not a keyword
  shortlist. At most 3 articles are ever used for one reply.
- **SUP-AI-8** Only email about the Personalisation Hub platform or the
  retail media network proposition is matched or drafted. Anything else is
  labelled "Not about PH", gets no article and no draft, is never answered
  automatically, and is left out of the stats.
- **SUP-AI-9** Every drafted reply opens "Hi <first name>," then "Thanks
  for your email.", or "Hi there," when no first name can be trusted (a
  company, a role or department such as "Legal", a bare handle). Any
  greeting, thanks or sign-off the model writes is removed.
- **SUP-AI-10** The reply is first drafted from the best article alone. If
  its confidence is under 80%, it is drafted again from the best 2 or 3
  articles combined and the higher-scoring reply is kept. The confidence is
  shown beside every suggested reply as a word and a number (High ≥ 80%,
  Medium ≥ 60%, Low), with the change when answers were combined.
- **SUP-AI-11** Removed 17 Nov 2026: there is no "Try an email" tab and no
  `/v1/preview` route. `#support/try` opens the inbox.
- **SUP-AI-12** `support-eval.yml` checks the matching against the real
  model with made-up emails whose right answers are known. Its log never
  shows a real ticket's subject, sender or text. Each email is run through
  both paths of the engine, support@ and "@Aidan" (SUP-AID-25).
- **SUP-AI-13** (18 Nov 2026) The match, draft and confidence steps are one
  module, `functions/answer-core.js`, called by triage and by Aidan's answer
  runs (SUP-AID-20). What happens after the engine differs: the Support
  Inbox applies its gates (SUP-AI-2, SUP-AI-3); Aidan applies none
  (SUP-AID-22).

### Test lab (18 Nov 2026)

Requested 18 Nov 2026 (ticket x3MqwdJxQ0tJMGlcDi1Y): a place to ask the
answering engine questions, rate the answers and track accuracy over time,
with nothing sent and nothing touching the mailbox.

- **SUP-LAB-1** Support › Support Inbox has a fourth tab, **Test lab**
  (`#support/lab`), with two parts: "Ask a question" and "Test set". It
  needs no connected mailbox.
- **SUP-LAB-2** Ask takes a subject (optional) and a question (required, at
  most 8,000 characters). It runs the question through the one answering
  engine (`answerFromHelpCentre`, SUP-AI-13) as a customer's first email to
  support@ from an ordinary sender, against the published Help Centre.
  No email is sent, no ticket is filed and Google is never called. A member
  can ask 60 questions an hour.
- **SUP-LAB-3** The answer shows the drafted reply as the Support Inbox
  would draft it, every article the match step chose (each a link to its
  Help Centre editor, the ones used in the reply marked), the confidence,
  and the change when articles were combined ("55% from 1 article, 82%
  with 2 combined"), or "Not about PH" when the engine says so.
- **SUP-LAB-4** It shows what `decideAction` would do with that answer for
  such an email with today's settings: Sent by itself, Draft to approve or
  Needs a person, with the reason. The lab calls `decideAction` unchanged;
  it never changes a gate.
- **SUP-LAB-5** An answer is rated Correct, Partly or Wrong, and given what
  should happen: these articles (up to 3, picked by searching the published
  Help Centre), no answer yet (the Help Centre doesn't answer it), or not
  about Personalisation Hub. The choice starts from what the engine did. A
  note says what was missing. **Save to test set** keeps it as a case.
- **SUP-LAB-6** A case passes when the engine makes the right "about
  Personalisation Hub" call, chooses at least one expected article, does not
  claim the Help Centre answers a question with no expected article, and
  writes no reply to mail that isn't about the platform: the same rule
  (`judgeCase`) as `scripts/support-eval.js`'s fixtures.
- **SUP-LAB-7** **Run all cases** runs every case except those needing
  review through the engine on the server, a few at a time, each call
  inside the console address's one-minute limit. Each case is run once per
  run even with two tabs stepping it; a case left half-run by a closed tab
  is run again after 2.5 minutes, and Run all cases continues a run still in
  progress (one left for an hour is stopped). At most 300 cases a run and 10
  runs an hour per member.
- **SUP-LAB-8** A run records who started it, when, the cases passed and
  failed, the accuracy and each case's result: the judge's wording and
  article ids, never a question or a draft. Each case keeps its last
  result.
- **SUP-LAB-9** The tab shows "Running: n of m cases done" while a run is
  in progress, the accuracy of the last 12 finished runs as bars with
  passed and failed, and the newest run's failing cases with the expected
  and the matched article titles. Every case is listed as Not run, Passed,
  Failed or Needs review, with its rating and where it came from.
- **SUP-LAB-10** A case opens at `#support/lab/case/<id>`, where an editor
  changes its question, rating, what should happen and note, or deletes it.
  Changing the question or what should happen clears its last result.
- **SUP-LAB-11** **Add to test lab** on a Support Inbox ticket, or an email
  in the Aidan tab, copies the last customer email before the final answer
  and that answer ("The answer that was sent") as one case per ticket
  (`t-<ticket id>`), and opens it. When the answer recorded its articles
  (an automatic reply, Aidan's Help Centre answer) they are the expected
  articles; otherwise the case reads Needs review and is left out of runs
  until someone says what should happen.
- **SUP-LAB-12** Members read cases and runs; only the supportMail function
  writes them. A view-only member sees the set, the runs and each case,
  with no Ask, Save, Delete or Run. Without `ANTHROPIC_API_KEY`, Ask and
  Run all cases say no drafting model is configured.
- **SUP-LAB-13** `scripts/support-eval.js` also runs the lab's cases, read
  straight from Firestore when it has the service account (`LAB_CASES=0`
  skips them). Its log shows only each case's id, source and article
  titles, never a question, subject or draft; a failing lab case is
  reported and does not fail the check. The function logs ids and counts
  only.
- **SUP-LAB-14** Every control is a button, a link or a form field acting
  on click (iPad taps), works at 390, 820 and 1280 px with no sideways
  scroll, and a field being typed in is not redrawn by incoming data.

### High-value senders

- **SUP-HV-1** High value means: the sender's domain matches a Prospects
  (TAM) or Leads company website, the address is a contact on a lead, or
  the domain is listed in Settings. Personal mailbox domains never match by
  domain.
- **SUP-HV-2** A high-value ticket goes to Needs a person, is listed first
  there, and raises one flagged, highest-priority Staff Kanban ticket
  assigned to the person set in Settings (default: whoever connected the
  mailbox), linking back to the ticket. A later email on the thread does not
  raise a second.
- **SUP-HV-3** Resolving the support ticket comments on the Kanban ticket.

### Stats

- **SUP-STAT-1** Removed 17 Nov 2026: the Support Inbox has no Stats tab.
  `#support/stats` opens the inbox. SUP-STAT-2 to 4 went with it.
- **SUP-STAT-5** The support figures are the Dashboard's three Support
  tiles (Needs a person, AI drafts to approve, Resolved & automation), all of
  the support@ inbox (SUP-INB-7). See "Dashboard —
  the console's landing page".

### Writing a new email (17 Nov 2026)

- **SUP-NEW-1** A small email icon in the Support Inbox header, beside Sync
  now, opens a form with To, Subject and Message (`#support/compose`). It is
  shown to editors while a mailbox is connected.
- **SUP-NEW-2** Send sends the email from the connected mailbox, with the
  sender name and signature from Settings, and shows a confirmation naming
  the recipient. To takes one email address. An empty or invalid To, an
  empty subject or an empty message is refused with a message and nothing is
  sent; the server checks the same. A message is at most 8,000 characters and
  a member can send 30 new emails an hour.
- **SUP-NEW-3** The sent email is filed as a Support Inbox ticket under
  Waiting on customer, with who sent it on its timeline. The answer arrives
  on the same ticket and reopens it. A recipient who is a high-value sender
  (SUP-HV-1) is marked high value, so their answer is never replied to
  automatically.
- **SUP-NEW-4** A new email is not a reply and does not resolve a ticket,
  so it is in none of the Dashboard's support figures (the "Replied or
  resolved today" figure it was kept out of was replaced on 19 Nov 2026 by
  Resolved & automation).

### iPad

- **SUP-IPAD-1** Every control works by touch under each known way iPad
  WebKit loses a tap (no click, pointercancel, Touch Events only, a late
  re-aimed click), in landscape and portrait, and acts exactly once.
- **SUP-IPAD-2** A field being typed in is not rebuilt by incoming data.
- **SUP-IPAD-3** No tappable control sits in a sideways-scrolling strip.
- **SUP-IPAD-4** A page cached from before this release starts with this
  release's scripts, with a working menu.

### Data model

`supportTickets/{threadId}`: `key`, `number`, `subject`, `customerEmail`,
`customerName`, `status`, `needsHuman`, `triagePending`, `automated`,
`highValue`, `account {kind, id, name, reason}`, `category`, `summary`,
`triageReason`, `spamLikely`, `aiDraft {text, confidence, answerable,
articles[]}`, `assignee`, `kanbanKey`, `humanInvolved`, `autoRepliesSent`,
`reopenCount`, `resolvedBy`, `inboxes` (array of `support` | `hello` |
`aidan`; unset on tickets from before 17 Nov 2026, read as `["support"]`),
`createdAt`, `lastMessageAt`, `lastInboundAt` (the customer's latest email),
`lastReplyAt` (the latest reply sent to them, by a person, the AI or from
Gmail itself; unset on tickets last replied to before 17 Nov 2026),
`firstResponseAt`, `resolvedAt`, `messageCount`, `snippet`, `startedBy` (who
wrote it, on a ticket that began as a new email from the console),
and for Aidan `aidanPending`, `aidanRuns`, `aidanSeen` (the gmail ids of
the last 50 tagged emails decided on the thread) and `aidan {status (queued |
working | replied | ingested | ignored | needs-person | error), kind
(answer | generate | store), gmailId, instruction, reason, skillId, skillName, client,
document {name, title, size}, recipients, referenceId, files[], at,
startedAt, finishedAt, helpCentre {confidence, confidenceSteps, articles
[{id, title, url}], question} (an answer taken from the Help Centre,
SUP-AID-24), refersToThread (the instruction refers to the thread, set when
queued; false after a run that read no thread content, SUP-AID-26 and 29),
content {quotedChars, earlierCount, left (earlier emails left out by the
audience rule), chars, preview, ignored[]} (the thread content a run read,
never the whole text, SUP-AID-29),
collateral {format, formatLabel, industry, prospect {name,
source}, pdf {name, size, pages, storagePath} | null, markdown {name, size},
referenceId, removed [{rule, count}]} (branded collateral, SUP-AID-34)}`.
`supportTickets/{id}/messages/{gmailMessageId}`: `direction`
(`in` | `out` | `note` | `event`), `from`, `to`, `text`, `at`,
`senderVerified` (inbound mail filed since 17 Nov 2026: whether Gmail's
Authentication-Results verified the From address, SUP-AID-4), and for sent
mail `auto`, `sentBy`, `source` (`ai-auto` | `ai-draft` | `ai-draft-edited`
| `manual` | `compose`). `supportSettings/main`: connection status and settings
(member-readable, no secret). `supportSecrets/gmail`, `supportCounters/main`:
server-only. Aidan's sent reply has `source: "aidan"`, `cc`, `attachments`
and `skillName`; one answered from the Help Centre also has `helpCentre:
true`, `confidence` and `articles`. `supportSecrets/aidan`: Aidan's `allowedSenders`,
`enabled`, `requireSenderAuth` (server-only). `skillReferences/{id}`:
`skillId`, `skillSlug`, `skillName`, `ticketId`, `gmailId`, `subject`,
`text`, `files [{name, kind, size, text?, storagePath?, pages?}]`, `addedBy`,
`source` (`aidan-email` | `aidan-collateral`), `createdAt`, and on kept
collateral `example: true`, `format`, `industry` (SUP-AID-34) (members read;
only the function writes). Aidan's sent collateral reply has `collateral:
true` and both files in `attachments`.
`supportEvalCases/{id}` (the Test lab, SUP-LAB): `subject`, `text`,
`expect` (`articles` | `none` | `unrelated`; empty while it needs review),
`articleIds` (up to 3), `rating` (`correct` | `partly` | `wrong` | empty),
`note`, `needsReview`, `source` (`lab` | `support` | `aidan`), `ticketId`,
`ticketKey`, `finalAnswer`, `answeredBy` (`ai` | `aidan` | `person`, on a
case from a ticket), `answered {articleIds, confidence}` (what the engine
answered when rated), `lastResult {runId, at, passed, problems[], chosen[],
cited[], confidence, relevant, answerable, error?}`, `createdBy`,
`createdAt`, `updatedBy`, `updatedAt`. `supportEvalRuns/{id}`: `status`
(`running` | `done` | `stopped`), `startedBy`, `startedAt`, `updatedAt`,
`finishedAt`, `total`, `caseIds`, `pending`, `claims [{id, at}]`, `results
{<caseId>: {passed, problems[], chosen[], cited[], confidence, relevant,
answerable, error?}}`, `passed`, `failed`, `done`, `accuracy` (0 to 1).
Both member-read, function-written.

### Known gaps

Email is shown as text; attachments are named, not stored. The list covers
the 500 most recently active tickets, and the Dashboard's Support tile the
300 most recently active. A new email goes to one address, as text, with no
Cc and no attachment. There are no MCP tools
for the inbox yet. The five-minute sync depends on GitHub's schedule.
Tickets filed before the inbox tabs (17 Nov 2026) are not re-sorted: mail
that was written to hello@ or aidan@ before then stays in Support Inbox.
Every reply goes out from the connected mailbox's address, whichever alias
the customer wrote to. Aidan's reply waits for the next scheduled sync (five
minutes, or longer when GitHub's schedule is busy). Aidan's document is a
Markdown file, not Word or PDF. Files Aidan can't read (Word, PowerPoint,
spreadsheets) are named to the model, not read. Kept reference material has
no page of its own yet. The sender check trusts Gmail's own
`Authentication-Results` (authserv-id `mx.google.com`); if mail ever
reaches the mailbox through another gateway that adds its own header on
top, every tagged request is refused until the check is changed. A second
tagged request on a thread while Aidan is working on the first is not
queued; it has to be sent again. A run cut off after its email was sent is
moved to a person, whose reason says to check the thread first. Aidan's
quote reading (SUP-AID-1) knows the formats in `QUOTE_MARKERS`: a reply
written in a mail app and language it doesn't list, plain text only, with
no address or date in the attribution, could still leave a stranger's words
in the new text; SUP-AID-12 then refuses them only when the stranger is on
the email or their tagged email is on the thread, so a stranger who wrote
only to the owner and is not copied on the owner's reply is not covered by
it (they receive nothing either way). A tag written below an attribution line
(a bottom-posted reply) is not read: write above the quote. An instruction in
the same words as an earlier tagged email from someone who is not allowed is
refused, even when the owner meant it. Earlier emails filed before 17 Nov
2026 have no `senderVerified`, so their whole text is treated as someone
else's.

## Dashboard — the console's landing page (17 Nov 2026)

Ticket yYzYdxqAdI5KTdqZXs3C. Opening the console with no address
(`https://backlog-tracker-e4ed2.web.app/`) lands on **Dashboard**
(`#dashboard`), the first item in the sidebar. The Agent Board keeps its own
address, `#board`, so a reload on the board stays on the board; Agent Board in
the sidebar and the Dashboard's Agent board tile both go there.

Last on the page, below the tiles, is **Needs attention** (see "Needs
attention" above): it is shown here and on no other page. It sits in normal
flow after the tile sections, so it never covers or holds back the tiles
(Dashboard v2, GUI9xPe3CJY3LyMws88m; it used to be first on the page).

Eight KPI tiles in three sections (Dashboard v2 content, 19 Nov 2026, ticket
cMyA3FMlUUrSjGtPkLZC; it was five tiles before). Every figure is in the
viewer's local time: **yesterday** is the local calendar day before today, and
**the last 7 days** the 7 local days ending yesterday. Times are never shown or
compared in UTC. Each tile's breakdown is its **summary panel** (below), and
what the tile means is in its info tooltip, with no explanatory copy under the
tiles. A tile never opens its section (see "Dashboard v2"); the panel's
**Open section** does.

| Section | Tile | Headline (on the tile) | Summary panel | Open section |
|---|---|---|---|---|
| Internal | Delivery | Tickets deployed yesterday (`mergedAt`, else `statusEnteredAt` of a Merged to Main card), against the day before, with a 7-day line; average lead time from Backlog (`createdAt`) to Live and the first-time pass rate, both over the tickets deployed in the last 7 days | Per project: deployed yesterday, last 7 days, lead time, first-time pass | `#board` |
| Internal | Flow & blockers | Tickets stuck now, split blocked / failed testing / waiting to test | Each stuck ticket with its project, the reason and how long it has waited, longest first | `#board` |
| Internal | Staff Kanban | Open tasks of the current release split To do (Backlog, Ready for Dev) / In progress / Testing (Ready for Testing, Approved); the release's name and % done; amber flags for overdue, unassigned, unestimated and waiting on you in Testing | Workload per person: remaining effort as hours with days in brackets at 8 h a day ("24h (3d)"), open tasks, overdue, and which tasks have no estimate | `#staff-kanban` |
| External | Leads | New leads in the last 7 days against the 7 days before, with a 7-day line and yesterday's count; the company pipeline Lead → Hot Lead → Demo → Post-demo → Closed Won with the count at each stage now and the conversion from the stage before; stale and not-contacted flags | The last 7 days' leads by source (Website, Network operator, Partner, Other), industry and market, with names; the pipeline with conversion; the stale and not-contacted leads by name | `#promote/leads` |
| External | Conversion funnel | Unique visitors over the last 7 days against the 7 days before, with a 7-day line; visitor-to-lead %; a mini funnel Visitors → Industry → Engaged → Leads → Opps with the biggest drop-off in amber; the top-moving industry and market | The full funnel with count and drop-off at each step; industries and markets ranked by visitors with the change on the week before; traffic sources | `#promote/conversion-funnel` |
| Support | Needs a person | The Support Inbox's Needs a person queue count, and the age of the oldest | Each ticket with the customer and its wait, longest first (the first 10) | `#support` |
| Support | AI drafts to approve | The AI drafts to approve queue count, and how many are high confidence (80% or more) | Each draft with the customer and its confidence, most confident first (the first 10) | `#support?queue=ai-drafts` |
| Support | Resolved & automation | Tickets resolved yesterday against the day before; the % resolved by the AI with no person involved | FAQ gaps: questions from the last 30 days the Help Centre couldn't answer (the first 10) | `#support?queue=resolved` |

Rules:

- **Delivery**: lead time is `mergedAt` (else `statusEnteredAt`) minus
  `createdAt`, averaged over the tickets deployed in the last 7 days. A ticket
  passed first time when it has no counted send-back and one testing round
  (`countedSendBacks`, `testRound`); a ticket from before testing rounds were
  kept passed when it has no `lastFailureReason`.
- **Flow & blockers**: a ticket is stuck when it is blocked (except a plain
  `waiting-on-dependency` wait, which releases itself; one marked `stuckOn`
  counts), when it was sent back with Failed testing and is not rebuilding (a
  Backlog card whose `lastFailureReason.at` is no more than 5 minutes before
  its move to Backlog, with no build running and no patch waiting to land; the
  failure is written with the move and `statusEnteredAt` is stamped by a
  trigger afterwards, so it is always a little later), or when it has
  been in Ready for Testing (waiting on a person) for more than 24 hours.
  Approved and live tickets are never stuck.
- **Staff Kanban** reads every open task (`kanbanCards` where `open == true`,
  the query Staff Kanban itself uses; `kanbanTasks` while the cards lag) and
  the current release's tasks for its progress. The current release is Staff
  Kanban's own `currentReleaseId` rule (Kanban settings' release, else the
  earliest not yet live by version, then order). The console's releases say
  `status: "live"` where kanban-core reads `released`, so the Dashboard maps
  one to the other as Staff Kanban does (until 19 Nov 2026 it did not, picked
  the already-live release and showed nothing). Tasks of archived projects
  and epics are left out. With no release, or none of its tasks open, the tile
  counts **All open work**, so it is never blank. % done is completed tasks of
  every task in the release, withdrawn tasks and epics left out. Overdue is a
  due date before today; waiting on you is a Ready for Testing task assigned
  to the viewer. Remaining effort is a task's estimate minus time logged.
- **Leads**: test and archived leads are never counted. The pipeline is the
  company pipeline (network operators have their own); a lead has reached a
  stage when it is at that stage or beyond, and the conversion under a stage
  is how many reached it of those that reached the stage before (Lost leads
  are left out). Stale is an open lead with no activity (history entry, stage
  change, update) for 7 days; not contacted is a lead in its first stage that
  never changed stage and has no history entry from a person. Source: Network
  operator by lead type; Partner when the source names a partner, referral or
  the marketplace; Website for a website lead; else Other. Market is the
  company's first country (an operator's region).
- **Funnel steps from `funnelDaily`**, summed over the last 7 days (the
  14 days are read, one query a day, for the change on the week before):
  unique visitors are each day's `ga4-total` users (GA4's own unique count);
  "industry page" is the day's `ga4-industry-total` users (GA4's
  de-duplicated count over every `/industries/*` page), never more than the
  day's unique visitors. The industry list is `ga4-industry-users`; markets are
  the `ga4-site` users by country; traffic sources the `ga4-site` users by
  channel. Older ingest rows without those sources fall back to the
  `ga4-industry` users. "Engaged" (walkthrough or calculator) is product tour
  starts, calculator uses, demo requests and downloads on `ga4-events` rows.
  Rows written before the ingest (no `source`) keep the older reading: users
  else visits, rows with an industry, demo requests plus downloads. "Leads" is
  leads created in the 7 days that came from the website (source "Website…",
  a source page or website activity). "Opps" is ACE opportunities created
  (`ace` rows) when the ingest has them for the week, else those website leads
  now at Demo or beyond. The biggest drop-off is the step with the largest
  percentage drop. A top mover is the industry or market whose visitors grew
  most on the week before.
- **Support figures**: all three tiles are of the support@ inbox only
  (SUP-INB-7) and use the Support Inbox's own queues, so Needs a person and AI
  drafts to approve equal those two queue counts on the Support Inbox tab. The
  wait runs from `lastInboundAt` (else the last message). Resolved yesterday is
  a ticket still resolved whose `resolvedAt` is yesterday; by the AI alone is
  `resolvedBy: "ai"` with no `humanInvolved`. An FAQ gap is a ticket from the
  last 30 days whose draft was marked not answerable, or whose triage says the
  Help Centre doesn't answer it (spam left out).
- **Who sees which tile**: the Dashboard is open to every member and is not a
  permission section of its own. Each tile follows its section's permission
  (`agent-board`, `staff-kanban`, `promote-leads`, `conversion-funnel`,
  `support-inbox`); a tile the viewer can't open isn't shown, nor is a section
  left with no tiles.
- **Reads**: Delivery and Flow & blockers use the tickets the console already
  holds and redraw with the board. Conversion funnel reads `funnelDaily` for the
  last 14 local days (one query a day). The other sources read their collections once when
  the page opens, again on Refresh, or when reopened after five minutes. The
  page keeps no listeners.
- **Redraws keep your place** (7Pq6sqazzDyqvzWmh3Sg): a redraw updates the
  tiles already on the page rather than replacing them, so a tile reached with
  Tab keeps its keyboard focus and its pinned summary panel when tickets change (the
  automation writes cards every few minutes), and only the figures that moved
  change. The tiles are rebuilt only when the set the viewer may see changes.

### Dashboard v2: responsive grid, pinned summary panels (19 Nov 2026)

Ticket GUI9xPe3CJY3LyMws88m. Layout, interaction and look; what each tile
shows is in the table above (cMyA3FMlUUrSjGtPkLZC, eight tiles).

- **Responsive grid.** Internal, External and Support each have a slim
  section heading, and the tiles of all three flow through one grid in order
  (Delivery, Flow & blockers, Staff Kanban, Leads, Conversion funnel, Needs a
  person, AI drafts to approve, Resolved & automation), so a row is
  always full while tiles remain and a section may wrap across rows. Each
  section's heading sits in the label slot above its first tile (every tile
  has the slot, so a row's tiles line up; on a phone only the headings show).
  Tiles are four across from 1440 px, three from 1024 px (a laptop at about
  1180 px, an iPad in landscape), two from 641 px (an iPad in portrait) and
  one on a phone. So on a wide desktop the first row is Internal and Leads,
  the second Conversion funnel and Support; on a laptop the rows are Internal,
  then External and Needs a person, then the other two Support tiles.
- **Compact tiles.** An icon, the title and a status dot; the metric label;
  a large headline figure with a trend arrow and the change (the full
  sentence for screen readers and on hover); a row of small cells where the
  tile has them (Staff Kanban's columns, the Leads pipeline, the mini funnel);
  a 7-day sparkline, the last 7 local days ending yesterday, where the figure
  has a daily history (Delivery, Leads, Conversion funnel); then the tile's
  secondary figures and amber flags. Flow & blockers, Staff Kanban and the
  support queues keep no history, so they have no trend or line. An info icon on each tile holds its explanation as a
  tooltip (hover or focus on a PC, a tap on an iPad).
- **Status colour** (`tileStatus` in `dashboard-core.js`, eight tiles since
  cMyA3FMlUUrSjGtPkLZC): green when nothing needs attention; Flow & blockers
  amber when a ticket is stuck, red at three or more; Staff Kanban amber on
  any flag (overdue, unassigned, unestimated, waiting on you in Testing);
  Leads amber when a lead is stale or not contacted; Conversion funnel amber
  when yesterday has no website data yet, red when a source failed on the
  last ingest; Needs a person amber when one waits, red when the oldest has
  waited a day or more; AI drafts to approve amber when one waits; Delivery
  and Resolved & automation always green; red on any tile that couldn't load.
- **No click-through; click or tap pins the summary panel.** Clicking (PC) or
  tapping (iPad) a tile opens its summary panel inline, full width, directly
  under that tile's row (after the last tile on that row, whichever section
  it belongs to), and keeps it open until it is closed (×,
  Escape, or the same tile again) or another tile is chosen. One panel is
  open at a time; the tile shows it is pinned (`aria-expanded`). The panel
  has an **Open section** link to the tile's section; the tile itself never
  navigates (people use the sidebar for that). Hover does not preview the
  panel.
- **Redraws keep the panel.** A backlogItems snapshot updates the figures
  in place: a focused tile keeps its focus, and a pinned panel stays open and
  shows the new figures. Only the panel moves when the row breaks change (a
  resize or rotation), never a tile.

Code: `public/js/dashboard-core.js` (rules, no DOM) and
`public/js/dashboard-page.js` (reads and rendering); routing in `app.js`
(`openDashboardPage`, `#board`). Tests: `node test/dashboard.test.mjs` and the
"Dashboard" scenario in `test/ui/console-click.test.mjs`. The UI harness opens
the console on `#board` by default; a case that wants the landing page passes
`hash: ""`.

Known gaps: weekly figures (Leads, Conversion funnel) compare with the 7 days
before, daily ones with the day before; Staff Kanban and the support queues
keep no history, so they show no trend or line. Unique visitors over 7 days
are the sum of each day's unique visitors (GA4 users are not additive across
days, so one person on two days counts twice). Google Ads figures have no
country, and calculator uses stay 0 until the website sends a `calculator_use`
GA4 event (its calculator pushes `ph_ind_calculator` to the dataLayer only).

## Documentation (19 Nov 2026)

Support › Documentation is the internal documentation library that replaces
Confluence (see `README.md` → "Documentation").

- Members read; editors write; viewers get no write controls. Never public.
- Sections nest to any depth; a section shows its folders, then its documents.
- Search covers every document's title, summary, keywords and body text, and
  shows where each hit sits.
- A document uses the Help Centre's editor and properties; website-only
  fields (SEO & agents, Hide from website, live link) are not offered, and no
  product/program is required.
- Outdated documents are kept in Archive, never deleted.
- Agents reach every document read-only over MCP (20 Nov 2026):
  `search_console` with source `documentation` searches them on the same
  index, ranking (BM25 plus vectors) and caches as every other source, and a
  page is found by its section or folder name too; `list_documentation`
  lists the sections and documents; `get_documentation` reads one as
  Markdown, a page or a section at a time; both are Code Mode script tools;
  `get_topic_context` packs include them. Documents under Archive, from an
  archived Confluence page, or not published are hidden from a search unless
  `includeArchived` is set. A section renamed or moved re-indexes the
  documents under it. See `MCP.md` → "Documentation library".
