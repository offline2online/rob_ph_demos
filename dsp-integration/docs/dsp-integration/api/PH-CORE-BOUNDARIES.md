# Boundaries with Personalisation Hub Core

Where this build stops and the existing Personalisation Hub platform ("PH
Core") starts: every dependency, which way data flows, what each side
guarantees, and what engineering replaces on integration.

Companion documents:
- [API.md](./API.md) / [openapi.yaml](./openapi.yaml) — the HTTP APIs this
  build **offers** (Partner API, Admin API, sellers.json, OpenRTB).
- [CAMPAIGN-APPROVAL-INTEGRATION.md](../CAMPAIGN-APPROVAL-INTEGRATION.md) —
  step-by-step for the approval module's own seam.
- [SECURITY-PERFORMANCE.md](./SECURITY-PERFORMANCE.md) — the review behind
  the limits and guarantees quoted here, with measurements.
- `shared/interface-contract.md` (repo root) — the contract with the **Live
  Visitor Profile** project, a sibling project rather than PH Core.

## The rule

This build never reaches into PH Core directly. Every dependency goes
through one TypeScript interface in `apps/api/src/platform/` (or `auth/`,
`secrets/`, `flags/`), and **`apps/api/src/context.ts` is the only file
that chooses an implementation** (one exception: partner identity, which
`partnerFromRequest(ctx, req)` resolves from configuration — see the seam
table). The POC wires in SQLite stand-ins; on
integration engineering writes one adapter per interface against the real
service and changes that one file. Routes, the exchange and the domain
logic do not change.

```
             Partner API /v1          Admin API /admin/v1        OpenRTB 2.6 ─► DSP bidders
                  │                         │                    DSP mgmt APIs ─► DV360 / Amazon / TTD
                  ▼                         ▼                         ▲
   ┌──────────────────────── this build (apps/api) ───────────────────┴─┐
   │ routes ─► domain (positions, pricing, lists, targeting validation) │
   │        ─► exchange (auction, enforcement, hand-off, billing)       │
   │        ─► repos (this build's own records: partners, settings,     │
   │                   exchange, reservations, buyers lists)            │
   └──────────────────────────────┬─────────────────────────────────────┘
                                  │  context.ts: the only wiring point
   ┌──────────────────────────────▼─────────────────────────────────────┐
   │ PH Core seams (interfaces)                                          │
   │  DisplayTypeSource  PlaylistSource  DisplaySource  StoreSource      │
   │  CampaignSource (+ approval adapter)  PlaybackSource  AssetStore    │
   │  AudienceSource  SessionSource  partner identity                     │
   │  SecretsStore  Flags                                                │
   └─────────────────────────────────────────────────────────────────────┘
```

## Seams — what PH Core must provide

"Hot" means it is called on the Partner API's request path or once per
position in the auction, so its latency multiplies. Budgets are what the
current measurements (SECURITY-PERFORMANCE.md) assume; a real adapter
slower than that should cache, as the stand-ins now do.

| Seam | Direction | PH Core owner | Methods | Called from | Budget |
|---|---|---|---|---|---|
| `DisplayTypeSource` (`platform/DisplayTypeSource.ts`) | read + write | Display Types service | `list`, `get`, `create`, `saveRecord`, `saveExtensions`, `delete` | **Hot**: every Partner API request and every auction position starts from `list()` | `list()` ≤ 1 ms (cache it) |
| `PlaylistSource` | read, create, rename, save settings, delete | Playlist service | `list`, `get`, `create`, `rename`, `saveSettings`, `delete` | Inventory (loop length), Playlist Management | `get` ≤ 0.1 ms |
| `DisplaySource` | read only | Displays & Devices | `list`, `listByDisplayType`, `summaryByDisplayType`, `storeIdsByDisplayType` | **Hot**: `summaryByDisplayType` per position (counts, "no displays" check); `listByDisplayType` for the delete check only | `summaryByDisplayType` ≤ 0.05 ms, a count never the rows; `listByDisplayType` indexed |
| `StoreSource` | read only, **never written** | Stores | `list`, `get` → `{id, name, region}`. On integration also the store/display **venue and geo** record: OpenOOH venue type, latitude/longitude, store id (see "Venue and geo metadata" below). The POC has no such seam yet; its stand-in is `phExtensions.venue` on the display type. | Inventory store/region filters, booking schedule, OpenRTB `dooh.venuetype`, inventory venue fields | `get` ≤ 0.05 ms |
| `CampaignSource` (`platform/CampaignSource.ts`) | read + write | Campaigns service | `getCampaign`, `listCampaigns`, `setActivation`, `createCampaign`, `addAsset`, `latestAssets(campaignId, atVersion?: string)`, `bookSlot`, `bookings`, `deleteCampaign` | **Hot**: `getCampaign` per bid in the auction | `getCampaign` ≤ 0.5 ms |
| Approval adapter (`packages/campaign-approval/src/adapter/CampaignSource.ts`): the **second facet of the same real campaign source** (it must not get `bookSlot` or `createCampaign`) | read + activation | Campaigns service | `getCampaign`, `listCampaigns`, `setActivation`, `onCampaignChanged`, `discardEditsAfter` | Approval screens, `isCampaignEligible` before every bid, reservation and hand-off | see the integration guide |
| `PlaybackSource` | read only | Playback logging | `totals({campaignId, displayTypeId, from, to})`, `listPlays` | Billing, once per ended window | aggregated at the source: ≤ 1 s for 2 million plays |
| `AssetStore` | write + read | Asset hosting / CDN | `put`, `read`, `url` | Creative upload and DSP creative retrieval; hand-off re-validation | — |
| `AudienceSource` | read only | Audience scoring (MOVE/VAC-d, spec §4) | `forSlot`, `targetedShare` | **Hot**: per position in inventory, forecast, OpenRTB `qty.multiplier` | ≤ 0.1 ms |
| `SessionSource` (`auth/session.ts`) | read only | HQ Admin session and roles | `current()` → `{userId, name, role}` | Every Admin API request | — |
| Partner identity (`auth/partnerAuth.ts`) | read only | Platform token issuance | `partnerFromRequest(ctx, req)` → one `PartnerRecord` or 401. **Not an interface and not constructed in `context.ts`**: it is a function that reads `ctx.config.partnerTokens` directly, so on integration it is the one place besides `context.ts` to change (or it becomes a seam) | Every Partner API request | ≤ 0.1 ms |
| `SecretsStore` | encrypt / decrypt (awaitable) | Platform secrets handling (KMS) | `encrypt`, `decrypt` | Saving DSP credentials; connecting to a DSP | off the hot path by design |
| `Flags` | read only | Feature flags | `dspIntegration` | Every new endpoint (404 when off) | — |
| DSP integration switch (`exchange.enabled`, migration 0023) | read + write | *This build* (the retailer's own setting, on Exchange settings) | `ctx.exchange.get().enabled`; `GET /admin/v1/features` | Every Partner API request, sellers.json, the auction, the nav | — |

### What each seam must guarantee

These are behaviours the build **relies on**. An adapter that doesn't
provide one breaks something specific, named here.

- **`DisplayTypeSource`**
  - `phExtensions.slots[].salesLocked` (30 Sep 2026) round-trips too: it is
    written by this build (the slot lock, REQUIREMENTS §1) and cleared by
    the scheduler once the slot has no live booking. An adapter that drops
    it silently re-opens a locked slot to new sales.
  - `phExtensions` (slots, reserve price, default VAC-d, venue) round-trips
    unchanged. Nothing but this build reads or writes that field — except
    that `venue` there is only the POC stand-in for a PH Core value (Q35:
    PH Core owns venue and geo; see "Venue and geo metadata" below).
  - `list()` returns records the caller must not mutate. The stand-in
    deep-freezes them and serves a snapshot that each write replaces, with
    a 1-second TTL. Any cache in the real adapter needs the same property:
    **a save is visible to the process that made it immediately, and to
    every other process within a bounded time.**
  - The approval canvas reads the same `DisplayTypeSource` as everything
    else (`context.ts` passes `ctx.displayTypes` to `approvalParts`), so it
    sees a save as soon as the rest of the process does.
- **`DisplaySource`**
  - `summaryByDisplayType` answers with counts (displays, and the stores
    they are in), never the rows: every position, availability check, bid
    request and bid asks it (24 Sep 2026). The stand-in keeps a one-second
    snapshot of one GROUP BY.
  - `listByDisplayType` must be an indexed lookup (migration 0020 on the
    stand-in); only the delete check reads the rows now.
- **`CampaignSource.deleteCampaign`** (2 Oct 2026, VzKX05Ulo9wGMuLMvISi)
  - Called by the rejected-campaign retention sweep (30 days by default) to
    remove a campaign and its assets. What deleting means is PH Core's call
    — hard delete, archive or refuse — and it answers false when it keeps
    the campaign; the sweep still removes this build's own records (its
    approval rows and DSP-creative claims) and never treats a refusal as a
    failure. The stand-in deletes the record and its assets.
- **`CampaignSource.bookSlot`**
  - **At most one campaign per display type, slot and play window.** A
    second booking for the same slot and window must fail, not silently add
    a row. The hand-off treats a uniqueness failure as "already booked" and
    records why (migration 0021 enforces this on the stand-in).
  - Without this guarantee, two exchange processes can double-book a slot.
  - **Plays the version it was handed** (`SlotBooking.assetVersion`, Q38,
    29 Sep 2026): the approved version's creative, never an edit still
    under review. The hand-off resolves it with
    `latestAssets(campaignId, atVersion)`, which must ignore the assets of a
    discarded (rejected) edit. `atVersion` is the approval adapter's
    `assetVersion` **string, exactly as `liveAssetVersion` returned it**: any
    string that changes with the creative is legal there (not only the POC's
    `v<n>`), so resolving it to assets is this seam's job. The hand-off
    passes it straight through and imports nothing POC-only for it, and
    the booking records that same string (`SlotBooking.assetVersion` is a
    string since 0038, eeBT1Qp33GdsPcxG2As3, 2 Oct 2026; an HQ campaign,
    which has no approval, carries the stand-in's `v<n>`).
- **`CampaignSource.listCampaigns`**
  - Order is the platform's to define, but both facets must agree. The POC's
    platform seam and the approval adapter both order by `created_at, id`;
    an integration builds both from one source (see
    `CAMPAIGN-APPROVAL-INTEGRATION.md`).
- **`CampaignSource.getCampaign`**
  - Returns targeting in the existing structure: AND groups of OR
    conditions.
  - This build only stores and validates targeting. **Targeting evaluation
    stays PH Core's.**
- **`PlaybackSource`**
  - `totals` counts and sums a campaign's plays on one display type's
    displays in a window **where the plays are stored**: a window on 1,000
    displays is 1.9 million rows, 23 s as rows in JavaScript, 0.65 s from
    the stand-in's covering index (migration 0025; 24 Sep 2026). The
    platform's playback store answers from its own aggregates.
  - Proof of play is the billing record (spec §7). Plays must be final by
    the time a window is billed, or a late play is never billed.
  - **Each play must say which version of the campaign it showed** (Rob,
    30 Sep 2026): a version id and a tier, `default`, `localised` or
    `personalised`. Every play bills at the committed
    price (the personalised multiplier was removed on 5 Oct 2026), so the
    tier is reporting data and does not change billing; this build cannot
    infer it. `totals` therefore also returns the personalised
    plays and their seconds (`personalised: {plays, playedSec}`). Until PH
    Core supplies it the field is null; billing is unaffected. The stand-in `plays` table carries
    the two columns nullable (migration 0033).
  - **The version id is kept, and reported** (Rob, 2 Oct 2026,
    DDOjJoYjraKROu4Ainj5; contract v3.1 row 3): it must be the asset
    version handed off on the booking (`SlotBooking.assetVersion`), so a
    play shows it played the version it was handed. `totals` returns plays
    per version (`byVersion`) and each line item carries them
    (`playsByVersion`, migration 0039). Billing does not price on it.
  - Billing is idempotent per reservation (`billing_line_items.reservation_id`
    is unique).
- **`AssetStore`**
  - `read(file)` accepts only names that `put` generated. The stand-in
    enforces `^[a-z0-9-]+\.[a-z0-9]+$`, so a path can't traverse
    directories.
  - Files are served with `nosniff` and a CSP that blocks script. An SVG
    creative can't run code even when it is opened directly.
- **`AudienceSource.forSlot`**
  - Must say whether a slot is **scored** (`scored`), not just return a
    number: an unscored slot has no audience figure, and 0 is "unknown", not
    "nobody watching". This build leaves an unscored slot out of inventory,
    forecast and the auction and refuses a bid on it (30 Sep 2026); it never
    invents an estimate. The stand-in reads `audience_vacd` and reports
    `scored` when a row exists or the display type has a default VAC-d
    (0035); a display type created in HQ Admin has neither until one is
    set.
  - **The display type's default VAC-d is this build's setting, passed in**
    (Rob, 2 Oct 2026, ticket DDOjJoYjraKROu4Ainj5; interface contract
    v3.1 row 4): `forSlot(displayTypeId, slot, defaultVacd)`. The exchange
    resolves it from the display type through `DisplayTypeSource`
    (`audienceOf` in `domain/displayTypes.ts`); the audience source never
    reads `display_types`. PH Core / the retailer's scoring framework owns
    only each display's counted or modelled VAC-d and its per-display
    override. A display type with no retailer scoring is scored by its
    default VAC-d; unset means unscored and unsellable.
  - **PH Core may write the default from computer vision** (ticket
    MuZ4KUSLJI2BIGbEV2pq, Rob, 4 Oct 2026): `PUT /admin/v1/display-types/{id}/default-vacd`
    `{defaultVacd}`. This **revises v3.1 row 4**, which said the default is
    only the exchange's own setting (the contract text is updated
    alongside this ticket). Precedence: **the automated score wins** — it
    replaces a manually set value and is stored with
    `phExtensions.defaultVacdSource = computer_vision`, so slots scored from
    it are `counted` (`qty.sourcetype` 1); a manual edit (Display Type
    form, `PUT …/extensions`) stays valid, is `manual` / modelled, and
    stands until the next CV write. Re-saving the form with the same value
    keeps the source. The write targets the display-type default only,
    never a display's counted VAC-d or `vacd_override`. On integration, PH
    Core calls this endpoint with the CV figure; the adapter's `forSlot`
    still receives `(default, defaultCounted)` from the exchange.
  - Also returns `counted`: whether the figure is measured (Vision/AI,
    MIST proximity) or modelled. It becomes OpenRTB `qty.sourcetype`
    (`exchange/openrtb.ts`), so an adapter that cannot tell must say
    modelled, never counted.
- **`AudienceSource.targetedShare`**
  - Predicates in, a number out. **No attribute value crosses the
    boundary.**
  - The POC halves the audience for each AND group (Q9). The real source
    replaces that estimate.
- **`SessionSource`**
  - Roles map to scopes: `hq_admin` → admin, approver, sections;
    `hq_marketing` → sections; `hq_helpdesk` → none.
  - The POC stand-in makes every Admin API caller `hq_admin`, and the API
    binds to `127.0.0.1` for that reason. **It must never be exposed as it
    is with real data.** The one deliberate exception is the hosted demo
    (`deploy/firebase/`, Rob 23 Sep 2026): public, demo data only,
    rate-limited per IP, resettable.
- **Partner identity**
  - Each token maps to exactly one partner (DSP).
  - Revocation must take effect immediately.
  - The build already refuses writes from a DSP that isn't connected,
    whether or not its token is still valid.
  - The POC tokens are public, so the API refuses to start with them when
    `NODE_ENV=production`.
- **`SecretsStore`**
  - AES-256-GCM with a random IV and a full 16-byte tag.
  - Decrypted values are never logged or returned. Screens only see which
    fields are set.
  - `encrypt` / `decrypt` may answer with a promise (a KMS call): the
    partner repository awaits them, and writes the row once the connection
    is free (2 Oct 2026, v2iKDJQA0wmisXhp7ebV).

### Tables: whose they are

| Migrations | Owner | On integration |
|---|---|---|
| `0001` (display types, playlists, displays, campaigns, plays), `0012` (slot bookings), `0014` (stores) | **PH Core stand-ins** | Dropped. The seams above read and write the real services instead. |
| `0004`–`0007`, `0010`, `0011`, `0013`, `0015`, `0017`–`0019` (partners, settings, variable access, exchange, reservations, DSP creatives, billing line items, buyers lists) | This build | Kept. |
| `0002` (`display_types.ph_extensions`), `0003` and `0016` (columns on `campaigns`), `0008` (`campaign_assets`), `0009` (`audience_vacd`) | **On PH Core stand-ins** (columns this build added to them, or the campaign system's and audience source's own tables) | Dropped with the stand-in tables. Each is a field the matching seam must carry: `phExtensions` (`DisplayTypeSource`), source / advertiser / partner / display type / brief (`CampaignSource`), assets (`CampaignSource.latestAssets`), VAC-d (`AudienceSource`). |
| The approval module's `0100` (`campaign_approvals`, audit), `0101` (asset-level rejection) | This build (`packages/campaign-approval`) | Kept: the approval records are this build's. |
| `0020` (indexes), `0021` (one live winner per window) | This build (review, 23 Sep 2026) | Kept. See "The database must enforce" below for the parts that also apply to PH Core tables. |
| `0022` (reserved instance identity) and `0032` (drops it again) | This build | Nothing to keep: 0022 was dropped by 0032 (Ql8j8H6F, 30 Sep 2026). |
| `0023` (the DSP integration switch) | This build (Rob, 24 Sep 2026) | Kept, unless the platform already holds company feature switches (see "Open" below). |
| `0024` (`auction_runs`: which process clears a window) | This build (24 Sep 2026) | Kept: it lets several instances share the scheduled work. |
| `0025` (covering index on `plays`), `0033` (`plays.version_id` / `tier`), `0039` (`version_id` in that index) | Stand-in only | Dropped with `plays`; the playback store answers `totals` itself, and must supply the version id and tier (see `PlaybackSource`). `0039`'s `billing_line_items.plays_by_version` is **Kept**. |
| `0034` (`reservations.personalised_multiplier`, personalised columns on `billing_line_items`) | This build (Rob, 30 Sep 2026) | Columns kept, no longer written (5 Oct 2026): the personalised multiplier was removed; every play bills at the committed CPM. |
| `0026` (one open API bid per advertiser and window) | This build (24 Sep 2026) | Kept: a partial unique index, as 0021. |
| `0027` (`company_advertiser_settings`: deferred play-window change) | This build (26 Sep 2026) | Kept. |
| `0028` (`playlists.playlist_settings`), `0029` (multi-zone layout on the playlist) | **PH Core stand-in** (`playlists`) | Dropped with `playlists`: the playlist service owns its own settings and zoning (`PlaylistSource.saveSettings`). |
| `0030` (a DSP's own category lists on `partners`) | This build (28 Sep 2026) | Kept. |
| `0031` (`assets.content_hash`, `discarded_at`; `campaign_slot_bookings.asset_version`) | Mixed | `assets` and the booking's `asset_version` are the campaign system's: the booking must carry the version it plays (see `CampaignSource.bookSlot`). Content-hash reuse and discard are this build's approval records. |
| `0038` (`campaign_slot_bookings.asset_version` becomes TEXT: the approval's version string) | **PH Core stand-in** (`campaign_slot_bookings`) | Dropped with the stand-in: the campaign system's own booking must carry the version string it was handed. |
| `0035` (`displays.vacd_override`; the default itself is `phExtensions.defaultVacd`) | **PH Core stand-in** (`displays`); the default is **Kept** (this build's display-type setting) | Dropped with `displays`. The per-display override is the audience source's own data: `AudienceSource.forSlot` must return the same sum, given the default this build passes in (DDOjJoYjraKROu4Ainj5). |
| `0036` (drops the unused `audience_scoring` column) | This build | Nothing to keep. |
| `0037` (`seq` on `display_types`, `playlists`, `displays`, `partners`, `buyers_lists`, `reservations`) and the approval module's `0102` (`seq` on `campaign_approvals`, `campaign_approval_audit`) | Mixed (1 Oct 2026, gAi2mkcm43uW6hrchOjh) | Lists that must come back in the order rows were written order by `seq`, not SQLite's `rowid`. On Postgres `seq` is `BIGINT GENERATED BY DEFAULT AS IDENTITY`; the SQLite insert triggers that fill it do not travel. Kept on this build's tables; dropped with the stand-in tables. |

## Outbound boundaries — what this build calls

| To | How | Bounded by |
|---|---|---|
| DSP management APIs (DV360 API v4, Amazon Ads DSP, The Trade Desk v3) | Each DSP's own provider module in `apps/api/src/dsp/` (`DspProvider.connect`), called on Connect / Re-test | Admin action only. They never run on a request path. |
| DSP bidders (OpenRTB 2.6 DOOH) | `dsp/bidder.ts`, from the auction, to the DSP's `DspProvider.bidUrl` | Per request:<br>- 300 ms timeout<br>- 500 QPS per DSP<br>- 64 KB response cap<br>- responses must echo the request `id`; bids must match `impid` 1<br>- at most 10 bids per response<br>- price ≤ `maxBidCpm`<br>- a missing `cur` means USD |
| DSP creative hosts | `exchange/creatives.ts`, for a bid carrying an unknown creative | - Only URLs under that DSP's own creative path (`DspProvider.ownsCreativeUrl`), checked after normalisation.<br>- One retrieval per response, claimed once across concurrent auctions.<br>- Byte-capped at the asset size limit.<br>- 10 s timeout. |

The POC points every one of these at the mock DSP service
(`apps/dsp-mocks`). Real endpoints are configuration (`config.ts`,
`.env`), not code.

### DSP providers — one module per DSP (30 Sep 2026)

Everything that differs between DSPs lives in that DSP's own module
behind one interface, `DspProvider` (`apps/api/src/dsp/DspProvider.ts`):
`googleDv360.ts`, `amazonDsp.ts`, `theTradeDesk.ts`. `dsp/registry.ts`
lists them; `context.ts` wires them in as `ctx.dsp`, and stays the only
file that chooses them. The auction, the creative path and the routes look
a partner's DSP up by its provider key (`providerOf`) and call it blind —
none of them branches on which DSP it is
(`apps/api/test/dsp-providers.test.ts` fails if a DSP's key appears
anywhere in `src/` outside `dsp/`, `config.ts` and the seed data).

What each provider must guarantee:

- **`connect(creds)`** — the management API (Connect / Re-test). Resolves
  to `{ ok: true, seats }` or `{ ok: false, reason }` and never throws: an
  unreachable DSP is a reason, not an exception. Each seat keeps the
  advertiser's `domain` where the DSP gives one (bids are matched on
  `adomain`). Admin action only; 10 s per call.
- **`bidUrl`** — where OpenRTB 2.6 requests go. Unset, the DSP is sent no
  requests. The request itself, and every bound on the response (the
  `dsp/bidder.ts` row above), is shared by every DSP: there is no
  per-DSP bid request or response adaptation in this build.
- **`ownsCreativeUrl(url)`** — the creative-path rule. True only for a URL
  under the DSP's own creative host and path after normalisation
  (`underBase`), never one carrying credentials. No creative base
  configured, it is always false and nothing is fetched.
- **`auditCheck(raw)`** — the pre-approval hook (Q40). Reads the DSP's own
  audit of a creative, in the DSP's own shape, into an **advisory**
  `dsp_audit` check, or null when the DSP said nothing usable. It never
  approves or blocks a creative: PH's approval decides.

A credential the DSP fixes once connected (Amazon's region) is marked
`fixedOnceConnected` on its field in `@ph-dsp/types` `PROVIDERS`, which
also holds each DSP's credential form. Adding a DSP is one new module, one
line in `registry.ts`, its `PROVIDERS` entry and its endpoints in
`config.ts`.

### Billing — one module, one seam (30 Sep 2026)

Billing and the two-period delivery-term rules live in one module,
`apps/api/src/billing/`, instead of being spread through the exchange.
It has no seam with PH Core of its own: it reads plays only through the
existing `PlaybackSource.totals`, and `context.ts` stays the only file
that chooses an implementation (nothing under `billing/` constructs a
database or a platform source; `apps/api/test/billing-boundary.test.ts`
fails if it does). Two entry points are public: `billing` (`index.ts`) and
`billing/term` (pure predicates over a deal, safe for the domain and the
routes to import). Everything else in the folder is internal, and
`billing-boundary.test.ts` fails if code outside it reaches in.

What the module must guarantee:

- **`billReservation(ctx, reservation, position, totals)`** — a cleared
  reservation plus the playback totals for its window in, one line item
  out. The maths (`computeLineItem`) is pure; the write is idempotent on
  `billing_line_items.reservation_id`, so two API instances or a CronJob
  beside the API bill a window once. A second call returns null.
- **Inputs are the reservation and `PlaybackSource.totals` only.** Plays
  that did not happen (display offline, store closed, loop cut short) are
  not billed (Q29). `runBilling` is the loop around it: what is billable
  now (`ReservationRepo.billable`), each window checked against its own
  billing unit.
- **A locked term is always billed at the locked rate.**
  `bookLockedTermWindow` books each later window of a locked deal as its
  own reservation at `lockedWin.cpm`, never below the effective floor
  (OQ45), never for a disconnected DSP, and a window already sold answers
  "Already sold" (migration 0021). `termStateAt(list, at)` answers
  active / locked / auction-open for a window start; the auction, the
  partner reservations route and the inventory status all ask it, so the
  term is judged one way.
- **Billing unit is the window length.** `billingUnitMs(ctx, position)`
  is the slot's `billingUnitHours`, else its display type's default, else
  the company play window (OQ27). It is not informational: a 168-hour
  slot bills one line item a week.
- **Engagement-based billing is declared, not built** (BUILD-PLAN
  section 10). `billingBasis: 'engagement'` throws `NotImplementedError`
  rather than billing an interactive campaign on plays that say nothing
  about its engagement.

## Inbound boundaries — what this build offers

Both inbound surfaces are specified in API.md. The limits below are part
of that contract (openapi.yaml carries them):

- **Partner API (`/v1`)**
  - Per partner token: 50 requests/s, bursts of 100, then `429
    rate_limited` with `Retry-After`.
  - At most 2 asset uploads in flight per partner.
  - Forecast: at most 200 positions, each listed once.
  - Content package: name ≤ 200 characters, ≤ 20 targeted versions (package-size guard at submission; the sellable
    count is the slot's Max campaigns, enforced at bid and reservation), ≤ 10
    AND groups, ≤ 20 conditions per group, ≤ 100 values per condition, each
    value ≤ 200 characters.
  - JSON bodies up to 1 MB. A larger body gets `413`.
  - Writes need a connected DSP (`409` otherwise).
  - At most 4 uploads in flight across all partners
    (`PH_MAX_UPLOADS_IN_FLIGHT`), so memory is bounded whatever the
    number of partners.
  - Every endpoint answers `404` while the retailer has DSP integration
    switched off, as with the build flag off.
- **Admin API (`/admin/v1`)**: behind the HQ Admin session (see
  `SessionSource`).
- **Every response carries these headers:**
  - `X-Content-Type-Options: nosniff`
  - `Content-Security-Policy: default-src 'none'; …`
  - `Referrer-Policy: no-referrer`
  - `Cache-Control: no-store` on `/api/*`

## Edge and gateway — what the platform provides around this build

This build does not implement these itself; the platform's edge or
gateway should:

- **TLS and HSTS.** The API speaks plain HTTP behind the edge.
- **Two front doors** (24 Sep 2026): the Partner API, `sellers.json` and
  creatives on a public load balancer behind a WAF; the Admin API on an
  internal one only, with `/api/admin` absent from the public one
  (`deploy/kubernetes/base/ingress.yaml`) — the POC's Admin API has no
  authentication of its own until `SessionSource` is the platform's.
- **Egress control.** Outbound calls go to addresses an admin typed or a
  bid carried. The API refuses private,
  link-local, loopback and cluster-local hosts (`domain/partnerInput.ts`);
  the network must too (`deploy/kubernetes/base/networkpolicy.yaml`: DNS
  and the internet on 443 only, never the VPC or the instance metadata
  service), since a public name can resolve to a private address.
- **Distributed rate limiting.**
  - The built-in limiter is per process: `http/rateLimit.ts`, one token
    bucket per partner.
  - With several API instances, move it to the gateway or a shared store.
  - Keep the same per-partner key and the same 429 + `Retry-After`
    behaviour.
- **WAF, request logging and alerting**, as for any public API.

## Running more than one instance

The POC is one process. Scaling out is safe for everything except the
points below, each already handled in the database or noted for the
platform:

1. **The database must enforce what the code checks.**
   - Two clearings of one window, or two reservations racing, are stopped
     by unique indexes, not by the application's own "already sold?"
     check. Migration 0021:
     - `reservations (position_id, window_start)` where live and won or
       reserved;
     - `campaign_slot_bookings (display_type_id, slot, window_start)`.
   - On Postgres both are ordinary partial unique indexes. The PH Core
     campaign system needs the second one on its own bookings (see
     `CampaignSource.bookSlot` above).
   - Reproduced before the fix: two concurrent auctions sold one window
     twice.
   - Likewise one open API bid per advertiser and window (0026), billing
     idempotent per reservation, and migrations and the seed checking
     under the write lock (`BEGIN IMMEDIATE`) so two processes starting
     on one empty database don't both seed (24 Sep 2026).
2. **One auction per window, settled in the database** (24 Sep 2026).
   - A tick claims a window in `auction_runs` (migration 0024) before
     auctioning it: one row per window, so however many instances, CronJob
     ticks or CLI runs see a cutoff pass, exactly one clears it and DSPs
     get one round of bid requests. A claim unfinished after 15 minutes
     (a process that died mid-auction) is taken over.
   - So the scheduler runs in every API process (`PH_SCHEDULER=in-process`)
     or in none of them, as a CronJob running `npm run scheduler:tick`
     (`PH_SCHEDULER=off`; `deploy/kubernetes/optional/`) — better with a
     shared database, since billing and the auction then never take the
     API's thread.
3. **Caches.**
   - Company settings and display types are served from in-process
     snapshots with a 1-second TTL. A save is seen at once by the instance
     that made it, and by the others within a second.
   - Nothing that decides a sale is cached: reservations, bids and
     approval state are always read from the database.
4. **SQLite → Postgres.**
   - The POC runs SQLite in WAL mode with a busy timeout, so the auction
     CLI and the API can share a file.
   - On the platform's Postgres the same SQL runs unchanged (1 Oct 2026,
     gAi2mkcm43uW6hrchOjh: no `rowid`, `json_extract`, boolean `SUM` or
     `INSERT OR …`; arrival order is an explicit `seq`, an identity column
     on Postgres), and MVCC plus a connection pool replace WAL and the
     busy timeout. Migrations themselves are the SQLite adapter's files.
   - The repository layer is awaitable (2 Oct 2026, cUdX4dmTMB2mvxJczHvT):
     every seam and repository method returns `T | Promise<T>`, and every
     caller awaits it — 63 source files and about 550 calls, not "one file
     per seam" as this section used to say. Exceptions, still synchronous:
     `Flags.dspIntegration` (a property) and the approval adapter's
     `onCampaignChanged` (a listener registration).
   - **Done since** (2 Oct 2026, v2iKDJQA0wmisXhp7ebV, "the cheap parts"):
     - `SecretsStore.encrypt/decrypt` are awaitable, and the partner
       repository awaits them.
     - The approval module's `SqlDb` is async-capable: each statement may
       answer with a promise, and `approvalStore` and `pocCampaignSource`
       await (sync-first, so node:sqlite pays nothing for it). A test runs
       the store over an `SqlDb` whose every statement answers a promise.
     - No raw SQL outside `src/platform/`, `src/repos/` and `src/db/`. The
       statements that sat in billing, positions, the scheduler, DSP
       creatives, the two retention sweeps and the test-plays route moved
       into repositories on the `Context`, behind `gate()` like every
       other: `AuctionRunRepo`, `BillingRepo`, `DspCreativeRepo`,
       `CampaignRetentionRepo`, `PlayRepo` and
       `ReservationRepo.deleteSettledBefore`. `test/sql-portability.test.ts`
       fails if `db.prepare`, `prepared(` or `db.exec(` appears anywhere
       else in `apps/api/src`; the one allowlisted directory is
       `src/seed/` (sample data for the stand-in tables, deleted with them).
   - **Still deferred, until a client commissions a second replica**: the
     Postgres adapter itself (repository and seam implementations over a
     pool) and its migration set; `tx` / `gate` / `onFree` are typed to the
     SQLite `Db` handle; the repositories' SQL uses `?` placeholders and
     reads `.changes` off node:sqlite's result (Postgres: `$n` and
     `rowCount`); migration 0037's `seq`-filling insert triggers and the
     `ORDER BY rowid` in 0029 need Postgres equivalents (an identity
     column; no rowid). The deploy host's snapshot persistence
     (`deploy/firebase/functions/src/host.ts`: `VACUUM INTO`,
     `total_changes()`) is SQLite-only by nature and goes with it.
   - On SQLite, transactions take a per-database FIFO lock, a nested one
     joins the open one, and a seam call from outside waits for it to end
     (`db/db.ts`: `tx`, `gate`, `onFree`); in-process caches are dropped on
     rollback. Transactions are IMMEDIATE (the write lock is taken at
     BEGIN, retried without blocking the event loop for up to 5 s), so two
     processes doing the same check-then-write queue instead of one failing
     with "database is locked" (9x7eZw6BOgI7HSrVaffa, 2 Oct 2026). That
     lock is SQLite-only: a Postgres adapter runs each transaction on its
     own pooled connection and does without it.
   - Until a Postgres adapter exists the API is one instance on one volume
     (`deploy/kubernetes/`), enough for 15,000 displays.

## Authentication seams — partner identity, advertiser principal (spec only, REQUIREMENTS §9.5)

Today "Partner identity" (`auth/partnerAuth.ts`, `partnerFromRequest(ctx, req)`)
is the only authentication seam, and it is a static bearer token per DSP.
REQUIREMENTS §9.5 defines three named boundaries that extend it; none is
built yet, and each touches PH Core at a specific point:

| Boundary | What PH Core must provide | Touches |
|---|---|---|
| **AUTH-IDENTITY** | A stable `advertiserId` and the advertiser-to-campaign ownership on the existing advertiser and campaign records, so a principal can be checked against the records it owns or is delegated. A partner may act for several advertisers; the submitting principal is recorded apart from the advertiser the campaign is for. | Partner identity; `CampaignSource` (campaign and advertiser records) |
| **AUTH-CREDENTIAL** | Platform token issuance (already the owner of partner identity) issuing short-lived scoped tokens by OAuth client-credentials for both partners and advertisers. `partnerFromRequest(ctx, req)` becomes a principal resolver returning `{principalType, principalId, scopes}`; scopes are granted per DSP in DSP setup and per advertiser by the retailer. | Partner identity; `SecretsStore` (client secrets, signing keys) |
| **AUTH-LOGIN** | PH Core's user/identity service returning `{advertiserId, userId, role}` for a signed-in advertiser user, with role mapped to a subset of the advertiser's scopes. This build does not choose the login provider. | `SessionSource` (admin users stay on it; advertiser users are a separate principal type) |

### AUTH-CREDENTIAL — token issuance (boundary detail)

*Spec only; REQUIREMENTS §9.5 → "AUTH-CREDENTIAL boundary" is the contract.*
Issuance is where this build meets PH Core. Wherever PH Core already owns
partner identity, it is the **issuer**; this build only verifies. What PH
Core must guarantee:

- **One issuance path for every principal type.** `POST /v1/oauth/token`
  (client-credentials) issues for `partner` and `advertiser` alike, with
  `sub` = the stable `principalId` from AUTH-IDENTITY. No second credential
  system for either.
- **Short-lived, signed, offline-verifiable.** Lifetime 5–15 minutes
  (default 10), asymmetric signature with a `kid`, and a published key set
  this build reads to verify **without a call to PH Core on the request
  path**. Key rotation must overlap old and new keys for at least one token
  lifetime. (Open: rotation cadence.)
- **Scopes from the catalogue only** — `inventory:read`, `creative:submit`,
  `campaign:read` now; `campaign:author` and `campaign:publish` reserved
  and never issued until their release. Scopes are granted per DSP in DSP
  setup and per advertiser by the retailer; a token never carries a scope
  its client was not granted, and a login (AUTH-LOGIN) resolves to a subset
  of the same set.
- **Client secrets** are generated by PH Core, shown once, stored hashed,
  rotatable with overlap, and revocable. This build stores no client
  secret; `SecretsStore` keeps only what it must present onward (signing
  material, DSP-side credentials) under AES-256-GCM.
- **Revocation and status propagate.** Revoking a client, disconnecting a
  DSP or suspending an advertiser stops issuance at once; this build keeps
  its per-request DSP-connected and advertiser-`active` checks so the
  remaining token lifetime cannot be used to write.
- **Indistinguishable failure.** Unknown client, bad secret and revoked
  client all answer `401 invalid_client`.
- **Per-principal rate limiting stays here**: the API's 50 requests/s,
  burst 100 is keyed by `principalId` (not by client or token); the token
  endpoint carries its own tighter limit per `client_id` and per IP. The
  built-in limiter is per process, so the distributed-limiter note above
  applies to both.
- **Migration.** While partners move, PH Core honours both the legacy
  static token (same scopes as today) and issued tokens, reports which
  partners still use the legacy path, then disables it per environment.

### AUTH-IDENTITY — advertiser identity (boundary detail)

The caller's identity is one of two peer principal types that can be
authenticated — `partner` (a DSP) and `advertiser` — plus `admin` (a
retailer user, on `SessionSource`). Today only `partner` is authenticated;
an advertiser is just an `advertiserId` on a campaign or reservation.

**Where the advertiser principal's identity comes from.** This build owns a
first-class advertiser record (`advertisers` table behind `AdvertiserRepo`:
`advertiserId`, `name`, `status`, optional `externalRef`). The advertiser
principal's `principalId` is that `advertiserId`. The record holds no
credentials and no users (AUTH-CREDENTIAL, AUTH-LOGIN).

**What PH Core must guarantee about advertiser identity on integration:**

1. **A stable, unique, never-reused `advertiserId`.** Where PH Core is the
   system of record for advertisers, this build's record is keyed by it
   (`externalRef` carries PH Core's id if the two differ) and never
   re-mints it. An id that was used in a booking, invoice or audit row
   must never be reassigned to another advertiser.
2. **Advertiser-to-campaign ownership** on PH Core's campaign record: every
   campaign names exactly one `advertiserId`, so a principal can be checked
   against the records it owns. A partner acting for several advertisers
   does not change the owner; the submitting principal is recorded
   separately from the advertiser the campaign is for.
3. **Lifecycle propagation.** Suspension, reactivation or removal of an
   advertiser in PH Core reaches this build (through `CampaignSource` or
   an event), so a suspended advertiser's principal stops authenticating
   without the build deciding that on its own. Removal never deletes
   bookings or billing history.
4. **No credentials or user data cross this seam.** PH Core hands over
   identity and status only; client secrets stay in `SecretsStore` and
   user identities in PH Core's identity service.

The partner path is unchanged by this boundary.

The rule that keeps these one system: a login and a client secret
resolve to the same advertiser principal and scope set (§9.5).

### AUTH-LOGIN — advertiser user identity (boundary detail)

*Spec only (REQUIREMENTS §9.5 → "AUTH-LOGIN boundary"). User identity is the
one place in §9.5 where people, not records, touch PH Core.*

1. **Identity is PH Core's.** PH Core's user/identity service owns user
   accounts, authentication (SSO or PH-managed, MFA), invitation and
   offboarding. It must return, for a signed-in advertiser user,
   `{advertiserId, userId, role}` — a stable, unique, never-reused `userId`
   and the one `advertiserId` the user acts for.
2. **Role → scope mapping is applied here.** This build maps `role` to
   scopes and intersects with the advertiser's own grant; PH Core does not
   issue scopes. A disabled user or suspended advertiser must stop
   resolving (lifecycle propagation as for AUTH-IDENTITY).
3. **Nothing personal crosses.** This build stores only
   `userId`/`advertiserId`/`role`/`status` and the `userId` as an audit actor
   claim — no credentials, names, emails or factors.
4. **Separate from `SessionSource`.** Admin users stay on `SessionSource`;
   advertiser users are never resolved through it, and the POC stand-in
   (`POC_ROLE`, everyone `hq_admin`) is never an advertiser login.
5. **Reserved scopes.** The Gen AI authoring surface sits behind
   `campaign:author` / `campaign:publish`; per-advertiser guardrails are
   retailer-set. Nothing is issued or enforced until that release.

## Real-time bidding — the player signals, the exchange fills (7 Oct 2026)

A position is sold one of two ways, set on its slot (`bidMode`, saved from
the display type's slot editor; Advertiser slots only): **advance** (the
default — a play window is bid on or reserved ahead of time and cleared by the
scheduled auction) or **realtime** (each impression is sold as the player
signals it). This is how DV360, The Trade Desk and Amazon transact (they
answer within tmax and cannot hold a bid open for days) and how DOOH SSPs such
as Broadsign Reach run the ad loop. A real-time position takes no window bids
or reservations (`POST /v1/reservations` answers 409), its windows read
`unavailable`, and the window auction skips it. It is for open and
whitelist-only positions: a slot held for named advertisers or assigned to a
private auction cannot be switched to real time.

**The exchange side is this build; the trigger is PH Core's.** The PWA player,
playback, distribution and playlists are PH Core, so this capability ships only
when both halves do. The contract, Player API `/api/player/v1` (bearer
`PH_PLAYER_TOKEN`; the public POC token outside production, and refused with
401 in production until set, so no deployment breaks):

| Call | PH Core's player… | The exchange… |
|---|---|---|
| `POST /impressions` `{displayId, slot}` | …sends it just before the real-time slot's turn in the rotation, early enough to leave the bid budget (`tmax`, default 200 ms, `PH_REALTIME_TMAX_MS`) plus a network round trip. | …sends one OpenRTB request per eligible connected DSP (the advance request, `imp.ext.ph.mode` = `realtime`, `tmax` and `exp` cut to the impression), runs the same pre-auction checks as for an advance bid, first price, and answers `filled` with the creative to play or `no_fill` — always 200, always within the budget. |
| `POST /impressions/{id}/played` | …sends it once the creative has played, within `expiresAt` (`PH_REALTIME_FILL_TTL_SEC`, default 120 s). | …records the play once against the display and the campaign; a repeat, an expired fill or a `no_fill` answers 409. |

**One auction per play (7 Oct 2026, the industry-standard DOOH model — Broadsign Reach
and the pDOOH ecosystem transact in plays).** Each `POST /impressions` is its own
auction: it gets a fresh impression id (the auction id) and a fresh OpenRTB
request id per DSP. One winning bid fills exactly one play, and the proof of
play closes it once. The next play signals again and calls a fresh auction. There
is no block, N-play hold or re-auction-after-N in the open auction: buying a run
of plays is a deal (the deals-volume ticket), not something won in the open
auction.

What PH Core's player must guarantee: it plays the filled creative from the
returned URL, or its own content on `no_fill` or when the answer is late (it
must not wait past its own deadline); it sends the signal at most once per
impression; it reports proof of play exactly once per played fill, with the
display it played on; and it caches nothing from a fill beyond `expiresAt`.

**At-bid creative, approved after the play (7 Oct 2026, Rob).** There is no
time to retrieve and review a creative inside tmax, so a real-time fill may
carry a creative PH has not seen: the one the DSP supplied in its bid
(`iurl`, under that DSP's own creative host). The answer says which kind of
fill it is, in `creative.source`:

| `source` | What the player plays | Review |
|---|---|---|
| `approved` | PH's approved copy (`url` on PH's asset host) | Done; never repeated for the same content hash (safe reuse, OQ40). |
| `under_review` | PH's copy of a creative awaiting a reviewer | Open; the creative keeps playing until the decision. |
| `at_bid` | **The DSP's own URL**, fetched by the player. `campaignId` is null. | Starts when the player reports the play: PH retrieves, hashes and checks the creative and puts it through the approval gate (or approves it automatically for an advertiser that needs no approval). |

A rejection stops the creative playing going forward and blocks its content
hash for every crid, DSP and advertiser; the DSP's own audit status stays
advisory and never approves or blocks (OQ40). **PH Core's player must**
fetch an `at_bid` creative from the `url` it is given (a DSP-hosted
address, not PH's asset store), play it as it would an approved one, and
report the play as usual — the review is triggered by that report, so a
play that is never reported is never reviewed. It must not cache an `at_bid`
creative beyond `expiresAt`, and must treat a rejected creative's later
`no_fill` as normal. The player cannot know a creative's type in advance:
`mimeType` for an `at_bid` fill is read from the URL's extension.

What the exchange guarantees: nothing is fetched inside tmax, so only an
already approved, activated creative that fits the display type's canvas, or
an at-bid creative from the DSP's own host, can fill; a
Test-mode DSP's bid never fills; impressions are their own table
(migration 0047, at-bid columns 0048) and never touch `reservations` or slot bookings, so
migration 0021's one-live-winner-per-window index is unaffected. Not yet
covered: per-impression billing of real-time plays, and per-impression
`imp.qty` (the request still carries the window's assumed views).

### Pre-caching approved creatives on the player (7 Oct 2026, Rob)

**PH Core's PWA player owns this; the exchange only hands off the approved
creative.** Once a creative has won and is approved, the player keeps a copy
for a defined period so it is resident before the slot's turn rather than
fetched on demand at hand-off. This mirrors Broadsign Reach's pre-caching of
approved Reach creatives. Nothing in this repo implements it: the player,
its cache and distribution are PH Core (REQUIREMENTS section 7, "Creative
retrieval and hand-off").

What PH Core's player must do:

- **Approved creatives only.** Pre-cache a creative whose `creative.source` is
  `approved` (PH's copy on PH's asset host). Approval still gates play
  (section 3): never pre-cache `under_review`, rejected or `at_bid` creatives.
  The existing rule stands for `at_bid`: never cache beyond `expiresAt`.
- **Defined lifetime.** Keep a pre-cached creative for a configurable period
  (cache TTL, config value; exact default to be confirmed by the core team).
  Evict on expiry, and immediately when the creative is rejected or its
  content hash is blocked.
- **Complements the bid lookahead window** (Advertiser settings, separate
  ticket): the lookahead decides how early the auction resolves, so it sets
  when a winner is known and can be pre-cached; the cache keeps that winner
  renderable at hand-off with no fresh fetch.
- **Falls back safely.** A cache miss or an expired entry fetches from the
  returned `url` as today, or plays the player's own content if that is late.

What the exchange guarantees: the hand-off already carries the approved
creative's `url`, `mimeType` and content identity; no exchange change is
needed for this ticket.

### Bandwidth protection: uncached creatives in a restricted window (7 Oct 2026, Rob)

For a retailer whose in-store network is shared with POS and stock systems,
live creative downloads must not contend with trading, without going dark at
peak and without a blunt "what plays when" daypart block. The restriction is
only on content the player does not already hold: while it is in force a
real-time impression can be won only by a creative already in the player's
cache. Cached creative bids, wins and plays as normal; outside the window
everything bids as normal.

**The exchange cannot see the cache or the store's hours (both PH Core's), so
the player sends them on `POST /api/player/v1/impressions`:**

- `cachedCrids`: the creative ids (the `crid` a DSP bids with) resident on the
  player, 500 at most. Only the pre-caching of approved creatives (above) and
  any earlier play put a creative there. Omitted means none cached.
- `storeOpen`: whether the display's store is open now, from the same store
  hours that drive the Store Open / Closed targeting variable. Omitted is
  treated as not open, so a missing signal never blocks a bid.

The retailer sets the window in Advertiser settings (`uncachedRestriction`):
`off` (default), `fixed` (a daily start and end, UTC, wrapping past midnight
when start is after end), or `store_open` (restricted while the player says
the store is open; "store closed" is not offered). An uncached bid is passed
over and the next-best cached bid wins; none cached answers `no_fill` and the
player plays its own content. Not covered: the advance window auction, whose
winners are known ahead and pre-cached before their slot, and an admin screen
for the setting (the API and `PUT /advertiser-settings` carry it).

### Website and Mobile App slots: same slot editor as digital signage (7 Oct 2026, Rob)

A Website or Mobile App display type now uses the **same slot editor, fields
and behaviour as Digital Signage**: Maximum Campaigns Played In Rotation, the
owner list (Headquarters / Advertiser) and Advertiser assignment on
Advertisers / Inventory (reserve price, billing unit, max campaigns, named
advertisers, deals). This supersedes the earlier "RTB only" switch
(*Available for RTB*) and the 28 Sep "HQ-only" rule. A slot's `bidMode`
(`advance` default, or `realtime`) works as for any other touch point.
What stays different is the bid request: web/app programmatic inventory.

Playlists and website/app rendering are PH Core's, so this needs a PH Core
change on both sides of the seam:

| PH Core | Exchange |
|---|---|
| Stores the slot owner and mode on the playlist slot (the display type's `phExtensions.slots[n]`), edited in the same slot editor as digital signage. | Validates it as for digital signage: Headquarters or Advertiser, `advance` or `realtime`, never Stores. |
| At render time, for a real-time Advertiser slot only, calls `POST /impressions` `{displayId, slot}` once per impression (one render, one impression). A Headquarters slot never calls it. The `displayId` is the website or app surface registered under the display type. | Sends one OpenRTB request per eligible DSP with the **`site`** (Website) or **`app`** (Mobile App) object, never `dooh`, and **no `imp.qty`** (multiplier 1). `imp.ext.ph.mode` = `realtime`. Buyers and targeting lists, blocklists, seat permissions, USD bidding and post-bid creative approval apply as for any real-time slot. A web/app slot needs no audience score to be sold. |
| Renders the winning creative from `creative.url` (an `at_bid` creative is the DSP's own URL), or its own content on `no_fill` or a late answer, and reports the play once. | Answers `filled` or `no_fill`, always 200, within the bid budget. |

`site.id`/`app.id` is the display type's id and `name` its name; `site.domain` and
`publisher` are the exchange's. No device, user or cookie data is sent.
Not yet covered: the page URL / app bundle and store URL (`site.page`,
`app.bundle`), `device` and IFA, which the player would have to supply.

## Reserved for later releases (REQUIREMENTS §9, spec only)

These are reserved names and places, with no behaviour yet:

- **Canonical event schema v1** (`packages/types/src/analyticsEvent.ts`).
  - The versioned shape for play, impression and interaction events, with
    the CV measurement fields optional and nullable, each paired with a
    `confidence`.
  - It comes with a validator for future producers.
  - **Nothing produces, stores or reads these events yet.** The existing
    PH analytics system stays the system of record.
  - The exhaustive field reference is open question 53.
- **Instance identity** (a seam only: a name and an intent, no columns,
  no behaviour).
  - Migration 0022 briefly reserved two nullable columns for it
    (`exchange.platform_instance_id`, `reservations.source_instance_id`).
    Nothing produced, read or returned them, so migration 0032 dropped
    them (Rob, 30 Sep 2026). Federation identity is a separate
    integration for a later release, when PH instances negotiate with
    each other, and it gets storage only when that integration exists.
  - This identity is deliberately **not** the `sellers.json` seller ID
    (the retailer's identity to the ad ecosystem, held in the
    seller-of-record fields). It maps to the instance's stable domain
    instead, so the later integration builds against a clean seam
    rather than inheriting orphan columns beside the seller-of-record
    fields.
- **Agent-to-agent interface** (§9.4).
  - This is a decision, not code: when PH instances negotiate with each
    other, the surface will be agent-consumable (MCP-layer) and first
    class.
  - It won't be a REST endpoint, and it won't be part of the tier-2
    Partner API.
  - Nothing is built.

## Open at the boundary

- **Engagement counts for billing.** Interactive campaigns are priced per
  engagement, but `PlaybackSource` counts plays, not QR scans. Billing the
  fee needs an engagement count from PH Core. BUILD-PLAN §10 records this
  as a decision nobody has made yet.
- **Egress by name.** The API and a plain NetworkPolicy refuse private
  addresses; only a DNS-aware egress policy (Cilium, Calico) can limit
  outbound traffic to the DSPs' own hostnames. The client's cluster
  decides.
- **Where the DSP integration switch lives.** It is stored on this build's
  exchange record. If HQ Admin already keeps company-level feature switches
  (its *Enabled Features*), the switch belongs there, read through a seam
  like `Flags`.
- **Venue and screen metadata per store and display** (spec §1): decided, see "Venue and geo metadata" below. Not open.

## Venue and geo metadata — owned by PH Core (decision 29 Sep 2026, Q35; stand-in confirmed 1 Oct 2026)

**Owner: PH Core.** It already manages all store data for a retailer,
including venue and geo metadata, and is the system of record. The
exchange reads it **read-only** and surfaces it on the inventory and
targeting responses and in the OpenRTB bid request (`dooh.venuetype`); it
keeps **no copy** on its own store record, and nothing here writes it back.
If Core changes a store's venue or geo values, the next read reflects it.

**POC stand-in (until PH Core exposes a store/display venue seam):** the
venue is held on the display type as `phExtensions.venue`
(`openOohVenueType`, `orientation`, `loopLengthSec`), written through
`PUT /admin/v1/display-types/{id}/extensions`. That is a stand-in for a
PH Core value, not a decision that this build owns venue data.

**On integration:** the adapter reads venue and geo from PH Core's
store/display record through `StoreSource` (OpenOOH venue type,
latitude/longitude, store id; read-only, never written), and the
`extensions` PUT stops accepting `venue`. `apps/api/test/auction.test.ts`
asserts the bid request's `dooh.venuetype` and the inventory venue fields
come from the seam value, so swapping the adapter is covered.

### Max play length: the loop must be built from the resolved slot length (7 Oct 2026, ticket KeZZ4HPvATweSiDdn0KI)

**Status: open, owned by PH Core. Contract change, flagged, not built blind.**
The exchange now counts a window's plays as floor(window length / the slot's
**max play length**), a fixed per-play duration resolved slot → display type
→ company default (REQUIREMENTS §5 "Max play length";
`domain/plays.ts`, `domain/positions.ts` `maxPlayLengthSecFor`). It no
longer divides by the loop length, and an advertiser's creative length never
feeds the count. A creative longer than the slot's max play length is
rejected at upload (and again at hand-off and real-time bid), not trimmed.

That only matches what plays if PH Core builds the loop the same way. PH
Core to provide:

1. **Loop built from the resolved slot length.** Each advertiser slot in a
   rotation is allotted exactly its resolved max play length, as Broadsign's
   loop policy allots a fixed slot length — not the playlist item's
   `playbackDuration`, and not the creative's own length (a shorter creative
   is padded to the slot, never stretches the loop).
2. **The resolved value.** The exchange stays the source of truth for the
   three-tier setting (Advertiser settings; `PUT /admin/v1/available-inventory`);
   on integration PH Core reads the resolved `maxPlayLengthSec` per position
   from the inventory view (`screen.maxPlayLengthSec`) rather than keeping a
   second copy. `loopLengthSec` is now informational only.
3. **Proof of play.** `PlaybackSource` plays remain counted as played; PH
   Core must not report a play of an advertiser slot shorter than its max
   play length as a full play.

Until then the POC's `slotDurationSec`/`loopLengthSec` venue stand-in still
drives the display-side rotation, so the plays the exchange sells and the
plays a real player produces are only guaranteed to agree once item 1 lands.
Changing a max play length re-derives `playsPerWindow` for future reads and
bids; windows already booked keep their booked counts.

**Update, 8 Oct 2026 (ticket 7uWimKA8oaTJEQDVatG2): the count is now
floor(window / (max slot length × slots in the rotation)).** `slotCount` on
the inventory view and Available Inventory row is the rotation size, HQ
positions included, and `playsPerWindow` is derived from it, never typed.
Two PH Core requirements follow:

4. **Max slot length binds HQ campaigns too.** The exchange has no HQ campaign
   upload (HQ campaigns are authored in PH Core), so it cannot reject an
   over-length HQ creative itself. PH Core must apply the same resolved
   `maxPlayLengthSec` to an HQ campaign's creative with the same over-length
   rejection an advertiser creative gets at upload — otherwise an HQ position
   could overrun its share of the loop and the plays sold would not fit.
5. **HQ positions fill part of the loop.** They are not on Available
   Inventory but are counted in `slotCount`; PH Core must keep the rotation
   size it reports to the exchange equal to the playlist's real slot count.

### Dependency on PH Core: completeness guarantee and missing-data behaviour (4 Oct 2026, ticket HxMMn84BcCP6y9S2jk3l)

**Status: open, owned by PH Core.** Nothing defines today what happens when a
store or display has no venue or geo metadata. Unlike an unscored slot, which
drops out of inventory cleanly, a store with no venue record would make the
exchange build a bid request a DSP may reject, with no signal why: a silent
fill-killer at onboarding. The decision (Rob) is that the exchange does not
define this; PH Core, as system of record, does. PH Core to provide:

1. **Completeness guarantee.** Which venue/geo fields are guaranteed present
   and valid per store/display before that display is sellable: OpenOOH venue
   type, latitude/longitude, store identifier (spec §1, §7, Q35), and
   orientation and loop length per display.
2. **Missing-data signal.** What `StoreSource` returns when a store/display
   lacks any required field (an explicit "venue incomplete" state or a
   per-field null, not a silent default), so the exchange can react
   deterministically.

**Exchange side (consumes the contract).** A position whose required
venue/geo is absent is treated as not sellable, analogous to the unscored-slot
rule: left out of `GET /v1/inventory` and the forecast, skipped by the
auction, and a bid or reservation on it refused with a 409 saying why. The
exchange never emits a bid request with invented or empty venue/geo fields.
The exact signal shape follows PH Core's definition; the POC (venue as
`phExtensions.venue`) is not changed by this ticket.

**Hand-off:** PH Core to define the guarantee and the missing-data contract.

## Analytics event values billing consumes (decision 29 Sep 2026, Q53/Q54)

Analytics — the event schema, its data partition and the consuming
pipeline — is held by Personalisation Hub inside the PWA player and is
managed **outside this project**. This project does not own or host it.
It depends on the following values from that flow (billing:
`apps/api/src/billing/`); the external system must supply them,
per campaign, per position and per play window:

| Value | Used for |
|---|---|
| Campaign id and position id | Attributing plays to the win or reservation |
| Display id (per play) | Counting displays that actually played |
| Play start time and duration, in seconds | Proof of play: `played` seconds in the window |
| Window start and end (or timestamps that fall in it) | Bounding plays to the window |
| Play count | Line item `plays` |
| Displays in scope, share of voice | Deriving `expected` seconds |
| Audience measure behind assumed views (VAC-d inputs) | `assumedViews` per window |
| **Received-at time (when the platform got the play)**, per play | The settlement cut-off: a play received before the window's line item is written counts; one received after is disregarded for billing and reported as lost revenue from downtime (Rob, 4 Oct 2026). Distinct from play start time, which says when it played. |

Billing computes `realised VAC-d = assumed views × min(1, played / expected)`
and `amount = realised VAC-d / 1000 × clearing CPM`. Plays that did not
happen are not billed and there is no make-good (Q29).

**Settlement is final (Rob, 4 Oct 2026).** A window is invoiced once, on the
playback available when its line item is written; the line item never
changes afterwards. Playback the platform receives after that (a display
that was offline and backfills) is not re-billed, credited or trued up. It
is recorded at what it would have been worth at the window's cleared CPM and
reported as **lost revenue from display downtime**, by store, display and
over time, so the retailer's operational teams own it. Data received between
window end and settlement still counts. PH Core must therefore supply
received-at per play (table above). The stand-in plays table carries it
(`plays.received_at`, migration 0043; null = known at settlement) and the
cut-off, late-play ledger and lost-revenue report are built on it
(`apps/api/src/billing/late.ts`); on integration PH Core's playback store
answers `PlaybackSource.totals(receivedBy)` and `receivedBetween` itself. Closed-loop
conversion attribution is not an input (Q55).

**A PH Core requirement on partner-facing analytics** (Rob, 2 Oct 2026,
ticket DDOjJoYjraKROu4Ainj5; closes interface contract v3's open question):
any playback analytics PH Core reports to a partner must apply PH Core's
own minimum-volume (k-anonymity) rule before a thin segment is reported,
so a small count cannot reveal who saw a targeted version. That floor is
PH Core's call, as analytics is PH Core's (Q53/Q54). This build passes no
per-play attribute data to a partner: a DSP sees which of its campaigns
played and the billed figures, never an attribute value or a per-play
audience.
