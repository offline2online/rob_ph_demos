# AWS demo — test flow (10 December 2026)

A walkthrough a person can follow to check both ways demand reaches a
retailer, end to end, against the current spec: REQUIREMENTS.md §3 "Retailer
review" and "Creative IDs". Written 10 Oct 2026 (ticket ZHPV0Lj5N883RKGfYThw).

**Automated twin:** every step below has a case in `apps/api/test/e2e/run8-aws-demo.test.ts`
(`cd dsp-integration && CI=1 npm run e2e:quick`, no network) and the table's
behaviour is the "Upcoming Campaign Approval — creative IDs" suite in
`apps/admin/test/dsp-integration.test.tsx`. Run those first; this document is
for the person-run rehearsal on the hosted or local POC. If a step and its
automated case disagree, fix whichever is stale.

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

## B. Direct advertiser flow (Partner API → retailer → creative ID)

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

## Acceptance for the demo

- [ ] `CI=1 npm run e2e:quick` green (includes Run 8) and the admin suite green.
- [ ] Sections A, B and C each pass once on the hosted prototype after a reset.
- [ ] `prototype/build-info.json` names the commit under test.
- [ ] Not covered by this build, so not demonstrable: a DSP bidding *on a
  creative ID* in the exchange, and assigning an ID from the campaign detail
  page (REQUIREMENTS.md §3 "Not covered here").
