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
  createdAt: timestamp,
  readmeMd?: string,              // this project's primary tracking doc, shown atop its Docs page
  requirementsMd?: string,        // this file's own live counterpart
  notifyRequestedAt?: timestamp,  // bumped by the "Notify Claude" button
  notifyItemIds?: string[] | null, // optional subset picked via the Backlog column's own checkboxes — see below
  deployNotifyRequestedAt?: timestamp, // bumped by "Notify Claude — Deploy", OR by the approve_deploy_to_main MCP tool — see "team access & the MCP server" below
  deployNotifyRequestedVia?: "mcp",    // set alongside deployNotifyRequestedAt only when approve_deploy_to_main wrote it — absent for a console click
  deployNotifyRequestedByEmail?: string, // the signed-in member whose agent called approve_deploy_to_main — audit trail on the project doc itself, alongside mcpAuditLog
  routinePromptMd?: string,       // see "Per-project Routine instructions" below
  faqAutoFlagOnLive?: boolean,    // see "FAQ auto-review" below
  programId?: string,             // see "programs/{programId}" below
  artifactUrl?: string,           // published Artifact link for this project — ⋮ → "View Artifact". Written directly (not via patchFiles/patchReady) by the Notify Claude Routine — see ROUTINE_INSTRUCTIONS.md → "Project Artifact"
  artifactUpdatedAt?: timestamp,  // set alongside artifactUrl, shown as "updated <date>" under the menu link
  notifyRoutine?: {                // set by notifyOnProjectReadyForReview on each fire
    status: "in-progress" | "done" | "error",
    firedAt: timestamp,
    sessionId?: string,
    sessionUrl?: string,
    itemCount: number,
    sentItemIds: string[],
    finishedAt?: timestamp,        // set by the fired session itself, if it follows the hint
    errorMessage?: string,
  },
  deployRoutine?: {                // same shape as notifyRoutine, set by notifyOnProjectReadyToDeploy — see README.md
    status: "in-progress" | "done" | "error",
    firedAt: timestamp,
    sessionId?: string,
    sessionUrl?: string,
    itemCount: number,
    finishedAt?: timestamp,
    errorMessage?: string,
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
  notes?: [{ author: "claude" | "viewer", text: string, at: timestamp }],
  attachments?: [{ type: "image" | "video", url: string, path: string, name: string, size: number, uploadedAt: timestamp }], // see "Attachments" below
  previewUrl?: string,          // a Ready for Testing card's own "Test this" link
  testSummary?: string,         // Ready for Testing card's primary text — see below
  noDeploymentRequired?: boolean, // set from the Edit item modal — see "No manual way to reach published-live exists" below for the one exception it carves out
  testPassed?: boolean,         // DEPRECATED — the old per-card "Confirm tested" flag. Approval is the checkbox now (see "Approving out of Ready for Testing"); read-only leftover on old cards, never written
  testVersion?: string,         // backlog-tracker's own APP_VERSION, stamped once on first entry to Ready for Testing and carried unchanged through Approved for Deployment, Deployed/Main Branch (Live), and Archived — see "Test version" below

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
  revertedCommits?: [string],   // the revert commits that took it off
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
  trainReady?: boolean,         // the Deploy flow verified the train; the automation merges it
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

`CATEGORIES` (fixed set, `backlog-tracker/public/js/app.js`): `Pricing &
Offers`, `Product Assets`, `HQ Admin`, `Retail Admin`, `Menu Board`,
`Backend / Infrastructure`, `Uncategorised`.

Status pipeline and what each transition means:

| Status | Column | Meaning |
|---|---|---|
| `backlog` | Backlog | Captured, not yet worked |
| `ready-for-testing` | Ready for Testing | Implemented and committed on the project's integration branch, awaiting human test |
| `ready-to-publish` | Approved for Deployment | Approved out of Ready for Testing via the project's own "Approved for Deployment" action |
| `published-live` | Deployed / Main Branch (Live) | Set only by `run-backlog-automation.js` after it actually merges the train's PR — see below, no manual button sets this |
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
- `rob@offline2online.com` and `rob@personalisationhub.com` are hard-coded
  admins in the rules, so an empty or mis-edited collection can never lock
  everyone out. `board-automation@…` stays a hard-coded editor.
- **A signed-in person may always read their OWN row.** `auth-gate.js` has
  to check membership before it can know whether the caller is a member;
  without that self-read every new member sees "not on the list" forever.
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

### `mcpClients/{clientId}`, `mcpAuthCodes/{sha256}`, `mcpTokens/{sha256}`, `mcpAuditLog/{id}`

MCP server state — registered OAuth clients, and the hashed authorization
codes and access/refresh tokens standing behind every team member's agent.
Written only by the Cloud Function through the admin SDK. **`firestore.rules`
denies every client read and write of the first three outright**, and the
`boardApi` proxy's collection allowlist does not include them. `mcpAuditLog`
(one row per agent write: `{at, email, clientId, tool, itemId?, …}`) is
admin-readable and append-only from the server.

## The deployment train

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
  never resolved automatically: the merge aborts, `trainStatus` goes
  `conflict` with a `trainNote`, and nothing is merged or moved.
- **A train carrying a `.github/workflows/` change is never merged by the
  pipeline** (`needsHumanMerge`): the PR is left open at
  `trainStatus: "awaiting-human-merge"`, and `reconcileMergedTrains` records
  every ticket as live on its own once GitHub reports the merge — no second
  click.

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
- **Failed testing is always offered** on a Ready for Testing card (it used
  to hide once "Confirm tested" had been clicked; there is no such click
  now), and additionally writes `revertRequested` — see "The deployment
  train" above.
- A `noDeploymentRequired` card is untouched by all of this: no checkbox,
  and it keeps its own separate "Confirm tested — mark Merged to Main"
  button straight to `published-live`.
- **Pulling a ticket back out after approval needs no new control.** The
  **← back arrow** on an Approved for Deployment card sends it to Ready for
  Testing exactly as it always has — its commit stays on the branch, which
  is correct, since Ready for Testing is precisely where a ticket is meant
  to have code on the branch — and **Failed testing** there does the revert
  and the send-back. Two clicks, both existing, both keeping the meaning
  they had.

`testPassed` is never written anywhere now. Old cards carrying it are
simply ignored; there was nothing to migrate.

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
  history worth keeping a pointer to.

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
flips `status` to `published-live`, after the real merge succeeds.

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
board shows `testSummary` (when set) as its primary text, with a "Show
original request" toggle that expands `desc` underneath rather than
discarding it. A card with no `testSummary` set (an older ticket, or one
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

### `interfaces/{interfaceId}`
```
{
  name: string,
  projectIds: [string, string],   // exactly two
  contentMd: string,
  createdAt: timestamp,
  updatedAt: timestamp,
}
```
A maintained contract document between exactly two projects, visible and
editable from either project's Docs page — the live, board-native
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
}
```
A generic, named document belonging to exactly one project — an API spec,
an architecture decision record, any technical or architectural document
that isn't the project's own `requirementsMd` or `readmeMd` fields. Listed
under "Additional documents" on that project's Docs page, add/edit/delete
inline via a modal, same UI pattern as Interfaces but anchored to a single
project rather than shared between two. Exists so a project's *complete*
documentation lives on one page instead of scattered across the repo,
per-project Firestore fields, and this collection.

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

### `faqCategories/{id}` and `faqArticles/{id}`
```
faqCategories/{id}: { name, icon, description, order, createdAt, updatedAt }
faqArticles/{id}: {
  categoryId, programId (nullable), projectId (nullable), title, slug, summary, bodyMd,
  docType: "faq" | "how-to" | "reference" | "explanation",
  keywords: string[], status: "draft" | "published", needsReview: boolean,
  order, createdAt, updatedAt, publishedAt,
  pendingRevision?: {              // see "FAQ revision review" below
    title, summary, bodyMd, keywords?: string[], docType?,
    reason, sourceItemIds?: string[], sourceProjectId?, sourcePrNumbers?: number[],
    proposedBy: "claude" | string, proposedVia?: "mcp", proposedAt: ISO string,
    reviewStatus: "awaiting-review" | "approved", approvedAt?, approvedBy?,
    editedBy?, editedAt?, isNew?: boolean,
  },
  previousRevision?: { title, summary, bodyMd, replacedAt, sourceItemIds?, wasNew?, revertOf? },
  reviewComments?: { author, text, at }[],   // via comment_on_faq_revision (MCP) — not yet rendered by the console
  lastPromotedAt?,
}
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

### `noDeploymentRequired` is set by the no-diff path

The same script sets `noDeploymentRequired: true` when `patchFiles`
produce no diff against `main` — the expected outcome for the second half
of a shared-file batch, where a sibling's PR already carried the change.
Nothing was pushed and nothing will be, so there is no PR for Deploy to
Main to merge. The card's one-click completion
(`confirmTestedNoDeploy`) is therefore offered in **both** Ready for
Testing and Approved for Deployment (`noDeployPending` in `app.js`);
before that it appeared only in Ready for Testing, so such a card sitting
in Approved for Deployment could only be finished by moving it backwards
a column first.

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
- **New item capture is description-only.** No title or category field up
  front — just typed or dictated text. A short title and a best-guess
  category (`suggestCategory()`) are generated automatically; correcting
  both to the real answer is a mandatory step of every backlog sweep
  (manual or automated).
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
  dictation on one field never touches another's state.
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
  treats any `"in-progress"` older than 20 minutes as done on its own
  initiative, so a session running an older Routine prompt without that
  instruction — or one that crashes — can never wedge the button in a
  permanent spinning state.
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
- **Test/preview link**: a Ready for Testing card gets a "Set test link"
  button; once set (via `showPromptDialog()` — see "In-app dialogs replace
  window.confirm/prompt/alert" below — prefilled with an editable template
  when nothing's set yet), it becomes a "Test this →" button opening `previewUrl` in a new
  tab, with a pencil icon to change it. The convention is a
  `rawcdn.githack.com/offline2online/rob_ph_demos/<branch>/<path>` link for
  a static page (see root `CLAUDE.md`) — **`rawcdn.githack.com`, not
  `raw.githack.com`**: the latter proxies through jsDelivr's CDN cache (up
  to ~7 days), so a link set right after one push can keep showing that
  first commit even after later pushes update the file, with no visible
  error; `rawcdn.githack.com` is githack's own always-uncached host, meant
  specifically for testing an in-progress branch like this.

  **`guessPreviewUrl` picks the page, not just a changed file.** A ticket
  that changes an `.html` file links to that page. A ticket that changes
  only a stylesheet or a script links to the nearest `index.html` above
  those assets — the page that actually renders them — because otherwise
  such a ticket got no usable link at all: the first ticket through the
  deployment train (`iaX9egVd8k8gFOd27LCn`, tripling the console logo)
  touched only `styles.css`, so "Test this →" opened a GitHub *source
  listing* and there was no way to see whether the logo had changed. Only
  a change with no page above it at all (`scripts/`, `functions/`) falls
  back to a link to the branch itself.

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

### Attachments (screenshots & screen recordings)

The Edit item modal's own **Attachments** block (below Comments) lets
anyone attach a screenshot or a screen recording directly to a ticket:

- **Attach screenshot** — a plain `<input type="file" accept="image/*">`,
  uploaded to Firebase Storage the instant a file is chosen.
- **Record screen** — captures the browser's own share-picker via
  `navigator.mediaDevices.getDisplayMedia` and records it with
  `MediaRecorder` (webm/vp9, falling back to plain webm); clicking **Stop
  recording** (or ending the share from the browser's own "Stop sharing"
  bar) finalizes and uploads the clip the same way. No third-party
  recording library or separate screen-capture tool needed.

Both write to Storage under `attachments/{itemId}/{fileName}` and append
`{type, url, path, name, size, uploadedAt}` (see the `backlogItems` schema
above) onto the item — the file itself never touches Firestore, only its
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
(`image/*`/`video/*`) rather than by who's writing — same prototype-stage,
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
estimate (`estimateEffort`, a keyword- and length-based heuristic — a
starting point, not a real estimate, same spirit as `suggestCategory`).
**Create items** then runs the same `addItem()`/`generateTitle()`/
`suggestCategory()` pipeline the single-item New Item form uses, once per
pasted requirement, into that project's Backlog — nothing is auto-approved
or auto-sent to Ready for Dev; the output is meant to help a person decide
what to send for development as one bunch, not to act on its own.
`clusterBacklogItems`/`estimateEffort`/`splitRequirementsText` are pure,
dependency-free functions (`public/js/build-batches.js`, no Firebase, no
DOM) so they're unit-testable with plain `node`
(`test/build-batches.test.mjs`) — same "pure logic split out for
testability" pattern `functions/train-lock.js` already uses.

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
     is. The Routine's own prompt (owned at claude.ai/code/routines, not in
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

3. **`onBacklogItemPublishedLive`** (`onDocumentUpdated` on `backlogItems`)
   — fires on the transition to `status: "published-live"` (the one
   irreversible status change) and does two things, in order:
   1. Promotes any **approved** proposed FAQ revision that names this
      item in `pendingRevision.sourceItemIds`, provided every other source
      item is also live — see "FAQ revision review" below. Always on; no
      toggle.
   2. The older, coarser safety net, still opt-in per project via the Docs
      page's **FAQ review automation** toggle
      (`projects/{id}.faqAutoFlagOnLive`): sets `needsReview: true` on
      every `faqArticles` doc sharing that item's `projectId` that does
      *not* already carry a specific proposal. A project with the toggle
      on but no linked FAQ articles is a harmless no-op.
4. **`onFaqArticleRevisionApproved`** (`onDocumentUpdated` on
   `faqArticles`) — the other half of the same rule: when
   `pendingRevision.reviewStatus` flips to `"approved"` it promotes the
   revision immediately if every source ticket is already live, otherwise
   it leaves it waiting for (3). Both share `promoteFaqRevisionIfReady`, a
   transaction that re-reads the article and its tickets before writing.

### FAQ revision review (Deploy → propose → approve → go live)

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
so a proposal never leaks onto the public site.

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

**Membership.** `Settings → Team & agent access` (admin-only) writes
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
`list_doc_revisions`, `get_doc_revision`, `search_faq`, `get_faq_article`,
`list_pending_faq_revisions`, `get_faq_revision`, `list_skills`, `get_skill`.
Write (editor/admin only) — tickets: `create_backlog_item` (always into
`backlog`), `update_backlog_item` (title, desc, type, category only),
`add_item_comment`; documentation: `set_project_requirements`,
`set_project_readme`, `set_project_artifact`, `create_project_document`,
`update_project_document`, `delete_project_document`, `create_interface`,
`update_interface`, `delete_interface`; help centre: `create_faq_article`
(always `status: "draft"`), `update_faq_article` (always a `pendingRevision`,
never the live fields), `comment_on_faq_revision` — see "FAQ revision
review" under "Functional requirements — FAQ / Help Center" below for what
these two collections' write tools do and don't do; skills library:
`upload_skill`, `update_skill`, `delete_skill`; deploy (one deliberate
exception — see below): `approve_deploy_to_main`.

**The two `board.read` "board" tools above are also composable.**
`get_ready_for_testing_board` and `get_approved_for_deployment_board`
return, alongside their usual JSON, an embedded HTML resource (an MCP
`resource` content block, `mimeType: "text/html"`) rendering the column as
ticket cards (title, testSummary/desc, test link, testVersion, a link back
to the ticket, and — for Approved for Deployment — train/PR context), for
a client that renders embedded resources inline in the conversation. Pure
static markup: no `<script>`, no external stylesheet/font fetch, no
`<form>`, nothing that could change a ticket's status from the widget
itself — every user-authored string is escaped and a linked URL is only
ever rendered as a clickable `href` when it parses as `https://`.
`get_approved_for_deployment_board` additionally reports, per project,
whether that project's whole train is ready for `approve_deploy_to_main`
below (only meaningful with a `projectId` filter — it is a per-project
question).

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
   fields on `projects/{id}` and share its 1 MiB document limit → 200k
   characters. `projectDocs`/`interfaces` content is capped at 20k, matching
   `firestore.rules`, so an agent can never author a document a person is
   then unable to save an edit to from the Docs page.

**No tool may merge a train, approve a ticket out of Ready for Testing,
change a card's status, write a train field, fire the Notify Claude Routine
directly, publish or approve an FAQ article, or trigger a campaign — with
one deliberate, narrowly-scoped exception.** `approve_deploy_to_main`
(`board.write`, editor/admin only) fires the exact same trigger the
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
and that `approve_deploy_to_main` is the one and only `board.write` tool
whose name may contain a deploy/merge/approve/trigger verb.

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
- **Seeding**: `scripts/seed-faq-data.js` (insert-only, safe to re-run) — 9
  categories, 108 articles, a verbatim import of the real Personalisation
  Hub Help Center from a Freshdesk Solutions export, run automatically on
  every deploy. Not placeholder content.
- **Version display**: both `faq/` and `backlog-tracker/public/` render a
  small hand-maintained `APP_VERSION` in their footer (`js/version.js` in
  each, independent per site since they deploy separately) — bumped by
  hand on meaningful changes; no build step exists to derive it
  automatically.

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
