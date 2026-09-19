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
  - `POST …/reject`
  - Approve and reject are HQ Admin role only (Q39 default).

---

## 1. Write the real `CampaignSource` adapter

Implement the four methods against the existing campaign service:

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
| `creative` | The baseline creative `{assetUrl, mimeType, width, height}`, or `null` |
| `canvas` | The target display type's `displayCanvasSize`, or `null` |

Then create the service with it:

```ts
import { createApprovalService, approvalRoutes } from '@ph-dsp/campaign-approval/server'

const approvals = createApprovalService({
  db,                                                       // anything with exec() and prepare()
  campaigns: platformCampaignSource(/* … */),
  requiresApproval: (advertiserId) => advertiserSettings.get(advertiserId).approvalRequired,  // Advertisers screen
  oldVersionRunsDuringReview: false,                        // Q38 default
})
app.register(approvalRoutes(approvals, {
  guard: (req) => requireFlag(req, 'dspIntegration'),
  requireApprover: (req) => requireRole(req, 'hq_admin'),   // Q39 default
  reviewer: (req) => req.user.email,
}), { prefix: '/admin/v1' })
```

When a campaign's **assets or targeting change**, call
`approvals.changed(campaignId, actor)`. For an advertiser that requires
approval this returns the campaign to *Awaiting approval*. With the Q38
default it also switches the campaign off until the new version is approved.

## 2. Place the components in the existing campaign table

Every component takes props only. Load approval state for the rows on screen
with `useCampaignApprovals`:

```tsx
import { useCampaignApprovals, type ApprovalClient } from '@ph-dsp/campaign-approval/ui'

const client: ApprovalClient = { getApproval: (id) => api.get(`/admin/v1/campaigns/${id}/approval`) }
const { approvals, reload } = useCampaignApprovals(rows.filter((r) => r.source !== 'hq').map((r) => r.id), client)
```

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

## 3. Where the main repo must call `isCampaignEligible`

`approvals.isCampaignEligible(campaignId)` returns `true` only for an HQ
campaign or an approved advertiser campaign. It is the one enforcement hook.
Call it wherever eligibility is decided:

- **Activation**: before setting a campaign active. An unapproved campaign
  can't be activated, and the existing platform only plays active campaigns,
  so playback itself needs no change.
- **Inventory reservation** (`POST /v1/reservations`, type `reserve`).
- **Bidding**: a bid whose `crid` isn't an approved campaign is dropped before
  the auction clears.
- **Hand-off** of a won or reserved campaign to the campaign system.

In this POC the activation check lives in `approvals.setActivation`, used by
`PUT /admin/v1/campaigns/{id}/activation`. Reservation, bidding and hand-off
call it in packages 12–16.

## 4. Run the approval migration, or move the fields onto the campaign

- **Beside the campaign (default).** Run
  `migrations/0100_campaign_approvals.up.sql` with your migrator; `.down.sql`
  reverts it. Nothing in the campaign table changes.
- **On the campaign record (spec §8's target shape).** Add `status` and
  `approval` (JSON: `mode`, `assetVersion`, `submittedAt`, `reviewedBy`,
  `reviewedAt`, `reason`, `checks`) to the campaign table. Then replace
  `src/server/approvalStore.ts` with an implementation that reads and writes
  them. The store's interface (`get`, `latest`, `upsert`, `audit`,
  `auditTrail`, `anyApproved`) stays the same, so the service, routes and UI
  don't change. Keep `campaign_approval_audit` append-only either way.

## 5. Delete the stand-in POC table

Delete `apps/admin/src/features/campaigns-poc/`, and its nav item and route in
`apps/admin/src/App.tsx` (marked *STAND-IN*). Nothing else imports from it.
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
