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
                           │        │                            │     sw.js, admin/                       │
                           │        │ /pharmacyScreen/media/*    └─▶ S3 media bucket (logos, backgrounds)  │
                           │        │ /api/*  (+ origin header)                                            │
                           │        ▼                                                                      │
                           │  API Gateway (HTTP API)                                                       │
                           │    ├─ /api/health, /api/screens/**, /api/admin/**  ─▶ Lambda ConfigApi ─┐     │
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
4. Check it: Settings → look up a device ID; the store record from the Location API appears (read-only).

Never put the token in an environment variable, a file, a ticket or the front end.

### Rotate the token

1. Create the new key in Personalisation Hub.
2. Admin → Settings → **Replace** → paste it → Save. Every proxy instance uses it within 15 s; screens need
   nothing (they never hold the token). The audit log records the change with the last 4 characters only.
3. Revoke the old key in PH once a screen has loaded with the new one (the Settings device lookup is a quick check).

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
5. **Schedule** which promotion plays when (morning, afternoon, closed, occasions) in PH Core; the template does
   no scheduling of its own.
6. A screen that shows **"Screen not set up"** with a device ID at the bottom is not registered to a store in PH,
   or its store has no pharmacy in the editor. "Invalid screen URL" means the campaign URL lost `device=`.

## Upgrade

1. Get the new release (a tag, or the Shared Drive zip) and read [../CHANGELOG.md](../CHANGELOG.md).
2. From its folder, run the same command with the same options:
   `npm run deploy:aws -- --region <region> [the options you installed with]`. CloudFormation updates in place;
   data in DynamoDB and S3 is kept.
3. Screens pick up the new screen page by themselves: each player checks for a new version on every load and
   every 30 minutes, downloads it once and reloads onto it (`sw.js`).
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

## Limits

- Uploads up to 4 MB on AWS (API Gateway → Lambda payload limit); the API's own limits are 2 MB for logos and
  5 MB for backgrounds.
- About 90 pharmacies per promotion or template edit (one DynamoDB transaction republishes every pharmacy's
  screen; beyond that the edit is refused with `too-many-writes` before anything is written).

## More detail

- [../aws/README.md](../aws/README.md): every option, the stack's resources, the AWS tests.
- [../pharmacy-screen/ph-proxy/README.md](../pharmacy-screen/ph-proxy/README.md): how the token is protected,
  proxy behaviour, rate limits.
- [../pharmacy-screen/config-api/README.md](../pharmacy-screen/config-api/README.md): the API and data model.
