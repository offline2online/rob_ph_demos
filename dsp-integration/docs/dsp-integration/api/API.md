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
endpoint.

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
  Codes: `validation_failed`, `variable_not_permitted`, `checks_failed`,
  `not_approved`, `below_floor`, `advertiser_blocked`, `category_blocked`,
  `not_on_whitelist`, `not_invited`, `targeting_not_supported`, `conflict`,
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
    targeted versions, ≤ 10 AND groups, ≤ 20 conditions per group, ≤ 100
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
effective floor CPM = floorCpm
                    × personalisedMultiplier   (personalised campaigns only)
                    × advertiser floorMultiplier

per engagement      = interactiveCpe           (interactive campaigns, on top)
```

Defaults: floor 100, personalised 1.5, advertiser 1.0, cost per engagement
0.50. Localised and default campaigns use floor × advertiser multiplier
only. Interactive is **not** a multiplier: such a campaign clears the same
CPM floor as its targeting type and pays `interactiveCpe` for each
engagement (a QR Control scan) on top, unscaled by the advertiser
multiplier. A position reports both — `pricing.effectiveFloorCpm`
(`localised`, `personalised`) and `pricing.costPerEngagement`.

## Partner API — `/v1`

### Inventory

| Method | Path | Purpose |
|---|---|---|
| GET | `/v1/inventory` | Sellable advertiser-owned positions this caller could buy. Filters: `advertiserId`, `displayTypeId`, `touchPoint`, `storeIds` (Personalisation Hub store IDs), `region` (the platform's store region), `from`, `to`, `status`. |
| GET | `/v1/inventory/{positionId}` | One position in full. |
| GET | `/v1/inventory/{positionId}/availability?from=&to=` | Status per play window: `available`, `reserved`, `sold`, `unavailable`. |
| POST | `/v1/inventory/forecast` | Projected assumed views and estimated cost for positions, dates and optional targeting rules. |

A position returns: id, display type, slot and label, zone, store and
display counts (unique platform store IDs and displays using the display type), screen (width, height, orientation, slot duration, loop
length, share of voice, OpenOOH venue type), assignment (`rtb`,
`whitelist_only`, `reserved`), assumed views per window, pricing (floor
and effective floors for localised, personalised, interactive, and
personalised + interactive) for the caller's advertiser, and `reservePrice`
(a CPM premium to reserve the position in advance of the open auction, or
null — the resolved value: a slot's own override, else its display type's
reserve price default, else null; set on Advertisers / Inventory —
publishing it does not by itself book a guaranteed slot, see open
question 52).

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
| POST | `/v1/campaigns/{id}/assets` | Upload creative for `default` or a targeted version; returns check results. | `checks_failed` |
| POST | `/v1/campaigns/{id}/submit` | Submit. Becomes `awaiting_approval`, or `approved` with mode `auto` when the advertiser doesn't require approval. | `checks_failed`, `conflict` |
| GET | `/v1/campaigns/{id}/status` | `draft` / `awaiting_approval` / `approved` / `rejected`, mode, reason, asset version. | `not_found` |

**Targeting rules** use the existing Targeting-tab structure: a list of AND
groups, each a list of OR conditions `{source, variable, op, values}`.
Operators are the platform's Targeting-tab operators: `include` (includes
selected), `match_exactly`, `exclude_or` (excludes selected [OR]),
`exclude_and` (excludes selected [AND]), `equal`, `not_equal`,
`greater_than`, `less_than`, `greater_than_or_equal`, `less_than_or_equal`.
Which ones a variable takes is listed by `GET /v1/targeting/attributes`.
At most 100 values per condition (SKU lists).

**Validation only.** Every condition's variable must be enabled for the
calling DSP, otherwise `422 variable_not_permitted` naming each variable.
Valid rules are stored in the existing campaign targeting structure and
evaluated by the existing platform. The API never evaluates targeting.

**Automated checks** (`checks[]`): `file_type`, `file_size`, `bitrate`,
`dimensions`, `aspect_ratio`, `duration`, `default_present`,
`targeting_permitted`, each with `passed` and `detail`. `default_present`
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
| POST | `/v1/reservations` | `type: reserve` (named advertiser positions) at its agreed reservation price, or `type: bid`, both with `bidCpm` (the CPM; a reservation is booked at it), for a `positionId` and `windowStart`, with an approved and activated `campaignId` (`not_approved` otherwise). Only while the window's auction is open: from `auctionOpensHours` before the auction cutoff until the cutoff (`conflict` otherwise). The campaign's type must be one the position supports (`supportedTargeting`; `targeting_not_supported` otherwise). | `not_approved`, `below_floor`, `advertiser_blocked`, `category_blocked`, `not_on_whitelist`, `targeting_not_supported`, `conflict` |
| GET | `/v1/reservations/{id}` | Outcome: `pending`, `won`, `lost`, `reserved`, `rejected`, with clearing CPM and reason. | `not_found` |

A won or reserved campaign is handed to the existing campaign system for
that slot and window; from there it plays and is reported on like any other
campaign.

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
| GET | `/admin/v1/exchange` | The DSP integration switch (`enabled`), organisation, domain, seller ID, contact email, `published`, `sellersJsonUrl`. |
| PUT | `/admin/v1/exchange` | Save changes. `enabled` is required. While it is true, all four fields are required; switched off, they may be blank and are kept as sent. `published` is true, and sellers.json is served, only when switched on and complete. |
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
| GET | `/admin/v1/advertiser-settings` | Currency, floor CPM, multipliers, the auction schedule (`auctionOpensHours`, `playWindowHours`, `auctionCutoffTime`), advertiser and category whitelists/blacklists, and read-only `whereTheseApply` (per DSP: adopting or own lists). |
| PUT | `/admin/v1/advertiser-settings` | Save changes (pricing, auction schedule and lists). An entry can't be on both lists, and the play-window length can't change while future windows are bid on or booked (`validation_failed`). |
| GET | `/admin/v1/available-inventory` | Rows: display type, playlist, slot, position, `assignedTo` (now also `buyersListId`/`buyersListName`, null unless the slot is a private auction), `supportedTargeting`, `reservePrice` (resolved), `reservePriceOverride` (this slot's own, null = inheriting) and `displayTypeReservePrice` (the display type's default, same on every row of that type), likewise `billingUnitHours` (resolved, always a number)/`billingUnitHoursOverride`/`displayTypeBillingUnitHours` (23 Sep 2026 — platform default 24 hours when neither is set), plus `dsps` (each DSP and its advertisers) for the Assigned to picker. No advertisers column. |
| PUT | `/admin/v1/available-inventory` | Save changes — per slot, `assignedTo` (`partnerIds`, `advertisers`, `whitelistOnly`, `buyersListId`; nothing chosen = any connected DSP, an advertiser's DSP is added automatically, and `buyersListId` is mutually exclusive with `advertisers`/`whitelistOnly` — `validation_failed` if more than one is set, or if `buyersListId` names no buyers list), `supportedTargeting` (at least one of `localised`, `personalised`, `interactive`), `reservePrice`/`reservePriceDefault` (this slot's own override and the display type's own default — a CPM, or null; real inheritance, 22 Sep — always send the slot's current values, there is no "unchanged" omission) and, the same shape, `billingUnitHours`/`billingUnitHoursDefault` (hours, minimum 1, or null; must be the same `…Default` on every row for a given display type in one request). The editable fields of a slot; its label and owner are set on its display type. Admin only. |
| GET | `/admin/v1/booking-schedule?from=&to=` | Reached from Available Inventory. Every advertiser-owned slot across its play windows: booked (advertiser, DSP, reserve or bid, the CPM it was booked at, booked and billed revenue), available or unavailable; plus booking revenue per display type and in total. Live bookings only (never Test mode). Default: the current window and the next 13; at most 92 days. `campaignId`, `advertiserId` or `partnerId` narrow it, and `advertiserId` leaves only the positions that advertiser holds; with `campaignId` the range covers all of that campaign's bookings. Each booking says which campaign type it is, and the response also totals the bookings by campaign type. `dsps` lists the DSPs and, under each, **only the advertisers with something booked in the range**, because that is what the filter is for. Each position also carries `displayCount` (displays using its display type across the whole retail footprint), and each booking a `layers` object (`default`, `localised`, `personalised` — which of the one advertiser's three layers this purchase actually carries, ticket "Booking schedule: single-advertiser stacking tile"), a `reach` object (`matchedDisplays`, `asOf`) when `layers.localised`, `null` otherwise, and a `personalisedTriggers` object (`computerVision`, `aggregateStore`, `individual`) when `layers.personalised`, `null` otherwise (ticket "Booking schedule: personalised trigger icons") — the client's stacked tile (see REQUIREMENTS §6) is built entirely from these fields plus `pricingType`, with no separate endpoint. |

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
| POST | `/admin/v1/partners` | Add a DSP by `provider` (`google_dv360`, `amazon_dsp`, `the_trade_desk`). Starts in `test`, adopts company lists. |
| GET | `/admin/v1/partners/{id}` | One DSP, including `issues[]` for the top of its page. |

Every DSP response includes `seats` (`[{id, name}]`): the DSP's advertisers, pulled on connect. They're offered in the slot picker and as list suggestions.
| PUT | `/admin/v1/partners/{id}` | Save changes: credentials, bidder endpoint + seat IDs, mode, lists link / own lists. |
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
bidder integration is complete. `listsLinked: false` copies the company lists
down; `listsLinked: true` discards the DSP's own lists.

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
| GET | `/admin/v1/buyers-lists` | Every buyers list: `id`, `name`, `description`, `invitedBuyers` (`identifierType`: `brandEntity` \| `dspSeatId` \| `other`, plus `value`), `activeFrom`/`activeTo` (the delivery term; ISO date-time or null = no bound), `auctionCloses` (the auction window's bidding deadline; ISO date-time or null = not using the two-period model), `lockedWin` (null until the term's one-time auction clears; then `{cpm, partnerId, advertiserId, campaignId, pricingType, channel, lockedAt}`, read only). |
| POST | `/admin/v1/buyers-lists` | Create: `name`, `description`, `invitedBuyers` (at least one), `activeFrom`, `activeTo`, `auctionCloses` (optional; null = not using the two-period model). `422 validation_failed` naming the field (e.g. `name`, `invitedBuyers[0].value`, `activeTo` if before `activeFrom`). `lockedWin` can't be set here — the exchange writes it, once, the first time a bid clears within `auctionCloses`. |
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
requests. A deal with `auctionCloses` left `null` is unaffected — it keeps
clearing fresh every window, exactly as before this field existed. Also
see `available-inventory`'s `billingUnitHours`/`billingUnitHoursOverride`/
`displayTypeBillingUnitHours` (same override/default shape as
`reservePrice`) — the granularity a CPM is quoted and charged against for
a slot using this model, default 24 hours (one day).

### Campaign approval

| Method | Path | Purpose |
|---|---|---|
| GET | `/admin/v1/approvals?status=` | Campaigns by approval status, with `counts` for all four statuses (the table filter). |
| GET | `/admin/v1/campaigns/{id}/approval` | State, checks (each optionally naming the `assetId` it ran against), targeting summary, `creative` (`assetUrl`, `mimeType`, `width`, `height`, optional `contentHash`) and target `canvas` (`width`, `height`) for rendering the creative on its canvas, and audit trail (review panel). |
| POST | `/admin/v1/campaigns/{id}/approve` | Approve the reviewed `assetVersion` (`conflict` if it changed). Also records human clearance of the default asset's current content hash, for safe reuse (below). |
| POST | `/admin/v1/campaigns/{id}/reject` | Reject with `assetVersion` and a required `reason`. Optional `assetReasons: [{assetId, reason}]` names specific assets that failed (spec §3, "asset-level rejection"). |
| POST | `/admin/v1/campaigns/{id}/unreject` | Undo a mistaken rejection: `Rejected` → `Awaiting approval` (`conflict` if not currently Rejected, or if `assetVersion` changed since). Takes `assetVersion` and an optional `reason`; never auto-approves. Same permission as approve/reject. |

Audit actions: `submitted`, `auto_approved`, `approved`, `rejected`,
`returned_for_review`, `unrejected`. These back the drop-in approval module
that plugs into the existing campaign table (see
`CAMPAIGN-APPROVAL-INTEGRATION.md`).

### Display types and playlists

| Method | Path | Purpose |
|---|---|---|
| PUT | `/admin/v1/display-types/{id}/extensions` | Save slot ownership (`slots[]`: label and owner `internal`/`advertiser`/`retail`) and venue metadata. Who a slot is assigned to and what targeting it supports are carried over from the stored slot — they are edited on `/admin/v1/available-inventory` — and dropped when a slot stops being an Advertiser slot. While DSP integration is switched off, a slot can be `advertiser` only if it already was: a new one is `400 validation_failed` on `slots[i].owner`. Other display type fields keep using the existing API. |
| GET | `/admin/v1/display-types/{id}/delete-check` | `canDelete` and `dependents[]` (assigned displays with store). |
| DELETE | `/admin/v1/display-types/{id}` | Delete; `409 has_dependents` listing displays if any remain. |
| GET | `/admin/v1/playlists/{id}/delete-check` | `canDelete` and `dependents[]` (display type defaults and zones). |
| DELETE | `/admin/v1/playlists/{id}` | Delete; `409 has_dependents` if it is a default or zone playlist. |

## POC stand-ins for the existing platform

This repo is a standalone proof of concept. It can't reach the existing
Personalisation Hub APIs, so these endpoints stand in for them. They are
**POC only**: engineering replaces them with the existing APIs on
integration, and nothing else in the build may depend on their internals.

| Method | Path | Stands in for |
|---|---|---|
| GET | `/admin/v1/display-types` | Listing display types (existing fields plus `phExtensions`). |
| POST | `/admin/v1/display-types` | New display type; also creates its auto-created playlist. |
| GET | `/admin/v1/display-types/{id}/record` | One display type. |
| PUT | `/admin/v1/display-types/{id}/record` | Save changes to the existing display type fields. Slot ownership and venue are saved through `/extensions` (above). |
| GET | `/admin/v1/playlists` | Playlists with their display type and zone assignments. |
| PUT | `/admin/v1/playlists/{id}/record` | Rename a playlist (`name` only). Assignments are made on the display type form (spec §2). |
| GET | `/admin/v1/campaigns` | The existing campaign list, for the stand-in POC campaign table (`campaignId`, name, source, advertiser, partner, display type, pricing type, `brief`, `schedule` (next booked window and how many it holds) and `activation`). Approval state comes from `/admin/v1/approvals`. |
| PUT | `/admin/v1/campaigns/{id}/activation` | The existing activation toggle: `{enabled}`. `422 not_approved` unless the campaign is Approved. |
| GET | `/admin/v1/session` | The current user and role: `hq_admin` (everything, including DSP Integration, saving advertiser settings and approving), `hq_marketing` (Display Types, Playlist Management, Advertisers / Inventory read-only, Campaign Status; the last two only while DSP integration is switched on, `GET /admin/v1/features`) or `hq_helpdesk` (none of it). In the POC the role comes from the `POC_ROLE` env var: there is no switcher and no session cookie. |

## Jobs with no API

- **SSP auction**: a scheduled job clears each play window at its auction
  cutoff (Advertiser settings → Auction schedule), ahead of time (OpenRTB
  section below). For demos, `npm run auction:run` runs one window. No UI
  and no endpoint. Which process clears a window is settled in the
  database (`auction_runs`, migration 0024): a tick claims the window
  first, so several API instances, a CronJob and the CLI can all see a
  cutoff pass and exactly one of them auctions it — DSPs are sent one
  round of bid requests. The scheduled work runs in the API process every
  minute (`PH_SCHEDULER=in-process`, the default) or from outside
  (`PH_SCHEDULER=off` and `npm run scheduler:tick` once a minute — a
  Kubernetes CronJob, `deploy/kubernetes/`).
- **Billing**: billing line items (dynamic VAC-d, reconciled against
  existing playback data) are stored only. `npm run billing:print` prints
  them for testing. No UI, report or API. Billing reads only the windows it
  can bill now and counts a window's plays where they are stored
  (`PlaybackSource.totals`), so it costs the same after a year of windows
  as on day one (scalability review, 24 Sep 2026).
- **Retention**: rejected, lost and never-cleared bids are deleted
  `PH_RESERVATION_RETENTION_DAYS` (default 90) after their window; won and
  reserved windows are kept. Rejected campaigns and their assets are
  deleted after 30 days (spec §3), never their audit trail.

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

**Bid request (per sellable position and play window):**

```json
{
  "id": "req_7f3a",
  "imp": [{
    "id": "1",
    "video": { "w": 1920, "h": 1080, "minduration": 15, "maxduration": 15 },
    "bidfloor": 150.0,
    "bidfloorcur": "AUD",
    "qty": { "multiplier": 412.0, "sourcetype": 1 },
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

- `bidfloor` = effective floor CPM for the position; `bidfloorcur` = company
  currency.
- `qty.multiplier` = assumed views for the window (VAC-d); `sourcetype` 1 =
  measurement vendor/estimate, 2 = counted by Vision/AI or MIST where enabled.
- `bcat` / `badv` = the effective category and advertiser blacklists for
  this DSP.
- **Never included:** any visitor data, Personalisation Variables or
  Computer Vision values; no `user` object.
- Screen and loop context (orientation, slot duration, loop length, share of
  voice) go in `imp.ext.ph` if the DSP doesn't read them from DOOH fields:
  `{ "orientation": "landscape", "slotDurationSec": 15, "loopLengthSec": 45, "shareOfVoice": 0.333 }`.

**Bid response — what we require:** `seatbid[].seat`, `bid.price` (CPM,
≥ `bidfloor`), `bid.crid` (must be an approved creative), `bid.adomain`
(checked against the advertiser lists) and `bid.cat` (checked against the
category lists). A bid failing any of these is dropped before the auction
clears. Also (review, 23 Sep 2026):

- the response `id` echoes the request `id`, or the whole response is no bid;
- `cur` is the company currency — a response **without** `cur` is USD, per
  OpenRTB, and is rejected unless the company trades in USD;
- `bid.impid`, when present, is `"1"`; `bid.price` is finite and at most
  10,000 (`maxBidCpm`);
- at most 10 bids per response are read, and a body over 64 KB is no bid;
- a bid with an unknown `crid` has its creative retrieved from its `iurl` —
  only under that DSP's own creative path (compared after URL
  normalisation), at most one per response, capped at the asset size
  limit; the others are retried from a later window.

Every DSP for a position is asked at once, and positions clear 16 at a
time, so an auction takes about one bidder timeout per 16 positions however
many DSPs there are. One live winner per position and window is enforced
by the database, so two clearings of the same window can't both sell it.

Exact DOOH object support and taxonomy version are confirmed per DSP before
Live (spec §7 "To confirm before building").
