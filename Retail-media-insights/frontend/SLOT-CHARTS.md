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

- `slot-charts.js` / `slot-charts.css` — the module. `SlotCharts.mount(el, { fetchJson })` returns `{ setFilters, refresh, destroy }`; the shell calls `setFilters()` on Apply. Pure helpers (ordering, hover models, formatting) are exported for the tests.
- `fixtures.js` — fixture responses in the shapes below, plus a `fetchJson` that supports `state: 'empty' | 'error'`.
- `slot-charts-demo.html` — the test page. `?state=loading|empty|error` previews the non-data states.
- `test/slot-charts.test.js` — offline tests: `node --test Retail-media-insights/frontend/test/slot-charts.test.js` (no network, no dependencies).

`fetchJson(endpoint, params)` receives the page filters (`dateFrom`, `dateTo`, `storeIds`, `displayTypeIds`, `advertiserIds`) and, for `yield`, `dealType`. Every response carries `meta: { dateFrom, dateTo, days, storeCount }`. The component sorts display types into shopper-journey order and DSPs into DV360, The Trade Desk, Amazon DSP itself, so the back end may return any order.

## Response shapes (assumed — confirm when the back-end tickets land)

Fields marked `?` are optional; a field that is absent is omitted from the hover card, never shown as "not set".

```
display-types    { meta, rows: [{ id, name, description?, connectedDisplays, storeCount, zone?, operatingHours? ("24 hours" | "Store opening hours"),
                   touchPoint?, resolution?: {width,height}, orientation?, creativeFormats?: string[],
                   avgAssumedViewsPerSlotPerDay?, avgFootfallPerDay?, avgVisibilityAdjustment?,
                   shareOfLoopTime?: {slotSeconds, loopSeconds} }] }
slot-value       { meta, rows: [{ displayTypeId, connectedDisplays, effectiveCpm, floorCpm?, perSlotPerDay, earnedRevenue, assumedViews,
                   advertiserSlotsPerLoop, advertiserSlots /* per loop × connected displays */ }] }
slot-allocation  { meta, rows: [{ displayTypeId, slotsPerLoop, advertiserSlots, ownContentSlots, loopSeconds,
                   advertiserSlotSeconds, ownContentSlotSeconds, advertiserSlotsSoldPct }] }
missed-revenue   { meta, rows: [{ displayTypeId, connectedDisplays, floorCpm, slotsTotal, slotsSold, slotsUnsold, slotsOffline,
                   unsoldValue, downtimeLostRevenue }],
                   total: { connectedDisplays, floorCpmMin, floorCpmMax, …same counts and values, summed } }
yield            { meta, dealType, rows: [{ dsp, effectiveCpm, earnedRevenue?, assumedViews? }] }
```

Rules the component relies on (and the tests check on the fixtures): `sold + unsold + offline = slotsTotal`; parts are rounded before they are summed, so `unsoldValue + downtimeLostRevenue` is exactly the total missed revenue shown; `perSlotPerDay = effectiveCpm × avgAssumedViewsPerSlotPerDay ÷ 1,000`; `advertiserSlots + ownContentSlots = slotsPerLoop`.

## Behaviour notes

- **No IAB zone label on any chart face, no specific opening times anywhere.** The zone appears only in the hover card; `operatingHours` is shown only if it is exactly "24 hours" or "Store opening hours".
- **Slot value** — Effective CPM (default, with dashed floor markers) or Per slot per day (markers hidden). Hover = display type card + Effective CPM / Floor CPM / Per slot per day with network totals.
- **Slot allocation** — rows at 85% or more sold are the only amber signal. Hovers on Slots per loop, Advertiser slots and Own-content slots show the loop arithmetic (`8 × 6s = 48s (80% of the loop)`).
- **Missed revenue / fill** — bar length is missed revenue (unsold amber + downtime red) on one shared scale; fill % sits under the value. **Open question for the tester:** if the bar should encode fill % instead, say so on the ticket.
- **Yield** — Deal type filter (Programmatic guaranteed default); no Direct bar.
- Hover cards are absolutely positioned inside the frame and clamped to the visible viewport; they also open on keyboard focus and touch. Panels stack below 900px. Each panel has loading, empty and error (with Retry) states.
