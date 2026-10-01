# Campaign approval: plugging it into the existing Campaigns section

This is for the engineering team merging this POC into the main Personalisation Hub
repo.

Approval (spec §3) is built as one self-contained module,
`packages/campaign-approval/`, so it can go into the existing campaign table
at code review with minimal work. It imports nothing from the rest of the
app. Its only seam to the real campaigns is the **`CampaignSource`** adapter.

```
packages/campaign-approval/
  src/adapter/CampaignSource.ts     the interface you implement (step 1)
  src/adapter/pocCampaignSource.ts  the POC's implementation (reference only)
  src/server/                       state machine, approval store, service, routes, isCampaignEligible
  src/ui/                           ApprovalStatusBadge, ApprovalActions, ApprovalStatusFilter,
                                    ApprovalReviewPanel, useCampaignApprovals
  migrations/0100_campaign_approvals.{up,down}.sql
  tests/contract.ts                 contract suites to run against YOUR adapter (step 6)
```

- **Approval state is stored beside the campaign, not inside it.**
  - `campaign_approvals` holds one row per campaign and asset version:
    `status`, `mode` (manual or auto), `submitted_at`, `reviewed_by`,
    `reviewed_at`, `reason` and `checks`.
  - `campaign_approval_audit` is append-only.
  - Spec §8's campaign fields (`status`, `approval{…}`) are the target shape.
    Step 4 explains how to move them onto the campaign record if you prefer.
- **API** (contract: *Admin — Campaign approval*):
  - `GET /admin/v1/approvals?status=`
  - `GET /admin/v1/campaigns/{id}/approval`
  - `POST …/approve`
  - `POST …/reject` — `reason` (required, overall) plus an optional
    `assetReasons: [{assetId, reason}]` naming specific assets (spec §3,
    "asset-level rejection").
  - `POST …/unreject` — undo a mistaken rejection, back to Awaiting approval; never auto-approves.
  - Approve, reject and unreject are HQ Admin role only (Q39 default).

---

## 1. Write the real `CampaignSource` adapter

Implement the five methods against the existing campaign service:

```ts
import type { CampaignSource } from '@ph-dsp/campaign-approval/adapter'

export function platformCampaignSource(campaigns: CampaignService, assets: AssetService, targeting: TargetingService): CampaignSource {
  return {
    async getCampaign(id) {
      const c = await campaigns.get(id)
      return c && toRef(c)            // CampaignRef: see adapter/CampaignSource.ts
    },
    async listCampaigns(filter) { return (await campaigns.list(filter)).map(toRef) },
    async setActivation(id, enabled) { return toRef(await campaigns.setActive(id, enabled)) },
    onCampaignChanged(listener) { return campaigns.subscribe((e) => listener(e.campaignId)) },
    // Q38: a rejected edit is thrown away; the version named is current again.
    async discardEditsAfter(id, assetVersion) { await assets.revertTo(id, assetVersion) },
  }
}
```

What each `CampaignRef` field must hold:

| Field | Source in the platform |
|---|---|
| `source` | `hq` for HQ-authored campaigns (they skip approval); `api` or `dsp` for advertiser campaigns |
| `advertiserId`, `advertiserName`, `partnerId`, `partnerName` | The campaign's advertiser and the DSP it came through |
| `activation.enabled` | The existing activation flag |
| `assetVersion` | Any string that **changes whenever the creative changes** (e.g. the latest asset revision id). Approval is per version |
| `targetingSummary` | A readable rendering of the campaign's targeting rules (the POC's is `apps/api/src/domain/targetingSummary.ts`) |
| `creative` | The default layer's creative `{assetUrl, mimeType, width, height, contentHash?}`, or `null` |
| `canvas` | The target display type's `displayCanvasSize`, or `null` |
| `assets` (optional) | Every asset of the current version, one per role (`default` or a targeted version id), each `{assetId, contentHash}` with `contentHash` the sha256 of the file. What safe reuse compares (Q40). Leave it out and nothing is ever reused |

`assetVersion` must **never repeat**, even after `discardEditsAfter` has
thrown a later version away: the audit trail names versions, and a reused
id would make a rejected edit and a new one indistinguishable (the POC
numbers asset rows monotonically and marks a discarded edit's rows rather
than deleting them — migration 0031).

Then create the service with it:

```ts
import { createApprovalService, approvalRoutes } from '@ph-dsp/campaign-approval/server'

const approvals = createApprovalService({
  db,                                                       // anything with exec() and prepare()
  campaigns: platformCampaignSource(/* … */),
  requiresApproval: (advertiserId) => advertiserSettings.get(advertiserId).approvalRequired,  // Advertisers screen
})
app.register(approvalRoutes(approvals, {
  guard: (req) => requireFlag(req, 'dspIntegration'),
  requireApprover: (req) => requireRole(req, 'hq_admin'),   // Q39 default
  reviewer: (req) => req.user.email,
}), { prefix: '/admin/v1' })
```

When a campaign's **assets or targeting change**, call
`approvals.changed(campaignId, actor)`. For an advertiser that requires
approval the new version goes to *Awaiting approval* as a **pending edit**,
and the approved version **keeps running** until it is decided (Q38,
resolved by Rob, 29 Sep 2026 — final, not a setting):

- **The approved version is the newest approved approval row**
  (`approvals.liveAssetVersion(campaignId)`); it stays eligible for
  reservation, bidding and hand-off throughout the review, and stays
  activated. Nothing is snapshotted: approval rows are already per
  `assetVersion`, so the host resolves the live version to its assets at
  hand-off (the platform seam's `latestAssets(campaignId, atVersion)`, which takes this adapter's `assetVersion` string as it is: a real adapter's value is "any string that changes", so the platform seam, not the host, resolves it), and books
  exactly that version (`SlotBooking.assetVersion`).
- **Approving the edit** makes it the newest approved row in one write: the
  next hand-off books the new creative, every earlier one booked the old,
  and eligibility never lapses in between — no dark window, no double run.
- **Rejecting the edit** discards it: `discardEditsAfter` drops its assets,
  its approval row goes, and the campaign is back at the live version,
  *Approved*. The `rejected` and `edit_discarded` audit entries stay, and
  the view's `rejectedEdit` carries the reason until the next edit.
- A campaign that has never been approved is unchanged: nothing runs until
  it is, and rejecting it is a plain rejection.

`changed()` (and `submit()`) also apply **safe reuse** (Q40): if every
asset of the new version (`CampaignRef.assets`) and its targeting rules are
byte-identical to what a human last approved, the version is approved
without review (audit `reused_clearance`). Otherwise the reviewer is told,
by an advisory `previously_cleared` check, which assets are unchanged.

## 2. Place the components in the existing campaign table

Every component takes props only. Load approval state for the rows on screen
with `useCampaignApprovals`:

```tsx
import { useCampaignApprovals, type ApprovalClient } from '@ph-dsp/campaign-approval/ui'

const client: ApprovalClient = {
  getApproval: (id) => api.get(`/admin/v1/campaigns/${id}/approval`),
  // Optional, and worth it: the table's rows in one request per 200, not one per row.
  listApprovals: (cursor) => api.get(`/admin/v1/approvals?limit=200${cursor ? `&cursor=${cursor}` : ''}`),
}
const { approvals, reload } = useCampaignApprovals(rows.filter((r) => r.source !== 'hq').map((r) => r.id), client)
```

Without `listApprovals` the hook asks once per row (the POC's Campaign
Status made 31 requests a visit that way; page-load review, 24 Sep 2026).
With it, rows come from the paged list and only a row the list doesn't cover
is fetched on its own. A single campaign always uses `getApproval`, which
returns the full view (creative, canvas, audit).

**Status column:**

```tsx
// before
{ headerName: 'Status', cellRenderer: ({ data }) => <StatusDot status={data.state} /> }
// after
{ headerName: 'Status', cellRenderer: ({ data }) => approvals[data.id]
    ? <ApprovalStatusBadge status={approvals[data.id].status} mode={approvals[data.id].mode} />
    : <StatusDot status={data.state} /> }
```

**Filter above the table** (counts come from `GET /admin/v1/approvals`):

```tsx
// before
<div className="flex justify-between"><div><b>{count}</b> Campaigns</div>{actions}</div>
// after
<div className="flex justify-between">
  <div><b>{count}</b> Campaigns</div>
  <ApprovalStatusFilter counts={counts} value={statusFilter} onChange={setStatusFilter} />
  {actions}
</div>
```

**`ApprovalActions` wrapped around the existing activation toggle:**

```tsx
// before
<Switch checked={row.active} onChange={(v) => setActive(row.id, v)} />
// after
<ApprovalActions
  status={approvals[row.id]?.status}          // undefined for HQ campaigns: the toggle renders as before
  canApprove={user.role === 'hq_admin'}
  onApprove={() => approve(row.id, approvals[row.id].assetVersion).then(reload)}
  onReject={(reason) => reject(row.id, approvals[row.id].assetVersion, reason).then(reload)}>
  <Switch checked={row.active} onChange={(v) => setActive(row.id, v)} />
</ApprovalActions>
```

**Review panel on row open:**

```tsx
// before
<CampaignDetail id={openId} />
// after
{approvals[openId]
  ? <ApprovalReviewPanel approval={await client.getApproval(openId)} canApprove={isHqAdmin}
      onApprove={…} onReject={…} onClose={() => setOpenId(null)} />
  : <CampaignDetail id={openId} />}
```

(`getApproval` returns the full view: creative, canvas, targeting summary,
checks and audit trail.)

**Undo rejection, in the row's options/overflow menu:**

```tsx
{
  key: 'unreject',
  label: 'Undo rejection',
  disabled: approvals[row.id]?.status !== 'rejected' || !isHqAdmin,
  onClick: () => unreject(row.id, approvals[row.id].assetVersion).then(reload),
}
```

Also wire `onUnreject` on `ApprovalReviewPanel` the same way, so the action
is available from the review view too — it only renders once the campaign
is Rejected and the host passes the prop. `unreject` (`POST
…/campaigns/{id}/unreject`, `assetVersion` plus an optional `reason`)
reverses `Rejected` back to `Awaiting approval` for a fresh decision; it
never auto-approves. Same permission as approve/reject.

## 3. Where the main repo must call `isCampaignEligible`

`approvals.isCampaignEligible(campaignId)` returns `true` only for an HQ
campaign or an advertiser campaign with an approved version — including one
whose later edit is awaiting approval (Q38). It is the one enforcement hook.
Call it wherever eligibility is decided:

- **Activation**: before setting a campaign active. An unapproved campaign
  can't be activated, and the existing platform only plays active campaigns,
  so playback itself needs no change.
- **Inventory reservation** (`POST /v1/reservations`, type `reserve`).
- **Bidding**: a bid whose `crid` isn't an approved campaign is dropped before
  the auction clears.
- **Hand-off** of a won or reserved campaign to the campaign system. The
  campaign system's booking (`CampaignSource.bookSlot`) must accept **at
  most one campaign per slot and play window** and fail a second one: the
  hand-off treats that failure as "already booked" and records why
  (migration 0021 on the stand-in; PH-CORE-BOUNDARIES.md → "What each seam
  must guarantee").

In this POC the activation check lives in `approvals.setActivation`, used by
`PUT /admin/v1/campaigns/{id}/activation`. Reservation, bidding and hand-off
call it (`apps/api/src/exchange/enforcement.ts` → `checkCampaign`), and they
also require the campaign to be **activated**: an advertiser can only bid or
reserve with an approved, activated campaign, so a winner fits straight into
the slot (Rob, Q14).

**Safe reuse (ticket, 22 Sep; wired in, Q40, 29 Sep 2026).** `submit()`
and `changed()` call it themselves — there is nothing for the host to wire,
beyond listing each asset's `contentHash` in `CampaignRef.assets` (and in
`creative`). `approve()` records a human clearance for every listed asset
and for the targeting rules; `submit()`/`changed()` approve a version
without review only when all of them are cleared at their current content.
An auto-approval never clears anything. `approvals.wasAssetHumanCleared(
campaignId, assetId, contentHash)` stays available for a host that wants to
ask about one asset.

**DSP creatives (Q40).** PH's approval is the source of truth. A DSP's own
creative audit (DV360 review status, The Trade Desk `approvedBy`, Amazon DSP
moderation) is recorded as an **advisory** `dsp_audit` check — shown to the
reviewer, never approving or blocking on its own. Each DSP reads its own
audit shape in its provider module (`DspProvider.auditCheck`, in
`apps/api/src/dsp/`), and `apps/api/src/domain/dspAudit.ts` turns the
verdict into the check. Pre-approval is keyed on the DSP
creative ID and the content hash: a crid's campaign id is derived from
(DSP, crid) (`dspCampaignId`), so a human clearance of that campaign's
creative is a clearance of that crid at those bytes, and the same crid
retrieved again with identical bytes is not re-audited.

## 4. Run the approval migration, or move the fields onto the campaign

- **Beside the campaign (default).** Run
  `migrations/0100_campaign_approvals.up.sql` and
  `migrations/0101_asset_level_rejection.up.sql` (asset-level rejection
  detail + the safe-reuse clearance table, ticket 22 Sep) with your
  migrator, in that order; each `.down.sql` reverts its own migration.
  Nothing in the campaign table changes.
- **On the campaign record (spec §8's target shape).** Add `status` and
  `approval` (JSON: `mode`, `assetVersion`, `submittedAt`, `reviewedBy`,
  `reviewedAt`, `reason`, `checks`) to the campaign table. Then replace
  `src/server/approvalStore.ts` with an implementation that reads and writes
  them. The store's interface (`get`, `latest`, `liveVersion`, `rows`,
  `upsert`, `remove`, `audit`, `auditTrail`, `recordHumanClearance`,
  `isHumanCleared`) stays the same, so the service, routes and UI
  don't change. Keep `campaign_approval_audit` append-only either way.

## 5. Delete the stand-in POC table

Delete `apps/admin/src/features/campaign-status/`, and its nav item and route in
`apps/admin/src/App.tsx` (marked *STAND-IN*). Nothing else imports from it.
The stand-in's nav item and route are shown only while the retailer has DSP
integration switched on (`selling` in `navFor`, `WhileDspOn` on the route;
24 Sep 2026). Both go with it: the platform's own Campaigns section is not
governed by that switch.
The POC-only campaign endpoints (`GET /admin/v1/campaigns`,
`PUT /admin/v1/campaigns/{id}/activation`, tagged *POC stand-in*) are
replaced by the platform's own.

## 6. Contract tests to run after plugging in

The suites are written against the adapter, not the POC store. Run the same
suites against your adapter:

```ts
// campaign-approval.contract.test.ts in the main repo
import { runApprovalContract, runCampaignSourceContract } from '@ph-dsp/campaign-approval/contract'

const make = async () => ({
  source: platformCampaignSource(/* test doubles or a test database */),
  db: testDb,
  requiresApproval: () => true,
  fixture: {
    advertiserCampaignId: 'an-advertiser-campaign-not-yet-submitted',
    hqCampaignId: 'an-hq-campaign',
    changeCreative: (id) => uploadNewCreativeRevision(id),
  },
})
runCampaignSourceContract('platform adapter', make)
runApprovalContract('platform adapter', make)
```

Also run the component contract tests in
`packages/campaign-approval/tests/components.test.tsx` unchanged: they
check each component's props in and behaviour out.

In this repo the suites pass against both the in-memory reference adapter
(`packages/campaign-approval`) and the POC adapter
(`apps/api/test/approvals.test.ts`).

## One real source, two facets

The POC has two `CampaignSource` interfaces on purpose: this adapter's (five
methods, a `CampaignRef` view, string versions) and the host's
(`apps/api/src/platform/CampaignSource.ts`: also `createCampaign`,
`addAsset`, `latestAssets`, `bookSlot`, `bookings`). Keep them separate: the
approval module must not be able to book or create. On integration build
**both from one real campaign source in `context.ts`** (one object, two
facets) so they agree on identity and order (`listCampaigns` is ordered by
creation, then id, on both).

`onCampaignChanged` belongs to this adapter only. The host's interface has no
change feed (nothing in the exchange subscribes). When the real source emits
changes, fan them out from that one source to this adapter's listeners; there
is no second listener set to keep in step.
