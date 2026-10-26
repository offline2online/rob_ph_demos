# Revenue and Deals (front end)

Content-frame module for the Retail Media Performance tab (no header, sidebar or `position: fixed`). Spec: README sections 1 and 2; REQUIREMENTS.md §4.

- `revenue-deals.js` / `revenue-deals.css` — `RevenueDeals.mount(el, { fetchJson })`, then `setFilters({ dateFrom, dateTo, storeIds, displayTypeIds, advertiserIds })`. Calls the `revenue` (`dsps[]`, `dealTypes[]`, `granularity`) and `deals` (`dealType`) endpoints.
- `test/revenue-deals.test.js` — `npm test` in `Retail-media-insights` (offline), on the real route handlers through `local-api.js`.

Behaviour: only DV360 is selected by default; chips run DV360, The Trade Desk, Amazon DSP, Direct (the retailer's direct advertisers, purple #6b3fa0, one shade, the one deal type Direct advertiser), each with a swatch in its Preferred shade. Each DSP has one colour family of four shades (darkest Programmatic guaranteed, then Preferred deal, Private auction, lightest Open auction; `DSP_SHADES`), with a white hairline between segments to keep neighbouring shades apart (the lightest pairs cannot reach 3:1 colour contrast on their own, so the hexes are the artifact's and the separator does the work). The legend lists each selected DSP × deal type (narrowed by the Deal type filter), then "Estimated (booked ahead, not yet played)".

Booked ahead: `/revenue` is called with `aheadDays` 14 (Day), 42 (Week) or the days to 31 Dec (Month, capped at 120). A dashed "Today" line sits before the first booked-ahead bar; those bars show only the estimated segment (fill #eef4fa, outline #7aa7d6) and their hover reads "Estimated (booked ahead)". Estimated revenue never counts toward the chart total. Week labels read "w/c 14 Sep", Month labels "Sep".

Deals: Fill and Pacing show a 90×6 bar with the whole-number % (Pacing, Programmatic guaranteed only, adds "of guaranteed"); Advertisers on deal reads "5 advertisers"; CPM carries a muted "fixed" or "floor"; the slot hover shows "slot n of N" from `slot-allocation`'s `slotsPerLoop`. Every figure beyond the headline is in a hover or ⓘ tooltip; no warnings or explanatory copy. Before the flight the pacing hover says "Starts in N days".

The Revenue panel shows `Total earned $x`: the sum of the back end's rounded rows, added in whole cents, so it equals the summary strip's Earned revenue when every DSP chip is on. The x-axis shows as many dates as fit the width (at 390px, about every fifth day).
