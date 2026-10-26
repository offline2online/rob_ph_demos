# Requirements — Retail Media Insights & Analytics Dashboards

The README is the functional spec (every chart, hover, rule and sample-data constraint). This document turns it into buildable requirements for a **separate front end and back end**, and calls out every dependency on **DSP Integration** and **PH Core**.

## 1. Scope
- One new Insights & Analytics tab, **Retail Media Performance**, placed first. Retailer view (README sections 1–7) and advertiser view (README sections 1–4).
- Read-only analytics. No new data pipeline: everything reads existing PH Core and DSP Integration data through a dedicated analytics API.
- Out of scope: everything under the README's Future work.

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
5. `slot-allocation` — per display type: slots per loop, advertiser / own-content counts and average durations, loop length, advertiser slots sold %.
6. `missed-revenue` — per display type + all-types total: connected displays, floor CPM (or range), fill, unsold slots and value at floor, downtime lost revenue and slots offline, total missed.
6a. `hourly` — (endpoint 10a in the ticket) per display type: connected displays and, for each hour inside operating hours, fill, sold / unsold / offline slots, revenue, assumed views and effective CPM. Retailer only (403 for an advertiser). `viewsBasis` names the interim spreading rule.
7. `yield` — effective CPM per source (each connected DSP, then `Direct`); param `dealType`.
8. `advertisers` — revenue, share, deals on, slots covered, slots won %, effective CPM, DSP, iROAS, and demand by DSP seat: `seatCount` / `direct` and a `seats[]` sub-list per advertiser (seat, DSP, synced, revenue, share of the advertiser's spend, plays, deals, effective CPM, first/last win, advertisers the seat bought for). Seats add up to the advertiser's row; a seat dropped from a DSP re-sync keeps its history (`synced: false`); retailer only, never in an advertiser login's response.
9. `maturity` — ladder counts + advertiser lists, scheduling counts + lists, share by level over time, variables-in-use ranking, advertiser targeting & scheduling table.
10. `display-types` — hover card data shared by every chart.
11. Advertiser view: `delivery` (daily plays won, spend, per-deal win/loss block with aggregate winning CPM, PG pacing), `deals-by-display-type`, `audience` (VAC-d delivered + trend), `my-targeting` (level, variables used, scheduling, other variables available).
12. `sales-uplift` — one campaign's outcome: campaign list for the drop-down (scoped to the Advertiser filter, or pinned to the advertiser login), tiles (uplift %, incremental sales, spend, iROAS), `bySku` (each campaign SKU's contribution to incremental sales: incremental $, share of positive contribution, uplift %, sales behind it; rows sum to the incremental tile; a SKU with too few sales is `measurable: false`), tier mix, campaign and control store groups with names, and daily series (before / during / after). Param `campaignId`; only the Advertiser page filter applies. Advertiser-callable; another advertiser's `campaignId` is 400.

### 3.2 Calculation rules (one shared, unit-tested library)
- **CPM** = cost per thousand assumed views (VAC-d). Effective CPM = revenue ÷ (VAC-d ÷ 1,000).
- **Average assumed views per slot per day** = average footfall × average visibility × share of loop time (slot duration ÷ loop length), averaged across all connected displays of the type in the filtered stores and dates; return the display and store counts with it. Billing uses realised VAC-d.
- **Revenue per available slot** (per day) = revenue ÷ (advertiser slots × connected displays × days) = effective CPM × average assumed views per slot per day ÷ 1,000 × fill. Counts every advertiser slot, sold or unsold.
- **Operating hours:** only slots inside each display type's operating hours are inventory (24 hours for Exterior and window screens visible from outside; store opening hours otherwise). Never return specific opening times.
- **Fill / Inventory sold** = sold ÷ (sold + unsold + offline), i.e. all advertiser slots inside operating hours, using unsold real-time slot records.
- **Hourly fill and effective CPM:** fill uses the rule above per hour; effective CPM = revenue ÷ (VAC-d ÷ 1,000) per hour. Until the hourly impression multiplier ships (DSP Integration), and while billing carries no play timestamp, a day's earned revenue and assumed views are spread over its hours by the share of that day's sold slots in each hour. Hourly parts add to the day totals (revenue to the cent, views to the whole number); an hour with no delivery has no CPM.
- **Missed revenue** = unsold slots × floor CPM × VAC-d ÷ 1,000, plus downtime lost revenue.
- **Pacing** (PG only) = delivered VAC-d ÷ guaranteed to date; guaranteed = forecast × (1 − buffer).
- **Maturity level** = highest of Default only / Localised / Personalised across an advertiser's campaigns in range. Daypart is scheduling, never a variable.
- **Uplift** = campaign-store sales over the flight vs the same stores' 30-day pre-period mean scaled by the control stores' change; incremental sales = actual − that expectation; iROAS = incremental ÷ campaign spend (billing line items in the campaign's stores and display types, shared equally by the advertiser's campaigns running that day).
- Parts add to totals as returned (round parts first). Whole-number percentages. All money in USD.
- **Direct advertisers** (26 Oct 2026): revenue from advertisers sold straight through PH (no DSP, no seat, no deal ID, agreed CPM) is real billing, a source named `Direct` in every DSP breakdown and the fifth deal type `Direct advertiser`. It is part of earned revenue, never extra.
- Orderings: deal types Direct advertiser → PG → Preferred deal → Private auction → Open auction; sources DV360, The Trade Desk, Amazon DSP, Direct; display types by IAB zone along the shopper journey.

### 3.3 Security and isolation
- Retailer users: all data. Advertiser logins: scoped server-side to their own advertiser principal (DSP Integration §9.5 isolation rule); never trust a client filter.
- Advertiser responses never include other advertisers' names or per-buyer data, display downtime, lost revenue, offline displays, or other DSPs' deal IDs. Other buyers appear only as aggregates (plays, and the winning CPM range: 25th percentile, median and 75th percentile).
- Advertiser Display type filter options = display types from their deals' slot assignments plus those their campaigns target.

### 3.4 Performance
- Network scale: thousands of displays across many stores. Pre-aggregate daily by display type × store × deal × DSP × advertiser; target p95 under 2s per endpoint for a 90-day range.
- The target holds with concurrent users, not one: at network scale (864k aggregate rows) p95 under 2 s per request and per page load for 20 users sharing a view and for 10 users each filtering their own store, `/health` p95 under 100 ms, and every endpoint handler under 250 ms at p95 with the response cache off. Delivered with rollups, per-store partitions, a bounded response cache and a request queue; see SERVICE.md → "Performance and concurrency". Responses are unchanged.
- Respect the 90-day settled-bid retention (see open question on Slots won).

## 4. Front-end requirements
- Tab, breadcrumb, page order and layout exactly as the README (Revenue full width; Deals under it; Slot value · Slot allocation; Missed revenue & fill · Yield; Advertisers; Targeting & scheduling maturity).
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
| Four industry-standard deal types, incl. the ticket aligning Private auction and Preferred deal, plus the Direct advertiser deal type and direct advertisers' billing lines (no DSP, no seat, no deal ID) | Revenue, Yield, Deals, Demand health, Summary |
| Available Inventory slot assignments (display type, playlist, zone, position, plays per window) | Slots column and hovers, Slots covered, advertiser display type filter |
| Winning seat (partnerId + seatId from the bid response) on every billing line item, synced seat names (`partners.seats`) and the advertiser ↔ seat mapping (`advertiser_seats`). **Not confirmed persisted on billing line items in DSP Integration today: confirm, else file it on DSP Integration** | Demand by DSP seat (Advertisers table sub-rows) |
| Billing line items and reservations (cleared / fixed CPM, plays, VAC-d, DSP seat, deal, display type) | Revenue, Yield, effective CPM, Delivery, winning CPM aggregates |
| **Unsold real-time slot records** | Inventory sold, Fill, Missed revenue, Slot allocation sold % |
| Display type definitions: Touch Point, canvas size (px), creative formats, IAB store zone, floor CPM, operating hours (24-hour rule) | Display type hover, floor markers, missed revenue valuation, inventory |
| VAC-d / MOVE scoring inputs and realised assumed views | All CPMs, assumed views, pacing |
| Shared Targeting Variables (default set, labels, per-DSP access) | Maturity, Variables in use, advertiser available variables |
| Campaign submissions: targeting rules, targeted versions, pricingType, scheduling (dayparts, schedules) | Targeting & scheduling maturity |
| Advertiser principal, isolation rule (§9.5) and auth seams — **spec only today; blocks the advertiser view** | Advertiser self-service login |
| Lost-revenue report (GET /admin/v1/reports/lost-revenue) | Display downtime, retailer only |
| Billing line items carrying the campaign (today spend is shared between an advertiser's concurrent campaigns) and Fixed Store Segments usable as exclusion targeting, with a default "Control stores" segment | Sales uplift vs control stores: iROAS spend, control group |

## 6. Dependencies — PH Core
| Needed | Used for |
|---|---|
| Device registry: connected displays per display type and store | Bracketed counts, Connected displays rows, per-slot-per-day denominator, network totals |
| Display orientation (Not set / 90° / 180° / 270°) | Display type hover |
| Display type slot configuration: slot counts, durations, loop length | Slot allocation, share of loop time |
| Playback / analytics data (plays, per-play targeting tier) | Maturity progress, VAC-d aggregation |
| Store and visitor insights (footfall, visibility; CV where cameras exist) | VAC-d inputs |
| Stores and opening hours (to compute inventory only, never displayed) | Operating-hours inventory |
| Campaign SKU (preferred) or product name as a required campaign field, carried into campaign playback analytics (store × display × campaign × SKU × tier × time); in-store displays only | Sales uplift vs control stores: product match, campaign stores, tier mix |
| Transaction API receiving store-level transactions by SKU / product and date — needs a custom POS integration per retailer | Sales uplift vs control stores: sales lines |
| Fixed Store Segments with a default "Control stores" segment, usable as an exclusion targeting criterion | Sales uplift vs control stores: control group |
| Insights & Analytics app shell, auth and roles, design system, QuickSight and MCP plumbing | Front-end hosting and access |

## 7. Delivery order
1. Back-end foundations: aggregation tables, calculation library, filters, isolation.
2. Retailer view: summary, Revenue, Deals, Slot value, Slot allocation, Missed revenue, Yield, Advertisers, Maturity.
3. Advertiser view — gated on DSP Integration auth seams.
4. QuickSight datasets and MCP tools over the same API.

## 8. Acceptance criteria
- Every figure reconciles to source billing and slot records for a test retailer; parts add to totals.
- An advertiser login cannot retrieve any other advertiser's data or downtime via UI or API (pen-tested).
- All README "never show" rules pass a UI review checklist.

## 9. Open questions carried into the project
README open questions 1–6, plus: does the analytics service read DSP Integration's data store directly or via its API?