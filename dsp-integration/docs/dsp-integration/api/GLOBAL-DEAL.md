<!-- Section for REQUIREMENTS.md §6, directly before "### Two API tiers". Held here because REQUIREMENTS.md (255 KB) did not fit in ticket rkm4bgISL7W0thKc7SwW's patch; a follow-up ticket moves it in and deletes this file. -->

### The global deal — one deal ID for all open inventory (8 Oct 2026)

Decided by Rob, 8 Oct 2026 (mirrors Vistar's global deal ID). Open programmatic
DOOH is still early, and many DSPs can only transact on a deal ID. A single
**global deal** resolves to every open, exchange-eligible position on this
instance, so such a DSP targets one deal ID with its own targeting instead of
a deal per position.

- **Two layers of retailer control.** (1) An instance-level master switch in
  Exchange settings (`exchange.globalDealEnabled`, off for a new instance).
  (2) A per-slot **include in global deal** flag (`Slot.inGlobalDeal`),
  **defaulting on**: opt-out, not opt-in. It sits next to the Advertiser
  assignment on Advertisers / Inventory.
- **Deference rule.** The flag is suppressed whenever the slot is held for a
  named advertiser, whitelist-only or assigned to a buyers list (and an
  advertiser or seat on the blacklist is refused as on any open bid), so the
  default never exposes inventory the retailer meant to restrict. Being open
  and being in the global deal are not the same thing. The admin shows the
  flag disabled with the reason.
- **Bidding.** A global-deal bid competes exactly as on the open exchange:
  same base floor, first-price, same pre-auction checks, approval gate and USD
  rule. It does not lower the floor, grants no guaranteed delivery and is open
  inventory behind a deal handle, not a PMP/PG deal. The request carries
  `pmp.deals[0].id = PH-GLOBAL` with `private_auction: 0` and no `wseat`, so it
  is never mistaken for a private or locked deal at bid time; a real PMP deal
  still wins its own way. A bid quoting `PH-GLOBAL` where the position is not
  in the global deal is rejected.
- Surfaces: the per-slot flag on Advertisers / Inventory; the master switch and
  the ID in Exchange settings; `api/API.md` ("The global deal"). Tests: unit
  gate M11 (`apps/api/test/global-deal.test.ts`) and E2E run 3 cases P9–P11.

