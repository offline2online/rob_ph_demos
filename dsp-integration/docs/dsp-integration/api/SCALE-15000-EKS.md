# 15,000 displays, in a client's VPC on EKS — review, 24 Sep 2026

Rob asked for a second review: scalability first (the section sits behind
the Personalisation Hub login), for an estate of **15,000 displays with
advertisers bidding for slots on them**, run in a client's own VPC on
**EKS**; and the bidding API tested and optimised for it. This document
records what was measured, what changed, and what the client's cluster
has to provide. The deployment itself is `deploy/kubernetes/`
(its README carries the sizing); the seams are in
[PH-CORE-BOUNDARIES.md](./PH-CORE-BOUNDARIES.md).

## The one fact that decides the scale

The exchange sells a **play window per position** — a display type's slot,
across every display of that type (REQUIREMENTS §6, "Selling a play
window, not an impression") — never per display. So bid requests, bids,
inventory and reservations grow with the number of *positions*, and
15,000 displays is anywhere from 60 positions (15 formats × 4 slots, a
chain with a few formats in every store) to 2,400 (600 formats × 4, a
retailer with many). The display count itself only enters where a
position looks its displays up. The review therefore measured three
shapes of the same 15,000 displays:

| Shape | Display types × displays each | Positions |
|---|---|---|
| A | 600 × 25 | 2,408 |
| B | 60 × 250 | 248 |
| C | 15 × 1,000 | 68 |

## How it was measured

`npm run bench` now takes the estate's shape and exercises the write path
and billing as well as the reads (`apps/api/bench/load.ts`):

```bash
npm run bench -- --scale=600 --displays-per-type=25   --stores=1000 --bidder-ms=80 --plays-per-display=1900 --history=100000   # A
npm run bench -- --scale=60  --displays-per-type=250  --stores=1000 --bidder-ms=80 --plays-per-display=1900 --history=100000   # B
npm run bench -- --scale=15  --displays-per-type=1000 --stores=1000 --bidder-ms=80 --plays-per-display=1900 --history=100000   # C
```

- 1,000 stores; the demo estate's DSPs and advertisers; 32 concurrent
  clients, 3 s per endpoint, the per-partner limiter lifted.
- **Bids**: `POST /v1/reservations` places a distinct (advertiser,
  position, window) bid on every request — the way tier-2 advertisers
  bid — and the few the demo estate refuses by design (a position held for
  one advertiser, a whitelist-only slot, a window already sold) are
  counted apart.
- **The auction**: every position, every DSP, with an 80 ms bidder round
  trip.
- **Billing**: one ended window on the most populous display type with
  1,900 plays per display (a 46 s loop, 24 hours), after 100,000 windows
  already billed — a database after months of operation — and a tick with
  nothing new to bill.

Numbers are from this sandbox (one Node process, 4 vCPU); compare runs on
the same machine.

## Results (req/s at 32 concurrent clients; p50 in brackets)

| | A: 2,408 positions | | B: 248 positions | | C: 68 positions, 1,000 displays each | |
|---|---|---|---|---|---|---|
| | before | after | before | after | before | after |
| `GET /v1/inventory` (page of 50) | 184 (154 ms) | **582 (51 ms)** | 52 (346 ms) | **782 (38 ms)** | 20 (945 ms) | **850 (35 ms)** |
| `GET /v1/inventory?status=available` (1 yr) | 11 (5.0 s) | **96 (320 ms)** | 11 (4.3 s) | **384 (83 ms)** | 11 (6.3 s) | **502 (62 ms)** |
| `GET /v1/inventory/{id}` | 821 | **2,377** | 1,480 | **2,557** | 1,408 | **2,588** |
| `GET …/availability` — 7 days | 917 | **2,240** | 1,821 | **2,347** | 2,037 | **2,187** |
| `GET …/availability` — 1 year | 480 | **672** | 629 | **704** | 683 | **704** |
| `POST /v1/inventory/forecast` — 30 days | 384 | **1,323** | 1,087 | **1,355** | 1,259 | **1,387** |
| **`POST /v1/reservations` (a bid)** | 565 | **1,035** | 629 | **992** | 373 | **992** |
| Auction, 80 ms round trip | 12.7 s (4,807 requests) | 12.7 s | 1.4 s | 1.4 s | 0.68 s | 0.46 s |
| Billing tick, 100,000 windows billed, nothing new | 1.28 s | **77 ms** | 1.15 s | **84 ms** | 1.23 s | **62 ms** |
| Billing one window | 47,500 plays: 1.18 s | **71 ms** | 475,000 plays: 3.6 s | **0.37 s** | 1.9 M plays: 23.3 s | **0.65 s** |

`GET /v1/targeting/attributes` and a rejected token stay at 3,000–4,000
req/s in every shape. Billing's "after" is with the covering index of
migration 0025 (the SQL aggregate alone: 3.4 s on shape C).

The per-request CPU cost is about 1 ÷ req/s: a page of inventory 1.2–1.9
ms, a bid 1 ms, one position 0.4 ms. One process serves a 15,000-display
estate with headroom in every shape; what a client's cluster needs is in
`deploy/kubernetes/README.md`, *Sizing*.

## What was wrong, and what changed

Two kinds of cost, reproduced before they were fixed. Each fix has a test
in `apps/api/test/scale.test.ts`.

**Costs that grew with displays per type.** Every position looked up its
display rows to count them — on an inventory page (50 positions × 1,000
rows), in every availability check, in every bid request the auction
built (once per DSP), and on every bid placed.

| Finding | Fix |
|---|---|
| `positionView`, `windowFacts`, the auction and `POST /v1/reservations` read every display of the type (1,000 rows, joined to stores) to count them or to check there was one. Shape C: an inventory page at 20 req/s. | `DisplaySource.summaryByDisplayType` — display and store counts from one GROUP BY over the estate, kept as a one-second snapshot like display types and company settings. The rows are read only by the delete check. `storeIdsByDisplayType` (distinct) serves the inventory's store and region filters. |
| Billing read every play of the window into JavaScript and filtered by display: 1.9 million objects, 23 s on the API's one thread, with every request waiting. | `PlaybackSource.totals`: count and sum in SQL, answered from a covering index on `plays (campaign_id, played_at, display_id, duration_sec)` (migration 0025). 0.65 s. The seam now asks the platform's playback store for the aggregate, never the rows. |

**Costs that grew with positions.**

| Finding | Fix |
|---|---|
| The inventory list checked visibility per position with everything recomputed per position: the caller's effective lists, which of its seats are blocked or whitelisted, a fresh `assignedOf` object. 2,408 positions a request. | `visibilityFor(ctx, caller)`: one closure per request with the caller's lists and seats worked out once; `assignedOf` cached per frozen slot. The forecast checks only the positions asked for instead of the whole estate. |
| `allPositions` rebuilt 2,408 position objects on every call, and `findPosition` walked them to find one — on every single-position read, bid, hand-off and billed window. | A position index per display-type snapshot (keyed on the snapshot's own frozen records, so it lives exactly as long as the snapshot): `findPosition` is a map lookup. |
| `?status=` ran one ranged reservation query per position: 2,408 queries a request, 11 req/s, 5 s latency. | `ReservationRepo.takenInRange`: one ranged query for the estate's taken windows, handed to each position. 96 req/s on shape A, 502 on C. |
| `runBilling` loaded every line item ever written and every window ever won, every minute, to find what to bill: 1.3 s a tick after 100,000 windows, growing forever. | `ReservationRepo.billable`: one indexed query for "won or reserved, live, handed off, window ended, no line item yet". 77 ms, flat. |
| The auction read the partner list (JSON, decrypt-free but parsed) for every position, and built each position's view once per DSP. | Both once per auction / per position. `PH_AUCTION_CONCURRENCY` sets how many positions clear at once (16). |
| The approval store prepared its SQL on every call; the eligibility check runs per bid in the auction and per bid placed. | Statements prepared once per SQL text. |

**Growth.** Every DSP bid response and every API bid is a row, rejected or
not: up to 70,000 a window on shape A, 26 million a year. Rejected, lost
and never-cleared bids are now deleted `PH_RESERVATION_RETENTION_DAYS`
(90) after their window; won and reserved windows are kept.

**The auction did not need changing.** It is bounded by the DSPs' round
trip — positions ÷ 16 × round trip: 12.7 s for 2,408 positions at 80 ms,
45 s at the 300 ms timeout — and runs once per play window. 4,807 bid
requests and 4,807 bids in 12.7 s is 127 requests/s per DSP, well inside
the 500 QPS ceiling. Raising `PH_AUCTION_CONCURRENCY` to 64 would clear
the same estate in about 3 s at up to 500/s per DSP.

## Running several processes

Until now the scheduler remembered the windows it had cleared *in memory,
per process*: a second API replica, a CronJob tick or the CLI would each
auction the same window again. Migration 0021 stops the window being sold
twice, but every DSP was sent a second round of bid requests. Now a tick
**claims the window in the database first** (`auction_runs`, migration
0024): one row per window, exactly one claimant, a claim left unfinished
for 15 minutes taken over. With that, the scheduled work can run in every
API process (`PH_SCHEDULER=in-process`) or in none of them
(`PH_SCHEDULER=off` and `npm run scheduler:tick` once a minute from a
CronJob), and the API is stateless apart from its database.

The database is still the one SQLite file — one writer, one volume, one
replica. N replicas need Postgres, and the honest statement is that the
SQL is portable and the driver is not: `node:sqlite` is synchronous, and a
Postgres adapter means an asynchronous repository layer. It is contained
(one file per seam, `context.ts` the only wiring point), and it is
engineering's integration work. The measurements above are what one
replica gives a client's 15,000-display estate meanwhile.

## Security for a client's VPC on EKS

Behind the platform's login, the review concentrated on what a cluster in
someone else's account changes. Everything from the 23 Sep review ([SECURITY-PERFORMANCE.md](./SECURITY-PERFORMANCE.md)) stands;
these are the additions. Where each control lives is tabled in
`deploy/kubernetes/README.md`, *Security posture on EKS*.

| Concern | What was done |
|---|---|
| **SSRF from an admin-typed endpoint.** A DSP's bidder endpoint is where the exchange will POST bid requests (on integration; the POC sends them to configured endpoints), and a creative URL in a bid is fetched. In a VPC, `https://169.254.169.254/…` is the EC2 instance metadata service — credentials — and `https://db.internal/…` is the database. | `isPublicHttpsUrl` refuses IP literals in private, loopback, link-local, carrier-grade-NAT, multicast and reserved ranges (IPv4, IPv6 unique-local and link-local, IPv4-mapped in either spelling), `localhost`, `.local`, `.internal`, `.svc`, `.home.arpa` and single-label names (a cluster Service). The network policy is the second lock: egress to DNS and the internet on 443 only. A public name resolving to a private address is the gap only a DNS-aware egress policy closes (PH-CORE-BOUNDARIES.md, *Open*). |
| **The Admin API has no authentication of its own** in the POC (`POC_ROLE`). | Two ingresses: the Partner API, `sellers.json` and creatives on an internet-facing ALB behind a WAF; the Admin API on an internal ALB only, where HQ Admin runs. `/api/admin` has no route on the public one. `API_HOST` defaults to `127.0.0.1` for the same reason. |
| **Memory exhaustion by uploads** across many partners: 2 × 200 MB per partner, unbounded by partner count. | `PH_MAX_UPLOADS_IN_FLIGHT` (4) bounds the process; the pod's memory limit is set from it. |
| **A pod that is up but not migrated** taking traffic. | `/readyz` is 503 until the database answers and every migration is applied; `/healthz` for liveness. |
| **Abrupt termination** leaving a WAL and an unfinished auction. | SIGTERM drains requests, stops the schedulers and closes the database (checkpointed; verified on the bundle); an unfinished claim is retaken from `auction_runs`. |
| **Secrets** in git, in the image or on a laptop. | None: a Secret produced from AWS Secrets Manager; `NODE_ENV=production` refuses the public POC tokens; the pod mounts no service-account token and has no AWS role. |
| **The pod's privileges.** | Restricted Pod Security Standard: non-root, no privilege escalation, all capabilities dropped, read-only root filesystem, seccomp `RuntimeDefault`; only `/data` and `/tmp` writable. |
| **Rate limiting per process** with several pods. | Unchanged in the API (per partner token, per pod); the WAF's per-IP rate rule is the cluster-wide one. |

## Verified

- `test/scale.test.ts`, 14 tests: counts agree with the rows; the
  position index follows a change; the status filter answers exactly as
  the per-position path; billing counts 200,000 plays on 1,000 displays
  and ignores another type's, and bills nothing twice; one tick clears a
  window and a second sends no bid request, a window another process
  holds is skipped and a stale claim taken over; the retention sweep;
  the process-wide upload cap; the endpoint guard (unit and on save);
  the probes, including 503 with a migration rolled back; the
  configuration. API 266 tests, approval module 44, typecheck clean.
- The container bundle (`deploy/kubernetes/build.mjs`) started under
  production settings: the probes answered, a configured token was
  accepted and the POC tokens refused, SIGTERM closed the database
  cleanly. **The image was not built and the manifests were not applied
  here** — no Docker daemon and no cluster in this sandbox; they were
  parsed, not run.

## Deliberately left

| Item | Why it is left |
|---|---|
| N replicas. | Needs Postgres and an asynchronous repository layer (above). One replica serves the estate; the manifests say so and `optional/` is ready for the day. |
| Creatives on a volume, uploads buffered in memory. | `AssetStore` is the seam to S3; the buffering is bounded now. Streaming means parsing MP4 from a stream; worth doing with the real store. |
| Billing in the API process. | Half a second per 1,000-display window on the API's thread while `PH_SCHEDULER=in-process`; the CronJob takes it off the API once the database is shared. |
| Egress limited by address, not by name. | Only a DNS-aware policy can do that; the client's cluster decides. |
| `POC_ROLE`, the SQLite stand-ins, the mock DSPs. | POC only; replaced on integration. |
