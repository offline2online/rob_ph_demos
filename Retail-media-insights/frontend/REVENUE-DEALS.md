# Revenue and Deals (front end)

Content-frame module for the Retail Media Performance tab (no header, sidebar or `position: fixed`). Spec: README sections 1 and 2; REQUIREMENTS.md §4.

- `revenue-deals.js` / `revenue-deals.css` — `RevenueDeals.mount(el, { fetchJson })`, then `setFilters({ dateFrom, dateTo, storeIds, displayTypeIds, advertiserIds })`. Calls the `revenue` (`dsps[]`, `dealTypes[]`, `granularity`) and `deals` (`dealType`) endpoints.
- `rd-fixtures.js` — offline fixtures in the endpoints' response shapes. `index.html` uses them unless opened with `?api=<base>/insights/v1/retail-media`; `?state=loading|empty|error` previews the other states.
- `test/revenue-deals.test.js` — `node --test Retail-media-insights/frontend/test/*.test.js`.

Behaviour: only DV360 is selected by default; chips run DV360, The Trade Desk, Amazon DSP. Bars are DSP colours shaded by deal type (darkest Programmatic guaranteed), estimated revenue is the dashed outline on top. Every figure beyond the headline is in a hover or ⓘ tooltip; no warnings or explanatory copy. Pacing (bar and hover) shows on Programmatic guaranteed rows only; before the flight the hover says "Starts in N days".
