# menu-board-demo — Products, Pricing & Assets

Personalisation Hub's Products, Pricing & Assets prototype: the HQ and
Retail admin screens that manage products, their pricing, offers and
assets, and the customer-facing menu / offer boards that display them.

Tracked on the PH Agent Console as **Products and Pricing Prototype**
(project id `products-and-pricing`). Its Requirements and README there are
copies of [`REQUIREMENTS.md`](./REQUIREMENTS.md) and this file, and
[`board-docs.json`](./board-docs.json) mirrors the latest review onto the
project — edit the repo files, not the board copies.

## Live links (GitHub Pages)

- HQ Products & Pricing grid —
  <https://offline2online.github.io/rob_ph_demos/menu-board-demo/hq-admin.html>
- Product editor (new product) —
  <https://offline2online.github.io/rob_ph_demos/menu-board-demo/product/#/products/new>
  (existing products open from a grid row)
- Retail Admin — `retail-admin.html?store=<store code>`
- Portal and board URL builder —
  <https://offline2online.github.io/rob_ph_demos/menu-board-demo/>

The admin pages are iframed into the real PH platform in use — see root
`CLAUDE.md` → "These prototypes run iframed inside the real Personalisation
Hub platform" before debugging a screenshot.

## What's here

- `hq-admin.html` — HQ's Products & Pricing grid and Settings (brands,
  menu types, badge templates, pricing display, offer-board templates,
  PH API / AI integrations).
- `product-app/` — source of the per-product editor (React + antd + Vite):
  Product Assets (upload, Magic Edit, background removal, AI image edit and
  video), Product Details, Pricing (offers, schedules, repeat, targeting,
  price log), Stockists.
- `product/` — **the checked-in build of `product-app/`**, which is what
  GitHub Pages serves. After changing `product-app/src`, run
  `cd product-app && npm install && npm run build` and commit `product/`
  too; no workflow rebuilds it.
- `retail-admin.html` — store-level admin (`?store=<code>`): stock, local
  featured items, store pricing overrides, Return to RRP, Clear local override.
- `menu-board.html` — the customer-facing board (URL parameters in
  `REQUIREMENTS.md` §6).
- `order.html`, `order-summary.html`, `order-progress.html`,
  `store-hours.html`, `languages-on-shift.html` — standalone board
  templates, configured from a brand's Manage Offer Boards.
- `index.html` — portal and board URL builder.
- `api-reference.html` (linked from HQ Settings), `location-api.html`
  (not linked from any page) — API notes.
- `functions/` — Cloud Functions for Firebase project `rob-ph-demos`: the
  offer-expiry sweep (every 15 minutes) and the AI provider calls
  (translation, image edit, video). **Needs a separate manual
  `firebase deploy --only functions`** — pushing to `main` does not make a
  functions change live. See root `CLAUDE.md` → "Only
  `menu-board-demo/functions` needs a separate manual deploy". The
  Firestore rules (root `firestore.rules`) are deployed by hand too.
- `mock-ph-api.json`, `mock-store-hours.json`, `mock-languages.json` — mock
  data the boards load; `mock-languages-*.json` are test fixtures for
  `languages-on-shift.html?mockapi=<file>`.
- `*-import.json` — sample brand catalogues, picked by hand in HQ's brand
  import (`kfcuk`, `pizzahut`, `starbucks` are produced by `gen_*.py`).
- `fonts/` (Noto subsets for Languages On Shift), `images/` (sample product
  images).
- `serve.js`, `serve.py`, `serve.sh` — local dev servers (for local use
  only; `serve.py` has a hard-coded laptop path).
- `menu-board.zip`, `Pizza Hut - Personalisation Hub Setup Guide.pdf` —
  unreferenced leftovers, flagged for removal in the review.

## Docs

- [`REQUIREMENTS.md`](./REQUIREMENTS.md) — what the prototype does and the
  price-resolution rules every surface must agree on.
- [`REVIEW-2026-10.md`](./REVIEW-2026-10.md) — the 19 Oct 2026 code
  review: security, pricing correctness, data integrity, design system,
  recommended order of work.
- `../Brands-Suppliers-Assets/` — an earlier (April 2026) prototype of the
  same area, kept for reference; this folder is the current one.
