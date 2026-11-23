# Deployment guide

How to install the Pharmacy Screen into a fresh AWS account next to your Personalisation Hub instance, connect
it to PH, put it on screens, and upgrade, roll back or remove it. Everything is one command each; nothing is
built by hand in a console.

Our own test environment runs the same code on Firebase (`npm run deploy`, see [../README.md](../README.md));
this guide is about AWS. Every setting named here is in [CONFIGURATION.md](CONFIGURATION.md).

## Architecture

```
                           ┌──────────────────────── Your AWS account (one region) ─────────────────────────┐
                           │                                                                                │
 PH player (Android 12) ───┼─▶ CloudFront (HTTPS, your domain) ──┬─▶ S3 site bucket (private)              │
 Admin browser ────────────┤        │                            │     pharmacy-screen.html, js/, css/,    │
                           │        │                            │     sw.js, assets/, admin/              │
                           │        │ /pharmacyScreen/media/*    └─▶ S3 media bucket (logos, backgrounds)  │
                           │        │ /api/*  (+ origin header)                                            │
                           │        ▼                                                                      │
                           │  API Gateway (HTTP API)                                                       │
                           │    ├─ /api/health, /api/screens/**, /api/admin/**,                      │     │
                           │    │  /api/csp-report                              ─▶ Lambda ConfigApi ─┐     │
                           │    └─ /api/settings/ph-api[/**], /api/device/**    ─▶ Lambda PhApi ─────┤     │
                           │                     (both optionally in your VPC)                        │     │
                           │                                                                          ▼     │
                           │   DynamoDB table (config, published screens, audit, encrypted token)          │
                           │   KMS key (wraps the token's data key; used by PhApi only)                    │
                           │   Cognito user pool (admins) — or your own OIDC provider                      │
                           │   Secrets Manager (CloudFront origin header)                                  │
                           └───────────────────────────────────────────────┬────────────────────────────────┘
                                                                           │ x-api-key (PhApi only)
                                                                           ▼
                                                Personalisation Hub Location API (ph.mipharmacy.net)
```

| Component | What it is | AWS resource |
|---|---|---|
| Screen page | Static front end the PH player loads as the campaign URL; holds no secret | S3 + CloudFront |
| Admin editor | Static web app for pharmacies, promotions, templates and Settings; OIDC sign-in, admin role | S3 + CloudFront, Cognito or your IdP |
| Config API | Pharmacies, promotions, templates, service library; public published config for screens | Lambda `ConfigApi` |
| Back-end proxy | Holds the PH API token, calls the Location API by device, returns only the fields screens use | Lambda `PhApi` |
| Config store | All records, the published screen configs and the audit log | DynamoDB (on-demand, point-in-time recovery) |
| Secret store | The PH API token, AES-256-GCM encrypted, data key wrapped by KMS (90-day key rotation) | DynamoDB + KMS |

## Prerequisites

| | Needed |
|---|---|
| AWS account | Credentials with rights to create the resources above (AdministratorAccess on a fresh account): `aws sso login`, a named profile (`--profile`) or environment credentials |
| Region | Any region with the services above, e.g. `ap-southeast-2` |
| Node.js | 20 or later (the functions run on Node 24 in Lambda; nothing to install for that) |
| Domain and TLS (optional) | A domain name and an ACM certificate for it **in us-east-1** (CloudFront only uses those). Without one the site is served on its `*.cloudfront.net` domain |
| VPC (optional) | A VPC whose private subnets can reach your PH API (`ph.mipharmacy.net`) through NAT, or directly if PH is inside the network. Without `--vpc-id` the functions run outside any VPC |
| Identity provider (optional) | Your own OIDC provider with a public client (no secret), authorization code + PKCE, redirect and post-logout URI `https://<site>/admin/`, and a claim that marks admins. Without one a Cognito user pool is created |
| IAM roles, KMS key | None to create yourself: the stack creates the functions' roles (least privilege) and the KMS key |
| Not needed | Docker, the AWS CLI, a global CDK install (the deploy installs the CDK into `aws/node_modules`) |

## Install (one command)

From a clean checkout of this repository:

```bash
cd pharmacy-screen-promo-template
npm run deploy:aws -- --region ap-southeast-2 --admin-email <your sign-in address>
```

With your own domain, VPC and identity provider:

```bash
npm run deploy:aws -- --region ap-southeast-2 \
  --domain-name screens.example.com --certificate-arn arn:aws:acm:us-east-1:<account>:certificate/<id> \
  --hosted-zone-id <zone id> --hosted-zone-name example.com \
  --vpc-id vpc-<id> [--subnet-ids subnet-a,subnet-b] [--vpc-endpoints] \
  --oidc-issuer https://login.example.com --oidc-client-id <client id> --admin-claim groups --admin-value admin \
  --retain-data
```

It installs the CDK and the AWS SDK (`npm ci` in `aws/`), stages the site and function code in `.deploy-aws/`,
bootstraps CDK in the account and region if needed, deploys the CloudFormation stack (`PharmacyScreen` by
default), creates the admin user in Cognito when `--admin-email` is given (Cognito emails a temporary
password), and prints:

```
  Admin      https://dxxxx.cloudfront.net/admin/
  Screen     https://dxxxx.cloudfront.net/pharmacy-screen.html?device=TEST&promo=morning&orientation=portrait&mockapi=1
  Campaign   https://dxxxx.cloudfront.net/pharmacy-screen.html?device=${UniqueDeviceID}&promo=morning&orientation=portrait
  API        https://dxxxx.cloudfront.net/api   (health: …/api/health)
```

Every stack output (`AdminUrl`, `CampaignUrlTemplate`, `TableName`, `TokenKeyArn`, `UserPoolId`, …) is saved to
`.deploy-aws/<stack>.outputs.json`. `npm run plan:aws -- --region <region> [options]` prints every step
without changing anything. Running `deploy:aws` again updates the stack in place.

Check it: `curl https://<site>/api/health` answers `{"ok":true}`, and the Screen URL plays a mock pharmacy.

## First-run steps

1. **Sign in** at the Admin URL. Cognito asks for a new password on first sign-in. More admins: rerun with
   `--admin-email <address>`, or add users to the `admin` group in the Cognito console; with your own provider,
   give them the admin claim there.
2. **Set the PH API** (below): Admin → Settings → base URL and token.
3. **Load the launch data** once: `npm run seed:aws -- --region ap-southeast-2` (five pharmacies, the four
   default promotions, the 28-service library; `--stack-name` if you changed it; `--reset` puts seeded records
   back to the fixtures). It never overwrites edits without `--reset`.
4. **Register screens and set the campaign URL** in PH (below).
5. Run [TEST-CHECKLIST.md](TEST-CHECKLIST.md).

## Set the PH API base URL and token

1. Admin → **Settings** → *Personalisation Hub API*.
2. **API base URL**: your PH instance, e.g. `https://ph.mipharmacy.net` (the default). Add a second URL to have
   the proxy fail over to it; the one that last answered is tried first.
3. **API token**: paste the PH API key and **Save**. The field is write-only: afterwards it shows only that a
   token is set and its last 4 characters, with **Replace** and **Remove**. It is stored KMS-envelope-encrypted
   and decrypted only inside `PhApi`.
4. Check it: open the campaign URL for a registered device with `&debug=1` added; the debug panel shows that
   device's store from the Location API.

Never put the token in an environment variable, a file, a ticket or the front end.

### Rotate the token

1. Create the new key in Personalisation Hub.
2. Admin → Settings → **Replace** → paste it → Save. Every proxy instance uses it within 15 s; screens need
   nothing (they never hold the token). The audit log records the change with the last 4 characters only.
3. Revoke the old key in PH once a screen has loaded with the new one (a campaign URL with `&debug=1` is a quick check).

The KMS key rotates itself every 90 days; nothing to do.

## Register screens in PH and set the campaign URL

1. **Register each screen as a device** in Personalisation Hub, assigned to its store, as for any other screen.
   PH's Location API then maps the device's `UniqueDeviceID` to that store
   (`/location-api/device/{UniqueDeviceID}/campaign_data`).
2. **The store needs a pharmacy in the editor** whose store code equals PH's `store_code` (the five launch
   pharmacies are `VIC-MP-001` … `VIC-MP-005`). Adding a pharmacy needs nothing else: [USER-GUIDE.md](USER-GUIDE.md).
3. **Create the campaign** in PH with web content (Creative tab → Experience URL):
   ```
   https://<site>/pharmacy-screen.html?device=${UniqueDeviceID}&promo=<promo id>&orientation=<portrait|landscape>
   ```
   Keep `${UniqueDeviceID}` exactly as written: the PH player swaps in each screen's own ID. The URL never
   carries a store code and is the same for every pharmacy. The editor's **Copy experience URL** button gives
   the exact URL for the selected promotion and orientation.
4. **Playback duration**: enter the number the editor shows beside Copy experience URL ("Playback duration: N s",
   the promotion's length plus one second) so the last scene finishes. Save and activate.
5. **Schedule** which promotion plays when (morning, afternoon, closed, seasonal) in PH Core; the template does
   no scheduling of its own, except that Seasonal plays the season whose dates hold the store's date.
6. A screen that shows **"Screen not set up"** with a device ID at the bottom is not registered to a store in PH,
   or its store has no pharmacy in the editor. "Invalid screen URL" means the campaign URL lost `device=`.

## Upgrade

1. Get the new release (a tag, or the Shared Drive zip: check it with its `.sha256`, see
   [RELEASING.md](RELEASING.md) → "Check a package") and read its `RELEASE-NOTES.md` and
   [../CHANGELOG.md](../CHANGELOG.md).
2. From its folder, run the same command with the same options:
   `npm run deploy:aws -- --region <region> [the options you installed with]`. CloudFormation updates in place;
   data in DynamoDB and S3 is kept.
3. Screens pick up the new screen page by themselves: each player checks for a new version on every load and
   every 30 minutes, downloads only the files that changed and reloads onto it (`sw.js`). The page and `sw.js` are
   served `no-cache`; everything under `assets/` (fingerprinted scripts, stylesheets, fonts, the Christmas photo)
   is uploaded first with `Cache-Control: immutable` and earlier builds' files are kept, so a player still on the
   previous page can finish loading it.
4. Run the smoke part of [TEST-CHECKLIST.md](TEST-CHECKLIST.md) (health, a screen in each orientation, Settings).

## Roll back

- **Code**: check out the previous release and run `npm run deploy:aws` with the same options. The stack goes
  back to that version; screens reload onto it at their next update check.
- **Data**: a single bad edit is quickest to put back by hand in the editor: every write is in the audit log
  (`GET /api/admin/audit`) with its before and after values. For anything larger, DynamoDB point-in-time
  recovery is on for the table (35 days): AWS restores it as a new table, from which records can be copied
  back. The stack has no switch to run on a restored table, so treat that as a manual recovery.
- **Token**: Replace it in Settings; there is nothing to roll back in the code.

## Uninstall

```bash
npm run destroy:aws -- --region ap-southeast-2 [--stack-name <name>]
```

Deletes the stack and everything in it: CloudFront, API, functions, table, buckets (emptied first), user pool,
secret, log groups, then the Lambda log groups CloudFormation leaves behind. A stack deployed with
`--retain-data` keeps its table, media bucket, KMS key and user pool (delete them by hand when you are sure).
By AWS design the KMS key is only scheduled for deletion (7 days), and the shared CDK bootstrap stack
(`CDKToolkit`) stays; delete it in CloudFormation if the account was only for this. Remove the campaigns in PH
too.

## Content-Security-Policy

The screen page and the editor are sent `Content-Security-Policy-Report-Only` (both deployments; the policies are in
`aws/infra/csp.js`, and `firebase.json` carries the same strings). Nothing is blocked yet: each violation a browser
sees is POSTed to `/api/csp-report`, and the config API logs one line per report, `[csp] report <directive> blocked
<origin> on <path>` (CloudWatch Logs for `ConfigApi` on AWS; Cloud Logging for `pharmacyScreenConfigApi` on Firebase).

1. Leave it in report-only for a week of real players and editor use, and search the logs for `[csp]`.
2. With no reports (or only ones explained and fixed), enforce it: change `CSP_HEADER` in `aws/infra/csp.js` to
   `Content-Security-Policy`, and the two `Content-Security-Policy-Report-Only` keys in `firebase.json` with it
   (on Firebase merge the editor's into its existing `frame-ancestors` header), then deploy.
3. Check it holds: in DevTools on the screen page, inject `<script>alert(1)</script>` with
   `document.body.insertAdjacentHTML` or a `<script src>` from another site; it is blocked and a report is logged.

The screen may only connect to its own origin. If its `pharmacy-screen-api` setting names other servers, add them
to the screen's `connect-src` (`screenCsp({ connect: [...] })`) before enforcing.

## Regions and warm instances (Firebase test environment)

Both functions run in `australia-southeast1` (Sydney), next to the stores. `firebase.json`'s rewrites and
`PS_REGION` / `PH_REGION` must name the same region (`npm run check` fails otherwise). They ran in `us-central1`
until 23 Nov 2026; those copies are gone. Firestore and the media bucket stay where they were created; if Firestore
is not in Australia, each config read still crosses to it.

The deploy (`scripts/deploy.mjs`) deploys the functions on their own, then Hosting and the rules, then checks that
the site's config API and PH API proxy answer through Hosting (`checkApi`; Hosting's own HTML "Page not found" on
an `/api` route fails it). A functions error stops the deploy before Hosting, so the site keeps the functions it
had; the one exception is the cleanup-policy message below. The deploy never deletes a function.

No instance is kept warm (`PS_MIN_INSTANCES` / `PH_MIN_INSTANCES` default `0`), so the first request after a quiet
spell has a cold start of a second or two. Keeping one instance of each warm (`1`) removes that, for a monthly cost
whether or not screens call it: set it only with the owner's yes, and run that deploy by hand, since the Firebase
CLI asks to confirm the cost.

### Image cleanup policy

Firebase keeps each function's container images in Artifact Registry and wants a cleanup policy for them in each
region it deploys to. The CI service account (`pharmacy-screen-ci`: Firebase Admin, Cloud Functions Admin, Service
Account User, Cloud Build Editor) may not set it, so CI does not try. **The project owner sets it once per region**
(and again after a move to a new region):

```bash
npx firebase-tools@14.27.0 functions:artifacts:setpolicy --location australia-southeast1 --days 7 --force --project rob-ph-demos
```

`npm run deploy` without `--skip-setup` runs the same command in its setup. Until the policy exists, the functions
step ends in "Functions successfully deployed but could not set up cleanup policy"; the deploy passes that message
alone with a warning naming the command above, and carries on to Hosting. Any other functions error, or that
message together with a function that failed to create or update, stops the deploy. Letting CI set the policy
itself would need Artifact Registry Administrator (`roles/artifactregistry.admin`) on the service account, broader
than a deploy account needs; the one-time owner command is preferred.

### Moving the functions to another region

On 23 Nov 2026 the move to Sydney deleted the functions in `us-central1` before their replacements answered, one
of them failed to create, and the site's API answered "Page not found" from 19:55 to 22:13 UTC. Any future move
is done as **separate deploys, in this order, deleting last**:

1. Change `REGION` in `scripts/deploy.mjs`, `firebase.json`'s rewrites and `PS_REGION` / `PH_REGION` together, and
   set the cleanup policy in the new region (above). While the old copies exist, the scripted deploy (CI included)
   stops at the functions step: firebase-tools will not leave functions that are no longer in the source when run
   non-interactively. That is the safe outcome: Hosting is not published and the site keeps the old copies.
2. The owner creates the functions in the new region by hand, interactively, answering **No** when asked to
   delete the old-region copies: run `npm run deploy -- --skip-setup` once (it stages `.deploy/` and the admin
   config, then stops at the functions step), then
   `npx firebase-tools@14.27.0 deploy --only functions:pharmacy-screen-config-api,functions:pharmacy-screen-ph-proxy --project rob-ph-demos`.
3. Publish Hosting pointing at them:
   `npx firebase-tools@14.27.0 deploy --only hosting:pharmacy-screen --project rob-ph-demos --non-interactive`.
4. Check the API answers: `curl` `/api/health` and an `/api/device/<id>/campaign_data` route on the site, both
   JSON, not Hosting's HTML "Page not found". If not, republish Hosting from the previous commit; the old copies
   are still there.
5. Only then, as a separate, deliberate step, delete the old copies by name:
   `npx firebase-tools@14.27.0 functions:delete pharmacyScreenConfigApi pharmacyScreenPhApi --region <old region> --project rob-ph-demos`.
   From then on the scripted deploy and CI run normally. Never add that delete to `scripts/deploy.mjs`
   (`npm run check` fails if a deploy step deletes a function), and never use `firebase deploy --force` (it would
   also delete Firestore indexes the menu-board demo owns).

## Limits

- Uploads up to 4 MB on AWS (API Gateway → Lambda payload limit); the API's own limits are 2 MB for logos and
  5 MB for backgrounds.
- Public endpoints are rate limited per instance (Lambda container or Cloud Functions instance): the screen read,
  600 a minute per client address (`PS_RATE_LIMIT_SCREENS_PER_IP_PER_MIN`; a screen asks 4 times a minute, so
  about 150 screens behind one shared address such as a head-office firewall: raise it for a larger estate); the
  Location API proxy as in [CONFIGURATION.md](CONFIGURATION.md), with unknown device ids limited to 30 a minute per
  address, counted when the lookup starts, so a burst sent all at once is held to the same 30. API Gateway's
  own throttling (200 requests a second, bursts of 400) bounds the whole API on AWS.
- About 90 pharmacies per promotion or template edit (one DynamoDB transaction republishes every pharmacy's
  screen; beyond that the edit is refused with `too-many-writes` before anything is written).

## More detail

- [../aws/README.md](../aws/README.md): every option, the stack's resources, the AWS tests.
- [../pharmacy-screen/ph-proxy/README.md](../pharmacy-screen/ph-proxy/README.md): how the token is protected,
  proxy behaviour, rate limits.
- [../pharmacy-screen/config-api/README.md](../pharmacy-screen/config-api/README.md): the API and data model.
