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
  deploymentId?: string,        // see "deployments/{deploymentId}" below
  previewUrl?: string,          // a Ready for Testing card's own "Test this" link

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
| `ready-for-testing` | Ready for Testing | Implemented, PR open, awaiting human test |
| `ready-to-publish` | Live on Feature Branch | Tested and confirmed on the feature branch (its own "Confirm live on branch" button) |
| `published-live` | Merged to Main (Live) | Its own "Merge to main" button — the one click that corresponds to an actual `git merge`/push to `main` |
| `archived` | (hidden from the board) | Set via the Archive action on a Merged-to-Main card; reversible via Restore |

`published-live` is treated as the one **irreversible** transition of the
four for automation purposes (see "FAQ auto-review" below) — the other
three can still be reverted or corrected without anything external having
already happened.

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

### `deployments/{deploymentId}`
```
{
  projectId: string,
  label: string,
  createdAt: timestamp,
  updatedAt: timestamp,
  mergedAt?: timestamp,   // set by the batch "Merge all to main" action
}
```
A deployment groups several `backlogItems` (via their own `deploymentId`)
that are meant to ship to `main` together — see "Deployments" under
Functional requirements below for why this exists and exactly what its
batch action does and doesn't do.

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
- **Mic dictation** requests microphone permission before starting Web
  Speech recognition, with specific, visible error states (blocked
  permission, no device, no browser support, network needed, silent
  restart give-up after repeated no-speech) rather than failing silently.
  Continuous-mode quirks on Android Chrome are worked around by restarting
  a fresh non-continuous recognition session per utterance rather than
  relying on the browser's own long-running continuous mode.
- **App name and global navigation.** The app itself (browser tab, `<h1>`,
  footer) is titled **"PH Agent Console"** — distinct from any one
  project's own name on the board (e.g. the "Backlog Tracker & FAQs"
  project this very document tracks). The topbar carries only the
  hamburger menu button and the primary **+ New project** action; every
  global (not per-project) destination lives in a left-hand nav drawer
  opened by that hamburger (320px wide), which slides in over the board
  and closes on a backdrop click, Escape, or picking an item:
  - **PH Console** — the drawer's own "home" link, closing whichever
    sub-page is currently open and returning to the board. Replaces the
    "← Back to board" button every sub-page (Docs, Archive, Archived
    projects, Deployments, the two FAQ pages below) used to carry
    individually — the drawer itself stays reachable from any sub-page
    already (it's part of the fixed topbar, not `#projects-root`), so one
    shared way back covers all of them.
  - **Archived projects**.
  - **Settings** and **FAQ Management** — see "FAQ / Help Center" below;
    this replaced a single combined "FAQ Center" destination.
  This replaced three competing topbar buttons for the same reason the
  per-project header below already collapsed to one primary CTA + a menu.
- **Header actions**, in order: **Notify Claude** (own button, shows the
  live Backlog count; not buried in a menu — see "Notify Claude" below),
  **Notify Claude — Deploy** (same gradient treatment, shown only when the
  project has items Live on Feature Branch — see "Notify Claude — Deploy"
  below), **+ New backlog item**, then a **⋮** options menu holding
  everything else (Deployments, Archived tickets, Requirements/Docs,
  interface contracts). Mobile (<640px) stacks each Notify Claude button as
  its own full-width row above the New item / ⋮ row rather than squeezing
  controls onto one line; the board's four columns stack vertically instead
  of forcing horizontal scroll.
- **Notify Claude progress**: while `projects/{id}.notifyRoutine.status`
  is `"in-progress"`, the button itself reflects that instead of looking
  idle — a disabled, muted, spinning state sized to the batch actually
  sent, plus a **View session →** link when a session id was resolved from
  the Routine fire response. Anything added to Backlog after that click
  surfaces as its own small, still-clickable **Notify Claude — N new** CTA
  next to it, rather than being folded into a count that would otherwise
  conflate "already being worked" with "brand new." A fired session is
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
- **Edit + comments**: every non-archived card has an edit icon (with a
  comment-count badge once it has any) opening a modal to change
  title/description/type/category, plus a comments thread. `notes` existed
  in the schema from the start but was previously write-only from the
  board's own UI — only the Routine ever wrote to it, via direct Firestore
  PATCHes; this is the first UI to read or write it. A viewer's own comment
  is `{author: "viewer", text, at}` appended via `arrayUnion` — `at` is a
  plain client `Date`, not `serverTimestamp()`, since Firestore rejects a
  server-timestamp sentinel inside an array element.
- **Test/preview link**: a Ready for Testing card shows a "Test this →"
  button opening `previewUrl` in a new tab, with a pencil icon to change
  it. **`previewUrl` is set automatically** by
  `backlog-tracker/scripts/run-backlog-automation.js` the moment it opens
  a `patchFiles` item's PR and flips it to `ready-for-testing`
  (`pickPreviewUrl()`): it picks the first changed/created HTML page
  outside any `functions/` folder and builds a
  `rawcdn.githack.com/offline2online/rob_ph_demos/<branch>/<path>` link
  for it (see root `CLAUDE.md`) — **`rawcdn.githack.com`, not
  `raw.githack.com`**: the latter proxies through jsDelivr's CDN cache (up
  to ~7 days), so a link set right after one push can keep showing that
  first commit even after later pushes update the file, with no visible
  error; `rawcdn.githack.com` is githack's own always-uncached host, meant
  specifically for testing an in-progress branch like this — falling back
  to the PR URL when nothing in the patch is a plain static page (e.g. a
  Cloud-Function-only or JS/CSS-only change). A card that reached Ready
  for Testing some other way (no matching static page, or a fix applied
  outside the automated pipeline) still shows the manual "Set test link"
  button — a plain `prompt()`, not a modal, prefilled with an editable
  template — as a fallback so the card is never stuck untestable. This
  restores what the old Claude Artifact board's per-card quick-launch link
  used to do, closing the gap `CLAUDE.md`'s "Prototype Backlog" section
  had documented ("No `testUrl` field or quick-launch icon on cards")
  since the migration off the Artifact — and removes the extra manual step
  the first version of this fix still left in place.
- **Deployments** (per project, via ⋮): groups tickets meant to ship to
  `main` together, backed by the `deployments` collection. Exists because
  merging several PRs within seconds of each other used to race the
  deploy workflow's Cloud Functions update (see
  `.github/workflows/deploy-backlog-tracker.yml`'s concurrency group) —
  this page gives whoever's actually driving the GitHub merges a single
  place to see which tickets are meant to land together and whether every
  one of them has actually been confirmed ready yet, instead of merging
  each PR the moment its own card says "Ready for Testing" with no
  visibility into whether the rest of its batch is also done.
  - Each card carries an optional `deploymentId`; a small badge on the
    board (🚀 + the deployment's label) shows which group a card belongs
    to, if any.
  - **Grouping is both automatic and manual.** The Notify Claude Routine
    is instructed to create one deployment automatically whenever it
    successfully fixes more than one item in a single fire (the common
    case this page was built for) — see "Per-project Routine instructions"
    and the Routine's own base prompt. Anyone can also create a group by
    hand from this page ("+ New deployment"), or edit an existing group's
    name/membership at any time.
  - **"Merge all to main" is board bookkeeping, not a GitHub action.** It
    stays disabled until every member ticket has individually reached
    `ready-to-publish` (Live on Feature Branch — the same "someone actually
    tested it" gate a single card's own "Confirm live on branch" button
    already enforces). Once unlocked, clicking it flips every member to
    `published-live` in one Firestore batch write and stamps the
    deployment's own `mergedAt`. It does **not** call the GitHub API or
    merge any PR itself — whoever is actually driving the merges (a person,
    or a Claude session with push access) still does that, ideally
    back-to-back now that this page tells them exactly which PRs are meant
    to land together. This was a deliberate scope decision, not a
    limitation to fix later: automating the actual GitHub merge would need
    every item to carry its PR link/number (not tracked today) and a new
    Cloud Function or session action with GitHub write access.
  - Deleting a group ("ungroup") only clears `deploymentId` on its member
    tickets — it never touches the tickets themselves, and a member is
    immediately eligible to join a different group afterward.

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
   Backlog column, **fires the Routine first, then posts to Slack** (order
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
   pipeline: it queries `status == "ready-to-publish"` (Live on Feature
   Branch) instead of `backlog`. **The fire `text` is a self-contained
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
    (inert, visible-but-not-live) rather than inject it unsanitized. The
    one intentional gap: DOMPurify's default tag allowlist excludes
    `<iframe>` (needed for Quill's video embeds), added back via
    `ADD_TAGS` — its `src` isn't restricted to a known-safe host list, an
    accepted prototype-stage tradeoff, same posture as this repo's open
    Firestore rules elsewhere.
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
