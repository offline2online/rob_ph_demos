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
npm test             # unit tests: opening hours, tokens, live data (node --test, no install)
npm run test:ui      # the screen on live data in headless Chromium: the ticket's test steps (needs Playwright)
npm run audit        # overflow audit in headless Chromium (needs Playwright)
npm run fonts        # re-download the self-hosted fonts into css/ (build time only; needs the internet)
```

No install step: the page is static ES modules, and the tools use Node's standard library (`test:ui` and the
audit also use Playwright with Chromium, preinstalled in a Claude Code cloud session). A local static server has
no `/api`, so run it with `mockapi=1`, or point the `pharmacy-screen-api` meta tag at a running proxy and config
API (`config-api`: `npm run dev:seed`).

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

## Tools

- `tools/serve.mjs`: a static server for local runs, the audit and the UI tests.
- `tools/fetch-fonts.mjs`: writes `css/fonts.css` (Figtree for the screen, Roboto for the debug panel) and
  `css/material-symbols.css` (Material Symbols Outlined, the filled weight-500 instance the screen draws, every
  icon) as data: URLs, from Google Fonts at build time. Nothing is fetched from Google at runtime, so screens work
  behind firewalls. Figtree and Roboto: SIL Open Font License 1.1; Material Symbols: Apache 2.0.
- `tools/overflow-audit.mjs`: renders every fixture store x promotion x scene x orientation at each bar
  state and fails (exit 1) if any copy leaves the brand panel, its content box or the screen.

## Tests

- `test/hours.test.mjs`, `test/tokens.test.mjs`: opening hours and tokens.
- `test/live-data.test.mjs`: failover, 30 s / 60 s polling, one request in flight, re-render only on change,
  network drop and restart from the cache, the error states, a device moving store, the published-config mapping
  (built with `config-api/src/publish.js`) and the proxy's `store_info.logo_url` (built with
  `ph-proxy/src/location-proxy.js`).
- `test/ui/live-screen.test.mjs`: the screen in Chromium with the proxy and config read routed: the right store's
  suburb, hours and phone; changed hours within 30 s without a reload; network killed and restored; unknown,
  unconfigured and missing device; offline badge; the debug panel at every bar state; no request leaves the page's
  own origin (self-hosted fonts).
