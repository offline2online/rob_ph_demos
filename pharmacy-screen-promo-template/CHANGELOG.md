# Changelog

All notable changes to the Pharmacy Screen. Versions follow [Semantic Versioning](https://semver.org/); each
release handed to miPharmacy is tagged and packaged with this file and the `docs/` folder. Newest first.

## [Unreleased]

Add changes here; at release time this section becomes `## [x.y.z] — <date>`
([docs/RELEASING.md](docs/RELEASING.md)).

### Added

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

### Removed

- **Settings → Store record** (the device ID lookup of the Location API record). The preview always uses sample
  store data; to check a screen's store, open its campaign URL with `&debug=1`. The proxy endpoint
  (`GET /api/device/{id}/campaign_data`) is unchanged: screens still use it.

### Fixed

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
