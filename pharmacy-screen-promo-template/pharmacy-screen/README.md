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
   `store_info.address_info` (`suburb` for `${Suburb}`, `address`, `phone_number`) and `store_info.logo_url`
   (the store logo once the Location API returns it, PH-181; until then the config logo).
2. **Config by store code**, from the public config read (`config-api/`): `GET /api/screens/{store_code}`, using the
   store code the proxy returned, never anything in the URL. `js/live-data.js` maps the published config onto the
   render engine's shape (`colours` → `brand`, `template.kind` → `base`, content keyed by promo ID).
3. **Servers**: `<meta name="pharmacy-screen-api" content="">` in `pharmacy-screen.html` lists the base URLs, each
   serving both paths (comma-separated; empty means the page's own origin, through the Hosting rewrites). The
   last server that answered is tried first, then the others in order, one request at a time (8 s timeout each).
4. **Polling**: store data every 30 s, config every 60 s, one request in flight per endpoint. The screen re-renders
   only when what it shows changed (new hours reach it within 30 s, no reload), and re-checks the "Open today" bar
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
| `fixtures/campaign-data.json` | Mock Location API `campaign_data` responses keyed by device ID, in the real shape (`store_location`, `store_info.opening_hours[]`, `store_info.address_info`). Devices: `TEST` (Beaumaris), `DEVICE-VIC-MP-001` … `DEVICE-VIC-MP-005` (the five launch pharmacies), `TEST-NO-SUBURB` (no suburb, for the `${Suburb}` blanking rule), `TEST-LATE-NIGHT` (a session crossing midnight). |
| `fixtures/config.json` | Config: promotions (`morning`, `afternoon`, `closed`, plus a fixture-only `custom-demo` that uses a custom template), custom templates (HTML with `${…}` tokens, scoped CSS, portrait/landscape backgrounds) and per-pharmacy branding, logo and content, keyed by store code. |

## Query parameters

| Parameter | Meaning |
|---|---|
| `device` | Required. The screen's device ID. Without it the screen shows "Invalid screen URL". An unknown device, or a store with no config, shows "Screen not set up" with the device ID. |
| `promo` | The promo ID to play (`morning`, `afternoon`, `closed`, …). Defaults to the first promotion. An unknown ID shows "Promotion not found". |
| `orientation` | `portrait` (default, 1080x1920) or `landscape` (1920x1080). |
| `scene` | Testing only: hold on scene *n* (0-based) instead of playing the loop. |
| `now` | Testing only: the store's local time, e.g. `now=fri-18:45`, to see each "Open today" bar message. |
| `mockapi` | Testing only: `mockapi=1` uses the fixtures instead of the proxy and the config read. |
| `debug` | Testing only: `debug=1` shows the debug panel (device, store code, source, last fetch of store data and config, server used, store time, bar state) with a test time override (day and time, Apply / Real time). |

## Modules (`js/`)

Split so the admin editor's live preview can reuse the same code:

| Module | What it does |
|---|---|
| `hours.js` | Opening hours: parses `opening_hours[]` (sessions may cross midnight), store time in `store_timezone`, the bar state (open, last 30 minutes, before opening, after closing), time formats, the weekly hours rows. No DOM. |
| `tokens.js` | Token resolver: `${Suburb}` (blanked with its leading comma or line break when there is no suburb), `${CloseTime}` / `${OpenTime}`, template `${…}` slots, and the rich-text sanitiser (bold, italic, line break, regular and accent spans only). No DOM. |
| `fit-text.js` | Panel geometry (triangle / arrow), `fitText()` (headline and content shrink to stay inside the panel) and `auditScene()` (the overflow check). |
| `render.js` | Render engine: store model from `campaign_data` + config, promotion and template resolution (built-ins "Promotion scenes" and "Opening hours", custom templates with scoped CSS and backgrounds), scene sequence and durations, brand colours, `renderScene()`. |
| `live-data.js` | The one shared Location API client (requirement 8): proxy and config calls, server failover, polling with one request in flight, change detection, the `localStorage` cache, the screen states, and the published-config mapping; `?mockapi=1` swaps in the fixture client. No DOM. |
| `player.js` | The page: reads the URL, gets live data through `live-data.js`, scales the screen to the viewport, plays the scenes, re-renders on a data change and when the store's bar state changes, shows the error states, and exposes `window.pharmacyScreen` for the audit and the tests. |
| `debug-panel.js` | The `?debug=1` panel (styles in `css/debug.css`, loaded only then). |

`css/screen.css` is the prototype's screen stylesheet, unchanged: scene animations matched to the Beaumaris
videos (content fades out at scene end, headline fades in, icon tiles pop in one after another with labels
after, copy fades up, icons float with the outer and middle tiles in opposite phase), all off under
`prefers-reduced-motion`.

## Deploy

The screen page, the admin app (`admin/`) and both back-end functions deploy together to our test
environment with one command, `npm run deploy` in `pharmacy-screen-promo-template/`; the URLs are in
that folder's README.

## Tools

- `tools/serve.mjs`: a static server for local runs, the audit and the UI tests.
- `tools/fetch-fonts.mjs`: writes `css/fonts.css` (Figtree for the screen, Roboto for the debug panel) and
  `css/material-symbols.css` (Material Symbols Outlined, the filled weight-500 instance the screen draws, every
  icon) as data: URLs, from Google Fonts at build time. Nothing is fetched from Google at runtime, so screens work
  behind firewalls. Figtree and Roboto: SIL Open Font License 1.1; Material Symbols: Apache 2.0.
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
  sanitiser; template slots.
- `test/live-data.test.mjs`: failover, 30 s / 60 s polling, one request in flight, re-render only on change,
  network drop and restart from the cache, the error states, a device moving store, the published-config mapping
  (built with `config-api/src/publish.js`) and the proxy's `store_info.logo_url` (built with
  `ph-proxy/src/location-proxy.js`).
- `test/admin-model.test.mjs`: the editor's model, including promo ID and store code validation and uniqueness.
- `ph-proxy/test/`, `config-api/test/` and `seed/test/` (their own `npm test`): token saved as ciphertext only,
  never logged or returned; admin-only writes; store codes and promo IDs unique (also under concurrent creates);
  the public screen read carrying no secret or admin field; the seed.

**Browser** (`npm run test:ui`)

- `test/ui/copy-fit.test.mjs`: the copy-fit audit (`tools/overflow-audit.mjs`, `runAudit()`): every seeded
  pharmacy x promotion x scene, portrait and landscape, at each "Open today" bar state, plus the `TEST-NO-SUBURB`
  and `TEST-LATE-NIGHT` fixtures (882 scenes). It fails if any headline or content line leaves the brand panel,
  its content box or the screen, and each failure names the device, store, promo, orientation, scene and bar
  state. A self-test makes one headline far too long and checks that exactly that scene is named.
- `test/ui/live-screen.test.mjs`: the screen in Chromium with the proxy and config read routed: the right store's
  suburb, hours and phone; changed hours within 30 s without a reload; network killed and restored; unknown,
  unconfigured and missing device; offline badge; the debug panel at every bar state; no request leaves the page's
  own origin (self-hosted fonts).

**End to end** (`npm run test:e2e`, on `admin/tools/dev-server.mjs` with a PH API token and two base URLs saved)

- `test/e2e/full-stack.test.mjs`: a mock device playing every promotion in both orientations through the real
  proxy and config API (each scene audited); an edit in the admin editor reaching a running screen at its next
  60 s config poll, without a reload; the proxy failing over to the second base URL when the first refuses, and a
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
