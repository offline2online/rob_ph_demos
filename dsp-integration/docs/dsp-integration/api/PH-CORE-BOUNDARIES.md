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
that chooses an implementation**. The POC wires in SQLite stand-ins; on
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
   │  AudienceSource  ReachCountSource  SessionSource  partner identity  │
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
| `CampaignSource` (`platform/CampaignSource.ts`) | read + write | Campaigns service | `getCampaign`, `listCampaigns`, `setActivation`, `onCampaignChanged`, `createCampaign`, `addAsset`, `latestAssets`, `bookSlot`, `bookings` | **Hot**: `getCampaign` per bid in the auction | `getCampaign` ≤ 0.5 ms |
| Approval adapter (`packages/campaign-approval/src/adapter/CampaignSource.ts`) | read + activation | Campaigns service | `getCampaign`, `listCampaigns`, `setActivation`, `onCampaignChanged`, `discardEditsAfter` | Approval screens, `isCampaignEligible` before every bid, reservation and hand-off | see the integration guide |
| `PlaybackSource` | read only | Playback logging | `totals({campaignId, displayTypeId, from, to})`, `listPlays` | Billing, once per ended window | aggregated at the source: ≤ 1 s for 2 million plays |
| `AssetStore` | write + read | Asset hosting / CDN | `put`, `read`, `url` | Creative upload and DSP creative retrieval; hand-off re-validation | — |
| `AudienceSource` | read only | Audience scoring (MOVE/VAC-d, spec §4) | `forSlot`, `targetedShare` | **Hot**: per position in inventory, forecast, OpenRTB `qty.multiplier` | ≤ 0.1 ms |
| `ReachCountSource` | read only | *Unassigned* — see "Open" below | `matchOf(totalDisplays, rules)` | Booking schedule page load | point-in-time, as-of stamped |
| `SessionSource` (`auth/session.ts`) | read only | HQ Admin session and roles | `current()` → `{userId, name, role}` | Every Admin API request | — |
| Partner identity (`auth/partnerAuth.ts`) | read only | Platform token issuance | `partnerFromRequest(ctx, req)` → one `PartnerRecord` or 401. **Not an interface and not constructed in `context.ts`**: it is a function that reads `ctx.config.partnerTokens` directly, so on integration it is the one place besides `context.ts` to change (or it becomes a seam) | Every Partner API request | ≤ 0.1 ms |
| `SecretsStore` | encrypt / decrypt | Platform secrets handling (KMS) | `encrypt`, `decrypt` | Saving DSP credentials; connecting to a DSP | off the hot path by design |
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
  - `phExtensions` (slots, reserve price, venue) round-trips unchanged.
    Nothing but this build reads or writes that field.
  - `list()` returns records the caller must not mutate. The stand-in
    deep-freezes them and serves a snapshot that each write replaces, with
    a 1-second TTL. Any cache in the real adapter needs the same property:
    **a save is visible to the process that made it immediately, and to
    every other process within a bounded time.**
  - Known weakening in the POC: `context.ts` (`approvalParts`) builds a
    **second** `DisplayTypeSource` snapshot for the approval canvas, with
    its own 1-second TTL, so the approval screens can lag a save by up to a
    second even though the first snapshot is current. On integration both
    must read one adapter.
- **`DisplaySource`**
  - `summaryByDisplayType` answers with counts (displays, and the stores
    they are in), never the rows: every position, availability check, bid
    request and bid asks it (24 Sep 2026). The stand-in keeps a one-second
    snapshot of one GROUP BY.
  - `listByDisplayType` must be an indexed lookup (migration 0020 on the
    stand-in); only the delete check reads the rows now.
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
    discarded (rejected) edit.
- **`CampaignSource.listCampaigns`**
  - Order is the platform's to define, but both facets must agree. The POC's
    platform seam orders by `rowid` and the approval adapter by
    `created_at, id`; an integration builds both from one source (see
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
    `personalised`. Billing charges a personalised play at the committed
    price × the personalised multiplier and everything else at the
    committed price, so it needs this from PH Core's playback data; this
    build cannot infer it. `totals` therefore also returns the personalised
    plays and their seconds (`personalised: {plays, playedSec}`). Until PH
    Core supplies it the field is null and every play bills at the
    committed price, exactly as before. The stand-in `plays` table carries
    the two columns nullable (migration 0033).
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
    `scored` when a row exists; a display type created in HQ Admin has none
    until the retailer's scoring writes one.
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

### Tables: whose they are

| Migrations | Owner | On integration |
|---|---|---|
| `0001` (display types, playlists, displays, campaigns, plays), `0012` (slot bookings), `0014` (stores) | **PH Core stand-ins** | Dropped. The seams above read and write the real services instead. |
| `0002`–`0011`, `0013`, `0015`–`0019` | This build | Kept. Plain, Postgres-compatible SQL. |
| `0020` (indexes), `0021` (one live winner per window) | This build (review, 23 Sep 2026) | Kept. See "The database must enforce" below for the parts that also apply to PH Core tables. |
| `0022` (reserved instance identity) and `0032` (drops it again) | This build | Nothing to keep: 0022 was dropped by 0032 (Ql8j8H6F, 30 Sep 2026). |
| `0023` (the DSP integration switch) | This build (Rob, 24 Sep 2026) | Kept, unless the platform already holds company feature switches (see "Open" below). |
| `0024` (`auction_runs`: which process clears a window) | This build (24 Sep 2026) | Kept: it lets several instances share the scheduled work. |
| `0025` (covering index on `plays`), `0033` (`plays.version_id` / `tier`) | Stand-in only | Dropped with `plays`; the playback store answers `totals` itself, and must supply the version tier (see `PlaybackSource`). |
| `0034` (`reservations.personalised_multiplier`, personalised columns on `billing_line_items`) | This build (Rob, 30 Sep 2026) | Kept: the multiplier is snapshotted on the reservation at clear time. |
| `0026` (one open API bid per advertiser and window) | This build (24 Sep 2026) | Kept: a partial unique index, as 0021. |
| `0027` (`company_advertiser_settings`: deferred play-window change) | This build (26 Sep 2026) | Kept. |
| `0028` (`playlists.playlist_settings`), `0029` (multi-zone layout on the playlist) | **PH Core stand-in** (`playlists`) | Dropped with `playlists`: the playlist service owns its own settings and zoning (`PlaylistSource.saveSettings`). |
| `0030` (a DSP's own category lists on `partners`) | This build (28 Sep 2026) | Kept. |
| `0031` (`assets.content_hash`, `discarded_at`; `campaign_slot_bookings.asset_version`) | Mixed | `assets` and the booking's `asset_version` are the campaign system's: the booking must carry the version it plays (see `CampaignSource.bookSlot`). Content-hash reuse and discard are this build's approval records. |
| `0035` (`displays.vacd_override`; the default itself is `phExtensions.defaultVacd`) | **PH Core stand-in** (`displays`) | Dropped with `displays`. The per-display override is the audience source's own data: `AudienceSource.forSlot` must return the same sum. |
| `0036` (drops the unused `audience_scoring` column) | This build | Nothing to keep. |

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
   - On the platform's Postgres the same SQL runs unchanged, and MVCC plus
     a connection pool replace WAL and the busy timeout.
   - What does change (24 Sep 2026): the driver. `node:sqlite` is
     synchronous; a Postgres adapter means an asynchronous repository
     layer — contained (one file per seam, `context.ts` the only wiring
     point) but engineering work. Until then the API is one instance on
     one volume (`deploy/kubernetes/`), enough for 15,000 displays.

## Authentication seams — partner identity, advertiser principal (spec only, REQUIREMENTS §9.5)

Today "Partner identity" (`auth/partnerAuth.ts`, `partnerFromRequest(req)`)
is the only authentication seam, and it is a static bearer token per DSP.
REQUIREMENTS §9.5 defines three named boundaries that extend it; none is
built yet, and each touches PH Core at a specific point:

| Boundary | What PH Core must provide | Touches |
|---|---|---|
| **AUTH-IDENTITY** | A stable `advertiserId` and the advertiser-to-campaign ownership on the existing advertiser and campaign records, so a principal can be checked against the records it owns or is delegated. A partner may act for several advertisers; the submitting principal is recorded apart from the advertiser the campaign is for. | Partner identity; `CampaignSource` (campaign and advertiser records) |
| **AUTH-CREDENTIAL** | Platform token issuance (already the owner of partner identity) issuing short-lived scoped tokens by OAuth client-credentials for both partners and advertisers. `partnerFromRequest(req)` becomes a principal resolver returning `{principalType, principalId, scopes}`; scopes are granted per DSP in DSP setup and per advertiser by the retailer. | Partner identity; `SecretsStore` (client secrets, signing keys) |
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

- **Who hosts reach counts.** `ReachCountSource` is a POC estimate. The
  interface contract with Live Visitor Profile hasn't decided whether one
  endpoint or two answers display counts and localised match counts.
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

## Analytics event values billing consumes (decision 29 Sep 2026, Q53/Q54)

Analytics — the event schema, its data partition and the consuming
pipeline — is held by Personalisation Hub inside the PWA player and is
managed **outside this project**. This project does not own or host it.
It depends on the following values from that flow (billing:
`apps/api/src/exchange/billing.ts`); the external system must supply them,
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

Billing computes `realised VAC-d = assumed views × min(1, played / expected)`
and `amount = realised VAC-d / 1000 × clearing CPM`. Plays that did not
happen are not billed and there is no make-good (Q29). Closed-loop
conversion attribution is not an input (Q55).
