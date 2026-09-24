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
| `PlaylistSource` | read, rename, delete | Playlist service | `list`, `get`, `create`, `rename`, `delete` | Inventory (loop length), Playlist Management | `get` ≤ 0.1 ms |
| `DisplaySource` | read only | Displays & Devices | `list`, `listByDisplayType`, `summaryByDisplayType`, `storeIdsByDisplayType` | **Hot**: `summaryByDisplayType` per position (counts, "no displays" check); `listByDisplayType` for the delete check only | `summaryByDisplayType` ≤ 0.05 ms, a count never the rows; `listByDisplayType` indexed |
| `StoreSource` | read only | Stores | `list`, `get` | Inventory store/region filters, booking schedule | `get` ≤ 0.05 ms |
| `CampaignSource` (`platform/CampaignSource.ts`) | read + write | Campaigns service | `getCampaign`, `listCampaigns`, `setActivation`, `onCampaignChanged`, `createCampaign`, `addAsset`, `latestAssets`, `bookSlot`, `bookings` | **Hot**: `getCampaign` per bid in the auction | `getCampaign` ≤ 0.5 ms |
| Approval adapter (`packages/campaign-approval/src/adapter/CampaignSource.ts`) | read + activation | Campaigns service | `getCampaign`, `listCampaigns`, `setActivation`, `onCampaignChanged` | Approval screens, `isCampaignEligible` before every bid, reservation and hand-off | see the integration guide |
| `PlaybackSource` | read only | Playback logging | `totals({campaignId, displayTypeId, from, to})`, `listPlays` | Billing, once per ended window | aggregated at the source: ≤ 1 s for 2 million plays |
| `AssetStore` | write + read | Asset hosting / CDN | `put`, `read`, `url` | Creative upload and DSP creative retrieval; hand-off re-validation | — |
| `AudienceSource` | read only | Audience scoring (MOVE/VAC-d, spec §4) | `forSlot`, `targetedShare` | **Hot**: per position in inventory, forecast, OpenRTB `qty.multiplier` | ≤ 0.1 ms |
| `ReachCountSource` | read only | *Unassigned* — see "Open" below | `matchOf(totalDisplays, rules)` | Booking schedule page load | point-in-time, as-of stamped |
| `SessionSource` (`auth/session.ts`) | read only | HQ Admin session and roles | `current()` → `{userId, name, role}` | Every Admin API request | — |
| Partner identity (`auth/partnerAuth.ts`) | read only | Platform token issuance | `partnerFromRequest(req)` → one `PartnerRecord` or 401 | Every Partner API request | ≤ 0.1 ms |
| `SecretsStore` | encrypt / decrypt | Platform secrets handling (KMS) | `encrypt`, `decrypt` | Saving DSP credentials; connecting to a DSP | off the hot path by design |
| `Flags` | read only | Feature flags | `dspIntegration` | Every new endpoint (404 when off) | — |
| DSP integration switch (`exchange.enabled`, migration 0023) | read + write | *This build* (the retailer's own setting, on Exchange settings) | `ctx.exchange.get().enabled`; `GET /admin/v1/features` | Every Partner API request, sellers.json, the auction, the nav | — |

### What each seam must guarantee

These are behaviours the build **relies on**. An adapter that doesn't
provide one breaks something specific, named here.

- **`DisplayTypeSource`**
  - `phExtensions` (slots, reserve price, venue) round-trips unchanged.
    Nothing but this build reads or writes that field.
  - `list()` returns records the caller must not mutate. The stand-in
    deep-freezes them and serves a snapshot that each write replaces, with
    a 1-second TTL. Any cache in the real adapter needs the same property:
    **a save is visible to the process that made it immediately, and to
    every other process within a bounded time.**
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
  - Billing is idempotent per reservation (`billing_line_items.reservation_id`
    is unique).
- **`AssetStore`**
  - `read(file)` accepts only names that `put` generated. The stand-in
    enforces `^[a-z0-9-]+\.[a-z0-9]+$`, so a path can't traverse
    directories.
  - Files are served with `nosniff` and a CSP that blocks script. An SVG
    creative can't run code even when it is opened directly.
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
| `0020` (indexes), `0021` (one live winner per window), `0022` (reserved instance identity) | This build (review, 23 Sep 2026) | Kept. See "The database must enforce" below for the parts that also apply to PH Core tables. |
| `0023` (the DSP integration switch) | This build (Rob, 24 Sep 2026) | Kept, unless the platform already holds company feature switches (see "Open" below). |
| `0024` (`auction_runs`: which process clears a window) | This build (24 Sep 2026) | Kept: it lets several instances share the scheduled work. |
| `0025` (covering index on `plays`) | Stand-in only | Dropped with `plays`; the playback store answers `totals` itself. |

## Outbound boundaries — what this build calls

| To | How | Bounded by |
|---|---|---|
| DSP management APIs (DV360 API v4, Amazon Ads DSP, The Trade Desk v3) | `apps/api/src/dsp/*` clients, called on Connect / Re-test | Admin action only. They never run on a request path. |
| DSP bidders (OpenRTB 2.6 DOOH) | `dsp/bidder.ts`, from the auction | Per request:<br>- 300 ms timeout<br>- 500 QPS per DSP<br>- 64 KB response cap<br>- responses must echo the request `id`; bids must match `impid` 1<br>- at most 10 bids per response<br>- price ≤ `maxBidCpm`<br>- a missing `cur` means USD |
| DSP creative hosts | `exchange/creatives.ts`, for a bid carrying an unknown creative | - Only URLs under that DSP's own creative path, checked after normalisation.<br>- One retrieval per response, claimed once across concurrent auctions.<br>- Byte-capped at the asset size limit.<br>- 10 s timeout. |

The POC points every one of these at the mock DSP service
(`apps/dsp-mocks`). Real endpoints are configuration (`config.ts`,
`.env`), not code.

## Inbound boundaries — what this build offers

Both inbound surfaces are specified in API.md. The limits below are part
of that contract (openapi.yaml carries them):

- **Partner API (`/v1`)**
  - Per partner token: 50 requests/s, bursts of 100, then `429
    rate_limited` with `Retry-After`.
  - At most 2 asset uploads in flight per partner.
  - Forecast: at most 200 positions, each listed once.
  - Content package: name ≤ 200 characters, ≤ 20 targeted versions, ≤ 10
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
     synchronous and nothing awaits it; a Postgres adapter means an
     asynchronous repository layer — contained (one file per seam,
     `context.ts` the only wiring point) but engineering work. Until then
     the API is one instance on one volume (`deploy/kubernetes/`), which
     serves a 15,000-display estate with headroom.

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
- **Instance identity** (migration 0022).
  - `exchange.platform_instance_id` and `reservations.source_instance_id`
    are nullable and unused, and no API returns them.
  - This identity is deliberately **not** the `sellers.json` seller ID.
    It maps to the instance's stable domain instead.
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
- **Venue and screen metadata per store and display** (spec §1). It is
  held on the display type for now, and has no PH Core seam yet.
