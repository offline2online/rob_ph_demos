# Demand charts (frontend)

Demand health and Targeting & scheduling maturity of the Retail Media Performance tab, as a self-contained content-frame module (no header, sidebar, breadcrumb or `position: fixed`). Spec: project README §6 and §7; Requirements §4.

| Panel | Layout | Source |
|---|---|---|
| Advertisers (top 10, Show all) | Demand health, full width | `advertisers` |
| Maturity ladder · Scheduling | side by side | `maturity` (`ladder`, `scheduling`) |
| Progress over time · Variables in use | side by side | `maturity` (`overTime`, `variablesInUse`) |
| Advertiser targeting & scheduling table | full width | `maturity` (`table`) |

## Files
- `demand-charts.js` / `demand-charts.css` — `DemandCharts.mount(el, { fetchJson })` returns `{ setFilters, refresh, destroy }`; the shell calls `setFilters()` on Apply. Pure model builders are exported for the tests.
- `demand-fixtures.js` — twelve fixture advertisers in the endpoint shapes, plus a `fetchJson` that supports `state: 'empty' | 'error'`. The maturity fixture applies the same table filters and ordering as `src/routes/maturity.js`.
- `demand-charts-demo.html` — test page; `?state=loading|empty|error` previews the other states.
- `test/demand-charts.test.js` — `node --test Retail-media-insights/frontend/test/*.test.js` (offline, no dependencies).

## Behaviour
- **Advertisers**: Deals on hover is headed "Name (DSP): deals on" and lists deals with type. No warning chips, no highlighted rows. When the range exceeds the settled-bid retention, Slots won hovers state the retention.
- **Ladder and Scheduling**: bars show only the level and count; hovering lists advertisers as "Name (DSP)" (Personalised adds the personalisation type; Uses scheduling adds scheduled campaigns and schedules). Clicking a bar filters the table; clicking it again clears it.
- **Progress over time**: stacked area, three bands only, Week / Month control.
- **Variables in use**: ranked bars coloured Localised / Personalised, Localised / Personalised filter. Daypart is dropped client-side as well as by the back end.
- **Table**: sorted Personalised first then revenue; Maturity level, Variable and Scheduling filters (also set by the charts) and a "Clear filter" chip while any is active. No Next step column.
- Scheduling text reads "Scheduled · 3 of 4 campaigns": the endpoint does not say whether a schedule is a daypart, so "Dayparted" is not used.
- Chart-control and table-filter changes re-request `maturity` with `granularity`, `kind`, `level`, `variable`, `scheduling`; page filters pass through unchanged. Each panel has loading, empty and error (Retry) states.
