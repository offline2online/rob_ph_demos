# Display Types & DSP Integration — structural findings

Read-only structural analysis of `dsp-integration/` in `offline2online/rob_ph_demos`,
at commit `c8b6674` (29 Sep 2026). Nothing in the folder was changed, created, moved,
renamed or deleted except this file. The build is treated as a proof of concept that
engineering will integrate into the primary Personalisation Hub repository, so the
weight is on the boundary between this build and everything outside it.

Method: every source file under `apps/`, `packages/`, `deploy/` and `scripts/` was read
in full, the 31 API migrations and the two approval migrations were read, the import
graph was extracted (`from '…'` targets per folder), direct SQL outside the repository
layer was located by search, and function and route-handler lengths were measured.
Tests (about 8,200 lines) were used only to confirm seams, not reviewed for quality.
Line numbers below are for this commit.

Contents:

1. Structure map
2. Module boundaries as they stand
3. The seams that need the clearest boundaries: billing, DSP contracts, federation identifiers
4. Naming
5. Functions doing more than one thing
6. Proposed target layout, as a diff from what exists (not implemented)

---

## Summary

The build is an npm-workspaces monorepo: a Fastify API over SQLite, a React admin UI,
a mock DSP service, a shared types package generated from the OpenAPI contract, and a
self-contained campaign-approval package. Its **declared** boundary with PH Core is
good: every platform dependency is behind an interface in `apps/api/src/platform/`,
`context.ts` is the single wiring point, `PH-CORE-BOUNDARIES.md` names each seam and
its guarantees, and the approval package has a contract-test suite for the one adapter
engineering must write. That part will integrate well.

The **internal** boundaries are weaker than the external ones, and that is what will
cost engineering time:

- `Context` is a god object. Thirty-nine files take the whole `ctx`; `domain/` code
  reads repositories, stand-ins, the clock and raw SQL through it, so "domain" is a
  service layer with no pure core.
- SQL leaks out of the repository layer into `domain/`, `exchange/`, `context.ts`,
  `http/app.ts` and `seed/`. Billing has no repository at all: `billing.ts` writes the
  table, `ReservationRepo` reads it, `domain/positions.ts` queries it.
- Four route handlers are 110–125 lines long and hold business rules (window
  arithmetic, deal locking, billing-unit change refusal, play-window deferral) that
  nothing else can call.
- Provider knowledge for DV360, Amazon and The Trade Desk is spread over seven places
  (`dsp/`, `config.ts`, the shared catalog, `domain/dspAudit.ts`, `domain/partnerInput.ts`,
  `exchange/creatives.ts` via config, and `dsp-mocks`), and the `Provider` union is
  re-declared in three of them.
- The federation identifiers exist as two nullable columns and two TypeScript types
  that no code reads or writes; they are stored on the same row as the seller-of-record
  fields that the spec says they must be held "alongside, never inside".
- Naming is strong on domain nouns (position, play window, buyers list, hand-off,
  clearing CPM) and weak where one word carries several meanings: `exchange`,
  `company`, `campaign`, `seat`, `partner`, `reservation`, `phExtensions`.

Section 6 proposes a layout that keeps every external seam exactly where it is and
re-cuts the inside along billing, auction, DSP-provider, identity and reporting lines.

---

## 1. Structure map

Sizes are lines of source (TypeScript, SQL, shell, Markdown, YAML), excluding
`node_modules`, lockfiles, the generated `openapi.d.ts` (3,829 lines) and the built
`prototype/` bundle.

### 1.1 Top level

| Path | Responsibility | Notes |
|---|---|---|
| `package.json`, `package-lock.json`, `tsconfig.base.json` | npm workspaces root (`packages/*`, `apps/*`); scripts fan out to workspaces plus two board scripts | Node ≥ 22.13; React pinned via `overrides` |
| `.env.example`, `.gitignore` | One `.env` at the POC root feeds both the API and the admin (Vite `envDir: '../../'`) | |
| `README.md` (335) | Orientation, hosted-prototype story, board sync, layout table, running it | Detailed and current |
| `.claude/skills/ph-designer/` (1,833) | A full copy of the Personalisation Hub design skill | Duplicates a skill that also exists at repo level |
| `apps/api/` | The POC API: Fastify + `node:sqlite` | See 1.2 |
| `apps/admin/` (6,445 src + 1,913 test) | React 18 / Vite / Ant Design / AG Grid admin UI, content frame only (iframed into HQ Admin) | See 1.4 |
| `apps/dsp-mocks/` (506) | Mock DV360, Amazon Ads and The Trade Desk management APIs, OpenRTB bidders, a control API and a test page | See 1.5 |
| `packages/types/` (467 + generated) | Types generated from `openapi.yaml`, plus hand-written catalogues (`catalog.ts`) and the reserved analytics event (`analyticsEvent.ts`) | Consumed by API, admin and approval |
| `packages/campaign-approval/` (1,037 src + 621 tests) | Campaign approval as a drop-in module: adapter interface, state machine, store, service, routes, UI components, contract tests, own migrations (0100+) | The cleanest module in the build |
| `deploy/firebase/` (594) | The API hosted as one Cloud Function with Firestore-backed persistence, plus a local stand-in server and an esbuild bundle script | Reaches into `apps/api/src` by relative path |
| `deploy/kubernetes/` (707) | Dockerfile, esbuild bundle, Kustomize base and optional manifests for a client's EKS | Nothing here deploys from this repo |
| `docs/dsp-integration/` (8,732) | Requirements (3,149), build brief, build plan, approval integration guide, `api/` (API.md, openapi.yaml, boundaries, security, scale) | Path doubles the folder name: `dsp-integration/docs/dsp-integration/` |
| `prototype/` | The **built** admin bundle, committed, rebuilt by a workflow, with `build-info.json` | A build artefact inside the source tree |
| `prototype-reference/` (4,096) | The original read-only JSX prototype used as UI specification | Not shipped; its own `package-lock.json` |
| `scripts/` (657) | `rebuild-prototype.sh`, `sync-board-docs.mjs`, `board-tickets.mjs` | The two `.mjs` scripts are backlog-board tooling, not product |

### 1.2 `apps/api/src`

| Folder / file | Lines | Responsibility |
|---|---|---|
| `index.ts`, `env.ts`, `config.ts`, `context.ts` | 300 | Process entry and shutdown; `.env` loading; all runtime configuration including per-provider DSP endpoints and every scalability limit; the composition root (`Context`) that builds every stand-in, repository, DSP client, bidder and the approval service |
| `http/` | 180 | `app.ts` (Fastify app: session hook, `Guards`, security headers, error mapping, health probes, route registration, asset serving), `errors.ts` (the one error shape), `rateLimit.ts` (token bucket) |
| `auth/` | 89 | `partnerAuth.ts` (static bearer tokens → `PartnerRecord`, constant-time), `session.ts` (stand-in HQ Admin session and role → scope map) |
| `flags/`, `secrets/` | 46 | `dspIntegration` build flag; AES-256-GCM `SecretsStore` |
| `db/` | 729 | `db.ts` (open, WAL, prepared-statement cache, `tx`, JSON helpers, unique-violation test), `migrate.ts` (versioned up/down, merges the approval package's migration folder), `migrations/` (31 up/down pairs) |
| `platform/` | 578 | The PH Core seams, each file holding **both** the interface and its SQLite stand-in: `DisplayTypeSource`, `PlaylistSource`, `DisplaySource`, `StoreSource`, `CampaignSource` (campaigns, assets, slot bookings), `PlaybackSource`, `AssetStore`, `AudienceSource`, `ReachCountSource` |
| `repos/` | 505 | This build's own records: `PartnerRepo` (DSP partners, encrypted secrets), `CompanySettingsRepo` (advertiser settings, per-advertiser settings, variable access, cached), `ExchangeRepo` (seller of record + DSP switch), `BuyersListRepo` (private-auction deals, term lock), `ReservationRepo` (bids and reservations, billable query) |
| `domain/` | 1,562 | Twenty files: validation (`advertiserSettings`, `campaignBrief`, `displayTypes`, `exchange`, `partnerInput`, `slots`, `targetingValidation`, `variables`), sell-side model (`positions` 381 lines: position index, visibility, play-window arithmetic, availability, the position DTO), `pricing`, `lists`, `buyersLists`, `assetChecks`, `media` (PNG/JPEG/MP4 sniffing), `dspAudit` (per-provider audit parsing), `partners` (API view), `deleteChecks`, `targetingSummary`, two retention sweeps |
| `dsp/` | 274 | `DspClient` interface, `googleDv360`, `amazonDsp`, `theTradeDesk` clients (connect and pull advertisers), `registry`, `bidder` (OpenRTB transport with QPS/timeout/size cap) |
| `exchange/` | 1,079 | The SSP machinery: `auction` (363), `enforcement`, `openrtb` (bid-request builder), `creatives` (unknown-creative retrieval and review queueing), `handoff`, `billing`, `scheduler` (tick, auction claims, window promotion), three CLIs |
| `routes/admin/` | 1,152 | Twelve Fastify plugins under `/api/admin/v1`; `advertiserSettings.ts` (321) and `bookingSchedule.ts` (224) also hold the view-assembly and aggregation logic |
| `routes/partner/` | 683 | `/api/v1`: `index` (flag, switch, auth, rate limit), `inventory`, `targeting`, `campaigns` (content packages, uploads, submit), `reservations` (bids and reserve-price bookings) |
| `routes/public/` | 14 | `sellers.json` |
| `seed/` | 834 | Base seed (the prototype's data), sample bookings, the demo estate, seeded approval campaigns, three CLIs |
| `bench/load.ts` | 289 | Load benchmark |
| `test/` | 5,683 | Forty files; `contract.ts` validates every response against `openapi.yaml` strictly; `helpers.ts` wires an in-process mock DSP service |

### 1.3 `packages/`

| Path | Responsibility |
|---|---|
| `types/src/index.ts` | Re-exports named schemas from the generated `openapi.d.ts` as `DisplayType`, `Partner`, `BuyersList`, `BookingSchedule`, … |
| `types/src/catalog.ts` (310) | Fixed catalogues shared by API and UI: touch points, platform defaults, slot owners, `Assigned`/`assignedOf`, identifier types, reserve-price / billing-unit / max-campaigns inheritance, targeting modes, `PROVIDERS` (credential field definitions with UI labels, icons, colours, blurbs), IAB codes, targeting variables and operators, `advertiserSlug` |
| `types/src/analyticsEvent.ts` (112) | Reserved canonical event schema v1, `PlatformInstance`, a validator; nothing produces events |
| `campaign-approval/src/adapter/` | `CampaignSource` (the one seam) and `pocCampaignSource` (the POC implementation over `campaigns`/`campaign_assets`) |
| `campaign-approval/src/server/` | `stateMachine`, `approvalStore` (own tables), `service` (247: submit, approve, reject with edit discard, unreject, changed, eligibility, live version, safe reuse), `routes` (host supplies guard, approver check, reviewer) |
| `campaign-approval/src/ui/` | Badge, actions, filter, review panel, `useCampaignApprovals` hook; own tokens and icon |
| `campaign-approval/migrations/` | 0100, 0101 |
| `campaign-approval/tests/` | Contract suites runnable against any adapter, an in-memory reference adapter |

### 1.4 `apps/admin/src`

| Path | Responsibility |
|---|---|
| `main.tsx`, `App.tsx` (211), `flags.ts` | Entry (installs the demo shim when `VITE_DEMO=1`), router (hash router for the hosted build), nav rules by role and switch, route table, background prefetch, providers |
| `api/` | `client.ts` (typed fetch, `ApiRequestError`), `queries.ts` (every read query's key and fetcher, four typed as `unknown`), `features.ts` |
| `demo/` | `staticApi.ts` (live hosted API or read-only snapshot, pins `Date`), `mode.ts` |
| `features/display-types/` | Page (223), form (175), list, preview, delete, `model.ts` (331: pure helpers, slot/zone normalisation, feature availability stand-in, summaries), `api.ts` (queries and the multi-call save), `panels/` (phantom zone, enabled features, multi-zone, playlist settings, slot assignment) |
| `features/playlist-management/` | Page (483), style fields, cap-and-slots fields |
| `features/dsp-integration/` | Layout with one shared section draft (194), DSP list, DSP page (215), add partner, advertiser settings (214), exchange settings, shared targeting variables, DSP picker, `api.ts` |
| `features/advertisers/` | Advertisers / Inventory page (692), buyers-list table and modal |
| `features/booking-schedule/` | Campaign schedule page with two tabs; booking schedule (510); `path.ts` (`externalUrl`) |
| `features/campaign-status/` | Stand-in Campaign Status table (292), campaign detail (167), `useCampaigns.ts` (approval client and actions) |
| `shared/` | App shell, save bar, draft state, unsaved-changes guard, delete dialog, grid wrapper, table filters, small primitives |
| `theme/` | Ant Design theme tokens and CSS |
| `scripts/capture-demo.mjs`, `public/demo/` | Captures the API's read side into `api-snapshot.json` for the hosted fallback |

### 1.5 `apps/dsp-mocks/src`

`app.ts` mounts `dv360`, `amazon` (one path per region), `ttd`, a `bidder` per provider (OpenRTB
response and a generated PNG creative at `iurl`), `control` (tester API) and `page` (test
page). `state.ts` holds the in-memory model: `Seat {seatId, name}` and `MockAdvertiser`
kept **separate**, unlike the API's `PartnerRecord.seats`. It does not depend on
`@ph-dsp/types` and re-declares the IAB code table (`bidder.ts:11`).

### 1.6 Data ownership (migrations)

| Migrations | Owner | Tables |
|---|---|---|
| 0001, 0002, 0003, 0008, 0009, 0012, 0014, 0016, 0025, 0028, 0029, 0031 | PH Core stand-ins (dropped on integration) | `display_types`, `playlists`, `displays`, `campaigns`, `plays`, `campaign_assets`, `audience_vacd`, `campaign_slot_bookings`, `stores`, and additive columns on them |
| 0004, 0005, 0006, 0007, 0010, 0011, 0013, 0015, 0017–0024, 0026, 0027, 0030 | This build (kept) | `partners`, `company_advertiser_settings`, `advertiser_settings`, `variable_access`, `exchange`, `reservations`, `dsp_creatives`, `billing_line_items`, `buyers_lists`, `auction_runs`, the two unused instance-identity columns |
| 0100, 0101 | Approval package | `campaign_approvals`, `campaign_approval_audit`, `campaign_approval_asset_clearance` |

`PH-CORE-BOUNDARIES.md` records this split; the migration files themselves carry it only
in comments. Several "this build" migrations alter stand-in tables (0003, 0016, 0031 on
`campaigns`/`campaign_assets`/`campaign_slot_bookings`), so the ownership table above is
what engineering must read rather than the numbering.

---

## 2. Module boundaries as they stand

### 2.1 Where separation is clean

- **PH Core seams.** Every platform dependency is an interface in `platform/`, `auth/`,
  `secrets/` or `flags/`, and only `context.ts` chooses an implementation. Routes,
  `exchange/` and `domain/` never import a `sqlite*` factory. `PH-CORE-BOUNDARIES.md`
  names each seam, its direction, its hot-path budget and the guarantees relied on.
- **The approval package.** `packages/campaign-approval` imports nothing from the API.
  Its only seam is `CampaignSource` (`src/adapter/CampaignSource.ts`), it declares the
  SQL surface it needs as a five-line `SqlDb` interface, owns its own migrations under a
  non-colliding number range, and ships contract tests for whoever writes the real
  adapter. The API mounts its routes with three host-supplied hooks (guard, approver,
  reviewer).
- **One error shape.** `http/errors.ts` is the only place HTTP errors are constructed for
  the API's own routes, and `contract.ts` in the tests fails any response with a field
  the contract does not define.
- **Contract-first types.** `packages/types` is generated from `openapi.yaml`; the admin,
  the API and the approval UI share it.
- **DSP clients.** `dsp/DspClient.ts` is a one-method interface; the three clients and the
  registry are the only files that speak each management API. `dsp/bidder.ts` isolates
  OpenRTB transport concerns (QPS spacing, timeout, byte cap).
- **Database rules in the database.** The one-live-winner index (0021), one-open-bid
  index (0026), `billing_line_items.reservation_id UNIQUE` and `auction_runs` make the
  concurrency guarantees independent of the application's own checks.
- **Configuration.** Every limit, default and endpoint is in `config.ts`; no literal
  URL or ceiling lives in a route.

### 2.2 Where responsibilities bleed

Import directions actually present (from the extracted graph):

```
routes → domain, exchange, repos, platform, db, http, auth, context
exchange → domain, repos, db, dsp, context, env, campaign-approval/poc
domain → repos, platform, db, http/errors, config, context (type)
dsp → exchange/openrtb (type), types
repos → dsp/DspClient (type), secrets, db
platform → domain/targetingValidation (type)
context → everything, plus inline SQL
deploy/firebase → apps/api/src/* and apps/dsp-mocks/src/* by relative path
apps/api/test → apps/dsp-mocks/src by relative path
```

**B1. `Context` is the universal parameter.** Thirty-nine source files import `Context`;
`domain/positions.ts` and `domain/deleteChecks.ts` take the whole context, as do every
`exchange/` module and every route. `context.ts` imports `domain/targetingSummary`
while `domain/positions.ts` imports `Context` back, so the composition root and the
domain depend on each other. There is no layer that can be unit-tested without
constructing the whole application.

**B2. SQL outside repositories.** Direct `prepared(ctx.db, …)` / `db.prepare` calls
appear in `domain/positions.ts:204` (reads `billing_line_items`),
`domain/campaignRetention.ts:39-43` (deletes across `campaign_assets`, `dsp_creatives`,
`campaign_approvals` and `campaigns`, that is across a stand-in, this build's own table
and the approval package's table in one transaction), `exchange/billing.ts:84` (insert)
and `:94` (select), `exchange/creatives.ts` (`dsp_creatives` claim/release),
`exchange/scheduler.ts` (`auction_runs`), `context.ts:99,104` (`partners` lookups
inside the composition root), `http/app.ts` (migration state), and throughout `seed/`.
Five of this build's own tables (`billing_line_items`, `dsp_creatives`, `auction_runs`,
`audience_vacd`, `variable_access`) have no repository of their own or are reached
around one.

**B3. Business rules inside route handlers.** `routes/partner/reservations.ts:47` (123
lines), `routes/partner/campaigns.ts:61` (118) and `:203` (`upload`, 57),
`routes/admin/advertiserSettings.ts:34` (125, the play-window deferral rule) and `:210`
(112, the billing-unit change refusal and the slot write) are the only places those
rules exist. `routes/admin/bookingSchedule.ts:88` (`bookingSchedule`, 107 lines) and
`routes/admin/advertisers.ts:13` (`listAdvertisers`) are reporting aggregations that
happen to live in route files, and `bookingSchedule.ts:24` imports `lineItems` from
`exchange/billing` to do it.

**B4. Route-to-route and feature-to-feature imports.** `routes/partner/reservations.ts:37`
imports `partnerAdvertiser` from `routes/partner/campaigns.ts`. In the admin,
`features/dsp-integration/api.ts:8` re-exports hooks from `features/display-types/api.ts`;
`features/display-types/panels/PlaylistSettingsPanel.tsx:34-35` imports from
`features/playlist-management/`, which imports `features/display-types/model` and
`panels/SlotAssignment` back, so the two features form a cycle.

**B5. Domain knows HTTP.** `domain/targetingValidation.ts:8` imports `http/errors` and
`throwIfRejected` chooses between 400 and 422. Everything else in `domain/` returns
detail lists or `Refusal` objects and lets the route pick the status; this file is the
exception.

**B6. Interface and stand-in in one file.** Each `platform/*.ts` holds the interface
engineering must implement and the SQLite stand-in engineering must delete. Deleting the
stand-in means editing the file that defines the contract. `DisplayTypeSource.ts:65`
also carries a read-path data migration (`migrateZonedSlots`) that belongs to the
stand-in, not the seam.

**B7. Deal locking lives in two places.** A buyers list's term is locked by
`exchange/auction.ts` after a clearing bid and by `routes/partner/reservations.ts` after
a reserve-price commitment, each building the `LockedWin` literal itself. The
"one winner per window" outcome then depends on `BuyersListRepo.lockWin` being
idempotent, which it is, but the rule has no single home.

**B8. Play-window length change is split four ways.** The deferral is decided in the
advertiser-settings route, stored in `CompanySettingsRepo` as two pending fields,
promoted in `exchange/scheduler.ts` (`promotePendingPlayWindowIfDue`), and the
commitments that hold it back are computed in `domain/positions.ts`.

**B9. Presentation data in the shared catalog.** `catalog.ts` `PROVIDERS` carries icons,
colours, blurbs and placeholders next to the `secret` flags that `PartnerRepo` uses to
decide what is encrypted. `dsp/amazonDsp.ts:11` (`REGION_OF`) maps the UI's option
labels ("Europe (EU)") to API region codes, so the DSP client depends on display text.

**B10. Duplicated definitions.** `Check`/`CheckName` are declared in
`domain/assetChecks.ts:19` and `packages/campaign-approval/src/types.ts:16`;
`Condition` in `domain/targetingSummary.ts:5` and `domain/targetingValidation.ts:11`;
the provider key union in `types` (`Provider`), `config.ts:77`, `dsp-mocks/src/state.ts`
(`DspKey`) and `domain/dspAudit.ts:20` (`NAME`); the IAB code table in `catalog.ts` and
`dsp-mocks/src/bidder.ts`; `effectiveLists`/`isBlocked` in `domain/lists.ts` and again
in `apps/admin/src/features/display-types/model.ts`.

**B11. Deploy and tests reach into source.** `deploy/firebase/functions/src/host.ts:36-44`
imports `config`, `context`, `http/app`, `rateLimit`, `seed`, `scheduler`,
`campaignRetention` and the mock app by `../../../../apps/api/src/…` paths;
`apps/api/test/helpers.ts:13` imports `../../dsp-mocks/src/app`. Neither `@ph-dsp/api`
nor `@ph-dsp/dsp-mocks` declares package exports, so there is no stated public surface
for hosting the API. `host.ts` also bundles CORS, per-IP rate limiting, secrets
bootstrap, persistence (`chunkedStore`) and request-driven scheduling in one 270-line
file.

**B12. Non-product code inside the product folder.** `scripts/sync-board-docs.mjs` and
`scripts/board-tickets.mjs` talk to the backlog board's Firestore (hard-coding the
project id and web API key at lines 30-31), `.claude/skills/ph-designer/` is a copy of a
design skill, `prototype/` is a build output and `prototype-reference/` is a retired
prototype with its own lockfile. None of it is what engineering integrates, but all of
it sits beside what is.

**B13. The admin's `api/queries.ts` is half typed.** Four queries are `unknown` and the
pages re-type them; `AdvertisersPage`, `BookingSchedulePage`, `PlaylistManagementPage`,
`BuyersListModal` and `BuyersListsTable` call `api()` directly rather than through a
feature `api.ts`, so the admin has two conventions for talking to the API.

---

## 3. The seams that need the clearest boundaries

### 3.1 Billing

**Where billing lives today**

| Concern | Location |
|---|---|
| The formula (expected seconds, realised VAC-d, amount) and the write to `billing_line_items` | `exchange/billing.ts` `runBilling` (one function: query, compute, persist) |
| "What can be billed now" | `repos/ReservationRepo.ts:114` `billable()` — a reservation query that knows the billing table |
| "Has this window been billed" | `domain/positions.ts:204` `slotWindowCommitments` — raw SQL on `billing_line_items` |
| Billed revenue on the booking schedule | `routes/admin/bookingSchedule.ts` imports `lineItems` and folds `amount` into `billedRevenue` |
| Play-window length (the billing unit) | `catalog.ts` `billingUnitHoursOf` (shared with the UI), `domain/positions.ts` `windowHoursOf`/`windowMs`, `CompanySettings.playWindowHours` |
| Billing-unit change refusal | `routes/admin/advertiserSettings.ts:210` |
| Floors and multipliers | `domain/pricing.ts`, `exchange/enforcement.ts` `floorFor`, `CompanySettingsRepo` |
| Inputs from PH Core | `PlaybackSource.totals`, `AudienceSource.forSlot` (via `assumedViewsPerWindow`), `DisplaySource.summaryByDisplayType`, `rotationSizeOf` |
| Engagement fee (`interactiveCpe`) | Stored and quoted (`positionView.pricing.costPerEngagement`), **never billed**: there is no engagement count seam. `PH-CORE-BOUNDARIES.md` lists this as open. |
| Trigger | `exchange/scheduler.ts` every tick; `billingCli.ts` for inspection; no API, no UI |

**Boundary problems**

- Billing has no module of its own. The one table is written by `exchange/billing.ts`,
  read by `ReservationRepo`, `domain/positions.ts` and a route. Any change to the line
  item shape touches four folders.
- The formula is not separable from its inputs: `runBilling` fetches from four seams,
  computes and inserts in one loop. There is no pure `computeLineItem(inputs)` that a
  finance reviewer or a Postgres port could test alone.
- `billable()` on the reservation repository encodes billing's idempotency rule
  (`NOT EXISTS … billing_line_items`). That belongs to billing.
- Billing and the booking schedule's `bookedRevenue` (assumed views × clearing CPM)
  compute revenue with two different bases in two different places; nothing names the
  difference between "booked" and "billed" revenue except the schedule's column labels.
- The engagement fee is priced but unbillable, and that gap is visible only in a
  document, not in code (no `EngagementSource` interface, no failing test, no TODO in
  `billing.ts`).
- The currency is a single company value; `auction.ts` rejects a bid in another
  currency. Billing therefore assumes one currency per instance, which is fine for the
  POC but is an implicit constraint the integration must inherit knowingly.

**What a clean boundary looks like:** one `billing/` module owning the table
(`BillingLineItemRepo` with `billable`, `insert`, `list`, `isBilled`), a pure
`computeLineItem`, the runner, the CLI, and an explicit `EngagementSource` seam (even if
its POC implementation returns zero) so the unbilled fee is a visible stub. Reporting
reads billed amounts through that repository only.

### 3.2 External DSP contracts: DV360, Amazon Ads, The Trade Desk, and OpenRTB

**Where provider knowledge lives today** (seven places):

| Knowledge | Location |
|---|---|
| Connect and pull advertisers (management APIs) | `dsp/googleDv360.ts`, `dsp/amazonDsp.ts`, `dsp/theTradeDesk.ts`, `dsp/registry.ts` |
| Endpoints per provider, bid URL and creative base per provider | `config.ts` (`dsp`, `bidders`) with its own literal provider union |
| Credential schema, labels, secret flags, region options | `packages/types/src/catalog.ts` `PROVIDERS` |
| Provider-specific credential rules (Amazon region fixed once connected) and bidder tuning | `domain/partnerInput.ts` |
| Provider-specific creative audit parsing (DV360 `reviewStatus`, TTD `approvedBy`, Amazon `moderationStatus`) | `domain/dspAudit.ts` |
| Provider display names | `domain/dspAudit.ts` `NAME`, `catalog.ts` labels, `seed/seed.ts`, `dsp-mocks/page.ts` |
| OpenRTB request shape | `exchange/openrtb.ts` (also resolves lists, audience and exchange settings through `ctx`) |
| OpenRTB response interpretation (currency default, `impid`, seat, `adomain` → advertiser, `crid`, `iurl`, `ext.creativeAudit`) | `exchange/auction.ts` `recordDspBid`, `exchange/creatives.ts` `queueCreative` |
| Transport limits | `dsp/bidder.ts` |
| Mirrors of all three APIs and bidders | `apps/dsp-mocks` (own `DspKey`, own IAB table) |

**Boundary problems**

- There is no `DspProvider` abstraction that says, for one provider, "here is how you
  connect, where you bid, where creatives may be fetched from, how your audit is read,
  and what credentials you need". Adding a fourth DSP means editing `catalog.ts`,
  `config.ts`, `dsp/registry.ts`, a new client, `domain/dspAudit.ts`, the mock service,
  and the `Provider` enum in `openapi.yaml`.
- The `Provider` union is re-declared in `config.ts:77` and `dsp-mocks/src/state.ts`
  instead of imported. A typo in one is a runtime `undefined` (`ctx.config.bidders[provider]`
  is indexed with a cast in `auction.ts` and `creatives.ts`).
- `bid.ext.creativeAudit` is a POC-only OpenRTB extension. `dspAudit.ts` says the real
  integration reads the DSP's creative API instead, but nothing in `dsp/` has a slot for
  that call; the audit parser will need a new home when that happens.
- The `Seat` type is declared in `dsp/DspClient.ts` and persisted by `repos/PartnerRepo.ts`
  (re-exported at `PartnerRepo.ts:7-8`), so the storage layer depends on a DSP wire type.
- `openrtb.ts` is generic OpenRTB but takes `Context`; the request builder cannot be
  exercised without the whole application.
- Inbound partner identity (`auth/partnerAuth.ts`) is correctly isolated. The per-partner
  rate limiter is in-process by design and documented as gateway-replaceable.

**What a clean boundary looks like:** `dsp/providers/<provider>/` bundling client,
credential schema, audit parser and endpoint defaults behind one `DspProvider` interface;
`dsp/openrtb/` holding request building and response parsing with plain inputs;
`config.ts` and the mocks importing `Provider` from the types package; `PartnerRecord`
owning its own `Advertiser` type rather than the wire `Seat`.

### 3.3 Cross-instance federation identifiers

**What exists**

| Artefact | Location | State |
|---|---|---|
| `exchange.platform_instance_id`, `reservations.source_instance_id` | migration `0022` | Columns exist, nullable, nothing reads or writes them (`ExchangeRepo` `Row` at `ExchangeRepo.ts:12` and `ReservationRepo` `Row` at `ReservationRepo.ts:27` omit them) |
| `PlatformInstance { instanceId, domain }` | `packages/types/src/analyticsEvent.ts:74` | Type only; no code constructs one |
| `CanonicalEventV1.sourceInstanceId` | `analyticsEvent.ts:57` | Reserved field on an event nothing produces; validated by `canonicalEventErrors` |
| Test | `apps/api/test/analytics-reservation.test.ts` | Asserts the columns exist and stay null |
| Spec | `REQUIREMENTS.md` §9.3, §9.4, Q56 (deferred); `PH-CORE-BOUNDARIES.md` "Reserved for later releases" | Decision recorded: identity maps to the instance's stable domain, is not the `sellers.json` seller ID, and the agent-to-agent surface is not REST |

**Boundary problems**

- The spec says the instance identity is held "alongside, never inside" the
  seller-of-record details. In storage it is a column on the same `exchange` row as
  `seller_id`, `domain` and `organisation`, and the only type that models it lives in the
  analytics file. Nothing in the API's model distinguishes "who we are to the ad
  ecosystem" (`ExchangeInput.sellerId`) from "who we are to other PH instances".
- `reservations.source_instance_id` is a column on a table whose TypeScript record does
  not know it. The first code to set it will have to widen `ReservationRecord`, and
  every `insert` call site (`auction.ts` twice, `reservations.ts`, `seed/*`) will change.
- There is no `identity/` module. When federation arrives, the natural place to put
  "resolve an instance from a domain" or "stamp an inbound booking with its source" does
  not exist, and the pieces will land in `exchange/` or a route by default.
- **A second identity seam worth naming:** `advertiserSlug(name)` (`catalog.ts`) is the
  advertiser's identity across the whole build. It is a normalised seat **name**, used as
  the key for advertiser settings, campaigns, reservations, billing line items, buyers
  lists (`brandEntity`) and the Partner API's `advertiserId`. Two DSPs spelling the same
  brand differently produce two advertisers; a rename on the DSP side orphans settings
  and history. In a federated future this is the identifier two instances would have to
  agree on, so it needs a single owning module and an explicit decision, not a helper in
  a catalog file.

**What a clean boundary looks like:** an `identity/` module owning `PlatformInstance`
(read through its own repository, even while it maps to the same row), the advertiser
identity function, and, later, source-instance stamping; `ReservationRecord` gaining an
optional `sourceInstanceId` now, so the write path is typed before anything sets it.

---

## 4. Naming

### 4.1 Where it matches the domain language

Positions, play windows, billing unit, reserve price, effective floor, clearing CPM,
hand-off, enforcement, buyers list, invited buyer, delivery term, locked win, seller of
record, `sellers.json`, DSP integration switch, Test mode / Live, Approved / Awaiting
approval / Rejected, safe reuse, pending edit. File names are nouns for records and
verbs for operations (`handoff.ts`, `enforcement.ts`, `auction.ts`). The `Repo` (this
build's records) versus `Source` (PH Core stand-ins) suffix convention is deliberate and
carries real information. Refusal codes (`below_floor`, `not_invited`,
`targeting_not_supported`) read as the spec does. The `sqlite*` / `poc*` / `local*` /
`env*` / `static*` prefixes mark stand-ins, although five prefixes for one idea is four
too many.

### 4.2 Overloaded or misleading names

| Name | Meanings in use | Effect |
|---|---|---|
| `exchange` | `ExchangeRepo` and `domain/exchange.ts` (seller of record + switch, spec "Exchange settings"); the `exchange/` folder (auction, billing, scheduler, creatives, hand-off); `routes/admin/exchange.ts` | Two unrelated things share the word; `ctx.exchange` is settings, `exchange/` is machinery |
| `company` | `CompanySettingsRepo`, `CompanySettings`, table `company_advertiser_settings`, API type `AdvertiserSettings`, route `/advertiser-settings`, UI `AdvertiserSettings.tsx` | One record under three names |
| `campaign` | An HQ campaign (PH Core); an advertiser's content package (`POST /v1/campaigns`, spec calls it a content package); a DSP creative auto-wrapped as a campaign (`c_dsp_<hash>`); `maxCampaigns` and `campaignCount`, which count **layers** (default + targeted versions) of one submission | The word means four things; `campaignCount` on a row that is one campaign is confusing |
| `seat` | `PartnerRecord.seats` (the DSP's **advertisers**); `bidder.seatIds` (OpenRTB buyer seats); `InvitedBuyer.dspSeatId` (advertiser id on the DSP) | The mock service models `Seat` and `MockAdvertiser` separately, which is correct; the API conflates them |
| `partner` | A DSP (`PartnerRepo`, `partnerId`, "Partner API"); DV360's own "Partner ID" credential; TTD's `ttdPartnerId`; the spec's "tier-2 partners" | Inherent collision with Google's term; `PartnerRecord.credsPublic.partnerId` is Google's, `PartnerRecord.id` is ours |
| `reservation` / `reservations` | The table and `ReservationRecord` hold **bids** too (`type: 'reserve' \| 'bid'`, statuses `won`/`lost`) | A "reservation" that was outbid is a misnomer; `ReservationRepo.billable` bills wins |
| `phExtensions` / `ph_extensions` | The sell-side fields on a display type: slots, venue, reserve price default, billing unit default, max campaigns default | The name says "extensions belonging to PH", not what they are. The spec's own heading is "Sell side" (§8) |
| `assignedOf` / `assignmentOf` / `assignedToSlot` / `AssignedTo` / `Assigned` | Four near-identical names for: the stored choice, the derived enum (`rtb`/`whitelist_only`/`deal`/`reserved`), the write shape, and the API DTO | Easy to pick the wrong one |
| `pricingType` vs `TargetingMode` vs "campaign type" | `'default' \| 'localised' \| 'personalised' \| 'interactive'` on a layer; `'localised' \| 'personalised' \| 'interactive'` on a slot; spec §4 "Campaign types for pricing" | `default` is a layer name, not a pricing type; `enforcement.checkTargeting` translates one to the other |
| `windowMs` / `windowHoursOf` / `billingUnitHours` / `playWindowHours` | The same quantity at four layers | Correct, but the reader has to learn that they are one thing |
| `internal` / `advertiser` / `retail` | Slot owner keys whose labels are Headquarters / Advertiser / Stores | Key and label disagree twice; fixed by the contract now |
| `Flags` / `Features` / the "switch" | Build flag (`dspIntegration`); runtime switch (`exchange.enabled`); `GET /admin/v1/features` returns `dspIntegration` meaning "flag AND switch" | Three gates, one field name shared by two of them |
| `Guards.flagged()` | Reads as a state; it throws 404 | Better as `requireFlag()` |
| `Context` / `ctx` | Every dependency | Not a name problem so much as a design one (B1) |

### 4.3 Abbreviations

Counted across API, types, approval and admin source (identifier occurrences):

| Abbreviation | Count | Assessment |
|---|---|---|
| `dt` (display type) | 207 | Pervasive; fine in a two-line lambda, opaque across a 381-line file |
| `def` (slot definition) | 130 | Collides with the general sense of "default" in a codebase that also has `default` layers |
| `mz` (multi-zone) | 37 (admin `model.ts`) | Not a domain word |
| `ext` (`phExtensions`) | 36 | Compounds the `phExtensions` problem |
| `crid`, `iurl`, `adomain`, `bcat`, `badv`, `schain`, `impid` | ~60 | OpenRTB spec names; correct inside `openrtb.ts` and `recordDspBid`, but `crid` also names a database column and appears in user-facing rejection reasons |
| `VAC-d` / `vacd` (`audience_vacd`) | table + comments | Industry term for visibility-adjusted contacts; never expanded in code. Fields alternate between `assumedViews`, `assumed_views_per_window`, `realisedViews` and "VAC-d" |
| `ttd`, `lwa`, `dv360` | config keys, credential keys, mock routes | Provider abbreviations spelled `google_dv360` / `googleDv360` / `dv360Routes` / "Google DSP" / "Display & Video 360" (five spellings); `TTD_BASE_URL` vs `the_trade_desk` |
| `cpe` (`interactiveCpe`) | 6 | Cost per engagement; the UI spells it out, the record does not |
| `OQ27`, `Q38`, `Q40`, `Q47` … | comments | Open-question numbers as the only explanation of a rule; meaningless outside this repo's `REQUIREMENTS.md` |
| `Q`, `T`, `C` | admin module constants | Queries, theme tokens, colours as single letters |
| `p`, `r`, `c`, `s`, `a` | thousands | `p` is a position, a partner or a playlist depending on file; `c` a campaign, a caller or a check |

Single-letter and two-letter names are dense enough in `domain/positions.ts`,
`exchange/auction.ts` and `routes/admin/advertiserSettings.ts` that the type annotations
carry all the meaning.

### 4.4 Comments as institutional memory

Almost every non-trivial block cites a date, a person, a ticket or a question number
("Rob, 20 Sep", "ticket 22 Sep", "OQ52"). For a POC being handed over this is valuable
provenance. For the integrated codebase it is noise that will be wrong the moment the
spec moves, and several rules (the `default`-counts-as-`localised` reading, the
"one retrieval per response" budget, the Monday anchor) exist **only** in comments plus
one implementation. Those should become named functions or documented invariants in the
target layout.

---

## 5. Functions doing more than one thing

Lengths are measured from the declaration to its closing brace; route handlers from
`app.<verb>` to the next handler.

| Location | Lines | What it does in one body | Natural split |
|---|---|---|---|
| `routes/partner/reservations.ts:47` POST `/reservations` | 123 | Body validation; window arithmetic; timing and auction-claim checks; deal state checks; duplicate and taken checks; four enforcement checks; insert with race handling; term locking; settling other bids; hand-off | `parseReservationRequest`, `assertWindowOpen`, `placeBid` / `reserveWindow` application services, `deals.lockTerm` |
| `routes/admin/advertiserSettings.ts:34` PUT `/advertiser-settings` | 125 (handler) | Validation; play-window deferral scheduling; save | Move deferral to a `playWindowChange` service beside the scheduler's promotion |
| `routes/admin/advertiserSettings.ts:210` PUT `/available-inventory` | 112 | Row parsing; targeting validation; assignment validation; three "same default per display type" checks; billing-unit resize refusal; write of slot extensions | `parseInventoryRows`, `validateInventoryEdit`, `assertNoResizeOfLiveWindows`, `applyInventoryEdit` |
| `routes/partner/campaigns.ts:61` POST `/campaigns` | 118 | Shape validation; slot cap and slot targeting resolution; brief validation; per-version rule validation; persistence; approval view | `parseContentPackage`, `resolveSlotPolicy`, `createContentPackage` |
| `routes/partner/campaigns.ts:203` `upload` | 57 | Multipart parsing; size-limit handling; media sniffing; automated checks; asset store write; approval `changed` | `readUpload`, `checkCreative`, `attachAsset` |
| `exchange/auction.ts:128` `clearPosition` | 118 | Skip rules; deal branch; bid-request fan-out; response walk; API-bid re-check; live and test clearing; settling; hand-off; term lock | `collectDspBids`, `recheckApiBids`, `clear`, `deals.lockTermFromClear` |
| `exchange/auction.ts` `recordDspBid` | ~40 | Response field validation; seat and advertiser mapping; enforcement; creative queueing; insert | `parseBid` (pure) then `admitBid` |
| `exchange/creatives.ts:47` `queueCreative` | 66 | URL policy; fetch budget; claim row; HTTP fetch with cap; media checks; campaign creation; asset write; DSP audit; submit or `changed`; activation; message text | `retrieveCreative`, `reviewCreative`, `DspCreativeRepo.claim/release` |
| `routes/admin/bookingSchedule.ts:88` `bookingSchedule` | 107 | Picker options; per-position window grid; booked and billed revenue per display type; per-pricing-type totals; layer and trigger classification; advertiser filter | `reporting/bookingSchedule.ts` with `windowsForPosition`, `revenueRollup`, `layersOf`/`triggersOf` already separate |
| `routes/admin/advertiserSettings.ts:79` `inventory` | 79 | Zone-of-slot resolution; per-zone slot numbering; playlist lookup; DTO assembly | `inventory/availableInventoryView.ts` |
| `domain/partnerInput.ts` `applyPartnerInput` | ~60 | Credential validation and secret merge; bidder URL policy and tuning; list link/unlink semantics; mode transition rule | `applyCredentials`, `applyBidder`, `applyLists`, `checkModeTransition` |
| `exchange/billing.ts:48` `runBilling` | ~40 | Query billable; compute; insert | `computeLineItem` (pure) + repository |
| `exchange/scheduler.ts:47` `schedulerTick` | 68 | Billing; retention; auction-run sweep; window promotion; settling; auction claim and run | Acceptable as an orchestrator once each job is its own function |
| `http/app.ts:26` `buildApp` | 101 | App construction; session hook; guards; security headers; error mapping; health probes; route registration; asset serving | `securityHeaders`, `errorHandler`, `healthRoutes`, `assetRoutes` plugins |
| `context.ts:95` `approvalParts` | ~20 | Wiring plus inline SQL plus name lookups | Lookups belong to `PartnerRepo` |
| `platform/DisplayTypeSource.ts` `toRecord` + `migrateZonedSlots` | ~35 | Row mapping plus a data migration on read | Migration belongs in a numbered migration or a stand-in-only helper |
| `deploy/firebase/functions/src/host.ts` `createHost` / `handle` | ~170 | CORS; per-IP limit; tick scheduling; boot and restore; persistence chain; request proxying | `persistence.ts`, `cors.ts`, `tick.ts`, `hostAdapter.ts` |
| `apps/admin/src/features/advertisers/AdvertisersPage.tsx:435` | 258 | Three queries; five draft states; dirty tracking; save orchestration of two PUTs; grid definition; rendering | Page = composition; move draft/save into `useInventoryDraft`, columns into `columns.ts` |
| `apps/admin/src/features/booking-schedule/BookingSchedulePage.tsx:298` | 213 | Query; range and view state; grouping; row building; grid; revenue table | Same pattern |
| `apps/admin/src/features/display-types/DisplayTypesPage.tsx:23` | 201 | Draft of the whole list; new-playlist drafts; delete flow; save sequencing | Same pattern |
| `apps/admin/src/features/playlist-management/PlaylistManagementPage.tsx:302` | 179 | Rename, delete, settings drafts, grid | Same pattern |
| `apps/admin/src/features/dsp-integration/DspPage.tsx:43` | 173 | Credentials form, bidder form, lists, connect/disconnect, mode | Same pattern |
| `apps/admin/src/features/display-types/model.ts` `normaliseSlots` | ~30 | Adopts stray slots; resizes per zone; rewrites zone caps | Dense but single-purpose; a named `adoptStraySlots` step would help |
| `seed/demo.ts:304` `seedDemoBookings` | 119 | Seed data generation across positions, campaigns, reservations, bookings, plays | Seed only; acceptable |

The approval service's `createApprovalService` (205 lines) is long because it is a
factory returning a closure-bound object; each method is short and single-purpose.

---

## 6. Proposed target layout, as a diff from what exists

Not implemented. Every PH Core seam (`platform/*` interfaces, `auth/`, `secrets/`,
`flags/`, the approval package's `CampaignSource`) keeps its name and signature; the
diff re-cuts the inside. Table names and migrations are untouched. Behaviour is
unchanged. Where a file is listed as moving, its tests move with it.

### 6.1 `apps/api/src`

```diff
 apps/api/src/
   index.ts
   env.ts
-  config.ts                         (declares its own provider union at :77)
+  config.ts                         (imports Provider from @ph-dsp/types; unchanged otherwise)
-  context.ts                        (wires everything; inline SQL at :99,104)
+  context.ts                        (wiring only; PartnerRepo gains seatName()/partnerName() so no SQL here)
+  ports.ts                          (narrow read-only slices of Context that domain and reporting take
+                                     instead of the whole object: e.g. PricingPorts, InventoryPorts)

   http/
     app.ts                          (thin: create app, register plugins)
+    securityHeaders.ts, errorHandler.ts, health.ts, assets.ts   (extracted from app.ts)
     errors.ts
     rateLimit.ts
   auth/  flags/  secrets/  db/      (unchanged; db/migrations unchanged)

   platform/
-    DisplayTypeSource.ts            (interface + sqlite stand-in + read-path migration in one file)
-    PlaylistSource.ts … ReachCountSource.ts   (same pattern, nine files)
+    DisplayTypeSource.ts            (interface only)   … one interface file per seam
+    sqlite/DisplayTypeSource.ts     (stand-in; migrateZonedSlots lives here)   … one per seam
+    sqlite/index.ts                 (the nine factories, so context.ts imports one path
+                                     and engineering deletes one folder)

   repos/
     PartnerRepo.ts                  (owns Advertiser {id,name,domain}; stops re-exporting dsp Seat)
-    CompanySettingsRepo.ts
+    AdvertiserSettingsRepo.ts       (same table; the spec's name)
     ExchangeRepo.ts                 (seller of record + switch; loses nothing)
     BuyersListRepo.ts
-    ReservationRepo.ts              (billable() knows billing_line_items)
+    ReservationRepo.ts              (billable() moves to billing/; record gains sourceInstanceId?: string | null)
+    DspCreativeRepo.ts              (dsp_creatives claim/release/lookup, from exchange/creatives.ts)
+    AuctionRunRepo.ts               (auction_runs claim/finish/release/sweep, from exchange/scheduler.ts)
+    VariableAccessRepo.ts           (variable_access, from CompanySettingsRepo)

-  domain/                           (twenty files; some take Context, one imports http)
+  inventory/                        (the sell side: what is for sale and when)
+    positions.ts                    (PositionRef, positionIdOf, the position index)  ← domain/positions.ts §1
+    visibility.ts                   (callerOf, visibilityFor, advertiserMayBuy, effectivePartnerIds) ← §2
+    playWindows.ts                  (ANCHOR, windowStartOf, windowsBetween, windowsCovering,
+                                     biddingOpensAt/ClosesAt, nextWindow, windowHoursOf/windowMs) ← §3
+    availability.ts                 (windowFacts, windowStatus)  ← §4
+    positionView.ts                 (the Position DTO)  ← §5
+    availableInventoryView.ts       ← routes/admin/advertiserSettings.ts inventory()
+    inventoryEdit.ts                (parse/validate/apply for PUT /available-inventory, incl. the
+                                     billing-unit resize refusal)  ← routes/admin/advertiserSettings.ts:210
+    slots.ts, displayTypes.ts, deleteChecks.ts   ← domain/
+  pricing/
+    floors.ts                       ← domain/pricing.ts + enforcement.floorFor
+    lists.ts                        ← domain/lists.ts
+    advertiserSettings.ts           ← domain/advertiserSettings.ts
+    playWindowChange.ts             (request deferral + promotion in ONE file)
+                                    ← routes/admin/advertiserSettings.ts:34 + scheduler.promotePendingPlayWindowIfDue
+                                      + positions.companyWindowCommitments/slotWindowCommitments
+  billing/
+    computeLineItem.ts              (pure: inputs → LineItem)  ← exchange/billing.ts
+    BillingLineItemRepo.ts          (billable(), insert(), list(), isBilled())
+                                    ← ReservationRepo.billable, billing.ts:84/:94, positions.ts:204
+    runBilling.ts                   (query → compute → insert)
+    EngagementSource.ts             (platform seam for engagement counts; POC returns 0; the
+                                     unbilled interactiveCpe becomes a visible stub)
+    billingCli.ts                   ← exchange/billingCli.ts
+  auction/                          ← exchange/ minus billing and creatives
+    runAuction.ts                   (orchestration only)
+    collectDspBids.ts               (fan-out + response walk)  ← clearPosition §bids
+    recheckApiBids.ts               ← clearPosition §apiBids
+    clearing.ts                     (clear, settlePending)
+    deals.ts                        (two-period model: auctionOpenAt, isTermLocked, lockTerm(from clear|reserve),
+                                     bookLockedTermWindow)  ← auction.ts + reservations.ts + domain/buyersLists.ts
+    enforcement.ts                  (returns Refusal; never throws)
+    handoff.ts
+    scheduler.ts                    (uses AuctionRunRepo)
+    cli.ts, tickCli.ts
+  creatives/
+    retrieval.ts                    (URL policy underBase, budget, capped fetch)  ← exchange/creatives.ts
+    review.ts                       (checks, campaign-for-crid, submit/changed, activation)
+    assetChecks.ts, media.ts        ← domain/
+  campaigns/                        (advertiser content packages)
+    contentPackage.ts               (parse + validate: default layer, targeted versions, slot policy)
+                                    ← routes/partner/campaigns.ts:61
+    upload.ts                       (readUpload, checkCreative, attachAsset)  ← :203
+    submit.ts                       ← :261
+    brief.ts, targetingValidation.ts (returns a result; the 400/422 mapping moves to the route),
+    targetingSummary.ts, variables.ts, campaignRetention.ts   ← domain/
+  reservations/
+    placeBid.ts, reserveWindow.ts   (application services)  ← routes/partner/reservations.ts:47
+    reservationRetention.ts         ← domain/
+  partners/
+    partnerInput.ts                 (credentials, bidder, lists, mode as four steps)  ← domain/partnerInput.ts
+    urlPolicy.ts                    (isPrivateHost, isPublicHttpsUrl)  ← domain/partnerInput.ts
+    partnerView.ts                  ← domain/partners.ts
+  sellerOfRecord/
+    exchange.ts                     (isComplete, isLive, validate, sellersJson, toApiExchange) ← domain/exchange.ts
+  identity/
+    platformInstance.ts             (PlatformInstance read from exchange.platform_instance_id via its own
+                                     repo method; the ONLY reader once one exists)
+    advertiserIdentity.ts           (advertiserSlug re-exported and documented as THE cross-DSP identity)
+  reporting/
+    bookingSchedule.ts              ← routes/admin/bookingSchedule.ts:88 (reads billed amounts via BillingLineItemRepo)
+    advertisersList.ts              ← routes/admin/advertisers.ts:13

   dsp/
     DspClient.ts                    (connect)
+    DspProvider.ts                  (key, label, credentialSchema, connect, bidUrl, creativeBase, parseAudit)
-    googleDv360.ts, amazonDsp.ts, theTradeDesk.ts
+    providers/googleDv360/{client,audit,credentials}.ts
+    providers/amazonDsp/{client,audit,credentials,regions}.ts   (REGION_OF keyed on a region code, not a label)
+    providers/theTradeDesk/{client,audit,credentials}.ts
-    (audit parsing)                 ← domain/dspAudit.ts, split per provider
     registry.ts                     (Record<Provider, DspProvider>)
+    openrtb/request.ts              (buildBidRequest with plain inputs, no Context)  ← exchange/openrtb.ts
+    openrtb/response.ts             (parseBid, BidResponse types; the "no cur means USD", impid, seat rules)
+    openrtb/bidder.ts               ← dsp/bidder.ts

   routes/                           (thin: parse → service → DTO; the only place HttpError is thrown)
     admin/…  partner/…  public/…    (same files; each handler ≤ ~30 lines)
   seed/  bench/  test/              (unchanged locations)
```

### 6.2 `packages/`

```diff
 packages/types/src/
   index.ts, openapi.d.ts, analyticsEvent.ts
-  catalog.ts                        (PROVIDERS carries icon/colour/blurb/placeholder; IAB codes; targeting variables)
+  catalog.ts                        (keeps keys, labels, secret flags, options, IAB codes, targeting variables)
+  ─ presentation fields (icon, colour, blurb, placeholder) → apps/admin/src/features/dsp-integration/providerPresentation.ts
 packages/campaign-approval/         (unchanged)
+  ─ apps/api imports Check/CheckName from here; domain/assetChecks.ts's copy is deleted
 apps/dsp-mocks/
+  package.json "exports": { ".": "./src/app.ts" }   so tests and deploy import @ph-dsp/dsp-mocks
+  src/state.ts imports Provider from @ph-dsp/types; src/bidder.ts imports IAB_CATEGORY_CODES
 apps/api/
+  package.json "exports": { "./context", "./http/app", "./config", "./seed", "./auction/scheduler", "./campaigns/campaignRetention" }
```

### 6.3 `apps/admin/src`

```diff
 apps/admin/src/
   api/
-    queries.ts                      (four queries typed unknown; pages re-type)
+    queries.ts                      (every query typed; the pages stop calling api() directly)
   features/
     display-types/  playlist-management/          (mutual imports today)
+    slots/                          (SlotAssignment, PlaylistCapSlotsFields, DefaultSelect, the slot/zone
+                                     helpers from display-types/model.ts)  ← breaks the cycle
-    display-types/model.ts effectiveLists/isBlocked          (duplicate of the API rule)
+    (use the API's own lists on the position/partner records)
-    dsp-integration/api.ts re-exporting display-types/api hooks
+    api/queries.ts owns the shared hooks; each feature api.ts owns only its own writes
     advertisers/  booking-schedule/  campaign-status/  dsp-integration/   (pages become composition;
                                     draft/save logic into hooks, column definitions into columns.ts)
```

### 6.4 `deploy/`, `scripts/`, and non-product content

```diff
 deploy/firebase/functions/src/
-  host.ts                           (270 lines; deep relative imports into apps/api/src and apps/dsp-mocks/src)
+  host.ts                           (request adapter only, importing @ph-dsp/api and @ph-dsp/dsp-mocks)
+  persistence.ts                    (BlobStore, DocStore, chunkedStore)
+  tick.ts                           (request-driven scheduling)
+  cors.ts
   index.ts, ../local-server.ts, ../build.mjs   (unchanged)
 deploy/kubernetes/                  (unchanged)

-dsp-integration/scripts/sync-board-docs.mjs
-dsp-integration/scripts/board-tickets.mjs
+<repo>/backlog-tracker/scripts/ (or .github/scripts/)   — board tooling, not product; the workflows
+                                  that call them already run from the repo root
 dsp-integration/scripts/rebuild-prototype.sh   (stays: it builds this folder)
-dsp-integration/.claude/skills/ph-designer/    (duplicate copy)
+(reference the repo-level skill)
-dsp-integration/docs/dsp-integration/          (path doubles the folder name)
+dsp-integration/docs/                          (same files, one level up)
 dsp-integration/prototype/                     (stays while the hosted demo needs it; flagged as an artefact)
 dsp-integration/prototype-reference/           (archive to a tag when engineering no longer needs the UI reference)
```

### 6.5 Boundary rules the layout is meant to make enforceable

1. `routes/` is the only layer that imports `http/errors`, reads `req`, or knows a status
   code. Everything below returns results (`{ errors }`, `Refusal | null`, a record).
2. Only `repos/`, `platform/sqlite/`, `billing/BillingLineItemRepo.ts`, `db/` and `seed/`
   contain SQL. A search for `prepared(` or `.prepare(` outside those paths is a defect.
3. `inventory/`, `pricing/`, `billing/computeLineItem.ts`, `dsp/openrtb/`,
   `sellerOfRecord/` and `identity/` take plain arguments or a narrow port from
   `ports.ts`, never `Context`. `auction/`, `creatives/`, `campaigns/`, `reservations/`
   and `reporting/` may take `Context` because they orchestrate.
4. Provider-specific code lives under `dsp/providers/<provider>/` and nowhere else;
   `Provider` is imported from `@ph-dsp/types` everywhere it is used.
5. `platform/*.ts` are interfaces only; `platform/sqlite/` is the folder engineering
   deletes.
6. Nothing outside `identity/` reads `platform_instance_id` or `source_instance_id`, and
   nothing outside `identity/` calls `advertiserSlug` directly.
7. Anything a route, a scheduler job and a CLI all need (billing, the auction, retention,
   play-window promotion) is a function in a module, called from all three, never
   written in the handler.

### 6.6 What this deliberately does not propose

- No change to `openapi.yaml`, the Partner API, the Admin API, `sellers.json` or the
  OpenRTB shapes.
- No change to table names or migrations; the `reservations` table keeps its name even
  though the record type would be better called a commitment, because the rename is
  cheap in TypeScript and expensive in SQL.
- No move of `billingUnitHoursOf` / `reservePriceOf` / `maxCampaignsOf` out of
  `packages/types`: the admin needs the same inheritance rule for its "override wins"
  cells, and sharing it is correct.
- No change to the approval package, beyond the API importing its `Check` type instead
  of duplicating it.
- No behavioural change anywhere: every finding above is about where code sits and what
  it is called, not what it does.
