# Pharmacy screen

The in-store screen page for the **Pharmacy Screen Promo Template** project: one templated web page that the
Personalisation Hub player loads as a campaign URL, in place of the Beaumaris MP4s. It renders exactly what the
concept prototype renders (portrait 1080x1920 with the brand triangle, landscape 1920x1080 with the brand arrow).

```
pharmacy-screen.html?device=${UniqueDeviceID}&promo=<promo id>&orientation=<portrait|landscape>
```

The PH player swaps `${UniqueDeviceID}` for the screen's own ID. The URL never carries a store code.

## Run it locally

```bash
cd pharmacy-screen-promo-template/pharmacy-screen
npm run serve        # http://localhost:8080/pharmacy-screen.html?device=TEST&promo=morning&orientation=portrait
npm test             # unit tests: opening hours, tokens (node --test, no install)
npm run audit        # overflow audit in headless Chromium (needs Playwright)
```

No install step: the page is static ES modules, and the tools use Node's standard library (the audit also
uses Playwright with Chromium, preinstalled in a Claude Code cloud session).

## Data (fixtures for now)

This build reads store data and config from local fixtures; live data (the back-end proxy and the public
config read endpoint) is wired in a later ticket, replacing `loadData()` in `js/player.js` only. The
Location API proxy the screen will call lives beside this page in `ph-proxy/` (see its README).

| File | What it holds |
|---|---|
| `fixtures/campaign-data.json` | Mock Location API `campaign_data` responses keyed by device ID, in the real shape (`store_location`, `store_info.opening_hours[]`, `store_info.address_info`). Devices: `TEST` (Beaumaris), `DEVICE-VIC-MP-001` … `DEVICE-VIC-MP-005` (the five launch pharmacies), `TEST-NO-SUBURB` (no suburb, for the `${Suburb}` blanking rule), `TEST-LATE-NIGHT` (a session crossing midnight). |
| `fixtures/config.json` | Config: promotions (`morning`, `afternoon`, `closed`, plus a fixture-only `custom-demo` that uses a custom template), custom templates (HTML with `${…}` tokens, scoped CSS, portrait/landscape backgrounds) and per-pharmacy branding, logo and content, keyed by store code. |

## Query parameters

| Parameter | Meaning |
|---|---|
| `device` | Required. The screen's device ID. Without it the screen shows "Invalid screen URL". An unknown device, or a store with no content, shows "Screen not set up" with the device ID. |
| `promo` | The promo ID to play (`morning`, `afternoon`, `closed`, …). Defaults to the first promotion. An unknown ID shows "Promotion not found". |
| `orientation` | `portrait` (default, 1080x1920) or `landscape` (1920x1080). |
| `scene` | Testing only: hold on scene *n* (0-based) instead of playing the loop. |
| `now` | Testing only: the store's local time, e.g. `now=fri-18:45`, to see each "Open today" bar message. |

## Modules (`js/`)

Split so the admin editor's live preview can reuse the same code:

| Module | What it does |
|---|---|
| `hours.js` | Opening hours: parses `opening_hours[]` (sessions may cross midnight), store time in `store_timezone`, the bar state (open, last 30 minutes, before opening, after closing), time formats, the weekly hours rows. No DOM. |
| `tokens.js` | Token resolver: `${Suburb}` (blanked with its leading comma or line break when there is no suburb), `${CloseTime}` / `${OpenTime}`, template `${…}` slots, and the rich-text sanitiser (bold, italic, line break, regular and accent spans only). No DOM. |
| `fit-text.js` | Panel geometry (triangle / arrow), `fitText()` (headline and content shrink to stay inside the panel) and `auditScene()` (the overflow check). |
| `render.js` | Render engine: store model from `campaign_data` + config, promotion and template resolution (built-ins "Promotion scenes" and "Opening hours", custom templates with scoped CSS and backgrounds), scene sequence and durations, brand colours, `renderScene()`. |
| `player.js` | The page: reads the URL, loads the fixtures, scales the screen to the viewport, plays the scenes, re-renders the bar when the store's state changes, and exposes `window.pharmacyScreen` for the audit. |

`css/screen.css` is the prototype's screen stylesheet, unchanged: scene animations matched to the Beaumaris
videos (content fades out at scene end, headline fades in, icon tiles pop in one after another with labels
after, copy fades up, icons float with the outer and middle tiles in opposite phase), all off under
`prefers-reduced-motion`.

## Tools

- `tools/serve.mjs`: a static server for local runs and the audit.
- `tools/overflow-audit.mjs`: renders every fixture store x promotion x scene x orientation at each bar
  state and fails (exit 1) if any copy leaves the brand panel, its content box or the screen.

Fonts (Figtree, Material Symbols) still load from Google Fonts here; self-hosting them is part of the
live-data ticket.
