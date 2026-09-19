# API reference — Display Types & DSP Integration

The agreed contract for every API this build adds. The machine-readable
version is [`openapi.yaml`](./openapi.yaml); the two must always match.
Requirements: `../REQUIREMENTS.md`.

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
  `not_on_whitelist`, `conflict`, `has_dependents`, `unauthorised`,
  `forbidden`, `not_found`.
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
                    × interactiveMultiplier    (interactive campaigns only)
                    × advertiser floorMultiplier
```

Defaults: floor 100, personalised 1.5, interactive 3, advertiser 1.0.
Localised and baseline campaigns use floor × advertiser multiplier only.

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
`whitelist_only`, `reserved`), assumed views per window, and pricing (floor
and effective floors for localised, personalised, interactive, and
personalised + interactive) for the caller's advertiser.

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
| POST | `/v1/campaigns` | Create: `advertiserId`, `name`, `displayTypeId`, a `baseline` (pricing type), optional `targeted` versions (id, priority, pricing type, rules) and an optional `brief` (the advertiser's own campaign details, landing page, promoted products, SKUs, target audiences, objective and touch points — Digital Signage for now). | `validation_failed`, `variable_not_permitted` |
| POST | `/v1/campaigns/{id}/assets` | Upload creative for `baseline` or a targeted version; returns check results. | `checks_failed` |
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
`dimensions`, `aspect_ratio`, `duration`, `baseline_present`,
`targeting_permitted`, each with `passed` and `detail`.

### Reservations and bids

| Method | Path | Purpose | Main errors |
|---|---|---|---|
| POST | `/v1/reservations` | `type: reserve` (named advertiser positions) at its agreed reservation price, or `type: bid`, both with `bidCpm` (the CPM; a reservation is booked at it), for a `positionId` and `windowStart`, with an approved and activated `campaignId` (`not_approved` otherwise). Only while the window's auction is open: from `auctionOpensHours` before the auction cutoff until the cutoff (`conflict` otherwise). | `not_approved`, `below_floor`, `advertiser_blocked`, `category_blocked`, `not_on_whitelist`, `conflict` |
| GET | `/v1/reservations/{id}` | Outcome: `pending`, `won`, `lost`, `reserved`, `rejected`, with clearing CPM and reason. | `not_found` |

A won or reserved campaign is handed to the existing campaign system for
that slot and window; from there it plays and is reported on like any other
campaign.

## Admin API — `/admin/v1`

Every endpoint requires an HQ Admin session. `admin` = admin users only;
`approver` = may approve/reject (HQ Admin role by default, open question 39).
In the POC the session is a stand-in: the role comes from the `POC_ROLE`
env var, with no switcher and no cookie (see *POC stand-ins* below).

### Exchange settings

| Method | Path | Purpose |
|---|---|---|
| GET | `/admin/v1/exchange` | Organisation, domain, seller ID, contact email, `published`, `sellersJsonUrl`. |
| PUT | `/admin/v1/exchange` | Save changes. All four fields required; republishes sellers.json when complete. |

### Advertiser settings

| Method | Path | Purpose |
|---|---|---|
| GET | `/admin/v1/advertiser-settings` | Currency, floor CPM, multipliers, the auction schedule (`auctionOpensHours`, `playWindowHours`, `auctionCutoffTime`), advertiser and category whitelists/blacklists, and read-only `whereTheseApply` (per DSP: adopting or own lists). |
| PUT | `/admin/v1/advertiser-settings` | Save changes (pricing, auction schedule and lists). An entry can't be on both lists, and the play-window length can't change while future windows are bid on or booked (`validation_failed`). |
| GET | `/admin/v1/available-inventory` | Read-only rows: display type, playlist, slot, position (with DSP). No advertisers column. |
| GET | `/admin/v1/booking-schedule?from=&to=` | Reached from Available Inventory. Every advertiser-owned slot across its play windows: booked (advertiser, DSP, reserve or bid, the CPM it was booked at, booked and billed revenue), available or unavailable; plus booking revenue per display type and in total. Live bookings only (never Test mode). Default: the current window and the next 13; at most 92 days. |

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
| GET | `/admin/v1/advertisers` | Every advertiser across DSPs: name, via (DSPs), approval required, floor multiplier, effective floor CPM; plus company currency and floor. |
| PUT | `/admin/v1/advertisers` | Save changes: `settings` map of advertiser id → `{approvalRequired, floorMultiplier}`. |

Non-admin sessions get `403 forbidden`.

### Campaign approval

| Method | Path | Purpose |
|---|---|---|
| GET | `/admin/v1/approvals?status=` | Campaigns by approval status, with `counts` for all four statuses (the table filter). |
| GET | `/admin/v1/campaigns/{id}/approval` | State, checks, targeting summary, `creative` (`assetUrl`, `mimeType`, `width`, `height`) and target `canvas` (`width`, `height`) for rendering the creative on its canvas, and audit trail (review panel). |
| POST | `/admin/v1/campaigns/{id}/approve` | Approve the reviewed `assetVersion` (`conflict` if it changed). |
| POST | `/admin/v1/campaigns/{id}/reject` | Reject with `assetVersion` and a required `reason`. |

Audit actions: `submitted`, `auto_approved`, `approved`, `rejected`,
`returned_for_review`. These back the drop-in approval module that plugs
into the existing campaign table (see `CAMPAIGN-APPROVAL-INTEGRATION.md`).

### Display types and playlists

| Method | Path | Purpose |
|---|---|---|
| PUT | `/admin/v1/display-types/{id}/extensions` | Save slot ownership (`slots[]`: label, owner `internal`/`advertiser`/`retail`, partner, named advertiser, list mode, store scope, quota) and venue metadata. Other display type fields keep using the existing API. |
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
| GET | `/admin/v1/campaigns` | The existing campaign list, for the stand-in POC campaign table (`campaignId`, name, source, advertiser, partner, display type, pricing type, `activation`). Approval state comes from `/admin/v1/approvals`. |
| PUT | `/admin/v1/campaigns/{id}/activation` | The existing activation toggle: `{enabled}`. `422 not_approved` unless the campaign is Approved. |
| GET | `/admin/v1/session` | The current user and role (`hq_admin` = admin + approver; `hq_user` = neither). In the POC the role comes from the `POC_ROLE` env var: there is no switcher and no session cookie. |

## Jobs with no API

- **SSP auction**: a scheduled job in `apps/api` clears each play window
  at its auction cutoff (Advertiser settings → Auction schedule), ahead of time (OpenRTB section below). For demos, `npm run auction:run`
  runs one window. No UI and no endpoint.
- **Billing**: billing line items (dynamic VAC-d, reconciled against
  existing playback data) are stored only. `npm run billing:print` prints
  them for testing. No UI, report or API.

## sellers.json

Published at `https://[domain]/sellers.json` once Exchange settings are
complete; `404` until then.

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
clears.

Exact DOOH object support and taxonomy version are confirmed per DSP before
Live (spec §7 "To confirm before building").
