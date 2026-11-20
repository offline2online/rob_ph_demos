# Test checklist

Run it twice: **first in our environment** (Firebase `rob-ph-demos`, before anything is shared), **then in
miPharmacy's** (their AWS account, connected to their PH instance) for sign-off. Each line has what to do and
what you should see. Tick both columns before go-live.

Set these first:

| | Our environment | miPharmacy's environment |
|---|---|---|
| `<site>` | `https://rob-ph-demos-pharmacy-screen.web.app` | The `SiteUrl` the AWS deploy printed (or your domain) |
| Admin | `<site>/admin/` (Firebase sign-in, `admin` claim) | `<site>/admin/` (Cognito or your IdP, admin group/claim) |
| A registered device ID | Ask the account owner for a test device in our PH | A real screen's `UniqueDeviceID` in your PH |

## A. Automated checks (no PH, no cloud)

From a clean checkout, in `pharmacy-screen-promo-template/`:

| # | Do | Expect | Ours | miPharmacy |
|---|---|---|---|---|
| A1 | `npm run check:all` | All pass: deploy config, screen, config API, proxy, seed, handover docs | ☐ | ☐ |
| A2 | `cd pharmacy-screen && npm run test:ci` (needs Chromium) | Units, the copy-fit audit (every pharmacy × promotion × scene × orientation × bar state) and end to end pass | ☐ | ☐ |
| A3 | `npm run check:aws` | AWS adapters, Lambda entries, CDK template, deploy plan and OIDC sign-in pass | ☐ | ☐ |

## B. Install

| # | Do | Expect | Ours | miPharmacy |
|---|---|---|---|---|
| B1 | Ours: `npm run deploy`. AWS: `npm run deploy:aws -- --region <r> --admin-email <you>` into an empty account | Finishes and prints the Admin, Screen, Campaign and API URLs | ☐ | ☐ |
| B2 | `curl <site>/api/health` | `{"ok":true}` | ☐ | ☐ |
| B3 | Open `<site>/pharmacy-screen.html?device=TEST&promo=morning&orientation=portrait&mockapi=1` | A Beaumaris morning promotion plays from mock data | ☐ | ☐ |
| B4 | Sign in to Admin as a user **without** the admin role | "Admin role required"; no editor | ☐ | ☐ |
| B5 | Sign in as an admin; load launch data (ours: `node pharmacy-screen/seed/seed.js --project rob-ph-demos`; AWS: `npm run seed:aws -- --region <r>`) | Five pharmacies, promotions Morning, Afternoon, Closed, Occasions, 28 services in Add promotion | ☐ | ☐ |

## C. PH API token

| # | Do | Expect | Ours | miPharmacy |
|---|---|---|---|---|
| C1 | Settings → enter the PH API token → Save | Shows "set" and the last 4 characters only; the field is empty | ☐ | ☐ |
| C2 | Reload Settings; inspect the network response of `GET /api/settings/ph-api` and the page source | No token anywhere: only `set`, `last4`, `setAt`, `setBy` | ☐ | ☐ |
| C3 | Look at the stored record. Ours: Firestore `pharmacyScreen/private/settings/phApi`. AWS: DynamoDB item `pk = pharmacyScreen#private` | Only an envelope (`ciphertext`, `iv`, `tag`, `wrappedKey`, `keyId`) and `last4`; no plaintext token | ☐ | ☐ |
| C4 | AWS only: CloudTrail → KMS `Decrypt` events | Only from the `PhApi` role, with the encryption context | n/a | ☐ |
| C5 | Search function logs (Cloud Logging / CloudWatch) for the token's first 8 characters | Not found | ☐ | ☐ |
| C6 | Replace the token with a new one | A screen keeps loading within 15 s; the audit log has the change with last 4 only | ☐ | ☐ |
| C7 | As a non-admin, call `PUT <site>/api/settings/ph-api` with a sign-in token | 403 `FORBIDDEN`; nothing changes | ☐ | ☐ |

## D. Device and store data

Use the campaign URL with a real device: `<site>/pharmacy-screen.html?device=<device id>&promo=morning&orientation=portrait&debug=1`.

| # | Do | Expect | Ours | miPharmacy |
|---|---|---|---|---|
| D1 | Open it | The debug panel shows the right store code and store for that device | ☐ | ☐ |
| D2 | Check the greeting | `${Suburb}` is the store's suburb (a store with no suburb shows the greeting with no trailing comma) | ☐ | ☐ |
| D3 | `promo=closed` | That store's weekly opening hours, "Public Holidays: Please call to confirm" and its phone number | ☐ | ☐ |
| D4 | Debug panel → store time | The store's local time in `store_timezone` (also when the browser is in another zone) | ☐ | ☐ |
| D5 | Change the store's hours in PH | The screen shows the new hours within 30 s, without a reload | ☐ | ☐ |
| D6 | `device=UNKNOWN-123` | "Screen not set up" with the device ID shown | ☐ | ☐ |
| D7 | No `device=`, and `device=${UniqueDeviceID}` unswapped | "Invalid screen URL" | ☐ | ☐ |

## E. "Open today" bar

With `debug=1`, use the panel's test time (or `now=<day>-<HH:MM>`), on a store open e.g. 08:30–19:00:

| # | Time | Expect | Ours | miPharmacy |
|---|---|---|---|---|
| E1 | Before opening (`now=mon-07:00`) | "Opens today at 8.30AM" | ☐ | ☐ |
| E2 | Open (`now=mon-12:00`) | "Open today until 7PM" | ☐ | ☐ |
| E3 | Last 30 minutes (`now=mon-18:45`) | "Closing soon · 7PM" | ☐ | ☐ |
| E4 | After close (`now=mon-20:00`) | "Closed now" | ☐ | ☐ |
| E5 | A session crossing midnight (mock `device=TEST-LATE-NIGHT&mockapi=1`) | Open after midnight until the close time on the next day | ☐ | ☐ |

## F. Promotions, orientations, copy

| # | Do | Expect | Ours | miPharmacy |
|---|---|---|---|---|
| F1 | Play every promo ID (`morning`, `afternoon`, `closed`, `occasions` and any you added) in `orientation=portrait` | Each plays its scenes in order and loops | ☐ | ☐ |
| F2 | The same in `orientation=landscape` | Each plays, with the brand arrow instead of the triangle | ☐ | ☐ |
| F3 | Occasions: in the editor switch the Occasion through all six | The screen plays each (Anzac Day without decoration or bounce) | ☐ | ☐ |
| F4 | Watch every scene of every promotion in both orientations | No headline, accent line or line leaves the brand panel or the screen (A2 checks the seeded copy automatically) | ☐ | ☐ |
| F5 | In the editor, make a headline very long | The preview shrinks it to stay inside the panel | ☐ | ☐ |
| F6 | `promo=nope` | "Promotion not found" | ☐ | ☐ |

## G. Failover and errors

| # | Do | Expect | Ours | miPharmacy |
|---|---|---|---|---|
| G1 | Settings → put an unreachable base URL first and the real one second | Screens still load (the proxy falls back to the second) | ☐ | ☐ |
| G2 | Put only unreachable base URLs; open a fresh screen (private window) | "Screen data could not load" with a red "Offline · retrying" badge; it keeps trying | ☐ | ☐ |
| G3 | Same, on a screen that had loaded before | It keeps showing its last good screen | ☐ | ☐ |
| G4 | Restore the base URLs | Screens come back within 30 s, no reload | ☐ | ☐ |
| G5 | Turn the player's network off for a few minutes, then on | It keeps playing, then resumes live updates | ☐ | ☐ |
| G6 | Restart the player while offline | It starts from its own copy and shows the last good data | ☐ | ☐ |

## H. Editor

| # | Do | Expect | Ours | miPharmacy |
|---|---|---|---|---|
| H1 | Change a headline in the editor | "All changes saved"; a running screen shows it within 60 s, no reload | ☐ | ☐ |
| H2 | Add a pharmacy with a store code that already exists | Refused: "Store code … is already used by another pharmacy." | ☐ | ☐ |
| H3 | Upload a logo (transparent PNG); change colours | The preview and the screen use them | ☐ | ☐ |
| H4 | Copy experience URL | `<site>/pharmacy-screen.html?device=${UniqueDeviceID}&promo=<id>&orientation=<o>` | ☐ | ☐ |

## I. On the PH player (Android 12)

| # | Do | Expect | Ours | miPharmacy |
|---|---|---|---|---|
| I1 | Set the campaign URL (portrait) on an Android 12 screen in PH, playback duration as the editor shows | It plays full screen with animations; the last scene finishes before the campaign moves on | ☐ | ☐ |
| I2 | The same in landscape on a landscape screen | It plays | ☐ | ☐ |
| I3 | Leave it running for an hour | No freeze; hours and the bar stay current | ☐ | ☐ |
| I4 | Deploy a change, wait up to 30 minutes | The player picks up the new version by itself | ☐ | ☐ |

## J. Tear down (AWS test account only)

| # | Do | Expect | Ours | miPharmacy |
|---|---|---|---|---|
| J1 | `npm run destroy:aws -- --region <r>` | No stack, bucket, table, function, user pool or log group of it left; the KMS key shows "Pending deletion" | n/a | ☐ |

Signed off (miPharmacy): name ____________ date ____________
