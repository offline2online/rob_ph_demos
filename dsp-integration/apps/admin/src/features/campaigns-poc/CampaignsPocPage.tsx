/* STAND-IN — "Campaigns (POC)". Not a product screen: a stand-in for the
   existing Campaigns section (which this repo can't see), built only so the
   campaign-approval drop-in components can be demoed end to end. Delete
   this folder when the module is plugged into the real campaign table
   (CAMPAIGN-APPROVAL-INTEGRATION.md step 5); nothing else depends on it. */
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { App, Button, Spin, Switch } from 'antd'
import type { ColDef, ICellRendererParams } from 'ag-grid-community'
import {
  ApprovalActions, ApprovalReviewPanel, ApprovalStatusBadge, ApprovalStatusFilter, useCampaignApprovals,
  type Approval, type ApprovalClient, type ApprovalStatus, type StatusCounts,
} from '@ph-dsp/campaign-approval/ui'
import type { Campaign, Session } from '@ph-dsp/types'
import { useMemo, useState } from 'react'
import { api, ApiRequestError } from '../../api/client'
import { Grid } from '../../shared/Grid'
import { T } from '../../theme/phTheme'

const client: ApprovalClient = { getApproval: (id) => api<Approval>('GET', `/admin/v1/campaigns/${id}/approval`) }

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

export function CampaignsPocPage() {
  const { message } = App.useApp()
  const qc = useQueryClient()
  const session = useQuery({ queryKey: ['session'], queryFn: () => api<Session>('GET', '/admin/v1/session') })
  const campaigns = useQuery({ queryKey: ['poc-campaigns'], queryFn: () => api<{ items: Campaign[] }>('GET', '/admin/v1/campaigns').then((r) => r.items) })
  const counts = useQuery({ queryKey: ['approval-counts'], queryFn: () => api<{ counts: StatusCounts }>('GET', '/admin/v1/approvals?limit=1').then((r) => r.counts) })
  const advertiserIds = useMemo(() => (campaigns.data ?? []).filter((c) => c.source !== 'hq').map((c) => c.campaignId), [campaigns.data])
  const { approvals, reload } = useCampaignApprovals(advertiserIds, client)
  const [filter, setFilter] = useState<ApprovalStatus | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const refresh = async () => {
    await Promise.all([qc.invalidateQueries({ queryKey: ['poc-campaigns'] }), qc.invalidateQueries({ queryKey: ['approval-counts'] })])
    await reload()
  }
  const act = async (id: string, fn: () => Promise<unknown>) => {
    setBusy(id)
    try {
      await fn()
      await refresh()
    } catch (e) {
      message.error(e instanceof ApiRequestError ? e.message : 'Something went wrong.')
    } finally {
      setBusy(null)
    }
  }
  const ctx: Ctx = {
    approvals, canApprove: session.data?.role === 'hq_admin', busy, open: setOpenId,
    approve: (a) => act(a.campaignId, () => api('POST', `/admin/v1/campaigns/${a.campaignId}/approve`, { assetVersion: a.assetVersion })),
    reject: (a, reason) => act(a.campaignId, () => api('POST', `/admin/v1/campaigns/${a.campaignId}/reject`, { assetVersion: a.assetVersion, reason })),
    activate: (c, enabled) => act(c.campaignId, () => api('PUT', `/admin/v1/campaigns/${c.campaignId}/activation`, { enabled })),
  }
  const columns = useMemo<ColDef<Campaign>[]>(() => [
    { headerName: 'Status', width: 190, cellRenderer: StatusCell, autoHeight: true },
    { headerName: 'Name', width: 260, cellRenderer: NameCell },
    { headerName: 'Advertiser', width: 150, valueGetter: (p) => p.data?.advertiserName ?? '—' },
    { headerName: 'DSP', width: 150, valueGetter: (p) => p.data?.partnerName ?? '—' },
    { headerName: 'Activation', width: 170, suppressSizeToFit: true, cellRenderer: ActivationCell },
  ], [])

  if (!campaigns.data || !counts.data) return <Spin />
  const rows = campaigns.data.filter((c) => !filter || approvals[c.campaignId]?.status === filter)
  const open = openId ? approvals[openId] : null
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div><b>{rows.length}</b> Campaigns</div>
        <ApprovalStatusFilter counts={counts.data} value={filter} onChange={setFilter} />
      </div>
      <Grid<Campaign> label="Campaigns" rows={rows} columns={columns} context={ctx} getRowId={(c) => c.campaignId} rowHeight={56} />
      {open && (
        <div className="mt-4">
          <ApprovalReviewPanel approval={open} canApprove={ctx.canApprove} busy={busy === open.campaignId}
            onApprove={() => ctx.approve(open)} onReject={(r) => ctx.reject(open, r)} onClose={() => setOpenId(null)} />
        </div>
      )}
    </div>
  )
}
