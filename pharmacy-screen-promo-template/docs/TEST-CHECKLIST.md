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
| B5 | Sign in as an admin; load launch data (ours: `node pharmacy-screen/seed/seed.js --project rob-ph-demos`; AWS: `npm run seed:aws -- --region <r>`) | Five pharmacies, promotions Morning, Afternoon, Closed, Seasonal, 28 services in Add promotion | ☐ | ☐ |

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
| D5 | Change the store's hours in PH | The screen shows the new hours within about 35 s, without a reload | ☐ | ☐ |
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
| F2 | The same in `orientation=landscape` | Each plays, with the brand arrow instead of the triangle; on Morning, Afternoon and Closed the arrow is narrow (under a third of the screen), the headline wraps inside it and the tiles or opening hours fill the rest | ☐ | ☐ |
| F2a | Play `promo=closed` in `orientation=landscape` and stand back from the screen | The opening hours card fills most of the screen right of the brand arrow (about half the screen's width, four fifths of its height), each day and its times in large type that reads from a distance, with the public holiday note and phone number under it; nothing touches the arrow or leaves the screen | ☐ | ☐ |
| F2b | In `orientation=landscape`, watch the left-hand brand panel on `morning`, `afternoon` and `closed` | The logo and the headline (with its accent line) are centred in the coloured panel, left to right and level with the arrow's point; the headline is large (about 96px on a 1080p screen, slightly smaller for a long word such as "Vaccinations") and no line leaves the panel | ☐ | ☐ |
| F3 | Seasonal: in the editor switch the Season through all six (add `&date=2026-07-01` to the screen URL, a day outside every season), with the campaign's playback duration as the editor shows (8 s with the seeded timings) | The editor shows **Loop 7s** for every season (Christmas 3 + 4 s, New Year's and Australia Day 2 + 2 + 3, Valentine's Day and Anzac Day 3 + 2 + 2, Easter 2 + 3 + 2); the screen plays each occasion's own full-screen animation, its copy as beats on that 7 s loop (Christmas: the tree photo with sparkles, 2 beats); no logo, brand panel or Open today bar; Anzac Day fades only | ☐ | ☐ |
| F3b | Seasonal dates: open the screen URL with `&date=2026-12-20`, then `2027-01-02`, `2027-01-26`, `2027-02-14`, `2027-03-26`, `2027-04-25` (whatever the Season drop-down says) | Christmas, New Year's, Australia Day, Valentine's Day, Easter, Anzac Day in turn; in the editor, Christmas's Dates card shows 15 Dec to 27 Dec and Easter shows Good Friday to Easter Monday; the Season drop-down lists each season with its dates ("Christmas (15 Dec – 27 Dec)", "Australia Day (26 Jan)"), and changing Christmas's Ends date changes its line in the drop-down | ☐ | ☐ |
| F3a | Timings: in the editor change the seconds of a Closed headline and of an occasion beat, then set the campaign's playback duration to the one the editor shows | The timeline, Loop and Playback duration follow; on the screen that headline and that beat stay up for the new time, the last scene finishes, and the occasion's fades still play | ☐ | ☐ |
| F4 | Watch every scene of every promotion in both orientations | No headline, accent line or line leaves the brand panel or the screen (A2 checks the seeded copy automatically) | ☐ | ☐ |
| F5 | In the editor, make a headline very long | The preview shrinks it to stay inside the panel | ☐ | ☐ |
| F6 | `promo=nope` | "Promotion not found" | ☐ | ☐ |

## G. Failover and errors

| # | Do | Expect | Ours | miPharmacy |
|---|---|---|---|---|
| G1 | Settings → put an unreachable base URL first and the real one second | Screens still load (the proxy falls back to the second) | ☐ | ☐ |
| G2 | Put only unreachable base URLs; open a fresh screen (private window) | "Screen data could not load" with a red "Offline · retrying" badge; it keeps trying | ☐ | ☐ |
| G3 | Same, on a screen that had loaded before | It keeps showing its last good screen | ☐ | ☐ |
| G4 | Restore the base URLs | Screens come back within about 35 s, no reload | ☐ | ☐ |
| G5 | Turn the player's network off for a few minutes, then on | It keeps playing, then resumes live updates | ☐ | ☐ |
| G6 | Restart the player while offline | It starts from its own copy and shows the last good data | ☐ | ☐ |
| G7 | From one address, request `/api/device/<made-up id>/campaign_data` for 100 different made-up ids within a minute, once one at a time and once all at the same moment | `404` for the first 30, then `429` with `Retry-After`; a real screen on that network still gets its data | ☐ | ☐ |
| G8 | AWS: call the API Gateway URL (`ApiGatewayUrl` output) directly, e.g. `/api/health` | `403`: only CloudFront may call it | ☐ | ☐ |
| G9 | With the report-only CSP live for a week, search the config API's logs for `[csp]` | No reports from players or the editor; then enforce it ([DEPLOYMENT.md](DEPLOYMENT.md) → "Content-Security-Policy") and check an injected inline script is blocked | ☐ | ☐ |
| G10 | From an Australian network, time `/api/screens/<code>` a few times (warm) | Under 150 ms | ☐ | ☐ |

## H. Editor

| # | Do | Expect | Ours | miPharmacy |
|---|---|---|---|---|
| H1 | Change a headline in the editor | "All changes saved"; a running screen shows it within about 20 s, no reload | ☐ | ☐ |
| H2 | Add a pharmacy with a store code that already exists | Refused: "Store code … is already used by another pharmacy." | ☐ | ☐ |
| H3 | Upload a logo (transparent PNG); change colours | The preview and the screen use them | ☐ | ☐ |
| H4 | In the full editor (`<site>/admin/`, without `?store=`), click Copy experience URL under the preview | `<site>/pharmacy-screen.html?device=${UniqueDeviceID}&promo=<id>&orientation=<o>`, with Playback duration beside the button (the pharmacy view, H8, has neither) | ☐ | ☐ |
| H5 | Promo preview → Master template; change the Morning greeting's Line 2 | Every pharmacy whose greeting says "Inherited from master" shows it on screen within about 20 s; its logo and colours stay its own | ☐ | ☐ |
| H6 | On a pharmacy, Morning → greeting → Edit for this pharmacy; change Line 2; then change the master again | A message says the greeting is now managed separately; the screen keeps the pharmacy's copy; Revert to master brings the master's back | ☐ | ☐ |
| H7 | Open the editor in Personalisation Hub on a tablet (or a window about 1024–1180px wide); expand, then collapse, PH's left menu, in Portrait and Landscape | The preview stays on the right of the editor and in view in every state; it narrows with the menu expanded and never drops below the editor | ☐ | ☐ |
| H8 | Open `<site>/admin/?store=VIC-MP-002` and sign in; on Morning, Edit on the greeting, change Line 1; Edit on the promotion slots, delete one, then Add promotion → Blank promotion; on Morning, Afternoon and Closed look above the sections, below them and under the preview; open Seasonal and pick Easter, then Christmas (screen URL with `&date=2026-07-01`, a day outside every season); reload; click Restore to default twice; then open `<site>/admin/?store=NOPE-1` | The page is titled "Display Promotions" and shows only the promotions: no Promo preview, no Settings; "Restore to default" replaces "shared by all pharmacies" at the top; each inherited section's action reads "Edit"; no scene shows a seconds-on-screen field; Add promotion is hidden at 3 slots and back after a delete; edits save and the screen shows them within about 20 s; Restore to default brings every section back to "Inherited from master" and the screen plays the master's copy; Morning, Afternoon and Closed show no promotion settings section (no promotion name, promo ID, template, Edit HTML or `promo=` line) and there is no New promotion or Delete promotion; no "Use ${Suburb} in any line…" hint and no "Remote config for this pharmacy" under the promotions; no Copy experience URL or Playback duration row under the preview; Seasonal shows only the Season drop-down (no name, promo ID, `promo=` line or Edit HTML) and the screen plays the season picked; its Dates card shows "Every year: 15 Dec to 27 Dec" for Christmas with Starts / Ends pickers that change only this pharmacy's dates; in the full editor, changing Seasonal in Promo preview → Master template changes no pharmacy's screen; the reload keeps the lock; NOPE-1 shows "Pharmacy not found" | ☐ | ☐ |
| H9 | On a pharmacy, Morning, pause the preview; under Footer: Open today bar, tap each tab of "Open today bar in the preview" in turn; then Edit for this pharmacy on the bar, click into Before opening and type; then click the greeting's Line 1 | While open, Last 30 minutes, Before opening and After closing show "Open today until <close>", "Closing soon · <close>", "Opens today at <open>" and "Closed now" (or the pharmacy's wording) on the preview's bar, that message marked "In preview", also while the bar is inherited; clicking into Before opening selects its tab and the bar follows the typing; clicking Line 1 goes back to Store's time. A running screen is unaffected (E1–E4) | ☐ | ☐ |

## I. On the PH player (Android 12)

| # | Do | Expect | Ours | miPharmacy |
|---|---|---|---|---|
| I1 | Set the campaign URL (portrait) on an Android 12 screen in PH, playback duration as the editor shows | It plays full screen with animations; the last scene finishes before the campaign moves on | ☐ | ☐ |
| I2 | The same in landscape on a landscape screen | It plays | ☐ | ☐ |
| I3 | Leave it running for an hour | No freeze; hours and the bar stay current | ☐ | ☐ |
| I4 | Deploy a change, wait up to 30 minutes | The player picks up the new version by itself | ☐ | ☐ |
| I5 | On an Android 12 player and a Chrome OS player, open the campaign URL with `debug=1` and time the first paint, before and after this release | First paint is faster than before (the page no longer waits for 1.5 MB of stylesheets) | ☐ | ☐ |
| I6 | Restart the player with the network unplugged; then play the Seasonal promotion (`promo=occasions`) the same way | Both still play offline; the Seasonal one in its own fonts, with the Christmas photo in December | ☐ | ☐ |

## J. Tear down (AWS test account only)

| # | Do | Expect | Ours | miPharmacy |
|---|---|---|---|---|
| J1 | `npm run destroy:aws -- --region <r>` | No stack, bucket, table, function, user pool or log group of it left; the KMS key shows "Pending deletion" | n/a | ☐ |

Signed off (miPharmacy): name ____________ date ____________
