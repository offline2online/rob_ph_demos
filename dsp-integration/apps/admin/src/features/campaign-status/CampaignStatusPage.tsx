/* STAND-IN — "Campaign Status". Not a product screen: a stand-in for the
   existing Campaigns section (which this repo can't see), built only so the
   campaign-approval drop-in components can be demoed end to end. Delete
   this folder when the module is plugged into the real campaign table
   (CAMPAIGN-APPROVAL-INTEGRATION.md step 5); nothing else depends on it.

   It lists what this build brings in — the campaigns advertisers and DSPs
   submitted — never HQ's own campaigns (Rob, 20 Sep), and never a Draft one
   (ticket, 22 Sep, §3: a retailer only ever sees a campaign once it has
   been submitted). The status filter lives in the column, as the design
   system's tables do, the header stays in view, and the playlist name
   opens the campaign (CampaignDetail).

   One row is one campaign (ticket IDGsyELBJsjlAYjizSqT): an advertiser
   authors campaigns one at a time and submits each for approval, so each
   lands here as its own row, grouped by advertiser. A campaign's layers
   (the mandatory default plus its optional localised/personalised upsells,
   spec §6) are still one Campaign record, summarised in the two variable
   columns.

   Approval is by selection, not per row: tick the Awaiting-approval
   campaigns of ONE advertiser and approve them into a creative ID — the
   grouping a DSP bids on — either a new one or an existing one, picked by
   seeing the campaigns already under it. The assign actions are hidden when
   the ticked campaigns span advertisers (a creative ID belongs to one).
   An auto-approved advertiser's campaigns (approved on submission, no
   retailer step) are ticked the same way and offer "Generate creative ID" /
   "Assign to existing creative ID" instead (ticket XnN1Kwl39F8C8DrOkwQn).
   Reject needs a reason, which the advertiser sees. REQUIREMENTS.md →
   Retailer review → "Creative IDs".

   Column order and selection (ticket dinPPBl9Rk95UbrXoRbt, 10 Oct 2026):
   selection box, Status, Advertiser, Campaign name, Touch points, Display
   types, Creative ID, Deal ID, DSP, the two variable columns, Received,
   Activation, Last used. Each advertiser is a group row whose ONE box ticks
   every campaign beneath it; each campaign row has its own one box. There is
   no status selector or "select all" above the table — status is filtered
   in its column — and the actions at the top right follow the status of the
   ticked rows: Awaiting approval / Rejected → Approve / Reject Selected,
   Approved → Activate / Deactivate Selected, a mix → only what suits every
   row (nothing, since no action is valid across both).

   Triage order (Rob, 8 Oct 2026): Received replaces Schedule and Last used
   closes the row. Rows open Awaiting approval first, oldest Received at the
   top, then decided rows by Last used, most recent first (triage.ts).
   Last used is PH Core's playback data (Campaign.lastPlayedAt).

   The Status filter lives in the URL (`status`), like the Advertiser filter. */
import { useQuery } from '@tanstack/react-query'
import { Button, Checkbox, Dropdown, Input, Modal, Radio, Spin, Switch, Tag } from 'antd'
import { Tip } from '../../shared/Tip'
import type { ColDef, ICellRendererParams } from 'ag-grid-community'
import { ApprovalStatusBadge, STATUS_LABELS, type Approval, type ApprovalStatus } from '@ph-dsp/campaign-approval/ui'
import type { Campaign } from '@ph-dsp/types'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { api } from '../../api/client'
import { Q } from '../../api/queries'
import { Grid } from '../../shared/Grid'
import { Icon } from '../../shared/Icon'
import { externalSetColumn, pageSetColumn, searchColumn, setColumn } from '../../shared/TableFilters'
import { T } from '../../theme/phTheme'
import { CAMPAIGN_STATUS_PATH, useCampaignActions } from './useCampaigns'
import { byAdvertiserDeal, elapsedSince, triageOrder } from './triage'

interface Ctx {
  approvals: Record<string, Approval>
  canApprove: boolean
  busy: string | null
  open: (id: string) => void
  selected: ReadonlySet<string>
  toggle: (id: string, on: boolean) => void
  toggleGroup: (ids: string[], on: boolean) => void
  /* Each advertiser group's ticked-able campaigns, among the rows the column filters leave showing. */
  groupIds: ReadonlyMap<string, string[]>
  displayTypeNames: ReadonlyMap<string, string>
  unreject: (a: Approval) => Promise<void>
  activate: (c: Campaign, enabled: boolean) => Promise<void>
  now: number
}
/* An advertiser's group row sits above its campaigns; its one box ticks them all.
   It is a Campaign-shaped row so the grid's filters and ids treat it like any other. */
interface GroupInfo { key: string; label: string; deals: string; dsps: string; names: string }
type Row = Campaign & { group?: GroupInfo }
type P = ICellRendererParams<Row, unknown, { current: Ctx }>
/* One creative ID and the campaigns grouped under it (GET /admin/v1/creative-ids). */
interface CreativeIdGroup { creativeId: string; dealId?: string | null; dealIds?: string[]; direct?: boolean; campaigns: { campaignId: string; name: string; touchPoints: string[] }[] }

/* The statuses a retailer sees here (never Draft), in the order the counts show them. */
const FILTERABLE_STATUSES = ['approved', 'awaiting_approval', 'rejected'] as const
type FilterableStatus = (typeof FILTERABLE_STATUSES)[number]
const isFilterable = (s: string): s is FilterableStatus => (FILTERABLE_STATUSES as readonly string[]).includes(s)

/* Approved on submission (the advertiser does not require approval): there is
   no retailer step to give it a creative ID, so the advertiser groups it here. */
const isAutoApproved = (a: Approval | undefined) => a?.status === 'approved' && a.mode === 'auto'
/* Every submitted campaign can be ticked; what the ticks can do depends on their status. */
const isSelectable = (a: Approval | undefined) => !!a && a.status !== 'draft'
const DECIDABLE = ['awaiting_approval', 'rejected']

const StatusCell = ({ data, context }: P) => {
  const a = data && !data.group && context.current.approvals[data.campaignId]
  return a ? <ApprovalStatusBadge status={a.status} mode={a.mode} /> : null
}
const PRICING_LABELS: Record<string, string> = { localised: 'Localised', personalised: 'Personalised', targeted: 'Targeted' }
const pricingLabel = (c: Campaign) => (c.pricingType ? PRICING_LABELS[c.pricingType] ?? c.pricingType : '—')
const touchPointsOf = (c: Campaign) => c.brief?.touchPoints ?? []

/* The one box on every row: a campaign's own, or — on an advertiser's group row — the
   box that ticks all of that advertiser's campaigns (partial when only some are ticked). */
const SelectCell = ({ data, context }: P) => {
  const c = context.current
  if (!data || !c.canApprove) return null
  if (data.group) {
    const g = data.group
    const ids = c.groupIds.get(g.key) ?? []
    if (!ids.length) return null
    const on = ids.filter((id) => c.selected.has(id)).length
    return <Checkbox aria-label={`Select all ${g.label || 'campaigns without an advertiser'}`} checked={on === ids.length} indeterminate={on > 0 && on < ids.length} onChange={(e) => c.toggleGroup(ids, e.target.checked)} />
  }
  if (!isSelectable(c.approvals[data.campaignId])) return null
  return <Checkbox aria-label={`Select ${data.name}`} checked={c.selected.has(data.campaignId)} onChange={(e) => c.toggle(data.campaignId, e.target.checked)} />
}

/* Only the group row names the advertiser; the campaigns beneath it sit under it. */
const AdvertiserCell = ({ data }: P) => (data?.group ? <b className="block truncate" title={data.group.label}>{data.group.label || '—'}</b> : null)
const DealCell = ({ data }: P) => (data && !data.group && data.dealId ? <span className="block truncate" title={data.dealId}>{data.dealId}</span> : null)
const DisplayTypesCell = ({ data, context }: P) => {
  if (!data || data.group) return null
  const name = data.displayTypeId ? context.current.displayTypeNames.get(data.displayTypeId) ?? data.displayTypeId : ''
  return name ? <span className="block truncate" title={name}>{name}</span> : <span style={{ color: T.micro }}>—</span>
}

/* The campaign's own name, opening the campaign. Hovering shows its details
   (the existing HQ Admin tooltip pattern): who, which DSP, where it runs,
   how it is priced and what it targets. */
const CampaignNameCell = ({ data, context }: P) => {
  if (!data || data.group) return null
  const lines: [string, string][] = [
    ['Advertiser', data.advertiserName ?? '—'], ['DSP', data.partnerName ?? '—'], ['Touch points', touchPointsOf(data).join(', ') || '—'], ['Pricing', pricingLabel(data)],
    ['Localised variables', data.localisedVariables.join(', ') || '—'], ['Personalised variables', data.personalisedVariables.join(', ') || '—'],
  ]
  return (
    <Tip title={<div>{lines.map(([k, v]) => <div key={k}><b>{k}:</b> {v}</div>)}</div>}>
      <Button type="link" className="px-0" style={{ color: T.text, fontWeight: 700, maxWidth: '100%' }} onClick={() => context.current.open(data.campaignId)}>
        <span className="block truncate">{data.name}</span>
      </Button>
    </Tip>
  )
}

const TouchPointsCell = ({ data }: P) => {
  if (data?.group) return null
  const points = data ? touchPointsOf(data) : []
  return points.length ? <span className="block truncate" title={points.join(', ')}>{points.join(', ')}</span> : <span style={{ color: T.micro }}>—</span>
}

/* The grouping a DSP bids on. A resubmitted creative that awaits re-approval
   still shows the one it belongs to. */
const CreativeIdCell = ({ data, context }: P) => {
  if (data?.group) return null
  const a = data && context.current.approvals[data.campaignId]
  if (!a?.creativeId) return <span style={{ color: T.micro }}>—</span>
  return <span className="block truncate">{a.creativeId}{a.status === 'awaiting_approval' && <span style={{ color: T.micro }}> (resubmission)</span>}</span>
}

/* A high-level summary in the cell (the variables targeted, deduped), the
   exact rules behind it on hover — one consolidated view of everything this
   advertiser targets on this playlist's localised/personalised layer(s). */
const VariablesCell = ({ variables, ruleLines }: { variables: string[]; ruleLines: string[] }) => {
  if (!variables.length) return <span style={{ color: T.micro }}>—</span>
  return (
    <Tip title={ruleLines.join(' · ')}>
      <span className="block truncate">{variables.join(', ')}</span>
    </Tip>
  )
}
const LocalisedVariablesCell = ({ data }: P) => (data && !data.group ? <VariablesCell variables={data.localisedVariables} ruleLines={data.localisedRuleLines} /> : null)
const PersonalisedVariablesCell = ({ data }: P) => (data && !data.group ? <VariablesCell variables={data.personalisedVariables} ruleLines={data.personalisedRuleLines} /> : null)
/* When the creative's approval request was received, with the time since in
   brackets — a snapshot taken when the page loaded, never ticking (Rob, 8 Oct
   2026). Only while the row is Awaiting approval: once decided there is no
   waiting left to measure, so it reads as a dash. */
const fmtUtc = (iso: string) => new Date(iso).toLocaleString('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
const ReceivedCell = ({ data, context }: P) => {
  if (!data || data.group) return null
  const a = context.current.approvals[data.campaignId]
  if (a?.status !== 'awaiting_approval' || !a.submittedAt) return <span style={{ color: T.micro }}>—</span>
  return <span className="block truncate">{fmtUtc(a.submittedAt)} <span style={{ color: T.micro }}>({elapsedSince(a.submittedAt, context.current.now)})</span></span>
}
/* When the campaign last actually played live — PH Core's playback data. */
const LastUsedCell = ({ data }: P) =>
  data?.group ? null : data?.lastPlayedAt ? <span className="block truncate">{fmtUtc(data.lastPlayedAt)}</span> : <span style={{ color: T.micro }}>—</span>

/* Open a campaign, undo a rejection, or switch a campaign on from the table. Approving and rejecting are by selection above the table. */
function RowMenu({ data, context }: P) {
  if (!data || data.group) return null
  const c = context.current
  const a = c.approvals[data.campaignId]
  const approved = a?.status === 'approved'
  const rejected = a?.status === 'rejected'
  const items = [
    { key: 'open', icon: <Icon name="open_in_new" size={15} />, label: 'Open campaign' },
    /* Undo a mistaken rejection (ticket, 22 Sep): back to Awaiting approval, never auto-approved. Same permission as approve/reject. */
    { key: 'unreject', icon: <Icon name="undo" size={15} />, label: 'Undo rejection', disabled: !rejected || !c.canApprove },
    { type: 'divider' as const },
    { key: 'activation', icon: <Icon name="power_settings_new" size={15} />, label: data.activation.enabled ? 'Deactivate' : 'Activate', disabled: !approved },
  ]
  const onClick = ({ key }: { key: string }) => {
    if (key === 'open') c.open(data.campaignId)
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
  if (!data || data.group) return null
  const c = context.current
  const a = c.approvals[data.campaignId]
  /* No approval state (an HQ campaign) or approved: the existing toggle. Until then it cannot be switched on. */
  const approved = !a || a.status === 'approved'
  const sw = <Switch aria-label={`${data.name}: activation`} checked={data.activation.enabled} disabled={!approved} loading={c.busy === data.campaignId} onChange={(v) => c.activate(data, v)} />
  return approved ? sw : <Tip title="Only an approved campaign can be activated."><span>{sw}</span></Tip>
}

export function CampaignStatusPage() {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  /* Opened from an advertiser's campaign counts (Rob, 20 Sep). Shown as the
     Advertiser column's own funnel filter, not a separate chip outside the
     grid (ticket, 22 Sep) — the same pattern the booking schedule uses for
     a page-owned filter. */
  const advertiserId = params.get('advertiserId')
  const statusFilter = useMemo(() => (params.get('status') ?? '').split(',').filter(isFilterable), [params])
  const campaigns = useQuery(Q.campaigns)
  const displayTypes = useQuery(Q.displayTypes)
  const displayTypeNames = useMemo(() => new Map((displayTypes.data ?? []).map((d) => [d.id, d.name] as const)), [displayTypes.data])
  /* Only what came in through a DSP or the Partner API. */
  const nonHq = useMemo(() => (campaigns.data ?? []).filter((c) => c.source !== 'hq'), [campaigns.data])
  const { approvals, canApprove, busy, approveAssign, assignCreativeId, rejectMany, unreject, activate, activateMany } = useCampaignActions(nonHq.map((c) => c.campaignId))
  /* Draft never surfaces in a retailer-facing view (ticket, 22 Sep, §3):
     the retailer only ever sees a campaign once it has been submitted. */
  const all = useMemo(() => nonHq.filter((c) => approvals[c.campaignId]?.status !== 'draft'), [nonHq, approvals])
  /* Taken once when the page loads: the elapsed figure does not tick. */
  const [now] = useState(() => Date.now())
  const campaignRows = useMemo(() => byAdvertiserDeal(triageOrder(all.filter((c) => {
    if (advertiserId && c.advertiserId !== advertiserId) return false
    const s = approvals[c.campaignId]?.status
    return !statusFilter.length || (!!s && (statusFilter as string[]).includes(s))
  }), approvals)), [all, advertiserId, statusFilter, approvals])
  /* A group row above each advertiser's campaigns. Its filterable values are its campaigns' joined, so a column filter keeps it while any campaign beneath still matches. */
  const rows = useMemo<Row[]>(() => {
    const out: Row[] = []
    let current: { g: GroupInfo; deals: Set<string>; dsps: Set<string>; names: string[] } | null = null
    let prevKey: string | undefined
    for (const c of campaignRows) {
      const key = c.advertiserId ?? c.advertiserName ?? ''
      if (!current || key !== prevKey) {
        current = { g: { key, label: c.advertiserName ?? '', deals: '', dsps: '', names: '' }, deals: new Set(), dsps: new Set(), names: [] }
        prevKey = key
        out.push({ ...c, campaignId: `group:${key}`, name: current.g.label, group: current.g })
      }
      if (c.dealId) current.deals.add(c.dealId)
      if (c.partnerName) current.dsps.add(c.partnerName)
      current.names.push(c.name)
      current.g.deals = [...current.deals].join(', ')
      current.g.dsps = [...current.dsps].join(', ')
      current.g.names = current.names.join(' ')
      out.push(c)
    }
    return out
  }, [campaignRows])
  const counts = useMemo(() => {
    const c = { approved: 0, awaiting_approval: 0, rejected: 0 }
    for (const row of all) {
      const s = approvals[row.campaignId]?.status
      if (s === 'approved' || s === 'awaiting_approval' || s === 'rejected') c[s]++
    }
    return c
  }, [all, approvals])
  /* The ticked campaigns. A decision (or a filter) that takes a row away takes its tick with it. */
  const [ticked, setTicked] = useState<ReadonlySet<string>>(new Set())
  const [visible, setVisible] = useState<ReadonlySet<string> | null>(null)
  const shownRows = useMemo(() => campaignRows.filter((c) => !visible || visible.has(c.campaignId)), [campaignRows, visible])
  const selectedRows = useMemo(() => shownRows.filter((c) => ticked.has(c.campaignId) && isSelectable(approvals[c.campaignId])), [shownRows, ticked, approvals])
  const selected = useMemo(() => new Set(selectedRows.map((c) => c.campaignId)), [selectedRows])
  const selectedApprovals = selectedRows.map((c) => approvals[c.campaignId]!)
  /* What the ticks can do follows their status; a mixed selection offers nothing, as no action suits every row. */
  const statuses = new Set(selectedApprovals.map((a) => a.status))
  const toDecide = selectedApprovals.length > 0 && selectedApprovals.every((a) => DECIDABLE.includes(a.status))
  const allApproved = selectedApprovals.length > 0 && selectedApprovals.every((a) => a.status === 'approved')
  const mixed = statuses.size > 0 && !toDecide && !allApproved
  /* An advertiser's auto-approved campaigns have no retailer step to give them a creative ID, so they are grouped here. */
  const autoOnly = allApproved && selectedApprovals.every(isAutoApproved)
  /* A creative ID spans one advertiser's campaigns, so the assign actions need exactly one. */
  const advertisers = new Set(selectedRows.map((c) => c.advertiserId))
  const oneAdvertiser = selectedRows.length > 0 && advertisers.size === 1 && !advertisers.has(null)
  /* A creative can be in many deals at once (its deals come from its campaigns), so the selection may mix deals.
     When it is all one deal, the picker flags the IDs already in that deal. */
  const deals = new Set(selectedRows.map((c) => c.dealId ?? null))
  const deal = deals.size === 1 ? [...deals][0] : null
  const toggle = (id: string, on: boolean) => setTicked((t) => { const n = new Set(t); if (on) n.add(id); else n.delete(id); return n })
  const toggleGroup = (ids: string[], on: boolean) => setTicked((t) => { const n = new Set(t); for (const id of ids) { if (on) n.add(id); else n.delete(id) } return n })
  /* Group boxes act on the rows the column filters leave showing. */
  const groupIds = useMemo(() => {
    const m = new Map<string, string[]>()
    for (const c of shownRows) {
      if (!isSelectable(approvals[c.campaignId])) continue
      const key = c.advertiserId ?? c.advertiserName ?? ''
      m.set(key, [...(m.get(key) ?? []), c.campaignId])
    }
    return m
  }, [shownRows, approvals])
  const [picking, setPicking] = useState(false)
  const [choice, setChoice] = useState<string | null>(null)
  const [rejecting, setRejecting] = useState(false)
  const [reason, setReason] = useState('')
  const done = async (ok: Promise<boolean>) => {
    if (await ok) setTicked(new Set())
    return ok
  }
  /* Each creative ID this advertiser has, with the campaigns (and touch points) already under it. */
  const creativeIds = useQuery({
    queryKey: ['creative-ids', [...advertisers][0] ?? null],
    /* Every ID this advertiser has: a creative may join a further deal, so none is hidden for being in another. */
    queryFn: () => api<{ items: CreativeIdGroup[] }>('GET', `/admin/v1/creative-ids?advertiserId=${encodeURIComponent([...advertisers][0] ?? '')}`).then((r) => r.items),
    enabled: picking && oneAdvertiser,
  })
  /* A resubmitted creative goes back to the ID it originally belonged to. */
  const originals = new Set(selectedApprovals.map((a) => a.creativeId).filter((id): id is string => !!id))
  const openPicker = () => {
    setChoice(originals.size === 1 ? [...originals][0] : null)
    setPicking(true)
  }
  /* Anchored by the deal (REQUIREMENTS.md, Flow B step 5): a deal campaign with no ID of its own
     (rejected, now fixed) is offered the deal's one creative ID, pre-highlighted. With several IDs
     in the deal the anchor is ambiguous, so nothing is pre-highlighted and HQ chooses. */
  useEffect(() => {
    if (picking && deal && originals.size === 0 && !choice && creativeIds.data?.length === 1) setChoice(creativeIds.data[0].creativeId)
  }, [picking, deal, originals.size, choice, creativeIds.data])

  const ctx: Ctx = {
    approvals, canApprove, busy, now, open: (id) => navigate(`${CAMPAIGN_STATUS_PATH}/${id}`), unreject, activate, selected, toggle, toggleGroup, groupIds, displayTypeNames,
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
  const setStatusFilter = (keys: FilterableStatus[]) => {
    const next = new URLSearchParams(params)
    if (keys.length) next.set('status', keys.join(','))
    else next.delete('status')
    setParams(next, { replace: true })
  }
  const statusOptions = FILTERABLE_STATUSES.filter((k) => counts[k] > 0 || statusFilter.includes(k))
  /* A group row filters on its campaigns' values; a campaign row on its own. */
  const joined = (p: { data?: Row }, of: (c: Campaign) => string, groupOf: (g: GroupInfo) => string) => (p.data?.group ? groupOf(p.data.group) : p.data ? of(p.data) : '')
  const columns = useMemo<ColDef<Row>[]>(() => [
    { headerName: '', width: 44, minWidth: 44, suppressSizeToFit: true, pinned: 'left', cellRenderer: SelectCell },
    {
      headerName: 'Status', width: 170, minWidth: 150, pinned: 'left', cellRenderer: StatusCell,
      valueGetter: (p) => (p.data && !p.data.group ? STATUS_LABELS[approvals[p.data.campaignId]?.status as ApprovalStatus] ?? '' : ''),
      ...pageSetColumn<Row>('Status', statusOptions.map((k) => STATUS_LABELS[k]), statusFilter.map((k) => STATUS_LABELS[k]),
        (labels) => setStatusFilter(FILTERABLE_STATUSES.filter((k) => labels.includes(STATUS_LABELS[k])))),
    },
    {
      headerName: 'Advertiser', width: 190, minWidth: 160, pinned: 'left', cellRenderer: AdvertiserCell, valueGetter: (p) => p.data?.advertiserName ?? '—',
      ...externalSetColumn<Row>('Advertiser', advertiserOptions.map((a) => a.label), advertiserOptions.find((a) => a.value === advertiserId)?.label,
        (name) => setAdvertiserFilter(advertiserOptions.find((a) => a.label === name)?.value)),
    },
    /* The campaign's own name, linking to it; then where it runs, and the creative ID and deal it is grouped under. */
    { headerName: 'Campaign name', width: 220, minWidth: 180, cellRenderer: CampaignNameCell, valueGetter: (p) => joined(p, (c) => c.name, (g) => g.names), ...searchColumn<Row>('Campaign name') },
    { headerName: 'Touch points', width: 170, minWidth: 140, cellRenderer: TouchPointsCell, valueGetter: (p) => (p.data && !p.data.group ? touchPointsOf(p.data).join(', ') : '') },
    { headerName: 'Display types', width: 160, minWidth: 130, cellRenderer: DisplayTypesCell, valueGetter: (p) => (p.data && !p.data.group && p.data.displayTypeId ? displayTypeNames.get(p.data.displayTypeId) ?? p.data.displayTypeId : '') },
    { headerName: 'Creative ID', width: 170, minWidth: 140, cellRenderer: CreativeIdCell, valueGetter: (p) => (p.data && !p.data.group ? approvals[p.data.campaignId]?.creativeId ?? '' : '') },
    /* Deal ID (private auctions): the advertiser's own grouping, set at authoring. Empty for a direct campaign. */
    { headerName: 'Deal ID', width: 150, minWidth: 130, cellRenderer: DealCell, valueGetter: (p) => joined(p, (c) => c.dealId ?? '', (g) => g.deals), ...setColumn<Row>('Deal ID', values((c) => c.dealId ?? '')) },
    { headerName: 'DSP', width: 150, minWidth: 130, valueGetter: (p) => (p.data?.group ? p.data.group.dsps : p.data?.partnerName ?? '—'), ...setColumn<Row>('DSP', values((c) => c.partnerName ?? '')) },
    {
      headerName: 'Localised variables', width: 200, minWidth: 160, cellRenderer: LocalisedVariablesCell,
      valueGetter: (p) => p.data?.localisedVariables.join(', ') ?? '',
    },
    {
      headerName: 'Personalised variables', width: 200, minWidth: 160, cellRenderer: PersonalisedVariablesCell,
      valueGetter: (p) => p.data?.personalisedVariables.join(', ') ?? '',
    },
    /* Received replaces Schedule (Rob, 8 Oct 2026): the forward schedule is no longer relevant on the real-time path. */
    {
      headerName: 'Received', width: 190, minWidth: 160, cellRenderer: ReceivedCell,
      valueGetter: (p) => (p.data && !p.data.group && approvals[p.data.campaignId]?.status === 'awaiting_approval' ? approvals[p.data.campaignId]?.submittedAt ?? '' : ''),
    },
    /* Activation sits left of Last used (ticket dinPPBl9Rk95UbrXoRbt): switch an approved campaign on. */
    { headerName: 'Activation', width: 160, suppressSizeToFit: true, cellRenderer: ActivationCell },
    { headerName: 'Last used', width: 150, minWidth: 130, cellRenderer: LastUsedCell, valueGetter: (p) => p.data?.lastPlayedAt ?? '' },
    { headerName: '', width: 56, suppressSizeToFit: true, pinned: 'right', cellRenderer: RowMenu },
  ], [approvals, all, advertiserOptions, advertiserId, statusOptions, statusFilter, displayTypeNames])

  const toActivate = selectedRows.filter((c) => !c.activation.enabled).length
  const toDeactivate = selectedRows.length - toActivate
  if (!campaigns.data) return <Spin />
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2" style={{ fontSize: 13 }}>
        <span style={{ fontWeight: 700 }}>{all.length} campaign{all.length === 1 ? '' : 's'}</span>
        {selectedRows.length > 0 && (
          <section aria-label="Selected campaigns" className="flex flex-wrap items-center justify-end gap-2">
            <b>{selectedRows.length} selected</b>
            {mixed ? (
              <span style={{ color: T.muted }}>These campaigns have different statuses, so no action applies to all of them. Choose campaigns with the same status.</span>
            ) : allApproved ? (
              <>
                <Button type="primary" size="small" loading={busy === 'batch'} disabled={toActivate === 0} onClick={() => void done(activateMany(selectedRows, true))}>Activate Selected</Button>
                <Button size="small" loading={busy === 'batch'} disabled={toDeactivate === 0} onClick={() => void done(activateMany(selectedRows, false))}>Deactivate Selected</Button>
                {autoOnly && oneAdvertiser && (
                  <>
                    <Button type="primary" size="small" ghost loading={busy === 'batch'} onClick={() => void done(assignCreativeId(selectedApprovals))}>Generate creative ID</Button>
                    <Button type="primary" size="small" ghost disabled={busy === 'batch'} onClick={openPicker}>Assign to existing creative ID</Button>
                  </>
                )}
              </>
            ) : oneAdvertiser ? (
              <>
                <Button type="primary" size="small" loading={busy === 'batch'} onClick={() => void done(approveAssign(selectedApprovals))}>Approve Selected</Button>
                <Button type="primary" size="small" ghost disabled={busy === 'batch'} onClick={openPicker}>Approve into existing creative ID</Button>
                <Button size="small" danger onClick={() => { setReason(''); setRejecting(true) }}>Reject Selected</Button>
              </>
            ) : (
              <>
                <span style={{ color: T.muted }}>Choose one advertiser’s campaigns to approve them into a creative ID.</span>
                <Button size="small" danger onClick={() => { setReason(''); setRejecting(true) }}>Reject Selected</Button>
              </>
            )}
            <Button size="small" type="link" onClick={() => setTicked(new Set())}>Clear</Button>
          </section>
        )}
      </div>
      <Grid<Row>
        label="Campaign Status"
        rows={rows}
        columns={columns}
        context={ctx}
        getRowId={(c) => c.campaignId}
        getRowStyle={(p) => (p.data?.group ? { background: T.surfaceAlt } : undefined)}
        rowHeight={56}
        headerHeight={40}
        floatingFiltersHeight={40}
        stickyHeader
        suppressHorizontalScroll={false}
        /* A column filter hides rows; their ticks go with them. */
        onFilterChanged={(e) => {
          const shown = new Set<string>()
          e.api.forEachNodeAfterFilter((n) => n.data && !n.data.group && shown.add(n.data.campaignId))
          setVisible(shown)
        }}
      />
      <Modal
        open={picking}
        title={autoOnly ? 'Assign to existing creative ID' : 'Approve into existing creative ID'}
        okText={`${autoOnly ? 'Assign' : 'Approve'}${choice ? ` to ${choice}` : ''}`}
        okButtonProps={{ disabled: !choice }}
        confirmLoading={busy === 'batch'}
        onCancel={() => setPicking(false)}
        onOk={async () => {
          const ok = await done(autoOnly ? assignCreativeId(selectedApprovals, choice!) : approveAssign(selectedApprovals, choice!))
          if (ok) setPicking(false)
        }}
        width={640}
      >
        <p style={{ color: T.muted }}>Pick the creative ID these {selectedRows.length === 1 ? 'campaign belongs' : 'campaigns belong'} with. Each shows the campaigns already under it, so you can match by their siblings.{autoOnly ? '' : ' “Approve” here approves the creative.'}</p>
        {creativeIds.isLoading ? <Spin /> : !creativeIds.data?.length ? (
          <p>This advertiser has no creative IDs yet. Use “{autoOnly ? 'Generate creative ID' : 'Approve Selected'}”.</p>
        ) : (
          <Radio.Group value={choice} onChange={(e) => setChoice(e.target.value)} className="flex flex-col gap-2" aria-label="Creative IDs">
            {creativeIds.data.map((g) => (
              <Radio key={g.creativeId} value={g.creativeId} className="rounded border p-2" style={{ alignItems: 'flex-start', borderColor: choice === g.creativeId ? T.primary : T.border }}>
                <b>{g.creativeId}</b>{originals.has(g.creativeId) && <Tag color="blue" className="ml-2">original (resubmission)</Tag>}{deal && (g.dealIds ?? (g.dealId ? [g.dealId] : [])).includes(deal) && <Tag color="green" className="ml-2">same deal ({deal})</Tag>}{(g.dealIds?.length ?? 0) > 1 && <Tag className="ml-2">{g.dealIds!.length} deals</Tag>}
                <ul className="m-0 mt-1 list-none p-0" style={{ fontSize: 12, color: T.muted }}>
                  {g.campaigns.map((m) => <li key={m.campaignId}>{m.name} — {m.touchPoints.join(', ') || 'no touch points'}</li>)}
                </ul>
              </Radio>
            ))}
          </Radio.Group>
        )}
      </Modal>
      <Modal
        open={rejecting}
        title={selectedRows.length === 1 ? `Reject ${selectedRows[0].name}?` : `Reject ${selectedRows.length} campaigns?`}
        okText="Reject"
        okButtonProps={{ danger: true, disabled: !reason.trim() }}
        confirmLoading={busy === 'batch'}
        onCancel={() => setRejecting(false)}
        onOk={async () => {
          const ok = await done(rejectMany(selectedApprovals, reason.trim()))
          if (ok) setRejecting(false)
        }}
      >
        <Input.TextArea aria-label="Reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is it rejected? The advertiser sees this and fixes it before resubmitting." />
      </Modal>
    </div>
  )
}
