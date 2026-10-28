# Requirements — Retail Media Insights & Analytics Dashboards

The README is the functional spec (every chart, hover, rule and sample-data constraint). This document turns it into buildable requirements for a **separate front end and back end**, and calls out every dependency on **DSP Integration** and **PH Core**.

## 1. Scope
- One new Insights & Analytics tab, **Retail Media Performance**, placed first. Retailer view (README sections 1–7) and advertiser view (README sections 1–4).
- Read-only analytics. No new data pipeline: everything reads existing PH Core and DSP Integration data through a dedicated analytics API.
- Out of scope: everything under the README's Future work, including Sales uplift vs control stores and iROAS (removed from launch 27 Oct 2026: no sales data at launch). Its endpoint (`sales-uplift`, formerly §3.1 endpoint 12), the uplift / iROAS calculation rule (formerly §3.2) and its dependencies (campaign SKU or product name carried into playback analytics, PH Core Transaction API sales lines via a custom POS integration, a default "Control stores" Fixed Store Segment usable as an exclusion, billing line items carrying the campaign for iROAS spend) are future: the README's Future work holds the design and git history holds the code.

## 2. Architecture
- **Back end:** a new Retail Media Insights service with a versioned read-only API (`/insights/v1/retail-media/...`), deployed self-hosted in the retailer's AWS VPC like the rest of PH. It aggregates from PH Core and DSP Integration; it owns no source-of-truth data, only derived aggregates and caches.
- **Front end:** a new tab in the existing Insights & Analytics app, built to the PH design system (ph-designer skill), matching Campaign Performance patterns (summary strip, filter bar with Apply / Cancel / Reset Filters, ⓘ tooltips, 14px breadcrumb).
- The same API is the source for QuickSight datasets and agent access over MCP (no on-page CTAs for either).

## 3. Back-end requirements
### 3.1 Endpoints (one per page element; all take the page filters)
Page filters on every endpoint: `dateFrom`, `dateTo`, `storeIds[]`, `displayTypeIds[]`, `advertiserIds[]`. Chart-level filters are extra params.
1. `summary` — earned revenue, estimated revenue, `direct` (the direct advertisers' part of earned revenue, share % and advertiser count), Inventory sold (% + slots sold + available + offline).
2. `revenue` — per day/week/month × source (DSP or `Direct`) × deal type, earned and estimated; params `dsps[]` (a connected DSP or `Direct`), `dealTypes[]`, `granularity`.
3. `deals` — name, description, type, per-DSP deal IDs, assigned slots (with slot detail), advertisers (with DSP), fill, pacing (PG only: flight, days elapsed/remaining, forecast, buffer), revenue, CPM; param `dealType`.
4. `slot-value` — per display type: connected displays, effective CPM, floor CPM, revenue per available slot, network totals, VAC-d averages and inputs.
5. `slot-allocation` — per display type: slots per loop, advertiser / own-content counts and average durations, loop length, advertiser slots sold % (still in the response for reconciliation with Missed revenue & fill; not shown as a column).
6. `missed-revenue` — per display type + all-types total: connected displays, floor CPM (or range), fill, unsold slots and value at floor, downtime lost revenue and slots offline, total missed.
8. `advertisers` — revenue, share, deals on, slots covered, effective CPM, `pacing` (programmatic guaranteed only: `percent` pooled across the advertiser's PG deals, plus `deals[]` with each deal's pacing; null when on no PG deal), DSP, and demand by DSP seat: `seatCount` / `direct` and a `seats[]` sub-list per advertiser (seat, DSP, synced, revenue, share of the advertiser's spend, plays, deals, effective CPM, first/last win, advertisers the seat bought for). Seats add up to the advertiser's row (data only: the Advertisers table is advertiser level and does not show seats or agencies, 26 Oct 2026); a seat dropped from a DSP re-sync keeps its history (`synced: false`); retailer only, never in an advertiser login's response.
9. `maturity` — ladder counts + advertiser lists, scheduling counts + lists, share by level over time, variables-in-use ranking, and one row per advertiser (level, variables, scheduling with scheduled campaign names) that the Advertisers table joins by advertiser; the page filters it, so `/maturity` still accepts `level`, `variable` and `scheduling` but the page no longer sends them.
10. `display-types` — hover card data shared by every chart.
11. Advertiser view: `delivery` (daily plays won, spend, per-deal win/loss block with aggregate winning CPM, PG pacing), `deals-by-display-type`, `audience` (VAC-d delivered + trend), `my-targeting` (level, variables used, scheduling, other variables available).

### 3.2 Calculation rules (one shared, unit-tested library)
- **CPM** = cost per thousand assumed views (VAC-d). Effective CPM = revenue ÷ (VAC-d ÷ 1,000).
- **Average assumed views per slot per day** = average footfall × average visibility × share of loop time (slot duration ÷ loop length), averaged across all connected displays of the type in the filtered stores and dates; return the display and store counts with it. Billing uses realised VAC-d.
- **Revenue per available slot** (per day) = revenue ÷ (advertiser slots × connected displays × days) = effective CPM × average assumed views per slot per day ÷ 1,000 × fill. Counts every advertiser slot, sold or unsold.
- **Operating hours:** only slots inside each display type's operating hours are inventory (24 hours for Exterior and window screens visible from outside; store opening hours otherwise; a type with its own `customHours` {open, close} is labelled "Custom hours"). Every display type hover shows only that label ("24 hours", "Store opening hours" or "Custom hours"). Never return specific opening times.
- **Fill / Inventory sold** = sold ÷ (sold + unsold + offline), i.e. all advertiser slots inside operating hours, using unsold real-time slot records.
- **Missed revenue** = unsold slots × floor CPM × VAC-d ÷ 1,000, plus downtime lost revenue.
- **One money formula everywhere** (VAC-d audit, 27 Oct 2026; Broadsign model agreed 7 Oct 2026): value = plays × VAC-d per play ÷ 1,000 × CPM, i.e. `revenueAtCpm(cpm, vacd)` on VAC-d, never on plays. Covers earned and estimated revenue, unsold value at floor, downtime lost revenue, revenue per available slot, ad value per slot per day, effective CPM, direct advertiser values and the Deals table name hover (per-slot and deal-total value over the term: the hover totals VAC-d = plays × the VAC-d one play delivers on each connected display). The one place that priced plays ÷ 1,000 × CPM was the Deals hover; fixed. PG pacing and forecast are in VAC-d. Any matched-play figure targeted by Computer Vision would count one unit per match with no VAC-d; none exists in this service today.
- **Pacing** (PG only) = delivered VAC-d ÷ guaranteed to date; guaranteed = forecast × (1 − buffer).
- **Maturity level** = highest of Default only / Localised / Personalised across an advertiser's campaigns in range. Daypart is scheduling, never a variable.
- Parts add to totals as returned (round parts first). Whole-number percentages. All money in USD.
- **Direct advertisers** (26 Oct 2026): revenue from advertisers sold straight through PH (no DSP, no seat, agreed CPM; an internal PH deal ID for campaign authoring; each Direct advertiser deal has exactly one advertiser) is real billing, a source named `Direct` in every DSP breakdown and the fifth deal type `Direct advertiser`. It is part of earned revenue, never extra.
- Orderings: deal types Direct advertiser → PG → Preferred deal → Private auction → Open auction; sources DV360, The Trade Desk, Amazon DSP, Direct; display types by IAB zone along the shopper journey.

### 3.3 Security and isolation
- Retailer users: all data. Advertiser logins: scoped server-side to their own advertiser principal (DSP Integration §9.5 isolation rule); never trust a client filter.
- Advertiser responses never include other advertisers' names or per-buyer data, display downtime, lost revenue, offline displays, or other DSPs' deal IDs. Other buyers appear only as aggregates (plays, and the winning CPM range: 25th percentile, median and 75th percentile).
- Advertiser Display type filter options = display types from their deals' slot assignments plus those their campaigns target.

### 3.4 Performance
- Network scale: thousands of displays across many stores. Pre-aggregate daily by display type × store × deal × DSP × advertiser; target p95 under 2s per endpoint for a 90-day range.
- The target holds with concurrent users, not one: at network scale (864k aggregate rows) p95 under 2 s per request and per page load for 20 users sharing a view and for 10 users each filtering their own store, `/health` p95 under 100 ms, and every endpoint handler under 250 ms at p95 with the response cache off. Delivered with rollups, per-store partitions, a bounded response cache and a request queue; see SERVICE.md → "Performance and concurrency". Responses are unchanged.
- Settled bids are kept 90 days; the Advertisers table no longer shows a Slots won figure (28 Oct 2026), so nothing on the page depends on that retention.

## 4. Front-end requirements
- Tab, breadcrumb, page order and layout exactly as the README (Revenue full width; Deals under it; Slot value · Slot allocation; Missed revenue & fill; Advertisers; Targeting & scheduling maturity).
- Filters stay pending until **Apply**; **Cancel** reverts; **Reset Filters** only once a filter differs from default; no CTA otherwise. Advertiser filter is a locked chip for advertiser logins.
- Display-type charts are horizontal rows in shopper-journey order, with connected-display counts in brackets where specified.
- Every README hover implemented as facts only (no advice, no warning chips); long hovers float above the page and stay on-screen on mobile. Missing fields are omitted, never "not set".
- Advertiser counts list names (with DSP) on hover and filter the related table on click.
- No explanatory copy under charts or tables — ⓘ tooltips only. No unlabelled numbers.
- Advertiser Delivery: two lines on dual axes, toggled by the Plays won / Spend total tiles (both on by default, at least one on); Deal drop-down top right; PG-only Pacing switch.
- Empty, loading and error states for every chart; responsive at PH's supported breakpoints.

## 5. Dependencies — DSP Integration project
| Needed | Used for |
|---|---|
| Deals & buyers lists: name, description, deal type, per-DSP deal IDs (PH- format), flight dates, guaranteed volume, buffer, buyers and each buyer's DSP seat | Deals table and hovers, Advertisers table, advertiser view, "Name (DSP)" everywhere |
| Four industry-standard deal types, incl. the ticket aligning Private auction and Preferred deal, plus the Direct advertiser deal type and direct advertisers' billing lines (no DSP, no seat; one advertiser per deal; internal PH deal ID) | Revenue, Deals, Demand health, Summary |
| Available Inventory slot assignments (display type, playlist, zone, position, plays per window) | Slots column and hovers, Slots covered, advertiser display type filter |
| Winning seat (partnerId + seatId from the bid response) on every billing line item, synced seat names (`partners.seats`) and the advertiser ↔ seat mapping (`advertiser_seats`). **Not confirmed persisted on billing line items in DSP Integration today: confirm, else file it on DSP Integration** | Demand by DSP seat (Advertisers table sub-rows) |
| Billing line items and reservations (cleared / fixed CPM, plays, VAC-d, DSP seat, deal, display type) | Revenue, effective CPM, Delivery, winning CPM aggregates |
| **Unsold real-time slot records** | Inventory sold, Fill, Missed revenue, Slot allocation (API only) |
| Display type definitions: Touch Point, canvas size (px), creative formats, IAB store zone, floor CPM, operating hours (24-hour rule) | Display type hover, floor markers, missed revenue valuation, inventory |
| VAC-d / MOVE scoring inputs and realised assumed views | All CPMs, assumed views, pacing |
| Shared Targeting Variables (default set, labels, per-DSP access) | Maturity, Variables in use, advertiser available variables |
| Campaign submissions: targeting rules, targeted versions, pricingType, scheduling (dayparts, schedules) | Targeting & scheduling maturity |
| Advertiser principal, isolation rule (§9.5) and auth seams — **spec only today; blocks the advertiser view** | Advertiser self-service login |
| Lost-revenue report (GET /admin/v1/reports/lost-revenue) | Display downtime, retailer only |

## 6. Dependencies — PH Core
| Needed | Used for |
|---|---|
| Device registry: connected displays per display type and store | Bracketed counts, Connected displays rows, per-slot-per-day denominator, network totals |
| Display orientation (Not set / 90° / 180° / 270°) | Display type hover |
| Display type slot configuration: slot counts, durations, loop length | Slot allocation, share of loop time |
| Playback / analytics data (plays, per-play targeting tier) | Maturity progress, VAC-d aggregation |
| Store and visitor insights (footfall, visibility; CV where cameras exist) | VAC-d inputs |
| Stores and opening hours (to compute inventory only, never displayed) | Operating-hours inventory |
| Insights & Analytics app shell, auth and roles, design system, QuickSight and MCP plumbing | Front-end hosting and access |

## 7. Delivery order
1. Back-end foundations: aggregation tables, calculation library, filters, isolation.
2. Retailer view: summary, Revenue, Deals, Slot value, Slot allocation, Missed revenue, Advertisers, Maturity.
3. Advertiser view — gated on DSP Integration auth seams.
4. QuickSight datasets and MCP tools over the same API.

## 8. Acceptance criteria
- Every figure reconciles to source billing and slot records for a test retailer; parts add to totals.
- An advertiser login cannot retrieve any other advertiser's data or downtime via UI or API (pen-tested).
- All README "never show" rules pass a UI review checklist.

- Launch sample data (27 Oct 2026): the example retailer sells only Programmatic guaranteed, Direct advertiser and the Open auction, with 7 of its 10 named deals direct. A direct advertiser takes part in no auction, so its Delivery and Your deals by display type show no Open auction. Every calculation (Slot value, Missed revenue & fill, Slot allocation, Inventory sold, Revenue) includes direct revenue and plays once (`test/direct-audit.test.js`).

## 9. Open questions carried into the project
README open questions 1–6, plus: does the analytics service read DSP Integration's data store directly or via its API?