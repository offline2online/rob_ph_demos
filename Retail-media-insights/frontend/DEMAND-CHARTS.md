# Demand charts (frontend)

Demand health and Targeting & scheduling maturity of the Retail Media Performance tab, as a self-contained content-frame module (no header, sidebar, breadcrumb or `position: fixed`). Spec: project README §6 and §7; Requirements §4.

| Panel | Layout, top to bottom | Source |
|---|---|---|
| Advertisers (top 10, "Show all N advertisers") | Demand health, full width | `advertisers` |
| Maturity ladder · Scheduling | side by side, stacking at narrow widths | `maturity` (`ladder`, `scheduling`) |
| Variables in use | full width | `maturity` (`variablesInUse`) |
| Advertiser targeting & scheduling table | full width | `maturity` (`table`) |
| Progress over time | full width, last; whole history | `maturity` (`overTime`) |

Each section opens with an 18px/600 header: teal Material Symbol (`handshake`, `stairs`), title, ⓘ, 1px divider.

## Files
- `demand-charts.js` / `demand-charts.css` — `DemandCharts.mount(el, { fetchJson, filters })` returns `{ setFilters, refresh, destroy }`; the shell calls `setFilters()` on Apply. Pure model builders are exported for the tests.
- `test/demand-charts.test.js` — `npm test` in `Retail-media-insights` (offline). It runs on the real route handlers through `local-api.js`; there are no fixtures.
- `../test/ui/demand-charts.test.js` — `npm run test:ui`: layout order, colours, hovers, toggles, empty states and 390px in Chromium.

## Behaviour
- **Advertisers**: the Advertiser cell is the name only (bold); Deals on reads "3 deals" / "1 deal" (dotted underline, hover headed "Name (DSP): deals on", listing "Deal name · Deal type") or "0 deals" with no hover. A link-style button under the table reads "Show all 11 advertisers" and, expanded, "Show top 10"; it appears only above ten. When the range exceeds the settled-bid retention, Slots won hovers state the retention.
- **Ladder and Scheduling**: bars show the level and a bold count; the ladder runs Default only → Localised → Personalised top to bottom (#d9d9d9, #6aa7e0, #174a8c). Hovering lists "Name (DSP)" (Personalised adds the types after " · "; Uses scheduling adds "3 of 4 campaigns, 5 schedules"). Clicking a bar filters the table; clicking it again clears it.
- **Variables in use**: full width, Localised / Personalised control defaulting to Localised (no All; re-requests `kind`). Daypart is dropped client-side as well as by the back end.
- **Table**: sorted Personalised first then revenue; three unlabelled selects (aria-labelled, with chevrons) for level, variable and scheduling, also set by the charts, and a "Clear filter" chip first while any is active. Cells: name only; level chip with swatch; variable chips or a muted "None"; scheduling chip "Dayparted · n of m campaigns" or a muted "Not used". Empty: "No advertisers match this filter."
- **Progress over time**: stacked area, three bands, Week / Month control defaulting to Month ("Jun"). Shows the whole history and does not follow the date range (the back end ignores it). Hover: the period, then each level's %. Redrawn at the panel's width on resize.
- Chart-control and table-filter changes re-request `maturity` with `granularity`, `kind`, `level`, `variable`, `scheduling`; page filters pass through unchanged. Each panel has loading, empty and error (Retry) states.
