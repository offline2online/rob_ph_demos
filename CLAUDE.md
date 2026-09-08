# rob_ph_demos

## Project Overview

This is a static site repository used to publish HTML and static resources (CSS, JS, images, etc.) to the internet via GitHub.

- **Remote**: git@github.com:offline2online/rob_ph_demos.git
- **Branch**: `main` (default publishing branch)
- **Purpose**: Upload static files and push to GitHub for hosting

## Repository Structure

- `index.html` — Main entry point
- Static assets (CSS, JS, images) go directly in the repo root or organized subdirectories

## Cloud Functions need a separate manual deploy

`menu-board-demo/functions/` (Cloud Functions for Firebase — the scheduled offer-expiry sweep, the AI provider calls) is **not** part of the static site. Pushing a change there to `main` does **not** make it live — GitHub Pages only serves the static HTML/JS/CSS, and this sandbox has no `firebase` CLI or deploy credentials, so **Claude cannot deploy a functions change itself**. Whoever owns Firebase deploy access needs to separately run `firebase deploy --only functions` (or `npm run deploy` inside `menu-board-demo/functions`) before a functions fix actually takes effect. Always say this explicitly when committing a functions/ change — don't imply "pushed to main" means "live" the way it does for everything else in this repo.

## Live Visitor Profile & Experience Templates — two separate projects, one repo

`visitor-profile/` and `experience-templates/` were split out as two
independently-managed projects, following the same pattern as
`menu-board-demo/`: each is its own subfolder in this same repo, developed on
its own feature branch(es), and merged to `main` on its own schedule — not
tied to the other project's release cadence.

- **`visitor-profile/`** — managing personalisation attributes in
  Personalisation Hub, and the source systems that populate them.
- **`experience-templates/`** — managing display types, elements, layouts,
  and templates.
- **`shared/interface-contract.md`** — the maintained interface contract
  between the two. It lives outside both project folders on purpose: it's
  shared space neither project owns unilaterally. Any change to the contract
  (not just to one project's own internals) should be made with both areas in
  mind. See that file for the actual contract (attribute envelope, deadline
  model, trust zones, versioning rules), grounded in the *Real-Time
  Personalised Surface Architecture Specification v1.2*.
- Each has its own `REQUIREMENTS.md` in its own folder, also grounded in
  that spec (visitor-profile = spec System One; experience-templates =
  spec Systems Two/Three).
- **The backlog tracker itself now also carries this** (see
  `backlog-tracker/` below): each project's `REQUIREMENTS.md` content is
  mirrored into that project's Firestore doc (`requirementsMd` field,
  editable from its Docs page), and the interface contract is additionally
  maintained as a live `interfaces` collection record spanning both
  projects — editable from either project's Docs page, not just as a repo
  file. Keep the repo file and the live record in sync; treat a divergence
  as a bug in whichever is stale.

**On the Prototype Backlog board** (the live `backlog-tracker` app, not the
retired Artifact — see "Prototype Backlog" below), these are two separate
docs in the `projects` Firestore collection — **"Live Visitor Profile"** and
**"Experience Templates"** — each with its own Backlog → Ready for Testing →
Live on Feature Branch → Merged to Main (Live) pipeline and its own Archive,
fully independent of each other and of "Products, Pricing & Asset
Management". Treat backlog sweeps and publish workflows for each exactly as
described in the "Prototype Backlog" section below — per-project, not
shared.

## Common Workflows

### Publish changes
Use the `/publish` skill to stage all changes, commit with a message, and push to `main`:
```
/publish
```

### Manual git flow
```bash
git add .
git commit -m "your message"
git push origin main
```

## Prototype Backlog

**The backlog now lives on a real, Firestore-backed web app — `backlog-tracker/` —
not the Claude Artifact this used to be.** Live board:
https://backlog-tracker-e4ed2.web.app/

The Claude Artifact ("Prototype Pipeline", `0573d999-a32a-499f-bc2f-d10ba7b494a4`)
is **retired — do not read from it, write to it, or republish it.** Its
historical cards were migrated once into this app (see
`backlog-tracker/README.md` → "Historical data migrated from the Artifact
board"); the name "Prototype Pipeline" is no longer used anywhere.

**The board is multi-project.** Firestore's `projects` collection holds one
doc per project (`{name, createdAt}`, auto-generated id); `backlogItems`
holds every card, each carrying a `projectId`. The original board's cards
live under the project named "Products, Pricing & Asset Management" — a
client can have several concurrent prototypes/projects tracked side by side,
each rendered as its own collapsible section on the one page.

- **Adding a project**: the page's "New project" button, or write a doc
  directly into `projects` (`{name, createdAt: serverTimestamp()}}`) —
  everything else (its Backlog/Testing/Live-on-branch/Merged columns, its
  own Archive) follows automatically from its `projectId` being used on
  `backlogItems` docs.
- **Renaming a project**: the pencil icon next to its name, or
  `setDoc(doc(db,"projects",id), {name}, {merge:true})`.
- **Collapsing a project**: per-viewer only, kept in that browser's
  `localStorage` (`bt-collapsed-projects`) — never written to Firestore, so
  it can't be set or read from outside a real browser session.
- Items saved before multi-project shipped (no `projectId`) are grouped
  under a synthesized "General" project automatically — nothing to migrate
  by hand.

Within each project, the columns are: **Backlog → Ready for Testing → Live on
Feature Branch → Merged to Main (Live)** (status keys: `backlog`,
`ready-for-testing`, `ready-to-publish`, `published-live`). A card does
**not** move itself from "Live on Feature Branch" into "Merged to Main
(Live)" — that's its own distinct **"Merge to main"** button, separate from
the **"Confirm live on branch"** button that clears Ready for Testing, so
there's always one deliberate click that corresponds to the actual
`git merge`/fast-forward push to `main`. New feature/bug requests land in a
project's Backlog; once tested and confirmed "Live on Feature Branch", push
the change and click that card's own "Merge to main" button.

**There's no separate "publish" step anymore — a write to Firestore is
live immediately**, for every open tab, via `onSnapshot()`. Check/update the
board with direct Firestore REST calls when working outside the browser UI
(this sandbox has no Firebase CLI, but the REST API works over plain HTTPS
since `firestore.rules` allows open, unauthenticated read/write on both
collections — see `backlog-tracker/firestore.rules`):

```bash
# List all projects
curl -sS "https://firestore.googleapis.com/v1/projects/backlog-tracker-e4ed2/databases/(default)/documents/projects"

# List all backlog items
curl -sS "https://firestore.googleapis.com/v1/projects/backlog-tracker-e4ed2/databases/(default)/documents/backlogItems"

# Move a card (PATCH with updateMask; status/updatedAt shown, add more fields+mask entries as needed)
curl -sS -X PATCH \
  "https://firestore.googleapis.com/v1/projects/backlog-tracker-e4ed2/databases/(default)/documents/backlogItems/<ITEM_ID>?updateMask.fieldPaths=status&updateMask.fieldPaths=updatedAt" \
  -H "Content-Type: application/json" \
  -d '{"fields":{"status":{"stringValue":"ready-for-testing"},"updatedAt":{"timestampValue":"<ISO8601>"}}}'
```

Read the board fresh before starting prototype work, and update it the
moment a card's real state changes (fix ready to test, pushed to `main`,
archived) — there's no "forgot to republish" risk now since writes are
instant, so there's no excuse for the board drifting from reality.

**Known gaps vs. the old Artifact board — don't assume feature parity:**

- **No automatic "Notify Claude" wake-up exists yet either, but for a
  different reason than before.** A Cloud Function
  (`functions/notifyOnBacklogItemCreated`) fires automatically the instant a
  new `backlogItems` doc is created with `status: "backlog"` — no button to
  click. But *what* it notifies depends entirely on the `NOTIFY_WEBHOOK_URL`
  secret someone wires up (see `backlog-tracker/README.md`): a Slack webhook
  still needs a human to relay the message into chat; only a live session's
  own `watch_url`, or a custom relay/Routine, would wake Claude with no
  human in the loop, and neither is set up by default. **Until you're told
  otherwise, treat this exactly like the old board: the user tells Claude in
  chat when to go check it.**
- **No `testUrl` field or quick-launch icon on cards.** When a fix is ready
  to test on a feature branch, say the branch/preview URL in chat (e.g.
  `https://raw.githack.com/offline2online/rob_ph_demos/<branch>/<path>`) —
  there's nowhere on the card itself to put it yet.
- **No per-card notes/`claudeNote` field, and no GitHub commit badge.** The
  schema is just `{projectId, title, desc, type, category, status,
  createdAt, updatedAt, archivedAt}` — there's nowhere on a card to record
  "pushed as commit `<sha>`" the way the old board's `claudeNote` did.
  Report that kind of progress in chat instead of trying to write it
  somewhere the UI won't show it.
- New items no longer take a title or category up front — just a
  description (typed or dictated); a short title is auto-generated and the
  category best-guessed (`suggestCategory()`), same spirit as before.

### Project header: one primary CTA, everything else in "⋮"

Each project header shows exactly two controls now: the primary
**+ New backlog item** button, and a small **⋮** options menu holding
everything else — Archived tickets, Requirements (MD file), and every
interface contract this project has with another one (see below). This
replaced three competing header buttons (Add / Archived / Docs), which was
the real "CTAs don't work on mobile" problem: on a narrow screen they wrapped
small and mis-tappable, and the board's 4 columns forced a sideways scroll
that hid most of the pipeline (including the Confirm/Merge buttons)
off-screen with no indication it was there. Below 640px width the board
stacks columns vertically instead (no horizontal scroll at all), and the
header becomes one big full-width Add button plus the ⋮ beside it. A project
with no interface yet shows a greyed-out "No interface contract yet" line in
the menu — click it to create one, same flow as the Docs page's own
"+ New interface" button.

Verifying this kind of change in this sandbox needs a workaround: the egress
policy here blocks `gstatic.com` (confirmed via
`$HTTPS_PROXY/__agentproxy/status` — "gateway answered 403 to CONNECT"),
which is where the real app loads the Firebase SDK from, so `app.js` never
executes against a plain `curl`/static check. To actually see it render,
stand up a local static server over `backlog-tracker/public/`, and use
Playwright's `page.route()` to intercept just the two `gstatic.com` script
URLs and fulfill them with a small in-memory Firestore stub (mirroring the
real collections' shapes) — the real, unmodified `app.js`/`index.html`/
`styles.css` then render exactly as they would in production, screenshot-able
at any viewport including mobile, with zero changes to any real file. Only
do this against a local stub, never point it at the real
`backlog-tracker-e4ed2` project from an automated test.

### Docs page: per-project requirements + interfaces between projects

Reached via a project's **⋮** menu (or directly, for a specific interface —
see above). It opens a page with two blocks:

- **Requirements** — free-text markdown, stored on that project's own
  Firestore doc (`requirementsMd`). This is the board-native home for a
  project's `REQUIREMENTS.md` — keep both in sync when either changes.
- **Interfaces with other projects** — a top-level `interfaces` Firestore
  collection, independent of any one project: each doc is
  `{name, projectIds: [idA, idB], contentMd, createdAt, updatedAt}`, visible
  and editable from **either** project's Docs page. Use this for any
  maintained contract between two projects on the board (not just Live
  Visitor Profile ↔ Experience Templates) — e.g. attribute/token contracts,
  shared data shapes, anything one project's changes could silently break
  for the other.
- **New project** can optionally define one interface with an existing
  project at creation time (a checkbox in the New Project modal) — skip it
  and add interfaces later from the Docs page instead; neither path is more
  "correct."

When a project's `shared/interface-contract.md`-style repo file changes,
mirror the change into its `interfaces` doc here (via the Docs page or a
direct Firestore write), and vice versa — don't let the two drift.

### Archiving Merged to Main (Live) cards

Merged to Main (Live) cards have an **Archive** action. Archiving sets
`status: "archived"` and `archivedAt` — archived cards keep their data but
drop off all four columns rather than being deleted. Each project's own
**Archived tickets** entry (in its **⋮** options menu) opens a dedicated
full-page table scoped to that project, sortable by Type / Area / Ticket
/ Date and filterable by area,
type, and free-text search, each row with a **Restore** button that sets
`status` back to `"published-live"`. Deletion (the trash icon on a card) is
reserved for Backlog cards only.

### Every card carries a `category` (area impacted)

One of a fixed set (`CATEGORIES` in `backlog-tracker/public/js/app.js`):
`Pricing & Offers`, `Product Assets`, `HQ Admin`, `Retail Admin`,
`Menu Board`, `Backend / Infrastructure`, `Uncategorised`. This is what the
Archived page's Area column/filter/badge are keyed on.

- A brand-new ticket gets `suggestCategory()`'s best-effort keyword guess —
  a starting point, not a final answer, same as the Feature/Bug guess.
- **The real classification is a mandatory step in every backlog sweep**:
  when investigating/fixing a Backlog card, correct `category` to whatever
  it actually turned out to be about before moving it to Ready for Testing.
- Can also be corrected any time via direct Firestore write (no in-app
  select on the card itself in this build, unlike the old Artifact board).

### Mic dictation (New Item form)

The mic button requests microphone permission (`getUserMedia`) before
starting Web Speech dictation, with a specific visible error (blocked
permission, no device, no browser support, network needed, etc.) instead of
failing silently — not verifiable end-to-end from this sandbox (no real mic,
no live path to the speech-recognition backend), so if a user reports the
mic doing nothing, ask what error text appeared rather than assuming it's
still silent. The description textarea auto-grows to fit what's been typed
or dictated (capped near half the viewport).

## These prototypes run iframed inside the real Personalisation Hub platform

`hq-admin.html` and `retail-admin.html` are not viewed standalone in real use — they're **iframed into the actual Personalisation Hub platform** (confirmed directly by the user; also already documented in-code, e.g. hq-admin.html's own comments about "the parent platform's own sidebar" and the mic-permission-inside-iframe backlog item). This means:

- **A screenshot of either page in real use will show the real platform's own chrome around our content** — its branded top bar/logo, its left-hand icon sidebar, its own breadcrumbs (e.g. "Retail Admin / Menu Boards"). That outer chrome is the platform's, not this repo's, and seeing it is normal — **it is not a sign the user is looking at the wrong system or a different codebase.** Don't ask "is this our prototype or the real platform?" — assume iframe chrome and move on to the actual content/bug.
- **The reverse can also be true**: some screens the user screenshots (e.g. a card-style "Menu Boards" list with items/price/category, RRP shown as a plain secondary line rather than a struck-through price) may be a **native page of the real platform itself**, not our iframed content at all — e.g. nothing in this repo renders price as a stacked "RRP £X" label the way one such screen did. If a screenshot's content/layout doesn't match anything `grep`-able in this repo (page title, exact copy, that specific price/badge presentation), say so plainly rather than continuing to hunt for the bug in this codebase — it may need fixing on the platform side, outside this repo's reach.
- When debugging a visual report, check which case applies: platform chrome around our real content (debug here) vs. a platform-native screen that merely happens to show the same product data (out of scope here).
- **It's a mix, confirmed directly (1 Sep 2026) — check per screen, don't assume either way for HQ/Retail Admin pricing:**
  - `hq-admin.html`'s own **Products & Pricing list/grid** (`offline2online.github.io/rob_ph_demos/menu-board-demo/hq-admin.html`) is confirmed genuinely this repo's own code, live and in real use — verified directly against a screenshot of that exact GitHub Pages URL showing the grid's real "Local offer"/"Targeted" pills, which only exist in this repo's code.
  - But the **per-product detail editor** you reach by clicking into a product (tabs: Product Assets / Product Details / Pricing / Stockists) is the real Personalisation Hub platform's own native page, NOT this repo's `product-app`/React pricing tab — its copy ("Badge for External Displays" targeting, a concept that doesn't exist anywhere in this repo) and layout don't match. Don't assume clicking through from the grid stays in this repo's code.
  - The store-level "Menu Boards" list (branded PersonalisationHub chrome, card-style rows, RRP shown as a plain secondary line) has similarly been confirmed as platform-native, not this repo's `retail-admin.html`.
  - **hq-admin.html's grid deliberately shows only HQ's own RRP/offer in its Price column, never a store's override** — a "Local offer ×N" pill flags that a store-level price exists (click it to jump to the per-product pricing page) without picking one store's price to display in an aggregate, all-stores view. That's intentional design, not a bug — don't try to make this specific grid show the discounted local price inline.
  - Bottom line: verify per-screen against copy/markup you can `grep` in this repo before deciding whether a pricing bug is fixable here or belongs to the real platform.

## Guidelines

- Always push to `main` branch
- Commit messages should be short and descriptive (e.g., "Add contact page", "Update hero image")
- No build step required — files are served as-is
- Keep assets organized (e.g., `css/`, `js/`, `images/` subdirectories)
