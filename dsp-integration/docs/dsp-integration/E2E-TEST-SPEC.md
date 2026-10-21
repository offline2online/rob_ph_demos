# End-to-End Test Spec — DSP Demand Paths (v2)

**v1:** 29 Sep 2026 (open auction, floor price) · **v2:** 29 Sep 2026 (Rob) — adds run history, a non-happy hardening run, and the private-auction, two-period and reserved runs. (17 Oct 2026: the reserve price is replaced by a per-slot Floor CPM; Run 5 follows it.)
**v2.1:** 29 Sep 2026 (Rob) — adds **Run 6 — Full user journey (real-world customer flows)**.
**v2.2:** 30 Sep 2026 (Rob) — Run 6 split by actor and surface (retailer in Chrome, advertiser via the Partner API); creative package; browser→API handover.
**v2.3:** 30 Sep 2026 (Rob) — Run 6 execution moved to the Run 6 Runbook.
**v2.4:** 30 Sep 2026 (Rob) — **Run 6 rescoped to what this build owns.** Displays, stores, which version renders and playback are PH Core's; L3/L5/L6 verify the booking, not playback. Existing advertiser (Swisse); local instance.
**v2.5a:** 30 Sep 2026 (Rob) — the personalised multiplier is a per-play surcharge, not a bid floor (B5, L2, L4 rewritten).
**v2.5b:** 30 Sep 2026 — E6/K3 separate the two refusal paths for unsupported targeting: at creation `400 validation_failed` per field; at bid/reservation `targeting_not_supported`. Wording only.
**v2.6:** 1 Oct 2026 — reconciled after the rescope: K3 read-back, scored fixture slot, hosted-prototype note, new cases M1–M5.
**v2.7:** 2 Oct 2026 — run history; Run 6 scripted, package generated; M cases mapped to tests, M6–M10; E11a/E11b.
**v2.8:** 8 Oct 2026 (Rob) — **Run 3 adds the global deal ID (P9–P11) and category-scoped buyers lists (P12–P14), both end to end.** Mirrors Broadsign's global/auction-package model: a global deal reaching all open inventory, and a curated list invited by IAB category or by named advertisers.
**v2.9:** 12 Oct 2026 (Rob; ticket shFhoehCSY6KIkQa6Uy3) — **every element of the three AWS demo flows (10 Dec 2026) plus setup is covered by a named case.** Run 1 rewritten for real-time per-impression selling (the windowed open auction retired 8 Oct); Run 7 (deal types) and Run 8 (AWS demo) written into the spec; new Flow 0 setup, Flow 2 and Flow 3 cases (Z, Y, X, W); the advertiser-in-HQ-Admin journey (Run 9) for both a direct advertiser and a private-auction DSP advertiser; the personalised-on-deals decision recorded (Decisions); a *Demo playback — out of scope here* note.
**v2.12:** 22 Oct 2026 (Rob; ticket H8YNT4aXwSqD6gffTkAz, 7/7 of the direct-advertiser-via-deals series) — **Flow 3 (advertiser direct) is rewritten around the Direct advertiser deal.** X1–X5 now start from a finalised Direct advertiser deal (internal PH deal ID, flight dates, price) instead of a slot "assigned to" the advertiser; new cases X1a–X1d; X2 is revenue recorded and reported, not invoiced; X3 is the advertiser's own deal ID. Z1 also covers the refusal to name a direct advertiser in Assigned to. Automated in `apps/api/test/e2e/run10-direct-deals.test.ts` (in `e2e:quick`). Superseded: a direct advertiser in Assigned to; no deal ID for a direct advertiser; no billing through the platform (see the changelog in REQUIREMENTS.md).
**v2.11:** 21 Oct 2026 (Rob; ticket LjkTqL4rdegolMoFCYVJ) — **PG deals cover a delivery term and their committed plays are derived from the assigned slots.** New case Run 7 D4.7; D4.1 now reads "no committed plays at creation"; AWS-DEMO-TEST-FLOW.md section E updated (path E; a single day is a one-day range). Default committed plays and the per-day rate are retired.
**v2.10:** 20 Oct 2026 (Rob; ticket sGXWYJjMiQAlzXrhwQ8y) — **24-hour programmatic guaranteed is in AWS demo scope.** New case Run 7 D4.6; coverage map Flow 4 points at it; AWS-DEMO-TEST-FLOW.md section E walks it. Private auction and preferred deal stay out of demo scope.
**Owner:** Claude Code, autonomous (Run 6: `npm run e2e:journey`).

## The three AWS POC demand paths (Rob, 20 Oct 2026 — binding; supersedes the 12 Oct three-way split)

**AWS POC — exactly three demand paths, in this demo order (Rob, 20 Oct 2026; ticket JNSjYNvGcgwdzFvaPHlk — binding):**

1. **Open auction.** No targeting at all. Monster, PepsiCo and Mars Wrigley bid against each other through the DSPs on the same slot **35 seconds before it plays**; the highest bid wins and plays the creative supplied in its bid response.
2. **Programmatic guaranteed (PG).** An advertiser books a slot for a **full day (24 hours)** up front, pays a fixed amount and gets the slot. Coca-Cola is the demo brand. The creative must be **pre-approved and is managed directly in PH** (Coca-Cola, Coke Zero, Sprite, Fanta, Schweppes and Namthip water, the Thai 7-Eleven range), with targeting and scheduling rules (hot/cold store-segment localisation) that trigger the right campaigns on the PWA player. That is handled by **PH Core**, not by a DSP bid response.
3. **Advertiser direct.** The advertiser relationship is managed entirely within PH (no DSP). Red Bull is the demo brand: CV personalisation, several prioritised campaigns on one slot.

**Out of POC scope:** private auction and preferred deal (visible but greyed out in the UI), and targeting on deals and on the open auction. Anything below that describes PG as a future release for the AWS demo, or that offers targeting on a deal or an open auction, is superseded by this paragraph.

**Reserve booking (Run 5)** is a separate mechanism, not a demand path: a reservation at the agreed rate that clears and bills through the platform. It is neither renamed nor removed.

**Older cases stay as built.** Run 7 D2/D3 (private auction, preferred deal) and D5 and the personalised-on-deals cases (B5/E6) test code that exists but is **out of POC scope**: they are not part of the demo and are not demoed. Playback (localised swap, CV personalised variant, PWA campaign triggering) is **PH Core's** and is covered only by the separate rehearsal checklist.

## How to run this

- **Runs 1–5: autonomous, outside the three-phase pipeline; everything mocked at the API layer** (see *Stubs required*). Never call a real DSP, playback store or PH Core service. Reuse `apps/api/test/e2e/harness.ts`, `apps/dsp-mocks`, and the `apps/api/src/context.ts` seam-swap pattern.
- **Run 6 is the exception** — it runs against a real running instance, part browser, part API. Run it with `npm run e2e:journey` and this spec's own Run 6 section below.
- **Run command (1–5):** `cd dsp-integration/apps/api && npx vitest run test/e2e` (one run: add `-t "<run or case id>"`). Execute Run 2 → 5 in order (Runs 7–8 are in the same `e2e:quick`); Run 1 re-runs first as a regression baseline.
- **On any failure, raise a backlog ticket** (see *Raising tickets on failure*). One ticket per distinct issue.
- **Record results** with `npm run e2e:report -- <results files>`, which updates the one project document "E2E results — latest". Never create dated results documents, and do not edit this spec to record results.

## Run history

| Run | Date | Scope | Result |
|---|---|---|---|
| 1 | 29 Sep 2026 | Open auction, floor price (A–D) | Pass except two D variants → 2 bugs, fixed (95c46ac), shipped PR #249. |
| 2–3 | 29 Sep 2026 | Runs 1–5 (spec v2) | 65/74 pass; 8 bugs filed, all since fixed on main. |
| 4 | 29 Sep 2026 | Runs 1–5 re-baselined to Q38/OQ27/OQ52 (G0vIWrbJgLrx5s9WlOaU); gate for eLhAbNNVAIeeYUTvOlko | 82/82 before and after the DSP provider refactor. |
| 6 | 30 Sep 2026 | Full user journey, first attempt on the hosted prototype | Phase 1 done in Chrome; Phase 1b stopped (hosted prototype can't be seeded). Rescoped (v2.4); re-run locally. |
| 1–6 | 1 Oct 2026 (a8ea92f) | Generated run, Runs 1–5 + scripted Run 6 | 120/120. |
| 1–6 | 2 Oct 2026 (db6bac1) | Re-run after the awaitable seams (9f51d91) | 120/120, no change. |
| 7 | 5–8 Oct 2026 | Deal types D1–D5 (written into the spec in v2.9) | Passes in `e2e:quick`. |
| 8 | 10 Oct 2026 | AWS demo, direct + DSP creative-ID flows (written into the spec in v2.9) | Passes in `e2e:quick`. |

Run 1 regression bugs (keep their tests): `bWy1EOOnELBP7AGMcJVp` (D2 — pending bid from a re-test-failed DSP still won); `GrF9xcuoQgPx3yPpRuQg` (D3 — off-path creative URL spent the single retrieval).

## Preconditions / fixtures (all runs)

- Exchange settings complete (org, domain, seller ID, ad-ops email); `sellers.json` published; **DSP integration = on**.
- One connected DSP in **Live** mode with bidder endpoint and seat IDs (DV360 mock, `p_google`); a second DSP for multi-DSP cases.
- One single-zone Digital Signage display type, one **Advertiser** slot, floor CPM 100, AUD, ≥1 display (`e2e_signage.s1`). The slot is **scored** (an audience VAC-d row, or the display type's default VAC-d from 0035) and has a slot duration; unscored slots are hidden from inventory and refuse bids (30 Sep).
- One advertiser on that seat, **approval required = true**; a second with approval required = false.
- Slot **Targeting supported = localised** unless a case says otherwise. Each run adds its own fixtures.

## Stubs required (Runs 1–5)

DSP bidder (scripted OpenRTB 2.6: above/below floor, no bid, malformed, oversized, slow, wrong id/impid/cur, unknown creative, many bids); DSP management API (connect/re-test accept/reject); playback source (scripted VAC-d/play totals, able to throw); asset store (uploads, content hashes, size limits); campaign source / PH Core (accepts hand-off, one booking per slot/window); session + partner identity (admin session, one token per partner); clock (controllable).

---

## Run 1 — Open auction, real-time per impression (baseline, regression)

**Rewritten in v2.9.** The windowed open auction (an auction per play window, with a clearing tick) was **retired on 8 Oct 2026**. Open inventory is now sold **per impression, in real time**: the player signals an impression through the **Player API**, the exchange cuts a one-impression OpenRTB request to the eligible DSPs and answers `fill` or `no_fill` **within `tmax`**; a fill is **first price**, **proof of play** is logged and billing follows realised plays. Where nothing fills, the position falls through to the default. Tests: `realtime.test.ts`, `auction.test.ts`, `e2e/open-auction.test.ts`, `e2e/run7-deal-types.test.ts` (D1.5).

- **A. Approval gate (creative review).** A1 submit → Awaiting approval → approved. A2 an approved creative can be bid in the impression auction. A3 an unknown creative on a bid is discarded for that impression and queued for review. A4 a non-Approved creative is excluded from bid, reserve and hand-off and cannot be activated. A5 a missing default layer is rejected at checks.
  - **A6 At-bid creative reviewed after the play.** A bid carrying an unreviewed creative (`crid`) is **not** played in that impression (`no_fill`/falls through); it is queued, and when the retailer approves it, **later impressions** can play it. The review always happens after the play it was first offered for, never inside it. *(Run 8 S1; `re-approval.test.ts`.)*
  - **A7 Rejection blocks the content hash everywhere.** Rejecting a creative blocks its **content hash** for every DSP, advertiser and position: the same bytes re-uploaded or re-bid under another `crid` are refused, with the rejection reason. *(Run 8 S3; `re-approval.test.ts`, `realtime.test.ts`.)*
  - **A8 Uncached-creative restriction.** A creative the player has not yet cached is not eligible to win a real-time impression (it could not render within `tmax`): the bid is skipped with the stated reason and the impression falls through or goes to the next eligible creative. *(`uncached-restriction.test.ts`.)*
- **B. Impression auction / floor.** B1 impression → bid above the resolved floor → **fill**, first price, handed off. B2 bid below the floor → `no_fill`, default plays. B3 no bid → `no_fill`, default plays. B4 higher of two bids clears (first price); a tie goes to the earlier `created_at`. B5 a **private-deal** personalised campaign bids and clears against the **base** floor, not a multiplied one: below it → `below_floor`; 120 on a 100 floor clears at 120. The reservation keeps the personalised multiplier in force (`personalisedMultiplier`) for billing. **B5a** the booking is `personalised_eligible` for a private-deal or direct-advertiser window and **never** for an open real-time one (v2.9 decision above). Interactive: the ordinary floor, no multiplier (v2.5a).
  - **B6 Three-level floor hierarchy.** The floor resolves from three levels — **platform**, **DSP** and **buyers list**. A level set **below the platform floor is refused** (a lower level cannot undercut a higher one); the resolved (highest applicable) floor is what is sent as **`imp.bidfloor`**, and a bid under it is refused. *(`bid-floor-hierarchy.test.ts`, `display-type-floor.test.ts`.)*
  - **B7 Within `tmax`.** A DSP that does not answer within `tmax` is ignored for that impression; the others still count; no fill → default. *(`realtime.test.ts`, `bidder-tuning.test.ts`.)*
- **C. Proof of play & billing.** C1 the winning creative is fetched, approval confirmed, canvas-validated, handed off. C2 **proof of play** logged for the fill; billed on realised plays/VAC-d; unplayed not billed. C3 one fill per impression; losers told why.
- **D. Robustness.** D1 a malformed response affects that impression only. D2 a disconnected-DSP bid is refused — admin-disconnect and failed re-test. D3 an unknown creative → one retrieval from the DSP's own path, queued; an off-path URL refused without spending it.

## Run 2 — Open auction, non-happy paths (hardening)

Same fixtures as Run 1. Every case expects a refusal, fall-through or contained failure — never a sale, charge or crashed auction.

- **E. Partner API refusals.** E1 integration off → all endpoints + sellers.json 404 before token; no bids/auction; sold windows still billed; back on restores. E2 >50 req/s (burst 100) → 429 + Retry-After; second partner unaffected. E3 3rd upload/partner → 429; 5th overall → 429. E4 oversized asset → `file_size`; JSON >1 MB → 413. E5 package limits → `validation_failed`. E6 unsupported targeting (personalised on a localised-only slot) — two paths, both correct: at **bid/reservation time** → `targeting_not_supported`; at **campaign creation** (creation-time path) → `400 validation_failed` on the offending `targeted[n].pricingType` fields. E7 forecast >200 or repeated position → `validation_failed`. E8 bid >10,000 → 400. E9 bad window-start → 400 never 500. E10 another partner's object → 404 (no IDOR). E11a re-test-failed / E11b disconnected DSP write → 409; own reads still allowed.
- **F. Bid-response hardening.** F1 id mismatch ignored. F2 impid≠1 rejected. F3 missing cur → USD → rejected on AUD. F4 non-finite / >10,000 rejected. F5 >10 bids → first 10. F6 body >64 KB → no bid. F7 bidder >300 ms aborted; position falls through; other DSPs still count. F8 DSP order doesn't change outcome.
- **G. Approval lifecycle.** G1 reject with asset reasons → Rejected; bids discarded. G2 edit an Approved campaign → edit is Awaiting approval while the approved version keeps bidding/winning/handing off; approving swaps it in at next hand-off (Q38). G3 undo rejection → Awaiting approval, never auto-approved. G4 Rejected past 30 days deleted, audit kept. G5 approval-not-required → unknown creative auto-approved, competes in a later window. G6 Draft never retailer-facing.
- **H. Scheduling / concurrency / billing.** H1 bid while awaiting bidders → in this auction, nothing left pending. H2 bid for a claimed window → 409 "closed". H3 same advertiser twice on two processes → one 201, one refusal (0026). H4 two ticks → one auction, one round of requests. H5 15-min claim taken over; fresher left alone. H6 cutoff missed >1h: auctioned late if not started; else pending settled lost. H7 playback throws in billing → auction still runs; retried; no double line item. H8 position removed after a bid → settled lost. H9 DSP disconnected between bid and clearing (both paths) → pending bid rejected.

## Run 3 — Private auction (buyers list), global deal and category bundles

Fixtures: deal on the Advertiser slot with `invitedBuyers` (one in, one out), `activeFrom`/`activeTo`, `auctionCloses`; floor stays on the slot. P9–P14 add a global deal and category-scoped lists (see each case).

A1–A5 as Run 1 for invited buyers. P1 invited buyer above floor wins. P2 higher of two invited clears; tie → earlier. P3 uninvited → `not_invited`, never enters. P4 empty resolved list → default. P5 bid outside term or after `auctionCloses` → refused. P6 invited below slot floor doesn't win (deal doesn't lower floor). P7 blocked seat / list conflict → refused with reason. P8 invited buyer with unapproved creative discarded pre-auction.

**Global deal ID (P9–P11).** Fixture: the per-instance global deal on, a slot with its per-slot include-in-global flag defaulting on.
- **P9** A newly created open slot carries the global deal ID on `pmp.deals`; a bid quoting it competes as open-exchange — same base floor, first price, approval gate — and wins; the deal does not lower the floor and grants no guaranteed delivery.
- **P10** Deference: a slot held for a named advertiser, whitelist-only or blacklisted does **not** carry the global deal ID (the flag is suppressed), and the instance-level master switch off removes it from every slot.
- **P11** A per-slot opt-out drops the global deal ID from that slot only; other open slots still carry it.

**Category-scoped buyers lists (P12–P14).** Fixture: a buyers list scoped by IAB category (not named seats), and one scoped by named advertisers, on separate slots.
- **P12** A category-scoped list invites every synced seat whose DSP-reported category matches: an in-category seat's bid wins; an out-of-category seat → `not_invited`. A newly synced in-category seat is admitted with no re-save (live resolution).
- **P13** A named-advertiser list behaves as P1–P3 (the two modes are alternatives on one modal); the company blacklist still subtracts from a category list, and a category entry that is not a real IAB category → `400 validation_failed`.
- **P14** A category list resolving to no seats admits nobody and the window falls through to the default (as P4). Display-type/region scope is **not** on the list — it follows the slot the list is assigned to; a category list on two slots of different display types restricts by category identically on both.

## Run 4 — Two-period (auction window vs delivery term)

Fixtures: deal with `lockedWin`; term over several windows; `billingUnitHours` = 24.

T1 first clear locks CPM; `bookLockedTermWindow` books later windows at the locked rate, no re-auction. T2 each window billed on its own realised VAC-d at the locked CPM. T3 higher later bid doesn't displace the locked winner. T4 locked winner edited mid-term (pending edit, Q38) → approved version keeps the window (booked, handed off, billed); locked winner deactivated mid-term → not handed off, default plays, not billed. T5 zero-play window not billed; term continues. T6 locked DSP disconnected mid-term → remaining windows refused. T7 `billingUnitHours` change mid-term via admin API → 400 while windows unbilled (OQ27); sold windows bill as sold.

## Run 5 — Reserved (platform-billed reserve booking)

*This is **not** the direct advertiser relationship (Flow 3, Run 10): a reserve booking still clears and bills through the platform. Do not conflate or rename them.*

Fixtures: the platform floor on every slot, overridden by a slot floor (Floor CPM) on one slot.

R1 a slot's own floor wins over the inherited platform floor; a platform floor change reaches only slots without an override. R2 reserved slot excluded from the open auction. R3 reservation below the resolved floor (platform, slot, DSP, buyers list) → 422 `below_floor`; at/above → booked **at the agreed rate** (OQ52). R4 `type: reserve` → booked and handed off at once, window out of the open auction; a window nobody committed to is auctioned as usual (OQ52). A slot floor below the platform floor is refused on save (`advertiser-settings.test.ts`); `imp.bidfloor` carries the slot floor and a bid below it is rejected (`bid-floor-hierarchy.test.ts`).

## Run 7 — Deal types D1–D5 (`e2e/run7-deal-types.test.ts`; written into the spec in v2.9)

Passes in `e2e:quick`; documented here so the spec no longer trails the build. Each deal type drives the fields the retailer sees.

- **D1 Open deal (open RTB, real-time).** D1.1 set up → approve → bid above floor wins at its own price, handed off, billed on realised VAC-d. D1.2 below floor → default, nothing booked. D1.3 highest of several clears first price. D1.4 an open window cannot be reserved as a deal. D1.5 real-time per impression: the player signals, the request is cut to the impression, a bid above the floor fills first price, proof of play logged.
- **D2 Private auction.** D2.1 deal type drives fields (`auctionCloses` captured, committed plays not). D2.2 invited buyer: approve → bid carrying the deal ID wins, handed off, billed at the cleared rate. D2.3 uninvited buyer, a bid without the deal ID, and a bid under the floor are refused. D2.4 two-period: first clear locks the rate; later windows book at it; outside-term bids refused.
- **D3 Preferred deal.** D3.1 no committed plays/auction window. D3.2 reserve at the agreed rate, held outside the auction, billed realised VAC-d at that rate. D3.3 the list is authoritative: a reservation naming guaranteed → 409; a bid, or one under the floor → refused.
- **D4 Programmatic guaranteed.** D4.1 committed plays are none at creation and a typed figure is refused. D4.2 committed volume = floor(forecast × (1 − buffer%)), carried to DV360 as PG, billed realised (no make-good). D4.3 the buffer is the retailer's. D4.4 same figure in each DSP's own deal shape. D4.5 a reserved window cannot be sold again. **D4.7 one deal covers the whole delivery term:** committed plays are derived from the assigned slot over the range (floor(forecast plays per day × days × (1 − buffer%))), drop when the range is shortened, and a single day is a one-day range; changing slots or dates on a shared deal asks for confirmation and a re-share (`test/pg-term.test.ts`). **D4.6 24-hour PG (AWS demo path 2):** one slot booked for exactly 24 hours (`windowEnd − windowStart` = 24 h) at the fixed agreed CPM with guaranteed impressions = floor(forecast × (1 − buffer%)); no auction runs on that window; the full day is billed once at the fixed CPM on realised views; the next day is untouched. Playing the pre-approved creative for the 24 hours is PH Core's (rehearsal checklist), not asserted here.
- **D5 Computer Vision gender on a deal (personalised).** D5.1 guaranteed: Male targeting accepted, volume from the gendered forecast, personalised-eligible. D5.2 the same targeting on **open real-time** → `targeting_not_supported` (consistent with the v2.9 decision). D5.3 preferred variant personalised-eligible. D5.4 private-auction variant: gendered bid clears, first win locks the rate, later windows book at it, personalised-eligible.

*In the AWS POC, PG (D4) is **demo path 2** (booked for a full 24 hours, creative managed in PH); private auction (D2) and preferred deal (D3) are out of scope and greyed out; they are tested here as built.*

## Run 8 — AWS demo: creative IDs (`e2e/run8-aws-demo.test.ts`; walkthrough `docs/dsp-integration/AWS-DEMO-TEST-FLOW.md`)

The person-run walkthrough is repo-only; this describes its automated twin. Admin table suite: "Upcoming Campaign Approval — creative IDs" in `apps/admin/test/dsp-integration.test.tsx`.

- **Direct advertiser submission flow (Partner API → retailer approval → creative ID).** D1 two submissions wait with no creative ID; the retailer approves both into one new creative ID. D2 a selection spanning two advertisers is refused whole. D3 a rejection carries the reason back; the fixed creative is resubmitted and joins an existing creative ID. D4 updating an approved creative is a pending edit that keeps its creative ID while the approved version keeps running. D5 an advertiser that does not require approval is approved on submission and groups its own campaigns (`assignCreativeId`). D6 an approved, activated campaign bids and is booked.
- **DSP flow.** S1 a new creative on a bid is queued, discarded for that window, approved into a creative ID, then wins the next. S2 a second creative from the same advertiser joins the first one's creative ID. S3 a rejected DSP creative stays out of the auction, with the reason.
- **W-series — added in v2.9** (cases Run 8 does not yet have; all via the retailer's Upcoming Campaign Approval table):
  - **W1 Per-campaign approval into creative IDs.** `approveAndAssign` approves the ticked campaigns of one advertiser into a new or existing creative ID; the per-campaign status and `creativeId` read back through the Partner API.
  - **W2 Auto-approved advertisers group their own.** `assignCreativeId` (Generate / Assign to existing) offered instead of Approve/Reject; the retailer approval path refuses them. (= D5, assert at the API seam.)
  - **W3 A campaign's deal association is a set.** A campaign can be associated with several deal IDs; adding/removing one leaves the others; the set carries to `pmp.deals` and to approval → creative ID.

## Run 9 — Flow 0: retailer setup (AWS demo setup flow)

Surface: HQ Admin (UI) + admin API. Tests: `advertisers.test.ts`, `users.test.ts`, `delete-display-type.test.ts`, `admin/test/delete-display-type.test.tsx`.

- **Z1 Create a direct advertiser (no DSP).** The retailer creates an advertiser with no DSP connection; it appears in Advertisers / Inventory flagged direct, with no seat IDs. It is **not offered in a slot's Assigned to** and a save naming it there is refused 400, pointing to Direct advertiser deals (= X1a; `run10-direct-deals.test.ts`).
- **Z2 Register an advertiser user scoped to that advertiser.** HQ admin creates an advertiser **user** whose scope is **that advertiser only**; the user cannot see or act on any other advertiser's data (404, no IDOR). Repeat for a DSP advertiser (Flow 2 user).
- **Z3 Block display-type delete while advertiser slots are assigned.** Deleting a display type whose slots are assigned to advertisers is refused with the reason; unassign, then delete succeeds.

## Run 10 — Flow 2 (private auction) uncovered elements and Flow 3 (direct advertiser)

### Y. Private auction elements (Tests: `deal-sheet.test.ts`, `buyers-list-term-versions.test.ts`, `buyers-list-draft-share.test.ts`, `personalised-on-deals.test.ts`)
- **Y1 One deal ID per invited DSP, immutable.** Each invited DSP gets its own deal ID at creation; editing the list never changes an issued ID; a bid must **quote its own DSP's ID** — another DSP's ID is refused.
- **Y2 Deal sheet.** The deal sheet is available as **JSON and CSV** with the same content: deal ID per DSP, floor, term, invited seats.
- **Y3 Buyers-list term versioning and re-acceptance warning.** Changing a list's term creates a new version; invited buyers who accepted the old version are warned they must re-accept; bids under the old version follow the stated rule.
- **Y4 Buyers-list priority waterfall per slot.** A slot's assigned lists are ranked; the higher list is offered first; **deals rank above the Open auction separator**, so a deal list is tried before open real-time.
- **Y5 Personalised on a private deal.** A personalised campaign on a private deal is accepted (B5); the same on open real-time is refused (E6). Available targeting follows the enabled criteria.

### X. Direct advertiser relationship (Flow 3), through a Direct advertiser deal
Fixture: a **direct advertiser** (Red Bull, no DSP) with a **finalised Direct advertiser deal** on a slot: an internal PH deal ID (`PH-` + 10 characters), flight dates and a price (fixed CPM or a total for the term). **No bid, no auction, nothing in Assigned to; billed outside the platform, revenue recorded and reported in the platform.** Tests: `run10-direct-deals.test.ts` (unit-level cases per ticket in `direct-deals.test.ts`, `advertisers.test.ts`, `clear-direct-slots-migration.test.ts`, `direct-deal-revenue.test.ts`).
- **X1a Never in Assigned to.** A save that names a direct advertiser in a slot's Assigned to is refused 400 and points to Direct advertiser deals. (Migration 0082 cleared the old assignments; a slot with a live booking was locked instead.)
- **X1b The deal.** The deal has an immutable internal PH deal ID, flight dates and one price (fixed CPM or term total, never both), one direct advertiser as buyer, no DSP seat, no deal sheet entry, no acceptance.
- **X1c Reserved, no bid.** Once finalised the deal reserves its slot for the flight: windows read Reserved, the exchange sends **no bid request**, the open real-time auction does not sell the slot, and only that advertiser's approved, activated campaigns play. Outside the flight nothing is reserved.
- **X1d No overlap.** Two reserving deals (Programmatic guaranteed or Direct) never overlap in time on a slot: assigning or re-dating into an overlap is refused 409 naming the deal, advertiser, slot and dates; disjoint flights on one slot are accepted.
- **X2 Revenue recorded, not invoiced.** Plays on the slot produce a **revenue line item per window at the deal's rate** (`partnerId: direct`) on realised delivery, and the Booking schedule's booked/billed revenue includes it, labelled "Name (Direct)"; the platform generates **no invoice**. (The direct advertiser is billed outside PH. Test: `direct-deal-revenue.test.ts`.)
- **X3 Own deal ID.** The advertiser's campaigns may carry its own PH deal ID, listed by `GET /admin/v1/advertisers/{id}/deals` (finalised deals whose term covers the date). Another advertiser's ID is refused 400. A campaign with no deal ID still plays on the deal.
- **X4 Localised and personalised variants accepted** on that slot, per the targeting elements the retailer has enabled (shared variables and defined values); a variant on an unenabled element is refused `validation_failed`; booking is `personalised_eligible`.
- **X5 Hand-off.** An approved campaign on the slot is handed off with the right asset version (verify the booking, not playback). Several campaigns on the slot are first-eligible-wins, one per slot and window.

## Run 11 — Advertiser in HQ Admin (authoring journey)

Closes the gap that Run 6's advertiser side is Partner API only. **Driven entirely through the HQ Admin UI**, logged in as an advertiser user. Run **twice, identically but for the deal ID**:

- **Run 11A — Direct advertiser (Flow 3):** campaigns may carry the advertiser's **own PH deal ID** (from its Direct advertiser deal), never another advertiser's; revenue shown as direct, no invoice.
- **Run 11B — Private-auction DSP advertiser (Flow 2):** campaigns **are associated with a deal ID** (the buyers-list deal), which carries to the bid (`pmp.deals`) and to approval → creative ID.

Cases (each id suffixed A or B for the run):
- **H1 Login.** The advertiser user (Z2) logs in to HQ Admin; sees advertiser-scoped navigation only.
- **H2 Launch New Campaign — filtered choices.** Shows **only touch points and display types with slots assigned to this advertiser**; nothing else appears.
- **H3 Targeting tab.** Shows **only shared targeting variables**, with their **defined values in dropdowns**; held-back attributes do not appear.
- **H4 Variants.** Authors **default, scheduled, localised and personalised** variants through the standard flow (B: with the deal ID selected/associated).
- **H5 Campaigns 2–5 and prioritisation.** Creates campaigns 2–5 on the same touch point and sets prioritisation; the list shows **only this advertiser's campaigns** and enabled touch points.
- **H6 Max.** A **6th campaign is refused** at the ad-inventory max (default 5); `422 too_many_versions`-style message in the UI.
- **H7 Filtered campaign table.** The advertiser-filtered table shows only their campaigns, moving **Awaiting approval → Approved**, plus **Live / Not Live**.
- **H8 (B only) Deal ID carries through.** The bid quotes `pmp.deals` with the DSP's own deal ID (Y1); approval assigns the creative ID.

## Demo playback — out of scope here

On-screen playback is **PH Core's** and is never covered by this suite: the creative playing, the **localised swap** and the **CV personalised variant**. We assert only what this build owns — the booking, the approved asset version, the targeting stored and handed off, billing. The 10 Dec 2026 demo needs a **separate rehearsal checklist** for playback, run on real screens; steps in the AWS demo flows that depend on it are marked **PH Core** below and never filed as bugs here.

## AWS demo coverage map (10 Dec 2026)

| Demo step | Case ids |
|---|---|
| Flow 0 setup: connect DSP, create display type & slot, exchange settings | J0–J5, Z1–Z3 |
| Path 1 open auction (no targeting; Monster, PepsiCo, Mars Wrigley bid 35 s before play; highest bid wins, creative from the bid response): approve creative, fill, floor, proof of play | A1–A8, B1–B7, C1–C3, D1–D3, Run 7 D1, Run 8 S1–S3 |
| Path 2 programmatic guaranteed (Coca-Cola books a slot for 24 h at a fixed price; pre-approved creatives managed in PH; targeting and scheduling rules run by PH Core) | Run 7 D4.1–D4.7 (D4.6 = the 24 h booking; D4.7 = the delivery term); booking and approval cases in Run 8 D1–D6 |
| Path 3 advertiser direct (Red Bull, managed entirely in PH, no DSP): slot reached only through a Direct advertiser deal (PH deal ID, flight dates, price), billed outside the platform (revenue recorded and reported), several prioritised campaigns | Z1–Z2, X1a–X1d, X2–X5, Run 11A, Run 8 D1–D6 |
| On-screen playback, localised swap, CV personalised variant, PWA campaign triggering | **PH Core — out of scope** |
| Private auction, preferred deal, targeting on deals and open auction | **Out of POC scope** (greyed out); Run 2–3, Run 7 D2–D3/D5 and P/Y cases tested as built, not demoed |

*Status of v2.9 cases:* Run 1 A6–A8/B6/B7, Y1–Y3, Z1–Z3 have existing unit/API tests (files named per case). **B5a, W1–W3, Y4 and Run 11 are specified here and are not yet automated**; X1a–X5 are automated (v2.12, `run10-direct-deals.test.ts`) — they are listed in the E2E Test Results doc as *specified, not run* until the test code lands. Any failing case → a bug ticket per *Raising tickets on failure*.

---

## Run 6 — Full user journey (real-world customer flows)

**Purpose (Rob, 29–30 Sep 2026):** test the real customer experience end to end across the **two surfaces this build owns** — the retailer admin UI and the advertiser Partner API — and the **handoffs between them**. Deliberately not fully mocked.

**Scope (v2.4).** This build is the **exchange**. PH Core owns displays, stores, store segments, CV measurement, playback, and **which version renders on a screen** (*Boundaries with PH Core*). Run 6 therefore takes **an existing screen with an assigned advertiser slot as given** and tests everything downstream that this build owns: inventory over the Partner API, campaign creation, creative validation, targeting stored and returned unchanged, approval, the auction against the correct floor, the hand-off booking, and billing on reported plays. Anything that needs a physical screen or PH Core's version choice is out of scope — noted, never filed.

**Surfaces.** Scripted: `npm run e2e:journey` drives both sides through the Admin and Partner APIs. Browser fallback: retailer side in **Chrome**, admin UI only; advertiser side in **Claude Code**, Partner API `/v1` only. Both against the **same local instance**. The hosted prototype can't be seeded or ticked, so Run 6 runs locally.

**Creative package:** generated by `apps/api/test/journey/fixtures.ts`; no zip checked in. Advertiser: an **existing** Google DSP advertiser (Swisse). 1920×1080 canvas. Mandatory default layer plus four targeted versions, and a portrait asset that must be refused. The creatives are 1280×720 / 1365×768, so K2 is also the aspect-ratio acceptance test (ratio ±5%, ≥50% of canvas).

### J. Retailer setup (BROWSER)
- **J0** Google DSP connected and Live; advertiser Swisse exists; `store.cv_gender` enabled for `p_google`.
- **J1** Create a display type (canvas 1920×1080); verify it saves and its playlist auto-creates.
- **J4** Expose a slot as **Advertiser** inventory for Google DSP. Record the slot's Floor CPM (inherited or overridden), max campaigns, billing unit and base floor.
- **J5** Confirm the slot in Available Inventory, and no longer Unassigned once displays are seeded.

### K. Advertiser demand (CLAUDE CODE, Partner API)
- **K0** `GET /v1/inventory` sees the browser-created slot with the expected floor — proves the browser→API seam.
- **K1** `POST /v1/campaigns` with the package body → 201.
- **K2** Upload each creative; checks run. Compliant assets pass with a content hash; the portrait asset is refused.
- **K3** Submit → Awaiting approval; `GET /v1/campaigns/{id}` returns all targeted versions and rules **unchanged**, priorities included.

### L. Approval, auction, hand-off, billing
- **L1** (Browser) The submission appears in approvals; approve → Approved.
- **L2** (Claude Code) A bid at/above the base floor wins; a bid below it is refused `below_floor`.
- **L3** Hand-off: a booking is written for that slot and window. Verify the booking, not playback.
- **L4** Billing: once plays are reported for an ended window, the line item bills realised VAC-d at the cleared CPM; nothing for unplayed.
- **L5** Continuity: the campaign from K, on the slot from J, is booked and billed; ID, slot, stored versions and targeting carry through.
- **L6** Fall-through: a window with no eligible winner gets **no booking**; no advertiser billed.

### Notes for Run 6
- The value is the seams between the two surfaces this build owns.
- Any in-scope deviation is a **bug** — title `E2E run 6: <case id> — <symptom>`.
- Record the instance and token used; reset demo data afterwards.

---

### M. Rescope cases (each asserted by the named test in `apps/api/test/`, not by the journey)
- **M1 Unscored slot.** Absent from inventory and forecast, bid refused `409`, auction skips it; scoring it makes it appear. `unscored-slots`
- **M2 Default VAC-d.** Display type default VAC-d scores its slots; a per-display override (0035) replaces it for that display; inventory, forecast and OpenRTB agree. `default-vacd`
- **M3 Slot lock.** `salesLocked` (ZlxFSBGN) refuses new sales; removing a blocked advertiser is refused while booked; auto-release when the lock ends; locked → bid/reserve 409, auction skips, window unavailable. `slot-lock`, `sales-lock-enforcement`
- **M4 Partial-estate billing.** All three billing modes (nclfSAn1): bills realised VAC-d on reported plays only. `handoff-billing`
- **M5 Named regression gates.** The Billing module seam (`billing/index.ts`) and `DspProvider` modules: their tests must stay green (xrhecwd5). `billing-module`, `dsp-providers`
- **M6 Max campaigns.** 6 versions on Max-5 → `422 too_many_versions` (bid, reserve); OK on Max-10; `maxCampaigns` on the position. `max-campaigns`
- **M7 Null tier.** A play with no tier bills at the committed price, as default. `personalised-billing`
- **M8 Billing idempotency.** Second `billReservation` → one line item. `billing-module`
- **M9 Tx lock.** Overlapping transactions never interleave; rollback drops caches. `tx-lock`
- **M10 Venue.** `dooh.venuetype` and inventory venue follow the seam value. `auction`
- **M11 Global deal ID.** The resolver puts the global deal ID on an open slot's `pmp.deals`, suppresses it when the slot is held/whitelist-only/blacklisted or the master switch is off, and honours the per-slot opt-out. `global-deal`
- **M12 Category list resolution.** A category-scoped buyers list resolves to the synced seats whose category matches, live (a new in-category seat joins with no re-save), minus the blacklist. `buyers-list-category`

## Known gaps — record, don't file as bugs

- Engagements not billed; interactive cost-per-engagement unbilled in this build.

Closed 29 Sep (cases assert the decision): OQ52 (R3, R4), OQ27 (T7), Q38/Q40 (G2, T4). Behaviour differing from a gap as described **is** a bug — file it.

## Raising tickets on failure

For each distinct failing case, `create_backlog_item` on projectId `mIPdOCAWevhrgD8g2tCZ`, type **bug**:
- **Title:** `E2E <run>: <case id> — <one-line symptom>`.
- **Description:** case id and intent, expected vs actual, stub inputs (or browser/API steps for Run 6), repro command, and the REQUIREMENTS section (§3 approval, §4 pricing/billing, §5 inventory, §6 submission, §7 exchange).
- **Area:** best fit (Backend / Infrastructure, Pricing & Offers, Product Assets).
- Before filing, `list_backlog_items` with the case id (search covers archived tickets too; if the tool has `includeArchived`, pass `false`, otherwise read each match's `status`). Comment only on a match in Backlog, Ready for Testing or Approved for Deployment. A match that is archived or already Deployed means the bug came back: file a new ticket that names the old id. If two cases share a root cause, file both and cross-reference. Keep case ids stable across runs.
