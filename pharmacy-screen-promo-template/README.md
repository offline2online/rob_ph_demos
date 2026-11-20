# Pharmacy Screen Promo Template

One templated web page that plays on in-store pharmacy screens as a Personalisation Hub campaign URL, an admin
app to configure pharmacies, promotions and templates, and the back end behind them (config API, encrypted PH
API token, Location API proxy). Requirements and the concept README are on the board (project "Pharmacy Screen
Promo Template").

| Folder | What it is |
|---|---|
| `pharmacy-screen/` | The screen page and its render modules ([README](pharmacy-screen/README.md)) |
| `pharmacy-screen/admin/` | The admin app: Google sign-in, admin role required, Settings |
| `pharmacy-screen/config-api/` | Config API and store, Cloud Function `pharmacyScreenConfigApi` ([README](pharmacy-screen/config-api/README.md)) |
| `pharmacy-screen/ph-proxy/` | PH API token settings and Location API proxy, Cloud Function `pharmacyScreenPhApi` ([README](pharmacy-screen/ph-proxy/README.md)) |
| `pharmacy-screen/seed/` | Launch data and the script that loads it ([README](pharmacy-screen/seed/README.md)); not published |
| `firebase.json`, `.firebaserc`, `firestore.indexes.json` | Firebase deploy config for our test environment. The Firestore rules are the repo-root `firestore.rules` (rob-ph-demos has one ruleset); the deploy stages a copy in `.deploy/` because the Firebase CLI reads rules only from inside this folder |
| `scripts/deploy.mjs` | The one-command deploy |
| `ci/deploy-pharmacy-screen.yml` | GitHub Actions workflow to install (see "Continuous deploy") |
| `test/` | Deploy config checks |

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
| Screen and admin pages | Hosting site `rob-ph-demos-pharmacy-screen` (HTTPS) | Static files from `pharmacy-screen/`; server code, tests and env files are never published |
| Config store | Firestore `pharmacyScreen/` | Rules (repo-root `firestore.rules`): no client writes anywhere; public reads only of `pharmacyScreen/published/screens/*`; settings and token documents (`pharmacyScreen/private/**`) unreadable |
| Logos and backgrounds | Bucket `rob-ph-demos-pharmacy-screen-media` | Its own bucket, so its rules (`config-api/rules/storage.rules`) never replace the default bucket's (the menu-board demo's) |
| PH API token | Firestore `pharmacyScreen/private/settings/phApi`, envelope-encrypted | Data key wrapped by Cloud KMS `projects/rob-ph-demos/locations/global/keyRings/pharmacy-screen/cryptoKeys/ph-api-token` (90-day rotation); decrypted only inside `pharmacyScreenPhApi` |
| Admin sign-in | Firebase Auth (Google), custom claim `admin` | Both APIs refuse a signed-in account without the claim (403) |
| PH API base URL | `https://ph.mipharmacy.net` (default, non-secret) | Changed in Admin → Settings |

Function settings are non-secret and live beside each function in `.env.rob-ph-demos` (the Firebase CLI loads
them for this project). Everything a back end needs from the cloud goes through small adapters (store, blobs,
auth, secret store; see each function's README), so an AWS deployment for miPharmacy adds adapters and an
entry point without changing the API.

## Deploy (one command)

From a clean checkout, with Node 20+, the Google Cloud CLI signed in as a project owner (`gcloud auth login`
and `gcloud auth application-default login`) and the Firebase CLI signed in (`npx firebase-tools login`):

```bash
cd pharmacy-screen-promo-template
npm run deploy
```

It installs the functions' dependencies, sets up the one-time infrastructure if it is missing (Google APIs,
the Hosting site, the media bucket linked to Firebase Storage, the KMS key ring and key and the functions'
right to use that key only, the site's domains as Auth authorized domains, an image cleanup policy), then
deploys Hosting, both functions, the Firestore rules and indexes and the media bucket's Storage rules in one
`firebase deploy`, and prints the URLs above. Every setup step checks first, so running it again is safe.

- `npm run deploy:plan` prints every command without running anything.
- `npm run deploy -- --skip-setup` deploys only (what CI runs).
- `npm run deploy -- --project <id>` deploys to another Firebase project that has targets in `.firebaserc`.

After the first deploy:

1. Turn on Google sign-in once if it is off: Firebase console → Authentication → Sign-in method → Google
   (the deploy warns when it is).
2. Sign in at the admin URL once (it shows "No admin access"), then grant yourself the admin role:
   `cd pharmacy-screen/config-api && npm install && node scripts/set-admin-claim.js --project rob-ph-demos --email <your sign-in address>`.
   Sign out and in again to pick it up.
3. Admin → Settings: enter the PH API token. It is write-only; only its last 4 characters are shown.
4. Load the launch data (five pharmacies, default promotions, service library) once:
   `node pharmacy-screen/seed/seed.js --project rob-ph-demos` (see `pharmacy-screen/seed/README.md`).

## Continuous deploy

`ci/deploy-pharmacy-screen.yml` runs the tests and `npm run deploy -- --skip-setup` on every push to the
deployment train (`deploy/pharmacy-screen-promo-template`, so the test environment shows what is in testing)
and to `main`. The board's pipeline never adds a new workflow file, so a person installs it once:

1. Copy it to `.github/workflows/deploy-pharmacy-screen.yml` on `main`.
2. Add the repository secret `FIREBASE_SERVICE_ACCOUNT_ROB_PH_DEMOS`: a JSON key for a rob-ph-demos service
   account with the Firebase Admin, Cloud Functions Admin, Service Account User and Cloud Build Editor roles.

Until then, deploy with the command above; Cloud Functions are always deployed by that command or CI, never by
hand.

## Tests

```bash
cd pharmacy-screen-promo-template
npm run check          # deploy config, staging allow-list, plan, URLs (offline)
npm run check:all      # plus the screen, config API, PH API proxy and seed unit tests
npm run check:admin    # admin sign-in gate and Settings in headless Chromium (Playwright)
cd pharmacy-screen/config-api && npm install && npm run test:emulator   # Firestore + Storage rules (needs Java)
```

These are `check` scripts, not `test`: the console requires a train test workflow for any top-level folder
with a `test` script, and only a person can add one. The CI workflow above runs `check:all` before every deploy.
