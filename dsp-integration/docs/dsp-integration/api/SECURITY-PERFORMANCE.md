# Security, scalability and performance review — 23 Sep 2026

A review of the back end (`apps/api`, `packages/campaign-approval`) for
low-latency, high-volume use: what was found, what changed, what was
measured, and what is deliberately left for the platform. Boundaries with
PH Core are in [PH-CORE-BOUNDARIES.md](./PH-CORE-BOUNDARIES.md).

No endpoint, screen or copy changed. Two error codes, `rate_limited` and
`internal_error`, and the request limits below were added to
`openapi.yaml` / API.md.

## How to reproduce the numbers

```bash
npm run bench                                   # demo estate (8 positions)
npm run bench -- --scale=250                    # + 250 display types × 4 slots, 25 displays each
npm run bench -- --scale=250 --bidder-ms=80     # + an 80 ms round trip to every DSP bidder
```

`apps/api/bench/load.ts` runs the real Fastify server over a file database
(WAL, as deployed) with the mock DSPs in-process, drives each Partner API
endpoint with 32 concurrent clients, then times one auction. It lifts the
per-partner rate limit so it measures capacity, not the limiter. Numbers
are from this sandbox, on one Node process; compare runs on the same
machine, not across machines.

## Measurements (req/s on one process; p50 in brackets)

**Large estate** — 253 display types, 1,008 advertiser positions, 6,285
displays:

| Endpoint | Before | After |
|---|---|---|
| `GET /v1/inventory` (page of 50) | 13 (7.6 s) | 227 (128 ms) |
| `GET /v1/inventory/{id}` | 27 (1.8 s) | 1,205 (26 ms) |
| `GET …/availability` — 7 days | 21 (2.1 s) | 1,494 (20 ms) |
| `GET …/availability` — 1 year | 11 (9.5 s) | 608 (51 ms) |
| `POST /v1/inventory/forecast` — 30 days | 21 (2.4 s) | 651 (48 ms) |
| `GET /v1/targeting/attributes` | 2,165 (14 ms) | 4,672 (6 ms) |
| Auction, 1,008 positions, instant bidders | 6.8 s | 2.1 s |
| **Auction, 1,008 positions, 80 ms bidder round trip** | **170.6 s** | **5.3 s** |

**Demo estate** (8 positions):

| Endpoint | Before | After |
|---|---|---|
| `GET /v1/inventory` | 289 | 794 |
| `GET /v1/inventory/{id}` | 610 | 2,136 |
| `GET …/availability` — 7 days | 320 | 2,485 |
| `GET …/availability` — 1 year | 11 | 661 |
| `POST /v1/inventory/forecast` — 30 days | 117 | 1,438 |

p50 under 32 concurrent clients is mostly queueing on one process. The
CPU cost of one request is about 1 ÷ req/s:

- about 0.8 ms for one position;
- about 4 ms for a page over the whole large estate.

The API is stateless apart from its database, so throughput scales with
instances (see PH-CORE-BOUNDARIES.md, "Running more than one instance").

## What was wrong, and what changed

The findings were reproduced before they were fixed. Each fix has a test
in `apps/api/test/hardening.test.ts`,
`partner-api-hardening.test.ts` or `analytics-reservation.test.ts`.

### Correctness under concurrency

| Finding | Fix |
|---|---|
| **A window could be sold twice.** Two auctions clearing the same window, such as the CLI next to the scheduler or a second instance, both passed the "already sold?" check. Reproduced: 2 `won` rows and 2 slot bookings, so the window was delivered twice and billed twice. | Migration 0021: a partial unique index for one live winner per position and window, and a unique index for one booking per slot and window. The auction, the reservations endpoint and the hand-off treat the violation as "already sold" or "already booked", and tell every candidate why. The test fails without the migration and passes with it. |
| The same unknown creative could be queued twice by concurrent auctions. | The creative's ID is claimed (`INSERT … ON CONFLICT DO NOTHING`) before it is fetched. The claim is released if retrieval or the checks fail. |
| The scheduler could start a second tick while a long auction was still running. | A running guard. |

### The auction

| Finding | Fix |
|---|---|
| **Fan-out was serial**: positions × DSPs × round trip. That is 170 s for 1,008 positions at 80 ms. | Every DSP for a position is asked at once, and positions clear 16 at a time (`POSITION_CONCURRENCY`). Responses are processed in DSP order, so the outcome doesn't depend on who answered first. |
| A response with no `cur` was accepted as the exchange's currency. OpenRTB says it means USD. | A missing `cur` is treated as USD, and rejected unless the exchange trades in USD. |
| No check on the response `id`, the `impid`, a non-finite price, or an absurd price. | A response to another request is ignored. The bid must be for impression 1, the price must be finite, and it can't exceed `maxBidCpm` (10,000). |
| Unbounded bids per response, each written as a row. | At most 10 are read (`MAX_BIDS_PER_RESPONSE`). |
| Unbounded bid response body. | Capped at 64 KB; over that is no bid (`readCapped`). |
| Creative download read the whole body before checking its size; any number of new creatives per response were fetched inline; the URL check was a string prefix, so `…/creatives/../x` passed. | Capped at the asset size limit while streaming. One retrieval per response; the rest are retried from a later window. The URL is compared after normalisation, and credentials in it are refused. |

### The Partner API

| Finding | Fix |
|---|---|
| A DSP that wasn't connected could still create campaigns, upload creative and submit. | Writes need `status = connected`, otherwise 409. Reads of its own campaigns stay allowed. Ownership is checked first, so another partner's campaign is still a 404. |
| No rate limiting. | A token bucket per partner: 50/s, bursts of 100, then `429 rate_limited` with `Retry-After`. It is configurable with `PARTNER_RATE_PER_SECOND` / `PARTNER_RATE_BURST`. |
| Forecast took unlimited, repeated position IDs. Reproduced: 60,000 copies blocked the process for 15 s and counted the same audience 60,000 times. | At most 200 positions, each listed once. |
| A content package had no size limits. Reproduced: a 150,000-character name and 1,200 targeted versions were stored and re-parsed on every bid. | Name ≤ 200 characters; ≤ 20 versions; ≤ 10 groups; ≤ 20 conditions per group; values ≤ 200 characters. |
| Unlimited concurrent uploads, each buffered up to 200 MB. | At most 2 in flight per partner, then 429. |
| Tokens were looked up as object keys, not in constant time, and the public POC tokens were live everywhere. | They are now compared as SHA-256 digests with `timingSafeEqual`. The API refuses to start with `NODE_ENV=production` unless `PARTNER_TOKENS` is set and doesn't reuse a POC token. |
| Client errors became `500 Unexpected error`: an oversized body, and a second file in an upload. | 4xx statuses pass through (413, …); a wrong content type stays `400 validation_failed`, as the contract has always said. Real faults are `500 internal_error`. |
| No security headers. | `nosniff`, `default-src 'none'` CSP with `frame-ancestors 'none'`, `no-referrer`, and `no-store` on `/api/*`. |
| GCM accepted a truncated authentication tag. | A 16-byte tag is required. |

### Throughput

| Finding | Fix |
|---|---|
| **Every read of company settings ran an `INSERT … ON CONFLICT`**, a write lock, several times per play window. | Reads never write. Settings come from an in-process snapshot, frozen, replaced on every save, with a 1 s TTL. |
| Every Partner API request re-parsed every display type from JSON. | The same snapshot pattern, with the records deep-frozen. |
| *(24 Sep 2026)* Every Partner API request now reads the DSP integration switch from the exchange record, and that read ran an `INSERT … ON CONFLICT`. | The row is inserted only when it is missing, so reading it never writes. |
| `db.prepare()` on every query. | A prepared-statement cache per database (`prepared()` in `db/db.ts`). |
| No index on `displays.display_type_id`, on `plays` for billing, or on `reservations (status, window_start)`. | Migration 0020. |
| Availability and forecast did per-window work that doesn't change between windows: the display list, the next window, audience, one reservation query per window. | `windowFacts` works these out once per request, with one ranged reservation query. |
| A single-position lookup computed visibility for every position in the estate. | Find the position, then check that one. |
| The inventory list read every position's displays even with no store or region filter. | Only when a filter needs them. |
| Every partner lookup decrypted its credentials (AES-GCM) to list the field names. | The names are cached per ciphertext. Nothing decrypted is kept. |
| SQLite ran with default settings, so the CLI next to the API got `SQLITE_BUSY`. | WAL, `busy_timeout = 5000`, `synchronous = NORMAL` for file databases. |

## Checked and fine

- **The DSP integration switch** (24 Sep 2026). While a retailer has it off,
  every Partner API request answers 404 before the token is checked, as
  with the build flag off, and sellers.json is 404. So a switched-off
  exchange tells a caller nothing, not even whether its token is valid.
  The Admin API refuses a new Advertiser slot while it is off. Nothing is
  deleted.
- **Isolation between partners.** A campaign, reservation or position that
  belongs to another partner is a 404. No IDOR was found.
- **No SQL injection.** Every query is parameterised.
- **No path traversal on `/assets/:file`.** The name is checked against a
  pattern.
- **No ReDoS.** Patterns are simple and anchored.
- **Secrets.** AES-256-GCM with a random IV. Secrets are never returned or
  logged, and the authorization header is redacted from logs.
- **Existing limits.** Pagination is capped at 200. Date ranges are capped
  at 366 days (inventory) and 92 days (booking schedule).
- **Billing is idempotent** per reservation.
- **The bidder timeout covers the body stream too.** A slow body is
  aborted at 300 ms.

## Deliberately left

| Item | Why it is left |
|---|---|
| The Admin API has no authentication in the POC. Every caller is `hq_admin`. | By design: the stand-in session is replaced by HQ Admin's own (`SessionSource`). Until then the API binds to `127.0.0.1` and **must not be exposed with real data**. The hosted demo (`deploy/firebase/`, Rob 23 Sep 2026) is public on purpose, for demo data only: 20 requests/s per IP, CORS for the prototype's origins, its own Partner API tokens, and a reset. See `deploy/firebase/README.md` → "Security posture". |
| The rate limiter is per process. | Correct for one process. With several instances it moves to the gateway (PH-CORE-BOUNDARIES.md, "Edge and gateway"). |
| An upload is still buffered in memory while it's checked. | Bounded to 2 per partner × 200 MB, and since the 24 Sep 2026 review to `PH_MAX_UPLOADS_IN_FLIGHT` (default 4) across all partners per process — a fifth answers 429. Streaming to disk means parsing MP4 from a stream; worth doing when the real `AssetStore` is known. |
| The booking schedule and the approvals list query once per position or campaign (N+1). | They are admin screens, not a partner hot path, and bounded (92 days; paginated). They can be batched like availability if the admin screens slow down on a large estate. |
| `POST /v1/campaigns` shows whether a display type ID exists. | Display type IDs aren't secret, and a partner already sees every display type it can buy. Hiding them would change the contract. |
| `POC_ROLE`, the mock DSPs and the SQLite stand-ins. | POC only. They are replaced on integration (PH-CORE-BOUNDARIES.md). |

## 15,000 displays, in a client's VPC on EKS — 24 Sep 2026

The second review — three shapes of a 15,000-display estate, the bidding
API under load, billing at a real play volume, and what a client's EKS
cluster has to provide — is its own document:
[SCALE-15000-EKS.md](./SCALE-15000-EKS.md). Everything above stands; the
changes it made (display counts from an aggregate, one query per estate,
billing in SQL, one auction per window across processes, a private-address
guard on DSP endpoints, probes, `PH_SCHEDULER`) are listed there with
their measurements, and the deployment is `deploy/kubernetes/`.
