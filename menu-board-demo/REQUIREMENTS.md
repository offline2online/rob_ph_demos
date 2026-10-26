# Products, Pricing & Assets — requirements

The Personalisation Hub prototype for managing a retailer's product
catalogue, its pricing and offers, and its product assets, and for
publishing them to in-store digital menu / offer boards. Board project:
**Products and Pricing Prototype** (`products-and-pricing`).

This document describes what the prototype does today (19 Oct 2026, `main`
at `085e4b5`) and the rules it must keep. Known defects against these rules
are listed in [`REVIEW-2026-10.md`](./REVIEW-2026-10.md); open product
questions are at the end.

## 1. Surfaces

| Surface | File | Who | Hosting |
|---------|------|-----|---------|
| HQ Products & Pricing grid + Settings | `hq-admin.html` | HQ admin | GitHub Pages, iframed into PH HQ Admin |
| Per-product editor (Assets / Details / Pricing / Stockists) | `product-app/` → built to `product/` | HQ admin | GitHub Pages, opened from the grid in the same frame |
| Store admin | `retail-admin.html?store=<code>` | Store staff | GitHub Pages, iframed into PH Retail Admin |
| Menu / offer board | `menu-board.html` | Customers | GitHub Pages, on in-store screens |
| Standalone boards | `order.html`, `order-summary.html`, `order-progress.html`, `store-hours.html`, `languages-on-shift.html` | Customers | GitHub Pages |
| Portal and URL builder | `index.html` | Anyone setting up a board | GitHub Pages |
| API notes | `api-reference.html`, `location-api.html` | Integrators | GitHub Pages |
| Server jobs | `functions/` | — | Cloud Functions, `rob-ph-demos`, **manual deploy** |

Admin pages are content frames only: no header, sidebar or breadcrumb of
their own (the PH platform provides them), Roboto and Material Symbols
Outlined only, and nothing `position: fixed` (see the `ph-designer` skill,
`references/prototyping.md`). Customer-facing boards may use the brand's
own display typography (Inter / Oswald today) — a deliberate exception.

## 2. Data model (Firestore, project `rob-ph-demos`)

- **`items/{id}`** — one product. Authoring fields: `id, sku, name, brand,
  category, subCategory, menuTypes[], status/active, featured, priority,
  featuredFrom/Until, descriptions{lang:{displayName, short(≤90), long}},
  ingredients[], attributes[], optionGroups[], distributionTargeting`.
  Pricing: `price` (RRP), `menuBoardNote`, `offers[] {enabled, description,
  offerPrice, note, from, until, recurrence, targeting}`, and the **flat
  default-offer fields** `offerPrice, offerFrom, offerUntil,
  offerDescription, offerRecurrence, showOnMenuBoard` written from
  `offers[]` on save (untargeted default offer) for the HQ grid and older
  readers. `priceLog[]` — every price change by HQ, a store or the sweep.
  Assets: `images[]` (URL / data-URI strings, default first) and
  `imagesRich[]` (per-asset metadata matched by position: type, variant,
  default, tags, availableForTesting, rights {type, territory, expiry,
  holder}, targeting with per-group schedule and repeat). GS1-style derived
  fields (`@type`, `productName`, `gs1:*`, …) are written on save.
- **`menuboard/{brands|types|categories|subCategories|languages|badgeTemplates|settings}`**
  — registries, each `{data: …}`. `brands` holds brand settings, offer-board
  templates and distribution; `settings` holds `pricingDisplay`, `phApi`,
  `stockApiKey`, `aiProviders.{translation|image|video}` (tokens encrypted
  server-side) and shopping-cart label/icon.
- **`stock/{store}`**, **`localFeatured/{store}`** — per-store stock and
  local featured picks.
- **`storePricing/{store}`** — per-store overrides keyed by SKU:
  `{price, offerPrice, offerFrom, offerUntil, offerRecurrence,
  showOnMenuBoard, updatedAt, updatedBy}`.
- **`mbactivity/{boardKey}`** — board heartbeats.
- Storage: `generated-videos/` (re-hosted AI videos, signed URLs).

## 3. HQ Admin (`hq-admin.html`)

- **Products grid** (AG Grid): item (default image, asset count, expired /
  expiring licence stamp, targeted / scheduled / A-B indicators), Price,
  Brand, SKU, Category, Menu Types, Ingredients (≥900 px), Status (Active,
  Featured), row menu (Edit, Activate, Feature, Delete). Checkbox set filters,
  pagination, multi-select bulk bar (activate, deactivate, feature,
  unfeature, delete), with the Local Feature Highlight "3 featured" hint.
- **The Price column shows HQ's own RRP / offer only** — never one store's
  override. A "Local offer ×N" pill says stores have their own price and
  links to the product's local-pricing view; "Targeted ×N" and
  "Recurring ×N" pills summarise `offers[]`. Deliberate, not a bug.
- Clicking a row opens the product editor (`product/#/products/<id>/<tab>`)
  in the same frame. All price, offer, targeting and asset editing happens
  there; the grid only displays.
- **Settings**: Brands / Suppliers (with one Offer Board chip per board —
  click copies the device URL), Menu Types, Badge Templates (offer,
  location, sold-out, category), Pricing display (strikethrough, RRP
  prefix/suffix, RRP and badge placement, gap; live preview), and
  prototype-only PH API environments, Stock API key, AI Integrations and
  shopping-cart label.
- **Brand modal**: name, currency, icon, logo, palette (≤12), guidelines
  file, distribution (all stores / targeted stores rule builder), "Allow
  store-level price updates", per-brand import/export/clear; **Manage Offer
  Boards** — prerequisites checklist, templates (Classic Menu Board, Local
  Feature Highlight, Order Summary, Order Status, Store Opening Hours,
  Languages On Shift), template editor (colours, filters, sold-out
  behaviour, rotation, grid size per orientation, clock, campaign mode,
  greeting, hero size, Local Feature Highlight tile layout).
- Brand import from the `*-import.json` sample files (picked by hand).

## 4. Product editor (`product-app/`)

React 18 + antd 5 + Vite, HashRouter: `/products/new`, `/products/:id/:tab`.

- **Header**: back, name, SKU, Featured tag, Status switch (cannot go Active
  until Brand, Name, SKU, Category and Menu types are set). Details, Assets
  and Stockists share one Save/Cancel bar; Pricing saves on its own and
  requires a reason.
- **Product Assets**: image and video tiles (variants A, B… / V1, V2…),
  upload, replace, duplicate, delete, independent default image and video,
  badges (default, A/B, targeted, scheduled, 3D, video, licence expired /
  expiring), Available for testing, tags. Enhance and Remove Background
  (in-browser, `@imgly/background-removal`) are undoable with a before/after
  slider. **Magic Edit**: crop, zoom 1–3×, restore/erase brush, undo.
  **Request Changes** (Gemini image edit, dictation supported; Delete /
  Replace / Duplicate hidden meanwhile). **Generate Video** (LTX-2; duration
  from the brand's hero-board rotation; editable default prompt; re-hosted
  in Storage). Usage rights (type, territory, expiry, holder). Per-asset
  scheduling and targeting rules with repeat. Images are kept under a
  ~950 KB per-document budget by WebP recompression.
- **Product Details**: brand, name, SKU, category / sub-category (add to
  registry), menu types, read-only price summary, featured + priority +
  window, descriptions per language (Add New Language → AI translation),
  ingredients, additional attributes, option groups (single/multi, min/max,
  price delta, SKU), distribution targeting.
- **Pricing**: RRP, default menu-board note with badge preview, offers table
  (enable switch; description, price, note, schedule from/until, repeat —
  none / daily / weekly / monthly / annually / weekdays / custom, ends never /
  on date / after N — and targeting), price-change log grouped per save,
  `?filter=local` for store changes.
- **Stockists**: all stores or specific stores; Local Store Pricing table of
  every store override for this SKU.

## 5. Retail Admin (`retail-admin.html`)

- Requires `?store=<code>` (else "Access Required"); `?staff=<id>` names the
  person in the price log.
- Grid of the store's active items: product (searchable), price (this
  store's effective price, struck-through RRP when an offer is live),
  category, menu types, ingredients, status (stock pill, Local Featured
  star); summary bar (active, in stock, out of stock, locally featured).
- Stock: in / out of stock with confirmation, stock level, location (feeds
  the board's Location Badge).
- Local Featured: 3 or more picks override HQ's featured list; out-of-stock
  items can't be featured.
- **Pricing tab** (only when the brand allows store pricing): RRP, offer
  price, from / until, menu-board text with badge preview; save needs a
  reason and a change; history; live / scheduled / ended banner. **Return to
  RRP** ends the store's offer; **Clear local override** removes the store's
  entry entirely so HQ's pricing applies again.

## 6. Menu board (`menu-board.html`)

URL: `store` and/or `device` (UDID, personalised mode), `menu` (types),
`template`, `screen` (lock page), `orientation`, `brand` (by name),
`mockapi` (`1` → `mock-ph-api.json`), `debug=1`, and test overrides
`testSkus`, `testDeviceType`, `testVisitor`, `testQueue`.

- Brand / template theming, header with logo and clock, store name.
- Campaign mode `override` or `filter` from the PH API's campaign SKUs
  (polled every 5 s), personalised greeting; Feature Hero falls back to the
  default template under 3 featured items.
- Page rotation with progress; tile layouts (category, name, descriptions,
  pricing, note, location badge, nutrition, attributes); targeted images and
  video; offer / location / sold-out / category badges; account-wide price
  display settings; heartbeat to `mbactivity`.

## 7. Price resolution — the rules every surface must agree on

1. **RRP** is HQ's `price`, unless the store has its own `price` override.
2. **Offer**: among `offers[]` that are enabled and whose targeting matches
   this store / visitor, the live one wins; a store's own offer replaces
   HQ's **only while the store's offer is live**.
3. **Live** means now is inside the from/until window; for a recurring offer
   `from`/`until` also give the daily time window and the recurrence gives
   the days and end. Times are evaluated in the store's timezone.
4. An offer ends automatically at `until` (or its recurrence end): the sweep
   (`sweepExpiredOffers`, every 15 min) reverts the flat fields and logs it;
   boards must not wait for the sweep to stop showing it.
5. The menu-board note shown is the live offer's note, else the item's
   standing `menuBoardNote`.
6. The HQ grid shows HQ's own price/offer only (§3).

Today these rules are implemented separately in `menu-board.html`,
`retail-admin.html`, `hq-admin.html`, product-app and `functions/`, and they
disagree in places — see `REVIEW-2026-10.md` §2. A shared, tested module is
the recommended fix.

## 8. Non-functional

- **Access**: today there is none — open Firestore rules, unauthenticated
  callables, a URL parameter as the store's identity. Required before real
  client data: signed-in admins, closed rules, App Check / auth on every
  callable, no PH or AI token in any client.
- **Deploy**: pages are live on merge to `main` (GitHub Pages). `product/`
  must be rebuilt (`cd product-app && npm run build`) and committed.
  `functions/` and `firestore.rules` need `firebase deploy` by hand —
  merging does not make them live.
- **Size**: Firestore documents ≤ 1 MiB; inline images are budgeted, brand
  files and price logs are not yet.

## 9. Open questions

- Store override: full snapshot (today) or a patch on top of HQ? Should
  Return to RRP suppress HQ's offers at that store?
- Whose timezone governs a recurring window?
- Is distribution targeting (authored, not yet read) in the first release;
  should boards honour `allowStorePricing`?
- Should board URLs carry brand and template ids rather than names/types?
- Fold `Brands-Suppliers-Assets/` (label templates, discount touchpoints)
  in here, or retire it?

## 10. Supplier store-level transparency (discovery, 26 Oct 2026 — not built)

Ticket `UMSHGbzxg5DCyXiZWBbc`. Nothing here exists in the prototype yet; this
section is the requirement set for discovery and design. It extends §2's
product model so the **transaction side** (supplier inventory, orders,
store sell-through) and the **media side** (campaigns, screens, edge
computer vision) are joined at product-and-store level, and gives suppliers
who advertise on the retailer's retail media network a governed, paid view
of their own SKUs by store.

### 10.1 Store-level trading data per product

- Per product (GS1-identified SKU) and store, the store digital twin holds:
  live stock, price, sell-through, and supplier order / shipment volumes.
- Inputs: the transaction / POS API, GS1 product identity, and EDI-style
  supplier feeds or the supplier's own order management system.
- Builds on today's `stock/{store}` and `storePricing/{store}` (§2), which
  hold only in/out of stock, stock level and price overrides.

### 10.2 Stock-aware decisioning

- PH Core suppresses a supplier's campaign for a SKU when shelf stock is
  below a threshold, and can promote overstock or short-dated lines,
  adjusting price and creative in real time.
- Price changes made this way must go through §7's resolution rules and be
  logged in `priceLog[]` like any other change.

### 10.3 Edge creative performance

- Edge CV (passer-by and visitor engagement by screen and location) is tied
  to the campaign and SKU, so a supplier sees which creative performs at
  which store beside the sales uplift.
- Depends on closed-loop attribution from the Transaction API.

### 10.4 Gated, paid access

- Store-level visibility is available only to a supplier or advertiser with
  campaigns running through the retail media network.
- Suggested tiers: **standard** — campaign-period visibility on advertised
  SKUs; **always-on** — store-level visibility unlocked by an annual
  commitment; an **entry tier** for smaller suppliers (to be defined).

### 10.5 Governance

- SKU-level permissioning: a supplier sees only its own products, never
  competitors' or private label. Today's Brands / Suppliers registry
  (`menuboard/brands`) is the starting point for the supplier-to-SKU link.
- The retailer controls and meters access (who, which SKUs, which stores,
  which period) and can audit it.
- Requires the access model in §8, which does not exist today.

### 10.6 Positioning

- The paid tier must sit clearly above what suppliers already get from
  supplier portals and EDI: store-level, near real time, tied to media
  exposure, creative performance and uplift.
- Frame and name it as **campaign analytics**, not withheld trading data,
  given grocery-code and competition-regulator scrutiny. Legal review of
  the framing is a precondition to release.

### 10.7 Dependencies

Transaction API and closed-loop attribution; store digital twin; edge CV;
Retail Media Insights & Analytics Dashboards (supplier / advertiser views);
Federated Retail Media (PH-to-PH) for supplier PH instances; §8 access
controls.

### 10.8 Open questions for discovery

- Which tier boundaries and pricing; what is the entry tier?
- Data freshness promised per tier (minutes vs. daily)?
- Which trading measures may be shown without breaching grocery-code or
  competition rules (e.g. aggregation floors, suppressing small-store
  counts)?
- Where does supplier-facing UI live: Insights dashboards, a supplier PH
  instance via Federated Retail Media, or HQ Admin?
- Who owns the supplier-to-SKU mapping, and how are shared / multi-supplier
  SKUs handled?
