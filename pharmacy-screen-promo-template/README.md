# Pharmacy Screen Promo Template

One templated web page that plays on in-store pharmacy screens as a Personalisation Hub campaign URL, an admin
app to configure pharmacies, promotions and templates, and the back end behind them (config API, encrypted PH
API token, Location API proxy). Requirements and the concept README are on the board (project "Pharmacy Screen
Promo Template").

| Folder | What it is |
|---|---|
| `pharmacy-screen/` | The screen page and its render modules ([README](pharmacy-screen/README.md)) |
| `pharmacy-screen/admin/` | The admin editor: pharmacies, promotions, templates and PH API Settings; Firebase sign-in, admin role required ([README](pharmacy-screen/admin/README.md)) |
| `pharmacy-screen/config-api/` | Config API and store, Cloud Function `pharmacyScreenConfigApi` ([README](pharmacy-screen/config-api/README.md)) |
| `pharmacy-screen/ph-proxy/` | PH API token settings and Location API proxy, Cloud Function `pharmacyScreenPhApi` ([README](pharmacy-screen/ph-proxy/README.md)) |
| `pharmacy-screen/seed/` | Launch data and the script that loads it ([README](pharmacy-screen/seed/README.md)); not published |
| `firebase.json`, `.firebaserc`, `firestore.indexes.json` | Firebase deploy config for our test environment. The Firestore rules are the repo-root `firestore.rules` (rob-ph-demos has one ruleset); the deploy stages a copy in `.deploy/` because the Firebase CLI reads rules only from inside this folder |
| `scripts/deploy.mjs` | The one-command deploy |
| `ci/deploy-pharmacy-screen.yml` | GitHub Actions workflow to install (see "Continuous deploy") |
| `test/` | Deploy config checks and the deployed admin sign-in gate (`test/ui/admin-gate.test.mjs`) |

## Our test environment (Firebase project `rob-ph-demos`)

| | URL |
|---|---|
| Screen | https://rob-ph-demos-pharmacy-screen.web.app/pharmacy-screen.html?device=TEST&promo=morning&orientation=portrait&mockapi=1 |
| Admin | https://rob-ph-demos-pharmacy-screen.web.app/admin/ |
| API | https://rob-ph-demos-pharmacy-screen.web.app/api (health check: `/api/health`) |

The site root redirects to the admin app. The API is served through the same Hosting site, which rewrites:

| Path | Function |
|---|---|
| `/api/settings/ph-api`, `/api/settings/ph-api/**`, `/api/device/**` | `pharmacyScreenPhApi` (PH API settings, Location API proxy) |
| `/api/health`, `/api/screens/**`, `/api/admin/**` | `pharmacyScreenConfigApi` (config API) |

Both functions are Cloud Functions (2nd gen) in `us-central1`, also reachable directly at
`https://us-central1-rob-ph-demos.cloudfunctions.net/pharmacyScreenConfigApi` and `…/pharmacyScreenPhApi`.

What runs where:

| Part | Where | Notes |
|---|---|---|
| Screen and admin pages | Hosting site `rob-ph-demos-pharmacy-screen` (HTTPS) | Static files from `pharmacy-screen/` by allow-list (the screen and its service worker `sw.js`, `admin/`, and `seed/fixtures/` for the editor's Reset); server code, tests, tools, package files and env files are never published. The screen is kept on each player by `sw.js` and downloaded again only when a deploy changes it (`pharmacy-screen/README.md` → "Kept on the device") |
| Config store | Firestore `pharmacyScreen/` | Rules (repo-root `firestore.rules`): no client writes anywhere; public reads only of `pharmacyScreen/published/screens/*`; settings and token documents (`pharmacyScreen/private/**`) unreadable |
| Logos and backgrounds | Bucket `rob-ph-demos-pharmacy-screen-media` | Its own bucket, so its rules (`config-api/rules/storage.rules`) never replace the default bucket's (the menu-board demo's) |
| PH API token | Firestore `pharmacyScreen/private/settings/phApi`, envelope-encrypted | Data key wrapped by Cloud KMS `projects/rob-ph-demos/locations/global/keyRings/pharmacy-screen/cryptoKeys/ph-api-token` (90-day rotation); decrypted only inside `pharmacyScreenPhApi` |
| Admin sign-in | Firebase Auth (Google, or email and password), custom claim `admin` | Both APIs refuse a signed-in account without the claim (403). The editor fails closed: it shows only after `/api/admin/me` returns 200; a sign-in that can't load, a non-admin or a server error shows a blocked message instead. The deploy writes the Firebase web app config (web app "Pharmacy Screen admin", created on the first deploy) into the published `admin/config.js`; the committed one has none, so an unstaged copy refuses to sign in |
| PH API base URL | `https://ph.mipharmacy.net` (default, non-secret) | Changed in Admin → Settings |

Function settings are non-secret and live beside each function in `.env.rob-ph-demos` (the Firebase CLI loads
them for this project). Everything a back end needs from the cloud goes through small adapters (store, blobs,
auth, secret store; see each function's README), so an AWS deployment for miPharmacy adds adapters and an
entry point without changing the API.

The screen polls its store data (the Location API through `/api/device/…`) every 30 s and its published config
(`/api/screens/{store_code}`) every 60 s, one request in flight per endpoint, re-rendering only on change
(`pharmacy-screen/README.md` → "How the screen gets its data (live)").

## Security

The same code runs in both environments; only the adapters behind it differ.

| | Our test environment (`rob-ph-demos`) | miPharmacy's environment |
|---|---|---|
| PH API token at rest | Envelope-encrypted (AES-256-GCM data key) in Firestore `pharmacyScreen/private/settings/phApi`, the data key wrapped by Cloud KMS key `ph-api-token` | The same envelope with the data key wrapped by AWS KMS, or the token held in AWS Secrets Manager, inside the retailer's VPC (target not built yet) |
| Who can decrypt | Only `pharmacyScreenPhApi`; the key can be used only by the functions' service account | Only the proxy, by its IAM role |
| Admin sign-in | Firebase Auth, custom claim `admin` | Cognito or miPharmacy's identity provider (OIDC), same admin role check |

In both, the token is write-only in Admin → Settings (only its last 4 characters are shown), never in plain text,
browser storage or page source, and never sent to a screen: the proxy adds `x-api-key` to Location API calls
itself. Saving, replacing and removing it need the admin role and are audit-logged. The adapters are described in
`pharmacy-screen/ph-proxy/README.md` ("How the token is protected", and the AWS note at the end of "Deploying to
our test environment") and `pharmacy-screen/config-api/README.md` ("Adapters").

## Deploy (one command)

From a clean checkout, with Node 20+, the Google Cloud CLI signed in as a project owner (`gcloud auth login`
and `gcloud auth application-default login`) and the Firebase CLI signed in (`npx firebase-tools login`):

```bash
cd pharmacy-screen-promo-template
npm run deploy
```

It installs the functions' dependencies, sets up the one-time infrastructure if it is missing (Google APIs,
the Hosting site, the media bucket linked to Firebase Storage, the KMS key ring and key and the functions'
right to use that key only, the site's domains as Auth authorized domains, an image cleanup policy), writes the
admin editor's Firebase web app config into the staged `admin/config.js` (creating the web app on the first
run; this step runs with `--skip-setup` too), then deploys Hosting, both functions, the Firestore rules and indexes and the media bucket's Storage rules in one
`firebase deploy`, and prints the URLs above. Every setup step checks first, so running it again is safe.

- `npm run deploy:plan` prints every command without running anything.
- `npm run deploy -- --skip-setup` deploys only (what CI runs).
- `npm run deploy -- --project <id>` deploys to another Firebase project that has targets in `.firebaserc`.

After the first deploy:

1. Turn on Google sign-in once if it is off: Firebase console → Authentication → Sign-in method → Google
   (the deploy warns when it is).
2. Sign in at the admin URL once (it shows "Admin role required"), then grant yourself the admin role:
   `cd pharmacy-screen/config-api && npm install && node scripts/set-admin-claim.js --project rob-ph-demos --email <your sign-in address>`.
   Sign out and in again to pick it up.
3. Admin → Settings: enter the PH API token. It is write-only; only its last 4 characters are shown.
4. Load the launch data (five pharmacies, default promotions, service library) once:
   `node pharmacy-screen/seed/seed.js --project rob-ph-demos` (see `pharmacy-screen/seed/README.md`).

## Continuous deploy

`.github/workflows/deploy-pharmacy-screen.yml` (installed 20 Nov 2026 from `ci/deploy-pharmacy-screen.yml`; keep
the two identical) runs the tests and `npm run deploy -- --skip-setup` on `main`: on a push touching this folder,
`firestore.rules` or the workflow, and after a train merge that touches them, which
`backlog-tracker/scripts/run-backlog-automation.js` dispatches (`HOSTED_DEPLOYS`; a merge made with the
automation's token never fires a push trigger). It does not deploy the train branch, so the test environment
shows `main`, not what is in testing. It signs in with the repository secret `FIREBASE_SERVICE_ACCOUNT_ROB_PH_DEMOS`,
a key for the rob-ph-demos service account `pharmacy-screen-ci` with the Firebase Admin, Cloud Functions Admin,
Service Account User and Cloud Build Editor roles.

Cloud Functions are always deployed by the command above or CI, never by hand.

## Tests

```bash
cd pharmacy-screen-promo-template
npm run check          # deploy config, staging allow-list, plan, URLs (offline)
npm run check:all      # plus the screen, config API, PH API proxy and seed unit tests
npm run check:admin    # the deployed admin sign-in gate, then the editor's end-to-end tests (Playwright + Chromium)
cd pharmacy-screen/config-api && npm install && npm run test:emulator   # Firestore + Storage rules (needs Java)
```

These are `check` scripts, not `test`: the console requires a train test workflow for any top-level folder
with a `test` script, and only a person can add one. The CI workflow above runs `check:all` before every deploy.
