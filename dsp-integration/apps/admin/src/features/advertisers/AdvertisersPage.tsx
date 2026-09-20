/* Advertisers / Inventory (spec §3, §5; admin only): every advertiser across
   all DSPs, with campaign approval and floor multiplier per advertiser, and
   below it the inventory they can buy — every advertiser-owned slot across
   the estate, which moved here from Advertiser settings (Rob, 20 Sep).
   Campaigns are not approved here. Changes are applied with Save changes. */
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { App, Button, InputNumber, Select, Spin, Switch, Tooltip } from 'antd'
import type { ColDef, ICellRendererParams } from 'ag-grid-community'
import { SLOT_OWNERS, TARGETING_MODES, assignedLabels, supportedTargetingOf, targetingLabel, touchPointIcon, type Advertiser, type AdvertiserSetting, type AssignedTo, type AvailableInventoryRow, type DspAdvertisers, type Session, type TargetingMode } from '@ph-dsp/types'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, ApiRequestError } from '../../api/client'
import { Callout } from '../../shared/Callout'
import { Grid } from '../../shared/Grid'
import { Icon } from '../../shared/Icon'
import { WithTip } from '../../shared/InfoTip'
import { SectionLabel } from '../../shared/SectionLabel'
import { StatusPill } from '../../shared/Pill'
import { SaveBar } from '../../shared/SaveBar'
import { searchColumn, setColumn, showingCount } from '../../shared/TableFilters'
import { useReportDirty } from '../../shared/UnsavedChanges'
import { useDraft } from '../../shared/useDraft'
import { T } from '../../theme/phTheme'
import { BOOKING_SCHEDULE_PATH } from '../booking-schedule/path'

interface Data { currency: string; floorCpm: number; items: Advertiser[] }
type Settings = Record<string, AdvertiserSetting>
type Ctx = { current: { settings: Settings; data: Data; canEdit: boolean; set: (id: string, patch: Partial<AdvertiserSetting>) => void; openBookings: (advertiserId: string) => void; openCampaigns: (advertiserId: string) => void } }
type P = ICellRendererParams<Advertiser, unknown, Ctx>

const effective = (floor: number, m: number) => Math.round(floor * (m || 0) * 100) / 100

const NameCell = ({ data }: P) => (data ? <span className="inline-flex min-w-0 items-center gap-1.5"><Icon name="sell" size={14} style={{ color: SLOT_OWNERS.advertiser.colour }} /><span className="truncate">{data.name}</span></span> : null)
const ViaCell = ({ data }: P) => (data ? <span className="truncate" style={{ color: T.muted }}>{data.via.join(', ')}</span> : null)
function ApprovalCell({ data, context }: P) {
  if (!data) return null
  const s = context.current.settings[data.advertiserId]
  return (
    <span className="inline-flex items-center gap-2">
      <Switch size="small" aria-label={`${data.name}: campaign approval`} disabled={!context.current.canEdit} checked={s.approvalRequired} onChange={(v) => context.current.set(data.advertiserId, { approvalRequired: v })} />
      <span style={{ fontSize: 11.5, color: T.muted }}>{s.approvalRequired ? 'Required' : 'Not required'}</span>
    </span>
  )
}
function MultiplierCell({ data, context }: P) {
  if (!data) return null
  return (
    <InputNumber size="small" aria-label={`${data.name}: floor multiplier`} disabled={!context.current.canEdit} step={0.05} min={0} style={{ width: 90 }}
      formatter={(v) => (v === undefined || v === null ? '' : String(v))} parser={(v) => Number(v)}
      value={context.current.settings[data.advertiserId].floorMultiplier}
      onChange={(v) => context.current.set(data.advertiserId, { floorMultiplier: v === null ? 1 : Number(v) })} />
  )
}
function EffectiveCell({ data, context }: P) {
  if (!data) return null
  const { settings, data: d } = context.current
  return <span>{`${d.currency} ${effective(d.floorCpm, settings[data.advertiserId].floorMultiplier).toFixed(2)} CPM`}</span>
}
/* This advertiser's campaigns by approval status, and a way into its
   bookings on the schedule (Rob, 20 Sep). */
const CAMPAIGN_STATES = [
  { key: 'approved', icon: 'check_circle', colour: T.success, label: 'approved' },
  { key: 'awaiting_approval', icon: 'schedule', colour: T.warning, label: 'awaiting approval' },
  { key: 'rejected', icon: 'cancel', colour: T.error, label: 'rejected' },
  { key: 'draft', icon: 'edit_note', colour: T.micro, label: 'draft' },
] as const

/* The counts open Campaign Status filtered to this advertiser (Rob, 20 Sep). */
function CampaignsCell({ data, context }: P) {
  if (!data) return null
  const shown = CAMPAIGN_STATES.filter((s) => data.campaigns[s.key] > 0)
  const open = () => context.current.openCampaigns(data.advertiserId)
  if (!shown.length) return <span style={{ fontSize: 12, color: T.micro }}>None yet</span>
  return (
    <Tooltip title={`${shown.map((s) => `${data.campaigns[s.key]} ${s.label}`).join(', ')} — open in Campaign Status`}>
      <Button type="text" size="small" className="px-1" aria-label={`${data.name}: campaigns`} onClick={open}>
        <span className="inline-flex items-center gap-2.5">
          {shown.map((s) => (
            <span key={s.key} className="inline-flex items-center gap-[3px]" style={{ fontSize: 12.5, color: s.colour }}>
              <Icon name={s.icon} size={15} />{data.campaigns[s.key]}
            </span>
          ))}
        </span>
      </Button>
    </Tooltip>
  )
}
const BookingsCell = ({ data, context }: P) =>
  data ? <Button color="primary" variant="text" size="small" className="px-0" icon={<Icon name="calendar_month" size={15} />} onClick={() => context.current.openBookings(data.advertiserId)}>Bookings</Button> : null

/* The inventory advertisers can buy: every Advertiser-owned slot on a
   display type (spec §5 "Available Inventory"). No advertisers column. */
export const slotKey = (r: AvailableInventoryRow) => `${r.displayTypeId}:${r.slot}`
/* What Save changes sends for a slot: the two fields this table owns. */
export interface SlotEdit { supportedTargeting: TargetingMode[]; assignedTo: Omit<AssignedTo, 'partnerNames'> }
type Edits = Record<string, SlotEdit>
type InvCtx = { current: {
  open: (displayTypeId: string) => void
  canEdit: boolean
  edits: Edits
  dsps: DspAdvertisers[]
  set: (key: string, patch: Partial<SlotEdit>) => void
} }
type IP = ICellRendererParams<AvailableInventoryRow, unknown, InvCtx>
const TypeCell = ({ data }: ICellRendererParams<AvailableInventoryRow>) =>
  data ? <span className="inline-flex min-w-0 items-center gap-[5px]"><Icon name={touchPointIcon(data.touchPoint ?? '')} size={14} style={{ color: T.muted }} /><span className="truncate">{data.displayTypeName}</span></span> : null
const SlotCell = ({ data }: ICellRendererParams<AvailableInventoryRow>) =>
  data ? <div className="min-w-0 truncate">{data.position}</div> : null
/* Opens the display type with Playlist Settings — where slot assignment
   lives — already expanded (Rob, 20 Sep). */
const OpenCell = ({ data, context }: IP) =>
  data ? <Button color="primary" variant="text" size="small" className="px-0" onClick={() => context.current.open(data.displayTypeId)}>Open</Button> : null

/* Both editable columns are the same control (Rob, 20 Sep): a multi-select
   that drops a pill per choice into the cell, read-only text for marketing. */
function Pills({ label, value, options, canEdit, placeholder, onChange }: {
  label: string
  value: string[]
  options: { label: string; options: { value: string; label: string }[] }[]
  canEdit: boolean
  placeholder?: string
  onChange: (next: string[]) => void
}) {
  const all = options.flatMap((g) => g.options)
  if (!canEdit) {
    const chosen = value.map((v) => all.find((o) => o.value === v)?.label ?? v)
    return <span className="truncate" style={{ color: chosen.length ? T.text : T.muted }}>{chosen.join(', ') || placeholder}</span>
  }
  return (
    <Select<string[]>
      mode="multiple" size="small" className="w-full" allowClear={false} showSearch optionFilterProp="label"
      aria-label={label} placeholder={placeholder} value={value} onChange={onChange} options={options}
    />
  )
}

const edited = (c: InvCtx['current'], r: AvailableInventoryRow): SlotEdit =>
  c.edits[slotKey(r)] ?? { supportedTargeting: supportedTargetingOf(r), assignedTo: r.assignedTo }

/* Who may buy this position (Rob, 20 Sep): DSPs, named advertisers, or the
   whitelist. Nothing chosen means any connected DSP. */
const WHITELIST = '__whitelist__'
const assignedValues = (a: Omit<AssignedTo, 'partnerNames'>) =>
  [...a.partnerIds.map((id) => `dsp:${id}`), ...a.advertisers.map((n) => `adv:${n}`), ...(a.whitelistOnly ? [WHITELIST] : [])]

function AssignedCell({ data, context }: IP) {
  if (!data) return null
  const c = context.current
  const a = edited(c, data).assignedTo
  const dspNames = new Map(c.dsps.map((d) => [d.partnerId, d.name]))
  const options = [
    { label: 'DSPs', options: c.dsps.map((d) => ({ value: `dsp:${d.partnerId}`, label: d.name })) },
    { label: 'Advertisers', options: c.dsps.flatMap((d) => d.advertisers.map((x) => ({ value: `adv:${x.name}`, label: `${x.name} (${d.name})` }))) },
    { label: 'Or', options: [{ value: WHITELIST, label: 'Whitelist only' }] },
  ]
  return (
    <Pills
      label={`${data.displayTypeName} slot ${data.slot}: assigned to`}
      placeholder="All DSPs"
      canEdit={c.canEdit}
      value={assignedValues(a)}
      options={options}
      onChange={(next) => {
        const was = assignedValues(a)
        const added = next.filter((v) => !was.includes(v))
        /* A position is either held for named advertisers or open to the
           whitelist, never both: the newer choice wins. */
        const advertisers = added.includes(WHITELIST) ? [] : next.filter((v) => v.startsWith('adv:')).map((v) => v.slice(4))
        const whitelistOnly = advertisers.length ? false : next.includes(WHITELIST)
        const partnerIds = next.filter((v) => v.startsWith('dsp:')).map((v) => v.slice(4)).filter((id) => dspNames.has(id))
        c.set(slotKey(data), { assignedTo: { partnerIds, advertisers, whitelistOnly } })
      }}
    />
  )
}

/* What a campaign may use on this slot (Rob, 20 Sep): localised only until
   someone opens it up, and a bid of an unsupported type is refused. */
function TargetingCell({ data, context }: IP) {
  if (!data) return null
  const c = context.current
  const value = edited(c, data).supportedTargeting
  return (
    <Pills
      label={`${data.displayTypeName} slot ${data.slot}: targeting supported`}
      canEdit={c.canEdit}
      value={value}
      options={[{ label: 'Targeting', options: TARGETING_MODES.map((m) => ({ value: m.key, label: m.label })) }]}
      /* A slot always supports something: the last one can't be removed. */
      onChange={(next) => next.length && c.set(slotKey(data), { supportedTargeting: TARGETING_MODES.filter((m) => next.includes(m.key)).map((m) => m.key) })}
    />
  )
}

const header = (label: string, tip: string) => () => <WithTip tip={tip}><span className="ag-header-cell-text">{label}</span></WithTip>

export function AdvertisersPage() {
  const navigate = useNavigate()
  const { message } = App.useApp()
  const qc = useQueryClient()
  const session = useQuery({ queryKey: ['session'], queryFn: () => api<Session>('GET', '/admin/v1/session') })
  /* Marketing users read this screen; only an admin changes approval or pricing (Rob, 20 Sep). */
  const canEdit = session.data?.role === 'hq_admin'
  const q = useQuery({ queryKey: ['advertisers'], queryFn: () => api<Data>('GET', '/admin/v1/advertisers'), retry: false })
  const inventory = useQuery({ queryKey: ['available-inventory'], queryFn: () => api<{ items: AvailableInventoryRow[]; dsps: DspAdvertisers[] }>('GET', '/admin/v1/available-inventory') })
  const invRows = inventory.data?.items ?? []
  const [invShown, setInvShown] = useState<number | null>(null)
  const invValues = (of: (r: AvailableInventoryRow) => string[]) => () => invRows.flatMap(of)
  const inventoryColumns = useMemo<ColDef<AvailableInventoryRow>[]>(() => [
    { headerName: 'Display type', width: 190, minWidth: 160, cellRenderer: TypeCell, valueGetter: (p) => p.data?.displayTypeName ?? '', ...searchColumn<AvailableInventoryRow>('Display type') },
    { headerName: 'Playlist', width: 150, field: 'playlistName', cellStyle: { color: T.muted }, ...setColumn<AvailableInventoryRow>('Playlist', invValues((r) => [r.playlistName])) },
    { headerName: 'Slot', width: 70, field: 'slot', suppressSizeToFit: true, cellStyle: { color: T.muted }, ...setColumn<AvailableInventoryRow>('Slot', invValues((r) => [String(r.slot)])) },
    { headerName: 'Position', width: 130, minWidth: 110, cellRenderer: SlotCell, valueGetter: (p) => p.data?.position ?? '', ...searchColumn<AvailableInventoryRow>('Position') },
    {
      headerName: 'Assigned to', width: 240, minWidth: 200, cellRenderer: AssignedCell, autoHeight: true,
      headerComponent: header('Assigned to', 'Who may buy this position: pick DSPs to say who may bid, advertisers to hold it for them (their DSP comes along), or the whitelist. Nothing chosen means any connected DSP.'),
      valueGetter: (p) => {
        if (!p.data) return ''
        const a = edited((p.context as InvCtx).current, p.data).assignedTo
        return assignedLabels({ ...a, partnerNames: a.partnerIds.map((id) => inventory.data?.dsps.find((d) => d.partnerId === id)?.name ?? id) }).join(', ') || 'All DSPs'
      },
      ...setColumn<AvailableInventoryRow>('Assigned to', () => [
        'All DSPs', 'Whitelist only',
        ...(inventory.data?.dsps ?? []).flatMap((d) => [d.name, ...d.advertisers.map((a) => a.name)]),
      ]),
    },
    {
      headerName: 'Targeting supported', width: 230, minWidth: 190, cellRenderer: TargetingCell, autoHeight: true,
      headerComponent: header('Targeting supported', 'What a campaign may use on this slot. Localised only unless you open it up; a bid for a campaign of any other type is refused. Personalised and interactive carry their own multipliers on the floor price.'),
      valueGetter: (p) => (p.data ? targetingLabel(edited((p.context as InvCtx).current, p.data).supportedTargeting) : ''),
      ...setColumn<AvailableInventoryRow>('Targeting supported', () => TARGETING_MODES.map((m) => m.label)),
    },
    { headerName: '', width: 76, suppressSizeToFit: true, cellRenderer: OpenCell },
  ], [invRows, inventory.data])
  const saved = useMemo<Settings | undefined>(() => q.data && Object.fromEntries(q.data.items.map((a) => [a.advertiserId, { approvalRequired: a.approvalRequired, floorMultiplier: a.floorMultiplier }])), [q.data])
  const { draft, setDraft, dirty, reset, commitNext } = useDraft(saved)
  const savedEdits = useMemo<Edits | undefined>(() => inventory.data && Object.fromEntries(invRows.map((r) => {
    const { partnerNames: _names, ...assignedTo } = r.assignedTo
    return [slotKey(r), { supportedTargeting: supportedTargetingOf(r), assignedTo }]
  })), [invRows, inventory.data])
  const inv = useDraft(savedEdits)
  useReportDirty(dirty || inv.dirty)
  const [saving, setSaving] = useState(false)
  const [shown, setShown] = useState<number | null>(null)
  const data = q.data
  const columns = useMemo<ColDef<Advertiser>[]>(() => data ? [
    { headerName: 'Advertiser', width: 200, minWidth: 150, cellRenderer: NameCell, valueGetter: (p) => p.data?.name ?? '', ...searchColumn<Advertiser>('Advertiser') },
    {
      headerName: 'Via', width: 170, minWidth: 120, cellRenderer: ViaCell, valueGetter: (p) => (p.data?.via ?? []).join(', '),
      headerComponent: header('Via', "The DSP(s) this advertiser's campaigns come through."),
      ...setColumn<Advertiser>('Via', () => data.items.flatMap((a) => a.via)),
    },
    {
      headerName: 'Campaign approval', width: 160, suppressSizeToFit: true, cellRenderer: ApprovalCell,
      valueGetter: (p) => (p.data && (p.context as Ctx).current.settings[p.data.advertiserId]?.approvalRequired ? 'Required' : 'Not required'),
      headerComponent: header('Campaign approval', 'Required: the advertiser’s campaigns wait for approval in the Campaigns section. Not required: they publish after automated checks.'),
      ...setColumn<Advertiser>('Campaign approval', () => ['Required', 'Not required']),
    },
    { headerName: 'Floor multiplier', width: 140, suppressSizeToFit: true, cellRenderer: MultiplierCell, headerComponent: header('Floor multiplier', 'Scales this advertiser’s floor. Default 1.0, e.g. 0.8 for a preferred supplier or 1.2 for a new one.') },
    { headerName: 'Effective floor', width: 150, minWidth: 140, cellRenderer: EffectiveCell, headerComponent: header('Effective floor', `Floor CPM (${data.currency} ${data.floorCpm}, set in DSP Integration → Advertiser settings) × this advertiser's floor multiplier.`) },
    { headerName: 'Campaigns', width: 140, minWidth: 120, suppressSizeToFit: true, cellRenderer: CampaignsCell, headerComponent: header('Campaigns', 'This advertiser’s campaigns by approval status: approved, awaiting approval, rejected, draft. Open Campaign Status to act on them.') },
    { headerName: '', width: 130, suppressSizeToFit: true, cellRenderer: BookingsCell, headerComponent: header('', 'Opens this advertiser’s upcoming bookings on the booking schedule.') },
  ] : [], [data])

  if (q.error) return <Callout tone="error" icon="block">{q.error instanceof ApiRequestError ? q.error.message : 'Could not load advertisers.'}</Callout>
  if (!data || !draft) return <Spin />

  const onSave = async () => {
    setSaving(true)
    try {
      if (dirty) await api('PUT', '/admin/v1/advertisers', { settings: draft })
      /* The inventory's own field, saved by the same Save changes. */
      if (inv.dirty && inv.draft) {
        const items = Object.entries(inv.draft).map(([key, edit]) => ({ displayTypeId: key.slice(0, key.lastIndexOf(':')), slot: Number(key.slice(key.lastIndexOf(':') + 1)), ...edit }))
        await api('PUT', '/admin/v1/available-inventory', { items })
        inv.commitNext()
        await qc.invalidateQueries({ queryKey: ['available-inventory'] })
      }
      commitNext()
      await qc.invalidateQueries({ queryKey: ['advertisers'] })
    } catch (e) {
      message.error(e instanceof ApiRequestError ? [e.message, ...(e.body?.error.details ?? []).map((d) => d.reason)].join(' ') : 'Could not save changes.')
    } finally {
      setSaving(false)
    }
  }
  const invContext = {
    open: (id: string) => navigate(`/display-types?id=${encodeURIComponent(id)}&panel=playlist`),
    canEdit, edits: inv.draft ?? {}, dsps: inventory.data?.dsps ?? [],
    set: (key: string, patch: Partial<SlotEdit>) => inv.setDraft((cur) => (cur ? { ...cur, [key]: { ...cur[key], ...patch } } : cur)),
  }
  const context = {
    settings: draft, data, canEdit,
    set: (id: string, patch: Partial<AdvertiserSetting>) => setDraft((cur) => (cur ? { ...cur, [id]: { ...cur[id], ...patch } } : cur)),
    openBookings: (advertiserId: string) => window.open(`${BOOKING_SCHEDULE_PATH}?advertiserId=${encodeURIComponent(advertiserId)}`, '_blank', 'noopener'),
    openCampaigns: (advertiserId: string) => navigate(`/campaign-status?advertiserId=${encodeURIComponent(advertiserId)}`),
  }

  return (
    <div>
      <div className="mb-3.5 flex justify-end">
        <StatusPill colour={T.muted} icon={canEdit ? 'admin_panel_settings' : 'visibility'}>{canEdit ? 'Admin only' : 'Read only'}</StatusPill>
      </div>
      {data.items.length === 0 ? (
        <div className="flex items-center gap-2" style={{ fontSize: 12.5, color: T.muted }}><Icon name="sell" size={18} />No advertisers yet. They appear here once a DSP is connected.</div>
      ) : (
        <>
          <div className="mb-2" style={{ fontSize: 13 }}>{showingCount(shown ?? data.items.length, data.items.length, `advertiser${data.items.length === 1 ? '' : 's'}`)}</div>
          <Grid<Advertiser>
            label="Advertisers" rows={data.items} columns={columns} context={context} getRowId={(a) => a.advertiserId}
            headerHeight={40} floatingFiltersHeight={40} onFilterChanged={(e) => setShown(e.api.getDisplayedRowCount())}
          />
        </>
      )}
      <div className="flex items-center justify-between gap-3">
        <SectionLabel><WithTip tip="Every advertiser-owned slot across the estate that connected DSPs can bid on. Slots are made available by setting their owner to Advertiser on a display type.">Available Inventory</WithTip></SectionLabel>
        <Button color="primary" variant="text" size="small" icon={<Icon name="calendar_month" size={16} />} style={{ marginTop: 12 }} onClick={() => window.open(BOOKING_SCHEDULE_PATH, '_blank', 'noopener')}>Booking schedule</Button>
      </div>
      {inventory.data && invRows.length === 0 ? (
        <div className="flex items-center gap-2" style={{ fontSize: 12.5, color: T.muted }}>
          <Icon name="view_week" size={18} />
          <span>No advertiser positions yet. Set a slot's owner to <b>Advertiser</b> on a display type.</span>
        </div>
      ) : (
        <>
          <div className="mb-2" style={{ fontSize: 13 }}>{showingCount(invShown ?? invRows.length, invRows.length, `position${invRows.length === 1 ? '' : 's'}`)}</div>
          <Grid<AvailableInventoryRow>
            label="Available Inventory"
            rows={invRows}
            columns={inventoryColumns}
            context={invContext}
            getRowId={slotKey}
            rowHeight={52}
            headerHeight={40}
            floatingFiltersHeight={40}
            onFilterChanged={(e) => setInvShown(e.api.getDisplayedRowCount())}
          />
        </>
      )}

      {canEdit && <SaveBar dirty={dirty || inv.dirty} saving={saving} onSave={onSave} onCancel={() => { reset(); inv.reset() }} />}
    </div>
  )
}
