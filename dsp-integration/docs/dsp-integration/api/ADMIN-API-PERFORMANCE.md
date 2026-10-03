# Admin API performance review — 3 Oct 2026

The 23–24 Sep reviews (`SECURITY-PERFORMANCE.md`, `SCALE-15000-EKS.md`)
measured the Partner API, the auction and billing. The admin API, which
HQ Admin loads on every screen visit, had never been measured. This review
adds it to the bench, measures it at 15,000 displays, and fixes what it found.
Tickets: GRHVCXyk2QIPEuxaDveL (the admin read paths) and
u8Fda3czAk5cpqxJFTnq (the billing regression).

## How it was measured

`npm run bench -- <shape> --admin` (`apps/api/bench/load.ts`). `--admin`
is new: it drives the booking schedule (default two weeks and 92 days),
Available Inventory, Advertiser settings, campaigns, approvals, display
types and Advertisers against the same estate as the Partner API runs. It
is now part of the nightly gate's arguments (`bench/thresholds.json`).

The gate's own arguments: `--stores=1000 --bidder-ms=80
--plays-per-display=1900 --history=100000 --seconds=3 --concurrency=32`.
**`--history=100000` matters**: 100,000 windows already sold and billed,
as after months of operation. Every finding below grows with history, not
with the estate.

Latencies are p50 with 32 clients at once, so they include queueing on
the API's one thread. Per-request cost is roughly p50 ÷ 32 for the slow
endpoints. One machine, so compare rows, not with other reviews.

## Before and after

Shape A: 600 display types × 25 displays (2,408 positions). Shape C:
15 × 1,000 (68 positions).

| Endpoint | A before | A after | C before | C after |
|---|---|---|---|---|
| booking-schedule (two weeks) | 42.5 s | 4.4 s | 30.7 s | 0.17 s |
| booking-schedule (92 days) | 114.7 s | 26.4 s | 30.2 s | 0.66 s |
| Advertisers | 25.2 s | 0.17 s | 24.3 s | 0.15 s |
| campaigns | 26.4 s | 1.4 s | 25.7 s | 1.5 s |
| Available Inventory | 2.0 s | 1.8 s | 71 ms | 59 ms |
| billing one window | 97 ms | 80 ms | 1,669 ms | 806 ms |

Shape B (60 × 250, 248 positions), after: booking schedule 475 ms / 2.4 s,
campaigns 1.5 s, Advertisers 157 ms, Available Inventory 213 ms.

Partner API, auction and billing tick: unchanged within noise on every
shape.

## What was wrong, and the fix

1. **The booking schedule read every line item ever written** to find the
   amounts for the dozen bookings on screen (about 1 s per request with
   100,000 billed windows), and **asked for each cell's reservations
   twice**, one query per position per column (2,408 × 14 = 67,000 queries
   a page on shape A).
   *Fix:* one ranged query for every live sale in the visible range,
   indexed by position and window. Migration 0021 guarantees at most one
   live winner per position and window, so the index holds exactly the row
   each cell needs. Billed amounts are read only for those reservations
   (`BillingRepo.amountsFor`, chunked `IN` lists padded to four fixed
   lengths so the statement cache stays small). Each campaign's targeting
   and each window length's first sellable window are memoised per request.
2. **The campaigns list loaded every live sale ever made** (100,000 rows)
   and filtered that whole list once per campaign.
   *Fix:* counted per campaign in one grouped query
   (`ReservationRepo.liveByCampaign`).
3. **Advertisers read every booking since 1970** to count the current and
   future ones.
   *Fix:* the query starts at the earliest current window any position can
   have. Each row is still checked against its own position's current
   window, so the counts are unchanged.
4. **Billing regression (shipped 2 Oct in PR #298).** Plays per version
   (`byVersion`, contract v3.1 row 3) were counted by a second scan of the
   window's plays. Billing one window of 1.9 million plays went from the
   gate's 650 ms to 1,669 ms. The nightly gate would have caught it the
   next night; the train's merge gate (`e2e-quick`) does not run the bench.
   *Fix:* the same single scan also reports how many plays carry a version
   and the version range. When the window played one version, which is the
   normal case, that is the exact answer. Only a window that really played
   several versions pays for the `GROUP BY`. 806 ms on shape C, inside the
   gate.
5. **Available Inventory read each slot's audience twice.**
   *Fix:* `unsellableReason` takes the audience the caller already has.

## Tried and not shipped

- **A partial index for the campaigns count** (live sales keyed by
  campaign, 6 ms instead of 40 ms in isolation). SQLite's planner picks the
  status index instead whenever the history is mostly live sales, with or
  without `ANALYZE`. Only `INDEXED BY` forces it, and that is SQLite-only
  syntax the portability rule keeps out of the repos. Postgres's planner
  makes this choice by itself.
- **`PRAGMA optimize` on open and hourly.** No measurable gain on these
  paths, and it changes every query plan, so it was not worth the risk
  without evidence.

## What is left

- **The campaigns list costs about 45 ms** on 100,000 historical sales,
  counting each campaign's all-time windows. Acceptable now; on Postgres
  the partial index above is the fix.
- **The 92-day booking schedule on shape A is a 3 MB response** for
  2,408 positions × 92 columns; most of its 26 s under load is building
  and serialising that. If an estate this wide is real, the screen should
  page by display type (a UI change, not attempted here).
- **Available Inventory on shape A is 1.8 s under load** (about 60 ms a
  request): one playlist read and one audience read per slot, 2,408 slots.
  Paging this screen too would fix it; the per-slot reads are already
  single cached statements.
- **The bench gate runs nightly, not on the train's PR.** A train can
  merge a performance regression that the next night then reports. If that
  delay matters, run `npm run bench -- --assert --shapes=C --seconds=1`
  (about 4 minutes) in the deploy PR's checks.
