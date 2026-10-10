# API reference — Display Types & DSP Integration

The agreed contract for every API this build adds. The machine-readable
version is [`openapi.yaml`](./openapi.yaml); the two must always match.
Requirements: `../REQUIREMENTS.md`. What this build needs **from** the
existing platform (the other side of every stand-in below) is in
[PH-CORE-BOUNDARIES.md](./PH-CORE-BOUNDARIES.md); the limits and headers
under *Conventions* come from the
[security and performance review](./SECURITY-PERFORMANCE.md) (23 Sep 2026).

**Build rule:** implement exactly the endpoints, fields, permissions and error
codes listed here. Don't add endpoints, fields, parameters or behaviour that
aren't here. If something seems missing, ask; don't add it. Any change to an
endpoint updates this file and `openapi.yaml` in the same commit.

## What has no API here

These are existing Personalisation Hub functionality and are **not** changed
or exposed by this build: playback and what plays on a device, playlist
playback behaviour, targeting evaluation, distribution to players, playback
logging and campaign playback analytics. There is no delivery or analytics
endpoint, and **no billing endpoint yet**: billing runs in the Billing module
(`apps/api/src/billing/index.ts`, one seam: a cleared reservation plus
`PlaybackSource.totals` in, one idempotent line item out; see
PH-CORE-BOUNDARIES.md, "Billing — one module, one seam"). The line item,
including the 0034 columns (retained, no longer written, 5 Oct 2026), is stored and read only
by the booking schedule's billed total; no read of it is in this contract.

## Surfaces

| Surface | Base path | Who calls it | Auth |
|---|---|---|---|
| Partner API | `/v1` | Connected DSPs and tier-2 partners | Bearer token issued per partner |
| Admin API | `/admin/v1` | HQ Admin screens | Existing HQ Admin session |
| sellers.json | `https://[domain]/sellers.json` | Anyone | None |
| OpenRTB | Sent by us to each DSP's bidder endpoint | — | Per DSP |

All paths are served from the retailer's own instance
(`https://{instance}/api`).

## Conventions

- **JSON** everywhere except asset upload (`multipart/form-data`).
- **Errors** always use one shape:
  ```json
  { "error": { "code": "variable_not_permitted",
               "message": "Targeting uses variables this DSP may not use.",
               "details": [{ "variable": "visitor.age", "reason": "Not enabled for Google DSP" }] } }
  ```
  The variable (`visitor.age` here) is PH Core's; the exchange only
  permissions it per DSP and never evaluates it.
  Codes: `validation_failed`, `variable_not_permitted`, `checks_failed`,
  `not_approved`, `below_floor`, `advertiser_blocked`, `category_blocked`,
  `not_on_whitelist`, `not_invited`, `targeting_not_supported`, `too_many_versions`, `conflict`,
  `has_dependents`, `unauthorised`, `forbidden`, `not_found`,
  `rate_limited` (429, with `Retry-After`) and `internal_error` (500, a
  server fault; no internals are returned). A client error Fastify raises
  itself keeps its status — a body over 1 MB is `413 validation_failed`.
- **Partner API limits** (config defaults, `apps/api/src/config.ts`):
  - 50 requests/s per partner, bursts of 100, then `429 rate_limited`;
  - at most 2 asset uploads in flight per partner, and 4 across all
    partners (`PH_MAX_UPLOADS_IN_FLIGHT`; `429`);
  - forecast: at most 200 `positionIds`, each once;
  - content package: `name` and version ids ≤ 200 characters, ≤ 20
    targeted versions (a package-size guard at submission; the sellable
    count is the slot's Max campaigns, `maxCampaigns` on the position,
    enforced at bid and reservation), ≤ 10 AND groups, ≤ 20 conditions per group, ≤ 100
    values per condition, each value ≤ 200 characters;
  - writes (create, upload, submit, reserve, bid) need a **connected** DSP —
    `409 conflict` otherwise; reads stay open to the authenticated partner.
- **Headers on every response:** `X-Content-Type-Options: nosniff`,
  `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline';
  frame-ancestors 'none'`, `Referrer-Policy: no-referrer`, and
  `Cache-Control: no-store` on `/api/*`.
- **Visibility, not rejection.** Lists (inventory, targeting attributes) omit
  what a caller may not use; they never return an error for it.
- **Pagination:** `cursor` + `limit` (default 50, max 200); responses return
  `nextCursor` (null at the end).
- **Admin saves are whole-page `PUT`s**, matching the Save changes / Cancel
  model: the screen holds a draft and sends the whole page on Save changes.
  Deletes are separate and immediate.
- **Money:** amounts are in the company currency (ISO 4217), returned with
  every price.

## Pricing maths (used by inventory, forecast and the auction)

```
effective floor CPM = floorCpm × advertiser floorMultiplier   (every campaign type)

billing: every play = committed (clearing) CPM, whichever version played
```

Defaults: floor 100, advertiser 1.0. **There is no personalised multiplier**
(removed 5 Oct 2026; it was charged per personalised play from 30 Sep 2026).
Bids and the auction clear against the base floor × the advertiser's floor
multiplier whatever the campaign's type, and a window bills at the CPM it
clears at for every play. The advertiser's floor multiplier scales the floor
only. Interactive campaigns are deferred for this release (5 Oct 2026): a
campaign submission with an interactive layer is refused `422
targeting_not_supported`, and positions publish no interactive price. A position reports `pricing.effectiveFloorCpm.localised`
(the one floor).
Billing does not price on a play's version tier (`default`, `localised`,
`personalised`); which version played is PH Core's to supply
(PH-CORE-BOUNDARIES.md, "Playback") as reporting data, and every play bills at the
clearing CPM.

**Unscored slots are not sold** (30 Sep 2026). A slot with no audience
score reports 0 assumed views, so `GET /v1/inventory` leaves it out, `GET
/v1/inventory/{positionId}` (and its availability) answers 404, a forecast
that names it is refused `Unknown position`, and `POST /v1/reservations`
on it answers 409 `conflict` with the reason ("No audience score yet."). The auction skips it. A slot needs no
duration to be sold — duration belongs to the campaign asset. There
is no invented fallback estimate: an audience number would end up on
invoices. What a slot is scored from is explicit: its own `audience_vacd`
row, else its display type's **default VAC-d** (`phExtensions.defaultVacd`,
assumed views per play window per display; the slot's figure is the sum
over the type's displays, each at its own `displays.vacd_override` where
set). A type with no default and no slot score is the only unscored case.

**Computer-vision default (PH Core).** `PUT /admin/v1/display-types/{id}/default-vacd`
with `{"defaultVacd": <integer ≥ 0>}` lets PH Core write the default from the
score computer vision measured at the edge. **The automated score wins**
(decided 4 Oct 2026): it replaces a manually set default and is recorded as
`phExtensions.defaultVacdSource: "computer_vision"`, so slots scored from it
are **counted** (OpenRTB `sourcetype` 1). A manual edit through
`PUT …/extensions` still saves, is `"manual"` (modelled), and stands until
the next CV write; re-saving the form with the unchanged value keeps the
source. It targets the display-type default only — a display's counted VAC-d
and `vacd_override` stay with PH Core's scoring framework. Needs DSP
integration switched on.

## Partner API — `/v1`

### Inventory

| Method | Path | Purpose |
|---|---|---|
| GET | `/v1/inventory` | Sellable advertiser-owned positions this caller could buy. Filters: `advertiserId`, `displayTypeId`, `touchPoint`, `storeIds` (Personalisation Hub store IDs), `region` (the platform's store region), `from`, `to`, `status`. |
| GET | `/v1/inventory/{positionId}` | One position in full. |
| GET | `/v1/inventory/{positionId}/availability?from=&to=` | Status per play window: `available`, `reserved`, `sold`, `unavailable` — for a position sold by play window. A real-time position answers `sale: "realtime"` with no windows (see *Availability* below). |
| POST | `/v1/inventory/forecast` | Projected assumed views and estimated cost for positions, dates and optional targeting rules. |

A position returns: id, display type, slot and label, zone, store and
display counts (unique platform store IDs and displays using the display type), screen (width, height, orientation, slot duration, loop
length, share of voice, OpenOOH venue type), assignment (`rtb`,
`whitelist_only`, `reserved`), assumed views per window, pricing (floor
and the one effective floor for the caller's advertiser),
and `reservePrice`
(a CPM premium to reserve the position for a window, or
null — the resolved value: a slot's own override, else its display type's
reserve price default, else null; set on Advertisers / Inventory). A
buyer books it with `POST /v1/reservations`, `type: reserve` (see
*Reservations and bids* below).

**Availability:** `reserved` is a window held for a named advertiser, as
before. Since 29 Sep 2026 it also means a window a buyer has committed to
at the reserve price, or a window inside a private-auction term that is
locked. A window like that is spoken for. It is not auctioned and takes no
bids. It reads `sold` once it has played.

**Availability depends on how the position is sold (8 Oct 2026).** The
response carries `sale`:

- `window` — a position held for named advertisers (`reserved`) or assigned to
  a private auction (deal): genuine forward bookings exist, so `windows` has a
  status for every play window in the range, including locked-term and
  reserved windows.
- `realtime` — an open (`rtb`) or whitelist-only position. It is sold per
  impression, as the player signals; nothing is booked ahead, so there is no
  forward series to report and `windows` is `[]`. `bidLookaheadSeconds` says
  how long before a slot plays its auction opens: bid inside that window with
  the real-time signal, not by reserving a window. Reserving or bidding on a
  window of such a position answers `conflict` (409).

Hidden from the caller: HQ and Stores slots, positions reserved to another
advertiser, and positions the caller's advertiser is blacklisted from or not
whitelisted for.

### Targeting

| Method | Path | Purpose |
|---|---|---|
| GET | `/v1/targeting/attributes` | The shared targeting variables enabled for the calling DSP: key, source, label, group (`localisation` / `personalisation`), operators. Never values. |

### Campaigns (content packages)

| Method | Path | Purpose | Main errors |
|---|---|---|---|
| POST | `/v1/campaigns` | Create: `advertiserId`, `name`, `displayTypeId`, a mandatory `default` (pricing type) plus optional `targeted` versions (id, priority, pricing type, rules), and an optional `brief` (the advertiser's own campaign details, landing page, promoted products, SKUs, target audiences, objective and touch points — Digital Signage for now). `default` is required on every submission (decision, 22 Sep, superseding the earlier same-day "baseline optional" decision — ticket "Make default creative mandatory; retire localised-only booking path"): the earlier fallback-free/part-sold submission shape is retired — a slot goes to one advertiser, whose default layer is mandatory and localised/personalised targeted versions are optional upsells on that one purchase. | `validation_failed`, `variable_not_permitted` |
| POST | `/v1/campaigns/{id}/assets` | Upload creative for `default` or a targeted version; returns check results. On an approved campaign the upload is a **pending edit**, `awaiting_approval`, while the approved version keeps running (Q38) — unless every asset and the targeting are byte-identical to what a reviewer approved, when it is approved without review (safe reuse, Q40). | `checks_failed` |
| POST | `/v1/campaigns/{id}/submit` | Submit. Becomes `awaiting_approval`, or `approved` with mode `auto` when the advertiser doesn't require approval. | `checks_failed`, `conflict` |
| GET | `/v1/campaigns/{id}` | Read back the stored campaign: `default`, and every `targeted` version with its `id`, `priority`, `pricingType` and `rules` exactly as submitted, plus the status fields below. For checking what the exchange stored from your package. | `not_found` |
| PUT | `/v1/campaigns/{id}/deals` | Advertiser sets `dealIds` on its own campaign beyond the one it was authored with (crossover: direct, later also via a DSP). Returns the status with the full `dealIds` set. | `not_found`, `validation_failed` |
| GET | `/v1/campaigns/{id}/status` | `draft` / `awaiting_approval` / `approved` / `rejected`, mode, reason (the retailer's required rejection reason), asset version, `creativeId` (the creative ID the campaign is grouped under once approved — null until then; a DSP bids on this group, §3 "Creative IDs"); `liveAssetVersion` (the approved version that runs, or null) and `pendingEdit` (an edit to it awaits approval). A rejected edit is discarded — status is back to the live version's — and `rejectedEdit` (`assetVersion`, `reason`, `at`) says so until the next edit. | `not_found` |

**Targeting rules** use the existing Targeting-tab structure: a list of AND
groups, each a list of OR conditions `{source, variable, op, values}`.
Operators are the platform's Targeting-tab operators: `include` (includes
selected), `match_exactly`, `exclude_or` (excludes selected [OR]),
`exclude_and` (excludes selected [AND]), `equal`, `not_equal`,
`greater_than`, `less_than`, `greater_than_or_equal`, `less_than_or_equal`.
Which ones a variable takes is listed by `GET /v1/targeting/attributes`.
At most 100 values per condition: a cap on list length (SKU lists included). Whether a SKU exists is PH Core's to say; the exchange only counts.

**Validation only.** Every condition's variable must be enabled for the
calling DSP, otherwise `422 variable_not_permitted` naming each variable.
Valid rules are stored in the existing campaign targeting structure and
evaluated by the existing platform. The API never evaluates targeting.

**Shape, not pixels.** A creative need not match the display's resolution;
it must be the right *shape* (30 Sep 2026). `aspect_ratio` passes when the
asset's width÷height is within **±5%** of the target's, and `dimensions`
passes when the asset is at least **50% of the target in each dimension**
(a 1920×1080 canvas accepts 1280×720 and 3840×2160, and rejects 1080×1920,
1280×620 and 800×450). Larger assets are accepted — the player scales to
fit, and a near-miss ratio plays with modest letterboxing. On a zoned
display type the target is a **zone's own size**, not the full canvas.
Images and videos alike; a failure names which rule broke.

**Automated checks** (`checks[]`): `file_type`, `file_size`, `bitrate`,
`dimensions`, `aspect_ratio`, `duration`, `default_present`,
`targeting_permitted`, each with `passed` and `detail`. Two more are
**advisory** (`advisory: true`, Q40) — shown to the reviewer, never a gate
and never an approval: `dsp_audit` (the DSP's own creative audit — DV360
review status, The Trade Desk `approvedBy`, Amazon DSP moderation) and
`previously_cleared` (this asset is byte-identical to one a reviewer
already approved). `default_present`
asks whether the mandatory default layer's creative was uploaded — a
targeted version's creative can no longer stand in for it, now that
`default` is required on every submission. **`file_size` is per asset, not
per submission**: 100 MB for an image, 200 MB for a video — applies to the
default layer and every localised/personalised targeted version
independently. A file exceeding its type's limit fails `file_size` and is
returned immediately with `422 checks_failed`, never reaching the review
queue (`apps/api/src/config.ts` → `assetLimits`, enforced in
`apps/api/src/domain/assetChecks.ts`).

### Reservations and bids

| Method | Path | Purpose | Main errors |
|---|---|---|---|
| POST | `/v1/reservations` | `type: reserve` or `type: bid`, both with `bidCpm`, for a `positionId` and `windowStart`, with an approved and activated `campaignId` (`not_approved` otherwise). A reserve on a position with a `reservePrice` is a reserve-price booking (see below). A reserve on a position held for a named advertiser with no reserve price is booked at its agreed `bidCpm` (Q11). Any other reserve gets `conflict`. Only a position sold by play window takes a booking: one held for named advertisers (reserve) or assigned to a private auction (bid or reserve); every other position is sold in real time, per impression, and answers `conflict` (409). There is no company auction schedule (removed 8 Oct 2026): a window can be bid on or booked until it starts, or until its private auction has cleared it, and a deal is governed by its buyers list's `activeFrom`/`activeTo`/`auctionCloses`. `bidCpm` is at most the exchange ceiling (10,000; `validation_failed`). One open bid or reservation per advertiser and window, enforced by the database (migration 0026). A personalised campaign is accepted only in a `type: reserve` booking (`targeting_not_supported` otherwise). The campaign's version count (the default layer plus its targeted versions) must not exceed the position's `maxCampaigns` (`too_many_versions` otherwise). | `not_approved`, `below_floor`, `advertiser_blocked`, `category_blocked`, `not_on_whitelist`, `targeting_not_supported`, `too_many_versions`, `conflict` |
| GET | `/v1/reservations/{id}` | Outcome: `pending`, `won`, `lost`, `reserved`, `rejected`, with clearing CPM and reason. | `not_found` |

A won or reserved campaign is handed to the existing campaign system for
that slot and window; from there it plays and is reported on like any other
campaign.

**Reserve-price booking** (programmatic guaranteed; open questions 45 and 52,
decided by Rob on 29 Sep 2026): a `type: reserve` on a position whose
`reservePrice` is set commits the buyer to that window at the reserve price.

- `bidCpm` must be at least the `reservePrice` (`validation_failed` on
  `bidCpm` otherwise). The booking is made at the `reservePrice` itself,
  and its `clearingCpm` is the reserve price. "Premium" describes what the
  reserve price is, a CPM above what the open auction asks. Nothing is
  added to the floor.
- The reserve price must clear the buyer's effective floor, like any other
  rate (`below_floor` otherwise). The floor always wins.
- The window is held as Reserved at once: the reservation is `reserved`,
  availability reads `reserved`, and it is handed off.
- The auction skips the window. Other advertisers' bids for it are refused
  (`conflict`), and any that were already pending are settled `lost`. The
  one-live-winner index (migration 0021) also counts a `reserved` row.
- It is billed like every other booking: on the window's realised VAC-d
  at the reserve price. There is no guaranteed volume and no make-good.
- On a private auction (deal) that has `auctionCloses` set, the invited
  buyer must be entitled as for a bid (`not_invited`), and the deal must
  still be open (`conflict` once it is locked or its bidding has closed).
  The commitment then locks the deal's term at the reserve price
  (`lockedWin.source: reserve`). Every later window of the term is held as
  `reserved` and booked as a `reserved` reservation at that rate, with no
  auction.

**Deals** are per DSP and bilateral. They are the buyers lists below:
invited buyers resolved to DSP seats, the terms, and one locked winner
(`lockedWin.partnerId`). There is no company-wide deal. A deal's rate is
priced against the same floor as everything else. It sits on top of the
floor and never under it: a bid or reserve below the floor is refused
`below_floor`. A locked term window whose rate has fallen below the floor
in force when it is booked (because the floor or a multiplier rose) is not
sold, and falls through to the default campaign.

## Admin API — `/admin/v1`

Every endpoint requires an HQ Admin session. `admin` = admin users only (DSP
Integration, and saving advertiser settings); `approver` = may approve/reject
(HQ Admin role by default, open question 39); `sections` = admin or marketing
users (Display Types, Playlist Management, Advertisers / Inventory, Campaign
Status). Help desk users have none of these, so every admin endpoint returns
403 for them.
In the POC the session is a stand-in: the role comes from the `POC_ROLE`
env var, with no switcher and no cookie (see *POC stand-ins* below).

### Exchange settings

| Method | Path | Purpose |
|---|---|---|
| GET | `/admin/v1/exchange` | The DSP integration switch (`enabled`), organisation, domain, seller ID, contact email, the global deal master switch (`globalDealEnabled`, off for a new instance) and its fixed ID (`globalDealId`, `PH-GLOBAL`), `published`, `sellersJsonUrl`. |
| PUT | `/admin/v1/exchange` | Save changes. `enabled` is required. While it is true, all four fields are required; switched off, they may be blank and are kept as sent. `globalDealEnabled` is optional (omitted keeps the stored value). `published` is true, and sellers.json is served, only when switched on and complete. |
| GET | `/admin/v1/features` | `{ dspIntegration }`: whether the retailer has DSP integration switched on (always false with the build flag off). Readable by admin and marketing users, unlike Exchange settings, because it decides what the navigation shows. |

**The DSP integration switch** (Rob, 24 Sep 2026; REQUIREMENTS §7). Off
for a new instance (migration 0023). While it is off:

- the Partner API answers `404 not_found` ("DSP integration is switched
  off."), as with the build flag off;
- `sellers.json` answers 404;
- the auction sends no bid requests, and the scheduler doesn't run it.
  Windows already sold are still billed when they end.

The Admin API keeps answering, and switching off deletes nothing.

### Advertiser settings

| Method | Path | Purpose |
|---|---|---|
| GET | `/admin/v1/advertiser-settings` | Currency, floor CPM, multipliers, and the IAB `categoryWhitelist`/`categoryBlacklist` (one pair for every DSP; entries must be IAB taxonomy names, else `400`; there is no per-DSP override, and no company advertiser list). |
| PUT | `/admin/v1/advertiser-settings` | Save changes (pricing and lists). An entry can't be on both lists (`validation_failed`). There is no auction schedule or company play-window setting: `auctionOpensHours`, `auctionCutoffTime`, `playWindowHours` and the read-only `pendingPlayWindowHours`/`pendingPlayWindowEffectiveFrom` were removed on 8 Oct 2026 (migration 0059), and a body that still sends one is refused or ignored as unknown. |
| GET | `/admin/v1/available-inventory` | Rows: display type, playlist, slot, position, `assignedTo` (now also `buyersListId`/`buyersListName`, null unless the slot is a private auction), `reservePrice` (resolved), `reservePriceOverride` (this slot's own, null = inheriting) and `displayTypeReservePrice` (the display type's default, same on every row of that type), likewise `billingUnitHours` (resolved, always a number)/`billingUnitHoursOverride`/`displayTypeBillingUnitHours` (23 Sep 2026; when neither is set the slot uses the platform default of 24 hours; `companyPlayWindowHours` was removed from this response on 8 Oct 2026 — this resolved value is the slot's play-window length, see "Play windows are per slot" below), plus `inGlobalDeal` (the slot's own global deal flag, default true) and `globalDealSuppressedBy` (`reserved`, `whitelist_only`, `deal`, or null when open), and `dsps` (each DSP and its advertisers) for the Assigned to picker. `PUT` takes `inGlobalDeal` per item (omitted = unchanged). No advertisers column. |
| PUT | `/admin/v1/available-inventory` | Save changes — per slot, `assignedTo` (`partnerIds`, `advertisers`, `whitelistOnly`, `buyersListId`; nothing chosen = any connected DSP, an advertiser's DSP is added automatically, and `buyersListId` is mutually exclusive with `advertisers`/`whitelistOnly` — `validation_failed` if more than one is set, or if `buyersListId` names no buyers list), `reservePrice`/`reservePriceDefault` (this slot's own override and the display type's own default — a CPM, or null; real inheritance, 22 Sep — always send the slot's current values, there is no "unchanged" omission) and, the same shape, `billingUnitHours`/`billingUnitHoursDefault` (whole hours, 1–8760, or null; must be the same `…Default` on every row for a given display type in one request). A billing-unit change that would alter the resolved window length of a slot that still has live windows bid on, booked or not yet billed is refused (`validation_failed` on that row's `billingUnitHours`, naming when the last one ends; OQ27, 29 Sep 2026). The editable fields of a slot; its label and owner are set on its display type. Admin only. Removing an advertiser from a slot with a live booking is `409 has_dependents` (slots are sold); lock the slot instead. |
| PUT | `/admin/v1/available-inventory/lock` | Lock a sold slot against new sales (`displayTypeId`, `slot`). New bids, reservations and auction wins are refused (`409 conflict` on the Partner API; the window reads `unavailable`); existing bookings run on. `409 conflict` if nothing is booked on the slot. No unlock: the lock releases itself once the booking schedule has no live booking on the slot (bookings only, never playback). Rows carry `salesLocked` / `salesLockedUntil`. |
| GET | `/admin/v1/booking-schedule?from=&to=` | Reached from Available Inventory. Every advertiser-owned slot across its play windows: booked (advertiser, DSP, reserve or bid, the CPM it was booked at, booked and billed revenue), available or unavailable; plus booking revenue per display type and in total. Live bookings only (never Test mode). Default: the current window and the next 13; at most 92 days. `campaignId`, `advertiserId` or `partnerId` narrow it, and `advertiserId` leaves only the positions that advertiser holds; with `campaignId` the range covers all of that campaign's bookings. Each booking says which campaign type it is, and the response also totals the bookings by campaign type. `dsps` lists the DSPs and, under each, **only the advertisers with something booked in the range**, because that is what the filter is for. Each position also carries `displayCount` (displays using its display type across the whole retail footprint), and each booking a `layers` object (`default`, `localised`, `personalised` — which of the one advertiser's three layers this purchase actually carries, ticket "Booking schedule: single-advertiser stacking tile"), and a `personalisedTriggers` object (`computerVision`, `aggregateStore`, `individual`) when `layers.personalised`, `null` otherwise (ticket "Booking schedule: personalised trigger icons") — the client's stacked tile (see REQUIREMENTS §6) is built entirely from these fields plus `pricingType`, with no separate endpoint. |

### Shared targeting variables

| Method | Path | Purpose |
|---|---|---|
| GET | `/admin/v1/targeting-variables` | Every default variable: key, label, group, example values (tooltip text), access (`"all"` or a list of partner ids; `[]` = none). |
| PUT | `/admin/v1/targeting-variables` | Save changes: `access` map of variable key → `"all"` or partner ids. |

Defaults: Localisation Variables `"all"`, Personalisation Variables `[]`.

### DSPs

| Method | Path | Purpose |
|---|---|---|
| GET | `/admin/v1/partners` | Configured DSPs. |
| POST | `/admin/v1/partners` | Add a DSP by `provider` (`google_dv360`, `amazon_dsp`, `the_trade_desk`). Starts in `test`. |
| GET | `/admin/v1/partners/{id}` | One DSP, including `issues[]` for the top of its page. |

Every DSP response includes `seats` (`[{id, name}]`): the DSP's advertisers, pulled on connect. They're offered in the slot picker and as list suggestions.
| PUT | `/admin/v1/partners/{id}` | Save changes: credentials, bidder endpoint + seat IDs, optional per-DSP `bidder.qps` (1–10,000) and `bidder.timeoutMs` (50–2,000; also sent as `tmax`) overriding the platform defaults of 500 QPS / 300 ms — `null` clears an override (Q46) — mode, lists link / own lists. |
| POST | `/admin/v1/partners/{id}/connect` | Connect or re-test with saved credentials; pulls seats/advertisers. Error text from the DSP goes to `lastSync` and `issues`. |
| POST | `/admin/v1/partners/{id}/disconnect` | Disconnect; mode returns to `test`. |

Credentials per provider (secrets are write-only; responses show only
`{ "set": true }`):

| Provider | Fields (secret in bold) |
|---|---|
| `google_dv360` | partnerId, serviceAccountEmail, **privateKeyJson** |
| `amazon_dsp` | region, lwaClientId, **lwaClientSecret**, **refreshToken**, profileId, entityId |
| `the_trade_desk` | supplySourceId, ttdPartnerId, **apiToken**, region |

`mode: "live"` is rejected (`conflict`) unless the DSP is connected and the
bidder integration is complete. A DSP has only its own advertiser lists
(`advertiserWhitelist`/`advertiserBlacklist`); category lists are company-wide
(`/admin/v1/advertiser-settings`) and cannot be set per DSP.

`issues[].kind`: `connection_error`, `missing_credentials`,
`missing_bidder_fields`.

### Advertisers (admin only)

| Method | Path | Purpose |
|---|---|---|
| GET | `/admin/v1/advertisers` | Every advertiser across DSPs: name, via (DSPs), approval required, floor multiplier, effective floor CPM, its campaigns by approval status and `bookings` (play windows it holds from the current one on, 0 = nothing to open on the schedule); plus company currency and floor. |
| PUT | `/admin/v1/advertisers` | Save changes: `settings` map of advertiser id → `{approvalRequired, floorMultiplier}`. |

Non-admin sessions get `403 forbidden`.

### Buyers lists (private auctions; admin only)

Reusable deal objects for Available Inventory's third assignment mode
(REQUIREMENTS §5 "Private auctions (buyers lists)") — one deal, attachable
to any number of slots via `available-inventory`'s `assignedTo.buyersListId`.

| Method | Path | Purpose |
|---|---|---|
| GET | `/admin/v1/buyers-lists` | Every buyers list: `id`, `name`, `description`, `dealType` (`private_auction`, `preferred` or `guaranteed`: the one place a deal's type is set; a reservation on a slot using the list follows it), `invitedBuyers` (`partnerId` and `seatId`: a seat a connected DSP synced; POST/PUT refuse a DSP that isn't connected or a seat it never synced), `invitedCategories` (IAB category names whose advertisers are all invited, resolved live against each seat's DSP-reported `category`; a union with `invitedBuyers`; the advertiser blacklist still subtracts), `activeFrom`/`activeTo` (the delivery term; ISO date-time or null = no bound), `auctionCloses` (the auction window's bidding deadline; ISO date-time or null = not using the two-period model), `committedPlays` (the play volume the deal commits to over its delivery term: a whole number >= 1, or null = per play; volume lives on deals, never the open auction) and `deliveredPlays` (read only: plays billed at every position the deal is attached to, in windows starting inside the term; 0 when `committedPlays` is null), `lockedWin` (null until the term's one-time auction clears or an invited buyer commits at the reserve price; then `{cpm, partnerId, advertiserId, campaignId, pricingType, channel, lockedAt, source}`, read only; `source` is `auction` or `reserve`, and a missing `source` reads as `auction`). |
| POST | `/admin/v1/buyers-lists` | Create: `name`, `description`, `dealType` (optional; omitted = `guaranteed` if `committedPlays` is set, else `private_auction`; `committedPlays` is refused unless `guaranteed`, `auctionCloses` unless `private_auction`), `invitedBuyers` and/or `invitedCategories` (IAB taxonomy only, else `400 validation_failed` on `invitedCategories[i]`; at least one buyer or category is required), `activeFrom`, `activeTo`, `auctionCloses` (optional; null = not using the two-period model), `committedPlays` (optional; whole number >= 1 or null). `422 validation_failed` naming the field (e.g. `name`, `invitedBuyers[0].value`, `activeTo` if before `activeFrom`). `lockedWin` can't be set here. The exchange writes it once: the first time a bid clears within `auctionCloses`, or when an invited buyer first commits at the reserve price. |
| PUT | `/admin/v1/buyers-lists/{id}` | Replace the same fields (not `lockedWin`). `404` if unknown, `422 validation_failed` as above. |
| DELETE | `/admin/v1/buyers-lists/{id}` | Delete. `409 has_dependents` naming every slot still assigned to it (a slot's own `displayTypeName — position`) — a buyers list can't be removed out from under a live position. |

Non-admin sessions get `403 forbidden`. Which DSPs a deal position actually
opens to is resolved live from a list's current `invitedBuyers` on every
auction/bid — nothing here is cached on the slot, so editing a list here
takes effect immediately everywhere it's attached.

**The two-period model** (REQUIREMENTS §5 "Private auctions (buyers
lists)" → "Locked rate", 23 Sep 2026): a deal with `auctionCloses` set
still clears a real auction every play window until a bid clears at or
before that deadline; that clear locks `lockedWin` (once — first clear
wins) and every later play window in the delivery term (`activeFrom`/
`activeTo`) is then booked directly at `lockedWin.cpm`, with no bid
requests. A reserve-price commitment by an invited buyer locks it the same
way, at the reserve price (*Reserve-price booking* above); those windows
are booked `reserved` rather than `won`. No locked window is booked below
the floor in force when it is booked. A deal with `auctionCloses` left `null` is unaffected — it keeps
clearing fresh every window, exactly as before this field existed. Also
see `available-inventory`'s `billingUnitHours`/`billingUnitHoursOverride`/
`displayTypeBillingUnitHours` (same override/default shape as
`reservePrice`) — the granularity a CPM is quoted and charged against, and
(OQ27, 29 Sep 2026) the length of every window the slot is sold in, so each
window of a locked-rate term is one billing unit long.

**Play windows are per slot** (OQ27, decision Rob, 29 Sep 2026). A slot's
resolved billing unit — its own override, else its display type's default,
else the platform default of 24 hours (a named constant; the company
`playWindowHours` setting was removed on 8 Oct 2026) — is its play-window
length. Every length is laid back to back from the same anchor (Monday
00:00 UTC), so a 168-hour slot's windows start on Mondays, which are also
daily slots' window starts: one auction (keyed on the window start) clears
every position whose own window starts then. The Inventory API
(`billingUnitHours`, `playsPerWindow` and `assumedViewsPerWindow` on a position, each
availability window's `start`/`end`), `POST /v1/reservations`' `windowStart`,
the bid request's `exp` and `qty.multiplier`, the hand-off booking and
billing (one line item per window, expected seconds and assumed views for
that window's length) all follow it. **The play is the transacting unit**
(6 Oct 2026): a window's time length is shown alongside the play count it
holds — `playsPerWindow` = floor(window / `screen.maxPlayLengthSec`) — the slot's
max play length, never the loop length — plays on one display,
also sent as `imp.ext.ph.playsPerWindow` — and the impression multiplier
(VAC-d, `qty.multiplier`) only converts plays to estimated impressions for
pricing and billing. Billing is unchanged: plays × multiplier. Assumed views are scored per platform-default
window (`AudienceSource`) and scaled to a slot's own window length. A
slot's own billing unit can't change while it has live
windows (see `PUT /admin/v1/available-inventory`).

**Real time, not windows, for everything else** (8 Oct 2026, decision Rob):
the windowed auction was retired. An open or whitelist-only position is
sold per impression (`POST /impressions`, Player API), has no per-slot
`bidMode` (`advance`/`realtime` removed) and takes no window booking. Only
positions held for named advertisers or assigned to a private auction are
booked or bid by window.

### Campaign approval

| Method | Path | Purpose |
|---|---|---|
| GET | `/admin/v1/approvals?status=` | Campaigns by approval status, with `counts` for all four statuses (the table filter). |
| GET | `/admin/v1/campaigns/{id}/approval` | State, checks (each optionally naming the `assetId` it ran against), targeting summary, `creative` (`assetUrl`, `mimeType`, `width`, `height`, optional `contentHash`) and target `canvas` (`width`, `height`) for rendering the creative on its canvas, and audit trail (review panel). |
| POST | `/admin/v1/campaigns/{id}/approve` | Approve the reviewed `assetVersion` (`conflict` if it changed). Approving a pending edit makes it the live version in one step (Q38). Also records human clearance of every asset's current content hash and of the targeting rules, for safe reuse (Q40). |
| POST | `/admin/v1/campaigns/{id}/reject` | Reject with `assetVersion` and a required `reason`. Optional `assetReasons: [{assetId, reason}]` names specific assets that failed (spec §3, "asset-level rejection"). Rejecting a pending edit discards it; the campaign stays approved at its live version, with `rejectedEdit` set (Q38). |
| POST | `/admin/v1/approvals/approve-assign` | **Approve + assign to a creative ID** (approver scope). Takes `items: [{campaignId, assetVersion}]` and an optional `creativeId`: omitted or `null` mints a new ID across the campaigns, a value joins that existing ID. All or nothing — `400` for a selection spanning advertisers, an HQ campaign, an empty list, or an ID of a different advertiser; `404` for an unknown ID; `409` for a stale `assetVersion` or a campaign not Awaiting approval. Returns `creativeId` and the `approvals`. Reject uses `/campaigns/{id}/reject` and needs its `reason`. Two flows share it — direct (no deal ID) and private auction (campaigns carry a `dealId`, approved per subset; a fixed campaign re-attaches to its deal group's creative ID); see REQUIREMENTS §3 *The two approval flows*. |
| POST | `/admin/v1/approvals/assign-creative-id` | **Auto-approved advertisers only**: group already-Approved campaigns under a new or existing creative ID (`campaignIds`, optional `creativeId`). `400` if the advertiser's campaigns need retailer approval (the retailer assigns those) or the ID is another advertiser's; `409` if a campaign is not Approved. All or nothing. |
| GET | `/admin/v1/creative-ids?advertiserId=&dealId=` | Creative IDs with their member campaigns (`campaignId`, `name`, `touchPoints`, `dealIds`) and the creative's own `dealIds` / `direct` — what the existing-ID picker shows. `dealId` resolves per deal (a creative in three deals is listed under each); empty lists IDs with a direct arrangement. |
| PUT | `/admin/v1/campaigns/{id}/deals` | Retailer sets `dealIds` on a campaign beyond its authored deal (approver scope). |
| POST | `/admin/v1/campaigns/{id}/unreject` | Undo a mistaken rejection: `Rejected` → `Awaiting approval` (`conflict` if not currently Rejected, or if `assetVersion` changed since). Takes `assetVersion` and an optional `reason`; never auto-approves. Same permission as approve/reject. |

Audit actions: `submitted`, `auto_approved`, `approved`, `rejected`,
`returned_for_review`, `unrejected`, `edit_discarded` (a rejected edit was
thrown away, Q38), `reused_clearance` (approved without review, every asset
already human-cleared, Q40). Every view also carries `liveAssetVersion`
and `pendingEdit`. These back the drop-in approval module
that plugs into the existing campaign table (see
`CAMPAIGN-APPROVAL-INTEGRATION.md`).

### Display types and playlists

| Method | Path | Purpose |
|---|---|---|
| PUT | `/admin/v1/display-types/{id}/extensions` | Save slot ownership (`slots[]`: label and owner `internal`/`advertiser`/`retail`; `409 has_dependents` if a sold Advertiser slot's owner would change) and venue metadata. Who a slot is assigned to and what targeting it supports are carried over from the stored slot — they are edited on `/admin/v1/available-inventory` — and dropped when a slot stops being an Advertiser slot. While DSP integration is switched off, a slot can be `advertiser` only if it already was: a new one is `400 validation_failed` on `slots[i].owner`. Other display type fields keep using the existing API. |
| GET | `/admin/v1/display-types/{id}/delete-check` | `canDelete` and `dependents[]` (assigned displays with store). |
| DELETE | `/admin/v1/display-types/{id}` | Delete; `409 has_dependents` listing displays if any remain, or listing each window (`<position> · window <date> · sold\|reserved`) while any of its positions is reserved or sold for a current or future window (Q47). |
| GET | `/admin/v1/playlists/{id}/delete-check` | `canDelete` and `dependents[]` (display type defaults and zones). |
| DELETE | `/admin/v1/playlists/{id}` | Delete; `409 has_dependents` if it is a default or zone playlist. |
| PUT | `/admin/v1/playlists/{id}/settings` | This playlist's own settings. `409 has_dependents`, naming each window, while a display type using it has a position reserved or sold for a current or future window (Q47). |

## POC stand-ins for the existing platform

> **Venue and geo metadata (decision 29 Sep 2026, Q35).** PH Core owns venue
> and geo metadata and is the system of record; the exchange reads it
> read-only into inventory and targeting and keeps no copy. The
> `/extensions` venue fields below are a POC stand-in for that read.
> **Campaign status** is retrieved by polling `GET /v1/campaigns/{id}/status`;
> there are no webhooks in this build (Q41).

This repo is a standalone proof of concept. It can't reach the existing
Personalisation Hub APIs, so these endpoints stand in for them. They are
**POC only**: engineering replaces them with the existing APIs on
integration, and nothing else in the build may depend on their internals.

| Method | Path | Stands in for |
|---|---|---|
| GET | `/admin/v1/display-types` | Listing display types (existing fields plus `phExtensions`). |
| POST | `/admin/v1/display-types` | New display type; also creates its auto-created playlist. |
| GET | `/admin/v1/display-types/{id}/record` | One display type. |
| PUT | `/admin/v1/display-types/{id}/record` | Save changes to the existing display type fields. Slot ownership and venue are saved through `/extensions` (above). Changing the default or a zone's playlist is `409 has_dependents` while any of its positions is reserved or sold for a current or future window (Q47). |
| GET | `/admin/v1/playlists` | Playlists with their display type and zone assignments. |
| PUT | `/admin/v1/playlists/{id}/record` | Rename a playlist (`name` only). Assignments are made on the display type form (spec §2). |
| GET | `/admin/v1/campaigns` | The existing campaign list, for the stand-in POC campaign table (`campaignId`, name, source, advertiser, partner, display type, pricing type, `brief`, `schedule` (next booked window and how many it holds) and `activation`), plus the playlist summary the table's own columns read (ticket "Campaign Status: Playlist name column..."): `campaignCount` (this submission's layers — the mandatory default plus each targeted version), and `localisedVariables`/`personalisedVariables` (deduped variable names, for the column) with `localisedRuleLines`/`personalisedRuleLines` (the exact rule text behind them, for the column's hover), each split by that layer's pricing type. Approval state comes from `/admin/v1/approvals`. |
| PUT | `/admin/v1/campaigns/{id}/activation` | The existing activation toggle: `{enabled}`. `422 not_approved` unless the campaign is Approved. |
| GET | `/admin/v1/session` | The current user and role: `hq_admin` (everything, including DSP Integration, saving advertiser settings and approving), `hq_marketing` (Display Types, Playlist Management, Advertisers / Inventory read-only, Campaign Status; the last two only while DSP integration is switched on, `GET /admin/v1/features`) or `hq_helpdesk` (none of it). In the POC the role comes from the `POC_ROLE` env var: there is no switcher and no session cookie. |

## Jobs with no API

- **SSP auction**: a scheduled job clears each private-auction play window
  once its list's `auctionCloses` has passed (there is no company auction
  schedule, removed 8 Oct 2026), ahead of time (OpenRTB section below). For demos, `npm run auction:run` runs one window. No UI
  and no endpoint. Which process clears a window is settled in the
  database (`auction_runs`, migration 0024): a tick claims the window
  first, so several API instances, a CronJob and the CLI can all see a
  private auction's close pass and exactly one of them auctions it — DSPs are sent one
  round of bid requests. The scheduled work runs in the API process every
  minute (`PH_SCHEDULER=in-process`, the default) or from outside
  (`PH_SCHEDULER=off` and `npm run scheduler:tick` once a minute — a
  Kubernetes CronJob, `deploy/kubernetes/`).
  **`PH_TEST_CLOCK`** (test only) sets "now" for the API and `scheduler:tick`: an ISO
  instant, or the path of a file holding one (re-read on every call, so a
  runner advances every process by rewriting it). It lets a test pass an
  auction close or a window end without changing any company setting; the
  API refuses to start with it set under `NODE_ENV=production`.
  **Test-only endpoints** (E2E Testing Strategy §3.3, 1 Oct 2026; off under
  `NODE_ENV=production`, where they are 404): `POST /admin/v1/test/plays`
  `{reservationId, plays: [{tier, count, durationSec?}]}` writes plays with a
  version tier into the stand-in `plays` table for a won window, spread over
  the display type's displays and through the window, so a run can bill it
  after moving the clock past the window end. On the mock DSP service,
  `POST /_control/bidder {mode: "no-bid" | "scripted" | "default", dsps?}`
  switches every mock bidder at once (`scripted` leaves each DSP's own
  `PUT /_control/{dsp}/bidder` settings in force). The Run 6 journey runner
  (`npm run e2e:journey`, `apps/api/test/journey/`) uses all three: fresh
  database per run, mock bidders set to no-bid for the whole journey so the
  auto-approved DSP creative can never alter an outcome, L2 as an API bid.
- **Billing**: billing line items (dynamic VAC-d, reconciled against
  existing playback data; one per window, each window its slot's billing
  unit long — OQ27) are stored only. `npm run billing:print` prints
  them for testing. No UI, report or API. Billing reads only the windows it
  can bill now and counts a window's plays where they are stored
  (`PlaybackSource.totals`), so it costs the same after a year of windows
  as on day one (scalability review, 24 Sep 2026).
  A close missed by hours (the process down) is still auctioned as long
  as the window hasn't started; a window that starts with bids still
  pending has them settled `lost` with a reason (stability review, 24 Sep
  2026). A DSP's malformed answer, or a fault clearing one position, is
  that position's outcome, never the auction's.
- **Retention**: rejected, lost and never-cleared bids are deleted
  `PH_RESERVATION_RETENTION_DAYS` (default 90) after their window; won and
  reserved windows are kept. Rejected campaigns and their assets are
  deleted after 30 days (spec §3), never their audit trail.

**Not on `/api`.** `/sellers.json`, `/healthz`, `/readyz` and `/assets/{file}`
are served at the root of the instance; `openapi.yaml` gives each its own
`servers` entry. `/assets/{file}` serves a creative the asset store generated
(POC stand-in for the platform's hosting), with `nosniff` and a CSP that
blocks script on every response.

**Authentication tokens are spec only.** Partner tokens today are one static
bearer per DSP from config. The scoped, rotating credentials of AUTH-CREDENTIAL
(token endpoint, scope model) are specified in REQUIREMENTS §9.5 and
PH-CORE-BOUNDARIES.md and are **not built**: nothing in this API issues or
scopes a token.

**Display VAC-d.** A display's own VAC-d override (`displays.vacd_override`,
migration 0035) has no endpoint: it is a PH Core fact, set in the stand-in's
data only. A window the retailer has locked reads `status: unavailable`
without a reason; the lock is in the admin inventory
(`salesLocked`), not in the Partner API.

## Operations endpoints

For whatever supervises the process — Kubernetes probes, a load balancer's
health check — at the root like `sellers.json`, with no authentication and
no partner or admin data (`openapi.yaml`, tag *Operations*):

| Method | Path | Answers |
|---|---|---|
| GET | `/healthz` | `{ "ok": true }` while the process is up. |
| GET | `/readyz` | `{ "ok": true }` once the database answers and every migration is applied; `503 { "ok": false, "reason" }` until then, which keeps a new instance out of the load balancer while it migrates. |

## sellers.json

Published at `https://[domain]/sellers.json` once DSP integration is
switched on and Exchange settings are complete; `404` otherwise.

```json
{
  "contact_email": "adops@demoretail.example",
  "version": "1.0",
  "sellers": [
    { "seller_id": "drg-4471", "seller_type": "PUBLISHER",
      "name": "Demo Retail Group", "domain": "demoretail.example",
      "is_confidential": 0 }
  ]
}
```

## OpenRTB — what we send and accept

OpenRTB 2.6 with the DOOH object, sent to each connected DSP's bidder
endpoint within 300 ms timeout and 500 QPS (platform defaults). Test-mode
DSPs receive requests; nothing they win is billed or handed off.

**Deals (private auctions).** A position assigned a buyers list sends
`imp[0].pmp = { private_auction: 1, deals: [{ id: "PH-<buyers list id>", at: 1, wseat: [<the DSP's invited seats>] }] }`.
The deal ID is derived from the list (no stored column). A bid on that position
must quote it as `bid.dealid`; a bid with no `dealid` or another one is rejected.
Per-DSP deal-ID format requirements are still to be confirmed.

**The global deal (8 Oct 2026).** For DSPs that can only transact on deals, a
single instance-wide deal ID, `PH-GLOBAL`, resolves to all open, exchange-eligible
inventory. While the retailer's master switch is on (Exchange settings,
`globalDealEnabled`), a bid request for an open position whose slot is in the
global deal carries
`imp[0].pmp = { private_auction: 0, deals: [{ id: "PH-GLOBAL", at: 1 }] }`:
`private_auction` is 0 and there is no `wseat`, so it is never mistaken for a
private or locked deal. A bid may quote `PH-GLOBAL` or no `dealid`; it competes
exactly as on the open exchange: same base floor (`imp.bidfloor` is unchanged),
first-price, same pre-auction checks, approval gate and USD rule. It does not
lower the floor and gives no guaranteed delivery. A bid that quotes `PH-GLOBAL`
on a position that is not in the global deal is rejected. A slot is in the
global deal when the master switch is on, its `inGlobalDeal` flag is not false
(the default) and it is open: a slot held for named advertisers, whitelist-only
or assigned to a buyers list is never in it, and then carries its own deal (a
buyers list's `PH-<id>`) or none. Advertiser blacklists and DSP seat lists
apply as they do for open exchange.

**Bid request (per sellable position and play window):**

```json
{
  "id": "req_7f3a",
  "imp": [{
    "id": "1",
    "video": { "w": 1920, "h": 1080, "minduration": 15, "maxduration": 15 },
    "bidfloor": 100.0,
    "bidfloorcur": "AUD",
    "qty": { "multiplier": 412.0, "sourcetype": 2 },
    "exp": 86400
  }],
  "dooh": {
    "id": "dt_landscape",
    "venuetype": ["retail.grocery"],
    "venuetypetax": 1,
    "publisher": { "id": "drg-4471", "name": "Demo Retail Group", "domain": "demoretail.example" }
  },
  "device": { "geo": { "lat": -33.8688, "lon": 151.2093, "type": 3 } },
  "source": {
    "schain": { "complete": 1, "ver": "1.0",
      "nodes": [{ "asi": "demoretail.example", "sid": "drg-4471", "hp": 1 }] }
  },
  "cur": ["AUD"],
  "bcat": ["IAB7"],
  "badv": ["redbull.com"],
  "tmax": 300,
  "at": 1
}
```

- `bidfloor` = effective floor CPM for the position (the base floor × the
  advertiser's multiplier; 100 in this example, not a personalised floor); `bidfloorcur` = company
  currency.
- `qty.multiplier` = assumed views for the window (VAC-d); `sourcetype` is always 2
  (publisher-provided: the audience counts come from our own cameras) on every DSP, and no
  measurement `vendor` domain is sent. 1 (measurement vendor) is only for an independent
  measurement partner, with that vendor's domain.
- `bcat` / `badv` = the effective category and advertiser blacklists for
  this DSP.
- **The Trade Desk is the exception**: it does not read `wseat`/`badv`, so a
  TTD request carries no `badv` and instead sends the retailer's per-DSP lists
  as `ext.seatperms`, `ext.advperms` and `ext.domainperms`, each
  `{ "allow": [...], "block": [...] }` (IDs for seats/advertisers, domains for
  `domainperms`). DV360 and Amazon keep `badv`. The allow/block encoding is an
  assumption to confirm with TTD at integration.
- **Never included:** any visitor data, Personalisation Variables or
  Computer Vision values; no `user` object.
- Screen and loop context (orientation, slot duration, max play length, loop
  length, share of voice) go in `imp.ext.ph` if the DSP doesn't read them from
  DOOH fields: `{ "orientation": "landscape", "slotDurationSec": 15,
  "maxPlayLengthSec": 15, "loopLengthSec": 45, "shareOfVoice": 0.333 }`.
  `maxPlayLengthSec` is informational for the loop: plays are not counted
  against `loopLengthSec`. `imp.video.maxduration` is the max play length
  (`minduration` and `maxduration` are both the slot's fixed play), so a
  creative longer than it is rejected rather than truncated.

**Bid response — what we require:** `seatbid[].seat`, `bid.price` (CPM,
≥ `bidfloor`), `bid.crid` (a reference label; the creative it points at must be an approved creative, identified by content hash), `bid.adomain`
(checked against the advertiser lists) and `bid.cat` (checked against the
category lists). A bid failing any of these is dropped before the auction
clears. Also (review, 23 Sep 2026):

- the response `id` echoes the request `id`, or the whole response is no bid;
- `cur` is the company currency — a response **without** `cur` is USD, per
  OpenRTB, and is rejected unless the company trades in USD;
- `bid.impid`, when present, is `"1"`; `bid.price` is finite and at most
  10,000 (`maxBidCpm`);
- at most 10 bids per response are read, and a body over 64 KB is no bid;
- a bid whose `crid` has not been fetched and hashed recently (or whose
  `iurl` changed) has its creative retrieved from its `iurl` and hashed;
  identical bytes under any crid or DSP are one PH creative —
  only under that DSP's own creative path (compared after URL
  normalisation), at most one per response, capped at the asset size
  limit; the others are retried from a later window.

Every DSP for a position is asked at once, and positions clear 16 at a
time, so an auction takes about one bidder timeout per 16 positions however
many DSPs there are. One live winner per position and window is enforced
by the database, so two clearings of the same window can't both sell it.

Exact DOOH object support and taxonomy version are confirmed per DSP before
Live (spec §7 "To confirm before building").
