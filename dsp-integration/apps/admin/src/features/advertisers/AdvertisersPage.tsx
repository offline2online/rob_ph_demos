/* Advertisers / Inventory (spec §3, §5; admin only): every advertiser across
   all DSPs, with campaign approval and floor multiplier per advertiser, and
   below it the inventory they can buy — every advertiser-owned slot across
   the estate, which moved here from Advertiser settings (Rob, 20 Sep).
   Campaigns are not approved here. Changes are applied with Save changes. */
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { App, Button, InputNumber, Spin, Switch, Tooltip } from 'antd'
import type { ColDef, ICellRendererParams } from 'ag-grid-community'
import { SLOT_OWNERS, touchPointIcon, type Advertiser, type AdvertiserSetting, type AvailableInventoryRow, type Session } from '@ph-dsp/types'
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
import { useReportDirty } from '../../shared/UnsavedChanges'
import { useDraft } from '../../shared/useDraft'
import { T } from '../../theme/phTheme'
import { BOOKING_SCHEDULE_PATH } from '../booking-schedule/path'

interface Data { currency: string; floorCpm: number; items: Advertiser[] }
type Settings = Record<string, AdvertiserSetting>
type Ctx = { current: { settings: Settings; data: Data; canEdit: boolean; set: (id: string, patch: Partial<AdvertiserSetting>) => void; openBookings: (advertiserId: string) => void } }
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

function CampaignsCell({ data }: P) {
  if (!data) return null
  const shown = CAMPAIGN_STATES.filter((s) => data.campaigns[s.key] > 0)
  if (!shown.length) return <span style={{ fontSize: 12, color: T.micro }}>None yet</span>
  return (
    <span className="inline-flex items-center gap-2.5">
      {shown.map((s) => (
        <Tooltip key={s.key} title={`${data.campaigns[s.key]} ${s.label}`}>
          <span className="inline-flex items-center gap-[3px]" style={{ fontSize: 12.5, color: s.colour }}>
            <Icon name={s.icon} size={15} />{data.campaigns[s.key]}
          </span>
        </Tooltip>
      ))}
    </span>
  )
}
const BookingsCell = ({ data, context }: P) =>
  data ? <Button color="primary" variant="text" size="small" className="px-0" icon={<Icon name="calendar_month" size={15} />} onClick={() => context.current.openBookings(data.advertiserId)}>Bookings</Button> : null

/* The inventory advertisers can buy: every Advertiser-owned slot on a
   display type (spec §5 "Available Inventory"). No advertisers column. */
type InvCtx = { current: { open: (displayTypeId: string) => void } }
const TypeCell = ({ data }: ICellRendererParams<AvailableInventoryRow>) =>
  data ? <span className="inline-flex min-w-0 items-center gap-[5px]"><Icon name={touchPointIcon(data.touchPoint ?? '')} size={14} style={{ color: T.muted }} /><span className="truncate">{data.displayTypeName}</span></span> : null
const SlotCell = ({ data }: ICellRendererParams<AvailableInventoryRow>) =>
  data ? <div className="min-w-0"><div className="truncate">{data.position}</div><div style={{ fontSize: 11, color: T.micro }}>{data.partnerName ?? 'Any connected DSP'}</div></div> : null
const OpenCell = ({ data, context }: ICellRendererParams<AvailableInventoryRow, unknown, InvCtx>) =>
  data ? <Button color="primary" variant="text" size="small" className="px-0" onClick={() => context.current.open(data.displayTypeId)}>Open</Button> : null

const header = (label: string, tip: string) => () => <WithTip tip={tip}><span className="ag-header-cell-text">{label}</span></WithTip>

export function AdvertisersPage() {
  const navigate = useNavigate()
  const { message } = App.useApp()
  const qc = useQueryClient()
  const session = useQuery({ queryKey: ['session'], queryFn: () => api<Session>('GET', '/admin/v1/session') })
  /* Marketing users read this screen; only an admin changes approval or pricing (Rob, 20 Sep). */
  const canEdit = session.data?.role === 'hq_admin'
  const q = useQuery({ queryKey: ['advertisers'], queryFn: () => api<Data>('GET', '/admin/v1/advertisers'), retry: false })
  const inventory = useQuery({ queryKey: ['available-inventory'], queryFn: () => api<{ items: AvailableInventoryRow[] }>('GET', '/admin/v1/available-inventory').then((r) => r.items) })
  const inventoryColumns = useMemo<ColDef<AvailableInventoryRow>[]>(() => [
    { headerName: 'Display type', width: 260, cellRenderer: TypeCell },
    { headerName: 'Playlist', width: 170, field: 'playlistName', cellStyle: { color: T.muted } },
    { headerName: 'Slot', width: 70, field: 'slot', suppressSizeToFit: true, cellStyle: { color: T.muted } },
    { headerName: 'Position', width: 160, cellRenderer: SlotCell },
    { headerName: '', width: 76, suppressSizeToFit: true, cellRenderer: OpenCell },
  ], [])
  const saved = useMemo<Settings | undefined>(() => q.data && Object.fromEntries(q.data.items.map((a) => [a.advertiserId, { approvalRequired: a.approvalRequired, floorMultiplier: a.floorMultiplier }])), [q.data])
  const { draft, setDraft, dirty, reset, commitNext } = useDraft(saved)
  useReportDirty(dirty)
  const [saving, setSaving] = useState(false)
  const data = q.data
  const columns = useMemo<ColDef<Advertiser>[]>(() => data ? [
    { headerName: 'Advertiser', width: 200, minWidth: 150, cellRenderer: NameCell },
    { headerName: 'Via', width: 170, minWidth: 120, cellRenderer: ViaCell, headerComponent: header('Via', "The DSP(s) this advertiser's campaigns come through.") },
    { headerName: 'Campaign approval', width: 160, suppressSizeToFit: true, cellRenderer: ApprovalCell, headerComponent: header('Campaign approval', 'Required: the advertiser’s campaigns wait for approval in the Campaigns section. Not required: they publish after automated checks.') },
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
      await api('PUT', '/admin/v1/advertisers', { settings: draft })
      commitNext()
      await qc.invalidateQueries({ queryKey: ['advertisers'] })
    } catch (e) {
      message.error(e instanceof ApiRequestError ? [e.message, ...(e.body?.error.details ?? []).map((d) => d.reason)].join(' ') : 'Could not save changes.')
    } finally {
      setSaving(false)
    }
  }
  const context = {
    settings: draft, data, canEdit,
    set: (id: string, patch: Partial<AdvertiserSetting>) => setDraft((cur) => (cur ? { ...cur, [id]: { ...cur[id], ...patch } } : cur)),
    openBookings: (advertiserId: string) => window.open(`${BOOKING_SCHEDULE_PATH}?advertiserId=${encodeURIComponent(advertiserId)}`, '_blank', 'noopener'),
  }

  return (
    <div>
      <div className="mb-3.5 flex justify-end">
        <StatusPill colour={T.muted} icon={canEdit ? 'admin_panel_settings' : 'visibility'}>{canEdit ? 'Admin only' : 'Read only'}</StatusPill>
      </div>
      {data.items.length === 0 ? (
        <div className="flex items-center gap-2" style={{ fontSize: 12.5, color: T.muted }}><Icon name="sell" size={18} />No advertisers yet. They appear here once a DSP is connected.</div>
      ) : (
        <Grid<Advertiser> label="Advertisers" rows={data.items} columns={columns} context={context} getRowId={(a) => a.advertiserId} />
      )}
      <div className="flex items-center justify-between gap-3">
        <SectionLabel><WithTip tip="Every advertiser-owned slot across the estate that connected DSPs can bid on. Slots are made available by setting their owner to Advertiser on a display type.">Available Inventory</WithTip></SectionLabel>
        <Button color="primary" variant="text" size="small" icon={<Icon name="calendar_month" size={16} />} style={{ marginTop: 12 }} onClick={() => window.open(BOOKING_SCHEDULE_PATH, '_blank', 'noopener')}>Booking schedule</Button>
      </div>
      {inventory.data && inventory.data.length === 0 ? (
        <div className="flex items-center gap-2" style={{ fontSize: 12.5, color: T.muted }}>
          <Icon name="view_week" size={18} />
          <span>No advertiser positions yet. Set a slot's owner to <b>Advertiser</b> on a display type.</span>
        </div>
      ) : (
        <Grid<AvailableInventoryRow>
          label="Available Inventory"
          rows={inventory.data ?? []}
          columns={inventoryColumns}
          context={{ open: (id: string) => navigate(`/display-types?id=${encodeURIComponent(id)}`) }}
          getRowId={(r) => `${r.displayTypeId}:${r.slot}`}
          rowHeight={52}
        />
      )}

      {canEdit && <SaveBar dirty={dirty} saving={saving} onSave={onSave} onCancel={reset} />}
    </div>
  )
}
