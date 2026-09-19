/* STAND-IN — "Campaign Status". Not a product screen: a stand-in for the
   existing Campaigns section (which this repo can't see), built only so the
   campaign-approval drop-in components can be demoed end to end. Delete
   this folder when the module is plugged into the real campaign table
   (CAMPAIGN-APPROVAL-INTEGRATION.md step 5); nothing else depends on it.

   It lists what this build brings in — the campaigns advertisers and DSPs
   submitted — never HQ's own campaigns (Rob, 20 Sep). The status filter
   lives in the column, as the design system's tables do, the header stays
   in view, and the campaign name opens the campaign (CampaignDetail). */
import { useQuery } from '@tanstack/react-query'
import { Button, Spin, Switch } from 'antd'
import type { ColDef, ICellRendererParams } from 'ag-grid-community'
import { ApprovalActions, ApprovalStatusBadge, STATUS_LABELS, type Approval, type ApprovalStatus } from '@ph-dsp/campaign-approval/ui'
import type { Campaign } from '@ph-dsp/types'
import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../../api/client'
import { Grid } from '../../shared/Grid'
import { T } from '../../theme/phTheme'
import { CAMPAIGN_STATUS_PATH, useCampaignActions } from './useCampaigns'

interface Ctx {
  approvals: Record<string, Approval>
  canApprove: boolean
  busy: string | null
  open: (id: string) => void
  approve: (a: Approval) => Promise<void>
  reject: (a: Approval, reason: string) => Promise<void>
  activate: (c: Campaign, enabled: boolean) => Promise<void>
}
type P = ICellRendererParams<Campaign, unknown, { current: Ctx }>

const StatusCell = ({ data, context }: P) => {
  const a = data && context.current.approvals[data.campaignId]
  return a ? <ApprovalStatusBadge status={a.status} mode={a.mode} /> : <span style={{ color: T.micro }}>—</span>
}
const NameCell = ({ data, context }: P) =>
  data ? <Button type="link" className="px-0" style={{ color: T.text, fontWeight: 700 }} onClick={() => context.current.open(data.campaignId)}>{data.name}</Button> : null
const ActivationCell = ({ data, context }: P) => {
  if (!data) return null
  const c = context.current
  const a = c.approvals[data.campaignId]
  /* The host table's existing activation toggle, wrapped by ApprovalActions. */
  return (
    <ApprovalActions status={a?.status} canApprove={c.canApprove} busy={c.busy === data.campaignId} onApprove={() => c.approve(a!)} onReject={(r) => c.reject(a!, r)}>
      <Switch aria-label={`${data.name}: activation`} checked={data.activation.enabled} loading={c.busy === data.campaignId} onChange={(v) => c.activate(data, v)} />
    </ApprovalActions>
  )
}

export function CampaignStatusPage() {
  const navigate = useNavigate()
  const campaigns = useQuery({ queryKey: ['poc-campaigns'], queryFn: () => api<{ items: Campaign[] }>('GET', '/admin/v1/campaigns').then((r) => r.items) })
  /* Only what came in through a DSP or the Partner API. */
  const rows = useMemo(() => (campaigns.data ?? []).filter((c) => c.source !== 'hq'), [campaigns.data])
  const { approvals, canApprove, busy, approve, reject, activate } = useCampaignActions(rows.map((c) => c.campaignId))

  const ctx: Ctx = { approvals, canApprove, busy, open: (id) => navigate(`${CAMPAIGN_STATUS_PATH}/${id}`), approve, reject, activate }
  const columns = useMemo<ColDef<Campaign>[]>(() => [
    {
      headerName: 'Status', width: 190, cellRenderer: StatusCell, filter: true, floatingFilter: true,
      valueGetter: (p) => (p.data ? STATUS_LABELS[approvals[p.data.campaignId]?.status as ApprovalStatus] ?? '' : ''),
    },
    { headerName: 'Name', width: 280, minWidth: 200, cellRenderer: NameCell, filter: true, floatingFilter: true, valueGetter: (p) => p.data?.name ?? '' },
    { headerName: 'Advertiser', width: 150, filter: true, floatingFilter: true, valueGetter: (p) => p.data?.advertiserName ?? '—' },
    { headerName: 'DSP', width: 150, filter: true, floatingFilter: true, valueGetter: (p) => p.data?.partnerName ?? '—' },
    { headerName: 'Activation', width: 170, suppressSizeToFit: true, cellRenderer: ActivationCell },
  ], [approvals])

  if (!campaigns.data) return <Spin />
  return (
    <div>
      <div className="mb-3" style={{ fontSize: 13 }}>
        <b>{rows.length}</b> campaigns submitted by advertisers and DSPs
      </div>
      <Grid<Campaign>
        label="Campaign Status"
        rows={rows}
        columns={columns}
        context={ctx}
        getRowId={(c) => c.campaignId}
        rowHeight={56}
        headerHeight={40}
        floatingFiltersHeight={40}
        stickyHeader
      />
    </div>
  )
}
