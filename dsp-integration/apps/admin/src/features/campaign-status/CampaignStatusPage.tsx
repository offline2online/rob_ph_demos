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
import { Button, Dropdown, Input, Modal, Spin, Switch } from 'antd'
import type { ColDef, ICellRendererParams } from 'ag-grid-community'
import { ApprovalActions, ApprovalStatusBadge, STATUS_LABELS, type Approval, type ApprovalStatus } from '@ph-dsp/campaign-approval/ui'
import type { Campaign } from '@ph-dsp/types'
import { useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { api } from '../../api/client'
import { Grid } from '../../shared/Grid'
import { Icon } from '../../shared/Icon'
import { searchColumn, setColumn, showingCount } from '../../shared/TableFilters'
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
  const items = [
    { key: 'open', icon: <Icon name="open_in_new" size={15} />, label: 'Open campaign' },
    { key: 'approve', icon: <Icon name="check_circle" size={15} />, label: 'Approve', disabled: !awaiting || !c.canApprove },
    { key: 'reject', icon: <Icon name="cancel" size={15} />, label: 'Reject…', danger: true, disabled: !awaiting || !c.canApprove },
    { type: 'divider' as const },
    { key: 'activation', icon: <Icon name="power_settings_new" size={15} />, label: data.activation.enabled ? 'Deactivate' : 'Activate', disabled: !approved },
  ]
  const onClick = ({ key }: { key: string }) => {
    if (key === 'open') c.open(data.campaignId)
    if (key === 'approve') void c.approve(a!)
    if (key === 'reject') c.askReject(a!)
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
  /* Opened from an advertiser's campaign counts (Rob, 20 Sep). */
  const advertiserId = params.get('advertiserId')
  const campaigns = useQuery({ queryKey: ['poc-campaigns'], queryFn: () => api<{ items: Campaign[] }>('GET', '/admin/v1/campaigns').then((r) => r.items) })
  /* Only what came in through a DSP or the Partner API. */
  const all = useMemo(() => (campaigns.data ?? []).filter((c) => c.source !== 'hq'), [campaigns.data])
  const rows = useMemo(() => (advertiserId ? all.filter((c) => c.advertiserId === advertiserId) : all), [all, advertiserId])
  const { approvals, canApprove, busy, approve, reject, activate } = useCampaignActions(all.map((c) => c.campaignId))
  const [rejecting, setRejecting] = useState<Approval | null>(null)
  /* What the column filters leave on screen, for the count line. */
  const [shown, setShown] = useState<number | null>(null)
  const reason = useRef('')

  const ctx: Ctx = {
    approvals, canApprove, busy, open: (id) => navigate(`${CAMPAIGN_STATUS_PATH}/${id}`), approve, reject, activate,
    askReject: (a) => {
      reason.current = ''
      setRejecting(a)
    },
  }
  const values = (of: (c: Campaign) => string) => () => all.map(of).filter((v) => v && v !== '—')
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
    { headerName: 'Advertiser', width: 150, minWidth: 130, valueGetter: (p) => p.data?.advertiserName ?? '—', ...setColumn<Campaign>('Advertiser', values((c) => c.advertiserName ?? '')) },
    { headerName: 'DSP', width: 150, minWidth: 130, valueGetter: (p) => p.data?.partnerName ?? '—', ...setColumn<Campaign>('DSP', values((c) => c.partnerName ?? '')) },
    { headerName: 'Activation', width: 160, suppressSizeToFit: true, cellRenderer: ActivationCell },
    { headerName: '', width: 56, suppressSizeToFit: true, pinned: 'right', cellRenderer: RowMenu },
  ], [approvals, all])

  if (!campaigns.data) return <Spin />
  const advertiserName = advertiserId ? all.find((c) => c.advertiserId === advertiserId)?.advertiserName ?? advertiserId : null
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2" style={{ fontSize: 13 }}>
        <span>{showingCount(shown ?? rows.length, rows.length, `campaign${rows.length === 1 ? '' : 's'} submitted by advertisers and DSPs`)}</span>
        {advertiserName && (
          <Button size="small" icon={<Icon name="close" size={14} />} onClick={() => { const n = new URLSearchParams(params); n.delete('advertiserId'); setParams(n, { replace: true }) }}>
            {advertiserName} only
          </Button>
        )}
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
        onFilterChanged={(e) => setShown(e.api.getDisplayedRowCount())}
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
