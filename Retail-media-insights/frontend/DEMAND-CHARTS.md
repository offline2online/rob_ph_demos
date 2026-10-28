# Demand charts (frontend)

Demand health and Targeting & scheduling maturity of the Retail Media Performance tab, as a self-contained content-frame module (no header, sidebar, breadcrumb or `position: fixed`). Spec: project README §6 and §7; Requirements §4.

| Panel | Layout, top to bottom | Source |
|---|---|---|
| Advertisers (top 10, "Show all N advertisers"), with a Maturity level column (level chip plus scheduling tile) and a Pacing column | Demand health, full width | `advertisers` + `maturity` (`table`, joined by advertiser) |
| Variables in use | full width | `maturity` (`variablesInUse`) |
| Progress over time | full width, last; whole history | `maturity` (`overTime`) |

Each section opens with an 18px/600 header: teal Material Symbol (`handshake`, `stairs`), title, ⓘ, 1px divider.

## Files
- `demand-charts.js` / `demand-charts.css` — `DemandCharts.mount(el, { fetchJson, filters })` returns `{ setFilters, refresh, destroy }`; the shell calls `setFilters()` on Apply. Pure model builders are exported for the tests.
- `test/demand-charts.test.js` — `npm test` in `Retail-media-insights` (offline). It runs on the real route handlers through `local-api.js`; there are no fixtures.
- `../test/ui/demand-charts.test.js` — `npm run test:ui`: layout order, colours, hovers, toggles, empty states and 390px in Chromium.

## Behaviour
- **Advertisers**: the Advertiser cell is the name only (bold); Deals on reads "3 deals" / "1 deal" (dotted underline, hover headed "Name (DSP): deals on", listing "Deal name · Deal type") or "0 deals" with no hover. A link-style button under the table reads "Show all 11 advertisers" and, expanded, "Show top 10"; it appears only above ten. There is no Slots won column (removed 28 Oct 2026). The iROAS column was removed from launch on 27 Oct 2026 (Sales uplift is Future work, see the README); Columns end Effective CPM, Pacing, Maturity level.
- **Ladder and Scheduling charts removed (27 Oct 2026)**: they duplicated the Maturity level and Scheduling columns, and Progress over time already shows the level mix. The `maturity` endpoint still returns `ladder` and `scheduling` (API unchanged); the filters below replace the clicks.
- **Variables in use**: full width, Localised / Personalised control defaulting to Localised (no All; re-requests `kind`). Daypart is dropped client-side as well as by the back end.
- **Table**: sorted by Revenue (highest first) by default, every heading sortable (the chosen sort survives filter changes); no filter dropdowns (sort by a heading); clicking a Variables in use bar filters by that variable, with a "Clear filter" chip while it is active. Cells: name only; level chip with swatch, plus a scheduling tile "Scheduled" beside it when campaigns are scheduled (none otherwise); Pacing as a whole-number % for programmatic guaranteed advertisers (hover lists each PG deal) or "–". Empty: "No advertisers match this filter."
- **Progress over time**: stacked area, three bands, Week / Month control defaulting to Month ("Jun"). A "Showing Jun 2026 – Oct 2026 · by month · whole history" line above the legend states the period covered. Shows the whole history and does not follow the date range (the back end ignores it). Hover: the period, then each level's %. Redrawn at the panel's width on resize.
- Chart-control and table-filter changes re-request `maturity` with `granularity`, `kind`, `level`, `variable`, `scheduling`; page filters pass through unchanged. Each panel has loading, empty and error (Retry) states.
