# Pharmacy screen

The in-store screen page for the **Pharmacy Screen Promo Template** project: one templated web page that the
Personalisation Hub player loads as a campaign URL, in place of the Beaumaris MP4s. It renders exactly what the
concept prototype renders (portrait 1080x1920 with the brand triangle, landscape 1920x1080 with the brand arrow).

```
pharmacy-screen.html?device=${UniqueDeviceID}&promo=<promo id>&orientation=<portrait|landscape>
```

The PH player swaps `${UniqueDeviceID}` for the screen's own ID. The URL never carries a store code.

## How the screen gets its data (live)

1. **Store data by device**, from the back-end proxy (`ph-proxy/`): `GET /api/device/{UniqueDeviceID}/campaign_data`.
   The screen never calls the PH API directly and never holds a token. Fields used: `store_location`
   (`store_code`, `store_name`, `store_timezone`), `store_info.opening_hours[]` (sessions may cross midnight),
   `store_info.special_hours[]` (dated exceptions such as Christmas Day closed: the bar on those dates and the list on
   the opening hours template),
   `store_info.address_info` (`suburb` for `${Suburb}`, `address`, `phone_number` for `${Phone}`, `state` for `${State}`) and `store_info.logo_url`
   (the store logo once the Location API returns it, PH-181; until then the config logo).
2. **Config by store code**, from the public config read (`config-api/`): `GET /api/screens/{store_code}`, using the
   store code the proxy returned, never anything in the URL. `js/live-data.js` maps the published config onto the
   render engine's shape (`colours` → `brand`, `template.kind` → `base`, content keyed by promo ID).
3. **Servers**: `<meta name="pharmacy-screen-api" content="">` in `pharmacy-screen.html` lists the base URLs, each
   serving both paths (comma-separated; empty means the page's own origin, through the Hosting rewrites). The
   last server that answered is tried first, then the others in order, one request at a time (8 s timeout each).
4. **Polling**: store data every 20 s, config every 15 s (answered `304` with no body while nothing changed), one
   request in flight per endpoint, and both at once when the page is shown again or the network returns. The screen re-renders
   only when what it shows changed (new hours reach it within about 35 s: the 20 s poll plus the proxy's 15 s cache, no reload), and re-checks the "Open today" bar
   at the turn of every minute in `store_timezone`.
5. **Resilience**: the last good result is kept in memory and in `localStorage`
   (`pharmacy-screen:last:<device>`), so a screen keeps playing through a network drop and comes back with its
   store straight away after a restart while still offline.

| State | What the screen shows |
|---|---|
| No `device` (or an unswapped `${UniqueDeviceID}`), or the proxy refuses the ID | "Invalid screen URL" |
| The proxy answers `DEVICE_NOT_FOUND`, or the config read has no config for the store | "Screen not set up" in the brand panel, with the device ID small at the bottom |
| Every server fails and nothing is cached | "Screen data could not load" with a red "Offline · retrying" badge; it keeps polling |
| Every server fails but data is cached | The last good screen, unchanged (the debug panel shows the failures) |
| `promo=` names no promotion | "Promotion not found" |

## Kept on the device (service worker)

`sw.js` keeps the screen on the player, so it starts from the device's own copy, also with no network, and downloads
it again only after a deploy has changed it. `js/player.js` registers it for `pharmacy-screen.html` only (the admin
editor is never touched).

- **The shell as published** (`buildShell` in `../scripts/deploy.mjs`, run by both deploys and the release
  package): every file in `js/` and `css/` gets a fingerprinted copy in `assets/` (`assets/js/player.<hash>.js`,
  named after its content; a module's copy imports its neighbours' copies), each base64 font and the Christmas
  photo in the stylesheets is written out as its own file (`assets/fonts/<hash>.woff2`, `assets/media/<hash>.jpg`),
  and `pharmacy-screen.html` names the copies. Everything in `assets/` is published `Cache-Control: public,
  max-age=31536000, immutable`; `pharmacy-screen.html` and `sw.js` stay `no-cache`. So a player without the worker
  (`nosw=1`, an old WebView) asks only for the page on a later load, never a script, stylesheet or font. The
  originals in `js/` and `css/` stay published (no-cache) for the admin editor's preview.
- **The worker** downloads the shell (the page and everything in `assets/`, the Seasonal fonts and photo included,
  so a Seasonal promotion plays offline too) once into a cache named after the build and then serves it with no
  request. The deploy stamps `FILES` in the published `sw.js` with every shell file and the hash of its content,
  and `BUILD` with a hash of that list, so a deploy that changes none of them leaves `sw.js` byte-identical and the
  players download nothing.
- **Updates**: the browser checks `sw.js` on every page load and the player asks again every 30 minutes (one small
  request, 304 while nothing changed). A new build copies every file whose hash is unchanged from the old build's
  cache and downloads only the rest (a one-line change to `js/player.js`: `sw.js`, the page and that one script),
  checks each download against its hash, takes over, the old cache is deleted and the page reloads itself onto it
  (the last good data comes straight back from localStorage). A download that does not match fails the install, so
  the old build keeps playing until the next check.
- **Images** (store logos, backgrounds) are kept after their first download (up to 100). **Data** (`/api/**`) is
  never cached by the worker: `live-data.js` polls it and keeps the last good copy in localStorage. The fixtures
  (`mockapi=1`) are network first with the last copy as a fallback.
- Unstamped (a local server), the shell is network first, so an edit shows on the next reload.
- Tested by `test/ui/offline-cache.test.mjs` (second start downloads none of the shell; an unchanged deploy downloads
  nothing; a changed `js/player.js` is picked up by the update check, which downloads `sw.js`, the page and that
  script only, and the page reloads onto it; without the worker a second load asks for the page only; a Morning
  promotion loads no Seasonal stylesheet; the screen, a Seasonal promotion included, still plays with the server
  stopped) and `../test/offline-cache.test.mjs` (fingerprinting, the fonts as files, stamping, the shell list).

## First load

- **Render-blocking CSS is small**: the page links `css/fonts.css` (Figtree), `css/material-symbols.css` and
  `css/screen.css` only, about 14 KB once the deploy has written the fonts out as files.
- **The Seasonal stylesheets** (`css/occasion-fonts.css`, `css/occasion-media.css`: the eight display faces and the
  Christmas photo) are loaded by `js/player.js` only when the promotion playing is a Seasonal one; a Morning,
  Afternoon or Closed promotion never asks for them.
- **Roboto**, the platform font, is used by the debug panel only, so it lives in `css/debug.css` (loaded with
  `debug=1` only).
- **Material Symbols** is cut down to the icons the editor's picker offers (`admin/js/icons.js`) and the screen's
  own (`tv_off`): about 280 KB instead of 430 KB (`tools/subset-icons.py`). An icon name typed into a custom
  template that the picker does not offer is not in the font.
- **`modulepreload`** links for the whole static import graph of `js/player.js` let the browser fetch the modules
  in parallel (`../test/offline-cache.test.mjs` checks the list matches the imports).
- **Fitted copy is kept**: `renderScene()` keeps each scene's fitted sizes per content signature (the scene's whole
  markup), so the loop's next pass over a scene, or a redraw with nothing changed, skips the fit loop
  (`fitMemoStats` in `js/render.js`; `test/ui/first-load.test.mjs`).

## Sales Promos (`promo=sale`)

The first default promotion (26 Nov 2026), on its own built-in template, **Sales promo** (`builtin-sale`, kind
`sale`, drawn by `renderSale()` in `js/render.js`, styled under `.sale` in `css/screen.css`, fitted by `fitSale()`
in `js/fit-text.js`). Two scenes on the brand shell in the pharmacy's own colours and logo, a 10 s loop at the
defaults: **the brands** (3.5 s: the headline pops into the wedge, 1-6 brand cards pop in 0.3 s apart and float,
the caption fades up) and **the offer** (0.65 s transition in which the wedge slides down until the brand colour
fills the screen above the footer band, then 5.85 s: rotating rays, "UP TO", the value counting up from 0 over
0.8 s with a bounce and a heartbeat, "OFF", the pulsing end-date panel with its glow, the brand list). The footer
band shows the sale. Every animation is transform or opacity (the count-up changes only the number's text), the
idle motion stops under reduced motion, and a redraw draws the scene as it ends. The copy is
`content[<promotion id>].sale` ([docs/DATA-CONTRACT.md](../docs/DATA-CONTRACT.md)); its end date's wording
("Wednesday 2nd December") is worked out from the date (`saleDateText()`). The end date is wording only:
`resolvePromotion()` always plays the sale for `promo=sale`, whatever the date (`date=` does not affect it), because
Personalisation Hub's campaign schedules decide when every promotion plays except Seasonal.
Tests: `test/sale.test.mjs`, `test/ui/sale.test.mjs`.

## Seasonal (`promo=occasions`)

A fourth default promotion for every pharmacy, named Seasonal (it was Occasions; the promo ID stays `occasions`
so existing campaign URLs keep working, and the code still calls a season an "occasion"). It plays one of six
read-only built-in templates, Christmas, New Year's, Australia Day, Valentine's Day, Easter and Anzac Day: the one
whose dates hold the store's date (`activeOccasion()` in `js/render.js`, the date from `storeDate()` in
`js/hours.js`, in `store_timezone`), else the **Fallback** (23 Nov 2026): the pharmacy's branded "Thank you,
${Suburb} / for supporting your local pharmacy" with its logo and name, exactly 7 s (2 + 3 + 2, fixed), design
`thankyou` in `js/occasions.js`. A pharmacy's one-off **Activate on display** (`content.activation = {occasion,
until: "YYYY-MM-DD"}`, the season's scheduled end date) wins until the end of that day; `liveOccasion()` in
`js/render.js` works all of this out, and the player checks it every minute, so a season starts, an activation
ends and the Fallback returns at midnight with nobody changing anything. The config API publishes the promotion's
template as the season of a running activation, else the Fallback (`config-api/src/publish.js` `publishedSeason`),
so a screen still on a player from before Activate on display (which plays the template) shows it too; the old
per-pharmacy Season pick (`content.season`) is no longer used. Dates are inclusive and the same every year: by default Christmas 15–27 Dec, New
Year's 28 Dec–5 Jan, Australia Day 26 Jan, Valentine's Day 14 Feb, Easter Good Friday to Easter Monday (worked out
for each year) and Anzac Day 25 Apr (`OCCASIONS[].season`); each pharmacy can change its own in the editor
(`content.occasions.<season>.from` / `.to`, `MM-DD`; never inherited from the master). Where two seasons' dates overlap, the one that started most
recently plays. A playing screen checks at the turn of every minute and starts the new season by itself when the
date moves into another season's dates (or out of all of them). `date=YYYY-MM-DD` pretends the store's date, for
testing.

Each occasion is a standalone, full-screen animation (the designs approved on 20 Nov 2026, `js/occasions.js`): no
brand panel, pharmacy logo, brand colours, icon tiles, Open today bar or holiday line. It fills the screen in both
orientations (1080×1920 and 1920×1080); the layout switches by a container query on `.occ`.

| Occasion | Look | Beats (label line / main line) |
|---|---|---|
| Christmas | A real photo of a lit tree slowly drifting closer, flickering sparkles on the tree (above and below the copy in portrait; in landscape on the photo's own bulbs and across its branches, moving with the photo's drift), very large centred copy | "Merry Christmas, ${Suburb}" · "With warm wishes / from the whole ${StoreName} team" |
| New Year's | Midnight sky, firework bursts, poster type | "Happy New Year" · "Thank you for a great year, ${Suburb}" · "Here's to a healthy year ahead / from the whole ${StoreName} team" |
| Australia Day | The Australian flag waving on a pole against a navy sky, in the flag colours | "26 January / Happy Australia Day, ${Suburb}" · "Enjoy the sunshine" · "Slip, slop, slap" with the pill "Stay sun safe this summer" |
| Valentine's Day | Blush pink, rising hearts | "14 February / Happy Valentine's Day, ${Suburb}" · "Look after the ones you love" · "and yourself, too" |
| Easter | A pastel meadow with bouncing painted eggs | "Happy Easter, ${Suburb}" · "Wishing you a restful long weekend" · "Take time to recharge" |
| Anzac Day | Solemn: a dawn glow, a single poppy, fades only | "25 April / Anzac Day" · "Lest we forget" · "Remembering together, ${Suburb}" |

The copy plays as **beats sharing 12 s** by default (Christmas 2 beats of 6 s, the others 3 of 4 s), driven by
the designs' CSS: the player draws the occasion once and sets no timers. On the player the beats play once through
and the last beat then stays on screen, fully drawn, while the decorations keep moving ("Playback" below); the
editor's preview and `loop=1` loop them. The playback duration to set in PH is
**13 s** at the defaults. Each beat's seconds on screen can be changed in the editor (`beats[i].dur`, 1–60 s); the
total is then their sum, played on keyframes `renderOccasion()` writes for those timings (`occasionTiming()`, same
fades as the designs), and the editor's Playback duration follows. At the defaults the designs' own CSS plays.
The seeded and mock data set every beat's seconds so that each season's beats total **7 s** (Christmas 3 + 4, New
Year's and Australia Day 2 + 2 + 3, Valentine's Day and Anzac Day 3 + 2 + 2, Easter 2 + 3 + 2; playback duration
**8 s**), as set on the live master: see `seed/README.md` → "Season timings".
`scene=<n>` (and the editor's paused preview, and the copy-fit audit) hold beat n still. Under reduced motion the
decorations stand still and the beats still change.

Copy is per pharmacy and per occasion (`content.occasions.<occasion>.beats[]`: `{label?, text, dur?}`, a label only on
the beats whose design has one), with defaults in `js/render.js` → `OCCASIONS`. The main line is rich text (line
breaks, bold, italic), the label plain. `${Suburb}` works in all six (with no suburb, `, ${Suburb}` is dropped,
comma included) and `${StoreName}` in Christmas and New Year's. A line too long for the design's text box is shrunk
to fit (`fitOccasion()` in `js/fit-text.js`). Copy saved in the earlier three-scene shape still plays: never
edited, as the new defaults; edited, beat by beat (each scene's headline as the main line, its accent line as the
label). No product or health claims.

Fonts (all SIL OFL 1.1) are self-hosted in `css/occasion-fonts.css` like Figtree and Material Symbols: Playfair
Display, Outfit, Big Shoulders Display, Archivo Black, Archivo, DM Serif Display, Fredoka and Cormorant Garamond
(`node tools/fetch-fonts.mjs occasions`). The Christmas background ships with the screen in
`css/occasion-media.css`, as a data: URL, so no screen calls out for it (the deploy writes each out as its own file).
The player loads both stylesheets only when a Seasonal promotion plays.

**Credit:** the Christmas photo (a lit Christmas tree) is by Olena Bohovyk on Unsplash
(`photo-1603561128963-5f4d971c4959`), used under the Unsplash Licence (free for commercial use).

## Run it locally

```bash
cd pharmacy-screen-promo-template/pharmacy-screen
npm run serve        # http://localhost:8080/pharmacy-screen.html?mockapi=1&device=TEST&promo=morning&orientation=portrait
npm test             # unit tests for the page: opening hours, tokens, live data, admin model (node --test, no install)
npm run test:units   # those plus the PH API proxy, the config API and the seed (no install)
npm run test:ui      # in headless Chromium: the screen on live data, and the copy-fit audit (needs Playwright)
npm run test:e2e     # end to end on the local stack: screen, admin editor, config API and proxy (needs Playwright)
npm run test:ci      # all three: what CI runs (about 30 s); `npm run check` is the same
npm run audit        # the copy-fit audit on its own, listing every problem (exit 1 on any)
npm run fonts        # re-download the self-hosted fonts into css/ (build time only; needs the internet)
```

No install step: the page is static ES modules, and the tools use Node's standard library (the browser and
end-to-end tests also use Playwright with Chromium, preinstalled in a Claude Code cloud session; elsewhere
`npm install --no-save playwright@1.56.1 && npx playwright install chromium` here). A local static server has
no `/api`, so run it with `mockapi=1`, point the `pharmacy-screen-api` meta tag at a running proxy and config
API (`config-api`: `npm run dev:seed`), or run everything on one origin with `node admin/tools/dev-server.mjs`
(`/pharmacy-screen.html?device=DEVICE-VIC-MP-001` once a PH API token is saved in the editor's Settings).

## Fixtures (`mockapi=1`)

With `?mockapi=1` the screen reads the seed fixtures below through the same polling and caching code, instead of
the proxy and the config read. The Location API proxy the screen calls lives beside this page in `ph-proxy/`,
the config read in `config-api/` (see their READMEs).

The config store is loaded with the same launch data by the seed in `seed/` (five pharmacies, the three default
promotions, the built-in templates and the 28-service library; see its README). Its tests check its fixtures
against `fixtures/config.json`, so the two cannot drift apart silently.

| File | What it holds |
|---|---|
| `fixtures/campaign-data.json` | Mock Location API `campaign_data` responses keyed by device ID, in the real shape (`store_location`, `store_info.opening_hours[]`, `store_info.address_info`; Beaumaris, `DEVICE-VIC-MP-001`, also `store_info.specialHours[]` in PH's shape). Devices: `TEST` (Beaumaris), `DEVICE-VIC-MP-001` … `DEVICE-VIC-MP-005` (the five launch pharmacies), `TEST-NO-SUBURB` (no suburb, for the `${Suburb}` blanking rule), `TEST-LATE-NIGHT` (a session crossing midnight). |
| `fixtures/config.json` | Config: promotions (`sale` with Beaumaris's sale copy, `morning`, `afternoon`, `closed`, `occasions` on Christmas, plus a fixture-only `custom-demo` that uses a custom template), custom templates (HTML with `${…}` tokens, scoped CSS, portrait/landscape backgrounds) and per-pharmacy branding, logo and content, keyed by store code. |

## Playback

On a player a promotion plays inside a rotation of campaigns, so it plays **once through and then stays on its last
scene**, fully drawn, until the player loads the next campaign:

- Scene promotions (Morning, Afternoon, Closed, custom templates): after the last scene's seconds there is no
  leaving fade and no return to the first scene. The held scene still follows the store's clock (the Open today
  bar, "Closed now") and new data, redrawn in place without restarting playback.
- Seasonal: the beats play once and the last beat stays visible, at the designs' default timings (the `.once`
  class in `js/occasions.js`: each beat runs once, the last on keyframes that end visible) and at custom ones
  (`occasionTiming(beats, {once: true})` in `js/render.js`). The decorations keep moving. A redraw on new data
  carries on from the seconds already played, so the beats don't start again.
- Playback starts from the first scene again when the page is loaded again, when it becomes visible again after
  being hidden (`visibilitychange`, `pageshow` from the back-forward cache), and when a season changes at midnight.
- `loop=1` keeps the earlier behaviour, looping forever, for a screen that shows one campaign only.

The admin editor's preview is unchanged: it keeps looping. `scene=<n>` still holds one scene still. Tested by
`test/ui/playback.test.mjs`, `test/ui/hold-every-campaign.test.mjs` (every campaign, portrait and landscape) and
`test/playback.test.mjs`.

## Query parameters

| Parameter | Meaning |
|---|---|
| `device` | Required. The screen's device ID. Without it the screen shows "Invalid screen URL". An unknown device, or a store with no config, shows "Screen not set up" with the device ID. |
| `promo` | The promo ID to play (`sale`, `morning`, `afternoon`, `closed`, `occasions`, …). Defaults to the first promotion. An unknown ID shows "Promotion not found". |
| `orientation` | `portrait` (default, 1080x1920) or `landscape` (1920x1080). |
| `loop` | `loop=1` loops the promotion forever, for a screen that shows this one campaign only. Without it the promotion plays once and holds its last scene ("Playback" below). |
| `scene` | Testing only: hold on scene *n* (0-based) instead of playing the promotion (an occasion: beat *n*, held still). |
| `now` | Testing only: the store's local time, e.g. `now=fri-18:45`, to see each "Open today" bar message. |
| `mockapi` | Testing only: `mockapi=1` uses the fixtures instead of the proxy and the config read. |
| `debug` | Testing only: `debug=1` shows the debug panel (device, store code, source, last fetch of store data and config, server used, store time, bar state) with a test time override (day and time, Apply / Real time). |
| `sw` / `nosw` | `nosw=1` turns off keeping the screen on the device (below). On `localhost` it is off unless `sw=1`. |

## Modules (`js/`)

Split so the admin editor's live preview can reuse the same code:

| Module | What it does |
|---|---|
| `hours.js` | Opening hours: parses `opening_hours[]` (sessions may cross midnight) and `special_hours[]` (dated exceptions), store time and date in `store_timezone`, the bar state (open, last 30 minutes, before opening, after closing; `storeStateOn` with special hours), time formats, the weekly hours rows and the upcoming special hours list. No DOM. |
| `tokens.js` | Token resolver: `${Suburb}` (blanked with its leading comma or line break when there is no suburb), `${StoreName}` (Occasions copy; the Location API's `store_name`, else the pharmacy name in the config: `storeModel()` in `render.js`), `${CloseTime}` / `${OpenTime}`, `${Phone}` / `${State}` / `${StoreCode}`, the editor's "+ Add token" list (`ADD_TOKENS`), template `${…}` slots, token values a pharmacy sets by hand (Settings → Tokens: `DATA_TOKENS`, `LIVE_TOKENS`, `SLOT_TOKENS`, `cleanTokens`, `applyTokens`; a set value wins over the store's data, except for the live `${StoreName}`, `${CloseTime}` and `${OpenTime}`, which cannot be set), and the rich-text sanitiser (bold, italic, line break, regular and accent spans only). No DOM. |
| `fit-text.js` | Panel geometry (triangle / arrow; the landscape arrow is 580px wide, tip at x=780, and the headline stays in its straight-sided part), `fitText()` (headline and content shrink to stay inside the panel), `fitOccasion()` (each occasion beat shrinks to stay inside its text box) and `auditScene()` (the overflow check). |
| `render.js` | Render engine: store model from `campaign_data` + config, promotion and template resolution (built-ins "Promotion scenes", "Opening hours" and the six occasion templates, `OCCASIONS`; custom templates with scoped CSS and backgrounds), scene sequence and durations, brand colours, `renderScene()`, and `renderOccasion()` (an occasion drawn whole, its copy as beats; `occasionCopy()` reads any saved shape). |
| `occasions.js` | The six approved Occasions designs: shared base CSS, each template's CSS and decoration markup (seeded scatter), unchanged from the design documents except that the copy comes from `render.js`. |
| `live-data.js` | The one shared Location API client (requirement 8): proxy and config calls, server failover, polling with one request in flight, change detection, the `localStorage` cache, the screen states, and the published-config mapping; `?mockapi=1` swaps in the fixture client. No DOM. |
| `player.js` | The page: reads the URL, gets live data through `live-data.js`, scales the screen to the viewport, plays the scenes once and holds the last (`loop=1`: loops them), restarts playback when the page is shown again or the season changes, re-renders on a data change and when the store's bar state changes (an occasion plays in CSS, with no timers), shows the error states, and exposes `window.pharmacyScreen` for the audit and the tests (`info.playback`, `info.held`). With `capture=1` (Download MP4's renderer, `config-api/src/video/`) it draws the first scene and waits, with no service worker, polling or clock ticks, until `window.pharmacyScreen.capture()` plays one loop (as `loop=1`) under the renderer's stepped clock; `occasion=<id>` plays that season of a Seasonal promotion whatever the date. |
| `debug-panel.js` | The `?debug=1` panel (styles in `css/debug.css`, loaded only then). |

`css/screen.css` is the prototype's screen stylesheet, unchanged: scene animations matched to the Beaumaris
videos (content fades out at scene end, headline fades in, icon tiles pop in one after another with labels
after, copy fades up, icons float with the outer and middle tiles in opposite phase), all off under
`prefers-reduced-motion` (except an occasion's beats, which keep changing). `css/occasion-fonts.css` and
`css/occasion-media.css` hold the Occasions fonts and the Christmas photo as data: URLs (generated; don't edit),
loaded by `js/player.js` only for a Seasonal promotion. `css/debug.css` carries Roboto for the debug panel.

## Deploy

The screen page, the admin app (`admin/`) and both back-end functions deploy together to our test
environment with one command, `npm run deploy` in `pharmacy-screen-promo-template/`; the URLs are in
that folder's README.

## Tools

- `tools/serve.mjs`: a static server for local runs, the audit and the UI tests.
- `tools/fetch-fonts.mjs`: writes `css/fonts.css` (Figtree for the screen), the Roboto block of `css/debug.css`
  (the debug panel) and `css/material-symbols.css` (Material Symbols Outlined, the filled weight-500 instance the
  screen draws, cut down to the editor's icons and the screen's own by `tools/subset-icons.py`, which needs Python 3
  with `pip install fonttools brotli`) as data: URLs, from Google Fonts at build time. Nothing is fetched from Google
  at runtime, so screens work behind firewalls; the deploy writes each font out as a `.woff2` file. Figtree and
  Roboto: SIL Open Font License 1.1; Material Symbols: Apache 2.0. It also writes
  `css/occasion-fonts.css` (the eight Occasions faces, SIL OFL 1.1); `node tools/fetch-fonts.mjs occasions` (or
  `screen`) rewrites just that part.
- `tools/ffmpeg-bin.mjs`: finds ffmpeg and ffprobe for Download MP4 on the local stack and in the tests
  (`FFMPEG_PATH` / `FFPROBE_PATH`, the `PATH`, then `tools/.ffmpeg/`); `--ensure` installs the npm builds
  (`ffmpeg-static`, `ffprobe-static`) into `tools/.ffmpeg/` when neither is found. `npm run test:e2e` runs it first,
  so the CI runner, which installs only Playwright's Chromium, gets them without a workflow change.
- `tools/overflow-audit.mjs`: renders every fixture store x promotion x scene x orientation at each bar
  state and fails (exit 1) if any copy leaves the brand panel, its content box or the screen. Also exports
  `runAudit({devices, orientations, times, config, browser})` for the copy-fit test.

## Tests

All of it runs in CI (`.github/workflows/pharmacy-screen-tests.yml`, installed from `ci/pharmacy-screen-tests.yml`;
`npm run test:ci`) on every pull request touching this folder and on every ticket landing on the train, and a red
run holds the train's deploy; see "CI" below.

**Unit** (`npm run test:units`)

- `test/hours.test.mjs`: the bar state (open, last 30 minutes, before opening, after closing, a closed day),
  sessions crossing midnight and the end of the week, the store time from a real instant in `store_timezone`
  (Melbourne, Perth, Brisbane; Melbourne's daylight-saving change), `${CloseTime}` / `${OpenTime}` for a session
  crossing midnight, time formats.
- `test/tokens.test.mjs`: `${Suburb}` replaced, and blanked with its comma or line break; the rich-text
  sanitiser; template slots; token values set by hand (settable names, cleaning, winning over the store data,
  and the config API refusing the same slots).
- `test/live-data.test.mjs`: failover, 20 s / 15 s polling, one request in flight, re-render only on change,
  network drop and restart from the cache, the error states, a device moving store, the published-config mapping
  (built with `config-api/src/publish.js`) and the proxy's `store_info.logo_url` (built with
  `ph-proxy/src/location-proxy.js`).
- `test/admin-model.test.mjs`: the editor's model, including promo ID and store code validation and uniqueness,
  and the tokens Settings → Tokens lists for a pharmacy (master template included).
- `test/handover-docs.test.mjs`: the handover docs (`../docs/`) list exactly the environment variables and query
  parameters the code reads, `.env.example` holds placeholders only, links resolve, and the template token list
  matches `js/tokens.js`.
- `ph-proxy/test/`, `config-api/test/` and `seed/test/` (their own `npm test`): token saved as ciphertext only,
  never logged or returned; admin-only writes; store codes and promo IDs unique (also under concurrent creates);
  the public screen read carrying no secret or admin field; the seed.

**Browser** (`npm run test:ui`)

- `test/ui/copy-fit.test.mjs`: the copy-fit audit (`tools/overflow-audit.mjs`, `runAudit()`): every seeded
  pharmacy x promotion x scene, portrait and landscape, at each "Open today" bar state, plus the `TEST-NO-SUBURB`
  and `TEST-LATE-NIGHT` fixtures; the Occasions promotion once per occasion, all six, every beat held once its fonts
  are in. It fails if any headline or content line leaves the brand panel, its content box or the screen, or any
  occasion line leaves the occasion's text box, and each failure names the device, store, promo, orientation,
  scene and bar state. Self-tests make one headline far too long and check that exactly that scene is named, and
  show that a long occasion line is shrunk to fit while far too much copy fails, naming the beat.
- `test/ui/first-load.test.mjs`: a scene shown again reuses its fitted sizes (no fit loop) and changed copy is
  fitted afresh; the cut-down icon font still draws the editor's icons and `tv_off` as icons; a Morning promotion
  loads neither the Seasonal stylesheets nor the debug panel's, and `debug=1` loads Roboto with the panel.
- `test/ui/offline-cache.test.mjs`: see "Kept on the device" above.
- `test/ui/landscape-hours.test.mjs`: the landscape opening hours screen: the hours card fills most of the screen
  right of the brand arrow, its rows are 56px or larger, a day with two sessions stays on one line inside its row,
  the holiday note sits under the card, and portrait is unchanged.
- `test/ui/live-screen.test.mjs`: the screen in Chromium with the proxy and config read routed: the right store's
  suburb, hours and phone; changed hours at the next store poll (every 20 s) without a reload; network killed and restored; unknown,
  unconfigured and missing device; offline badge; the debug panel at every bar state; no request leaves the page's
  own origin (self-hosted fonts).
- `test/ui/hold-every-campaign.test.mjs`: every campaign holds its last frame, in portrait and in landscape: Morning,
  Afternoon, Closed, the custom-template demo, and Seasonal in the Fallback and each of the six seasons (mock data),
  plus Seasonal on the config API's published config (the Fallback and Christmas). Played through on real time, each
  is checked as it holds and again 3 s later: on its last scene (Seasonal: its last beat; the Fallback: all three
  beats), no leaving fade, copy on screen and the frame not black.

**End to end** (`npm run test:e2e`, on `admin/tools/dev-server.mjs` with a PH API token and two base URLs saved)

- `test/e2e/full-stack.test.mjs`: a mock device playing every promotion in both orientations through the real
  proxy and config API (each scene audited); an edit in the admin editor reaching a running screen at its next
  config poll (every 15 s), without a reload; the proxy failing over to the second base URL when the first refuses, and a
  fresh screen showing "Screen data could not load" when both do; an offline screen keeping its last good data,
  restarting from the cache and going live again; security: the settings read shows only "set" and the last 4,
  the token is stored only as ciphertext, device and screen reads carry no token, envelope, base URL or audit
  field, every write endpoint refuses a non-admin (403) and an anonymous caller, and the token appears in no
  response, log line or audit entry of the whole run.
- `admin/test/editor.e2e.mjs`: the editor's own end-to-end tests (see `admin/README.md`).

**Deliberately breaking it**: change `LAST_MINUTES` or the timezone handling in `js/hours.js` and the hours tests
fail; make a headline too long to fit (in `fixtures/config.json`, or in the editor) and the copy-fit audit fails
naming the scene.

### CI

`ci/pharmacy-screen-tests.yml` runs `test:units`, `test:ui` and `test:e2e` on Ubuntu 24.04 with Playwright
1.56.1, on pull requests touching `pharmacy-screen-promo-template/**`, on pushes to the train
(`deploy/pharmacy-screen-promo-template`) and by hand. The backlog pipeline cannot add files under
`.github/workflows/`, so it ships here; it is installed as `.github/workflows/pharmacy-screen-tests.yml` and
listed in `TRAIN_TEST_WORKFLOWS` in `backlog-tracker/scripts/run-backlog-automation.js` (20 Nov 2026), so it
gates deployment. Keep the two copies identical when changing it.

## Admin editor (`admin/`)

The signed-in editor for pharmacies, promotions, templates and scenes, saving to the config API, with a live
preview drawn by `js/render.js`. See `admin/README.md`. `npm test` here also runs the editor's model tests
(`test/admin-model.test.mjs`); its end-to-end tests are `cd admin && npm test` (also part of `npm run test:e2e`).
