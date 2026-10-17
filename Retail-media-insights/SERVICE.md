# Insights service foundation

The back end of Retail Media Insights & Analytics Dashboards: a read-only service at `/insights/v1/retail-media/...` with daily pre-aggregates, a shared page-filter layer and one unit-tested calculation library. The functional spec is [`README.md`](README.md); buildable requirements are in [`REQUIREMENTS.md`](REQUIREMENTS.md). The Retail Media Performance tab (front end) is built by separate tickets.

## Layout
- `src/calc/` — the calculation library (REQUIREMENTS §3.2): VAC-d assumed views, CPM / effective CPM, per slot per day, operating hours, fill, missed revenue, PG pacing, maturity, rounding, USD, standard orderings.
- `src/filters.js` — page filters `dateFrom`, `dateTo`, `storeIds[]`, `displayTypeIds[]`, `advertiserIds[]`, plus server-side advertiser scoping.
- `src/aggregate.js` — builds the daily aggregates from raw billing line items and slot records: delivery (display type × store × deal × DSP × advertiser) and inventory (display type × store).
- `src/display-types.js` — display type facts shared by the display endpoints: connected displays, loop from the slot configuration, VAC-d averages, hover card, shopper-journey (IAB zone) order.
- `src/store.js` — date-indexed in-memory aggregate store.
- `src/routes/` — one file per endpoint, auto-discovered by `src/server.js`. Today: `health`, `summary`, `revenue`, `yield`, `display-types`, `slot-value`, `slot-allocation`, `missed-revenue`, `deals`, `advertisers`, `maturity` (ladder, scheduling, share by level over time, variables in use, advertiser table; `granularity`, `level`, `variable`, `scheduling`, `kind` params).
- `src/testdata.js` — deterministic 5-store test retailer (Window Portrait, Endcap Shelf-edge, Queue Screen, Dispensary Screen).
- `bench/bench.js` — 90-day query over ~865k aggregate rows.

## Run
```
npm test         # calculation, reconciliation and server tests (node:test, no dependencies)
npm run bench    # p95 for a 90-day query
npm start        # serves the test retailer on :8080 (PORT to change)
```
`GET /insights/v1/retail-media/health` → `{"status":"ok"}`. Only GET is served (405 otherwise); a malformed filter returns 400.

## Decisions and limits
- DSP Integration and PH Core are read **via their APIs behind a source adapter**, not their data stores directly. The adapter is a follow-up; today the service runs on generated test data.
- Unsold inventory ignores the advertiser filter (slot records belong to no advertiser — README open question 1 default).
- `authenticate()` defaults to "retailer user"; the real identity provider and advertiser principal (DSP Integration §9.5) are follow-ups, so do not expose the server beyond the VPC as is.
- Slots outside a display type's operating hours are classified `outsideHours` and are never unsold; specific opening times are never returned.

## Endpoints: summary, revenue, yield
All take the page filters (`dateFrom`, `dateTo`, `storeIds[]`, `displayTypeIds[]`, `advertiserIds[]`).
- `GET /summary` — `earnedRevenue`, `estimatedRevenue` (booked-ahead, not yet played) and `inventorySold` `{percent, slotsSold, slotsAvailable}` across all advertiser slots inside operating hours. Optional `dsps[]` / `dealTypes[]` narrow the money figures only (inventory has no DSP or deal type).
- `GET /revenue?granularity=day|week|month&dsps[]&dealTypes[]` — rows `{period, dsp, dealType, earned, estimated}` ordered by period, DSP (DV360, The Trade Desk, Amazon DSP), then the four deal types.
- `GET /yield?dealType=` — one row per connected DSP in the standard order: `{dsp, effectiveCpm, earnedRevenue, assumedViews}` from settled billing; `effectiveCpm` is `null` when a DSP has no delivery.

Money is USD rounded to cents; `/summary` equals the sum of `/revenue` rows for the same filters to within a cent per row. An unknown `dealTypes` / `dealType` returns 400.

## Endpoints: display-types, slot-value, slot-allocation, missed-revenue
All take the page filters; rows come in shopper-journey zone order.
- Display endpoints (`display-types`, `slot-value`, `slot-allocation`, `missed-revenue`) are in shopper-journey zone order; a display type with no connected display in the filtered stores is left out. Hover-card fields that are not stored are omitted, never defaulted. Money parts are rounded first so rows add to the totals returned.
- **Connected displays (README open question 5, undecided):** a display counts if it was connected at any point in the date range (`connectedFrom` / `connectedTo` on the display; none set means always connected). Switching to "online now" is a one-line change in `connectedIn()` in `src/display-types.js`.
- Fill on `missed-revenue` and `slot-allocation` is sold ÷ (sold + unsold), the same as the Inventory sold tile; offline slots are returned separately so sold + unsold + offline = all advertiser slots inside operating hours.
- `missed-revenue` returns 403 to an advertiser login (downtime and lost revenue are retailer-only). Downtime lost revenue comes from the lost-revenue report values carried on offline slot records.

## Endpoints: deals, advertisers
Both take the page filters. Reference data (deals, buyers, slot assignments) comes from `store.catalog.deals`, filled by the source adapter from DSP Integration; today it is the test catalog in `src/testdata.js`.
- `GET /deals?dealType=` — one row per named deal (Open auction is not a deal) in the standard deal-type order: name, description, `dealIds` (one `PH-` ID per DSP that has an invited buyer), `slots` (display type, playlist · zone, IAB zone, advertiser slot n / loop slot n, plays per window), `advertisers` with their DSP, `fill`, `pacing` (Programmatic Guaranteed only, else `null`), `revenue` and `cpm` (`kind` is `floor` for Private auction, `fixed` otherwise). An unknown `dealType` returns 400.
- PG `pacing` is as at `dateTo`: before the flight `startsInDays` is set and `percent` is `null`; during it `daysElapsed` / `daysRemaining` count from the flight start; after it `daysRemaining` is 0, `flightEnded` is true and `guaranteedToDate` equals the whole-flight guarantee. `guaranteedToDate` = forecast × (1 − buffer) × days elapsed / flight days.
- `GET /advertisers` — `top` (10 by revenue) and `all`: revenue, `share` (whole numbers adding to 100), `dealsOn` (names and types), `slotsCovered`, `slotsWonPercent`, `effectiveCpm` (settled billing) and `dsp`. `slotsWon.complete` is false when the range is longer than the 90-day settled-bid retention (README open question 3).
- **Decision:** slot records carry no position, so a display type's sold + unsold slots inside operating hours are split equally across its advertiser positions. Deal `fill` = slots delivered on the deal ÷ the opportunities of its assigned slots; `slotsWonPercent` is the same for an advertiser's covered slots.
- An advertiser login sees only the deals it is invited to, with only its own buyer and the deal ID for its own DSP, and only its own advertiser row.
