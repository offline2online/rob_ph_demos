# Retail media insights

Prototype for the **Retail Media Performance** tab in Insights / Analytics, built as a
content frame to be iframed into HQ Admin (no header, sidebar or fixed positioning).

- `index.html` — tab list (Retail Media Performance first, no NEW badge), breadcrumb, page filters, summary strip
- `css/insights.css` — PH tokens, PH breakpoints (stacks below 600px)
- `js/insights.js` — Apply / Cancel / Reset Filters behaviour and sample data

Query flags for review: `?role=advertiser` (locked advertiser chip), `?state=loading|empty|error`.
Figures are sample data until the summary endpoint ticket lands.
