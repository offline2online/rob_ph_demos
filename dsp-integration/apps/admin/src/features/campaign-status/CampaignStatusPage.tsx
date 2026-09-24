/* STAND-IN — "Campaign Status". Not a product screen: a stand-in for the
   existing Campaigns section (which this repo can't see), built only so the
   campaign-approval drop-in components can be demoed end to end. Delete
   this folder when the module is plugged into the real campaign table
   (CAMPAIGN-APPROVAL-INTEGRATION.md step 5); nothing else depends on it.

   It lists what this build brings in — the campaigns advertisers and DSPs
   submitted — never HQ's own campaigns (Rob, 20 Sep), and never a Draft one
   (ticket, 22 Sep, §3: a retailer only ever sees a campaign once it has
   been submitted). The status filter lives in the column, as the design
   system's tables do, the header stays in view, and the campaign name
   opens the campaign (CampaignDetail). */
import { useQuery } from '@tanstack/react-query'
import { Button, Dropdown, Input, Modal, Spin, Switch } from 'antd'
import type { ColDef, ICellRendererParams } from 'ag-grid-community'
import { ApprovalActions, ApprovalStatusBadge, STATUS_LABELS, type Approval, type ApprovalStatus } from '@ph-dsp/campaign-approval/ui'
import type { Campaign } from '@ph-dsp/types'
import { useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { api } from '../../api/client'
import { Q } from '../../api/queries'
import { Grid } from '../../shared/Grid'
import { Icon } from '../../shared/Icon'
import { externalSetColumn, searchColumn, setColumn } from '../../shared/TableFilters'
import { T } from '../../theme/phTheme'
import { CAMPAIGN_STATUS_PATH, useCampaignActions } from './useCampaigns'

interface Ctx {
  approvals: Record<string, Approval>
  askReject: (a: Approval) => void
  canApprove: boolean
  busy: string | null
  open: (id: string) => void
  approve: (a: Approval) => Promise<void>
  reject: (a: Approval, reason: string) => Promise<void>
  unreject: (a: Approval) => Promise<void>
  activate: (c: Campaign, enabled: boolean) => Promise<void>
}
type P = ICellRendererParams<Campaign, unknown, { current: Ctx }>

const StatusCell = ({ data, context }: P) => {
  const a = data && context.current.approvals[data.campaignId]
  return a ? <ApprovalStatusBadge status={a.status} mode={a.mode} /> : <span style={{ color: T.micro }}>—</span>
}
const NameCell = ({ data, context }: P) =>
  data ? <Button type="link" className="px-0" style={{ color: T.text, fontWeight: 700 }} onClick={() => context.current.open(data.campaignId)}>{data.name}</Button> : null
/* When the advertiser's booking starts, so what is up next sorts to the top. */
const ScheduleCell = ({ data }: P) => {
  if (!data) return null
  const { nextWindowStart, bookedWindows } = data.schedule ?? { nextWindowStart: null, bookedWindows: 0 }
  if (!nextWindowStart) return <span style={{ fontSize: 12, color: T.micro }}>{bookedWindows ? 'Finished' : 'Not booked'}</span>
  return (
    <div className="min-w-0 py-1.5">
      <div className="truncate">{new Date(nextWindowStart).toLocaleDateString('en-GB', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' })}</div>
      <div style={{ fontSize: 11, color: T.micro }}>{bookedWindows} window{bookedWindows === 1 ? '' : 's'} booked</div>
    </div>
  )
}

/* Approve, reject or switch a campaign on from the table (Rob, 20 Sep). */
function RowMenu({ data, context }: P) {
  if (!data) return null
  const c = context.current
  const a = c.approvals[data.campaignId]
  const awaiting = a?.status === 'awaiting_approval'
  const approved = a?.status === 'approved'
  const rejected = a?.status === 'rejected'
  const items = [
    { key: 'open', icon: <Icon name="open_in_new" size={15} />, label: 'Open campaign' },
    { key: 'approve', icon: <Icon name="check_circle" size={15} />, label: 'Approve', disabled: !awaiting || !c.canApprove },
    { key: 'reject', icon: <Icon name="cancel" size={15} />, label: 'Reject…', danger: true, disabled: !awaiting || !c.canApprove },
    /* Undo a mistaken rejection (ticket, 22 Sep): back to Awaiting approval, never auto-approved. Same permission as approve/reject. */
    { key: 'unreject', icon: <Icon name="undo" size={15} />, label: 'Undo rejection', disabled: !rejected || !c.canApprove },
    { type: 'divider' as const },
    { key: 'activation', icon: <Icon name="power_settings_new" size={15} />, label: data.activation.enabled ? 'Deactivate' : 'Activate', disabled: !approved },
  ]
  const onClick = ({ key }: { key: string }) => {
    if (key === 'open') c.open(data.campaignId)
    if (key === 'approve') void c.approve(a!)
    if (key === 'reject') c.askReject(a!)
    if (key === 'unreject') void c.unreject(a!)
    if (key === 'activation') void c.activate(data, !data.activation.enabled)
  }
  return (
    <Dropdown menu={{ items, onClick }} trigger={['click']} placement="bottomRight">
      <Button type="text" size="small" aria-label={`${data.name}: options`} icon={<Icon name="more_vert" size={18} />} loading={c.busy === data.campaignId} />
    </Dropdown>
  )
}

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
  const [params, setParams] = useSearchParams()
  /* Opened from an advertiser's campaign counts (Rob, 20 Sep). Shown as the
     Advertiser column's own funnel filter, not a separate chip outside the
     grid (ticket, 22 Sep) — the same pattern the booking schedule uses for
     a page-owned filter. */
  const advertiserId = params.get('advertiserId')
  const campaigns = useQuery(Q.campaigns)
  /* Only what came in through a DSP or the Partner API. */
  const nonHq = useMemo(() => (campaigns.data ?? []).filter((c) => c.source !== 'hq'), [campaigns.data])
  const { approvals, canApprove, busy, approve, reject, unreject, activate } = useCampaignActions(nonHq.map((c) => c.campaignId))
  /* Draft never surfaces in a retailer-facing view (ticket, 22 Sep, §3):
     the retailer only ever sees a campaign once it has been submitted. */
  const all = useMemo(() => nonHq.filter((c) => approvals[c.campaignId]?.status !== 'draft'), [nonHq, approvals])
  const rows = useMemo(() => (advertiserId ? all.filter((c) => c.advertiserId === advertiserId) : all), [all, advertiserId])
  const counts = useMemo(() => {
    const c = { approved: 0, awaiting_approval: 0, rejected: 0 }
    for (const row of all) {
      const s = approvals[row.campaignId]?.status
      if (s === 'approved' || s === 'awaiting_approval' || s === 'rejected') c[s]++
    }
    return c
  }, [all, approvals])
  const [rejecting, setRejecting] = useState<Approval | null>(null)
  const reason = useRef('')

  const ctx: Ctx = {
    approvals, canApprove, busy, open: (id) => navigate(`${CAMPAIGN_STATUS_PATH}/${id}`), approve, reject, unreject, activate,
    askReject: (a) => {
      reason.current = ''
      setRejecting(a)
    },
  }
  const values = (of: (c: Campaign) => string) => () => all.map(of).filter((v) => v && v !== '—')
  const advertiserOptions = useMemo(() => [...new Map(
    all.filter((c): c is Campaign & { advertiserId: string } => !!c.advertiserId).map((c) => [c.advertiserId, c.advertiserName ?? c.advertiserId] as const),
  ).entries()].map(([value, label]) => ({ value, label })), [all])
  const setAdvertiserFilter = (id?: string) => {
    const next = new URLSearchParams(params)
    if (id) next.set('advertiserId', id)
    else next.delete('advertiserId')
    setParams(next, { replace: true })
  }
  const columns = useMemo<ColDef<Campaign>[]>(() => [
    {
      /* What the advertiser booked, earliest first, so what is up next is at the top. */
      headerName: 'Schedule', width: 150, minWidth: 130, cellRenderer: ScheduleCell, sort: 'asc', comparator: (a, b) => (a || '9999').localeCompare(b || '9999'),
      valueGetter: (p) => p.data?.schedule.nextWindowStart ?? '',
    },
    {
      headerName: 'Status', width: 180, minWidth: 150, cellRenderer: StatusCell,
      valueGetter: (p) => (p.data ? STATUS_LABELS[approvals[p.data.campaignId]?.status as ApprovalStatus] ?? '' : ''),
      ...setColumn<Campaign>('Status', values((c) => STATUS_LABELS[approvals[c.campaignId]?.status as ApprovalStatus] ?? '')),
    },
    { headerName: 'Name', width: 260, minWidth: 180, cellRenderer: NameCell, valueGetter: (p) => p.data?.name ?? '', ...searchColumn<Campaign>('Name') },
    {
      headerName: 'Advertiser', width: 150, minWidth: 130, valueGetter: (p) => p.data?.advertiserName ?? '—',
      ...externalSetColumn<Campaign>('Advertiser', advertiserOptions.map((a) => a.label), advertiserOptions.find((a) => a.value === advertiserId)?.label,
        (name) => setAdvertiserFilter(advertiserOptions.find((a) => a.label === name)?.value)),
    },
    { headerName: 'DSP', width: 150, minWidth: 130, valueGetter: (p) => p.data?.partnerName ?? '—', ...setColumn<Campaign>('DSP', values((c) => c.partnerName ?? '')) },
    { headerName: 'Activation', width: 160, suppressSizeToFit: true, cellRenderer: ActivationCell },
    { headerName: '', width: 56, suppressSizeToFit: true, pinned: 'right', cellRenderer: RowMenu },
  ], [approvals, all, advertiserOptions, advertiserId])

  if (!campaigns.data) return <Spin />
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1" style={{ fontSize: 13 }}>
        <span style={{ fontWeight: 700 }}>{all.length} campaign{all.length === 1 ? '' : 's'}</span>
        <span style={{ color: T.muted }}>Approved <b style={{ color: T.text }}>{counts.approved}</b></span>
        <span style={{ color: T.muted }}>Awaiting approval <b style={{ color: T.text }}>{counts.awaiting_approval}</b></span>
        <span style={{ color: T.muted }}>Rejected <b style={{ color: T.text }}>{counts.rejected}</b></span>
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
        suppressHorizontalScroll={false}
      />
      <Modal
        open={!!rejecting}
        title={`Reject ${rejecting?.campaignName ?? 'this campaign'}?`}
        okText="Reject"
        okButtonProps={{ danger: true }}
        onCancel={() => setRejecting(null)}
        onOk={async () => {
          const a = rejecting!
          setRejecting(null)
          await reject(a, reason.current.trim() || 'No reason given.')
        }}
      >
        <Input.TextArea aria-label="Reason" rows={3} placeholder="Why is it rejected? The advertiser sees this." onChange={(e) => (reason.current = e.target.value)} />
      </Modal>
    </div>
  )
}
