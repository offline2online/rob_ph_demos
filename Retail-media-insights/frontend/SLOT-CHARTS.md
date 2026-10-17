# Slot charts (frontend)

The four display-type charts of the Retail Media Performance tab, as a self-contained content-frame module (no header, sidebar, breadcrumb or `position: fixed` — the tab shell and HQ Admin provide those).

| Panel | Row | Source |
|---|---|---|
| Slot value | Slot value (left) | `slot-value` |
| Slot allocation | Slot allocation (right) | `slot-allocation` |
| Missed revenue / fill | Row 2 (left) | `missed-revenue` |
| Yield | Row 2 (right) | `yield?dealType=` |

All four also read `display-types` (the shared hover card). Spec: project README §3, §4, §5 and "Page filters"; Requirements §4.

## Files

- `slot-charts.js` / `slot-charts.css` — the module. `SlotCharts.mount(el, { fetchJson, filters })` returns `{ setFilters, refresh, destroy }`; the shell calls `setFilters()` on Apply. Pure helpers (ordering, hover models, formatting) are exported for the tests. Every data-bearing node is built with `createElement`/`textContent`, and styles are set through the CSSOM, so it runs under a `style-src 'self'` policy.
- `test/slot-charts.test.js` — `npm test` in `Retail-media-insights` (offline). The tests run on what the real route handlers return, through `local-api.js`; there are no fixtures.

`fetchJson(endpoint, params)` receives the page filters (`dateFrom`, `dateTo`, `storeIds`, `displayTypeIds`, `advertiserIds`) and, for `yield`, `dealType`. The responses carry no `meta`; the date range in the hovers is the page's own filter. The component sorts display types into shopper-journey order (by `iabZone`) and DSPs into DV360, The Trade Desk, Amazon DSP itself.

## Response shapes (read from `src/routes/` and `src/display-types.js`)

```
display-types    { rows: [{ id, name, description?, connectedDisplays: {displays, stores}, iabZone?, operatingHours? ("24 hours" | "Store opening hours"),
                   touchPoint?, canvas?: {width, height, label}, displayOrientation?, creativeFormats?: string[],
                   averages?: { averageFootfallPerDay?, averageVisibility?, shareOfLoopTime?: {percent, advertiserSlotSeconds, loopSeconds},
                                averageAssumedViewsPerSlotPerDay?, averagesCover: {displays, stores, dateFrom, dateTo, label} } }] }
slot-value       { rows: [{ …the display-types card…, floorCpm, effectiveCpm, perSlotPerDay, averageAssumedViewsPerSlotPerDay?, advertiserSlotsSoldShare?,
                   totals: { earnedRevenue, assumedViews, days, perDay, advertiserSlots } }], network }
slot-allocation  { rows: [{ id, name, connectedDisplays, slotsPerLoop, loopSeconds, averageSlotSeconds,
                   advertiserSlots: {count, avgSeconds, totalSeconds, percentOfLoop, slotShareOfLoopPercent}, ownContentSlots: {…same…},
                   advertiserSlotsSoldPercent }] }
missed-revenue   { rows: [{ id, name, connectedDisplays: {displays, stores}, floorCpm, fillPercent, slotsSold, slotsUnsold, slotsOffline, slotsTotal,
                   unsoldValueAtFloor, downtimeLostRevenue, slotsOfflineLost, totalMissed }],
                   total: { name, connectedDisplays, floorCpm: {min, max}, …same counts and values, summed } }
yield            { dealType, rows: [{ dsp, effectiveCpm /* null: no delivery */, earnedRevenue, assumedViews }] }
```

Rules the component relies on (and the tests check on the real output): `sold + unsold + offline = slotsTotal`; the parts are rounded once by the back end, so `unsoldValueAtFloor + downtimeLostRevenue = totalMissed` and the front end never re-rounds them; loop percentages are the back end's `percentOfLoop` / `slotShareOfLoopPercent`; `perSlotPerDay = effectiveCpm × averageAssumedViewsPerSlotPerDay ÷ 1,000 × advertiserSlotsSoldShare` (the hover shows that line); `advertiserSlots.count + ownContentSlots.count = slotsPerLoop`. A DSP with no delivery has `effectiveCpm: null` and reads "No delivery".

## Behaviour notes

- **No IAB zone label on any chart face, no specific opening times anywhere.** The zone appears only in the hover card; `operatingHours` is shown only if it is exactly "24 hours" or "Store opening hours".
- **Slot value** — Effective CPM (default, with dashed floor markers) or Per slot per day (markers hidden). Hover = display type card + Effective CPM / Floor CPM / Per slot per day with network totals.
- **Slot allocation** — rows at 85% or more sold are the only amber signal. Hovers on Slots per loop, Advertiser slots and Own-content slots show the loop arithmetic (`8 × 6s = 48s (80% of the loop)`).
- **Missed revenue / fill** — bar length is missed revenue (unsold amber + downtime red) on one shared scale; fill % sits under the value. **Open question for the tester:** if the bar should encode fill % instead, say so on the ticket.
- **Yield** — Deal type filter (Programmatic guaranteed default); no Direct bar.
- Hover cards are absolutely positioned inside the frame and clamped to the visible viewport; they also open on keyboard focus and touch. Panels stack below 900px. Each panel has loading, empty and error (with Retry) states.
