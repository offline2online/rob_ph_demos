# Changelog

All notable changes to the Pharmacy Screen. Versions follow [Semantic Versioning](https://semver.org/); each
release handed to miPharmacy is tagged and packaged with this file and the `docs/` folder. Newest first.

## [Unreleased]

Add changes here; at release time this section becomes `## [x.y.z] — <date>`
([docs/RELEASING.md](docs/RELEASING.md)).

### Fixed

- **Copy experience URL works when the editor is shown in Personalisation Hub.** PH's content frame is not given
  clipboard access, so the button always said "Copy failed, select it from the tooltip" there (in both
  orientations), and the hover tooltip could not be selected from. It now falls back to the browser's copy command,
  which works in the frame; if the browser refuses that too, the URL is shown selected in a read-only field under the
  button ("Press Ctrl+C to copy the URL below"). A test copies every promotion (Morning, Afternoon, Closed, and
  Seasonal in each of its seasons) in both orientations from the framed editor and checks the URL.

### Security

- **Content-Security-Policy on the screen and the editor, report-only first.** Both deployments send
  `Content-Security-Policy-Report-Only` (`aws/infra/csp.js`; the same in `firebase.json`): the screen may load
  scripts, styles and fonts from its own origin only and connect only to it; the editor also Google Fonts and its
  sign-in (Firebase Auth, or the OIDC token endpoint on AWS). Violations go to the new `POST /api/csp-report`, which
  logs one short line each. Enforce it after a week without reports ([docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) →
  "Content-Security-Policy").
- **Public endpoints are harder to abuse.** The screen read (`/api/screens/**`) has a per-client limit (600 a minute,
  about 150 screens behind one shared address; `429` past it). The Location API proxy keeps "not registered" answers in their own small cache, so made-up device
  ids no longer push real devices' fallbacks out, and an address past 30 "not found" answers a minute gets `429` for
  unknown devices while real ones keep refreshing; the slot is taken when the lookup starts, so ids sent all at once
  are held to the same limit.
- **AWS: the API answers only through CloudFront, and the origin secret is read by reference.** Both functions
  refuse a request without CloudFront's `x-origin-verify` value (`403`). They get the secret's ARN
  (`PS_ORIGIN_VERIFY_SECRET_ARN`) and read it at run time; the value is no longer in a function's environment. With
  `--vpc-endpoints` a Secrets Manager endpoint is added. The screen read sees the viewer's address (not CloudFront's)
  for its limit.
- **AWS: the PH API allowed hosts can be set at deploy time.** `--ph-api-allowed-hosts` passes
  `PH_API_ALLOWED_HOSTS` to `PhApi` (before, an AWS install could only save base URLs on the host of
  `--ph-api-base-url`, so a second or failover PH server was refused). It must include that host, and `*` is not
  accepted; unset, nothing changes.

### Changed

- **The Firebase functions run in Sydney (`australia-southeast1`)**, next to the stores, instead of `us-central1`;
  the deploy removes the old copies. No instance is kept warm yet (`PS_MIN_INSTANCES` / `PH_MIN_INSTANCES`, default
  0): that is a monthly cost and the owner's call ([docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) → "Regions and warm
  instances").

- **Players download only what changed after a deploy, and the first load is lighter.** The deploy now publishes
  every script and stylesheet under a name made from its content (`assets/`, kept by the browser and the CDN for a
  year) and writes the fonts and the Christmas photo out as their own files; only `pharmacy-screen.html` and `sw.js`
  are re-checked. After a deploy a player's service worker keeps every unchanged file and downloads the rest (a
  one-line change to the player script: `sw.js`, the page and that script), instead of the whole 1.5 MB screen. A
  player without the service worker no longer revalidates its scripts, stylesheets and fonts on every load. The
  page waits on about 14 KB of stylesheets instead of 1.5 MB: the Seasonal fonts and photo load only when a
  Seasonal promotion plays (and are still kept for offline), Roboto moved to the debug panel's stylesheet, the icon
  font holds only the icons the editor offers (about 280 KB instead of 430 KB), and the player's modules are
  preloaded. A scene's fitted copy is remembered, so the loop does not re-measure it on every pass. On AWS the
  stack uploads `assets/` first with the long cache and keeps earlier builds' files
  ([pharmacy-screen/README.md](pharmacy-screen/README.md) → "Kept on the device", "First load").

- **A promotion plays once, then holds its last scene.** On a player a promotion plays inside a rotation of
  campaigns: it now plays through once and stays on its last scene (Seasonal: its last beat), fully drawn, until
  the next campaign loads, instead of starting again from the first scene. The held scene still follows the
  store's clock and new data. It plays from the start again when the page is loaded or shown again, or a season
  changes at midnight. `loop=1` on the screen URL keeps the old behaviour (loop forever) for a screen that shows one
  campaign only ([docs/CONFIGURATION.md](docs/CONFIGURATION.md) → "Query parameters"). The editor's preview still
  loops.
- **Seeded seasons play on a 7-second loop.** The launch data now carries the seconds on screen set on the live
  master for every season's beats: Christmas 3 + 4, New Year's 2 + 2 + 3, Australia Day 2 + 2 + 3, Valentine's Day
  3 + 2 + 2, Easter 2 + 3 + 2, Anzac Day 3 + 2 + 2. A fresh install shows **Loop 7s** and a playback duration of
  **8 s** for every season (was 12 s and 13 s); the mock data (`mockapi=1`) matches. Re-running the seed gives these
  seconds to a season the seed made that has none on any beat, and leaves a season whose seconds someone set in the
  editor as it is. A beat with no seconds still takes its share of the design's 12 s loop
  ([pharmacy-screen/seed/README.md](pharmacy-screen/seed/README.md)).
- **Seasonal content is each pharmacy's own; the master never reaches a live store.** Before, the Season drop-down
  was the promotion's template, shared by every pharmacy, and every pharmacy inherited the master's seasonal copy,
  dates and timings live, so an edit to the master changed every screen at once. Now each pharmacy has its own
  season (which one plays outside every season's dates), and its own copy, dates and timings for every season. The
  Season drop-down and the Dates card save to the pharmacy on screen, in the admin view and the pharmacy view, and
  only that pharmacy's screens follow. The master is where a new pharmacy starts, and what a pharmacy gets when it
  chooses **Copy from master** for the season on screen; nothing else brings a master change to a store. Existing
  pharmacies keep exactly what they played: the server gives each one its own copy before any change to the master
  is applied (`config-api/src/seasonal.js`). Restore to default leaves seasonal content alone. Morning, Afternoon
  and Closed inherit from the master as before ([docs/USER-GUIDE.md](docs/USER-GUIDE.md) → "Seasonal").

- **Edits reach screens sooner, with less traffic.** A running screen now checks its published config every 15 s
  (was 60 s) and the config API answers `304` with no body while nothing changed (`ETag`); the CDN holds the config
  5 s (was 15 s). An edit in the editor is on screen within about 20 s (was up to 76 s). Store data from PH's
  Location API is checked every 20 s (was 30 s), so changed hours show within about 35 s. A screen also checks at
  once when its page is shown again or its network returns, and writes its last good copy to storage only when it
  changed ([docs/CONFIGURATION.md](docs/CONFIGURATION.md) → "Fixed behaviour").
- **Images on the player.** Our own logos and backgrounds (content-hashed URLs) are downloaded once and never
  asked for again. A logo URL that comes from PH, which can be replaced in place, is shown from the player's copy
  and re-checked in the background, so a replaced logo shows on the next play. A failed image download is no longer
  kept, and the screen asks the browser to keep its storage (`navigator.storage.persist`).

### Security

- **Template HTML cannot run script.** Template markup is cleaned in the page before it is shown on a screen or in
  the editor preview (event handlers, script URLs and elements that load or run something are removed), and the
  config API's check now reads tags the way a browser does: `<img title=">" onerror=…>` was accepted before.
- **The PH API token can only be sent to allowed hosts.** Base URLs saved in Admin → Settings must be on a host in
  `PH_API_ALLOWED_HOSTS` (default: the host of `PH_API_DEFAULT_BASE_URL`), so a stolen administrator session cannot
  point the token at another server.
- **Published screen configs can no longer be listed** through Firestore (one store's config can still be read),
  and every Hosting response carries `X-Content-Type-Options`, `Referrer-Policy` and `Permissions-Policy`.

### Added

- **Sign-in from Personalisation Hub; no separate login.** Embedded in HQ Admin (Pharmacy Promos) or Retail
  Admin (Display Promotions), the editor uses the PH session of the person looking at it: the PH page hands the
  session to the editor's frame, the server checks it with PH and issues a short editor session
  ([docs/PH-EMBED.md](docs/PH-EMBED.md)). An HQ Admin user is an administrator. A Retail Admin user sees and edits
  only their own store's promotions and **Restore to default**; this is enforced by the server, and a store code
  in the URL that is not theirs shows "Access denied". The editor can only be framed by PH. `PS_ADMIN_AUTH`
  chooses `ph`, `ph+firebase` (the changeover default) or `firebase`
  ([docs/CONFIGURATION.md](docs/CONFIGURATION.md)). **The PH pages must send the session for this to take
  effect** (the snippet is in docs/PH-EMBED.md); until they do, `ph+firebase` keeps the previous sign-in.

- **Season drop-down shows each season's dates.** On the Seasonal promotion, every line of the **Season**
  drop-down has the season's start and end dates in brackets after its name, for example
  "Christmas (15 Dec – 27 Dec)" and "New Year's (28 Dec – 5 Jan)"; a one-day season shows one date
  ("Australia Day (26 Jan)") and Easter shows this year's Good Friday to Easter Monday. In the admin editor and
  the pharmacy view (`admin/?store=<code>`). The dates are the ones in each season's **Dates** card, so the
  drop-down changes as soon as a date is changed ([docs/USER-GUIDE.md](docs/USER-GUIDE.md) → "Seasonal").
- **Master template preview shows its tokens as written.** In Promo preview → **Master template**, the preview
  prints `${Suburb}`, `${StoreName}` and `${Phone}` as typed ("Good morning, ${Suburb}", "Serving ${Suburb}",
  "Phone ${Phone}", "from the whole ${StoreName} team") instead of blanking them, so it is clear the master's copy
  carries a token. `${CloseTime}` / `${OpenTime}` keep the sample times. Preview only: a pharmacy's preview and the
  screens are unchanged ([docs/USER-GUIDE.md](docs/USER-GUIDE.md) → "Master template").
- **Editor: + Add token above every headline field.** Each headline (every promotion's scenes, the opening hours
  headlines, the seasonal beats' main lines) and each Open today bar message has **+ Add token** on its label row,
  as in PH's HQ Admin. It lists Store name, Suburb, Brand name, Store code, State, Phone number, Website, Languages
  spoken by store staff and Localised copy, and inserts the chosen `${Token}` at the cursor. New store-data tokens
  `${State}` (`store_info.address_info.state`) and `${StoreCode}` (`store_location.store_code`) work in copy and
  template HTML and can be overridden in Settings → Tokens like `${Suburb}` and `${Phone}`; Brand name, Website,
  Languages spoken and Localised copy (`${BrandName}`, `${Website}`, `${LanguagesSpoken}`, `${LocalisedCopy}`) show
  the pharmacy's value from Settings → Tokens ([docs/DATA-CONTRACT.md](docs/DATA-CONTRACT.md) → "3. Template tokens").
- **Seasonal dates show as a yearly schedule in both views.** A season's **Dates** card header reads **Every
  year: <start> to <end>** (for example "Every year: 15 Dec to 27 Dec") in the admin editor and in the pharmacy
  view (`admin/?store=<code>`). The pharmacy view now shows the Dates card, read-only: Starts and Ends as plain
  read-only fields, no pickers (an administrator still sets the dates in the full editor). Easter shows this
  year's Good Friday to Easter Monday.
- **Editor: Schedule on new and existing promotions.** New promotion has a **Schedule** drop-down, **No schedule**
  by default; **Annual** shows a start and an end date (day and month, inclusive) that repeat every year. The same
  Schedule shows under an existing promotion's promo ID and template (not on Seasonal, whose seasons keep their
  Dates card). The config API stores and validates it (`schedule`, `"MM-DD"`) and publishes it in the screen
  config; Personalisation Hub Core still decides when a campaign plays ([docs/DATA-CONTRACT.md](docs/DATA-CONTRACT.md)).
- **Editor: see each "Open today" bar message in the preview.** Under Footer: Open today bar, "Open today bar in
  the preview" has tabs for Store's time, While open, Last 30 minutes, Before opening and After closing; the
  preview's bar shows the chosen message and that message is marked "In preview". It works while the bar is
  inherited from the master, and clicking into a message shows it. Preview only: screens still follow the store's
  clock ([docs/USER-GUIDE.md](docs/USER-GUIDE.md) → "Copy tips").
- **Occasions is now Seasonal, and it switches by date.** The fourth default promotion, its tab, its drop-down
  (now **Season**) and every label in the editor and the docs say Seasonal instead of Occasions; its promo ID stays
  `occasions`, so existing campaign URLs keep working. Each season has start and end dates, the same every year:
  Christmas 15–27 December, New Year's 28 December–5 January, Australia Day 26 January, Valentine's Day 14
  February, Easter Good Friday to Easter Monday (worked out for each year) and Anzac Day 25 April. The screen plays
  the season whose dates hold today in the store's time zone and moves to the next one by itself at midnight, so
  nobody has to change the drop-down; outside every season's dates it plays the season picked in the drop-down.
  An administrator can change a season's dates in the editor (**Dates** card above the beats; saved with the
  season's copy as `content.occasions.<season>.from` / `.to`, `MM-DD`, inherited from the master template like
  the copy). The pharmacy view shows the dates read-only (see the entry above). The seed renames its default promotion still called
  Occasions, and the editor shows it as Seasonal until then. New testing parameter `date=YYYY-MM-DD`.

- **Pharmacy view: `admin/?store=<store code>` (or `?storeCode=`) opens the editor locked to that pharmacy.** The
  same editor and preview as the admin view, labelled "Pharmacy view · <store code>", with everything that is the
  pharmacy's own editable (inherited sections made its own, promotions added from the service library or blank,
  details, tokens and branding). Shared promotion settings and templates are read-only; the master template,
  the other pharmacies and the PH API settings are hidden. Sign-in still needs the admin role
  ([docs/USER-GUIDE.md](docs/USER-GUIDE.md) → "Pharmacy view", [docs/CONFIGURATION.md](docs/CONFIGURATION.md) →
  "Admin page").
- **Settings → Tokens: set any token's value by hand, per pharmacy.** Settings lists every `${…}` token the
  pharmacy's promotions and templates use (the master template's inherited sections included), with the
  promotions that use each. A value typed there shows on that pharmacy's screens instead of the store's data
  (`${Suburb}`, `${StoreName}`, `${Phone}`, `${CloseTime}`, `${OpenTime}`), or instead of nothing for any other
  token a custom template or copy uses; blank goes back to the store's data. Stored as the pharmacy's `tokens`
  and published with its screen config ([docs/DATA-CONTRACT.md](docs/DATA-CONTRACT.md) → "Template tokens").

### Changed

- **Landscape Morning, Afternoon and Closed: a narrower brand panel and bigger content.** The coloured arrow on the
  left is now 580px wide with its tip at x=780 (was 820px, tip at x=1120), and the headline wraps inside its
  straight-sided part, so no line reaches into the arrow's point or past the coloured area. The content on the right
  (service tiles, the large service icon, the copy under them, the opening hours card and holiday note) starts
  about 340px further left and is drawn larger. Portrait and Seasonal are unchanged; the "Screen
  not set up" page in landscape follows the same narrower panel.
- **Preview: "Sample opening hours" has its own row and always shows in full.** The pill was cut off with an
  ellipsis beside Play in a normal-width preview column. It now sits on a row of its own under the Portrait and
  Landscape tabs, centred, with its info tooltip beside it, and wraps onto two lines in a very narrow column instead
  of being shortened. The tooltip opens below the row. The preview screen is 34px shorter to make room, so the whole
  preview still fits the visible height ([docs/USER-GUIDE.md](docs/USER-GUIDE.md)).
- **Preview: "Sample store data" is now "Sample opening hours", with an info tooltip.** The pill beside Play under
  the preview names what is sample (the opening hours), and its info icon explains that each screen uses its own
  store's actual opening and closing hours from Personalisation Hub, for the day and time the promotion plays
  ([docs/USER-GUIDE.md](docs/USER-GUIDE.md)).
- **Settings: `${StoreName}` is the Pharmacy name, and today's hours are always live.** Pharmacy details shows the
  `${StoreName}` token beside the **Pharmacy name** label, and Settings → Tokens no longer lists `${StoreName}`,
  `${CloseTime}` or `${OpenTime}`: the name is set in Pharmacy details, and the times change through the day, so
  none of them can be given a fixed value. A value stored for one earlier is ignored on screens and dropped the
  next time the pharmacy is saved ([docs/DATA-CONTRACT.md](docs/DATA-CONTRACT.md) → "Template tokens").
- **Pharmacy view: no `${Suburb}` hint, remote config or Copy experience URL.** `admin/?store=<store code>` no
  longer shows "Use ${Suburb} in any line to insert the suburb. In headlines, Enter adds a line break.", "Remote
  config for this pharmacy", or Copy experience URL with the Playback duration and its info tooltip under the
  preview. The full editor still shows all three ([docs/USER-GUIDE.md](docs/USER-GUIDE.md) → "Pharmacy view").
- **Pharmacy view: no promotion name, promo ID and template section on Morning, Afternoon and Closed.** The grey
  section (name, promo ID, template, Edit HTML, `promo=` line) is no longer shown on any non-occasion promotion in
  `admin/?store=<store code>`; Occasions still shows only its Occasion drop-down. The admin view is unchanged
  ([docs/USER-GUIDE.md](docs/USER-GUIDE.md) → "Pharmacy view").
- **Pharmacy view shows only the promotions, titled "Display Promotions".** `admin/?store=<store code>` no longer
  shows Promo preview, the "Pharmacy view" label or Settings (the pharmacy's details, tokens and branding are set
  in the full editor). On Occasions it shows only the Occasion drop-down, which can be changed there, without the
  promotion name, promo ID or `promo=` line ([docs/USER-GUIDE.md](docs/USER-GUIDE.md) → "Pharmacy view").
- **Pharmacy view: Restore to default, "Edit", no timings, at most 3 slots.** "Restore to default" replaces
  "shared by all pharmacies" at the top of the page and puts every section of every promotion back to the master
  template (two clicks). "Edit for this pharmacy" reads "Edit". Scene timings are hidden (set by an administrator
  in the full editor); slots can still be reordered and deleted. Add promotion is hidden once a promotion has 3
  slots ([docs/USER-GUIDE.md](docs/USER-GUIDE.md) → "Pharmacy view").
- **Timings for every scene of every template.** Besides the Promotion scenes' greeting, slots and close, each
  Closed (opening hours) headline and each occasion beat now has its own seconds on screen (1–60) in the editor.
  The timeline, Loop and Playback duration follow; at the default timings nothing changes (Closed 2.7 + 2.7 +
  2.6 s, occasions a 12 s loop, playback 13 s). Stored as the headlines' `headlineDurs` and each beat's `dur`
  ([docs/DATA-CONTRACT.md](docs/DATA-CONTRACT.md)).
- **Editor: the preview stays beside the editor when Personalisation Hub's left menu is expanded.** On a tablet or
  small laptop the expanded menu left a frame under 920px, where the preview used to drop below the whole editor
  and seemed to disappear. It now narrows and stays in view beside the editor down to a 600px frame; only a
  phone-sized frame stacks it under the editor ([pharmacy-screen/admin/README.md](pharmacy-screen/admin/README.md)
  → "Layout in the Personalisation Hub frame").
- **Occasions: the six templates are the approved standalone designs.** Christmas (a photo of a lit tree with
  flickering sparkles), New Year's (fireworks), Australia Day (the flag waving), Valentine's Day (rising hearts),
  Easter (bouncing eggs) and Anzac Day (a dawn glow and a poppy, fades only), each filling the screen in both
  orientations with no brand panel, logo, brand colours, icon tiles or Open today bar. The copy plays as beats on a
  12 s loop (Christmas 2, the others 3); set the playback duration to 13 s. New default copy; the editor shows each
  beat's lines (a main line, and a small label line where the design has one). Fonts and the Christmas photo are
  self-hosted with the screen. Under reduced motion every decoration stands still (New Year's firework flashes and
  Easter's egg shadows included) and the beats still change. Copy never edited takes the new defaults (the seed
  upgrades the pharmacies it made); edited copy is kept.
- **Admin editor: pharmacies are managed in Settings.** Adding a pharmacy, its details (name, store code) and
  its branding (colours, logo) moved from the promotions page into Settings, beside the Personalisation Hub API.
  The promotions page now has only a **Promo preview** drop-down to pick the pharmacy whose copy is edited and
  previewed. Settings' button back reads **Back to promotions**.

- **Landscape opening hours: a much larger card.** On a landscape screen the opening hours card (Closed, or any
  promotion on the Opening hours template) now fills most of the screen right of the brand arrow: 1040px wide and
  about 860px tall (was 950px by about 640px), with the day names and times at 58px (was 40px) in 100px rows, the
  "Opening hours" title at 68px, a larger "CLOSED NOW" badge and a larger public holiday note and phone line under
  it, so the hours read from across the store. A day with two sessions keeps both on one line, set smaller. Portrait
  is unchanged.

### Removed

- **Settings → Store record** (the device ID lookup of the Location API record). The preview always uses sample
  store data; to check a screen's store, open its campaign URL with `&debug=1`. The proxy endpoint
  (`GET /api/device/{id}/campaign_data`) is unchanged: screens still use it.

### Fixed

- **Landscape Morning, Afternoon and Closed: the brand panel's headline is centred and larger.** After the panel
  was narrowed, its headline sat left-aligned, below the arrow's centre line, at 84px. The headline and its accent
  line are now centred in the panel, across its width and on the arrow tip's line, and drawn at 96px and 40px (were
  84px and 36px); a headline too wide for the panel still shrinks to fit inside it. The logo above is centred in
  the panel too. Portrait and Seasonal are unchanged.
- **Edit for this pharmacy / Edit / Revert to master no longer move the page.** In the admin and pharmacy views
  the button you clicked stays where it was on screen (and keeps the focus) while the section switches, instead
  of the page jumping.
- **Remote config for this pharmacy opens beside the preview, not over it.** In the full editor, expanding it on a
  narrow frame (a tablet, or PH's left menu expanded) used to widen it past the editor column and over the
  preview. It now opens in the editor column's width and its long lines wrap.

## [0.1.0] — first handover candidate

Tested in our environment (Firebase `rob-ph-demos`); not yet shared with miPharmacy.

### Added

- **Release package** (`npm run release`): a versioned zip for the Google Shared Drive
  (`pharmacy-screen-v<version>.zip`, with a `.sha256` checksum, `START-HERE.md` and `RELEASE-NOTES.md` beside it)
  and a git tag `pharmacy-screen-v<version>`. Built from the commit, never the working tree; carries the built
  screen and admin front ends, back end, AWS infrastructure, seed and mock data, `docs/` and the agent files;
  refuses to package a token, key, `.env` file, personal address or any pharmacy beyond the five launch pharmacies.
  `npm run release:verify -- <zip>` checks a downloaded package the same way. See
  [docs/RELEASING.md](docs/RELEASING.md).
- **Master template** for the promotions: pick **Master template** in the editor's **Promo preview** drop-down to edit the
  default content of every promotion (greeting, promotion slots, walk-in close, Open today bar, opening-hours
  headlines and address, occasion copy). Every pharmacy, including each new one, inherits it section by section
  and keeps its own name, logo and colours. On a pharmacy, each section says **Inherited from master** or
  **Managed separately**; **Edit for this pharmacy** makes a section its own (a message says the master no
  longer reaches it) and **Revert to master** inherits it again. The seed makes Beaumaris's content the master
  of the four default promotions. Stored as `promotion.master` and `pharmacy.detached`; screens get the
  resolved content, so the published config is unchanged in shape.
- **Handover package**: [START-HERE.md](START-HERE.md), [AGENTS.md](AGENTS.md) and [CLAUDE.md](CLAUDE.md),
  [.env.example](.env.example), and `docs/`: [DEPLOYMENT.md](docs/DEPLOYMENT.md),
  [CONFIGURATION.md](docs/CONFIGURATION.md), [DATA-CONTRACT.md](docs/DATA-CONTRACT.md),
  [TEST-CHECKLIST.md](docs/TEST-CHECKLIST.md), [USER-GUIDE.md](docs/USER-GUIDE.md). A check
  (`npm run check:docs`, also in `check:all` and the train's tests) fails when an environment variable or query
  parameter is in the code but not in CONFIGURATION.md, or the other way round.
- **AWS deployment** for the retailer's own account (`aws/`): CloudFront + S3, API Gateway + two Lambda
  functions (optionally in a VPC), DynamoDB, an S3 media bucket, a KMS key wrapping the PH API token's data key,
  Cognito or your own OIDC provider for admin sign-in. One command each: `npm run deploy:aws`,
  `npm run destroy:aws`, `npm run seed:aws`.
- **Occasions promotion** (`promo=occasions`): Christmas, New Year's, Australia Day, Valentine's Day, Easter and
  Anzac Day, chosen in the editor's Occasion drop-down.
- **Screen kept on the player** (`sw.js`): starts from the device's own copy, also offline, and downloads again
  only when a deploy changed it.
- **Admin editor** on the config API: pharmacies, branding and logo, shared promotions, the 28-service library,
  scenes and timings, the "Open today" bar, templates (clone, HTML with `${…}` tokens, CSS, backgrounds),
  PH API Settings, live preview, Copy experience URL and playback duration; laid out for the PH frame.
- **Live store data** by device through the back-end proxy (Location API), config by store code, 30 s / 60 s
  polling, server failover, last good result kept, on-screen error states.
- **PH API token** set in Settings, write-only (last 4 shown), KMS envelope-encrypted, decrypted only in the
  proxy, audit-logged, rotation without redeploying screens.
- **Config API and store** with unique store codes and promo IDs, optimistic concurrency, audit log, and a
  public published config with no secrets.
- **Seed data**: five launch pharmacies (VIC-MP-001 to 005), the default promotions, built-in templates and the
  service library; mock Location API data for local runs and tests.
- **Tests**: opening hours and time zones, tokens, live data and failover, copy-fit audit across every pharmacy,
  promotion, scene, orientation and bar state, end to end through the real proxy and config API, security, the
  AWS stack.
- **One-command deploy** to our Firebase test environment, with CI.

### Fixed

- **Editor preview on tablets**: the preview column now scrolls up with the page until the Portrait/Landscape
  tabs lock to the very top, and the preview screen is sized to the visible height, so the bottom of the preview
  (scene bar, Play/Pause, Copy experience URL) is no longer cut off on a tablet.

### Notes

- Service library copy needs TGA advertising review before go-live.
- The store logo comes from the Location API once PH returns it (PH-181); until then the editor's upload is used.
