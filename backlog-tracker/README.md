# backlog-tracker

See [`REQUIREMENTS.md`](./REQUIREMENTS.md) for the full functional
specification — data model, board behavior, the notify/automation Cloud
Functions, and the FAQ / Help Center surface. This README covers setup and
deploy; that file covers what the system is actually for and why it's
built the way it is. Keep both in sync with the live copy on this
project's own Docs page (`requirementsMd`) — treat a divergence between
any of the three as a bug in whichever is stale.

## Deployment — the one correct way to ship a change (read this first)

There is exactly **one** thing that makes a code change live: a push to
`main` that touches anything under `backlog-tracker/` triggers
`.github/workflows/deploy-backlog-tracker.yml`, which runs
`firebase deploy --only hosting,functions,firestore:rules` for you. There
is no separate manual deploy step in the normal flow. **If a change hasn't
reached `main` through one of the two paths below, it is not live — a
card's status column is never proof, a green run in the Actions tab is.**

**Path A — a human, or a Claude session with a real git/GitHub credential,
pushes or merges normally.** Committing and pushing to `main` directly, or
merging a PR through the GitHub UI / `gh pr merge` with a real user or
GitHub App token, fires GitHub's native `push` webhook — the deploy
workflow starts automatically. Nothing further to do beyond confirming the
run appears (see "Verifying a deploy actually happened" below).

**Path B — the automated backlog pipeline
(`scripts/run-backlog-automation.js`, driven by
`.github/workflows/backlog-automation.yml`) merges a PR using its own
`GITHUB_TOKEN`.** GitHub deliberately suppresses `push` triggers for a
workflow's own `GITHUB_TOKEN` (anti-recursion protection) — a PR merged
this way does **not** auto-fire the deploy the way a human's merge does.
`finishTrain` in `run-backlog-automation.js` already knows this and
explicitly runs `gh workflow run deploy-backlog-tracker.yml` right after
every merge that touches `backlog-tracker/` (needs `actions: write` in
that workflow's own `permissions:` block — already set). **If you ever
touch `finishTrain`/`processMergePr`, or write any other code path that
merges a PR with `GITHUB_TOKEN`, you must keep or add that explicit
dispatch.** A
merge with no explicit trigger silently never deploys, even though the PR
is on `main` and the board says "Merged to Main (Live)." This was hit in
production once already — see "Notify Claude can't push" below for the
full incident — don't reintroduce it.

**Verifying a deploy actually happened** — do this whenever a fix is
"supposed" to be live, every time, not just when something looks wrong:
check `.github/workflows/deploy-backlog-tracker.yml`'s runs in the Actions
tab (or `gh run list --workflow=deploy-backlog-tracker.yml`) for one tied
to the merge/push commit, and confirm its "Deploy to Firebase" step
succeeded. Only that is real evidence a change is live.

**A green deploy run is real evidence the *server* has the new files —
it does not mean a given browser is showing them yet.** Firebase Hosting
was serving `index.html`/`js/**`/`css/**` with no explicit `Cache-Control`
header, which meant its documented default (`max-age=3600`) applied: a
browser that loaded the board any time in the hour before a deploy can
keep serving its own locally-cached copy of `app.js` on a plain reload,
with no error and no visible sign it's stale — the exact shape of the bug
report on item `dWJtVKC310qgMevZ3XPl` ("locked/greyed-out Backlog card"
merged and deployed successfully, then reported as "not working" ~14
minutes later, well inside that window). `firebase.json`'s `hosting.headers`
now pins `html`/`js`/`css` to `Cache-Control: no-cache, must-revalidate` —
the browser still caches them, but must revalidate with the server (a
conditional GET, cheap on a 304) before using the cached copy, so a fresh
deploy is visible on the very next full page load, no hard-refresh
required. Don't loosen this back to a bare `max-age` for these paths
without solving the staleness problem some other way (e.g. fingerprinted
filenames), since there's no build step here to make that safe.

**There is no separate manual deploy step to remember for the normal
flow.** The `firebase deploy --only ...` commands under "Ongoing:
redeploying after a code change" further down are a fallback for
deploying from a local machine (e.g. before the GitHub secret/IAM setup
below exists yet), not something to run routinely — every real deploy
should go through GitHub Actions so it's reproducible and never depends on
someone's local Firebase CLI state.

A real, Firestore-backed version of the Prototype Pipeline board (the
Claude Artifact at the root `CLAUDE.md`'s "Prototype Backlog" link), built
to answer one specific question: **can a web app tell Claude a project's
Backlog is ready, with no person relaying the message?**

The Artifact board can't — it has no server of its own, so "Notify Claude"
there is a manual flag someone has to click, and a person still has to
tell Claude in chat to go look. This app closes that gap: each project's
**Notify Claude** header button writes a `notifyRequestedAt` timestamp onto
that project's doc, which a Cloud Function
(`functions/notifyOnProjectReadyForReview`) watches for and fires once per
click — not once per item. (An earlier version also posted automatically
on every single new backlog item, which was noisy — one Slack message per
line typed or dictated, long before a project was actually ready for
anyone to look at. Removed in favor of the one-post-per-click below.)

That one function does two things, both scoped to the project and item
count at the moment of the click, and independent of each other (either
no-ops on its own if its secret(s) aren't set):

1. Posts to `NOTIFY_WEBHOOK_URL` — a plain webhook (Slack's "Incoming
   Webhook" is the simplest target) naming the project and exactly how
   many Backlog items will be actioned. Whoever's listening still has to
   relay this into a Claude conversation by hand, same as a plain webhook
   always would.
2. Fires a **Claude Code Routine's API trigger** directly (`POST` to
   `https://api.anthropic.com/v1/claude_code/routines/{id}/fire` with a
   bearer token), which starts a brand new Claude Code session immediately
   — no human needed in between. The Routine itself is created and owns
   its own prompt from `claude.ai/code/routines`, not from this repo; this
   function's only job is to tell it which project and what's currently
   sitting in that project's Backlog column.

A second header button, **Notify Claude — Deploy**, closes the same gap at
the *other* end of the pipeline: it appears only when a project has items
Approved for Deployment (already tested and confirmed, just waiting for
someone to merge their PRs), and its own Cloud Function
(`functions/notifyOnProjectReadyToDeploy`) fires the same Routine — but
with fire text that explicitly says "these are done, don't re-implement
them, just merge and mark published-live," since the Routine's own shared
prompt only knows how to interpret a "N items in Backlog" request. See
`REQUIREMENTS.md` → "Functional requirements — notification & automation"
for the full shape of both functions.

A third, narrower CTA — **Groom Backlog** — lives in the Backlog column's
own header (not the project-wide header row) and appears only when that
column is non-empty. Its Cloud Function (`functions/notifyOnProjectReadyForGrooming`,
watching `projects/{id}.groomRequestedAt`) fires the same Routine a third
way: fire text starting `=== GROOM REQUEST for "<project>" ===` asks it to
only classify (`category`) and summarize (`groomedSummary`/
`groomRequiredNotes`) every current Backlog item — explicitly no code, no
`patchFiles`, no `patchReady`, no `status` change — so someone can get an
AI read on what's sitting in Backlog without it turning into an
unrequested investigate-and-fix run. Progress shows the same way as the
other two, via `projects/{id}.groomRoutine`. See
`ROUTINE_INSTRUCTIONS.md`'s own "The 'Groom Backlog' flow" section for
exactly what a fired session does with this.

## Notify Claude can't push — how a fix actually reaches GitHub

The Claude Code session a Routine fire starts is a brand-new, bare
sandbox: no repo checked out, no git credentials, no GitHub-aware tools —
just generic shell/file/web access. It can genuinely investigate a Backlog
item and write the fix, but it has no way to `git push` a branch or open a
PR itself. We deliberately did **not** hand it a real GitHub credential to
close that gap: `backlogItems` is publicly, unauthenticatedly writable
(see `firestore.rules`), so anyone can write a `desc` — a malicious one
could try to prompt-inject the fired session into leaking a push-capable
secret it had been handed. Handing a fired session a scoped token doesn't
remove that risk, it just bounds it — so instead, no session fired this
way is ever given a GitHub credential of any kind.

Instead, the fired session packages a finished fix as **plain file
contents**, not a push. The exact rules for how a fired session behaves —
what to investigate, what to write to Firestore, when to leave an item
blocked instead of guessing — live in
[`ROUTINE_INSTRUCTIONS.md`](./ROUTINE_INSTRUCTIONS.md), not in the
Routine's own stored prompt: the Routine's prompt (owned at
claude.ai/code/routines, editable only there) is kept to a short bootstrap
that fetches that file fresh from this repo's `main` branch on every fire
and follows it exactly. **This means the actual workflow is controlled
here, in git, via normal PRs — update `ROUTINE_INSTRUCTIONS.md` to change
what a "Notify Claude" click does, not the Routine's config.** The short
version of what that file currently specifies:

- `backlogItems/{id}.patchFiles` — `[{path, content}]` for every
  changed/created file (full new content, not a diff — `content: null`
  means delete that path), plus `patchCommitMessage`. (`patchBranch`,
  `patchPrTitle` and `patchPrBody` are leftovers from the per-ticket-PR
  era; still accepted, no longer used.)
- Setting `patchReady: true` on the same PATCH is the signal — the item
  stays visually in Backlog (status doesn't change yet) until the step
  below actually gets the work onto the branch.

`.github/workflows/backlog-automation.yml` — a normal scheduled GitHub
Actions job (every 2 minutes, plus manual `workflow_dispatch`), running
on a trusted GitHub-hosted runner with its own per-run `GITHUB_TOKEN` —
picks up every `patchReady` item via
`backlog-tracker/scripts/run-backlog-automation.js`: checks out the
project's integration branch (see "The deployment train" below), writes
out `patchFiles` verbatim on top of it, commits, pushes, then PATCHes the
item to `status: "ready-for-testing"` with its commit sha and a preview
link. No AI is involved in this step at all, and no long-lived GitHub
secret exists anywhere in this pipeline — the runner's `GITHUB_TOKEN` is
minted and revoked by GitHub itself, per run.

### The deployment train — one branch and one PR per project

**Every ticket a project builds is one commit on that project's single
long-lived integration branch, `deploy/<project-slug>`** (recorded as
`projects/{id}.deployBranch`, created from `main` on first use). There is
no per-ticket branch and no per-ticket PR any more.

The reason is the problem the old model guaranteed rather than risked.
Each ticket got its own branch cut from `main`, so two tickets alive at
once drifted apart and nothing ever brought them back together: the
Routine has no push credential by design, and the merge step only ever ran
`gh pr merge`. The second PR to merge was therefore conflicted, the merge
failed with "Pull Request has merge conflicts", the card sat in Approved
for Deployment with a note, and a human resolved it by hand — PR #77,
then #141 and #139 on 15 Sep 2026. `version.js` made it structural instead
of occasional: every PR bumped `APP_VERSION` on the same line, so *any*
two open PRs conflicted on that file alone.

What the train changes:

- **Build** (`processApplyPatch`) — commit on the branch head, message
  `<title>` + a `Backlog item: <id>` line (the same marker PR bodies
  carried, so exact-id lookups still work, now via `git log --grep`).
  Tickets stack on each other, so they are tested in the combination they
  will ship in; the card's test link points at the branch. A re-patch is
  just another commit — `deployCommits[]` grows, history is never
  rewritten. If the push is rejected because another ticket landed in
  between, the patch is re-applied on the new head and retried once.
- **Reject** (`processRevertFromTrain`) — Failed testing on a card writes
  `revertRequested`, and the automation reverts that card's commits back
  off the branch. **A card in Backlog must never have live commits on a
  train**, or a "rejected" ticket would still ship in the next deploy. If
  a later ticket built on top of it the revert conflicts: nothing is
  force-pushed, the card is still sent back, and `revertBlockedBy` names
  the tickets a human has to decide about (send them back too, or fix the
  branch by hand). The board shows that state on the card.
  - **Failed testing now also captures a structured reason**
    (XJoASicLGefL5c9fronl): alongside the free-text explanation, a fixed
    category (`FAILURE_REASON_CATEGORIES` in `public/js/app.js`, e.g.
    "Wrong / unexpected behavior", "Visual or layout issue") is stored on
    the card as `lastFailureReason` and shown as a badge on the Backlog
    card. `ROUTINE_INSTRUCTIONS.md`'s "For each Backlog item found" step 2
    tells a re-fired investigation to read it before starting, so a
    re-patch targets what actually failed last time rather than re-guessing
    from the original `desc`.
  - **Eject from train** (FVrOIVAAp46NdcgGovMW) is the same
    reject-and-revert mechanism, one click earlier: an Approved for
    Deployment (`ready-to-publish`) card used to need the plain "move back"
    arrow to Ready for Testing *then* Failed testing there to actually come
    off the branch — two separate, unrelated-looking controls, with nothing
    naming that chain as how you unblock a release stuck on one bad ticket.
    Eject from train does both in one write (`ejectFromTrain` in
    `public/js/app.js`), tagging the card `ejectedFromTrain: true` so its
    note reads distinctly from an actual test failure. No automation change
    was needed — it reuses the exact same `revertRequested` hand-off, and
    `trainLockShouldClear` (`functions/train-lock.js`) already only clears a
    project's lock once every train-relevant item is gone, so ejecting one
    stuck ticket can never itself reopen Backlog to new work while others
    are still mid-build.
- **Deploy** (`processDeployTrain`, triggered by `projects/{id}.trainReady`)
  — merge `main` in, bump `APP_VERSION` once, open ONE PR
  (`Deploy <project> — N tickets`, body listing every `Backlog item:`
  line), wait for CI, `gh pr merge --merge` (never squash — the per-ticket
  commits are the history now), flip every ticket to `published-live`,
  trigger the Firebase deploy, then reset the branch to `main` for the
  next train. Progress and every non-merge outcome land on the project as
  `trainStatus` (`idle` | `deploying` | `conflict` | `awaiting-human-merge`)
  + `trainNote`.
- **Merging `main` into the branch is the only conflict path left**, and it
  takes someone pushing straight to `main` in this project's files. It is
  never resolved automatically: the merge is aborted, `trainStatus` goes
  `conflict`, and nothing is merged or moved.

The board expresses one consequence of this in its CTAs: merging the
branch ships *everything on it*, so **Deploy to Main is shown only when
every ticket on the train is approved** — Approved for Deployment has
cards and Ready for Testing is empty. And because a project that keeps
building would never reach that state, the first approval **locks the
Backlog** (`projects/{id}.trainLocked`): Ready for Dev and Groom Backlog
hide until the train merges, so no new ticket can join a release that is
already closing. Backlog cards stay fully editable throughout; only
*starting a build* is held. See `REQUIREMENTS.md` → "The deployment
train".

**`trainLocked` clearing isn't only a successful-merge thing any more.**
`firestore.rules` only ever lets the browser latch it *true*
(`deployToFeature()`); before 17 Sep 2026 the only thing that ever cleared
it again was `finishTrain()`/`reconcileMergedTrains()` after a real merge.
Deleting every ticket that had been approved for deployment — or rejecting
them all via Failed testing, which reverts their commits off the branch —
emptied the train without ever merging anything, so the lock (and the
Ready for Dev/Groom Backlog CTAs it hides) got stuck forever, with nothing
left in Ready for Testing or Approved for Deployment for Deploy to Main to
act on either. Happened for real on this project (Backlog Tracker & FAQs),
17 Sep 2026. Fixed on two paths that share one pure predicate
(`functions/train-lock.js`'s `trainLockShouldClear()` — no Firebase SDK, so
it's plain-`node`-testable, see `test/train-lock.test.js`):

- `functions/index.js`'s `onBacklogItemTrainLockRecompute` reacts the
  moment a `backlogItems` write drops an item out of train-relevant
  status (deleted, published-live, or a rejected card's revert finishing)
  and clears `trainLocked`/resets `trainStatus`/`trainNote` the instant
  nothing is left on the train — see `test/train-lock-trigger.test.js`,
  which drives the real exported handler under a small stubbed-SDK
  harness (index.js had no test of any kind before this).
- `scripts/run-backlog-automation.js`'s `reconcileLockedTrains()` is the
  safety net (same predicate) on every scheduled run, and the one place
  that can also do the git side no Cloud Function can: if the integration
  branch still holds commits that never reached `main` — a card deleted
  outright, skipping `processRevertFromTrain` entirely, rather than
  reverted — `archiveAndResetOrphanedBranch()` tags the branch's tip
  `archive/<branch>-<date>` and pushes the tag before resetting the branch
  to `main`, so nothing is silently lost even though no ticket on the
  board points at it any more. Covers the "reverted-then-net-zero" case
  too (real history, kept, even though the diff is empty). See
  `test/train-lock-branch-archive.test.js`, which drives this against a
  disposable local git repo pair — never the real `origin`.

Either path also clears a stale `trainStatus: "conflict"` left over from
before the tickets were removed, since there's nothing left on the train
for that note to describe. Neither path touches a project mid-deploy
(`trainStatus: "deploying"`) or awaiting a human PR merge
(`"awaiting-human-merge"`) — those still only resolve through
`finishTrain()`/`reconcileMergedTrains()`.

The board itself no longer goes silent about this either:
`trainLockedNoteHTML()` in `public/js/app.js` shows a "Train locked: …"
line on a project's header (using the project's own `trainNote` when one
exists) any time `isTrainLocked()` is hiding Ready for Dev/Groom Backlog,
so a stuck lock reads as a stuck lock rather than as "nothing in Backlog
yet".

**Superseded: the "attach an item to its already-open PR" machinery.**
`resolveReusablePr`/`attachToExistingPr`/`findExistingPrForItem` existed
because a second `patchReady` on an item with an open PR had nowhere to go
(a re-patch after Failed testing, or a batch sibling bouncing off the PR
the first item opened — PR #131, 14 Sep 2026). On the train all of that is
one sentence: a re-patch is another commit on the same branch. Those three
functions are gone; `findPrForBranch` remains, now used to reuse an
already-open *train* PR rather than an item's.

**`patchFiles` producing no diff still never leaves an item stuck
silently**, but it now means one of two different things and is handled
differently for each. If the item already has commits on the train, the
re-patch simply matched what it had put there: the card goes back to Ready
for Testing against its existing commits, untouched. If it has none, the
content is genuinely already on the branch (a sibling's shared-file patch
carried it), so there is nothing for a deploy to ship and the card is
flagged `noDeploymentRequired` — otherwise it would reach Approved for
Deployment and hold the train's Deploy gate open on a ticket with no
commit to merge.

The same script also handles the mirror case for **Notify Claude —
Deploy**: that Routine fire asks the session to verify the train — every
item's `deployCommit` is an ancestor of the branch (`git merge-base
--is-ancestor`, plain git, so it works even when `api.github.com` is
blocked for that session) and nothing on the branch is still in testing —
then PATCH `projects/{id}.trainReady: true` instead of merging itself. The
same scheduled job merges the whole train and flips every ticket on it to
`"published-live"`. CI is checked by the job right before merging, not by
the fired session: a green check at verification time says nothing about
the branch after `main` has been merged into it.

**A merge here must explicitly re-trigger the deploy — it doesn't happen
for free.** GitHub deliberately suppresses `on: push` triggers for pushes
made with a workflow's own `GITHUB_TOKEN` (anti-recursion protection), so
a PR merged by `gh pr merge` here does **not** fire
`deploy-backlog-tracker.yml`'s own `push`-to-`main` trigger the way a
human's (or an app's own token's) merge does. Found the hard way: PRs
merged by this pipeline landed on `main` and flipped their card to
"published-live" while Cloud Functions/Hosting/Firestore rules silently
never redeployed — the board said live, the site wasn't. Fixed by having
`processMergePr` explicitly run `gh workflow run deploy-backlog-tracker.yml`
right after a successful merge that touched `backlog-tracker/` (an
explicit API dispatch, unlike a push event, isn't subject to that
suppression) — needs `actions: write` in this workflow's own
`permissions:` block. If a future edit to this script or workflow ever
looks like it doesn't need that explicit trigger, it's wrong — this is
the whole reason it exists.

**`processMergePr`/`mergeReady` is the pre-train, per-ticket merge path.**
It is kept only so cards that were already in flight when the train shipped
can still finish; nothing writes `mergeReady` for new work, and the board
only offers Deploy to Main for such cards when a project has no train
items at all. It checks the PR's state before attempting `gh pr merge`, and
treats an already-`MERGED` PR as success rather than a failure to retry
forever. An item can legitimately reach `mergeReady: true` with a
`mergePrNumber` that's already merged through some other path — e.g. an
interactive Claude Code session with real repo access merging it directly
via the GitHub API rather than waiting for this pipeline (this happened
for real on item `RR68JuZDRHtZncsfwyKl`, 2026-09-11). `gh pr merge` on an
already-merged PR fails, and the old code treated any merge failure the
same way ("will retry on next scheduled run") — which is never going to
stop being true for a PR that's already merged, so the item sat at
`ready-to-publish` forever with no way to reach `published-live` short of
a human editing the item by hand. Fixed by checking `state` first: `MERGED`
skips straight to the success path (deploy trigger + `published-live`),
`CLOSED` (without merging) leaves `mergeReady` as-is with a note instead
of retrying a merge that can never succeed, and `OPEN` behaves exactly as
before.

If a fired session genuinely can't express its fix as full file contents,
it leaves the item in `backlog` with a note explaining why, same as
before — a human picks it up from there.

**A Backlog card locks itself the moment `patchReady` goes true.** Between
the Routine writing `patchFiles`/`patchReady: true` and
`backlog-automation.yml` actually picking it up (its own schedule polls
every ~2 minutes) a card sits in Backlog with real, in-flight work already
behind it — editing, moving, or deleting it in that window would silently
orphan whatever was just written. `cardHTML`'s own `isInDevelopment` check
(`isBacklog && item.patchReady`) greys the card out and drops every control
down to a passive "In development — locked" hint instead, the same
"show a status line instead of a live control" treatment
`merge-pending-hint` already used for a Live-on-Feature-Branch card. It
unlocks on its own the moment the automation flips `status` to
`ready-for-testing` — no separate cleanup needed.

### Cards that ship together are grouped on the board

Two or more cards packaged into the same deployment are drawn bracketed
together — a light `.card-group` wrapper with a "Ships together" header and
a count — in place, inside whichever column they're already in. There is no
separate page, menu entry or section for this, and nothing is stored: an
earlier attempt built a dedicated Deployments page, which was the wrong
shape and was removed in PR #98.

`deploymentGroupKey(item)` derives a group's identity on every render from
what already makes two cards one deployment: the `prNumber` they share
(written by the automation when a train's PR opens), or, on a pre-train
card, the `patchBranch` they were packaged on. It returns `null` — meaning
"shares no deployment" — for a card with neither, and for a
`noDeploymentRequired` card, which has no deployment to share at all.
`columnCardsHTML()` then draws each group at the position of its first
member, leaving card order, column counts and every per-card control
untouched; a key held by only one card in a column is not a group.

Under the deployment train every ticket a project builds ships in the same
PR anyway, so in practice the brackets appear once that PR opens and stay
through Merged to Main (Live). Both fields are in
`BACKLOG_ITEM_RENDER_FIELDS` for this reason, so the groups are there on
the REST-primed first paint rather than popping in when the realtime
listener lands.

## Adding a project — link it to GitHub, or the automation refuses

A project on this board and a folder in `rob_ph_demos` are two halves of
one thing, and nothing joins them automatically. The join is
`projects/{id}.repoFolder`, read by `projectFolderOf()` in
`scripts/run-backlog-automation.js`. Unset, it falls back to the
deploy-branch slug (`deploy/dsp-integration` → `dsp-integration/`), and
failing that to nothing.

"Nothing" used to not be harmless. A Routine session working inside a
project's folder hands back `patchFiles` paths relative to that folder;
with no folder to resolve them against, the automation used to write them
as new files at the repo root. PR #185 (22 Sep 2026) did exactly that —
seven tickets wrote root-level copies, overwrote the root `README.md`,
changed none of the real files, and every card still read "Deployed / Main
Branch (Live)". It no longer can: see "The automation refuses rather than
guesses" below.

Creating a project therefore means four things, not one:

1. The folder exists in the repo, with its own `README.md` and
   `REQUIREMENTS.md`. One project, one top-level folder.
2. `projects/{id}.repoFolder` names it — repo-root-relative, no trailing
   slash (`dsp-integration`). Set it explicitly even when the slug would
   match; the fallback is a guess and a rename breaks it silently.
3. `projects/{id}.deployBranch` is `deploy/<folder>`.
4. `requirementsMd` / `readmeMd` are filled from those two files in the
   same session.

**The New Project modal now asks for the repo folder alongside the name**
(`np-repo-folder-input` in `public/index.html`, wired in `public/js/app.js`)
— required by default, with an explicit "this project has no single
folder" checkbox for the case that genuinely applies. On submit it writes
both `repoFolder` and a `deploy/<folder>` `deployBranch` in the same
`addProject()` create (steps 2 and 3 above, done together, at creation
time — `firestore.rules`' `isValidNewDeployBranch()` lets an editor name a
brand-new project's branch this once, since there is no existing train yet
to redirect the way repointing an established project's `deployBranch`
still is). It also checks the new folder isn't already claimed by another
project (`projectWithRepoFolder()`) before creating. The field is editable
afterward from the project's own Docs page, next to Requirements and
README — the natural place to retrofit it onto a project created before
this shipped. `repoFolder` still isn't in the MCP server's
`PROJECT_WRITABLE_FIELDS`, so an agent can't set it over MCP; the console
(a person, or a runner with the board credential) still has to.

A project with no folder of its own is legitimate but exceptional: this
one owns both `backlog-tracker/` and `faq/`, so it uses the modal's escape
— `repoFolderNotApplicable: true` — rather than just leaving `repoFolder`
unset, and its patches must always use repo-root paths. Where that is the
case, say so in the project's README too — "deliberately unset" and
"nobody set it" still look identical to a human skimming Firestore
directly, even though the automation itself (next section) now tells them
apart.

### The automation refuses rather than guesses

`processApplyPatch` in `scripts/run-backlog-automation.js` calls
`projectFolderOf(project)` before doing any git work. When that returns
`null` — no `repoFolder` set, or it's set to something that doesn't exist
in this repo (a typo) — and `patchFilesLookFolderRelative(item.patchFiles)`
says the patch looks like it was written relative to some folder (none of
its paths' top-level segments are real entries at the repo root), the item
is refused: `patchReady` is cleared, a note explains exactly why and how to
fix it, and nothing is written to disk at all. A patch that genuinely
belongs at the repo root (this project's own tickets, an item on a project
that correctly has no single folder) always has at least one path whose
top segment already exists there, so it's never caught by this check — see
`test/patch-paths.test.js` for the exact cases.

## Retiring a project — archive keeps it, delete does not

The board's own control is **archive** (`archiveProject()` in
`public/js/app.js`): the project drops off the columns, every ticket is
kept, and the Archived projects page restores it. That is the right
default for anything that might come back, and it is the only thing the UI
does.

Deleting for real is for a project that was created speculatively, never
used, and is now noise in `list_projects` for every agent that connects
over MCP. It runs from a runner, where the service account credential
already is:

```bash
# dry run: reports what would go, uploads the export, deletes nothing
gh workflow run board-admin.yml -f projects="<id>,<id>"

# for real
gh workflow run board-admin.yml -f projects="<id>" -f apply=true -f confirm=DELETE
```

`scripts/delete-projects.js` removes the project and every `backlogItems`,
`projectDocs`, `docRevisions` and `interfaces` document pointing at it,
then re-queries and fails if anything survived. It refuses a project that
still has a non-archived ticket, or whose interface contract names a
project that is *not* being deleted — removing that record would take the
contract away from the surviving side too. `--force` overrides both,
loudly.

Every run, dry or real, writes a full JSON export of everything in scope
and uploads it as the run's artifact. **That export is the only way back,
and it is deliberately never committed: `rob_ph_demos` is public and
ticket text and editor emails are not.** Download it before the 90-day
retention runs out if the project mattered.

## Testing the rules and the MCP server

`test/` holds two suites:

- **`firestore-rules.test.js`** runs `firestore.rules` — the real file —
  inside the Firestore emulator and asserts what each principal may and may
  not write, including the membership model (`consoleUsers`) and the fact
  that nobody may read the MCP credential store.
- **`mcp-server.test.js`** drives `functions/mcp-server.js` in-process —
  client registration, sign-in, PKCE code exchange, `tools/list`,
  `tools/call`, and every refusal that matters. It stubs the Firebase SDKs
  (`mcp-stubs.js`), so it needs no emulator, no Java, no credentials and no
  network.
- **`mcp-client.test.mjs`** points the real `@modelcontextprotocol/sdk`
  client at the real server over HTTP (`mcp-live-server.js`), letting the SDK
  do its own discovery, registration, PKCE and transport handling. That is
  what catches anything a real client would reject but an in-process call
  never would.

```bash
cd backlog-tracker/test && npm install && npm test   # all three
npm run test:mcp     # MCP logic — runs anywhere, instantly
npm run test:client  # MCP over HTTP with a real client
npm run test:rules   # rules — needs the emulator
```

`.github/workflows/firestore-rules-test.yml` runs both on every pull request
that touches the rules, the MCP server or the tests, and on push to `main`. On a PR it is
also the first real status check this repo has had, so it is what
`processDeployTrain` actually waits on before merging a train — broken rules
fail the check and the train refuses to merge.

**Why it exists.** The deployment train shipped with a rules bug that took
Deploy to Main out of service completely. Every train field was guarded as
"unchanged unless the writer bypasses rules", assuming all train writes come
from `run-backlog-automation.js` through the service account. They don't:
`trainReady`, the single signal that starts a deploy, is written by the
Notify Claude Routine, which signs in as the board automation **user** and is
an ordinary account these rules apply to. It got `PERMISSION_DENIED`, nothing
was dispatched, and cards sat in Approved for Deployment while the button
spun and reverted.

Nothing caught it because nothing tested rules: the pipeline's own
end-to-end harness stubs Firestore, so it validates every stage against a
database that permits everything. Re-breaking the rule and re-running this
suite reproduces the failure on exactly one case — the Routine's `trainReady`
write — and fails the build.

**Three principals, which is the distinction the rules turn on:**

| principal | authenticates as | rules apply? |
|---|---|---|
| `run-backlog-automation.js` | Firebase service account | no — bypasses entirely |
| Notify Claude Routine | `board-automation@…` user (Identity Toolkit) | **yes** |
| a person on the board | their own Google account | **yes** |

Only the first bypasses rules. When adding a guard, be explicit about which
of the other two it is meant to stop — and add a case here for both.

## Isolation from menu-board-demo — by design, not just by folder

This is a genuinely separate project, not a subfolder sharing infrastructure:

- **Its own Firebase project.** `.firebaserc` here points at a *different*
  project ID than the repo root's `.firebaserc` (which is `rob-ph-demos`,
  used by `menu-board-demo/functions`). Its own Firestore database, its
  own Cloud Functions, its own Hosting site, its own IAM, its own billing.
  Nothing here can be deployed into, or read/write, menu-board-demo's data.
- **Its own `firebase.json`** in this folder — running `firebase deploy`
  from inside `backlog-tracker/` resolves against *this* config and *this*
  project, never the root one. (`firebase` picks up whichever
  `firebase.json` is in the current directory.)
- **Its own `firestore.rules`**, scoped only to a `backlogItems`
  collection that doesn't exist anywhere in menu-board-demo's schema.
- **Its own Cloud Functions codebase** (`functions/`), with its own
  `package.json` / dependencies — deploying it never touches
  `menu-board-demo/functions`, and a bug here can't break that.

The only thing shared with the rest of `rob_ph_demos` is the git repo
itself — plain files, no build coupling, no shared runtime.

## Attachments (screenshots & screen recordings)

The Edit item modal has its own **Attachments** block, below Comments:
**Attach screenshot** (a plain image file picker) and **Record screen**
(captures the browser's own screen-share picker via `getDisplayMedia` +
`MediaRecorder`, no third-party library or separate app) — both upload
straight to Firebase Storage the moment a file is ready
(`uploadItemAttachment` in `public/js/app.js`) and append
`{type, url, path, name, size, uploadedAt}` onto the item's own
`attachments` array. A card with at least one attachment shows a small
📎N count next to its comment icon on the board itself.

**This needs Firebase Storage enabled for `backlog-tracker-e4ed2`, the
same one-time manual step Cloud Functions needed** (see "Setup" above) —
if Storage was never explicitly enabled for this project (Firebase Console
→ Build → Storage → **Get started**, default rules/location are fine,
`storage.rules` overrides them on the next deploy), uploads fail outright
until it is. `storage.rules` mirrors `firestore.rules`' own open-but-
validated posture (no auth yet — same prototype-stage caveat) — open read,
and write gated on size (< 100MB) and content-type (`image/*` or
`video/*`) rather than by who's writing. The deploy workflow's `--only`
list includes `storage:rules` alongside `firestore:rules`; if you ever see
an upload fail with a permissions error after a deploy, check that flag is
still there before assuming the rules file itself is wrong — a `storage`
key with no matching `--only storage:rules` (or `storage`) in the deploy
step silently never ships the rules the same way `firestore.rules` would
silently never ship without `firestore:rules` in that same flag.

Removing an attachment (the × on its row) deletes both the Storage object
and the array entry; a failure to delete the Storage object itself (e.g.
rules not deployed yet) is logged to the console but doesn't block removing
it from the item — an orphaned file left behind is harmless clutter, not a
user-visible error.

## Architecture

```
                    "Notify Claude" clicked → project doc's notifyRequestedAt bumped
                                        │  onDocumentUpdated
                                        ▼
                      functions/notifyOnProjectReadyForReview
                   (fires once per click, not once per backlog item)
                            │                         │
                            ▼                         ▼
                  NOTIFY_WEBHOOK_URL      CLAUDE_ROUTINE_FIRE_URL + CLAUDE_ROUTINE_TOKEN
                  (Slack — names the      (a Claude Code Routine's API trigger — POSTing
                   project + item count,   here starts a real Claude Code session directly,
                   still needs a human     `text` = project's own routinePromptMd, if any,
                   to relay it further)    + that project's current Backlog items)
```

Frontend (`public/`) is a plain Firestore-backed board — vanilla JS,
Firebase's modular Web SDK loaded from the `gstatic.com` CDN, no build
step. Every open tab gets realtime updates via `onSnapshot()`, so (unlike
the Artifact board) other viewers never need a full page reload to see a
change.

Projects can optionally be grouped under a **Program/Product** heading (a
new `programs` collection — see `REQUIREMENTS.md` → "Data model") purely
for display; a board with no programs looks exactly as it always has. Set
it from the New Project modal at creation, or from a project's Docs page
any time — both offer "+ New program…" to create one on the spot.

A project can also optionally carry a **Project Artifact** — a Claude-
published Artifact link shown as **View Artifact ↗** in that project's ⋮
menu, opening in a new tab. `artifactUrl`/`artifactUpdatedAt` on the
project doc are written directly by the Notify Claude Routine (a plain
Firestore field, not a code change, so it never goes through
`patchFiles`/`patchReady`) — see `REQUIREMENTS.md` → "Data model" and
`ROUTINE_INSTRUCTIONS.md` → "Project Artifact" for the field shape and how
a Routine run creates or updates one.

## Who can use this, and their AI agents (MCP)

Access is no longer a hard-coded list of two emails. **One Firestore doc per
person — `consoleUsers/<lowercased email>` — decides both halves of their
access**: whether they can open the console in a browser, and whether their
own AI agent may connect to it. Admins manage the list from **Settings →
Team & agent access**; `firestore.rules` and `functions/mcp-server.js`
resolve the same doc, so adding or removing someone is a single act.

Roles are `admin` (manages the list), `editor` (read + write) and `viewer`
(read only — the board shows a read-only banner and the rules refuse their
writes). Two owner accounts stay hard-coded in the rules so an empty or
mis-edited collection can never lock everyone out.

Sign-in is **Google or email + password**. For someone with no Google
account, an admin presses *Send sign-in setup* on their row: that creates
their Firebase Auth login and emails them a link to choose their own
password. Nobody types or sends a password on anyone's behalf.

**The MCP server** (`functions/mcp-server.js`, served at
`https://backlog-tracker-e4ed2.web.app/mcp`) lets a member's agent use the
board and the help centre as a tool, authenticating with that same account
through a proper OAuth 2.1 flow — no key to mint, paste or rotate, and
everything the agent writes is attributed to their email.

On tickets it is deliberately read/file/comment only. On **documentation**
it is full read/write — a project's Requirements, README, additional
documents, interface contracts and Artifact link — because keeping those
current is part of doing the work. Every documentation write records what it
replaced in `docRevisions`, so a bad write or a delete is recoverable.

**No tool merges, approves a ticket out of Ready for Testing, or moves a
card's status — with one deliberate, narrowly-scoped exception.**
`approve_deploy_to_main` (editor/admin only) fires the exact same trigger
the console's own **Deploy to Main** button writes; it never merges
anything itself, and only when every ticket on the project's train is
already Approved for Deployment and Ready for Testing is empty for it —
the same condition that shows that button — logging every call to
`mcpAuditLog`. Two read-only tools, `get_ready_for_testing_board` and
`get_approved_for_deployment_board`, render those two columns as an
embedded HTML card resource for a client that supports it, alongside the
same data as plain text — reviewing there changes nothing either. Beyond
that one trigger, everything else stays on the board's own buttons and the
triggered Routine. The documentation tools write to `projects`, so that is
enforced by a single `updateProjectFields` allowlist rather than by never
touching the collection — `approve_deploy_to_main` writes its own single
field through a separate, dedicated path, not through that allowlist.
`set_my_routine_binding` (VNE6dxMu3h6jO3g6FNNB) is not a second exception:
it only registers which Routine a member's OWN later board click fires
under (write-only — no tool reads the stored fireUrl/token back), it never
fires a session itself. See `MCP.md` → "What the agent can and can't do"
for the full detail.

This is a different thing from `boardApi` (further down this file), which is
ONE shared secret standing in for the Routine's own automation. The MCP
server is per-person, per-token and individually revocable.

**Read [`MCP.md`](./MCP.md)** for how to connect a client, how an admin adds
someone, the full tool list, and how the OAuth flow is built.

## Setup (all manual — this sandbox has no Firebase CLI/deploy access)

Same caveat as `menu-board-demo/functions` in the root `CLAUDE.md`:
**Claude cannot create the Firebase project or deploy this itself.**
Everything below runs on your own machine, with a Google account that has
(or can create) a Firebase project. Prerequisite: Node.js installed
locally (needed for `npm` and the Firebase CLI).

### 1. Create the Firebase project

1. Go to the [Firebase Console](https://console.firebase.google.com/) →
   **Add project**.
2. Name it something like `backlog-tracker` — deliberately a *new*
   project, not `rob-ph-demos` (the one `menu-board-demo` uses), so the
   isolation described above actually holds. Firebase will generate a
   project ID like `backlog-tracker-a1b2c`; **note the exact ID**, you'll
   need it twice below.
3. Google Analytics prompt: not needed for this, skip/disable it.
4. **Create project**, wait for provisioning, **Continue**.

### 2. Enable Firestore

1. Left sidebar → **Build → Firestore Database → Create database**.
2. Start in **production mode** (locked by default — safe, since we
   deploy our own rules in step 5 right after).
3. Pick a location (can't be changed later) → **Enable**.

### 3. Register a Web app and get its config

1. Project Overview page → click the **`</>`** (Web) icon → **Add app**.
2. Nickname it e.g. `backlog-tracker-web`. You can skip the Firebase
   Hosting checkbox here — hosting is deployed via the CLI in step 8.
3. **Register app** — Firebase shows a `firebaseConfig` object
   (`apiKey`, `authDomain`, `projectId`, `storageBucket`,
   `messagingSenderId`, `appId`). Copy the whole thing.

### 4. Wire the config into this repo

On the machine where you'll run the `firebase` CLI (pull/clone this repo
there first):

1. Open `backlog-tracker/public/js/firebase-config.js` and replace the
   `REPLACE-ME` placeholders with the real values from step 3.
2. Open `backlog-tracker/.firebaserc` and replace
   `REPLACE-WITH-YOUR-NEW-FIREBASE-PROJECT-ID` with the real project ID
   from step 1 (the short slug, e.g. `backlog-tracker-a1b2c` — not the
   display name).

### 5. Install the Firebase CLI and log in (one-time)

```bash
npm install -g firebase-tools
firebase login                 # opens a browser — sign in with the
                                # Google account that owns the project
cd backlog-tracker
firebase use --add             # pick the new project, alias it "default"
```

### 6. Deploy the Firestore rules

```bash
firebase deploy --only firestore:rules
```

Confirm it in the console: Firestore → **Rules** tab should show the new
rules content.

### 7. Set up a notification target — Slack incoming webhook (simplest)

This is the concrete, easiest-to-verify option; see the alternatives
further down if you want a different target.

1. Go to <https://api.slack.com/apps> → **Create New App → From scratch**.
2. Name it (e.g. `Backlog Tracker Notifier`), pick your workspace.
3. Left sidebar → **Incoming Webhooks** → toggle it **On**.
4. **Add New Webhook to Workspace** → choose a channel (e.g.
   `#backlog-alerts`) → **Allow**.
5. Slack shows a URL like `https://hooks.slack.com/services/T000/B000/XXXX`
   — copy it.

### 8. Install function dependencies, store the webhook secret, deploy

```bash
cd backlog-tracker/functions
npm install
cd ..
firebase functions:secrets:set NOTIFY_WEBHOOK_URL
#   ↳ paste the Slack webhook URL from step 7 when prompted
firebase deploy --only functions
#   ↳ first deploy of a 2nd-gen function prompts to enable the Blaze
#     (pay-as-you-go) plan and a few Google Cloud APIs (Cloud Build,
#     Artifact Registry, Eventarc) — confirm these; see "Will this cost
#     money?" below, they stay within the free tier at this scale.
```

### 9. Deploy hosting (optional — the app is static and can be hosted anywhere)

```bash
firebase deploy --only hosting
```

Firebase prints a live URL, e.g. `https://backlog-tracker-a1b2c.web.app`.

### 10. Test it end to end

1. Open the hosting URL (or `public/index.html` locally — Firestore and
   the function are cloud-hosted either way, only the static files would
   be local).
2. Click **+ New backlog item** on a project, fill in a description, submit.
3. Click that same project's **Notify Claude** header button.
4. Check the Slack channel from step 7 — a message naming the project and
   item count should land within a few seconds (and, if
   `CLAUDE_ROUTINE_FIRE_URL`/`CLAUDE_ROUTINE_TOKEN` are also set, a fresh
   Claude Code session starts on the Routine).
5. If nothing shows up: `firebase functions:log` — look for "Notified
   webhook of Notify Claude click" (success) or the logged error.

### Ongoing: redeploying after a code change

A push to `main` that touches anything under `backlog-tracker/` now
auto-deploys via `.github/workflows/deploy-backlog-tracker.yml` — it runs
`firebase deploy --only hosting,functions,firestore:rules` for you, the
same way pushing to `main` already publishes the rest of this repo via
GitHub Pages. This needs one thing only a project owner can create: a
Firebase service account key for `backlog-tracker-e4ed2`, stored as the
GitHub Actions secret `FIREBASE_SERVICE_ACCOUNT_BACKLOG_TRACKER`.

1. Firebase Console → **Project settings → Service accounts → Generate
   new private key** (downloads a JSON file).
2. GitHub repo → **Settings → Secrets and variables → Actions → New
   repository secret**, name it `FIREBASE_SERVICE_ACCOUNT_BACKLOG_TRACKER`,
   paste the whole JSON file contents as the value.

Once that secret exists, every push to `main` deploys automatically — no
one needs to run `firebase deploy` by hand again. You can also trigger it
manually from the Actions tab (`workflow_dispatch`) without a new push.

The service account also needs enough IAM roles on the
`backlog-tracker-e4ed2` Google Cloud project (Console →
**IAM & Admin → IAM**, edit that service account's roles) to actually
deploy each piece — at minimum:

- **Service Account User** (`roles/iam.serviceAccountUser`) — required to
  deploy the Cloud Function at all.
- **Firebase Admin** (`roles/firebase.admin`) — covers hosting, functions
  config, and Firestore rules deploy/test in one grant.
- **Secret Manager Admin** (`roles/secretmanager.admin`) — the notify
  function reads a `NOTIFY_WEBHOOK_URL` secret (see below); creating and
  reading it needs this.
- **Artifact Registry Repository Administrator**
  (`roles/artifactregistry.repoAdmin`) — each functions deploy builds a
  container image via Cloud Build and pushes it to the `gcf-artifacts`
  Artifact Registry repo; without this role the CLI can push new images
  but not delete old ones, which is harmless to the deploy itself (it
  still succeeds) but leaves orphaned images accumulating a small storage
  cost over time. This role also lets the workflow's cleanup-policy step
  (below) configure automatic deletion.

If the workflow's deploy step fails with a permissions/IAM error, that's
almost always a role missing here, not a bug in the workflow itself.

### Merging several PRs at once — the deploy concurrency group

Merging multiple PRs within seconds of each other used to fire one deploy
run per push, all racing to update the same Cloud Functions at once — GCP
rejects the losers with `409 unable to queue the operation`. The workflow's
`concurrency` block (keyed on `${{ github.workflow }}-${{ github.ref }}`,
`cancel-in-progress: true`) fixes the mechanical race: a burst of N merges
now completes exactly one deploy, for the newest commit, instead of N
racing runs.

There used to also be a per-project **Deployments** page (⋮ → Deployments)
that grouped tickets meant to ship together and showed a checklist of which
were confirmed "Approved for Deployment" — removed by request (its owner
found the ⋮ menu entry confusing and wasn't relying on it), and later
removed again in its second form (a dedicated grouping view built on a
`deployments` Firestore collection, PR #98). Nothing about `patchFiles`/
`patchReady`'s own "give every item in a shared-file batch the same full
combined content" convention depended on either removed page — that's a
separate, code-level mechanism in `run-backlog-automation.js`, unaffected
either time. The human-facing "which PRs were meant to land together" view
these pages provided isn't gone for good, though: `deploymentGroupKey()` in
`app.js` now derives it for free from `patchBranch`/`prNumber` (branch wins
when both are present) and the board draws matching cards bracketed
together with a "Ships together" header, right where they already sit —
no separate page, no `deployments` collection, no `deploymentId` field.
`firestore.rules` has no `match` block for `deployments` any more, and
`ROUTINE_INSTRUCTIONS.md` no longer tells a fired session to create one —
see that file's own "Cards that ship together are already grouped" section.

### backlog-automation.yml reconciles instead of failing forever on a cancelled run

`cancel-in-progress: false` (see the workflow's own comment) means an
in-progress run of this job is never killed by a newer trigger — but a
burst of triggers (a wave of merges in a short window, each one dispatching
this job via `onBacklogItemReadyForAutomation`) can still queue several
runs back to back, and unlike `deploy-backlog-tracker.yml` this job isn't a
pure, restartable build: it pushes a branch, opens a PR, then writes status
back to Firestore, in that order, and a run genuinely can end (timeout,
runner loss, a manual cancel) between any two of those steps. Before this
fix, that left an item stuck `patchReady:true` with a branch on GitHub the
board didn't know about — the next run's plain `git push` to that same
deterministic branch name failed non-fast-forward against the leftover
push, retrying every ~2 minutes until `MAX_PATCH_ATTEMPTS` gave up, with
nothing on the card explaining why.

`processApplyPatch` now reconciles against this item's own branch (its name
embeds the item id, so it can never belong to any other item) before doing
any fresh git work: `findPrForBranch()` checks whether that branch already
has a PR in any state. A `MERGED` or still-`OPEN` match means an earlier,
interrupted run already got further than the board knew — the item is
moved straight to Ready for Testing with that PR attached instead of trying
(and failing) to push again. A `CLOSED` match is treated as a human's
deliberate rejection, not something to retry. And the actual push itself is
now `--force` — safe specifically because the branch is this job's own,
item-scoped, and the reconciliation check above already ruled out a PR
existing for it, so overwriting whatever's there (a stale push from a
cancelled run, most likely) can't lose real reviewed work.

### Deploy provenance is now recorded per card, not just per version

`testVersion` (backlog-tracker's own `APP_VERSION`, stamped once a card
reaches Ready for Testing) answers "which build do I test this in" — but
once several cards ship inside the same version, it can't answer "did
*this* card's fix actually go live." `processMergePr` now also writes, at
merge time: `mergeCommit` (the PR's actual merge commit sha), and
`deployRunUrl`/`deployConclusion` for whichever `deploy-backlog-tracker.yml`
run its own `gh workflow run` dispatch triggered (only when the merge
touched `backlog-tracker/` at all — otherwise `deployConclusion` is
`"not-applicable"`). The dispatched run usually hasn't finished by the time
the merge itself completes, so `deployConclusion` starts `"pending"`;
`reconcileDeployStatuses()`, run at the top of every scheduled tick, sweeps
every card still `"pending"` and fills in the real `conclusion` (`success`,
`failure`, ...) once GitHub has one. `cardHTML`'s `deployBadge` shows this
on a Merged to Main (Live) card — the commit's short sha, and a link to the
deploy run colored by its outcome. Before this, confirming a batch of cards
were genuinely live meant fetching the deployed `app.js` and comparing its
hash against `main` by hand.

### The New Item form nudges toward folding in a likely duplicate

Three cards asking for the same thing, reworded three ways, were each
independently built and deployed as three separate PRs in one night — see
`ROUTINE_INSTRUCTIONS.md`'s own "Check for duplicate open work before
packaging" section for the packaging-time half of the fix. This is the
creation-time half: before saving a new item, `findLikelyDuplicate()` does
a cheap keyword-overlap check (an overlap coefficient over significant
words, not embeddings — same spirit as `suggestCategory()` just above it in
`app.js`) against every currently open item in the same project. A strong
match offers "Add as comment on that ticket instead" as the default path,
with "Create separate ticket anyway" always available for a false positive.
It's a nudge, not a hard block — two genuinely different requests can share
a lot of wording, and this only ever compares against *open* items, so it
never second-guesses prior art that's already shipped or been archived.

### A bounded text field now says so before the write fails

`firestore.rules` caps several string fields (`backlogItems.desc` at 2000,
`title` at 200, project/interface/doc `name` at 80-120, interface/doc
`contentMd` at 20000) and rejects a write over the cap with a bare 403
permission-denied — nothing in that error names the field or the limit.
Native `maxlength` on the relevant `<textarea>`/`<input>` already stopped
most of this at the source (and `if-content-input`/`doc-content-input` now
carry one too, matching their 20000-character rule, which they didn't
before), but said nothing to someone approaching a limit, and did nothing
at all against dictation, which sets `.value` straight from script — a path
that bypasses `maxlength` entirely, called out explicitly as a way to run
past 2000 characters without noticing. Two fixes: `wireCharCount()` puts a
live "X / max" readout under every bounded field, turning amber near the
cap and red at it; and `createDictationController`'s `onresult` handler now
clamps to the field's own `maxLength` the same way typing already was,
surfacing a plain-language message when it does. `describeSaveError()` is
the last-resort net for whatever still gets through: if a write is refused
and a field the app just tried to save is actually over its known cap, the
alert names which one and by how much, instead of surfacing the raw
"permission-denied" wording.

### A scrolled-down column no longer jumps back on every render

`renderNow()` replaces `#projects-root`'s entire `innerHTML` on every
render — cheap to reason about, but it recreates every `.col-list` element
from scratch, including whichever one a viewer was scrolled down in. That
snapped a column back to its top on *any* render, not just the "Confirm
tested" click it was first reported against (that write flips `testPassed`
in Firestore, the `onSnapshot` listener fires, `render()` runs, and the
column you were scrolling through jumps back to the first card). `colListId()`
already gives each column a stable id across renders even though the
element itself isn't the same node, so `renderNow()` now captures each
`.col-list`'s `scrollTop` by that id immediately before the rebuild and
restores it immediately after — fixing every render path at once rather
than special-casing the one button that happened to surface it.

### Cleaning up old Cloud Build/Artifact Registry images

Every functions deploy leaves a build image behind in the `gcf-artifacts`
repo. The workflow's last step, "Set Artifact Registry cleanup policy for
gcf-artifacts", configures that repo to auto-delete untagged images older
than 3 days — a one-time-effective setting that gets (harmlessly)
reapplied on every deploy. It's marked `continue-on-error: true` since
this is pure housekeeping: if it fails (e.g. the Artifact Registry
Repository Administrator role above isn't granted yet), the deploy itself
still succeeds, only the automatic cleanup doesn't happen that run.

### The `NOTIFY_WEBHOOK_URL` secret

`functions/index.js`'s `notifyOnProjectReadyForReview` reads a Firebase
secret called `NOTIFY_WEBHOOK_URL` (see step 7 above for creating a Slack
incoming webhook, or an alternative target). The workflow keeps this in
sync automatically from a GitHub Actions secret of the same name — add a
repo secret named `NOTIFY_WEBHOOK_URL` (Settings → Secrets and variables →
Actions → New repository secret) with the webhook URL as its value, and
every deploy pushes that value into Firebase Secret Manager before
deploying the function. If that GitHub secret isn't set, this step is
skipped and the manual `firebase functions:secrets:set NOTIFY_WEBHOOK_URL`
command still works as a one-off alternative.

If the secret isn't set yet, or you need to deploy from a machine
directly, the manual commands still work exactly as before, run from
inside `backlog-tracker/`:

| Changed | Redeploy with |
|---|---|
| `public/**` | `firebase deploy --only hosting` |
| `functions/**` | `firebase deploy --only functions` |
| `firestore.rules` | `firebase deploy --only firestore:rules` |
| `storage.rules` | `firebase deploy --only storage:rules` |

### Alternatives to the Slack webhook

`notifyOnProjectReadyForReview` already does the no-human-relay thing on
every Notify Claude click — it fires a Claude Code Routine's API trigger
directly (see below), independently of whatever `NOTIFY_WEBHOOK_URL`
points at. So `NOTIFY_WEBHOOK_URL` itself is just the "someone should
also see this in chat" side-channel, not the thing that gets Claude's
attention — pick whatever's convenient for that:

- **Slack incoming webhook** (above) — easiest, and what step 7 sets up.
- **A live Claude Code Remote session's `watch_url` webhook** — the same
  kind of URL this session used to watch the Prototype Pipeline Artifact.
  Wakes that specific session directly with no human in the loop, but the
  URL is tied to one running session and needs re-registering (a fresh
  `watch_url` call) whenever that session ends.
- Leave it unset entirely — the Routine still fires on every Notify Claude
  click either way; `notifyOnProjectReadyForReview` just skips the webhook
  POST and logs a warning if `NOTIFY_WEBHOOK_URL` isn't set.

### The `CLAUDE_ROUTINE_FIRE_URL` / `CLAUDE_ROUTINE_TOKEN` secrets

`functions/index.js`'s `notifyOnProjectReadyForReview` (the **⋮ → Notify
Claude** button's function) reads two Firebase secrets instead of a plain
webhook URL, because firing a Routine needs an authenticated `POST`, not
just a URL:

- `CLAUDE_ROUTINE_FIRE_URL` — `https://api.anthropic.com/v1/claude_code/routines/{routine_id}/fire`,
  where `{routine_id}` is the Routine's own trigger id (starts `trig_`).
- `CLAUDE_ROUTINE_TOKEN` — the bearer token that Routine's API trigger
  generated. **Treat this exactly like a password** — anyone holding it can
  fire a real Claude Code session against this repo. Never commit it,
  paste it somewhere public, or log it.

To set this up:

1. Go to `claude.ai/code/routines` and create a Routine whose prompt does
   what you want run — e.g. "investigate and fix every item in this
   project's Backlog column, note what changed, move each to Ready for
   Testing, then report back" (this is what the Routine backing this
   feature was actually given).
2. Add an **API trigger** to that Routine and generate its token. Copy the
   fire URL (it includes the Routine's own trigger id) and the token.
3. Add both as GitHub repo secrets named exactly `CLAUDE_ROUTINE_FIRE_URL`
   and `CLAUDE_ROUTINE_TOKEN` (Settings → Secrets and variables → Actions →
   New repository secret). The workflow syncs both into Firebase Secret
   Manager on every deploy, same pattern as `NOTIFY_WEBHOOK_URL`.
4. If either secret isn't set, the function logs a warning and does
   nothing — clicking the button still writes `notifyRequestedAt` to
   Firestore, it just won't fire anything until both secrets exist.

This is a **research-preview API** (Anthropic's own description of it) —
the exact endpoint path and the two headers the function sends
(`anthropic-beta: experimental-cc-routine-2026-04-01` and
`anthropic-version: 2023-06-01` — the latter is required or the endpoint
returns 400 with `"anthropic-version: header is required"`, confirmed by
testing the fire endpoint directly with `curl`) may change. If firing
starts failing with an auth or version-related error after previously
working, check Anthropic's current Claude Code Routines docs for what
changed, and re-test with `curl` before re-patching the function — see
the request shape in `functions/index.js`'s `notifyOnProjectReadyForReview`.

### Per-member routine binding — firing under your own account instead of the shared secrets above (VNE6dxMu3h6jO3g6FNNB)

The two secrets above are **one shared Routine for the whole project** —
every Notify Claude / Notify Claude — Deploy / Groom Backlog click, from
anyone, fires the same Routine and runs under that one Claude account's
usage. An engineer can instead register their own Routine, so board clicks
*they* make fire a session under *their own* account:

1. Over MCP, call `get_routine_setup_instructions` (see `MCP.md`) — it
   returns the exact bootstrap prompt to paste into a new Routine at
   `claude.ai/code/routines` (the same one `ROUTINE_INSTRUCTIONS.md`'s own
   bootstrap uses), plus where to find that Routine's own API trigger fire
   URL and token once you add one.
2. Call `set_my_routine_binding` with that `fireUrl`/`token`. This is
   **write-only** — stored on `consoleUsers/{email}.routineFireUrl` /
   `.routineFireToken`, and no tool or UI, including `whoami`, ever reads
   them back; `whoami`'s `hasRoutineBinding` only ever says whether one is
   set. Pass both as `""` to clear it and go back to the shared secrets.

`functions/index.js`'s `resolveRoutineCredentials` — shared by all three
fire functions — checks the clicking member's binding
(`projects/{id}.notifyRequestedByEmail` /
`deployNotifyRequestedByEmail` / `groomRequestedByEmail`, written by
`public/js/app.js`'s click handlers) first and only falls back to
`CLAUDE_ROUTINE_FIRE_URL`/`CLAUDE_ROUTINE_TOKEN` when they have none set,
or the click can't be attributed to anyone. Which one fired is recorded as
`firedVia` (`"member"` or `"shared"`) on `notifyRoutine`/`deployRoutine`/
`groomRoutine`, for debugging.

There's no way to automate the `claude.ai/code/routines` step itself —
the routines API has no delegated-OAuth "fire on behalf of" flow, so a
Routine's fire URL/token is per-Routine and hand-generated once. This
MCP-driven local setup is the closest one-click the API allows.

### The `GH_DISPATCH_TOKEN` secret — waking `backlog-automation.yml` immediately

`backlog-automation.yml` polls every 2 minutes, but GitHub throttles a
scheduled workflow well past its nominal interval under load — measured
gaps as wide as 10-12 minutes in practice (see `ROUTINE_INSTRUCTIONS.md`),
almost all of the wall-clock time between the Notify Claude Routine
finishing and a fix actually reaching Ready for Testing. `functions/index.js`'s
`onBacklogItemReadyForAutomation` closes that gap: the instant a
`backlogItems` doc's `patchReady` or `mergeReady` flips to `true`, it calls
GitHub's `repository_dispatch` API directly (`POST
/repos/offline2online/rob_ph_demos/dispatches` with `event_type:
"backlog-automation"`), which `backlog-automation.yml`'s own
`repository_dispatch` trigger picks up within seconds — the schedule stays
as the safety net for whenever this secret isn't configured, or the
dispatch call itself fails. The dispatch only ever makes the job run
*sooner*, never instead, and the job still re-reads every flagged item from
Firestore itself rather than trusting the dispatch payload.

This needs a GitHub Personal Access Token — fine-grained, resource owner
`offline2online`, this repository only, **Actions: Read and write** (plus
the Metadata read it includes automatically). A classic token with the
`repo` scope also works but grants far more than this needs. Add it as a
**GitHub repo secret named exactly `GH_DISPATCH_TOKEN`** (Settings →
Secrets and variables → Actions → New repository secret); every deploy
syncs it into Firebase Secret Manager, same pattern as
`NOTIFY_WEBHOOK_URL` and the two `CLAUDE_ROUTINE_*` secrets.

**`GH_`, not `GITHUB_`** — GitHub refuses to create any repo secret whose
name begins with `GITHUB_`, that prefix being reserved for the variables it
injects itself. An earlier draft of this section documented
`GITHUB_DISPATCH_TOKEN`, which cannot exist.

Unlike the other secrets, the deploy workflow writes this one on **every**
deploy, falling back to the literal value `unset` when the repo secret
isn't there. That's deliberate: `functions/index.js` declares it with
`defineSecret()`, and `firebase deploy --only functions` fails outright if
a declared secret is missing from Secret Manager entirely — which would
take hosting and the Firestore rules down with it, over a feature nobody
had configured yet. The function treats `unset` exactly like a missing
value: it logs a warning, dispatches nothing, and leaves
`backlog-automation.yml` to its schedule. Creating the token itself is a
human, one-time step — an agent session has no way to mint a GitHub token
for itself.

Once the token is in place, the acceptance check is simply that setting
`patchReady` on an item produces its PR within about a minute rather than
~10, and that the triggering run shows **repository_dispatch** (not
`schedule`) as its event on the Actions tab.

### The workflow-push GitHub App — letting the pipeline change `.github/workflows/`

GitHub refuses any push from a workflow's own `GITHUB_TOKEN` that creates
or updates a file under `.github/workflows/`, whatever `permissions:` the
job declares, so a card whose fix touches a workflow file used to be
refused outright (`WORKFLOW_PATH_PREFIX` guard in
`run-backlog-automation.js`). `backlog-automation.yml` can now mint a
short-lived installation token from a GitHub App and push those branches
with it — but only under strict guardrails, because a workflow file runs
with every repository secret and `patchFiles` originate from the Notify
Claude Routine, which builds them from card text (a prompt-injection
surface):

- The token is used for the **branch push of a workflow-touching item and
  nothing else**. PR creation, merges and the deploy dispatch keep using
  the run's `GITHUB_TOKEN`, so nothing else changes (in particular, a
  merge still never fires other workflows' `on: push`, so the explicit
  deploy dispatch is still the only deploy trigger — no double deploys).
- Before pushing, `workflowChangeProblems()` refuses the item if it adds
  a **new** workflow file, **deletes** one, or changes any touched
  workflow's **`on:` trigger block** compared with `main`. Every workflow
  in this repo fires only on `main`, on a schedule, or on an explicit
  dispatch, so a pushed branch can never run its own modified file —
  which matters because a push made with an App token, unlike one made
  with `GITHUB_TOKEN`, does trigger `on: push` workflows.
- `processMergePr` **never merges** a PR that touches
  `.github/workflows/`: it clears `mergeReady`, notes the card, and a
  person reviews and merges the PR on GitHub. Clicking Notify Claude —
  Deploy afterwards finds the PR merged and records it as live. The card
  carries `requiresHumanMerge: true` from the moment its PR is opened.
- The token never appears in a git argument (it is passed through
  `GIT_CONFIG_*` environment variables), and `recordAttemptFailure` scrubs
  it from any error text before that text is written to a card.

**One-time set-up (a human step — an agent session cannot create GitHub
Apps or repo secrets):**

1. GitHub → Settings → Developer settings → GitHub Apps → **New GitHub
   App**, owned by `offline2online`. Name it something like
   `ph-backlog-workflow-push`. Homepage URL can be the repo URL.
   Untick **Webhook → Active** (no webhook is needed).
2. **Repository permissions**: `Contents` → Read and write, `Workflows` →
   Read and write. Nothing else; no organisation or account permissions.
   **Where can this GitHub App be installed?** → *Only on this account*.
3. Create the App, then on its page **Generate a private key** (a `.pem`
   file downloads) and note the **App ID**.
4. **Install App** → `offline2online` → **Only select repositories** →
   `rob_ph_demos` → Install. This is what restricts every token the App
   can mint to this one repository; `backlog-automation.yml` additionally
   pins the minted token to `rob_ph_demos` via the action's
   `repositories:` input, so the restriction holds even if the
   installation is ever widened by mistake.
5. Repo → Settings → Secrets and variables → Actions → two **repository
   secrets**: `WORKFLOW_APP_ID` (the App ID) and `WORKFLOW_APP_PRIVATE_KEY`
   (the full contents of the `.pem` file, including the BEGIN/END lines).
   Delete the downloaded `.pem` afterwards.

With both secrets absent the mint step is skipped and workflow-touching
items are refused with a note, exactly as before — so adding the secrets
is the only switch. Acceptance check: set `patchReady` on a card whose
`patchFiles` edit an existing workflow (the `storage:rules` card is a
one-liner); it should reach Ready for Testing with a PR opened by
`github-actions[bot]` whose head commit was pushed by the App, and Notify
Claude — Deploy on it should leave a "Not merged by the pipeline… review
and merge it on GitHub" note rather than merging. Optional hardening on
GitHub's side: a branch-protection rule on `main` with a CODEOWNERS entry
for `/.github/workflows/` requiring your review, which enforces the
human-merge rule even for pushes made outside this pipeline.

### Notify Claude progress (`notifyRoutine`) — session id, spinner, split count

The fire endpoint's success response includes a `claude_code_session_id`
field — confirmed by a live `curl` test against the real endpoint (also a
research-preview surface, so re-confirm this with `curl` if session links
ever silently stop appearing, same caution as the header gotcha above).
`notifyOnProjectReadyForReview` reads it, builds
`https://claude.ai/code/<id>`, and writes the whole outcome to
`projects/{id}.notifyRoutine` (`status`, `firedAt`, `sessionId`/
`sessionUrl`, `itemCount`, `sentItemIds`) — the board's Notify Claude
button reads this to show a spinner while a fire is in flight, plus a
separate small CTA for anything added to Backlog since that click
(`sentItemIds` is how it knows what's "new"). The button shows the spinner
the instant it's clicked (a client-local optimistic state — see
`notifyOptimisticClicks` in `app.js`), before this doc even exists yet, so
there's no dead-looking gap while the Cloud Function round-trips. Once the
doc lands with `status: "in-progress"` but no `sessionUrl` yet, it reads
"Working…"; once a session id has resolved, the button itself becomes the
session link (copy flips to "Deving…", `target="_blank"` to
`sessionUrl`) — there's no separate "View session" link anymore.

The Routine is asked, in the fire request's own `text`, to PATCH
`notifyRoutine.status` to `"done"`/`"error"` (with `finishedAt`) when it
stops — but nothing enforces that a fired session actually does this
(an older Routine prompt won't know to, and a crashed session can't). The
frontend's own fallback — treating any `"in-progress"` older than 20
minutes as done — is what actually keeps the button from getting stuck
forever, not the self-report; treat the self-report as a nice-to-have for
faster feedback, not the safety mechanism.

**The "Deploy to Main" button now has the identical mechanism**,
`projects/{id}.deployRoutine`, written by `notifyOnProjectReadyToDeploy`
and read by `deployNotifyButtonHTML`/`deployOptimisticClicks` in `app.js` —
same fields (`status`, `firedAt`, `sessionId`/`sessionUrl`, `itemCount`),
same 20-minute stale fallback, same self-report hint embedded in the fire
`text` (targeting `deployRoutine` instead of `notifyRoutine`), same
optimistic click-to-spinner bridge. Before this existed, clicking "Deploy
to Main" gave no ongoing feedback at all — a one-time `alert()`, then the
button looked exactly as it had before the click — so a deploy that was
still genuinely in flight was indistinguishable from one that had never
been requested. The matching per-item signal is `backlogItems.mergeReady`:
a ready-to-publish card the Routine has confirmed is green/mergeable and
handed to `backlog-automation.yml` renders locked (greyed out, no
controls) exactly like an `isInDevelopment` Backlog card — see
`cardHTML`'s `isDeploying` and REQUIREMENTS.md → "A Backlog card locks
while a fix is in flight".

### Per-project Routine instructions (`routinePromptMd`)

The Routine itself has one fixed prompt shared by every project on the
board (see `claude.ai/code/routines` — its prompt covers the generic
"how to work this board" workflow: read `requirementsMd`, check
`interfaces`, rewrite item titles, PATCH the right fields, open a PR).
Some projects need something extra on top of that without editing the
shared Routine prompt for everyone else — a different branch naming
convention, a note about which slice of the repo this project owns,
anything the generic workflow wouldn't know on its own.

Each project's **⋮ → Docs** page has a **Routine instructions** field for
exactly this (`projects/{id}.routinePromptMd`, plain markdown, optional —
blank means "just use the Routine's own default instructions"). When
**Notify Claude** is clicked, `notifyOnProjectReadyForReview` reads this
field and, if non-blank, prepends it to the fire request's `text` wrapped
in `=== PROJECT-SPECIFIC INSTRUCTIONS ===` / `=== END ===` markers, ahead
of the usual "Project X has N items in Backlog" list — see
`functions/index.js`. The Routine's own prompt needs to know to look for
and follow that block; if you update the per-project field but the fired
session doesn't seem to pick it up, check the Routine's prompt at
`claude.ai/code/routines` for that instruction (this can't be added by an
agent session — a Routine created via the `claude.ai` UI's own "API
trigger" flow can only be edited there, not via `update_trigger`).

## FAQ / Help Center

A second consumer-facing surface lives alongside the backlog board itself,
sharing this same Firestore project. **All content and structure here
follows [`../docs/CONTRIBUTING-docs.md`](../docs/CONTRIBUTING-docs.md)**
— the governing documentation standard (Diátaxis document types, FAQ
writing rules, formatting/accessibility conventions). Read it before
writing or editing an article; every article's `docType` (see "Data
model" below) should be set honestly per that file's §2, not left at its
default.

- **Public site**: repo-root `faq/` (outside `backlog-tracker/` entirely —
  a plain static site published via GitHub Pages, not Firebase Hosting).
  Since the September 2026 rewrite it renders a **static snapshot in
  `faq/data/`** rather than reading Firestore with the SDK: front page +
  category grid in new-customer order, category pages with folders,
  article pages (table of contents, previous/next, freshness check against
  Firestore's REST API), search. `.github/workflows/faq-content.yml`
  exports Firestore → `faq/data` hourly/on demand and syncs `faq/data` →
  Firestore on push (`scripts/faq-export.js`, `scripts/faq-sync.js`). See
  `faq/README.md` and `docs/faq-audit-2026-09.md`.
- **Sign-in**: the whole console requires a signed-in member (see "Who can
  use this, and their AI agents (MCP)" above); FAQ writes are covered by the
  same `isEditor` rule. The FAQ pages additionally show
  who is editing, and every save/reorder/delete goes through
  `requireFaqEditor()` in `app.js`.
- **Admin**: two separate hamburger-menu destinations, **Settings**
  (categories — name, icon picked from a curated dropdown with a live
  preview, description, display order) and **FAQ Management** (articles —
  title, slug, category, a **document type** select (FAQ / How-to guide /
  Reference / Explanation — see "Data model" below), an optional linked
  project, an optional product/program, summary, a rich-text body via a real
  editor (Quill) with an Edit/View-live toggle, search keywords,
  draft/published status, and a "needs review" flag). Global, not
  per-project, since an article can span or link to any one project.
  Clicking an article opens a **dedicated full-page editor**, not a modal —
  title/summary/body (the primary focus) take the full page, with a
  Cancel / Save draft / Publish action row fixed at the top of the page
  (never buried at the bottom), and everything else above lives in a
  right-hand sidebar of independently expand/collapsible named groups
  ("Article properties", "Search & keywords", "Status & publishing")
  instead of one flat "Advanced settings" panel (`public/js/app.js`'s
  `openFaqArticleEditorPage`/`setFaGroupOpen`/`resetFaGroups`). **Save
  draft** and **Publish** are two explicit actions, not one "Save" button
  plus a separate status toggle: Save draft writes the current fields and
  never promotes an already-draft article to published on its own; Publish
  writes the current fields, sets `status: "published"`, and stamps
  `publishedAt` the first time an article goes live
  (`submitFaqArticleFromEditor` in `app.js`). Inserting an image
  via the editor's toolbar prompts for alt text as well as a URL —
  `docs/CONTRIBUTING-docs.md` §6/§5.6 makes alt text mandatory on every
  informative image, enforced here at authoring time rather than by a later
  audit. Opening a saved article rewrites its HTML into the shape Quill
  can represent before Quill sees it, loads it through Quill's own
  Delta path, and warns above the body if any characters didn't survive
  (`faqHtmlForQuill`/`faqSetEditorHtml` in `app.js`; regression test
  `test/faq-editor-load.test.mjs`, opt-in `npm run test:editor`) — the
  two naive load paths before it each silently lost whole lists, see
  `REQUIREMENTS.md` → "Loading an article into Quill is a rewrite".
  See `REQUIREMENTS.md` → "Rich-text article body" for the
  format-migration and sanitization details — this is real HTML now, not
  markdown, and it's sanitized (DOMPurify) at render time on both the admin
  preview and the public site since `faqArticles`' write rules are wide
  open.
  - **List vs. Folders**: FAQ Management's Articles block offers both — the
    original flat, filterable **List** (category/status/needs-review/search)
    stays the default, and a **Folders** toggle switches to a drill-down
    tree grouped by Product/Program (the top-level `programs` collection —
    see `programId` below) and then Category, so a large article set can be
    navigated by "click Personalisation Hub, click a category, see its
    articles" instead of only ever scanning/filtering one flat list.
    Expand/collapse state is in-memory only (`public/js/app.js`'s
    `faFolderState`), same as the List view's own filters not persisting.
- **Data model** — two new top-level collections:
  - `faqCategories/{id}`: `{name, icon, description, order, createdAt, updatedAt}`
  - `faqArticles/{id}`: `{categoryId, projectId (nullable), programId (nullable), title, slug, summary, bodyMd, docType: "faq"|"how-to"|"reference"|"explanation", keywords[], status: "draft"|"published", needsReview, order, createdAt, updatedAt, publishedAt, pendingRevision?, previousRevision?, lastPromotedAt?}` (the last three: see "Proposed FAQ revisions" below)
  - **`docType`** — which of `docs/CONTRIBUTING-docs.md` §2's four
    Diátaxis types this article actually is. Defaults to `"faq"` for a
    new article (most of the 108 seeded ones genuinely are short FAQ
    entries) but should be corrected on any article that's really a
    how-to guide, reference page, or explanation — the public site shows
    it as a small type badge next to the article title and in category
    listings, so readers (and future editors) can tell at a glance.
- **Why `projectId` exists on an article**: this is the "categorization by
  project" piece — an article can be linked to whichever `projects`
  collection doc (Live Visitor Profile, Experience Templates, Products
  Pricing & Asset Management, etc.) it documents. This is what the
  auto-review automation below uses to find which articles a shipped
  feature might have made stale.
- **`programId`** — which product/program (the same top-level `programs`
  collection a project can optionally be grouped under — see the board's
  own "Program/Product" heading, `public/js/app.js`'s `createProgram`/
  `populateProgramSelect`) this article belongs to. Reuses that existing
  collection rather than a second, parallel taxonomy just for articles —
  set from the article editor sidebar's "Article properties" group (with
  the same inline "+ New program…" affordance the New Project modal
  already has),
  and it's what FAQ Management's folder view (see below) groups by at the
  top level. `scripts/backfill-faq-program.js` (a one-off, idempotent
  "set only if missing" pass — deliberately NOT wired into the deploy
  workflow: the backlog automation pushes with its run's own GITHUB_TOKEN,
  which GitHub forbids from creating or updating anything under
  `.github/workflows/`, so wiring it in there is what made this whole
  change undeliverable by the board in the first place. It has already been
  run once against the live data; re-run it by hand if articles ever arrive
  without a `programId`)
  find-or-creates a "Personalisation Hub" program and assigns it to every
  `faqArticles` doc that doesn't already have a `programId` — the 108
  seeded articles are all genuinely Personalisation Hub content, so this
  is what gets them all correctly categorized without a one-off manual
  pass through FAQ Management.
- **Auto-flagging FAQs for review on merge to main** — opt-in per project,
  toggled from that project's Docs page (**⋮ → Requirements (MD file)**
  opens the Docs page; "FAQ review automation" is the block below
  Requirements) as `projects/{id}.faqAutoFlagOnLive`. When on, the Cloud
  Function `onBacklogItemPublishedLive` (an `onDocumentUpdated` trigger on
  `backlogItems`) fires the moment one of that project's items transitions
  to `status: "published-live"` — merge-to-main specifically, since that's
  the one irreversible transition of the three (ready-for-testing and
  ready-to-publish can still be reverted) — and sets `needsReview: true` on
  every `faqArticles` doc sharing that item's `projectId`, the same flag
  FAQ Center's own manual toggle sets — but only on articles that don't
  already carry a specific proposal from the mechanism below.
  `needsReview` otherwise stays a manual toggle for projects that leave
  this off.
- **A PR merged by a person is recorded automatically.** Workflow-file PRs
  (anything under `.github/workflows/`) are never merged by the pipeline —
  a human merges them on GitHub. `run-backlog-automation.js` →
  `reconcileHumanMergedPrs()` runs every pass and, for any Approved for
  Deployment card whose PR GitHub reports as MERGED, sets `mergeReady` so
  the normal already-merged success path flips it to Deployed in the same
  run. No second "Deploy to Main" click is needed (it used to be).
- **Proposed FAQ revisions from a Deploy (`pendingRevision`)** — the
  precise version of the above, always on. When "Notify Claude — Deploy"
  fires, the Routine's Deploy flow (`ROUTINE_INSTRUCTIONS.md` step 3b,
  "FAQ impact review") reads each merging PR's actual diff and, for every
  article of that project's **product/program** (`programId`, plus
  `projectId`-linked articles) the change makes wrong or incomplete,
  writes the corrected article as `faqArticles/{id}.pendingRevision`
  (full proposed title/summary/body, a `reason`, the `sourceItemIds`) and
  flags it. The live text is untouched. FAQ Management shows a **Proposed
  update** badge and a **Review proposed update** action: reason, source
  tickets with their pipeline status, a *Changes* diff (paragraph + word
  level) and a *Before / After* rendering, with **Approve** / **Reject** /
  **Edit proposal**. It goes live only once approved AND every source
  ticket is `published-live` — `promoteFaqRevisionIfReady` in
  `functions/index.js`, called from both `onBacklogItemPublishedLive` and
  `onFaqArticleRevisionApproved`, whichever fires last — keeping the
  replaced text as `previousRevision` for a **Revert last auto-update**
  row action. Full spec: `REQUIREMENTS.md` → "FAQ revision review".
  **A `functions/` change needs its own `firebase deploy --only
  functions`** — the promotion never happens until it's deployed.
- **Releases — bundling FAQ updates with a product release.** The menu's
  **Releases** page lists every `releases` doc (newest first) with
  **+ New release** (name, optional version) and a one-way **Mark live**
  per draft. A project is assigned to a release from its Docs page →
  **Release** (`projects/{id}.releaseId`); while that release is a draft,
  its approved proposals (`pendingRevision.sourceProjectId`) wait, and
  marking it live promotes them all at once (`onReleaseMarkedLive` in
  `functions/index.js`). Unassigned projects — including Backlog Tracker &
  FAQs itself — promote exactly as before. Articles can also be bound to a
  release range (editor → "Introduced in release" / "Removed in release");
  `scripts/faq-export.js` exports `faq/data/releases.json`, and the public
  site plus the MCP `search_faq`/`get_faq_article` tools show only the
  articles that apply to the requested release (`?release=` / `release`),
  by default the current live one — with no releases at all nothing is
  filtered. `scripts/backfill-release-binding.js` (`--report-only` first;
  idempotent, never overwrites) binds every unbound article to the current
  live release. Full spec: `REQUIREMENTS.md` → "`releases/{releaseId}`".
- **Seeding**: `scripts/seed-faq-data.js` (same insert-only `create()`
  pattern as `migrate-artifact-data.js`) seeds the **real** Help Center
  content — 9 categories and 108 articles — run automatically on every
  deploy. This is a verbatim import from Freshdesk Solutions
  (`personalisationhub.freshdesk.com/a/solutions`), pulled from a Google
  Drive folder ("Personalisation Hub" › "Freshdesk FAQs - June 2026") that
  already had the full export saved as one file per category plus a
  combined export and a gap-analysis summary. Each imported article body
  ends with a line naming its original Freshdesk Article ID and
  last-updated date. Draft/Published status was preserved exactly as it
  was in Freshdesk (98 published, 10 draft) — the 10 drafts start hidden
  from the public site, same as any draft created from FAQ Center, so this
  data is also a live test of that flow. Article bodies are imported as
  plain prose paragraphs (Freshdesk's own export had no markdown
  structure to carry over), not reformatted into the "## heading" / "-
  bullet" style FAQ Center's editor supports — reformatting any of them is
  now just an edit away from FAQ Center. `categoryId`/`title`/`slug`/
  `summary`/`keywords` were derived mechanically from that export by a
  one-off script (not checked into this repo); the article text itself is
  untouched.
- **Cross-site config**: `faq/js/firebase-config.js` deliberately
  duplicates `backlog-tracker/public/js/firebase-config.js` byte-for-byte
  (same project, two static sites on two different hosts reading the same
  Firestore) — if the Firebase project config ever changes, update both.

## Skills library

An organisation-wide, shared library of packaged instructions ("skills",
in the sense Claude Code uses the word) any team member's AI agent can pull
in over MCP — **not** scoped to any one project, unlike `backlogItems` or
`projectDocs`. Reached from the hamburger menu's **Skills** entry.

- **Data model**: a top-level `skills` Firestore collection, one doc per
  skill — `{name, slug, summary, version, files: [{path, content}, ...],
  owningTeam?, createdAt, updatedAt, createdByEmail, updatedByEmail,
  createdVia: "console"|"mcp", lastWriteVia: "console"|"mcp"}`. `slug` is
  lowercase `[a-z0-9-]+` and unique, and can't be changed after creation
  (delete and re-add under a new slug instead). `owningTeam` is an
  informational-only tag (`"Product/Design"|"Engineering"|"Cybersecurity"`)
  — which team maintains a skill, with no write-permission enforcement
  attached; any editor may still change any skill.
  `firestore.rules`' `match /skills/{skillId}` lets any signed-in member
  read (viewer included — the whole point is "usable by anyone using the
  platform") and only an editor write; per-file content is capped at
  100,000 characters (`SKILL_FILE_MAX` in `functions/mcp-server.js`) —
  rules can only check the `files` list's own shape/length, not iterate
  every element, so the real per-file cap lives in the MCP tool code and
  the console's own Add/Edit skill modal.
- **Console UI**: the Skills page lists every skill as a card (name,
  owning-team badge, summary, version, file count, last updated), each
  expandable to show every file's path and content read-only, plus a
  **Change history** panel (`docRevisions` filtered by `skillId`, see
  `REQUIREMENTS.md` → "Skills page: change history") with a per-revision
  file diff. An **Add skill** button and each card's Edit/Delete are gated
  behind editor access (`[data-editor-only]`, hidden for a viewer the same
  way `[data-admin-only]` hides Team & agent access from everyone but an
  admin) — a viewer can still open the page, read every skill and browse
  its history.
- **MCP tools** (`functions/mcp-server.js`): `list_skills` and `get_skill`
  (scope `board.read` — light summaries and full-file reads respectively,
  both including `owningTeam`) and `upload_skill` / `update_skill` /
  `delete_skill` (scope `board.write`, `owningTeam` optional on the first
  two). `update_skill`/`delete_skill` record the file set they replace to
  `docRevisions` first, same recoverability as every other documentation
  write; `functions/index.js`'s `onSkillWritten` trigger backfills the
  same trail for a skill edited on the console instead, which can't write
  `docRevisions` itself.
- **Phase-bound skills**: `settings/phaseSkillBindings`
  (`{build: string[], deploy: string[]}` of `skills.slug` values) lets a
  skill be applied automatically as part of the Backlog (build) or Deploy
  pipeline phase — see `REQUIREMENTS.md` → "Functional requirements — team
  access & the MCP server" → "Phase-bound skills" and
  `ROUTINE_INSTRUCTIONS.md` → "Check for phase-bound skills too" for the
  full mechanism. No console UI manages this doc yet.
- **Seeded skill**: `scripts/seed-skills-data.js` inserts one starting
  skill, "Personalisation Hub Front & Design" (slug `ph-designer`) — the
  design skill this repo's own root `CLAUDE.md` requires for every UI
  change — from verbatim copies of its real files kept in
  `scripts/seed-skills-files/`. Insert-only (skips and logs if a skill
  with that slug already exists), so it's safe to re-run. **This needs a
  human to run it once after this deploys** — it is not wired into
  `.github/workflows/deploy-backlog-tracker.yml` the way `seed-faq-data.js`
  is, since this ticket's job was the feature, not the deploy step:
  ```bash
  cd backlog-tracker/scripts
  npm install   # only if firebase-admin isn't already installed here
  GOOGLE_APPLICATION_CREDENTIALS=/path/to/a-backlog-tracker-e4ed2-service-account.json node seed-skills-data.js
  ```
- **Skill feedback loop** (Gcc30u2bQEJwEdUTN6X8) — a running, append-only
  `misses` array on each skill doc: `{text, source: "build"|"review",
  phase?: "build"|"deploy", ticketId?, prNumber?, projectId?,
  reportedByEmail, reportedVia: "mcp"|"console", at}`. Two sources feed it —
  a team member's own agent tagging a build failure or review finding over
  the MCP tools `report_skill_miss` (write)/`list_skill_misses` (read), and
  `ROUTINE_INSTRUCTIONS.md`'s DEPLOY-phase skill review, which writes one
  the same shape via a direct Firestore PATCH (see that file's own "Report
  a genuine miss back onto the skill" step, next to its "SKILLS BOUND TO
  THE BUILD/DEPLOY PHASE" mechanism). Deliberately never touches a skill's
  own `updatedAt`/content — a miss report and an authored edit are kept as
  two distinct signals. The Skills page shows each skill's misses in an
  expandable **Misses (N)** panel plus a **Report a miss** button any
  signed-in member can use (not editor-gated — tagging a gap isn't editing
  the skill). `get_skill` also returns `missCount`.
- **Periodic skill-review nudge** (eKslgrwgRJtoxyx0oNSV) — a lighter-weight
  companion: rather than waiting for a specific miss, nudges an owning team
  to deliberately revisit a skill after a day-based cadence
  (`reviewCadenceDays`, default 60) or enough has shipped since the last
  review (`reviewDeployThreshold` shipped tickets, default 15) — whichever
  trips first. No new Cloud Function or scheduled job: `list_skills`/
  `get_skill` compute `reviewDue`/`daysSinceReview`/`deploysSinceReview` on
  every read (`skillReviewStatus` in `functions/mcp-server.js`), counting
  `backlogItems` that reached `published-live` since the review baseline
  (`lastReviewedAt`, or `createdAt` if never reviewed) as the "deploys"
  proxy — this repo has no single cross-project train counter, so a shipped
  ticket is the concrete, countable unit every train actually produces; not
  scoped to whether that specific skill was bound to the phase that shipped
  it, so treat it as a nudge to go look, not a precise metric. `mark_skill_reviewed`
  (MCP, write) resets the clock and can override either threshold per skill.
  The Skills page shows a **Review due** badge (day-cadence only, computed
  client-side so the full due-ness logic lives in exactly one place) and a
  **Mark reviewed** button.

## Feed in requirements → suggested build batches

A project's **⋮ → Feed in requirements** modal bulk-creates several
Backlog items from one pasted block of text (one requirement per
blank-line-separated paragraph) and, before creating anything, previews
them clustered into **suggested build batches** — grouped by `category`
(the board's existing "shared area/files" proxy), each item tagged with a
rough small/medium/large effort estimate **and** a rough low/medium/high
priority estimate (cwehxSMZv8noJQv5kB22) — items within a batch sort
highest-priority-first, then smallest-effort-first. Purely informational:
**Create items** files them into that project's Backlog exactly like the
single-item New Item form would, nothing is auto-approved or auto-sent to
Ready for Dev — but unlike before, the preview's own effort/priority
estimate is now persisted onto the created cards (`addItem`'s `extra`
param) instead of being computed and then thrown away. Both signals can
also be corrected any time from the Edit item modal (`effort`/`priority`
selects, "Unset" reverting to the automatic guess) and show as badges on a
Backlog card when a real value is set. The clustering itself
(`clusterBacklogItems`/`estimateEffort`/`estimatePriority`/
`splitRequirementsText`) lives in `public/js/build-batches.js` — a pure,
Firebase-free module, unit-tested with plain `node`
(`test/build-batches.test.mjs`) rather than through the browser. See
`REQUIREMENTS.md` → "Feed in requirements → suggested build batches" for
the full behavior.

## What's deliberately not built yet

- ~~No auth.~~ ~~**The whole console is behind Google sign-in** with a
  hard-coded allowlist.~~ **It is behind a real, managed member list**
  (September 2026): `public/js/auth-gate.js` shows a sign-in wall — Google
  or email + password — and only imports `app.js` once the account resolves
  to a `consoleUsers` membership doc; `firestore.rules` (`isBoardReader` /
  `isEditor` / `isAdmin`) reads that same doc for every read and write of
  the board's collections, and `storage.rules` checks the `consoleEditor`
  custom claim kept in step with it. Admins add and remove people from
  **Settings → Team & agent access**, and the same row governs whether that
  person's AI agent may connect over MCP (see `MCP.md`). Only the two help-centre collections remain publicly
  readable (the public FAQ site needs them). Automation that used to call
  Firestore's REST API anonymously now authenticates: the GitHub Actions
  automation uses the deploy service account, and Routine-fired Claude
  sessions sign in as the `board-automation@backlog-tracker-e4ed2.firebaseapp.com`
  Auth user (password = the `BOARD_API_KEY` GitHub secret; the deploy
  workflow keeps the user in sync via `scripts/ensure-automation-user.js`,
  and Email/Password sign-in must be enabled once in the Firebase console)
  and call Firestore's REST API with the ID token — all on
  `*.googleapis.com`, which their sandbox can reach. The `boardApi` Cloud
  Function proxy (`X-Board-Key` header, also served at
  `https://backlog-tracker-e4ed2.web.app/boardApi/...`) remains as a
  fallback. Adding an editor is now a
  row in Settings → Team & agent access, not an edit to three files; only
  the two owner accounts are still hard-coded, as the bootstrap that makes
  an empty member list non-fatal.
- **No drag-and-drop.** Multi-project and an archive page (per-project
  "Archived (N)" button → sortable/filterable table, with a Restore
  action) have both since been ported over from the Artifact board;
  drag-and-drop between columns hasn't — cards move via the existing
  arrow/approve/merge buttons only.

## Historical data migrated from the Artifact board

The "Products and Pricing Prototype" project and its 30 already-shipped
tickets — everything that used to live only in the Claude Artifact
"Prototype Pipeline" board (see the root `CLAUDE.md`) — have been
migrated into this app's own Firestore, so the real board's Archive isn't
starting empty. `scripts/migrate-artifact-data.js` does this: it reads
`scripts/artifact-export.json` (a one-time export of that artifact's
data) and seeds matching `projects`/`backlogItems` documents using the
same ids the artifact used, via Firestore's `create()` (insert-only —
skips any doc that already exists). The deploy workflow runs it on every
deploy, but past the first successful run it's a no-op: it can never
overwrite a later edit made from the live app (a restore, a rename, a
category change), since it only ever creates documents that are missing,
never updates ones that already exist. Safe to delete
`scripts/artifact-export.json` and this step once you're confident the
migration has landed and won't need re-running (e.g. against a fresh
Firebase project).
