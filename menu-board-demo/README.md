# menu-board-demo

Personalisation Hub's Menu Board prototype — customer-facing digital menu
boards plus the HQ/Retail admin screens that manage the products, pricing,
and offers those boards display.

- `menu-board.html` — the customer-facing menu board itself (the display
  that actually runs on in-store/drive-thru screens).
- `hq-admin.html` — HQ's Products & Pricing grid, iframed into the real
  Personalisation Hub platform in production (see root `CLAUDE.md` →
  "These prototypes run iframed inside the real Personalisation Hub
  platform" for what that means when debugging a screenshot).
- `retail-admin.html` — the store-level admin screens, also iframed into
  the real platform.
- `functions/` — Cloud Functions for Firebase (the scheduled offer-expiry
  sweep, AI provider calls for product asset generation). **Needs a
  separate manual `firebase deploy --only functions`** — pushing to `main`
  does not make a functions change live. See root `CLAUDE.md` → "Cloud
  Functions need a separate manual deploy".
- `gen_*.py` — one-off generator scripts used to produce demo data for
  specific brands (KFC, Pizza Hut, Starbucks).
- `*-import.json` — sample/mock data files consumed by the demo.

Tracked on the Prototype Backlog board as **"Products, Pricing & Asset
Management"** (see root `CLAUDE.md` → "Prototype Backlog") — that project's
own Docs page carries the live, board-native copy of anything below worth
keeping in sync as it changes.
