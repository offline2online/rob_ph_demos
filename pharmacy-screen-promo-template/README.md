# Pharmacy Screen Promo Template

One templated web page that plays on in-store pharmacy screens as a Personalisation Hub campaign URL, an admin
app to configure pharmacies, promotions and templates, and the back end behind them (config API, encrypted PH
API token, Location API proxy). Requirements and the concept README are on the board (project "Pharmacy Screen
Promo Template").

## Handover package

New here? **[START-HERE.md](START-HERE.md)** is one page: deploy to AWS in one command, connect PH, test.

| Document | For |
|---|---|
| [START-HERE.md](START-HERE.md) | The one-page quick start |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Architecture, prerequisites, install, PH token and rotation, registering screens and the campaign URL, upgrade, rollback, uninstall |
| [docs/CONFIGURATION.md](docs/CONFIGURATION.md) + [.env.example](.env.example) | Every setting, deploy option, environment variable and query parameter |
| [docs/DATA-CONTRACT.md](docs/DATA-CONTRACT.md) | The Location API request and fields used, a full sample, promo IDs, template tokens, config schema, error states |
| [docs/TEST-CHECKLIST.md](docs/TEST-CHECKLIST.md) | Our environment first, then miPharmacy sign-off |
| [docs/USER-GUIDE.md](docs/USER-GUIDE.md) | The admin editor: pharmacies, branding, promotions, service library, copy and timings, templates |
| [AGENTS.md](AGENTS.md), [CLAUDE.md](CLAUDE.md) | Instructions for coding and deployment agents |
| [CHANGELOG.md](CHANGELOG.md) | What changed, per release |
| [docs/RELEASING.md](docs/RELEASING.md) | The release package for the Google Shared Drive: `npm run release`, what is in it, sharing it |

Mock data for running with no PH instance is in `pharmacy-screen/fixtures/` (`mockapi=1`) and the seed in
`pharmacy-screen/seed/`. `npm run check:docs` (part of `check:all`) fails when an environment variable or query
parameter in the code is missing from `docs/CONFIGURATION.md`, or the other way round.

Quick start (AWS):

```bash
cd pharmacy-screen-promo-template
npm run deploy:aws -- --region ap-southeast-2 --admin-email <your sign-in address>
```

| Folder | What it is |
|---|---|
| `pharmacy-screen/` | The screen page and its render modules ([README](pharmacy-screen/README.md)) |
| `pharmacy-screen/admin/` | The admin editor: pharmacies, promotions, templates and PH API Settings; sign-in from Personalisation Hub, as an administrator or as a store user for one's own pharmacy ([docs/PH-EMBED.md](docs/PH-EMBED.md), [README](pharmacy-screen/admin/README.md)) |
| `pharmacy-screen/config-api/` | Config API and store, Cloud Function `pharmacyScreenConfigApi` ([README](pharmacy-screen/config-api/README.md)) |
| `pharmacy-screen/ph-proxy/` | PH API token settings and Location API proxy, Cloud Function `pharmacyScreenPhApi` ([README](pharmacy-screen/ph-proxy/README.md)) |
| `pharmacy-screen/seed/` | Launch data and the script that loads it ([README](pharmacy-screen/seed/README.md)); not published |
| `firebase.json`, `.firebaserc`, `firestore.indexes.json` | Firebase deploy config for our test environment. The Firestore rules are the repo-root `firestore.rules` (rob-ph-demos has one ruleset); the deploy stages a copy in `.deploy/` because the Firebase CLI reads rules only from inside this folder |
| `scripts/deploy.mjs` | The one-command deploy |
| `scripts/release.mjs` | The release package: versioned zip, checksum, release notes and tag (`npm run release`, [docs/RELEASING.md](docs/RELEASING.md)); writes `release/` (not committed) |
| `ci/deploy-pharmacy-screen.yml` | GitHub Actions workflow to install (see "Continuous deploy") |
| `test/` | Deploy config checks and the deployed admin sign-in gate (`test/ui/admin-gate.test.mjs`) |
| `aws/` | The deployment target for the retailer's own AWS account: AWS adapters, Lambda entries, CDK stack, one-command install and teardown ([README](aws/README.md)) |
| `docs/`, `START-HERE.md`, `AGENTS.md`, `CLAUDE.md`, `.env.example`, `CHANGELOG.md` | The handover package (above); not published |

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
| `/api/health`, `/api/screens/**`, `/api/csp-report`, `/api/admin/**` | `pharmacyScreenConfigApi` (config API) |

Both functions are Cloud Functions (2nd gen) in `australia-southeast1` (Sydney, next to the stores; they ran in
`us-central1` until 23 Nov 2026; the old copies are gone and the deploy never deletes a function), also reachable directly at
`https://australia-southeast1-rob-ph-demos.cloudfunctions.net/pharmacyScreenConfigApi` and `…/pharmacyScreenPhApi`.
Neither keeps an instance warm (`PS_MIN_INSTANCES` / `PH_MIN_INSTANCES`, default 0), so the first request after a
quiet spell has a cold start; keeping one warm is a monthly cost and the owner's decision
([docs/CONFIGURATION.md](docs/CONFIGURATION.md)).

The screen page and the editor are sent a `Content-Security-Policy-Report-Only` header (`aws/infra/csp.js`, the
same in `firebase.json`); violations are reported to `/api/csp-report` and logged by the config API
([docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) → "Content-Security-Policy").

What runs where:

| Part | Where | Notes |
|---|---|---|
| Screen and admin pages | Hosting site `rob-ph-demos-pharmacy-screen` (HTTPS) | Static files from `pharmacy-screen/` by allow-list (the screen and its service worker `sw.js`, `admin/`, and `seed/fixtures/` for the editor's Reset); server code, tests, tools, package files and env files are never published. The screen is kept on each player by `sw.js`, and after a deploy each player downloads only the files that changed (`pharmacy-screen/README.md` → "Kept on the device"). Fingerprinted `assets/` are served `Cache-Control: public, max-age=31536000, immutable`; the page, `sw.js` and everything else `no-cache` (`firebase.json`) |
| Config store | Firestore `pharmacyScreen/` | Rules (repo-root `firestore.rules`): no client writes anywhere; public reads only of `pharmacyScreen/published/screens/*`; settings and token documents (`pharmacyScreen/private/**`) unreadable |
| Logos and backgrounds | Bucket `rob-ph-demos-pharmacy-screen-media` | Its own bucket, so its rules (`config-api/rules/storage.rules`) never replace the default bucket's (the menu-board demo's) |
| PH API token | Firestore `pharmacyScreen/private/settings/phApi`, envelope-encrypted | Data key wrapped by Cloud KMS `projects/rob-ph-demos/locations/global/keyRings/pharmacy-screen/cryptoKeys/ph-api-token` (90-day rotation); decrypted only inside `pharmacyScreenPhApi` |
| Admin sign-in | From Personalisation Hub ([docs/PH-EMBED.md](docs/PH-EMBED.md)): the HQ Admin or Retail Admin page that embeds the editor hands over its session, and the server checks it with PH (`POST /api/auth/ph-session`) | No sign-in of its own. An HQ Admin session with role `ADMIN` is an administrator (everything); a Retail Admin session is a store user for its own store (the pharmacy view only, held to that store on the server); anything else, or the editor opened outside PH, shows "Access denied". The editor can be framed only by PH. `PS_ADMIN_AUTH` at deploy time chooses `ph`, `ph+firebase` (the changeover default) or `firebase` ([docs/CONFIGURATION.md](docs/CONFIGURATION.md) → `PS_ADMIN_AUTH`, `PS_REQUIRE_PH_SESSION`). The Firebase sign-in is the fallback while `PS_ADMIN_AUTH=ph+firebase`: Firebase Auth (Google, or email and password), custom claim `admin`; both APIs refuse a signed-in account without the claim (403). The editor fails closed: it shows only after `/api/admin/me` returns 200; a sign-in that can't load, an account with no role or a server error shows a blocked message instead. The deploy writes the Firebase web app config (web app "Pharmacy Screen admin", created on the first deploy) into the published `admin/config.js`; the committed one has none, so an unstaged copy refuses to sign in |
| PH API base URL | `https://ph.mipharmacy.net` (default, non-secret) | Changed in Admin → Settings |

Function settings are non-secret and live beside each function in `.env.rob-ph-demos` (the Firebase CLI loads
them for this project). Everything a back end needs from the cloud goes through small adapters (store, blobs,
auth, secret store; see each function's README), so the AWS deployment below adds adapters and an entry point
without changing the API.

The screen polls its store data (the Location API through `/api/device/…`) every 20 s and its published config
(`/api/screens/{store_code}`) every 15 s (a `304` with no body while nothing changed), one request in flight per endpoint, re-rendering only on change
(`pharmacy-screen/README.md` → "How the screen gets its data (live)").

## Security

The same code runs in both environments; only the adapters behind it differ.

| | Our test environment (`rob-ph-demos`) | miPharmacy's environment |
|---|---|---|
| PH API token at rest | Envelope-encrypted (AES-256-GCM data key) in Firestore `pharmacyScreen/private/settings/phApi`, the data key wrapped by Cloud KMS key `ph-api-token` | The same envelope (AES-256-GCM data key) in DynamoDB item `pharmacyScreen#private`, the data key wrapped by a customer-managed AWS KMS key (90-day rotation, encryption context = the envelope's AAD), in the retailer's AWS account; the Lambdas can run inside their VPC (`aws/README.md`). AWS Secrets Manager holds only CloudFront's origin header, not the token |
| Who can decrypt | Only `pharmacyScreenPhApi`; the key can be used only by the functions' service account | Only the proxy, by its IAM role |
| Admin sign-in | The Personalisation Hub session of the person looking at the editor, checked by the server with PH: administrator or store user ([docs/PH-EMBED.md](docs/PH-EMBED.md)) | Cognito or miPharmacy's identity provider (OIDC), same admin role check; sign-in from Personalisation Hub is not wired there yet |

In both, the token is write-only in Admin → Settings (only its last 4 characters are shown), never in plain text,
browser storage or page source, and never sent to a screen: the proxy adds `x-api-key` to Location API calls
itself. Saving, replacing and removing it need the admin role and are audit-logged. The adapters are described in
`pharmacy-screen/ph-proxy/README.md` ("How the token is protected", and "Deploying to miPharmacy's AWS
environment"), `pharmacy-screen/config-api/README.md` ("Adapters") and `aws/README.md` (the AWS deployment).

## Deploy (one command)

From a clean checkout, with Node 20+, the Google Cloud CLI signed in as a project owner (`gcloud auth login`
and `gcloud auth application-default login`) and the Firebase CLI signed in (`npx firebase-tools login`):

```bash
cd pharmacy-screen-promo-template
npm run deploy
```

It installs the functions' dependencies, sets up the one-time infrastructure if it is missing (Google APIs,
the Hosting site, the media bucket linked to Firebase Storage, the KMS key ring and key and the functions'
right to use that key only, the site's domains as Auth authorized domains, the function images' cleanup policy),
writes the admin editor's Firebase web app config into the staged `admin/config.js` (creating the web app on the
first run; this step runs with `--skip-setup` too), then deploys both functions on their own, then Hosting, the
Firestore rules and indexes and the media bucket's Storage rules, checks that the site's API answers through
Hosting, and prints the URLs above. A functions error stops the deploy before Hosting (so the site keeps the
functions it had), except the "could not set up cleanup policy" message, which is passed with a warning; an API
that does not answer afterwards fails the deploy. Every setup step checks first or is idempotent, so running it
again is safe.

- `npm run deploy:plan` prints every command without running anything.
- `npm run deploy -- --skip-setup` deploys only (what CI runs).
- `npm run deploy -- --project <id>` deploys to another Firebase project that has targets in `.firebaserc`.

After the first deploy:

1. Sign-in is from Personalisation Hub ([docs/PH-EMBED.md](docs/PH-EMBED.md)): give the functions' service
   account `roles/iam.serviceAccountTokenCreator` on itself once, and have the HQ Admin (Pharmacy Promos) and
   Retail Admin (Display Promotions) pages hand their session to the editor ("What PH's iframe pages must do").
   An HQ Admin user with role `ADMIN` is then an administrator, and a Retail Admin user is a store user for
   their own store; there is no role to grant by hand.
2. The Firebase sign-in is the fallback while `PS_ADMIN_AUTH=ph+firebase`, for opening the editor where the PH page hands no session over: turn on Google sign-in once if it is off (Firebase console → Authentication → Sign-in method → Google; the deploy warns when it is), sign in at the admin URL once (it shows "Admin role required"), grant yourself the admin role with `cd pharmacy-screen/config-api && npm install && node scripts/set-admin-claim.js --project rob-ph-demos --email <your sign-in address>`, then sign out and in again to pick it up.
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

Those roles do not include setting the function images' Artifact Registry cleanup policy, so CI skips it (it is a
setup step). **The project owner runs this once** (it is per region; again after any move to a new region):

```bash
npx firebase-tools@14.27.0 functions:artifacts:setpolicy --location australia-southeast1 --days 7 --force --project rob-ph-demos
```

`npm run deploy` without `--skip-setup` runs the same command. Until it has run, CI's "Deploy the functions" step
ends in "Functions successfully deployed but could not set up cleanup policy"; the deploy passes that one message
with a warning and carries on, and stops before Hosting on any other functions error. Granting `pharmacy-screen-ci`
Artifact Registry Administrator (`roles/artifactregistry.admin`) would let it set the policy itself, but that role is
broader than a deploy account needs, so the one-time owner command is the way
([docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) → "Image cleanup policy").

Cloud Functions are always deployed by the command above or CI, never by hand. The deploy never deletes a
function; moving them to another region follows [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) → "Moving the functions to
another region".

## miPharmacy's environment (AWS)

miPharmacy deploys the same build into their own AWS account, next to their Personalisation Hub instance:
CloudFront and S3 for the pages, API Gateway and Lambda (optionally in their VPC) for the two back ends,
DynamoDB for the config, S3 for media, a KMS key wrapping the PH API token's data key, and Cognito or their own
OIDC provider for admin sign-in. One command each, parameterised for account (credentials), region, VPC and
domain:

```bash
npm run deploy:aws  -- --region ap-southeast-2 [--domain-name … --certificate-arn …] [--vpc-id …] [--oidc-issuer …]
npm run destroy:aws -- --region ap-southeast-2
```

Everything about it (options, first-run steps, the test checklist on AWS, limits) is in [aws/README.md](aws/README.md).

## Tests

```bash
cd pharmacy-screen-promo-template
npm run check          # deploy config, staging allow-list, plan, URLs (offline)
npm run check:all      # plus the screen, config API, PH API proxy and seed unit tests, and the handover docs check
npm run check:docs     # the handover docs check alone: env vars and query parameters in code = docs/CONFIGURATION.md
npm run check:admin    # the deployed admin sign-in gate, then the editor's end-to-end tests (Playwright + Chromium)
npm run release -- --dry-run   # build and scan the release package without writing it (docs/RELEASING.md)
npm run check:aws      # the AWS target: adapters, Lambda entries, CDK template, deploy plan, OIDC sign-in (aws/README.md)
cd pharmacy-screen/config-api && npm install && npm run test:emulator   # Firestore + Storage rules (needs Java)
```

These are `check` scripts, not `test`: the console requires a train test workflow for any top-level folder
with a `test` script, and only a person can add one. The CI workflow above runs `check:all` before every deploy.
