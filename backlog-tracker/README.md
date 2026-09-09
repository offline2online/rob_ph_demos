# backlog-tracker

See [`REQUIREMENTS.md`](./REQUIREMENTS.md) for the full functional
specification — data model, board behavior, the notify/automation Cloud
Functions, and the FAQ / Help Center surface. This README covers setup and
deploy; that file covers what the system is actually for and why it's
built the way it is. Keep both in sync with the live copy on this
project's own Docs page (`requirementsMd`) — treat a divergence between
any of the three as a bug in whichever is stale.

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
Live on Feature Branch (already tested and confirmed, just waiting for
someone to merge their PRs), and its own Cloud Function
(`functions/notifyOnProjectReadyToDeploy`) fires the same Routine — but
with fire text that explicitly says "these are done, don't re-implement
them, just merge and mark published-live," since the Routine's own shared
prompt only knows how to interpret a "N items in Backlog" request. See
`REQUIREMENTS.md` → "Functional requirements — notification & automation"
for the full shape of both functions.

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

### Merging several PRs at once — the deploy concurrency group, and the board's Deployments page

Merging multiple PRs within seconds of each other used to fire one deploy
run per push, all racing to update the same Cloud Functions at once — GCP
rejects the losers with `409 unable to queue the operation`. The workflow's
`concurrency` block (keyed on `${{ github.workflow }}-${{ github.ref }}`,
`cancel-in-progress: true`) fixes the mechanical race: a burst of N merges
now completes exactly one deploy, for the newest commit, instead of N
racing runs.

That only fixes the deploy pipeline, though — it doesn't tell you *which*
PRs were meant to land together in the first place, especially when the
Notify Claude Routine fixes several backlog items in one fire and opens
several PRs at once. For that, see the board's own **Deployments** page
(per project, via **⋮ → Deployments** — full behavior in `REQUIREMENTS.md`
under "Functional requirements — the board"): it groups those tickets,
shows a live checklist of which ones have actually been confirmed "Live on
Feature Branch," and only unlocks a single "Merge all to main" button once
every one of them is ready — so the person actually merging the PRs on
GitHub has one place to see the whole batch and merge it together, rather
than merging each PR the moment its own card looks ready with no idea
whether the rest of its batch is done. That button is board bookkeeping
only (it flips Firestore status, it doesn't call the GitHub API) — you
still merge the actual PRs yourself, this just tells you when the whole
batch is truly ready to.

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

### Notify Claude progress (`notifyRoutine`) — session id, spinner, split count

The fire endpoint's success response includes a `claude_code_session_id`
field — confirmed by a live `curl` test against the real endpoint (also a
research-preview surface, so re-confirm this with `curl` if session links
ever silently stop appearing, same caution as the header gotcha above).
`notifyOnProjectReadyForReview` reads it, builds
`https://claude.ai/code/<id>`, and writes the whole outcome to
`projects/{id}.notifyRoutine` (`status`, `firedAt`, `sessionId`/
`sessionUrl`, `itemCount`, `sentItemIds`) — the board's Notify Claude
button reads this to show a spinner + "View session →" link while a fire
is in flight, and a separate small CTA for anything added to Backlog since
that click (`sentItemIds` is how it knows what's "new").

The Routine is asked, in the fire request's own `text`, to PATCH
`notifyRoutine.status` to `"done"`/`"error"` (with `finishedAt`) when it
stops — but nothing enforces that a fired session actually does this
(an older Routine prompt won't know to, and a crashed session can't). The
frontend's own fallback — treating any `"in-progress"` older than 20
minutes as done — is what actually keeps the button from getting stuck
forever, not the self-report; treat the self-report as a nice-to-have for
faster feedback, not the safety mechanism.

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
sharing this same Firestore project:

- **Public site**: repo-root `faq/` (outside `backlog-tracker/` entirely —
  it's a plain static site published via GitHub Pages like the rest of
  `rob_ph_demos`, not Firebase Hosting). Front page with search + category
  grid, a category page listing its articles, an article page, and a full
  search-results page — modeled on
  <https://help.personalisationhub.com/support/home> (that URL is itself
  blocked by this sandbox's network egress policy, so it couldn't be read
  directly — the real content was instead sourced from a Freshdesk export
  already sitting in Google Drive, see "Seeding" below).
- **Admin**: this app's own **FAQ Center** page (reached from the header's
  hamburger menu — global, not per-project, since an article can span or
  link to any one project). Lets you manage categories (name,
  Material Symbols icon, description, display order) and articles (title,
  slug, category, an optional linked project, summary, a small
  markdown-ish body with a live preview, search keywords, draft/published
  status, and a "needs review" flag).
- **Data model** — two new top-level collections:
  - `faqCategories/{id}`: `{name, icon, description, order, createdAt, updatedAt}`
  - `faqArticles/{id}`: `{categoryId, projectId (nullable), title, slug, summary, bodyMd, keywords[], status: "draft"|"published", needsReview, order, createdAt, updatedAt, publishedAt}`
- **Why `projectId` exists on an article**: this is the "categorization by
  project" piece — an article can be linked to whichever `projects`
  collection doc (Live Visitor Profile, Experience Templates, Products
  Pricing & Asset Management, etc.) it documents. This is what the
  auto-review automation below uses to find which articles a shipped
  feature might have made stale.
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
  FAQ Center's own manual toggle sets. `needsReview` otherwise stays a
  manual toggle for projects that leave this off.
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

## What's deliberately not built yet

- **No auth.** `firestore.rules` is open read/write, same permissive
  starting posture the rest of this repo's prototypes use — fine for an
  internal team tool, not for anything public. Add Firebase Auth + rules
  scoped to signed-in users before that changes.
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
