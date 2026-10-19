# Pre-handover review — 18 Oct 2026

The last review before the engineering team ports this build into PH Core,
which runs on AWS (EKS and Docker in the client's own VPC). Rob asked for:

- a full review of the code base;
- clean separation between components, and code commented clearly enough
  for an engineer new to it;
- performance, stability and security tests for a client's VPC on Kubernetes;
- no radical changes, and no change to any feature or function.

This document records:

- how the build separates;
- what this review found and fixed;
- what it measured;
- what it deliberately left for engineering;
- the order in which to port it.

It builds on the earlier reviews, whose findings all still stand:

- [SECURITY-PERFORMANCE.md](./SECURITY-PERFORMANCE.md) (23–24 Sep)
- [SCALE-15000-EKS.md](./SCALE-15000-EKS.md) (24 Sep, 1 Oct)
- [ADMIN-API-PERFORMANCE.md](./ADMIN-API-PERFORMANCE.md) (3 Oct)

The seams are described in [PH-CORE-BOUNDARIES.md](./PH-CORE-BOUNDARIES.md).

**Nothing visible to a legitimate user, partner or player changed.** No
screen, copy, endpoint or response shape changed. The exceptions:

- **Refusals that only an abusive or misconfigured caller meets.** For
  example, a display id over 200 characters is now refused, and malformed
  `PARTNER_TOKENS` now stops start-up.
- **Two crash-path fallbacks in the admin UI** (below).
- **One contract correction.** `openapi.yaml` documented the "add a direct
  advertiser" call at a path the API has never served.

Every code fix has a regression test in `apps/api/test/handover-review.test.ts`
or `apps/admin/test/handover-review.test.tsx`. The API tests were run
against the code before this review, and each one fails there, apart from
the rate-limiter test, which pins the answers the fix must not change.

Three fixes are verified another way:

- the shutdown drain: SIGTERM on the container bundle;
- the content-hash index: `EXPLAIN QUERY PLAN` shows the lookup using it;
- the audit-log `LIMIT`: the existing audit-log tests.

## 1. How the build separates

| Component | What it is | On integration |
|---|---|---|
| `apps/api` | The exchange: Fastify API, auction, real-time bidding, billing and scheduled work. Layers: `routes/` → `domain/` → `exchange/` → `repos/` (this build's records) and `platform/` (PH Core stand-ins). `context.ts` is the only file that chooses an implementation. | Ported. Each `platform/` stand-in is replaced by an adapter against the real service. |
| `packages/campaign-approval` | Drop-in approval module with its own adapter seam, service, routes, UI and migrations (0100+). Imports nothing from `apps/*`. | Ported as a module ([CAMPAIGN-APPROVAL-INTEGRATION.md](../CAMPAIGN-APPROVAL-INTEGRATION.md)). |
| `packages/types` | Types generated from `openapi.yaml` (`npm run gen:types`), plus shared catalogues (providers, targeting variables, IAB taxonomy). | Ported. Regenerate after any contract change. |
| `apps/admin` | React admin UI, iframed into HQ Admin. Imports only `@ph-dsp/types` and the approval UI, never `apps/api`. | Ported. `src/demo/`, `public/demo/`, `scripts/capture-demo.mjs` and `features/campaign-status/` are demo or stand-in code to delete (§5). |
| `apps/dsp-mocks` | Mock DV360, Amazon Ads and The Trade Desk, for tests and development. No production code imports it; only the hosted demo's host does. | Not deployed. |
| `deploy/kubernetes` | Image and manifests for a client's EKS ([README](../../../deploy/kubernetes/README.md)). | The platform team builds and applies it. |
| `deploy/firebase`, `prototype/` | The public hosted demo. | Not part of the product: delete. |
| `scripts/` | Board and E2E tooling for this repository. | Not part of the product. |

**Checked and clean**:

- No SQL outside `platform/`, `repos/`, `db/` and the seeders. `test/sql-portability.test.ts` guards this.
- No other file constructs a stand-in.
- No package import runs the wrong way, and there is no production import of test or mock code.

**Where the seams still leak.** Each item below was left as it is because
fixing it is a refactor, not a review fix. Each is item 1 of the porting
checklist (§5).

- **The SQLite handle is on `Context` (`ctx.db`).** Routes, the exchange and
  the domain pass it directly to the transaction lock (`tx`, `gate`,
  `onFree` in `db/db.ts`), at about two dozen call sites in 16 files.
  `isUniqueViolation` is checked in `exchange/auction.ts`, `handoff.ts`,
  `billing/lockedTerm.ts` and `routes/partner/reservations.ts`. A Postgres
  adapter therefore starts by turning `ctx.db` into a transaction port.
- **Some values live in the SQLite implementation files** that layers above
  import: `TAKEN` (`repos/ReservationRepo.ts`), `mintDealId`,
  `DEFAULT_PAGE`/`MAX_PAGE`, `DEFAULT_ADVERTISER_SETTING` and `mimeOf`.
  When each seam is split into an interface file and an implementation
  file, these move to the interface.
- **The approval adapter writes the stand-in tables.**
  `packages/campaign-approval/src/adapter/pocCampaignSource.ts` writes
  `campaigns` and `campaign_assets`. That is the second facet of the one
  campaign source; replace both facets together.
- **`SessionSource.current()` takes no request**, so a real per-user
  session cannot implement it as written. Make it `current(req)` when
  wiring HQ Admin's session.
- **DSP-specific branching outside the provider modules.**
  `dsp/dealTerms.ts` switches on the provider. It belongs in each
  `dsp/<provider>.ts`.
- **Three runtime import cycles**, harmless today:
  - `domain/positions.ts` → `operatingGate.ts` → `dailyCapacity.ts` → `positions.ts`
  - `exchange/enforcement.ts` ↔ `exchange/openrtb.ts`
  - in the admin UI, `DspIntegrationLayout.tsx` ↔ `DspList.tsx`

  Break them when those files are next touched.

## 2. What this review fixed

### Security

| Finding (verified before fixing) | Fix |
|---|---|
| **A production pod on an empty volume came up as the demo retailer.** It was seeded with "Demo Retail Group", two DSPs with placeholder credentials, campaigns and bookings, and **DSP integration switched on**. So `sellers.json` published a false seller on the client's domain, and a real `PARTNER_TOKENS` entry for `p_google` resolved to the demo DSP and its inventory. The K8s README said the opposite. | With `NODE_ENV=production`, nothing is seeded unless `PH_SEED_DEMO=true` (`apps/api/src/index.ts`). A real instance starts empty and switched off. The hosted demo seeds through its own host, so it is unaffected. Verified on the container bundle (§3). |
| **A percent-encoded admin path skipped the session and scope check and the SSP audit log.** With the help-desk role, `GET /api/%61dmin/v1/display-types` answered 200 where the plain path answered 403. `PUT /api/admin/v1/%65xchange` changed the exchange settings and wrote nothing to the audit log. Today that means unaudited changes; on integration it would have been unauthenticated access. | The hooks decide on the route the router matched (`routePathOf` in `http/app.ts`): the session check, `isAuditedWrite` and `no-store`. |
| **Outbound fetches followed redirects past the private-address check.** A bidder answering 307 had the bid request (a POST, with its body) re-sent to wherever `Location` pointed, including loopback. A creative URL under the DSP's host could 302 anywhere. | Bidder: `redirect: 'error'`, so a redirect counts as no bid. Creative fetch: a redirect is followed only while each hop stays under that DSP's creative host, at most 3 hops, within one 10 s budget (`fetchOwnedCreative`). |
| **IPv6 forms that wrap a private IPv4 address passed `isPublicHttpsUrl`**: NAT64 `64:ff9b::a00:5`, translated `::ffff:0:a00:5`, compatible `::a00:1`, multicast. | The address is fully parsed and every embedded-IPv4 form is checked (`privateIpv6` in `domain/partnerInput.ts`). |
| **`GET /assets/:file` read the whole file into memory on every download.** The route is public. 8 slow clients on a 150 MB creative added 1.1 GB to a pod limited to 2 GiB. | Streamed from disk with `Content-Length` (`AssetStore.open`, optional on the seam). |
| **Unbounded memory from the Player API.** Its rate limiter is keyed on the caller's `displayId` before the display is looked up, and never forgot a key: 400 unknown 900 KB ids kept 381 MB. | `displayId` is capped at 200 characters. The limiter drops buckets that have refilled, which changes no answer (a full bucket behaves exactly like a new one). |
| **Configuration that silently switched a limit off.** `PARTNER_RATE_PER_SECOND=fifty` became NaN, and a NaN bucket let every request through. `PARTNER_TOKENS` accepted an array, a bare string or numeric partner ids. | A rate setting that isn't a positive number falls back to the default. `PARTNER_TOKENS` must be an object of non-empty strings, otherwise the process stops at start; the error never echoes a token. |
| **One partner could tell whether another partner's advertiser has deals**, from which of two errors a `dealId` produced. | The deal check runs only for one of the caller's own advertisers. |
| **A slow upload could hold an upload slot for ever.** Fastify's default `requestTimeout` is 0, and there was no multipart part or field limit. | `requestTimeout` is 15 minutes (a 200 MB creative at under 2 Mbit/s). Uploads are limited to 12 parts and 10 fields. |
| **Network policy and the internal load balancer.** EKS custom networking's `100.64.0.0/10` was not excluded from egress. The internal ALB took any address that can reach the VPC. | `100.64.0.0/10` is added to the egress exceptions. The internal ALB gets `inbound-cidrs`. Comments say to narrow both, and to check that the cluster enforces NetworkPolicy at all. |
| **Creative hosts were the mock service's only.** Against real DSPs, no creative could ever be retrieved for review. | `DV360_CREATIVE_BASE`, `AMAZON_CREATIVE_BASE` and `TTD_CREATIVE_BASE`. Unset, the behaviour is as before. |

### Stability

| Finding | Fix |
|---|---|
| **A failed `COMMIT` left the connection inside the transaction.** A full disk is the realistic trigger. Every later `tx()` then threw, and autocommit writes silently joined a transaction that was never committed. A rollback that SQLite had already done also replaced the real error with "no transaction is active". | `COMMIT` failures roll back and rethrow. The rollback tolerates a transaction SQLite already ended (`db/db.ts`). |
| **Shutdown cut a running auction or billing tick mid-way.** The comment said it finished; it did not. | SIGTERM stops the timers, drains requests, lets a running tick finish for up to 20 s (inside the 30 s grace), then closes the database (`index.ts`, `exchange/scheduler.ts`). |

### Performance

| Finding | Fix |
|---|---|
| **Regression from the operating-hours gate (16 Oct, `a562824`).** Every availability check, bid request, bid placed, auction position and real-time impression read every display of the type and every store. This undid the 24 Sep "counts, never the rows" fix. | The hour groups are cached per display type and zone for one second, the same pattern as the display counts. Displays and stores change only through the platform, and a display type saved with a new zone is seen at once (`positionHourGroups` in `domain/operatingGate.ts`). Available Inventory uses the same groups. Measured in §3. |
| **Every real-time fill and every hand-off read the whole creative file** (videos up to 200 MB) to run the format checks again. | A stored asset never changes (`put` names each file afresh), so its media facts are read once per file. The cache is LRU and holds 2,000 files. The checks themselves still run every time (`storedMediaOf` in `domain/media.ts`). |
| **The bidder queued real-time requests past their deadline.** A DSP slower than the impression rate built an unbounded backlog. 495 requests were sent after their impression had closed in a 5 s burst. | A real-time request whose QPS turn falls after its tmax deadline is not sent. Outcomes are identical, and the deal auction is untouched. |
| **The rejected-creative block check scanned every campaign asset**, per bid on the real-time path (1.9 ms at 50,000 assets). | Migration `0076`: an index on `campaign_assets.content_hash`. |
| **The SSP audit-log query wrote `LIMIT` into its SQL**, so each page size became another statement cached for the life of the process. | `LIMIT ?`. |

### Admin UI

| Finding | Fix |
|---|---|
| **A non-JSON error response broke the API client.** An ALB 502 page, a plain-text 429, or a gateway's `{"message": …}` threw `SyntaxError`/`TypeError`, losing the HTTP status. One screen showed "Unexpected token '<'" to the user. | Anything that isn't the contract's error shape becomes an `ApiRequestError` with its status. Contract errors behave exactly as before (`src/api/client.ts`). |
| **No error boundary.** A page that threw while rendering replaced the whole iframe, nav included, with React Router's default page and the raw stack trace, in production too. | A route error element (`src/shared/RouteError.tsx`, built to the ph-designer skill). The failing page alone is replaced inside the shell; a failing shell shows the same message in a plain frame. Only the crash path renders it. |

### Contract, configuration and documentation

- **`openapi.yaml`**:
  - `addDirectAdvertiser` was documented as `POST /admin/v1/advertisers`. The API, the UI and REQUIREMENTS have always used `POST /admin/v1/advertisers/direct`. The contract test validated against the wrong path, so nothing noticed. The contract now matches.
  - `GET /admin/v1/reports/unsold` was missing; it is now documented.
  - Types regenerated. Both endpoints are contract-tested.
  - Every served route was diffed against the contract. Apart from the two above, nothing is undocumented.
- **Configuration**:
  - `.env.example` now lists every variable the API reads.
  - The K8s Secret example carries `PH_PLAYER_TOKEN`; without it, production answers 401 to every player.
  - The ConfigMap documents the rest.
- **`esbuild`**, which both deploy bundles import, is now a declared root dev dependency. It had been installed only through `tsx` and `vite`, so a dependency bump could have broken the Docker build.
- **Contradictions corrected**:
  - The K8s README said the repository layer was synchronous and that a real instance starts switched off.
  - The project README said a Postgres adapter is "wired in `context.ts` alone", that the uncached window is UTC with no admin screen, and that Website/App touch points can't carry advertising. It also described a Campaign status tab that no longer exists, and an auction schedule.
  - `PH-CORE-BOUNDARIES.md` had the wrong signatures for `StoreSource`, `AudienceSource` and `PlaybackSource`. Its table-ownership list stopped at 0039; it now covers every migration.
  - `CAMPAIGN-APPROVAL-INTEGRATION.md` gave an incomplete migration list and store interface, and claimed the stand-in table had no other importer.
  - `SCALE-15000-EKS.md` claimed routes need no change for an adapter.
- **Comments**:
  - Header comments added where files had none.
  - A step-by-step header added on each of the ten most complex functions: `vetBid`, `clearPosition`, `POST /v1/reservations`, the buyers-list `parse`, `applyPartnerInput`, `PUT …/extensions`, `scopeAndVolumeOf`, `validateRules`, and the approval service's `apply`.

## 3. Measured

All measurements are from this sandbox (4 vCPU, one Node process), comparing
the commit before this review with this branch on the same machine,
interleaved. Compare rows with each other, not with other reviews.

**Partner and admin API, 15,000 displays** (shape C: 15 display types ×
1,000 displays, 1,000 stores; `npm run bench -- --scale=15
--displays-per-type=1000 --stores=1000 --seconds=2 --admin`):

| Request (req/s at 32 clients; p50) | Before (two runs) | After (two runs) |
|---|---|---|
| `GET /v1/inventory?status=available` (1 year) | 16 / 16 (p50 5.0 s) | **144 / 143** (p50 0.2 s) |
| `POST /v1/inventory/forecast` (30 days) | 448 / 464 (p50 69 ms) | **3,056 / 2,352** (p50 10 ms) |
| `POST /v1/reservations` (a bid) | 279 / 288 (p50 122 ms) | **603 / 603** (p50 37 ms) |
| `GET /v1/inventory/{id}` | 2,784 / 3,136 | **5,424 / 4,368** |
| `GET /admin/v1/available-inventory` | 48 / 48 (p50 0.85 s) | **352 / 320** (p50 87 ms) |
| Auction, 61 positions | 553 / 556 ms | **262 / 294 ms** |
| `GET /v1/inventory` (page of 50), availability, targeting attributes, booking schedule, campaigns, approvals, advertisers, display types | — | unchanged, within run-to-run noise |

**Real-time impressions** (the Player API path, same estate, an in-process
mock DSP; the bench has no Player API scenario yet):

| | Before (two runs) | After (two runs) |
|---|---|---|
| Per impression, one at a time | 8.2 / 7.9 ms | **2.6 / 2.4 ms** |
| Impressions/s, 32 at once | 120 / 127 | **420 / 438** |
| Impressions that missed tmax (200 ms) out of 620 | 80 / 71 (≈ 12%) | **0 / 0** |

The before figures are the 16 Oct regression (§2, Performance). With every
display on its own hour-of-week VAC-d profile (migration 0074), the same
build serves **247 impressions/s** (4.7 ms each; 3 of 620 missed tmax),
because the profiles are parsed and summed on every impression (§4).

**What that means for capacity.** A 15,000-display estate with one
real-time slot per display signals about 330 impressions/s. One process
now covers that with flat VAC-d, but not once displays carry profiles —
and both figures use an in-process mock DSP, not the network. More than one
pod needs the shared database (§5, step 6). So before real-time traffic at
that scale, either cache the per-type profile sum (§4) or plan the Postgres
move first.

**Tests**:

| Suite | Before | After |
|---|---|---|
| API (`apps/api`, incl. E2E runs, stability and two-process tests) | 839 passed | **856 passed** (17 new) |
| Approval module | 54 passed | 54 passed |
| Mock DSPs | 8 passed | 8 passed |
| Admin UI | 143 of 147 passed (4 timeouts on this 4-core machine; they pass with `CI=1`) | 149 of 153 passed (6 new). The same 4 timeouts, and with `CI=1` their file passes in full. |
| Typecheck, every workspace | clean | clean |

**The container bundle under production settings** (`deploy/kubernetes/build.mjs`,
then the bundle run with `NODE_ENV=production`, as in the K8s README):

- `/healthz` and `/readyz` answer.
- A configured token is accepted; the public POC tokens and the default player token are refused.
- The test endpoints answer 404.
- The fresh database is **empty and switched off**: `sellers.json` and the Partner API are 404.
- SIGTERM closes the database cleanly.

The image itself was not built (no Docker daemon here) and the manifests
were not applied to a cluster. Build and apply them on the client's tooling.

## 4. Left for engineering — deliberately not changed

These need a product decision or a change in behaviour, or they are
integration work.

**Data growth and long reports — decide before real-time traffic.**

- **`realtime_impressions` has no retention**, and the booking schedule
  counts its last 7 days by scanning the whole table
  (`RealtimeImpressionRepo.playedCountsSince`). That costs about 1 s per
  million rows, synchronously.
- At one real-time slot per display, 15,000 displays signal about 330
  impressions/s. That is roughly 28 million rows (~11 GB) a day, so the
  50 Gi volume fills in days.
- Decide how long impressions are proof of play. Then add a retention
  sweep like `PH_RESERVATION_RETENTION_DAYS`, and a per-position daily
  counter for the schedule.
- **The unsold report is one synchronous scan.** It takes 6.2 s for 7 days
  of that estate, and the route allows 366 days. While it runs, real-time
  impressions miss tmax. Fix with a daily roll-up, a shorter maximum range,
  or Postgres.
- **The Player API's per-impression VAC-d profile** parses and sums every
  display's 168-hour profile (`AudienceSource.forSlot` with a window,
  about 1.9 ms per impression on shape C). A per-type summed vector, cached
  like the display counts, gives the same answer.
- **The bench has no Player API scenario.** Add one to
  `bench/thresholds.json` so a regression like the 16 Oct one fails the
  nightly gate on the path that now carries the most load.

**The Player API (real-time bidding, since 7 Oct).**

- It has **no route on either ingress**, so as shipped no player can reach it.
- It authenticates every player with one shared token. A token lifted from
  one store device can signal impressions for any display, and confirm
  plays, which bill.
  - Give it its own listener restricted to the store networks.
  - Give each device a credential tied to its `displayId`.
- It returns 401 before checking whether DSP integration is switched off;
  the Partner API returns 404 first.
- `playedAt` is taken as the player reports it. Decide what clock skew to
  accept.
- **At-bid creatives** go to the player as the DSP's URL. That includes
  `.svg`, which PH has not checked. Tell the player to render them only as
  image or video, never as a document.
- The post-play creative download runs inside the `/played` request, with no
  process-wide cap. Bound it with the upload semaphore, or move it to a
  queue.

**Security posture that integration settles.**

- **The Admin API is unauthenticated in the POC**: every caller is
  `hq_admin`, and the internal ALB is the only control. That puts behind it:
  - `platform_users` (Company Settings → Users, names and emails);
  - the role a PH Core advertiser user is given;
  - every setting.

  When `SessionSource` moves to cookies, use `SameSite=Strict` and require
  JSON or a custom header on writes (CSRF).
- **Everything production-only hangs on `NODE_ENV` being exactly
  `production`**: the POC tokens, the default player token, the test
  endpoints and the test clock. Consider refusing to start when `API_HOST`
  isn't loopback and production mode is off.
- **SSRF by name.** A public name that resolves to a private address, or a
  two-label cluster name (`service.namespace`, resolved through the pod's
  search domains), passes the URL check. The network policy is the lock
  for those, and only if the cluster enforces it. A DNS-aware egress policy
  (Cilium or Calico) narrows egress to the DSPs' hostnames.
- **The bidder's QPS and the API rate limiters are per process.** With
  several pods they move to the gateway or a shared store.
- **Image:**
  - pin the base image and the deployed image by digest;
  - the runtime image still has npm and corepack;
  - `api.mjs.map` ships the sources (informational).
- `npm audit --omit=dev`: two moderate advisories in `react-router` (admin
  UI, client side). The vulnerable server path is not used. Nothing for
  Fastify or `@fastify/multipart`.
- **Inventory with a huge `cursor`** defeats the 1 Oct early stop, so the
  whole estate is scanned on every request. That is bounded, the same cost
  as the last page, but costs more per request than the rate limit assumes.

**Admin UI at a 15,000-display estate.** None of this was changed, because
each item changes what renders or when.

- Every AG Grid uses `domLayout='autoHeight'`, so nothing is virtualised:
  Available Inventory renders 2,408 rows on shape A.
- Each page passes a new grid context on every render, which re-renders
  every cell on each keystroke.
- No request is ever cancelled.
- About 11 sections are prefetched 800 ms after each load.
- The approvals hook falls back to one request per campaign when the list
  fails.
- The bundle is 660 kB gzipped, with no route code-splitting. AG Grid is
  38% of it.
- The demo snapshot (2 MB) is copied into every production build.
- Error handling:
  - A failed load shows a spinner for ever, because retries are off and
    there is no error state.
  - 401, 403 and 429 get no specific handling, and `Retry-After` is never
    read.
  - Several saves are a series of requests that can partly succeed.
- `/api` is hard-coded (`client.ts` and the CSV link in `DealSheetModal.tsx`),
  and the Vite `base` is root-absolute.
- Display-type images are data URLs of up to 400 KB each, sent in the list
  response.

**Dead code** (unreferenced, or used only by tests; listed, not deleted):

- in `domain/`: `bidLookahead.ts`, `cachedAssetRetention.ts` and `guarantee.ts` defaults (the values live in the migrations' DDL), `slots.ts` `expectedSlotCountOf`, `positions.ts` `isVisible`/`windowHoursOf`, `plays.ts` (two helpers), `dealCreative.ts` `creativeMisfit`;
- `PlaylistSource.loopLengthSec`;
- `UnsoldSlotRepo.UNSOLD_REASONS`;
- in `catalog.ts`: `RTB_ONLY_TOUCH_POINTS`/`isRtbOnly`, `STORE_SCOPES` and `targetingLabel`;
- in the admin UI: `effectiveTerm.ts` `impressionsOf`, `model.ts` `effectiveLists`/`isBlocked`, `path.ts` `externalUrl` (test only), and the unrouted `BookingSchedulePage.tsx` (kept on purpose);
- the `exchange/billing.ts` re-export shim;
- the unused `@testing-library/user-event` dev dependency.

## 5. Porting checklist — in this order

1. **Close the data-layer leaks** (§1):
   - Replace `ctx.db` with a transaction port.
   - Move unique-violation handling into the repositories.
   - Move `TAKEN`, `mintDealId`, `mimeOf` and the defaults out of the SQLite files.
   - Split each seam into an interface file and an implementation file.
   - Extend `sql-portability.test.ts` to forbid `ctx.db` outside `db/`.
2. **Authentication**:
   - `SessionSource.current(req)` against HQ Admin's session.
   - Partner identity: `auth/partnerAuth.ts` reads `config.partnerTokens` directly; make it a seam.
   - Per-device player credentials (§4).
3. **The hot read seams**, each with a cache that sees its own process's
   writes at once and other processes' within a bounded time:
   - `DisplayTypeSource` (`phExtensions` round trip);
   - `DisplaySource` (counts, never rows);
   - `StoreSource` (with segments, trading hours and venue);
   - `PlaylistSource`.
4. **One campaign source, two facets**:
   - Replace `sqliteCampaignSource` and `pocCampaignSource` together.
   - Pass the host's `transaction`.
   - Run `runCampaignSourceContract`, `runApprovalContract` and `test/seam-guarantees.test.ts` against the real adapter.
5. **The remaining seams**:
   - `AudienceSource` (the hour-of-week profile);
   - `PlaybackSource` (`totals` with `byVersion`, `receivedBy`, `receivedBetween`, `lastPlayed`; aggregated at the source);
   - `AssetStore` to S3/CDN, after which the `/assets` route goes;
   - `SecretsStore` to KMS;
   - `Flags`.
6. **Postgres for this build's own tables**:
   - `?` → `$n` and `.changes` → `rowCount`.
   - Remove `rowid` (migrations 0021, 0026, 0029, 0037, 0102).
   - Rewrite the SQLite triggers (0037, 0067, 0069, 0070, 0102).
   - Drop the transaction lock, and give each transaction a pooled connection.
   - Then `optional/` (HPA, PDB, the scheduler CronJob) and `PH_SCHEDULER=off`.
7. **Delete what is POC-only**:
   - In the API:
     - `apps/dsp-mocks`;
     - the mock defaults in `config.ts` and `BID_ENDPOINT_SOURCE=mock`;
     - `POC_ROLE`/`envSession` and `routes/admin/session.ts`'s stand-in;
     - `routes/admin/test.ts`, `testClock.ts` and `PlayRepo`;
     - `seed/` and its call in `index.ts`, and the `db:*` scripts;
     - the stand-in migrations and `platform/sqlite*`.
   - In the admin UI:
     - `src/demo/` and its `VITE_DEMO` branches;
     - `public/demo/` and `scripts/capture-demo.mjs`;
     - `features/campaign-status/` and `CampaignSchedulePage.tsx`;
     - `BookingSchedulePage.tsx` if the booking schedule stays out of scope.
   - Hosting: `deploy/firebase/` and `prototype/`.
8. **The decisions in §4**: impression retention, the unsold roll-up, and the Player API's ingress and credentials.
9. **Release gate**, all green on the ported build:
   - the contract tests;
   - `test/stability.test.ts` and `test/multiprocess.test.ts`;
   - `test/e2e/`;
   - `test/handover-review.test.ts`;
   - `npm run bench -- --assert`, calibrated on the target hardware first.

## 6. Re-running every check

```bash
cd dsp-integration
npm ci
npm run typecheck                                   # every workspace
npm test                                            # API (incl. E2E), approval module, mocks, admin UI
CI=1 npm run test -w @ph-dsp/admin                  # admin UI with CI's timeouts, on a loaded machine
npx vitest run test/handover-review.test.ts         # (in apps/api) this review's regressions
npm run bench -- --scale=15 --displays-per-type=1000 --stores=1000 --admin   # shape C
npm run bench -- --assert                           # the regression gate (calibrate first on new hardware)
npm audit --omit=dev
node deploy/kubernetes/build.mjs                    # the container bundle; run it as in deploy/kubernetes/README.md
```
