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
Whoever owns Firebase access needs to:

1. **Create a new Firebase project** in the [Firebase Console](https://console.firebase.google.com/) —
   deliberately a *new* one, not `rob-ph-demos`, so the isolation above
   actually holds. Enable **Firestore** (Native mode) in it.
2. Add a **Web app** to that project (Project settings → Your apps), copy
   the config object it gives you into `public/js/firebase-config.js`
   (replacing the `REPLACE-ME` placeholders).
3. Put the real project ID in `.firebaserc` (replacing
   `REPLACE-WITH-YOUR-NEW-FIREBASE-PROJECT-ID`, both places it appears).
4. From inside this folder: `firebase deploy --only firestore:rules` to
   publish `firestore.rules`.
5. `cd functions && npm install`.
6. **Wire up `NOTIFY_WEBHOOK_URL`** (see below), then
   `firebase deploy --only functions`.
7. `firebase deploy --only hosting` to publish `public/` (or just open
   `public/index.html` locally / host it wherever you like — it's static).

### Wiring up NOTIFY_WEBHOOK_URL

The function POSTs a JSON payload to whatever URL you set here:

```bash
cd backlog-tracker
firebase functions:secrets:set NOTIFY_WEBHOOK_URL
```

What you point it at determines how automatic this really is:

- **Slack incoming webhook** — easiest to set up, and the payload's
  `text` field is already Slack-message-shaped. A person still relays it
  into a Claude conversation, but nobody has to remember to check a
  board.
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
