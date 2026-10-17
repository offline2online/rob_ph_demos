# Insights service foundation

The back end of Retail Media Insights & Analytics Dashboards: a read-only service at `/insights/v1/retail-media/...` with daily pre-aggregates, a shared page-filter layer and one unit-tested calculation library. The functional spec is [`README.md`](README.md); buildable requirements are in [`REQUIREMENTS.md`](REQUIREMENTS.md). The Retail Media Performance tab (front end) is built by separate tickets.

## Layout
- `src/calc/` — the calculation library (REQUIREMENTS §3.2): VAC-d assumed views, CPM / effective CPM, per slot per day, operating hours, fill, missed revenue, PG pacing, maturity, rounding, USD, standard orderings.
- `src/filters.js` — page filters `dateFrom`, `dateTo`, `storeIds[]`, `displayTypeIds[]`, `advertiserIds[]`, plus server-side advertiser scoping.
- `src/aggregate.js` — builds the daily aggregates from raw billing line items and slot records: delivery (display type × store × deal × DSP × advertiser) and inventory (display type × store).
- `src/store.js` — date-indexed in-memory aggregate store.
- `src/routes/` — one file per endpoint, auto-discovered by `src/server.js`. Today: `health`, `summary`, `revenue`.
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
