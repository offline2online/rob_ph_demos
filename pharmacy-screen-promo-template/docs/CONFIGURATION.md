# Configuration reference

Every setting the Pharmacy Screen reads: the admin Settings page, the deploy options, every environment
variable and every query parameter. **Nothing here is a credential except where the "Secret" column says so**,
and the one real credential, the Personalisation Hub API token, is never an environment variable: an admin
types it into Admin → Settings and it is stored envelope-encrypted ([DATA-CONTRACT.md](DATA-CONTRACT.md) →
"PH API token").

`pharmacy-screen/test/handover-docs.test.mjs` fails if an environment variable or query parameter the code
reads is missing from this file, or if this file lists one the code no longer reads. Keep the tables'
first column to one backticked name per row.

## Where settings live

| Setting | Where it is set | Applies to |
|---|---|---|
| PH API base URL(s) and the PH API token | Admin → Settings (stored server-side; the token encrypted) | Both environments |
| Deploy options (region, domain, VPC, identity provider…) | `npm run deploy:aws -- <options>` ([below](#aws-deploy-options)) | AWS |
| Function environment variables | Written by the deploy: on AWS by the CDK stack (`aws/infra/stack.js`), on Firebase from `.env.rob-ph-demos` beside each function | Both |
| Screen API servers | `<meta name="pharmacy-screen-api">` in `pharmacy-screen/pharmacy-screen.html` | Both |
| Admin editor sign-in and API location | `pharmacy-screen/admin/config.js` (written by the deploy) | Both |
| Pharmacies, promotions, templates, services | The admin editor ([USER-GUIDE.md](USER-GUIDE.md)) | Both |

`.env.example` (this folder) lists the function settings with placeholders; `pharmacy-screen/ph-proxy/.env.example`
is the proxy's own copy for running it on Firebase.

## Admin → Settings (Personalisation Hub API)

| Setting | Type | Default | Example | Secret |
|---|---|---|---|---|
| API base URL(s) | List of https URLs, at most 5, tried in order (last good one first) | `PH_API_DEFAULT_BASE_URL` (`https://ph.mipharmacy.net`) until an admin saves a list | `https://ph.mipharmacy.net`, `https://ph-backup.mipharmacy.net` | No |
| API token (`x-api-key`) | String, 8–4096 characters, no spaces | None: screens show "Screen data could not load" until one is saved | `<your PH API key>` | **Yes**: write-only, stored envelope-encrypted, only its last 4 characters are ever shown |

Saving, replacing and removing the token need the admin role and are audit-logged. Rotation takes effect within
`PH_PROXY_CACHE_SECONDS` (15 s) with no redeploy.

## Fixed behaviour (not configurable)

| Behaviour | Value | Where |
|---|---|---|
| Store data poll (Location API through the proxy) | Every 30 s, one request in flight | `pharmacy-screen/js/live-data.js` `STORE_POLL_MS` |
| Config poll (published screen config) | Every 60 s, one request in flight | `live-data.js` `CONFIG_POLL_MS` |
| Request timeout per server (screen) | 8 s | `live-data.js` |
| "Last 30 minutes" bar state | 30 minutes before close | `pharmacy-screen/js/hours.js` `LAST_MINUTES` |
| Screen update check (service worker) | Every 30 minutes, and on every page load | `pharmacy-screen/js/player.js` |
| Public config cache | 15 s (`Cache-Control: public, max-age=15`) | `config-api/src/api.js` |
| Upload limits | Logos PNG/WebP ≤ 2 MB; backgrounds PNG/JPEG/WebP ≤ 5 MB (≤ 4 MB on AWS) | `config-api/src/service.js` |

## AWS deploy options

`npm run deploy:aws -- --region <region> [options]` (`aws/infra/params.js`; `npm run deploy:aws -- --help`
prints the same list). All values are non-secret.

| Option | Type | Default | Example |
|---|---|---|---|
| `--region` | AWS region (or env `AWS_REGION`) | Required | `ap-southeast-2` |
| `--profile` | AWS named profile | Default credentials | `mipharmacy-prod` |
| `--stack-name` | Stack name and resource prefix | `PharmacyScreen` | `PharmacyScreenTest` |
| `--domain-name` | Host name for the screen and admin | The CloudFront domain | `screens.mipharmacy.net` |
| `--certificate-arn` | ACM certificate **in us-east-1** for that domain | Required with `--domain-name` | `arn:aws:acm:us-east-1:111122223333:certificate/…` |
| `--hosted-zone-id`, `--hosted-zone-name` | Route 53 zone to create the alias records in | None (point DNS yourself) | `Z0123456789`, `mipharmacy.net` |
| `--vpc-id` | Run both functions in this VPC | No VPC | `vpc-0abc…` |
| `--subnet-ids` | Comma-separated subnets | The VPC's private subnets with egress | `subnet-a,subnet-b` |
| `--security-group-ids` | Comma-separated security groups | A new one, all outbound | `sg-0abc…` |
| `--vpc-endpoints` | Flag: add S3 and DynamoDB gateway endpoints and a KMS interface endpoint | Off | |
| `--oidc-issuer`, `--oidc-client-id` | Use your own identity provider instead of a new Cognito pool | Cognito | `https://login.mipharmacy.net`, `pharmacy-screen-admin` |
| `--oidc-authorize-url`, `--oidc-token-url`, `--oidc-logout-url`, `--oidc-jwks-uri` | Provider endpoints | Read from the issuer's discovery document | |
| `--oidc-scopes` | Scopes the editor asks for | `openid email profile` | |
| `--admin-claim`, `--admin-value` | ID token claim and value that grant the admin role | `cognito:groups` = `admin` (`groups` = `admin` with `--oidc-issuer`) | `roles`, `pharmacy-screen-admin` |
| `--cognito-domain-prefix` | Cognito hosted sign-in prefix | `<stack name>-<account id>` | `mipharmacy-screens` |
| `--ph-api-base-url` | Default PH API base URL until an admin saves one | `https://ph.mipharmacy.net` | |
| `--retain-data` | Flag: keep table, media bucket, KMS key and user pool when the stack is deleted | Off (recommended on for production) | |
| `--admin-email` | Cognito only: create this admin user | None | `admin@example.com` |
| `--dry-run` | Print every step, change nothing | Off | |

The Firebase deploy (`npm run deploy`) takes `--project <id>`, `--skip-setup` and `--dry-run`.

## Environment variables

Function settings are written by the deploy; you only set them yourself to run a function somewhere else.
"Set by" says who sets each one in a normal install.

### Config API (`pharmacyScreenConfigApi` / Lambda `ConfigApi`)

| Variable | Type | Default | Example | Secret | Set by |
|---|---|---|---|---|---|
| `PS_ADMIN_CLAIM` | ID token claim name | `admin` (Firebase custom claim); `cognito:groups` on AWS | `cognito:groups` | No | `.env.rob-ph-demos`; the CDK stack (`--admin-claim`). On AWS also used by `PhApi` |
| `PS_ADMIN_VALUE` | Claim value meaning admin (AWS/OIDC only) | `admin` | `admin` | No | The CDK stack (`--admin-value`) |
| `PS_ALLOWED_ORIGINS` | Comma-separated origins allowed to call admin endpoints from a browser | None (same-origin only) | `https://screens.mipharmacy.net` | No | `.env.rob-ph-demos`; the CDK stack (the site URL). Local dev server default `http://localhost:5173,http://localhost:8080` |
| `PS_REQUIRE_PH_SESSION` | `true`: accept only editor sessions started from Personalisation Hub ([PH-EMBED.md](PH-EMBED.md)); every other sign-in gets 401 (Firebase) | `false` | `true` | No | `.env.rob-ph-demos`, together with `PH_REQUIRE_PH_SESSION` and `PS_ADMIN_AUTH=ph` |
| `PS_MEDIA_BUCKET` | Bucket for logos and backgrounds | `<project>-pharmacy-screen-media` (Firebase) | `pharmacyscreen-media-…` | No | `.env.rob-ph-demos`; the CDK stack |
| `PS_MEDIA_BASE_URL` | Public base URL media is served from (AWS) | None | `https://screens.mipharmacy.net` | No | The CDK stack (the site URL; CloudFront serves `/pharmacyScreen/media/*`) |
| `PS_FIRESTORE_ROOT` | Top-level Firestore collection (Firebase) | `pharmacyScreen` | `pharmacyScreen` | No | `.env.rob-ph-demos` |
| `PS_ROOT` | Key prefix in the DynamoDB table (AWS) | `pharmacyScreen` | `pharmacyScreen` | No | The CDK stack |
| `PS_TABLE` | DynamoDB table name (AWS) | None (required on AWS) | `PharmacyScreen-Config…` | No | The CDK stack |
| `PS_REGION` | Cloud Functions region (Firebase) | `us-central1` | `us-central1` | No | `.env.rob-ph-demos` |
| `PS_OIDC_ISSUER` | OIDC issuer URL (AWS) | None (required on AWS) | `https://cognito-idp.ap-southeast-2.amazonaws.com/ap-southeast-2_AbC…` | No | The CDK stack (Cognito, or `--oidc-issuer`); also used by `PhApi` |
| `PS_OIDC_AUDIENCE` | The admin editor's client id; ID tokens must carry it as `aud` (AWS) | None (required on AWS) | `3n4b5…` | No | The CDK stack; also used by `PhApi` |
| `PS_OIDC_JWKS_URI` | Signing keys URL (AWS) | `<issuer>/.well-known/jwks.json` from discovery | `https://…/.well-known/jwks.json` | No | The CDK stack; also used by `PhApi` |

### PH API settings and Location API proxy (`pharmacyScreenPhApi` / Lambda `PhApi`)

| Variable | Type | Default | Example | Secret | Set by |
|---|---|---|---|---|---|
| `PH_SECRET_STORE` | `gcp-kms` or `local` (Firebase; AWS always uses AWS KMS) | `gcp-kms` | `gcp-kms` | No | `.env.rob-ph-demos` |
| `PH_TOKEN_KMS_KEY` | KMS key that wraps the token's data key: Cloud KMS key name, or AWS KMS key ARN | None: saving a token answers `SECRET_STORE_NOT_CONFIGURED` | `arn:aws:kms:ap-southeast-2:111122223333:key/…` | No (a key reference; only the function's role may use the key) | `.env.rob-ph-demos`; the CDK stack |
| `PH_LOCAL_KMS_KEY` | Base64 of 32 random bytes, for `PH_SECRET_STORE=local` | None | `<base64 32 bytes>` | **Yes**. Emulators and tests only: refused on Cloud Functions/Run and Lambda | Never in a deployment |
| `PH_API_DEFAULT_BASE_URL` | Comma-separated https URLs used until an admin saves a list | `https://ph.mipharmacy.net` | `https://ph.mipharmacy.net` | No | `.env.rob-ph-demos`; the CDK stack (`--ph-api-base-url`) |
| `PH_ADMIN_CLAIM` | Firebase custom claim marking an admin (Firebase) | `admin` | `admin` | No | `.env.rob-ph-demos` (on AWS `PS_ADMIN_CLAIM` is used) |
| `PH_ALLOWED_ORIGINS` | Comma-separated origins allowed to call the settings endpoints from a browser | None | `https://screens.mipharmacy.net` | No | `.env.rob-ph-demos`; the CDK stack |
| `PH_SETTINGS_DOC` | Firestore document for the settings and encrypted token (Firebase) | `pharmacyScreen/private/settings/phApi` | | No | `.env.rob-ph-demos` |
| `PH_AUDIT_COLLECTION` | Firestore collection for the settings audit log (Firebase) | `pharmacyScreen/private/auditLog` | | No | `.env.rob-ph-demos` |
| `PH_TABLE` | DynamoDB table (AWS) | None (required on AWS) | `PharmacyScreen-Config…` | No | The CDK stack |
| `PH_ROOT` | Key prefix in that table (AWS) | `pharmacyScreen` | `pharmacyScreen` | No | The CDK stack |
| `PH_REGION` | Cloud Functions region (Firebase) | `us-central1` | `us-central1` | No | `.env.rob-ph-demos` |
| `PH_PROXY_CACHE_SECONDS` | Seconds a device's answer and the decrypted settings are reused | `15` | `15` | No | Default |
| `PH_PROXY_TIMEOUT_MS` | Timeout per PH server call, ms | `8000` | `8000` | No | Default |
| `PH_PROXY_STALE_SECONDS` | Seconds the last good answer may be served (`meta.stale`) when a rate limit trips | `600` | `600` | No | Default |
| `PH_RATE_LIMIT_PER_DEVICE_PER_MIN` | Cache misses per device per minute, per instance | `12` | `12` | No | Default |
| `PH_RATE_LIMIT_PER_IP_PER_MIN` | Cache misses per client address per minute, per instance | `600` | `600` | No | Default |
| `PH_UPSTREAM_CALLS_PER_MIN` | Calls to PH per minute, per instance | `1200` | `1200` | No | Default |
| `PH_SESSION_AUTH` | `on` or `off`: whether `POST /api/auth/ph-session` (sign-in from Personalisation Hub) exists (Firebase) | `on` | `on` | No | Default |
| `PH_REQUIRE_PH_SESSION` | `true`: the settings endpoints accept only sessions started from Personalisation Hub (Firebase) | `false` | `true` | No | `.env.rob-ph-demos`, together with `PS_REQUIRE_PH_SESSION` |
| `PH_SESSION_HQ_ROLES` | Comma-separated HQ Admin roles that open the editor as an administrator | `ADMIN` | `ADMIN,HELP_DESK` | No | Default |
| `PH_SESSION_MAX_HOURS` | Longest an editor session lasts before Personalisation Hub is asked again | `8` | `8` | No | Default |
| `PH_SESSION_RATE_LIMIT_PER_IP_PER_MIN` | Sign-in attempts per client address per minute, per instance | `30` | `30` | No | Default |
| `PH_TRUSTED_PROXY_HOPS` | `X-Forwarded-For` entries, from the right, added by our own platform | `1` (Firebase); `2` on AWS | `1` | No | `.env.rob-ph-demos`; the CDK stack |
| `PS_ORIGIN_VERIFY` | Value CloudFront adds to every API request, so the proxy trusts the viewer address only behind CloudFront (AWS) | None | `<generated>` | **Yes** (generated into Secrets Manager by the stack; never set by hand) | The CDK stack |

### Set by the platform (read, never set)

| Variable | What the code uses it for |
|---|---|
| `GCLOUD_PROJECT` | Firebase project id: default media bucket name; `set-admin-claim.js` project when `--project` is not given |
| `GOOGLE_CLOUD_PROJECT` | The same, on newer runtimes |
| `K_SERVICE` | Present on Cloud Functions/Run: the `local` secret store refuses to start |
| `AWS_LAMBDA_FUNCTION_NAME` | Present on Lambda: the `local` secret store refuses to start |

### Deploy scripts

| Variable | Type | Default | Example | Secret |
|---|---|---|---|---|
| `AWS_REGION` | Region when `--region` is not given (`deploy:aws`, `seed:aws`) | None | `ap-southeast-2` | No |
| `AWS_PROFILE` | AWS named profile (set from `--profile`) | Default credentials | `mipharmacy-prod` | No |
| `CDK_DEFAULT_ACCOUNT` | Account the CDK app deploys to (set by the CDK CLI from your credentials) | From credentials | `111122223333` | No |
| `PS_ADMIN_AUTH` | How people sign in to the editor on Firebase (`npm run deploy`): `ph` (only from Personalisation Hub), `ph+firebase` (the same, with the Firebase sign-in where the embedding page hands no session over) or `firebase` | `ph+firebase` | `ph` | No |
| `CDK_DEFAULT_REGION` | Region the CDK app deploys to (set by `deploy:aws`) | `--region` | `ap-southeast-2` | No |

### Local development and tests

| Variable | Used by | Default |
|---|---|---|
| `PORT` | `config-api` dev server (`npm run dev`) | `8787` |
| `PS_DEV_ADMIN_TOKEN` | `config-api` dev server: the access token that is an admin | `dev-admin` |
| `PS_DEV_VIEWER_TOKEN` | `config-api` dev server: a signed-in non-admin | `dev-viewer` |
| `CHROMIUM_PATH` | Browser tests and the copy-fit audit: Chromium binary | Playwright's own |
| `FIRESTORE_EMULATOR_HOST` | Seed and Firestore adapter tests: use the emulator | None |
| `PS_TEST_STORE` | `config-api/test/api.test.js`: run the API suite on another store (the AWS tests use it for DynamoDB) | In-memory store |
| `DYNAMODB_ENDPOINT` | `aws/` DynamoDB Local tests | None (those tests fail rather than pass without it) |
| `DYNAMODB_TEST_TABLE` | `aws/` DynamoDB Local tests: table name | Set by the test |

## Query parameters

### Screen page (`pharmacy-screen.html`)

The campaign URL is the same for every pharmacy and never carries a store code:

```
https://<site>/pharmacy-screen.html?device=${UniqueDeviceID}&promo=<promo id>&orientation=<portrait|landscape>
```

| Parameter | Type | Default | Example | Used in the campaign |
|---|---|---|---|---|
| `device` | Device ID, `[A-Za-z0-9._:-]`, 1–128 characters | None: "Invalid screen URL" | `${UniqueDeviceID}` (PH swaps in the screen's ID) | **Yes** |
| `promo` | A promo ID (see [DATA-CONTRACT.md](DATA-CONTRACT.md) → "Promo IDs") | The first promotion | `morning` | **Yes** |
| `orientation` | `portrait` (1080x1920) or `landscape` (1920x1080) | `portrait` | `landscape` | **Yes** |
| `mockapi` | Flag: read the fixtures (`pharmacy-screen/fixtures/`) instead of the API | Off | `mockapi=1` | No, testing only |
| `debug` | Flag: show the debug panel (device, store code, last fetches, server used, store time, bar state) with a test time override | Off | `debug=1` | No, testing only |
| `scene` | Hold on scene *n* (0-based) instead of playing the loop | Plays the loop | `scene=2` | No, testing only |
| `now` | Pretend the store's local time is this (`<day>-<HH:MM>`), for the "Open today" bar | Real time in `store_timezone` | `now=fri-18:45` | No, testing only |
| `date` | Pretend the store's date is this (`YYYY-MM-DD`, or `MM-DD` for this year), for which season the Seasonal promotion plays | Today in `store_timezone` | `date=2026-12-20` | No, testing only |
| `nosw` | Flag: don't keep the screen on the device (no service worker) | Off | `nosw=1` | No |
| `sw` | Flag: use the service worker on `localhost` too (off there by default) | Off on localhost | `sw=1` | No, local testing only |

A flag is on when present with any value except `0`, `false`, `no` or `off`.

### Admin page (`admin/`)

Typed into the editor's link to open the **pharmacy view**: the editor locked to one pharmacy
([USER-GUIDE.md](USER-GUIDE.md) → "Pharmacy view"). Example: `https://<site>/admin/?store=VIC-MP-002`.

| Parameter | Meaning |
|---|---|
| `store` | A pharmacy's store code (case and spaces ignored, like a typed store code). The editor opens locked to that pharmacy; an unknown code shows "Pharmacy not found". Without it, the full admin view |
| `storeCode` | Same as `store`; `store` wins if both are set |

Set by the identity provider when it sends a signer-in back to the editor (AWS, OIDC authorization code + PKCE);
never typed by a person.

| Parameter | Meaning |
|---|---|
| `code` | Authorization code to exchange for tokens |
| `state` | Must match the value the editor stored before redirecting, or the sign-in is refused |
| `error` | The provider refused the sign-in; the editor shows "Sign-in did not complete. Try again." |

### Config API (`/api/…`)

| Parameter | Endpoint | Meaning |
|---|---|---|
| `promo` | `GET /api/screens/{storeCode}` | Only that promotion (404 `unknown-promo` if there is none) |
| `expectedVersion` | Admin updates and deletes | The record version you edited (same as `If-Match`); a newer save answers 409 `version-conflict` |
| `limit` | `GET /api/admin/audit` | Entries to return, 1–500 (default 100), newest first |
| `entity` | `GET /api/admin/audit` | Only this entity type (`pharmacy`, `promotion`, `template`, `service`) |
| `entityId` | `GET /api/admin/audit` | Only this record |

## Screen API servers

`<meta name="pharmacy-screen-api" content="">` in `pharmacy-screen/pharmacy-screen.html`: comma-separated base
URLs, each serving both `/api/device/…` and `/api/screens/…`. Empty (the default, and what both deploys ship)
means the page's own origin, which routes `/api/*` to the functions. The screen tries the last server that
answered first, then the rest in order.

## Admin editor `config.js`

`pharmacy-screen/admin/config.js` (served to the browser, non-secret; both deploys overwrite the staged copy):

| Key | Meaning | Default |
|---|---|---|
| `apiBase` | Where `/api/**` is served | `''` (this site) |
| `screenPage` | Screen page URL that "Copy experience URL" builds on | `''` (`../pharmacy-screen.html`) |
| `auth.mode` | `ph` (the Personalisation Hub session of the page that embeds the editor, [PH-EMBED.md](PH-EMBED.md)), `firebase`, `oidc` (AWS) or `token` (local development only, never deployed) | `firebase` in the repo; the Firebase deploy writes `ph` (`PS_ADMIN_AUTH`) |
| `auth.ph` | `{parentOrigins, fallback}`: the origins allowed to hand a PH session to the editor (`https://ph.mipharmacy.net`), and `fallback: 'firebase'` to offer the Firebase sign-in when none does | Written by the Firebase deploy |
| `auth.firebase` | Firebase web app config `{apiKey, authDomain, projectId}` (public by design) | `null` in the repo, so an undeployed copy refuses to sign in |
| `auth.oidc` | `{clientId, authorizeUrl, tokenUrl, logoutUrl, logoutParam, scopes}` | Written by the AWS deploy |
