# The hosted API — Cloud Functions in `backlog-tracker-e4ed2`

What makes the hosted prototype save (Rob, 23 Sep 2026). The prototype at
<https://offline2online.github.io/rob_ph_demos/dsp-integration/prototype/>
is static files on GitHub Pages; on start-up it looks for this API and, if
it answers, sends every read and save to it. If it doesn't answer, the page
falls back to the read-only snapshot, as it did before this existed.

**URL:** `https://us-central1-backlog-tracker-e4ed2.cloudfunctions.net/dspApi`
(the same paths as `npm run dev:api`: `/api/admin/v1/*`, `/api/v1/*`,
`/sellers.json`, `/assets/*`).

## What runs

| Function | What it is |
|---|---|
| `dspApi` | HTTPS, public. The unchanged POC API (`apps/api`) plus the mock DSPs (`apps/dsp-mocks`, in-process), wrapped by `functions/src/host.ts`. At most **one instance**, because the database is a single SQLite file. |

**Scheduled work has no timer.** Billing ended windows, clearing an auction
at its cutoff and the rejected-campaign retention sweep run inside `dspApi`,
at most every five minutes, triggered by ordinary requests. So an auction
whose hour passes with nobody using the demo isn't cleared by itself.

A Cloud Scheduler job would fix that, but it needs
`cloudscheduler.googleapis.com`. The deploy's service account isn't allowed
to enable that API: the first deploy failed on it. If a project owner
enables it, a scheduled function can `POST /_tasks/tick` with the
`x-tick-token` header (the `tickToken` field in the instance's stored
`instance.json`).

Both are the codebase **`dsp-api`**, deployed only by
`.github/workflows/dsp-api-deploy.yml`. The console's own functions are the
`default` codebase (`backlog-tracker/`); neither deploy touches the other's.

## Where the data lives

- **While the instance runs:** SQLite and uploaded creatives in `/tmp`.
- **Durably:** after every successful save, a consistent copy of the
  database (`VACUUM INTO`) and any new creatives go to the Firestore
  collection **`dspApiState`**. Blobs are gzip-compressed, chunked under
  Firestore's document limit, and swapped in as a whole version
  (`chunkedStore` in `host.ts`). A save isn't reported as successful until
  it has been persisted. A cold start restores from it.
- **No browser can read `dspApiState`**: `backlog-tracker/firestore.rules`
  has no rule for it, so Firestore denies it to every client, signed in or
  not. Only the functions' Admin SDK can reach it.
- **Generated on first boot** and kept there too (`instance.json`):
  - the key that encrypts DSP credentials at rest (they are mock
    credentials);
  - the Partner API bearer tokens. The public `poc-token-*` ones **don't
    work** here; to read the real tokens, look at the `blob~instance.json`
    document with the service account;
  - the token a scheduled job would present (see above).
- Mock DSP state (seats, bidder behaviour) is in memory and starts fresh on
  each cold start, as the mock service does on a restart.

## Security posture — a demo, deliberately public

This is the POC, reachable from the internet, because the prototype has to
save from a public URL (Rob's choice, 23 Sep 2026). What that means:

- **Every visitor is the stand-in HQ admin** (`POC_ROLE=hq_admin`). There is
  no login. Anyone with the URL can change the demo data. **Never put real
  data in it.**
- **Limits:**
  - 20 requests/s per IP (bursts of 60);
  - the Partner API's own per-partner limit;
  - one instance, so cost and blast radius are bounded;
  - CORS answers only GitHub Pages, githack and localhost. That stops
    another website's scripts from using it, but not a script run
    directly against the URL.
- **Reset:** run the workflow with `reset = RESET`. It deletes the saved
  database and creatives (keeping the keys and tokens), redeploys, and the
  new instance seeds the demo estate afresh.
- A real deployment replaces all of this. It needs the platform's session
  (`SessionSource`), its token issuance and its database: see
  `docs/dsp-integration/api/PH-CORE-BOUNDARIES.md`.

## Deploying

The workflow runs:

- on every push to `main` that changes the API, the mocks, the shared
  packages or this folder;
- or by hand from **Actions → "DSP integration — hosted API" → Run
  workflow**.

It uses the repository secret `FIREBASE_SERVICE_ACCOUNT_BACKLOG_TRACKER`.
The steps:

1. The API tests (the deploy stops if they fail).
2. `node deploy/firebase/build.mjs`: one ESM bundle in `functions/lib/`,
   with both migration folders copied beside it. `lib/` is built, never
   committed.
3. `firebase deploy --only functions:dsp-api` (just `dspApi`).
4. A smoke test: the API answers, CORS is right for GitHub Pages, and a save
   round-trips.

The prototype needs nothing extra: `scripts/rebuild-prototype.sh` builds it
with this URL (`VITE_API_URL`). Set `PROTOTYPE_API_URL=` (empty) to build a
snapshot-only prototype.

## Trying it locally

```bash
node deploy/firebase/build.mjs --local                 # also builds lib/local-server.mjs
node deploy/firebase/functions/lib/local-server.mjs    # http://127.0.0.1:4800
```

The same bundle and `host.ts`, with a folder standing in for Firestore
(`DSP_API_STORE`). Stop it and start it again to see a cold start restore.
To point a prototype build at it:

```bash
PROTOTYPE_API_URL=http://127.0.0.1:4800 scripts/rebuild-prototype.sh --force
```

Then serve `prototype/`, and discard the build afterwards
(`git checkout -- prototype apps/admin/public/demo`).

Tests: `apps/api/test/hosted.test.ts` covers:

- a cold-start restore;
- CORS;
- creative URLs;
- the Partner API tokens and the scheduler token;
- the rate limit;
- the chunked store.
