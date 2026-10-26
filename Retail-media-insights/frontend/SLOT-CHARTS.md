# Slot charts (frontend)

The four display-type charts of the Retail Media Performance tab, as a self-contained content-frame module (no header, sidebar, breadcrumb or `position: fixed` — the tab shell and HQ Admin provide those).

| Panel | Row | Source |
|---|---|---|
| Slot value | Slot value (left) | `slot-value` |
| Slot allocation | Slot allocation (right) | `slot-allocation` |
| Missed revenue & fill | Row 2 (left) | `missed-revenue` |
| Yield | Row 2 (right) | `yield` (optional `dealType`) |

All four also read `display-types` (the shared hover card). Spec: project README §3, §4, §5 and "Page filters"; Requirements §4.

## Files

- `slot-charts.js` / `slot-charts.css` — the module. `SlotCharts.mount(el, { fetchJson, filters })` returns `{ setFilters, refresh, destroy }`; the shell calls `setFilters()` on Apply. Pure helpers (ordering, hover models, formatting) are exported for the tests. Every data-bearing node is built with `createElement`/`textContent`, and styles are set through the CSSOM, so it runs under a `style-src 'self'` policy.
- `test/slot-charts.test.js` — `npm test` in `Retail-media-insights` (offline). The tests run on what the real route handlers return, through `local-api.js`; there are no fixtures.

`fetchJson(endpoint, params)` receives the page filters (`dateFrom`, `dateTo`, `storeIds`, `displayTypeIds`, `advertiserIds`) and, for `yield`, `dealType`. The responses carry no `meta`; the date range in the hovers is the page's own filter. The component sorts Slot value by the selected metric (Effective CPM or Per slot per day), highest first, ties in shopper-journey order (by `iabZone`); Slot allocation uses the same order and redraws when the toggle changes. Missed revenue & fill uses the same order too (All display types last) and Yield by effective CPM (highest first).

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

Rules the component relies on (and the tests check on the real output): `sold + unsold + offline = slotsTotal`; the parts are rounded once by the back end, so `unsoldValueAtFloor + downtimeLostRevenue = totalMissed` and the front end never re-rounds them; loop percentages are the back end's `percentOfLoop` / `slotShareOfLoopPercent`; `perSlotPerDay = effectiveCpm × averageAssumedViewsPerSlotPerDay ÷ 1,000 × advertiserSlotsSoldShare` (the hover shows that line); `advertiserSlots.count + ownContentSlots.count = slotsPerLoop`. A DSP with no delivery has `effectiveCpm: null` and is left out of the Yield chart.

## Behaviour notes

- **No IAB zone label on any chart face, no specific opening times anywhere.** The zone appears only in the hover card; `operatingHours` is shown only if it is exactly "24 hours" or "Store opening hours".
- **Slot value** — Effective CPM (default; legend: teal "Effective CPM" and a dashed #eda100 "Floor CPM") or Revenue per available slot (legend: "Earned revenue per advertiser slot per day", markers hidden). Value labels read **$9.01** CPM / **$3.05** per available slot per day. Hover = display type card + Effective CPM / Floor CPM / Revenue per available slot with network totals, the Fill % and the "How it adds up" line.
- **Slot allocation** — rows at 85% or more sold are the only amber signal; the sold bar is 90×6px. Hovers are headed "<type>: loop", "<type>: advertiser slots" and "<type>: own-content slots" and show the loop arithmetic (`8 × 6s = 48s (80% of the loop)`).
- **Missed revenue & fill** — one 100%-wide stacked bar per display type: filled (teal) = sold ÷ all, unsold (amber) = unsold ÷ all, downtime (red) = offline ÷ all, from the back end's slot counts. Label: **89%** filled · $633 + $159 missed (unsold #ad6800, downtime #cf1322, the back end's rounded parts). The bar's `aria-label` reads "Window Portrait: 89% filled, $633 unsold, $159 lost to downtime". Rows follow the Slot value order; the All display types row is last, bold, below a divider, only when there is more than one type. At 520px and below the label sits above the bar.
- **Yield** — Deal type select: All deal types (default, no `dealType` sent) then Direct advertiser and the four types. One bar per DSP, and for Direct (#6b3fa0), with delivery, highest effective CPM first, in the DSP's shade (DV360 #eb6834, The Trade Desk #2a78d6, Amazon DSP #1baf7a); label **$8.69** eCPM. A DSP with no delivery is omitted; with none, the empty state "Nothing cleared on this deal type in scope." shows.
- **Fill and effective CPM by hour** — full-width panel after Yield (`/hourly`): a heatmap of display types (name, connected displays in brackets, journey order) by hour 00–23, shaded by the primary colour against the grid's maximum. Toggle Fill (default, whole %) / Effective CPM (`$x.xx`, `–` with no delivery). Hours outside operating hours are blank cells; no opening times. Hover = display type card + Hour, Fill with totals, Effective CPM with revenue and assumed views, coverage line. The ⓘ states the interim spreading rule. Scrolls sideways inside the panel below ~720px.
- Hover cards are absolutely positioned inside the frame and clamped to the visible viewport; they also open on keyboard focus and touch. Panels stack below 900px. Each panel has loading, empty and error (with Retry) states.
