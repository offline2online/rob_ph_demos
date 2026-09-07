# backlog-tracker

A real, Firestore-backed version of the Prototype Pipeline board (the
Claude Artifact at the root `CLAUDE.md`'s "Prototype Backlog" link), built
to answer one specific question: **can a web app tell Claude the moment a
new item lands in the Backlog, with no one clicking a button?**

The Artifact board can't — it has no server of its own, so "Notify Claude"
there is a manual flag someone has to click, and a person still has to
tell Claude in chat to go look. This app closes that gap: a Cloud Function
(`functions/notifyOnBacklogItemCreated`) fires automatically the instant a
document is created in Firestore with `status: "backlog"`.

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
backlogItems (Firestore, this project's own database)
        │  onDocumentCreated
        ▼
functions/notifyOnBacklogItemCreated
        │  POST (JSON)
        ▼
NOTIFY_WEBHOOK_URL   (Firebase secret — you decide what this points at)
```

Frontend (`public/`) is a plain Firestore-backed board — vanilla JS,
Firebase's modular Web SDK loaded from the `gstatic.com` CDN, no build
step. Every open tab gets realtime updates via `onSnapshot()`, so (unlike
the Artifact board) other viewers never need a full page reload to see a
change.

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
2. Click **+ New item**, fill in a title and description, submit.
3. Check the Slack channel from step 7 — a message should land within a
   few seconds.
4. If nothing shows up: `firebase functions:log` — look for "Notified
   webhook of new backlog item" (success) or the logged error.

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

If the workflow's deploy step fails with a permissions/IAM error, that's
almost always a role missing here, not a bug in the workflow itself.

### The `NOTIFY_WEBHOOK_URL` secret

`functions/index.js`'s `notifyOnBacklogItemCreated` reads a Firebase
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

What `NOTIFY_WEBHOOK_URL` points at determines how automatic this really is:

- **Slack incoming webhook** (above) — easiest, but a person still
  relays the message into a Claude conversation.
- **A live Claude Code Remote session's `watch_url` webhook** — the same
  kind of URL this session used to watch the Prototype Pipeline Artifact.
  Wakes that specific session directly with no human in the loop, but the
  URL is tied to one running session and needs re-registering (a fresh
  `watch_url` call) whenever that session ends.
- **Your own small relay** that calls the Claude API directly, or fires a
  Routine — the most durable option (survives any one session ending),
  but it's code you'd write and host yourself; not included here.

## What's deliberately not built yet

- **No auth.** `firestore.rules` is open read/write, same permissive
  starting posture the rest of this repo's prototypes use — fine for an
  internal team tool, not for anything public. Add Firebase Auth + rules
  scoped to signed-in users before that changes.
- **No drag-and-drop, no archive page, no multi-project.** The Artifact
  board grew those over time; this scaffold only builds what's needed to
  demonstrate the auto-notify path. Worth porting over if this becomes the
  primary board instead of a proof of concept.
