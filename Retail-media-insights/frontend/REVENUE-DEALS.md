# Revenue and Deals (front end)

Content-frame module for the Retail Media Performance tab (no header, sidebar or `position: fixed`). Spec: README sections 1 and 2; REQUIREMENTS.md §4.

- `revenue-deals.js` / `revenue-deals.css` — `RevenueDeals.mount(el, { fetchJson })`, then `setFilters({ dateFrom, dateTo, storeIds, displayTypeIds, advertiserIds })`. Calls the `revenue` (`dsps[]`, `dealTypes[]`, `granularity`) and `deals` (`dealType`) endpoints.
- `test/revenue-deals.test.js` — `npm test` in `Retail-media-insights` (offline), on the real route handlers through `local-api.js`.

Behaviour: only DV360 is selected by default; chips run DV360, The Trade Desk, Amazon DSP. Bars are DSP colours shaded by deal type (darkest Programmatic guaranteed), estimated revenue is the dashed outline on top. Every figure beyond the headline is in a hover or ⓘ tooltip; no warnings or explanatory copy. Pacing (bar and hover) shows on Programmatic guaranteed rows only; before the flight the hover says "Starts in N days".

The Revenue panel shows `Total earned $x · estimated $y`: the sum of the back end's rounded rows, added in whole cents, so it equals the summary strip's Earned revenue when every DSP chip is on. The x-axis shows as many dates as fit the width (at 390px, about every fifth day).
