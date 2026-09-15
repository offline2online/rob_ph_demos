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
  deployNotifyRequestedAt?: timestamp, // bumped by "Notify Claude — Deploy" — see below
  routinePromptMd?: string,       // see "Per-project Routine instructions" below
  faqAutoFlagOnLive?: boolean,    // see "FAQ auto-review" below
  programId?: string,             // see "programs/{programId}" below
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
  testPassed?: boolean,         // Ready for Testing card's own "Confirm tested" flag — see "Ready for Testing has two stages" below; never true outside that status, cleared once it advances or is sent back
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
  patchBranch?: string,
  patchCommitMessage?: string,
  patchPrTitle?: string,
  patchPrBody?: string,
  patchReady?: boolean,         // set true once patchFiles etc. are ready; cleared to false once a PR is opened
  mergeReady?: boolean,         // Deploy-notify flow: set true once a fired session confirms a PR is green/mergeable
  mergePrNumber?: number,       // which PR mergeReady refers to
}
```
`CATEGORIES` (fixed set, `backlog-tracker/public/js/app.js`): `Pricing &
Offers`, `Product Assets`, `HQ Admin`, `Retail Admin`, `Menu Board`,
`Backend / Infrastructure`, `Uncategorised`.

Status pipeline and what each transition means:

| Status | Column | Meaning |
|---|---|---|
| `backlog` | Backlog | Captured, not yet worked |
| `ready-for-testing` | Ready for Testing | Implemented, PR open, awaiting human test — see "Ready for Testing has two stages" below |
| `ready-to-publish` | Approved for Deployment | Released from Ready for Testing via the project's own "Approved for Deployment" action |
| `published-live` | Deployed / Main Branch (Live) | Set only by `run-backlog-automation.js` after it actually merges the item's PR — see below, no manual button sets this |
| `archived` | (hidden from the board) | Set via the Archive action on a Deployed/Main-Branch card; reversible via Restore |

**Ready for Testing has two stages, not one — confirming a card is tested
does not by itself advance it.** This used to be a single click: the
card's own button both flagged it tested *and* moved it straight to
Approved for Deployment in the same action, which meant testing one card in
a batch of several put that one card alone on the feature branch with no
chance to also confirm the rest first. It's now two separate actions:

1. **Per-card, in place**: a Ready for Testing card's "Confirm tested"
   button (`toggleTestPassed()` in `app.js`) sets `testPassed: true` —
   the card stays in Ready for Testing, showing "✓ Passed testing"
   (click again to un-mark). A checkbox on each card (mirroring the
   Backlog column's own "Ready for Dev" selection, a separate selection
   set — see `getDeploySelectedSet`) lets several be hand-picked instead
   of acted on individually.
2. **Batched, project-level**: the project header's own **"Approved for
   Deployment"** action (`deployToFeature()`) appears once at least one
   Ready for Testing card has `testPassed: true`, showing that count (or
   a narrower "N selected" count if any checkboxes are checked). Clicking
   it advances every `testPassed` (and, if any are checked, only the
   checked-and-passed) item straight to `ready-to-publish` in one
   Firestore batch write, clearing `testPassed` on each as it goes. This
   never touches the Routine or GitHub — the feature branch and PR
   already exist from the Backlog stage (`run-backlog-automation.js`'s
   `processApplyPatch`); this step only advances the board's own status
   once a human has actually looked at (a batch of) what's already there.
   Unlike Ready for Dev/Deploy to Main, there's no Routine session to spin
   on, so feedback is immediate instead: an in-app alert dialog (`showAlert()`
   — see "In-app dialogs replace window.confirm/prompt/alert" below) naming
   exactly what moved (and stating plainly that no new GitHub push happened — the code
   was already pushed earlier), plus a Slack post via
   `notifyOnItemsDeployedToFeature` (`functions/index.js`, watching
   `projects/{id}.deployToFeatureRequestedAt` the same way
   `notifyOnProjectReadyForReview`/`notifyOnProjectReadyToDeploy` watch
   their own timestamps — it just never fires the Routine, since there's
   nothing for it to do).

Sending a card back — the left-arrow "move back" button — from Approved
for Deployment into Ready for Testing (`moveItem()`) resets `testPassed`
to `false`: a stale flag from a previous round would otherwise let it
slip back onto the feature branch on the next "Approved for Deployment"
click with nobody having re-confirmed the new round of work.

**The left-arrow does NOT exist on every card past Backlog — two cases
deliberately have no "move back" at all**, both fixed 2026-09-13 after a
report that tickets taken from Backlog were "going back to Backlog":

- **A Ready for Testing card can never move back to Backlog.** Unlike
  Approved-for-Deployment→Ready-for-Testing above, this transition has no
  safe semantics: a Ready for Testing card always has a real, already-open
  PR behind it (`patchBranch`), and moving it to Backlog does nothing to
  close, reconnect, or even leave a visible trace of that PR —
  `patchReady` stays `false`, so `run-backlog-automation.js` never looks
  at the item again, and nothing on the resulting Backlog card hints it
  already has one. Re-investigating it fresh from Backlog used to get the
  item skipped with no path forward once `findExistingPrForItem` found
  the still-open original; the automation now attaches a re-patched item
  to its open PR instead (see `backlog-tracker/README.md`), but the
  transition still hides the PR from whoever is looking at the card. No
  automation step ever moves a card backward on its own (see
  `run-backlog-automation.js`'s `processApplyPatch`/`processMergePr`), so
  this was always a manual click; `cardHTML`'s `canLeft` now excludes
  `ready-for-testing` outright, removing the only path capable of
  producing it.
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
  `patchFiles` (so it reflects a version bump the same patch carries) and
  stamps it alongside the `ready-for-testing` status write. The rarer
  manual path — a Backlog card moved straight to Ready for Testing via
  the right-arrow button, bypassing the Routine/PR pipeline entirely —
  stamps the frontend's own currently-loaded `APP_VERSION` the same way
  (`moveItem()`, only on the forward direction; sending a card back from
  Approved for Deployment leaves an existing `testVersion` untouched, same
  as `testPassed` is reset but the version stamp isn't).
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
ordinary card; it fires the Routine, which sets `mergeReady` +
`mergePrNumber` once it's confirmed the PR is actually green and
mergeable, and only `run-backlog-automation.js` (see "Notify Claude can't
push" in README.md) flips `status` to `published-live`, after the real
merge succeeds.

The one deliberate exception is `noDeploymentRequired` (set from the Edit
item modal — a plain checkbox, self-service, not something only the
Routine can flip): a card whose fix is a live data/config change only —
nothing that ever touches GitHub — genuinely has no PR for the deploy gate
to check in the first place, so gating it on "Deploy to Main" would just
wait forever on a merge that will never happen, and it never has anything
to gain from the Feature Branch stage either. Such a card is excluded from
the `testPassed`/"Approved for Deployment" pool entirely (no checkbox, no
"Confirm tested" button) and instead shows its own separate "Confirm
tested — mark Merged to Main" button; `confirmTestedNoDeploy()` writes
`status: "published-live"` directly, the same way the old, removed "Merge
to main" button used to — the difference being this is only ever offered
on a card that has already told the board there's no PR to fake being
merged. Any card without the flag still goes through the full two-stage
Ready for Testing → Feature Branch → Main pipeline exactly as described
above; this does not change behavior for the common case.

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

### `faqCategories/{id}` and `faqArticles/{id}`
```
faqCategories/{id}: { name, icon, description, order, createdAt, updatedAt }
faqArticles/{id}: {
  categoryId, projectId (nullable), title, slug, summary, bodyMd,
  docType: "faq" | "how-to" | "reference" | "explanation",
  keywords: string[], status: "draft" | "published", needsReview: boolean,
  order, createdAt, updatedAt, publishedAt,
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

### The FAQ editor's Advanced panel does not swallow clicks

`.faq-advanced-backdrop` is `pointer-events: none`, and closing the panel
on an outside click is handled by a document-level listener in `app.js`
rather than by a click on the backdrop itself.

As a click-catching modal backdrop it covered the entire page including
the editor's own **Save article** button, so the first click on a visible,
enabled Save did nothing except dismiss the panel and the article only
saved on a second click — the same "the button did nothing" failure as the
modal-scroll bug and the silent `deployToFeature` click before it. The
dimming is unchanged; only the click-swallowing is gone.

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
  permission, no device, no browser support, network needed, silent
  restart give-up after repeated no-speech) rather than failing silently.
  Continuous-mode quirks on Android Chrome are worked around by restarting
  a fresh non-continuous recognition session per utterance rather than
  relying on the browser's own long-running continuous mode. Originally
  New Item's description field only; `createDictationController()` in
  `app.js` factors this into a reusable per-field controller (its own
  independent recognition/listening/error state via closure, not shared
  module globals) so the quick-comment modal and the Edit item modal's own
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
  - **FAQ Management**, then **Settings** — see "FAQ / Help Center" below.
  - **Archived projects** (last item).
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
  was relabeled), **Approved for Deployment** (shown only once at least one
  Ready for Testing card has been individually confirmed tested — see
  "Ready for Testing has two stages" above; a pure board status batch
  write, no Routine involved), **Deploy to Main** (same gradient
  treatment as Ready for Dev, shown only when the project has items on
  Approved for Deployment — see "Notify Claude — Deploy" below), **+ New
  backlog item**, then a **⋮** options menu holding everything else
  (Archived tickets, Requirements/Docs, interface contracts).
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
- **Archive**: a Merged-to-Main card can be archived (sets `status:
  "archived"` + `archivedAt`, not deleted); each project's own Archived
  page is sortable/filterable by type, area, and free text, with a Restore
  action back to `published-live`. Deletion is reserved for Backlog cards
  only.
- **"No deployment required"** (Edit item modal): a checkbox for a fix
  that's a live data/config change only — nothing that ever needs a code
  push or a deploy, e.g. a Firestore-only edit. Any card carrying it shows
  a small "No deployment required" badge; once it reaches Ready for
  Testing, it's excluded from the checkbox/"Confirm tested" testPassed
  pool entirely (see "Ready for Testing has two stages" above) and instead
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
  specifically for testing an in-progress branch like this — falling back
  to the PR URL for anything that can't be githack'd directly (e.g. a
  Cloud Function change). This restores what the old Claude Artifact board's per-card
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
covers the same kind of window at the *other* end of the pipeline**: once
the Deploy flow (see README.md → "Notify Claude progress") has confirmed a
ready-to-publish item's PR is green/mergeable and written `mergeReady:
true`, the card is genuinely mid-merge — `backlog-automation.yml` will pick
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
   confirmed on their feature branches, tells the fired session not to
   investigate or re-implement them, and — since the fired session has no
   GitHub-authenticated tooling and can't merge a PR itself (see "Notify
   Claude can't push" in README.md) — asks it to find each one's PR and
   check its mergeability via GitHub's public, unauthenticated REST API,
   then PATCH `mergeReady: true` + `mergePrNumber` if it's green and
   mergeable, or leave it as `ready-to-publish` with a note if it can't.
   `backlog-tracker/scripts/run-backlog-automation.js` (via
   `.github/workflows/backlog-automation.yml`, a scheduled job with its own
   GitHub Actions-native credentials, no AI involved) is what actually
   merges the PR and flips status to `published-live`. This was a
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
   — opt-in per project via the Docs page's **FAQ review automation**
   toggle (`projects/{id}.faqAutoFlagOnLive`). Fires specifically on the
   transition to `status: "published-live"` — the one irreversible status
   change — and sets `needsReview: true` on every `faqArticles` doc sharing
   that item's `projectId`, the same flag FAQ Center's own manual toggle
   sets. A project with the toggle on but no linked FAQ articles is a
   harmless no-op.

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
(or `mergeReady`/`mergePrNumber` for the Deploy flow), report a summary,
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

- **Authentication/authorization.** Everything here is open by design at
  this stage — see "Firestore rules" above.
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
