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
  requirementsMd?: string,        // this file's own live counterpart
  notifyRequestedAt?: timestamp,  // bumped by the "Notify Claude" button
  routinePromptMd?: string,       // see "Per-project Routine instructions" below
  faqAutoFlagOnLive?: boolean,    // see "FAQ auto-review" below
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

### `faqCategories/{id}` and `faqArticles/{id}`
```
faqCategories/{id}: { name, icon, description, order, createdAt, updatedAt }
faqArticles/{id}: {
  categoryId, projectId (nullable), title, slug, summary, bodyMd,
  keywords: string[], status: "draft" | "published", needsReview: boolean,
  order, createdAt, updatedAt, publishedAt,
}
```
Consumer-facing content for the FAQ / Help Center — see that section below.

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
- **Header actions**, in order: **Notify Claude** (own button, shows the
  live Backlog count; not buried in a menu — see "Notify Claude" below),
  **+ New backlog item**, then a **⋮** options menu holding everything else
  (Archived tickets, Requirements/Docs, interface contracts). Mobile
  (<640px) stacks Notify Claude as its own full-width row above the New
  item / ⋮ row rather than squeezing three controls onto one line; the
  board's four columns stack vertically instead of forcing horizontal
  scroll.
- **Docs page** (per project, via ⋮): free-text **Requirements**
  (`requirementsMd` — this document's own live counterpart), **FAQ review
  automation** toggle (see below), and **Interfaces with other projects**
  (list + add/edit, backed by the `interfaces` collection).
- **Archive**: a Merged-to-Main card can be archived (sets `status:
  "archived"` + `archivedAt`, not deleted); each project's own Archived
  page is sortable/filterable by type, area, and free text, with a Restore
  action back to `published-live`. Deletion is reserved for Backlog cards
  only.

## Functional requirements — notification & automation (Cloud Functions)

Three Cloud Functions, all in `backlog-tracker/functions/index.js`:

1. **`notifyOnBacklogItemCreated`** (`onDocumentCreated` on `backlogItems`)
   — fires the instant a new item lands with `status: "backlog"`. Posts a
   plain webhook (`NOTIFY_WEBHOOK_URL` secret) — a Slack message, or
   whatever else the secret points at. This still needs a human (or a
   separately-configured relay) to actually act on the notification; it is
   the "tell someone something happened" primitive, not a work-execution
   mechanism.

2. **`notifyOnProjectReadyForReview`** (`onDocumentUpdated` on `projects`)
   — the **Notify Claude** button's function. Fires when
   `notifyRequestedAt` is bumped to a genuinely new value (guards against
   re-firing on an unrelated project edit like a rename). Unlike function
   1, this one closes the loop without a human relaying anything: it
   fetches everything currently in that project's Backlog column and fires
   a **Claude Code Routine's API trigger** directly — `POST` to
   `https://api.anthropic.com/v1/claude_code/routines/{id}/fire` with a
   bearer token and the required `anthropic-version: 2023-06-01` and
   `anthropic-beta: experimental-cc-routine-2026-04-01` headers (the
   version header is not optional — its absence is the single most likely
   cause if this ever silently stops working; reproduce with `curl`
   directly against the fire endpoint before re-patching this function).
   Configured via two Firebase secrets, `CLAUDE_ROUTINE_FIRE_URL` and
   `CLAUDE_ROUTINE_TOKEN`, synced from GitHub Actions repo secrets the same
   way `NOTIFY_WEBHOOK_URL` already is. The Routine's own prompt (owned at
   claude.ai/code/routines, not in this repo) carries the actual
   investigate → fix → note → move-to-Ready-for-Testing workflow; this
   function's only job is telling it which project and what's in Backlog.

3. **`onBacklogItemPublishedLive`** (`onDocumentUpdated` on `backlogItems`)
   — opt-in per project via the Docs page's **FAQ review automation**
   toggle (`projects/{id}.faqAutoFlagOnLive`). Fires specifically on the
   transition to `status: "published-live"` — the one irreversible status
   change — and sets `needsReview: true` on every `faqArticles` doc sharing
   that item's `projectId`, the same flag FAQ Center's own manual toggle
   sets. A project with the toggle on but no linked FAQ articles is a
   harmless no-op.

### The Notify Claude Routine

The Routine itself (name "Backlog tracker investigation", owned at
claude.ai/code/routines, id `trig_01R9N68hfzqQCF8RUssQYE8b` as of this
writing) is a **fire-on-demand, non-persistent** Routine — each fire spins
up a completely fresh Claude Code session with no memory of any previous
run, so its prompt must be fully self-contained. It is instructed to:

1. Recognize this board as a real Firestore-backed web app (not a Claude
   Artifact — an earlier version of the prompt lacked this and the fired
   session correctly, safely refused to fabricate work against a board it
   couldn't find).
2. Query the board directly via the open Firestore REST API.
3. Read the target project's own `requirementsMd`, check the `interfaces`
   collection for any contracts involving that project, and cross-check
   against any repo-native requirements file for that project — full
   context before writing code, not just the repo's root `CLAUDE.md`.
   Also check the fire request's `text` (or the project's own
   `routinePromptMd` directly) for a project-specific instructions block —
   see "Per-project Routine instructions" below.
4. For each Backlog item: rewrite its title to a proper short subject line,
   investigate for real, implement on a feature branch, push, open a PR,
   and PATCH the item's status/category/title/notes — never fabricating a
   fix for something it can't actually locate in the codebase.
5. Report a summary; state plainly (not silently) when a project or item
   can't be found rather than inventing work.

**Known constraint**: the Routine's session environment needs real GitHub
push/API authorization for `offline2online/rob_ph_demos`, or it can
investigate and implement locally but cannot push a branch or open a PR —
this has happened at least once in practice, and the correct behavior in
that case is exactly what shipped: leave the item in `backlog`, write a
detailed note naming the exact blocker and the local branch/commit, and
say so in the summary rather than falsely marking anything
`ready-for-testing`.

### Per-project Routine instructions (`routinePromptMd`)

The Routine's own prompt above is shared across every project on the
board — it can't hold project-specific detail (a different branch
convention, which slice of the repo a project owns) without becoming
unreadable. Each project's Docs page has its own **Routine instructions**
field (`projects/{id}.routinePromptMd`, plain markdown, optional and blank
by default) for exactly that. When **Notify Claude** fires,
`notifyOnProjectReadyForReview` prepends this field's content — if
non-blank — to the fire request's `text`, wrapped in
`=== PROJECT-SPECIFIC INSTRUCTIONS FOR "<project>" ===` /
`=== END PROJECT-SPECIFIC INSTRUCTIONS ===` markers, ahead of the usual
"Project X has N items in Backlog" list. The Routine's own prompt is
instructed to treat a present block as authoritative additional context
that supplements — never replaces — the required steps above (still PATCH
the same fields, still open a PR the same way). Most projects leave this
blank; that's the expected default, not a gap.

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
- **Admin**: this app's own **FAQ Center** page (global, not per-project —
  an article can link to any one project or none). Manages categories
  (name, Material Symbols icon, description, display order) and articles
  (title, slug, category, optional linked project, summary, a small
  markdown-ish body with live preview, search keywords, draft/published
  status, `needsReview`).
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
2. `notifyOnBacklogItemCreated`'s webhook target is whatever
   `NOTIFY_WEBHOOK_URL` happens to point at — unlike the Routine-fire path,
   this still fundamentally depends on a human (or a separately-built
   relay) to act on it. Consider whether every new item should also fire
   the Routine directly, not just a manual per-project batch.
3. No automated check keeps a project's repo-native `REQUIREMENTS.md` (this
   file, for this project) and its Firestore `requirementsMd` field in
   sync beyond "whoever edits one remembers to update the other." Treat a
   divergence as a bug in whichever copy is stale, same as the
   `interfaces` contracts.
4. The FAQ site's brand palette has never been checked against the real
   WordPress theme (network-blocked from this sandbox) — screenshots or
   the theme's actual token values would let it be tightened.
