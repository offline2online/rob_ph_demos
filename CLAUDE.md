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

## FAQ / Help Center (`faq/`) — public site, edited from backlog-tracker

`faq/` at the repo root is the consumer-facing Help Centre (front page +
search, category pages with folders, article pages). It replaces
help.personalisationhub.com (Freshdesk) and is also iframed into the
support centre on personalisationhub.com. Plain static site on GitHub
Pages — **the site renders a static snapshot committed in `faq/data/`**
(`index.json` + `articles/<id>.json`), not the Firebase SDK. Content is
still EDITED from backlog-tracker's **FAQ Management** page (Firestore
`faqCategories`/`faqArticles` in `backlog-tracker-e4ed2`); the
`.github/workflows/faq-content.yml` workflow exports Firestore → `faq/data`
hourly/on demand and syncs `faq/data` → Firestore when it changes on
`main` (`backlog-tracker/scripts/faq-export.js` / `faq-sync.js`), and the
article page pulls a newer revision straight from Firestore's REST API on
load. **A "Notify Claude — Deploy" run also reviews the help centre**: the
Routine reads each merging PR's diff and parks corrected text on affected
articles of that project's product/program as `faqArticles.pendingRevision`
(never the live fields); a person approves it in FAQ Management (old vs
new diff) and it goes live automatically once the ticket is Merged to
Main — see `backlog-tracker/ROUTINE_INSTRUCTIONS.md` step 3b and
`backlog-tracker/REQUIREMENTS.md` → "FAQ revision review". Writes to the two FAQ collections require a signed-in allowlisted
Google account (`backlog-tracker/firestore.rules` → `isEditor`), as does
the whole console (sign-in wall in `backlog-tracker/public/js/auth-gate.js`). See `faq/README.md` for the full flow
and `docs/faq-audit-2026-09.md` for the September 2026 audit/rewrite (12
categories, 140 articles, new-customer ordering). The original Freshdesk
import (`backlog-tracker/scripts/seed-faq-data.js`, insert-only) is now
historical — it cannot overwrite the rewritten articles.

**All FAQ/user-guide content and structure must follow
[`docs/CONTRIBUTING-docs.md`](./docs/CONTRIBUTING-docs.md)** — the
governing documentation standard (Diátaxis document types, FAQ writing
rules, formatting/accessibility conventions). Read it in full before
writing or editing any article, and classify every article's `docType`
(`faq` | `how-to` | `reference` | `explanation`) per that file's §2 —
see `backlog-tracker/REQUIREMENTS.md` → "FAQ / Help Center" for the
field's exact shape.

## Live Visitor Profile and Display Types & DSP Integration — two separate projects, one repo

`visitor-profile/` and `dsp-integration/` were split out as two
independently-managed projects, following the same pattern as
`menu-board-demo/`: each is its own subfolder in this same repo, developed on
its own feature branch(es), and merged to `main` on its own schedule — not
tied to the other project's release cadence.

- **`visitor-profile/`** — managing personalisation attributes in
  Personalisation Hub, and the source systems that populate them.
- **`dsp-integration/`** — managing display types, elements, playlists, and
  the advertising partner/DSP connections that fill sold slots. Layouts and
  templates (the surface layer) belong to this project too but are held out
  of the first release. Full name **"Display Types & DSP Integration"** (as
  on the backlog board); **refer to it as "Display Types"** in prose.
  Formerly "Experience Templates", then `display-types-dsp-integration/`:
  **that folder was removed on 21 Sep 2026 (Rob) and this one replaced it.**
  Its history, including 8 commits that never reached `main`, is kept on the
  tag `archive/display-types-dsp-integration`
  (`git checkout -b restore archive/display-types-dsp-integration`).
- **`shared/interface-contract.md`** — the maintained interface contract
  between the two. It lives outside both project folders on purpose: it's
  shared space neither project owns unilaterally. Any change to the contract
  (not just to one project's own internals) should be made with both areas in
  mind. See that file for the actual contract (attribute envelope, deadline
  model, trust zones, versioning rules), grounded in the *Real-Time
  Personalised Surface Architecture Specification v1.2*.
- Each has its own `REQUIREMENTS.md` in its own folder, also grounded in
  that spec (visitor-profile = spec System One;
  dsp-integration = spec Systems Two/Three).
- **The backlog tracker itself now also carries this** (see
  `backlog-tracker/` below): each project's `REQUIREMENTS.md` content is
  mirrored into that project's Firestore doc (`requirementsMd` field,
  editable from its Docs page), and the interface contract is additionally
  maintained as a live `interfaces` collection record spanning both
  projects — editable from either project's Docs page, not just as a repo
  file. Keep the repo file and the live record in sync; treat a divergence
  as a bug in whichever is stale.

**The POC lives in `dsp-integration/`** (merged to `main` on 21 Sep 2026,
PR #176). It is a working service, not a static page: an npm-workspaces
monorepo with a Fastify API over SQLite, a React admin UI, mock DSPs and an
auction job, all behind the `dspIntegration` flag. It therefore **cannot be
opened from GitHub Pages like the other demos** — run it locally
(`npm run dev:api` / `dev:mocks` / `dev:admin`, then `localhost:5173`).
The static prototype it was built from is published at
<https://offline2online.github.io/rob_ph_demos/dsp-integration/prototype/> —
the admin UI built against a captured snapshot of its own API, so it opens
from a URL and can be iframed into HQ Admin. It is **read-only**: a write
answers with "changes aren't saved". Rebuild it with
`npm run demo:capture -w @ph-dsp/admin` (dev API up) then
`VITE_DEMO=1 npx vite build --base=/rob_ph_demos/dsp-integration/prototype/`,
and copy `apps/admin/dist/.` over `dsp-integration/prototype/`.

**On the Prototype Backlog board** (the live `backlog-tracker` app, not the
retired Artifact — see "Prototype Backlog" below), these are two separate
docs in the `projects` Firestore collection — **"Live Visitor Profile"** and
**"Display Types & DSP Integration"** — each with its own Backlog → Ready
for Testing → Live on Feature Branch → Merged to Main (Live) pipeline and
its own Archive,
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
(Live)", and there is no manual button that does either. A "Live on Feature
Branch" card shows a passive "Waiting for Deploy to Main" hint — clicking
that project's own **"Deploy to Main"** header action is the only way a
card reaches "Merged to Main (Live)", since that's the only path that
actually merges the code (via
`backlog-tracker/scripts/run-backlog-automation.js`) before flipping the
status. There used to be a per-card "Merge to main" button (and a bulk
"Merge all to main" on the Deployments page) that just wrote
`published-live` directly with no connection to whether the PR was
actually merged — removed for exactly that reason, after it let cards
say "Merged to Main" while their PRs sat open and unmerged on GitHub.

**Each project ships on a deployment train, not per ticket.** Every ticket
a project builds is one commit on that project's single integration branch,
`deploy/<project-slug>` (`projects/{id}.deployBranch`) — tickets stack on
each other, are tested in the combination they will ship in, and merge to
`main` as ONE PR with one `APP_VERSION` bump. This replaced a per-ticket
branch-off-`main` model where two tickets alive at once were guaranteed to
conflict on merge (and always conflicted on `version.js`, which every PR
bumped on the same line). Consequences worth knowing before touching the
board:

- **Approving is the checkbox.** A Ready for Testing card has one CTA,
  **Failed testing**; tick it (or the column select-all) and click
  **"Approved for Deployment — N selected"**. The old per-card "Confirm
  tested" button and its `testPassed` flag are gone.
- **Failed testing also takes the ticket off the branch** — it writes
  `revertRequested`, and the automation reverts that card's commits. A card
  in Backlog must never have live commits on a train. If a later ticket
  built on top of it the revert conflicts, nothing is force-pushed and
  `revertBlockedBy` names who a human has to decide about.
- **Deploy to Main appears only when the whole train is approved** —
  merging the branch ships everything on it, so Ready for Testing has to be
  empty for that project first.
- **The first approval locks the Backlog** (`trainLocked`): Ready for Dev
  and Groom Backlog hide until the train merges, so no new ticket joins a
  release that is already closing. Backlog cards stay fully editable; only
  starting a build is held.

New feature/bug requests land in a project's Backlog; once tested and
approved, click that project's **"Deploy to Main"** button to have Claude
verify and merge the train for real. See `backlog-tracker/README.md` →
"The deployment train — one branch and one PR per project" and
`backlog-tracker/REQUIREMENTS.md` → "The deployment train".

**There's no separate "publish" step anymore — a write to Firestore is
live immediately**, for every open tab, via `onSnapshot()`. **The board is
behind sign-in** (Google, or an email and password): every read and write of
the board's collections requires a signed-in **member** — a
`consoleUsers/<lowercased email>` doc, managed from the console's
**Settings → Team & agent access**, which `backlog-tracker/firestore.rules`
resolves on every request (only the two help-centre collections stay
publicly readable), so anonymous REST calls to `firestore.googleapis.com`
are denied. That same row also decides whether that person's **AI agent**
may connect to the console over MCP — see "The PH Agent Console is also an
MCP server" below. Outside
the browser UI, sign in as the board automation user over Identity Toolkit
(email `board-automation@backlog-tracker-e4ed2.firebaseapp.com`, password =
the `BOARD_API_KEY` secret; Routine-fired sessions receive it in their fire
payload) and send the ID token as a Bearer header — or use the `boardApi`
proxy (`https://backlog-tracker-e4ed2.web.app/boardApi/v1/...`) with an
`X-Board-Key` header. Same paths, verbs and JSON as Firestore's REST API:

```bash
IDTOKEN=$(curl -sS -X POST "https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=AIzaSyDzG5MzavLWyKU7NXfTPskuWbFYFlc5W3g" \
  -H "Content-Type: application/json" \
  -d '{"email":"board-automation@backlog-tracker-e4ed2.firebaseapp.com","password":"<BOARD_API_KEY>","returnSecureToken":true}' | jq -r .idToken)
BOARD="https://firestore.googleapis.com/v1/projects/backlog-tracker-e4ed2/databases/(default)/documents"
AUTH="Authorization: Bearer $IDTOKEN"

# List all projects
curl -sS -H "$AUTH" "$BOARD/projects"

# List all backlog items
curl -sS -H "$AUTH" "$BOARD/backlogItems"

# Move a card (PATCH with updateMask; status/updatedAt shown, add more fields+mask entries as needed)
curl -sS -X PATCH -H "$AUTH" \
  "$BOARD/backlogItems/<ITEM_ID>?updateMask.fieldPaths=status&updateMask.fieldPaths=updatedAt" \
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
- ~~No `testUrl` field or quick-launch icon on cards.~~ **Fixed**: a Ready
  for Testing card now has its own "Set test link" → "Test this →" button
  (`backlogItems.previewUrl`), using the
  `https://rawcdn.githack.com/offline2online/rob_ph_demos/<branch>/<path>`
  convention — **`rawcdn.githack.com`, not `raw.githack.com`**: the latter
  proxies through jsDelivr's CDN cache (up to ~7 days), so a link set right
  after one push can keep showing that first commit even after later
  pushes update the file, with no visible error; `rawcdn.githack.com` is
  githack's own always-uncached host, meant specifically for testing an
  in-progress branch like this — no need to say the link in chat separately
  anymore. `guessPreviewUrl` links to a changed `.html` page, or, for a
  ticket that changes only CSS/JS, to the nearest `index.html` above those
  assets (the page that renders them); only a change with no page above it
  at all — `scripts/`, `functions/` — falls back to a link to the branch.
  Note that a githack preview is a different origin from the deployed app,
  so for backlog-tracker's own UI, Firebase Auth sign-in may be refused
  there: what renders before the sign-in wall is testable, the rest needs
  the deployed board.
- **No per-card notes/`claudeNote` field, and no GitHub commit badge.** The
  schema is just `{projectId, title, desc, type, category, status,
  createdAt, updatedAt, archivedAt}` — there's nowhere on a card to record
  "pushed as commit `<sha>`" the way the old board's `claudeNote` did.
  Report that kind of progress in chat instead of trying to write it
  somewhere the UI won't show it.
- New items no longer take a title or category up front — just a
  description (typed or dictated); a short title is auto-generated and the
  category best-guessed (`suggestCategory()`), same spirit as before.

### The PH Agent Console is also an MCP server

`https://backlog-tracker-e4ed2.web.app/mcp` — a team member's own AI agent
(Claude Desktop, Claude Code, a claude.ai custom connector, anything that
speaks MCP) can use the board and the help centre as a tool, authenticating
with the same Personalisation Hub / offline2online account they use for the
console itself. **No API key to mint, paste, share or rotate**: the client
runs a standard OAuth 2.1 flow (`backlog-tracker/functions/mcp-server.js` is
its own authorization server — dynamic client registration, mandatory PKCE
S256, rotating refresh tokens), the person signs in with Google or a
password, and everything their agent writes is attributed to their email on
the ticket and in `mcpAuditLog`.

- **Who may connect is the same `consoleUsers` row as browser access** (see
  above), re-checked on every single call — removing someone, disabling
  them, or switching their agent off cuts it immediately, not at token
  expiry. Roles: `admin` (manages the list) / `editor` (read + write) /
  `viewer` (read only; `board.write` is never issued to one).
- **Tickets: read/file/comment only, deliberately.** Read: `whoami`,
  `list_projects`, `list_backlog_items`, `get_backlog_item`, `search_faq`,
  `get_faq_article`. Write: `create_backlog_item` (always into Backlog),
  `update_backlog_item` (title, desc, type, category — **no status**),
  `add_item_comment`.
- **Documentation: full read/write, on purpose.** An agent is expected to
  keep a project's docs current as it works. Read: `get_project_docs`,
  `list_doc_revisions`, `get_doc_revision`. Write:
  `set_project_requirements`, `set_project_readme`, `set_project_artifact`,
  `create_project_document`/`update_project_document`/
  `delete_project_document`, `create_interface`/`update_interface`/
  `delete_interface`. **Writes replace the whole document** — read it first
  and send the complete revised text, never a fragment. Every write records
  what it replaced in `docRevisions` (append-only, server-only, member-
  readable), so a bad write or a delete is recoverable via
  `list_doc_revisions` → `get_doc_revision` → write it back. Ceilings:
  200k chars for Requirements/README, 20k for project documents and
  interfaces (matching what `firestore.rules` lets the board's own editor
  save, so a person can always edit what an agent wrote). Keep the repo
  files (`REQUIREMENTS.md`, `README.md`, `shared/interface-contract.md`) in
  sync with these — a divergence is a bug in whichever is stale.
- **Nothing there deploys, merges, approves a ticket out of Ready for
  Testing, moves a card, writes a train field, fires Notify Claude, or
  triggers a campaign.** Campaign triggering stays on the triggered Routine
  and the release pipeline keeps its human gates. The documentation tools
  DO write to `projects` (that's where `requirementsMd`/`readmeMd`/
  `artifactUrl` live), so this is enforced rather than incidental:
  `updateProjectFields` is the only path to a project write and refuses any
  field outside `PROJECT_WRITABLE_FIELDS`. Don't add a tool that changes
  that without saying so explicitly —
  `backlog-tracker/test/mcp-server.test.js` asserts the allowlist, the
  guard, and that no doc tool's schema can even express a train field.
- **Not the same thing as `boardApi`/`BOARD_API_KEY`**, which is one shared
  secret standing in for the Routine's own automation and stays as it is.
  The MCP server is per-person, per-token and individually revocable.
- Full detail — connecting a client, adding a member, provisioning a login
  for someone with no Google account, the OAuth endpoints, what is and isn't
  stored — is in **`backlog-tracker/MCP.md`**.
- Tests: `cd backlog-tracker/test && npm run test:mcp` drives the whole flow
  against stubbed Firebase SDKs — no emulator, no credentials, no network,
  so it runs in this sandbox. The browser half of the sign-in page (a real
  Google popup) is the part that can only be checked on the deployment.

### Project header: one primary CTA, everything else in "⋮"

Each project header shows exactly two controls now: the primary
**+ New backlog item** button, and a small **⋮** options menu holding
everything else — Archived tickets, Requirements (MD file), every
interface contract this project has with another one (see below), and,
when the project has one, a **View Artifact ↗** link to a Claude-published
Artifact for that project (opens in a new tab; a plain, non-clickable
"No artifact yet" row shows when unset). `artifactUrl`/`artifactUpdatedAt`
are written directly to the project's Firestore doc by the Notify Claude
Routine — see `backlog-tracker/ROUTINE_INSTRUCTIONS.md` → "Project
Artifact" and `backlog-tracker/REQUIREMENTS.md` → "Data model". This
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
  Visitor Profile ↔ Display Types) — e.g. attribute/token
  contracts, shared data shapes, anything one project's changes could break
  for the other.
- **Adding an interface** is done from a project's own Docs page (either
  side) — the New Project modal itself no longer offers an inline "define
  an interface with an existing project" option; it only ever creates a
  plain project, keeping that one modal to a single quick step.

When a project's `shared/interface-contract.md`-style repo file changes,
mirror the change into its `interfaces` doc here (via the Docs page or a
direct Firestore write), and vice versa — don't let the two drift.

### Archiving Merged to Main (Live) cards

Merged to Main (Live) cards have an **Archive** action. Archiving sets
`status: "archived"` and `archivedAt` — archived cards keep their data but
drop off all four columns rather than being deleted. Each project's own
**Archived tickets** entry (in its **⋮** options menu) opens a dedicated
full-page table scoped to that project, sortable by Type / Area / Ticket
/ Date and filterable by area, type, and free-text search, each row with a
**Restore** button that sets `status` back to `"published-live"`. Deletion
(the trash icon on a card) is reserved for Backlog cards only. The table
also carries a **Version** column — the `testVersion` (backlog-tracker's
own `APP_VERSION`) the card was stamped with when it first reached Ready
for Testing, kept visible through archiving; see
`backlog-tracker/REQUIREMENTS.md` → "Test version (`testVersion`)".

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

### Mic dictation (New Item form, and every comment box)

Originally New Item's description field only; a `createDictationController`
factory in `app.js` now backs three independent mic buttons — New Item's
description, the quick-comment modal, and the Edit item modal's own
comment box — each with its own dictation state, so starting/stopping one
never affects another. Every instance requests microphone permission
(`getUserMedia`) before starting Web Speech dictation, with a specific
visible error (blocked permission, no device, no browser support, network
needed, etc.) instead of failing silently — not verifiable end-to-end from
this sandbox (no real mic, no live path to the speech-recognition backend),
so if a user reports the mic doing nothing, ask what error text appeared
and on which field, rather than assuming it's still silent. Each textarea
auto-grows to fit what's been typed or dictated (capped near half the
viewport).

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

## Every UI change goes through the `ph-designer` skill — no exceptions

Anything that renders — a page, a screen, a component, a form, a table, an
admin view, a prototype, a mock-up — **must be built against the
`ph-designer` skill**, whether or not the request mentions Personalisation
Hub. Read it *before* writing markup, not afterwards as a checking pass:
it carries the measured tokens (colour, type, spacing, radius), the
component recipes, and the two surface references (HQ Admin / Retail
Admin). Guessing at these and correcting later produces screens that are
subtly wrong in ways nobody can name.

Two things in that skill are load-bearing and routinely got wrong:

- **Read `references/prototyping.md` first.** Almost everything in this
  repo is a *prototype iframed into HQ Admin*, which means you build the
  content frame ONLY — no header, no sidebar, no breadcrumb, and nothing
  `position: fixed` (it anchors to the iframe, not the viewport). Getting
  this wrong means rebuilding the whole thing.
- **Material Symbols (Outlined) is the platform's only icon set**, and the
  font stack is Roboto — never a system stack, never another icon library.

This applies to every route into development: a person asking in chat, a
Routine-fired session working a Backlog card, or a Deploy run. If a change
touches rendered output and the skill was not read, that is a defect in
the change regardless of how the result looks.

## Keep each project's README current

Every project folder has its own `README.md` — a short orientation doc
(what's in the folder, what each file does, where the fuller spec lives),
not a full spec dump. At the end of any session that touches a project
(adds/removes/renames files, changes what a script does, changes the
deploy story), update that project's `README.md` to match before finishing
— don't let it silently drift stale the way this repo's READMEs did before
this section existed. For a project also tracked on the Prototype Backlog
board (`backlog-tracker/` — see "Prototype Backlog" below), also update
that project's own `readmeMd` Docs field to match (`backlog-tracker`'s own
Docs page → README block); treat a divergence between the repo file and
the live field as a bug in whichever is stale, same as `REQUIREMENTS.md`
vs. `requirementsMd` already works.

### Keep the board's copies in step as you go, not in a catch-up sweep

**`REQUIREMENTS.md` and `README.md` are the source of truth; the board's
`requirementsMd` / `readmeMd` are copies that must follow them in the same
session the file changes** (Rob, 21 Sep 2026). Not at the end of the week,
not when someone notices: an agent that edits one of these files has not
finished the job until the board says the same thing.

How to do it, in order of preference:

1. **Run the project's sync script** where it has one —
   `npm run board:sync` in `dsp-integration/` reads the files off disk,
   PATCHes `requirementsMd` / `readmeMd`, then reads them back and fails
   loudly if they don't match byte for byte. `npm run board:sync -- --check`
   reports drift without writing, which is what to run if you only want to
   know. It needs `BOARD_API_KEY` in that project's `.env`.
2. **The board MCP tools** — `set_project_requirements` and
   `set_project_readme` — when you have them and the document is small
   enough to reproduce exactly (a README, an interface contract). They
   replace the whole document, so they mean retyping it.
   **Don't hand-copy a long specification through a model**: an 80 KB file
   retyped by an agent is a file that has quietly acquired errors. Use the
   script, or say the sync is outstanding and why.

Whichever route, **verify**: read the field back and compare it with the
file. A sync that reports success without checking is worse than no sync,
because it stops anyone looking again.

**Without the write credential you can still report drift, and should.**
Read the project's docs over the board's MCP connector (`get_project_docs`
with `include: ["requirements", "readme"]`) and pass the saved result to
`npm run board:sync -- --check-mcp <file>`: it compares locally, names the
sections that moved, and exits 1 when the board is behind. Say that in the
ticket or to the user rather than leaving it unsaid — a known gap is
manageable, a silent one isn't. Exit codes: 0 in sync, 1 drifted, 2 couldn't
run.

## Guidelines

- Always push to `main` branch
- Commit messages should be short and descriptive (e.g., "Add contact page", "Update hero image")
- No build step required — files are served as-is
- Keep assets organized (e.g., `css/`, `js/`, `images/` subdirectories)
