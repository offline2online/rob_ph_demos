# Pharmacy Screen — AWS deployment (the retailer's environment)

Our test environment is Firebase (`rob-ph-demos`, see [../README.md](../README.md)). miPharmacy runs the same
build in **their own AWS account**, next to their Personalisation Hub instance (`https://ph.mipharmacy.net`).
This folder is that deployment target: AWS adapters for the two back ends, a Lambda entry for each, and the
infrastructure as one CDK stack, installed and removed with one command each.

Nothing in the screen, the admin editor or the APIs changes between the two: the back ends take their cloud
through small adapters (store, blobs, auth, secret store), and this folder supplies the AWS ones.

## What gets deployed

| Part | AWS | Notes |
|---|---|---|
| Screen and admin pages | S3 (private) behind **CloudFront**, one HTTPS domain | Same allow-listed files as the Firebase deploy. The screen's fingerprinted `assets/` are uploaded first with `Cache-Control: public, max-age=31536000, immutable` and never pruned (a player on the previous page can finish loading it); everything else is `no-cache`. `/` redirects to `/admin/`. HSTS, `nosniff`, `Referrer-Policy: same-origin`. No `X-Frame-Options`: the editor is iframed into HQ Admin |
| API | **API Gateway** (HTTP API) → two **Lambda** functions (Node 24, arm64), optionally inside your VPC | `/api/health`, `/api/screens/**`, `/api/admin/**` → `ConfigApi`; `/api/settings/ph-api[/**]`, `/api/device/**` → `PhApi`. CloudFront routes `/api/*` to it on the same domain; `/api/screens/*` is cached up to 60 s as the API says (5 s) |
| Config store | **DynamoDB** (on-demand, point-in-time recovery) | Pharmacies, promotions, templates, services, the audit log and the published screen configs, in one table (`pk`, `sk`). Transactions are serialisable, so store codes and promo IDs stay unique under concurrent edits (`adapters/dynamodb-store.js`) |
| Logos and backgrounds | **S3** media bucket (private), served by CloudFront at `/pharmacyScreen/media/*` | Only `ConfigApi` may write it |
| PH API token | DynamoDB, **KMS envelope-encrypted** | A fresh AES-256-GCM data key encrypts the token; a customer-managed **KMS key** (90-day rotation) wraps the data key, with an encryption context. Only `PhApi` may use the key, and only `PhApi` ever decrypts, in memory. Write-only in the editor (last 4 shown). See `../pharmacy-screen/ph-proxy/README.md` |
| Admin sign-in | **Cognito** user pool with group `admin` (default), or **your own OIDC provider** | The editor signs in with authorization code + PKCE and sends the ID token; both APIs verify it against the issuer's keys and require the admin claim (`adapters/oidc-auth.js`) |
| Origin header | **Secrets Manager** | A generated value CloudFront adds to every API request, so `PhApi` trusts the viewer address for its rate limits only on requests that came through CloudFront |

## Before you start

- Node 20 or later, and AWS credentials for the target account (`aws sso login`, a named profile, or env vars)
  with rights to create these resources (AdministratorAccess on a fresh account).
- For a custom domain: an ACM certificate for it **in us-east-1** (CloudFront only uses those).
- No Docker, no AWS CLI and no global CDK install needed: the deploy installs the CDK into `aws/node_modules`.

## Deploy (one command)

From a clean checkout:

```bash
cd pharmacy-screen-promo-template
npm run deploy:aws -- --region ap-southeast-2 --admin-email <your sign-in address>
```

It installs the CDK and SDK (`npm ci` in `aws/`), stages the site and the function code in `.deploy-aws/`,
bootstraps CDK in the account and region if needed, deploys the stack, creates that admin user in Cognito
(Cognito emails a temporary password) and prints the URLs:

```
  Admin      https://dxxxx.cloudfront.net/admin/
  Screen     https://dxxxx.cloudfront.net/pharmacy-screen.html?device=TEST&promo=morning&orientation=portrait&mockapi=1
  Campaign   https://dxxxx.cloudfront.net/pharmacy-screen.html?device=${UniqueDeviceID}&promo=morning&orientation=portrait
  API        https://dxxxx.cloudfront.net/api   (health: …/api/health)
```

All outputs are saved to `.deploy-aws/<stack>.outputs.json`. Running it again updates the stack in place.
`npm run plan:aws -- --region …` prints every step without running anything.

### Options

| Option | |
|---|---|
| `--region <region>` | Required (or `AWS_REGION`) |
| `--profile <name>` | AWS named profile |
| `--stack-name <name>` | Stack name and resource prefix (default `PharmacyScreen`); use different names for test and production in one account |
| `--domain-name <host> --certificate-arn <arn>` | Serve on your domain. Add `--hosted-zone-id <id> --hosted-zone-name <zone>` to create the Route 53 alias records; otherwise point the domain at the printed CloudFront domain yourself |
| `--vpc-id <id> [--subnet-ids a,b] [--security-group-ids sg]` | Run both functions inside your VPC (default subnets: its private subnets with egress). `PhApi` must reach your PH API (`ph.mipharmacy.net`) from there: through NAT, or directly if PH is inside the network |
| `--vpc-endpoints` | Also add S3 and DynamoDB gateway endpoints and a KMS interface endpoint to that VPC (skip if it already has them or uses NAT for AWS APIs) |
| `--oidc-issuer <url> --oidc-client-id <id>` | Use your own identity provider instead of creating a Cognito pool. Its endpoints are read from the issuer's discovery document. The client must be a public client (no secret) allowing authorization code + PKCE, with `https://<site>/admin/` as redirect and post-logout URI |
| `--admin-claim <claim> --admin-value <value>` | The ID token claim that grants the admin role (default `cognito:groups` = `admin`; with `--oidc-issuer`, `groups` = `admin`) |
| `--ph-api-base-url <url>` | Default Personalisation Hub API base URL until an admin saves one in Settings (default `https://ph.mipharmacy.net`) |
| `--admin-email <address>` | Cognito only: create that admin user and add it to the admin group |
| `--retain-data` | Keep the table, media bucket, KMS key and user pool when the stack is deleted (recommended for production) |

### After the first deploy

1. Sign in at the Admin URL (Cognito asks for a new password on first sign-in). More admins: rerun with
   `--admin-email`, or add users to the `admin` group in the Cognito console (or, with your own provider, give
   them the admin claim there).
2. Admin → Settings: enter the PH API token. It is write-only and stored KMS-envelope-encrypted.
3. Load the launch data once (five pharmacies, the default promotions, the service library):
   `npm run seed:aws -- --region ap-southeast-2` (`--reset` puts seeded records back to the fixtures).
4. In Personalisation Hub, add the Campaign URL (with the promo you want) as the campaign's web content.

Token rotation needs no redeploy: save the new token in Settings; every function instance picks it up within
15 s. The KMS key rotates itself every 90 days.

## Tear down (one command)

```bash
npm run destroy:aws -- --region ap-southeast-2 [--stack-name <name>]
```

It deletes the stack and everything in it — CloudFront, API, functions, table, buckets (emptied first), user
pool, secret, log groups — then the Lambda log groups CloudFormation leaves behind. A stack deployed with
`--retain-data` keeps its table, media bucket, KMS key and user pool. Two things outlive any stack, by AWS
design: the KMS key is only **scheduled** for deletion (after 7 days, KMS's minimum), and the CDK bootstrap
stack (`CDKToolkit`, shared by every CDK app in that account and region) stays; delete it in CloudFormation if
the account is only for this.

## Test checklist on AWS

The ticket's acceptance steps, against a deployed stack:

1. **Install**: from a clean checkout, `npm run deploy:aws -- --region <r> --admin-email <you>` into an empty
   account finishes and prints the URLs. `curl <ApiUrl>/health` → `{"ok":true}`.
2. **Full checklist** (`../README.md` → Tests, and the handover test checklist) against the printed URLs, including:
   - **Token encryption**: save a token in Settings; the editor shows only its last 4; in DynamoDB, the item
     `pk = pharmacyScreen#private` holds only `token.envelope` (`kms: "aws-kms"`, ciphertext, wrapped key) and
     `last4`; CloudTrail shows `Decrypt` calls only from the `PhApi` role, with the encryption context.
   - **Failover**: in Settings, put an unreachable base URL first and the real one second; a screen still
     loads (the proxy tries the last good server first, then the rest).
   - **Android 12 playback**: the Campaign URL (portrait and landscape) in the PH player on the Android 12 device.
3. **Tear down**: `npm run destroy:aws -- --region <r>` leaves no stack, bucket, table, function, user pool or
   log group of it behind (the KMS key shows "Pending deletion").

## Limits on AWS

- **Uploads up to 4 MB.** A request body reaches Lambda base64-encoded inside a 6 MB event, so images above
  4 MB get `413 too-large` here (the API's own limits are 2 MB for logos and 5 MB for backgrounds).
- **About 90 pharmacies per write.** A promotion or template edit republishes every pharmacy's screen in the
  same DynamoDB transaction, which holds at most 100 items; beyond that the edit is refused with
  `too-many-writes` before anything is written.

## Files

| File | What it does |
|---|---|
| `adapters/dynamodb-store.js` | Config store over DynamoDB (serialisable transactions, compressed large records, ordered audit paging) |
| `adapters/s3-blobs.js` | Logos and backgrounds in S3, URLs on the CloudFront domain |
| `adapters/oidc-auth.js` | ID token verification (JWKS, issuer, audience, expiry) and the admin claim, for both APIs |
| `adapters/aws-kms-provider.js` | AWS KMS wrapping of the PH API token's data key (`ph-proxy/src/secret-store.js` does the envelope) |
| `adapters/dynamodb-settings.js` | PH API settings record (atomic update) and its audit log |
| `lambda/config-api.js`, `lambda/ph-proxy.js` | Lambda entries: AWS adapters into the unchanged `createConfigApi()` / `createApi()` |
| `lambda/apigw.js` | API Gateway events to the APIs' request shape and back; the client address for rate limits |
| `infra/stack.js`, `infra/app.js` | The CDK stack and app |
| `infra/params.js` | Every deployment parameter, with its checks |
| `infra/admin-config.js` | The admin editor's `config.js` for OIDC sign-in, written at deploy time |
| `scripts/deploy.mjs` | `deploy`, `destroy` and `synth`, with `--dry-run` |
| `scripts/seed.js` | Launch data into the stack's table and bucket |
| `test/` | Offline tests (below) |

## Tests

```bash
cd pharmacy-screen-promo-template
npm run check:aws        # npm ci in aws/, then the offline suites and the admin sign-in browser test
cd aws && DYNAMODB_ENDPOINT=http://localhost:8000 npm run test:dynamodb-local   # against DynamoDB Local
```

`npm test` in `aws/` runs the config API's whole HTTP suite on the DynamoDB store (on an in-memory fake), the
store's own concurrency and limits tests, the Lambda entries end to end (token encryption with a KMS fake that
checks the encryption context, proxy failover, the client address), ID token verification, the synthesized
CloudFormation (resources, IAM, routes, what teardown deletes, the VPC and own-IdP variants) and the deploy
plan. `npm run test:ui` signs in to the staged admin editor in Chromium through a fake OIDC provider (code +
PKCE, refresh, sign-out, non-admin refused). `test:dynamodb-local` runs the DynamoDB suites against DynamoDB
Local (`docker run -p 8000:8000 amazon/dynamodb-local`), which is what proves the transactions and
conditions; it fails rather than passing when no endpoint is set.
