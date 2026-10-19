# Brands-Suppliers-Assets

Personalisation Hub prototype for managing brands, suppliers, and the
product/pricing catalogue that HQ and retail admins work with.

- `index.html` — "Brands, Suppliers & Assets" landing page.
- `hq-brands-suppliers.html` — HQ Admin screen for managing brands and
  suppliers.
- `hq-products-pricing.html` — HQ Admin screen for products, pricing, and
  assets (a separate concern from `menu-board-demo/hq-admin.html`'s own
  Products & Pricing grid — check which screen a bug report is actually
  about before assuming either one).
- `retail-product-catalogue.html` — the store-level (Retail Admin) view of
  the product catalogue.

**Legacy prototype (April 2026), superseded by `menu-board-demo/`.** Feature
work stopped on 15 Apr 2026; the current Products, Pricing & Assets
prototype is `menu-board-demo/` (`hq-admin.html`, the `product/` editor,
`retail-admin.html`), tracked on the PH Agent Console as **Products and
Pricing Prototype** (`products-and-pricing`) — see
`menu-board-demo/README.md` and `menu-board-demo/REVIEW-2026-10.md`.

- **It shares no data with `menu-board-demo/`.** Everything is kept in the
  viewer's own browser (`localStorage` keys `ph_brands`, `ph_brands_list`,
  `ph_products`, `ph_discount_touchpoints`, `ph_custom_templates`), so each
  visitor sees a private copy and nothing is saved for anyone else.
- What exists only here: the label-template designer, discount
  "touchpoints", the Manage Offers modal and store-map pins.
- Nothing outside this folder links to it; reach it by URL
  (<https://offline2online.github.io/rob_ph_demos/Brands-Suppliers-Assets/>).
- It predates the `ph-designer` skill: system font stack, Google Material
  Icons (not Material Symbols), emoji navigation and its own sidebar/topbar.
  Don't extend it — build in `menu-board-demo/` instead.
- The landing page still advertises "Stock warnings" / "Suppress Low-Stock
  Campaigns", whose UI was removed on 28 Aug 2026 (`34c65fa8`).
