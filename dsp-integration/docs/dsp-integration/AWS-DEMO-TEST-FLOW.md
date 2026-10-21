# AWS demo — test flow (10 December 2026)

A walkthrough a person can follow to check how demand reaches a
retailer (the three AWS POC paths below), end to end, against the current spec: REQUIREMENTS.md §3 "Retailer
review" and "Creative IDs". Written 10 Oct 2026 (ticket ZHPV0Lj5N883RKGfYThw).

**Automated twin:** every step below has a case in `apps/api/test/e2e/run8-aws-demo.test.ts`
(`cd dsp-integration && CI=1 npm run e2e:quick`, no network) and the table's
behaviour is the "Upcoming Campaign Approval — creative IDs" suite in
`apps/admin/test/dsp-integration.test.tsx`. Run those first; this document is
for the person-run rehearsal on the hosted or local POC. If a step and its
automated case disagree, fix whichever is stale.

## The three demand paths, in demo order

Walk the demo in this order. The full definition is in REQUIREMENTS.md → "AWS POC demand paths".

1. **Open auction** (section C): no targeting; Monster, PepsiCo and Mars Wrigley bid through the DSPs on the same slot 35 seconds before play; the highest bid wins and plays the creative in its bid response.
2. **Programmatic guaranteed**: Coca-Cola books a slot for 24 hours at a fixed price. Its pre-approved creatives (Coca-Cola, Coke Zero, Sprite, Fanta, Schweppes, Namthip water) are managed in PH with targeting and scheduling rules (hot/cold store segments) that PH Core triggers on the PWA player. Not a DSP bid response. Walk it in section E; its automated case is Run 7 D4.6.
3. **Advertiser direct** (section F): Red Bull, managed entirely within PH, no DSP; the slot is reached only through a **Direct advertiser deal** (internal PH deal ID, flight dates, price), never by naming Red Bull in Assigned to; several prioritised campaigns on one slot; billed outside PH, revenue recorded and reported. Section B is the approval-table flow for campaigns, which a direct advertiser's campaigns also use.

Private auction and preferred deal are greyed out and not demoed; targeting on deals and open auction is out of scope.

## Before you start

- **Where:** the hosted prototype
  <https://offline2online.github.io/rob_ph_demos/dsp-integration/prototype/>
  (shared, public, no login — never use real data; `prototype/build-info.json`
  says which commit it was built from), or locally `npm run dev:api`,
  `dev:mocks`, `dev:admin` then `localhost:5173`.
- **DSP integration must be on** (DSP Integration → Exchange settings → Save
  changes). If *Campaign Status* and *Advertisers / Inventory* are missing from
  the menu it is switched off.
- **The table:** Campaign schedule → second tab, **Upcoming Campaign Approval**.
- **Seed data:** Swisse requires approval (campaign *c_api_swisse* is Awaiting
  approval); Nestlé does not (*c_dsp_nestle* is Approved automatically);
  L'Oréal has a Rejected campaign. Reset the hosted data with the
  `dsp-api-deploy.yml` workflow (`reset = RESET`) for a clean run.

## A. The table (both flows land here)

1. Open Upcoming Campaign Approval. **Expect:** one row per campaign; columns
   Activation, Advertiser, Received, Status, **Campaign name**, **Touch
   points**, Creative ID, DSP, Localised variables, Personalised variables,
   Last used; no *No. of campaigns* column; rows grouped by advertiser A–Z.
2. Hover a campaign name. **Expect:** a tooltip with advertiser, DSP, touch
   points, pricing and variables. Click it: the campaign page opens.
3. **Expect** a tick box only on *Awaiting approval* rows, no per-row Approve
   or Reject, and the Activation toggle disabled until approved.

## B. Approval without a deal ID (Partner API → retailer → creative ID)

Use the Partner API with a Swisse token (`API.md`: create → upload default →
submit), or the seeded Swisse campaigns.

1. Submit two Swisse campaigns. `GET /v1/campaigns/{id}/status` → `awaiting_approval`,
   `creativeId: null`. Both appear Awaiting approval in the table. *(D1)*
2. Tick both. **Expect** the bar to offer **Approve + assign to new creative ID**,
   **Approve + assign to existing creative ID** and **Reject…**. Tick a campaign
   of another advertiser as well: **Expect** both Approve actions to disappear
   with a hint to choose one advertiser; untick it. *(D2)*
3. **Approve + assign to new creative ID.** **Expect** both rows Approved with
   the same `CR-XXXXXXXX`, and status → `approved` with that `creativeId`. *(D1)*
4. Submit a third Swisse campaign, tick it, **Reject…**. **Expect** the Reject
   button disabled until a reason is typed; then the row Rejected, and status →
   `rejected` with that `reason`. *(D3)*
5. As the advertiser, upload a corrected creative (different bytes — an
   identical re-upload is approved without review) and submit again. **Expect**
   Awaiting approval. Tick it, **Approve + assign to existing creative ID**.
   **Expect** the picker to list each Swisse creative ID with its member
   campaigns and touch points, and no other advertiser's IDs. Pick the one from
   step 3. **Expect** all three campaigns under it. *(D3)*
6. Activate an approved campaign and place a bid through the Partner API.
   **Expect** it accepted; the same bid on an unapproved campaign is refused
   `not_approved`. *(D6)*
7. **Resubmission.** Upload a changed creative to an approved campaign.
   **Expect** status `awaiting_approval` with `pendingEdit: true` and its
   `creativeId` unchanged; the approved version keeps running. In the picker the
   campaign's original ID is pre-highlighted and tagged "original
   (resubmission)", and the table shows "(resubmission)" beside its ID. Approve
   into it: `pendingEdit: false`, same ID. *(D4)*
8. **Auto-approved advertiser.** Open the Nestlé campaigns in the same table
   (or turn Swisse's *Campaign approval* off in Advertisers / Inventory and
   submit). **Expect** them Approved on submission, ticking them offering only
   **Generate creative ID** and **Assign to existing creative ID** (no Approve or
   Reject), and the retailer path refusing them. Generate, then assign a second
   campaign to the same ID. *(D5)*

## C. DSP flow (bid with a new creative → queued → approved → wins)

Needs the mocks running (`dev:mocks`) or the hosted DSP mocks, with Google
DV360 connected and the exchange on.

1. Run the auction (the mocks bid with a new `crid`). **Expect** that window's
   position has no winner and the creative appears Awaiting approval in the
   table. *(S1)*
2. Tick it, **Approve + assign to new creative ID**, and switch Activation on.
   **Expect** status Approved with a creative ID. *(S1)*
3. Run the next window's auction. **Expect** that creative to win and be handed
   off. *(S1)*
4. Bid again with a second new `crid` from the same advertiser, approve it with
   **Approve + assign to existing creative ID**, choose the ID from step 2.
   **Expect** one ID with two member campaigns. *(S2)*
5. Bid with a third `crid` and **Reject…** it with a reason. **Expect** it
   never wins, and the reason on its status. *(S3)*

## D. Floor CPM per slot (17 Oct 2026; replaced the reserve price)

Advertisers / Inventory → Available Inventory.

1. **Expect** no *Reserve price* column. The **Floor CPM** column shows the
   platform floor (Advertiser settings) on every slot, marked *inherited*.
2. Type a value above the platform floor on one slot and **Save changes**.
   **Expect** the slot shows its own value with a reset button. A bid
   request for that slot carries `imp.bidfloor` = the new value, and a bid
   below it is rejected `below_floor`. *(`bid-floor-hierarchy.test.ts`)*
3. Type a value below the platform floor. **Expect** it refused on save
   ("A slot floor can't be below the platform floor…"). *(`advertiser-settings.test.ts`)*
4. Press the reset button and save. **Expect** the slot reverts to
   *inherited* at the platform floor.
5. Change the platform floor in Advertiser settings. **Expect** every slot
   without an override follows it; a slot with its own floor keeps it.
6. A Programmatic guaranteed booking (demo path 2) is paid at its own fixed
   amount and never clears below the resolved slot floor. *(`reserve-booking.test.ts`,
   `e2e/run5-reserved.test.ts`)*

## E. Programmatic guaranteed — one deal for the delivery term (demo path 2)

Automated twin: `cd dsp-integration/apps/api && npx vitest run test/e2e/run7-deal-types.test.ts -t D4` (D4.1–D4.7).

1. Create a guaranteed deal (buyers list, deal type *Programmatic guaranteed*) with a delivery term (a date range such as 1–30 Nov; the demo can use a single day, a one-day range) and a price (fixed CPM or a total for the term). **Expect** no *Committed plays* field and no auction window. Assign one slot in Available Inventory: **expect** *Committed plays* now appears, read-only, and equals floor(the slot's forecast plays for every day of the range × (1 − buffer%)); a second slot adds its plays, a shorter range lowers it. Then share the deal with the DSP (the Coca-Cola advertiser). *(D4.1, D4.7)*
   - If you then add or change a slot (or the dates) on the **shared** deal, **expect** a warning that the committed plays will change and the deal must be re-shared and accepted again; cancelling leaves it unchanged. *(pg-term.test.ts)*
2. Book the slot for one day at the agreed fixed CPM. **Expect** the booking window is exactly 24 hours, the price is the agreed rate, and the guaranteed impressions are floor(forecast × (1 − buffer%)); the DSP receives the same figure in its own deal shape. *(D4.2, D4.4, D4.6)*
3. Try to sell that day again, by bid or a second reservation. **Expect** it refused (409). *(D4.5)*
4. After the day plays, run billing. **Expect** one bill for the full day at the fixed CPM on realised views, nothing made good if under-delivered, and none the next time. *(D4.2, D4.6)*
5. Back in section C, **expect** open auction still clears on the other slots. *(Run 7 D1, Run 8 S1–S3)*

**PH Core, not tested here:** the pre-approved creative actually playing for the 24 hours and its hot/cold store-segment targeting. Check on a real screen with the playback rehearsal checklist.

## F. Advertiser direct — Red Bull through a Direct advertiser deal (demo path 3)

Automated twin: `cd dsp-integration/apps/api && CI=1 npx vitest run test/e2e/run10-direct-deals.test.ts` (Z1, X1a–X5; in `e2e:quick`).
Superseded by this section: Red Bull named in a slot's Assigned to; a direct advertiser with no deal ID; "no billing through the platform".

1. Advertisers / Inventory: **Add** a direct advertiser (or use the seeded Red Bull). **Expect** it flagged "(Direct)" with no DSP seat IDs. *(Z1)*
2. Available Inventory, Portrait slot 3. Open its **Assigned to**. **Expect** Red Bull is not offered there; a save naming it through the API is refused 400, pointing to Direct advertiser deals. *(X1a)*
3. DSP Integration → buyers lists → **New**, Deal type **Direct advertiser**. **Expect** Private auction and Preferred deal greyed out; a single buyer chosen from direct advertisers only; flight dates; a price as a Fixed CPM **or** a Total for the term (both is refused); committed plays read-only once a slot is assigned. Save as a draft: **expect** an internal deal ID `PH-` plus 10 characters. *(X1b)*
4. Assign the deal to the slot. Add a second reserving deal (Direct or Programmatic guaranteed) whose dates overlap. **Expect** an inline warning naming the deal, advertiser, slot and overlapping dates, and Save blocked; change the dates so they do not overlap and it saves. *(X1d)*
5. **Finalise** the deal (the pop-up reads "Confirm and make deal live"). **Expect** no DSP share or acceptance, status shared, windows across the flight reading **Reserved** in availability and none outside it. *(X1b, X1c)*
6. Run an auction for a window in the flight. **Expect** no bid request sent to any DSP, no real-time sale of the slot, and one booking for Red Bull's first approved, activated campaign, handed off. With two Red Bull campaigns **expect** the first eligible wins and one booking per window. *(X1c, X5)*
7. As Red Bull's campaign author, open the deal-ID picker. **Expect** only Red Bull's own finalised deals covering the date; another advertiser's deal ID is refused 400; a campaign with no deal ID still plays. *(X3)*
8. After the window plays, run billing. **Expect** one revenue line item at the deal's rate marked Direct, and the Booking schedule showing "Red Bull (Direct)" with estimated then billed revenue (filter by DSP "direct"). **Expect** no invoice anywhere. *(X2)*

**Seed note:** `npm run db:demo` gives Red Bull and Gatorade one Direct advertiser deal each on that slot with the same flight (1 Sep 2026 to 31 Mar 2027). The no-overlap rule (step 4) postdates that seed and is not re-judged for existing pairs, so with both live the first deal in the slot's order (Red Bull) takes every window. Give Gatorade a disjoint flight to see both.

## Acceptance for the demo

- [ ] `CI=1 npm run e2e:quick` green (includes Run 8) and the admin suite green.
- [ ] Sections A, B, C, D, E and F each pass once on the hosted prototype after a reset.
- [ ] `prototype/build-info.json` names the commit under test.
- [ ] Not covered by this build, so not demonstrable: a DSP bidding *on a
  creative ID* in the exchange, and assigning an ID from the campaign detail
  page (REQUIREMENTS.md §3 "Not covered here").
