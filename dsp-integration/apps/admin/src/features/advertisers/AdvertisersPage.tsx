/* Advertisers / Inventory (spec §3, §5; admin only): every advertiser across
   all DSPs, with campaign approval and floor multiplier per advertiser, and
   below it the inventory they can buy — every advertiser-owned slot across
   the estate, which moved here from Advertiser settings (Rob, 20 Sep).
   Campaigns are not approved here. Changes are applied with Save changes. */
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { App, Button, InputNumber, Select, Spin, Switch, Tooltip } from 'antd'
import type { ColDef, ICellRendererParams } from 'ag-grid-community'
import { DEFAULT_BILLING_UNIT_HOURS, DEFAULT_MAX_CAMPAIGNS, MAX_MAX_CAMPAIGNS, MIN_MAX_CAMPAIGNS, SLOT_OWNERS, TARGETING_MODES, assignedLabels, supportedTargetingOf, targetingLabel, touchPointIcon, type Advertiser, type AdvertiserSetting, type AssignedTo, type AvailableInventoryRow, type BuyersList, type DspAdvertisers, type Session, type TargetingMode } from '@ph-dsp/types'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, ApiRequestError } from '../../api/client'
import { Q } from '../../api/queries'
import { Callout } from '../../shared/Callout'
import { Grid } from '../../shared/Grid'
import { Icon } from '../../shared/Icon'
import { WithTip } from '../../shared/InfoTip'
import { SectionLabel } from '../../shared/SectionLabel'
import { StatusPill } from '../../shared/Pill'
import { SaveBar } from '../../shared/SaveBar'
import { searchColumn, setColumn, showingCount } from '../../shared/TableFilters'
import { useReportDirty } from '../../shared/UnsavedChanges'
import { deepEqual } from '../../shared/deepEqual'
import { useDraft } from '../../shared/useDraft'
import { T } from '../../theme/phTheme'
import { BOOKING_SCHEDULE_PATH, externalUrl } from '../booking-schedule/path'
import { BuyersListModal } from './BuyersListModal'
import { BuyersListsTable } from './BuyersListsTable'

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
/* Only offered when there is something to look at (Rob, 20 Sep). */
const BookingsCell = ({ data, context }: P) =>
  data?.bookings ? <Button color="primary" variant="text" size="small" className="px-0" icon={<Icon name="calendar_month" size={15} />} onClick={() => context.current.openBookings(data.advertiserId)}>Bookings</Button> : null

/* The inventory advertisers can buy: every Advertiser-owned slot on a
   display type (spec §5 "Available Inventory"). No advertisers column. */
export const slotKey = (r: AvailableInventoryRow) => `${r.displayTypeId}:${r.slot}`
/* What Save changes sends for a slot: the fields this table owns.
   reservePrice is this slot's own override; null means it follows its
   display type's shared default (below), not "no reserve" (Rob, 22 Sep;
   spec §1 configuration inheritance — override always wins). */
export interface SlotEdit { supportedTargeting: TargetingMode[]; assignedTo: Omit<AssignedTo, 'partnerNames' | 'buyersListName'>; reservePrice: number | null; billingUnitHours: number | null; maxCampaigns: number | null }
type Edits = Record<string, SlotEdit>
/* A display type's reserve price default, edited from any of its slot
   rows — every row for the same displayTypeId shares one value. Also used
   for the billing-unit default (spec "Private auctions: two-period model",
   23 Sep 2026) and the max-campaigns default (ticket "Available Inventory:
   Max campaigns column + slot playlist statement") — same inheritance
   shape, separate maps/drafts. */
type Defaults = Record<string, number | null>
type InvCtx = { current: {
  open: (displayTypeId: string) => void
  canEdit: boolean
  currency: string
  edits: Edits
  defaults: Defaults
  billingUnitDefaults: Defaults
  maxCampaignsDefaults: Defaults
  dsps: DspAdvertisers[]
  buyersLists: BuyersList[]
  set: (key: string, patch: Partial<SlotEdit>) => void
  setDefault: (displayTypeId: string, v: number | null) => void
  setBillingUnitDefault: (displayTypeId: string, v: number | null) => void
  setMaxCampaignsDefault: (displayTypeId: string, v: number | null) => void
  openAddBuyersList: (r: AvailableInventoryRow) => void
} }
type IP = ICellRendererParams<AvailableInventoryRow, unknown, InvCtx>
/* QR Control is flagged here because it is what makes interactive targeting
   possible on this display type (Rob, 20 Sep). Vision/AI is flagged
   alongside it, before the QR Control icon (ticket "show a computer vision
   icon when computer vision is enabled on a specific display type", 22
   Sep) — this display type's own hardware capability (Display Types →
   Enabled Features → Vision/AI), not any one booking's personalised
   targeting rules. */
const TypeCell = ({ data }: ICellRendererParams<AvailableInventoryRow>) =>
  data ? (
    <span className="inline-flex min-w-0 items-center gap-[5px]">
      <Icon name={touchPointIcon(data.touchPoint ?? '')} size={14} style={{ color: T.muted }} />
      <span className="truncate">{data.displayTypeName}</span>
      {data.visionAi && (
        <Tooltip title="Vision/AI is enabled on this display type: on-device computer vision for passerby insight and person match.">
          <span className="inline-flex" aria-label="Vision/AI enabled"><Icon name="visibility" size={15} style={{ color: T.primary }} /></span>
        </Tooltip>
      )}
      {data.qrControl && (
        <Tooltip title="QR Control is enabled on this display type, so its slots can support interactive campaigns.">
          <span className="inline-flex" aria-label="QR Control enabled"><Icon name="qr_code_2" size={15} style={{ color: T.primary }} /></span>
        </Tooltip>
      )}
    </span>
  ) : null
const SlotCell = ({ data }: ICellRendererParams<AvailableInventoryRow>) =>
  data ? <div className="min-w-0 truncate">{data.position}</div> : null
/* Opens the display type with Playlist Settings — where slot assignment
   lives — already expanded (Rob, 20 Sep). */
const OpenCell = ({ data, context }: IP) =>
  data ? <Button color="primary" variant="text" size="small" className="px-0" onClick={() => context.current.open(data.displayTypeId)}>Open</Button> : null

/* Both editable columns are the same control (Rob, 20 Sep): a multi-select
   that drops a pill per choice into the cell, read-only text for marketing. */
interface PillOption { value: string; label: string; disabled?: boolean; note?: string }
function Pills({ label, value, options, canEdit, placeholder, onChange }: {
  label: string
  value: string[]
  options: { label: string; options: PillOption[] }[]
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
      /* An option that can't be chosen says why, in place (Rob, 20 Sep). */
      optionRender={({ data }) => (
        <div>
          <div>{(data as PillOption).label}</div>
          {(data as PillOption).note && <div style={{ fontSize: 11, color: T.micro, whiteSpace: 'normal' }}>{(data as PillOption).note}</div>}
        </div>
      )}
    />
  )
}

const edited = (c: InvCtx['current'], r: AvailableInventoryRow): SlotEdit =>
  c.edits[slotKey(r)] ?? { supportedTargeting: supportedTargetingOf(r), assignedTo: r.assignedTo, reservePrice: r.reservePriceOverride, billingUnitHours: r.billingUnitHoursOverride, maxCampaigns: r.maxCampaignsOverride }
/* The value this slot actually resolves to right now, following the draft
   default when it has no override of its own — the same "override wins"
   read as reservePriceOf, but against unsaved edits. */
const effectiveReservePrice = (c: InvCtx['current'], r: AvailableInventoryRow): number | null => {
  const override = edited(c, r).reservePrice
  return override ?? c.defaults[r.displayTypeId] ?? null
}
/* Same "override wins" read, against unsaved edits, for the billing unit
   (spec "Private auctions: two-period model", 23 Sep 2026) — unlike
   reserve price, there's no "none" state: the platform default of 24
   hours (one day) applies once neither the slot nor its display type sets
   one. */
const effectiveBillingUnitHours = (c: InvCtx['current'], r: AvailableInventoryRow): number => {
  const override = edited(c, r).billingUnitHours
  return override ?? c.billingUnitDefaults[r.displayTypeId] ?? DEFAULT_BILLING_UNIT_HOURS
}
/* Same "override wins" read, against unsaved edits, for max campaigns
   (ticket "Available Inventory: Max campaigns column + slot playlist
   statement") — like billing unit, there's no "unlimited" state: the
   platform default of 5 applies once neither the slot nor its display type
   sets one. */
const effectiveMaxCampaigns = (c: InvCtx['current'], r: AvailableInventoryRow): number => {
  const override = edited(c, r).maxCampaigns
  return override ?? c.maxCampaignsDefaults[r.displayTypeId] ?? DEFAULT_MAX_CAMPAIGNS
}

/* Who may buy this position (Rob, 20 Sep; buyers lists/private auctions
   added 23 Sep): DSPs, named advertisers, a buyers list's private auction,
   or the whitelist. Nothing chosen means any connected DSP. */
const WHITELIST = '__whitelist__'
const ADD_BUYERS_LIST = '__add_buyers_list__'
const assignedValues = (a: Omit<AssignedTo, 'partnerNames' | 'buyersListName'>) =>
  [...a.partnerIds.map((id) => `dsp:${id}`), ...a.advertisers.map((n) => `adv:${n}`), ...(a.whitelistOnly ? [WHITELIST] : []), ...(a.buyersListId ? [`deal:${a.buyersListId}`] : [])]

function AssignedCell({ data, context }: IP) {
  if (!data) return null
  const c = context.current
  const a = edited(c, data).assignedTo
  const dspNames = new Map(c.dsps.map((d) => [d.partnerId, d.name]))
  /* An advertiser can buy through more than one DSP (e.g. Unilever via both
     Google DSP and The Trade Desk, same as the Advertisers table's own "Via"
     column) — one option per advertiser, not per DSP-advertiser pairing,
     otherwise two options share the same `adv:<name>` value and Select can
     only ever treat one of them as selected (Rob, 23 Sep — failed testing,
     "bug with the presentation of the individual advertisers list"). */
  const advertiserDsps = new Map<string, string[]>()
  for (const d of c.dsps) for (const x of d.advertisers) {
    const via = advertiserDsps.get(x.name) ?? []
    if (!via.includes(d.name)) via.push(d.name)
    advertiserDsps.set(x.name, via)
  }
  const options = [
    { label: 'DSPs', options: c.dsps.map((d) => ({ value: `dsp:${d.partnerId}`, label: d.name })) },
    {
      /* Directly underneath DSPs, not after Advertisers (Rob, 23 Sep —
         failed testing, "place the new buyers list directly underneath the
         list of DSP's"). */
      label: 'Buyers lists (private auction)',
      options: [
        ...c.buyersLists.map((l) => ({ value: `deal:${l.id}`, label: l.name, note: `${l.invitedBuyers.length} invited buyer${l.invitedBuyers.length === 1 ? '' : 's'}` })),
        { value: ADD_BUYERS_LIST, label: '+ Add new buyers list…' },
      ],
    },
    { label: 'Advertisers', options: [...advertiserDsps.entries()].map(([name, via]) => ({ value: `adv:${name}`, label: `${name} (${via.join(', ')})` })) },
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
        /* A picker action, not a real choice: open the modal and leave this
           slot's assignment untouched until it's saved (Rob, 23 Sep). */
        if (next.includes(ADD_BUYERS_LIST)) {
          c.openAddBuyersList(data)
          return
        }
        const was = assignedValues(a)
        const added = next.filter((v) => !was.includes(v))
        const dealAdded = added.find((v) => v.startsWith('deal:'))
        /* A position is held for named advertisers, open to the whitelist,
           or restricted to a buyers list's private auction — never more
           than one: the newer choice wins (Rob, 23 Sep). */
        if (dealAdded) {
          c.set(slotKey(data), { assignedTo: { partnerIds: [], advertisers: [], whitelistOnly: false, buyersListId: dealAdded.slice(5) } })
          return
        }
        const advertisers = added.includes(WHITELIST) ? [] : next.filter((v) => v.startsWith('adv:')).map((v) => v.slice(4))
        const whitelistOnly = advertisers.length ? false : next.includes(WHITELIST)
        const partnerIds = next.filter((v) => v.startsWith('dsp:')).map((v) => v.slice(4)).filter((id) => dspNames.has(id))
        c.set(slotKey(data), { assignedTo: { partnerIds, advertisers, whitelistOnly, buyersListId: null } })
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
      options={[{
        label: 'Targeting',
        /* Interactive needs a QR code for the visitor to scan. */
        options: TARGETING_MODES.map((m) => (m.key === 'interactive' && !data.qrControl
          ? { value: m.key, label: m.label, disabled: true, note: 'QR Control required to support an interactive engagement' }
          : { value: m.key, label: m.label })),
      }]}
      /* A slot always supports something: the last one can't be removed. */
      onChange={(next) => next.length && c.set(slotKey(data), { supportedTargeting: TARGETING_MODES.filter((m) => next.includes(m.key)).map((m) => m.key) })}
    />
  )
}

/* A CPM premium to reserve the slot in advance of the open auction (Rob,
   22 Sep; spec §1 configuration inheritance — real inheritance, not the
   earlier "copy to every slot" design that failed testing). Following the
   default (no override): the input edits every slot on this display type
   at once, since they all read the same shared value. Override: this
   slot's own input, independent from the others until reset. */
function ReservePriceCell({ data, context }: IP) {
  if (!data) return null
  const c = context.current
  const override = edited(c, data).reservePrice
  const overridden = override !== null
  const value = overridden ? override : c.defaults[data.displayTypeId] ?? null
  if (!c.canEdit) {
    const resolved = effectiveReservePrice(c, data)
    return <span style={{ color: resolved === null ? T.muted : T.text }}>{resolved === null ? 'No reserve' : `${c.currency} ${resolved}`}</span>
  }
  return (
    <div className="flex w-full min-w-0 items-center gap-1">
      <InputNumber
        size="small" aria-label={`${data.displayTypeName} slot ${data.slot}: reserve price${overridden ? ' (override)' : ''}`} min={0} step={1} style={{ width: 92 }}
        placeholder="None" prefix={c.currency} value={value ?? undefined}
        onChange={(v) => {
          const next = v === null || v === undefined ? null : Number(v)
          if (overridden) c.set(slotKey(data), { reservePrice: next })
          else c.setDefault(data.displayTypeId, next)
        }}
      />
      {overridden ? (
        <Tooltip title={`Reset to ${data.displayTypeName}'s reserve price default`}>
          <Button type="text" size="small" className="px-1" aria-label={`${data.displayTypeName} slot ${data.slot}: reset reserve price to the display type's default`}
            icon={<Icon name="settings_backup_restore" size={13} />} onClick={() => c.set(slotKey(data), { reservePrice: null })} />
        </Tooltip>
      ) : value !== null && (
        /* Nothing to diverge from until the display type has a default: a
           slot can't explicitly override to "no reserve" (Rob, 22 Sep) — an
           override is always a real premium, never a way to opt one slot
           out while its siblings have one. */
        <Tooltip title={`Override just this slot, independent of ${data.displayTypeName}'s other slots`}>
          <Button type="text" size="small" className="px-1" aria-label={`${data.displayTypeName} slot ${data.slot}: override the reserve price for just this slot`}
            icon={<Icon name="edit" size={13} />} onClick={() => c.set(slotKey(data), { reservePrice: value })} />
        </Tooltip>
      )}
    </div>
  )
}

/* Hours → a short human label, the same shape a person would read a
   duration in (spec "Private auctions: two-period model", 23 Sep 2026):
   "1 day" at the default, "6h" / "3 days" otherwise. */
const durationLabel = (hours: number) => {
  if (hours === 24) return '1 day'
  if (hours % 24 === 0) return `${hours / 24} days`
  return `${hours}h`
}

/* The granularity a CPM is quoted and charged against for a private
   auction using the two-period model — default one day (spec "Private
   auctions: two-period model", 23 Sep 2026). Same override/default
   inheritance and editing UX as ReservePriceCell below, in hours rather
   than a CPM. Informational in this build: dynamic VAC-d billing still
   runs per play window (Advertiser settings → Auction schedule); this is
   what that window length is expected to equal for a private-auction slot
   using the two-period model. */
function BillingUnitCell({ data, context }: IP) {
  if (!data) return null
  const c = context.current
  const override = edited(c, data).billingUnitHours
  const overridden = override !== null
  const value = overridden ? override : (c.billingUnitDefaults[data.displayTypeId] ?? DEFAULT_BILLING_UNIT_HOURS)
  if (!c.canEdit) return <span>{durationLabel(effectiveBillingUnitHours(c, data))}</span>
  return (
    <div className="flex w-full min-w-0 items-center gap-1">
      <InputNumber
        size="small" aria-label={`${data.displayTypeName} slot ${data.slot}: billing unit (hours)${overridden ? ' (override)' : ''}`} min={1} step={1} style={{ width: 84 }}
        suffix="h" value={value}
        onChange={(v) => {
          const next = v === null || v === undefined ? DEFAULT_BILLING_UNIT_HOURS : Number(v)
          if (overridden) c.set(slotKey(data), { billingUnitHours: next })
          else c.setBillingUnitDefault(data.displayTypeId, next)
        }}
      />
      {overridden ? (
        <Tooltip title={`Reset to ${data.displayTypeName}'s billing unit default`}>
          <Button type="text" size="small" className="px-1" aria-label={`${data.displayTypeName} slot ${data.slot}: reset billing unit to the display type's default`}
            icon={<Icon name="settings_backup_restore" size={13} />} onClick={() => c.set(slotKey(data), { billingUnitHours: null })} />
        </Tooltip>
      ) : (
        <Tooltip title={`Override just this slot, independent of ${data.displayTypeName}'s other slots`}>
          <Button type="text" size="small" className="px-1" aria-label={`${data.displayTypeName} slot ${data.slot}: override the billing unit for just this slot`}
            icon={<Icon name="edit" size={13} />} onClick={() => c.set(slotKey(data), { billingUnitHours: value })} />
        </Tooltip>
      )}
    </div>
  )
}

/* The maximum number of campaigns (default + targeted versions) this
   advertiser may submit for the slot (ticket "Available Inventory: Max
   campaigns column + slot playlist statement") — purely a submission cap,
   it does not feed the auction or billing. Same override/default
   inheritance UX as ReservePriceCell/BillingUnitCell above, bounded
   1-10 inclusive; unlike reserve price there's no "unlimited" state, so a
   marketing user always reads a real number. */
function MaxCampaignsCell({ data, context }: IP) {
  if (!data) return null
  const c = context.current
  const override = edited(c, data).maxCampaigns
  /* != null (not !==) so a genuinely-unset value — undefined, e.g. a slot
     whose maxCampaignsOverride the API hasn't populated, not just an
     explicit null — is never mistaken for an override: that mistake left
     the input showing blank with a stray "(override)"/reset affordance
     instead of the real default of 5 (ticket "Max campaigns: show default
     of 5 in the column"). */
  const overridden = override != null
  const value = overridden ? override : (c.maxCampaignsDefaults[data.displayTypeId] ?? DEFAULT_MAX_CAMPAIGNS)
  if (!c.canEdit) return <span>{effectiveMaxCampaigns(c, data)}</span>
  return (
    <div className="flex w-full min-w-0 items-center gap-1">
      <InputNumber
        size="small" aria-label={`${data.displayTypeName} slot ${data.slot}: max campaigns${overridden ? ' (override)' : ''}`} min={MIN_MAX_CAMPAIGNS} max={MAX_MAX_CAMPAIGNS} step={1} style={{ width: 72 }}
        value={value}
        onChange={(v) => {
          const next = v === null || v === undefined ? DEFAULT_MAX_CAMPAIGNS : Math.min(MAX_MAX_CAMPAIGNS, Math.max(MIN_MAX_CAMPAIGNS, Math.round(Number(v))))
          if (overridden) c.set(slotKey(data), { maxCampaigns: next })
          else c.setMaxCampaignsDefault(data.displayTypeId, next)
        }}
      />
      {overridden ? (
        <Tooltip title={`Reset to ${data.displayTypeName}'s max campaigns default`}>
          <Button type="text" size="small" className="px-1" aria-label={`${data.displayTypeName} slot ${data.slot}: reset max campaigns to the display type's default`}
            icon={<Icon name="settings_backup_restore" size={13} />} onClick={() => c.set(slotKey(data), { maxCampaigns: null })} />
        </Tooltip>
      ) : (
        <Tooltip title={`Override just this slot, independent of ${data.displayTypeName}'s other slots`}>
          <Button type="text" size="small" className="px-1" aria-label={`${data.displayTypeName} slot ${data.slot}: override max campaigns for just this slot`}
            icon={<Icon name="edit" size={13} />} onClick={() => c.set(slotKey(data), { maxCampaigns: value })} />
        </Tooltip>
      )}
    </div>
  )
}

const header = (label: string, tip: string) => () => <WithTip tip={tip}><span className="ag-header-cell-text">{label}</span></WithTip>

export function AdvertisersPage() {
  const navigate = useNavigate()
  const { message } = App.useApp()
  const qc = useQueryClient()
  const session = useQuery(Q.session)
  /* Marketing users read this screen; only an admin changes approval or pricing (Rob, 20 Sep). */
  const canEdit = session.data?.role === 'hq_admin'
  /* Same key and request as Q.advertisers (the background prefetch); typed here. */
  const q = useQuery({ queryKey: Q.advertisers.queryKey, queryFn: () => api<Data>('GET', '/admin/v1/advertisers'), retry: false })
  const inventory = useQuery({ queryKey: ['available-inventory'], queryFn: () => api<{ items: AvailableInventoryRow[]; dsps: DspAdvertisers[] }>('GET', '/admin/v1/available-inventory') })
  /* retry: false, same as the advertisers query above — an admin list fetch
     should fail fast, not retry three times with real-timer backoff delays
     that outlive the component (Rob, 23 Sep: this queued-up retry storm
     across renders is what pushed an unrelated Campaign Status test over
     its own real-timer waitFor budget in this sandbox — root-caused via
     `git worktree` A/B runs of the full suite, not assumed). */
  const buyersLists = useQuery({ queryKey: ['buyers-lists'], queryFn: () => api<{ items: BuyersList[] }>('GET', '/admin/v1/buyers-lists'), retry: false })
  const invRows = inventory.data?.items ?? []
  /* Set when the "+ Add new buyers list…" picker action is chosen for a
     row: on save, the new list is assigned straight to that slot (Rob, 23 Sep). */
  const [addingBuyersListFor, setAddingBuyersListFor] = useState<AvailableInventoryRow | null>(null)
  const [invShown, setInvShown] = useState<number | null>(null)
  const invValues = (of: (r: AvailableInventoryRow) => string[]) => () => invRows.flatMap(of)
  const inventoryColumns = useMemo<ColDef<AvailableInventoryRow>[]>(() => [
    { headerName: 'Display type', width: 190, minWidth: 160, cellRenderer: TypeCell, valueGetter: (p) => p.data?.displayTypeName ?? '', ...searchColumn<AvailableInventoryRow>('Display type') },
    { headerName: 'Playlist', width: 150, field: 'playlistName', cellStyle: { color: T.muted }, ...setColumn<AvailableInventoryRow>('Playlist', invValues((r) => [r.playlistName])) },
    { headerName: 'Slot', width: 70, field: 'slot', suppressSizeToFit: true, cellStyle: { color: T.muted }, ...setColumn<AvailableInventoryRow>('Slot', invValues((r) => [String(r.slot)])) },
    { headerName: 'Position', width: 130, minWidth: 110, cellRenderer: SlotCell, valueGetter: (p) => p.data?.position ?? '', ...searchColumn<AvailableInventoryRow>('Position') },
    {
      headerName: 'Assigned to', width: 240, minWidth: 200, cellRenderer: AssignedCell, autoHeight: true,
      headerComponent: header('Assigned to', 'Who may buy this position: pick DSPs to say who may bid, advertisers to hold it for them (their DSP comes along), a buyers list to restrict it to a private auction among its invited buyers, or the whitelist. Nothing chosen means any connected DSP.'),
      valueGetter: (p) => {
        if (!p.data) return ''
        const a = edited((p.context as InvCtx).current, p.data).assignedTo
        return assignedLabels({
          ...a,
          partnerNames: a.partnerIds.map((id) => inventory.data?.dsps.find((d) => d.partnerId === id)?.name ?? id),
          buyersListName: a.buyersListId ? buyersLists.data?.items.find((l) => l.id === a.buyersListId)?.name ?? a.buyersListId : null,
        }).join(', ') || 'All DSPs'
      },
      ...setColumn<AvailableInventoryRow>('Assigned to', () => [
        'All DSPs', 'Whitelist only',
        ...(inventory.data?.dsps ?? []).flatMap((d) => [d.name, ...d.advertisers.map((a) => a.name)]),
        ...(buyersLists.data?.items ?? []).map((l) => `Buyers list: ${l.name}`),
      ]),
    },
    {
      headerName: 'Targeting supported', width: 230, minWidth: 190, cellRenderer: TargetingCell, autoHeight: true,
      headerComponent: header('Targeting supported', 'What a campaign may use on this slot. Localised only unless you open it up; a bid for a campaign of any other type is refused. Personalised and interactive carry their own multipliers on the floor price.'),
      valueGetter: (p) => (p.data ? targetingLabel(edited((p.context as InvCtx).current, p.data).supportedTargeting) : ''),
      ...setColumn<AvailableInventoryRow>('Targeting supported', () => TARGETING_MODES.map((m) => m.label)),
    },
    {
      headerName: 'Reserve price', width: 190, minWidth: 170, cellRenderer: ReservePriceCell,
      headerComponent: header('Reserve price', "A CPM premium to reserve this slot in advance of the open auction. Set once for the display type and inherited by every slot on it — override just one slot to give it its own value, independent of the others. Empty = no reserve."),
      valueGetter: (p) => (p.data ? effectiveReservePrice((p.context as InvCtx).current, p.data) ?? -1 : -1),
    },
    {
      headerName: 'Max campaigns', width: 150, minWidth: 130, cellRenderer: MaxCampaignsCell,
      /* Written for the retail media manager setting this, not the
         advertiser submitting against it (ticket "Max campaigns: … revise
         tooltip for retail media manager") — so no "purchase additional
         slots" line, which reads as advertiser-facing upsell copy. */
      headerComponent: header('Max campaigns', 'The maximum number of campaigns an advertiser can submit to be played for this purchased slot.'),
      valueGetter: (p) => (p.data ? effectiveMaxCampaigns((p.context as InvCtx).current, p.data) : DEFAULT_MAX_CAMPAIGNS),
      ...setColumn<AvailableInventoryRow>('Max campaigns', invValues((r) => [String(r.maxCampaigns)])),
    },
    {
      headerName: 'Billing unit', width: 150, minWidth: 130, cellRenderer: BillingUnitCell,
      headerComponent: header('Billing unit', 'The granularity a CPM is quoted and charged against for a private auction using the two-period model — default one day. Set once for the display type and inherited by every slot on it — override just one slot to give it its own value, independent of the others.'),
      valueGetter: (p) => (p.data ? effectiveBillingUnitHours((p.context as InvCtx).current, p.data) : DEFAULT_BILLING_UNIT_HOURS),
    },
    { headerName: '', width: 76, suppressSizeToFit: true, cellRenderer: OpenCell },
  ], [invRows, inventory.data, buyersLists.data])
  const saved = useMemo<Settings | undefined>(() => q.data && Object.fromEntries(q.data.items.map((a) => [a.advertiserId, { approvalRequired: a.approvalRequired, floorMultiplier: a.floorMultiplier }])), [q.data])
  const { draft, setDraft, dirty, reset, commitNext } = useDraft(saved)
  const savedEdits = useMemo<Edits | undefined>(() => inventory.data && Object.fromEntries(invRows.map((r) => {
    const { partnerNames: _names, ...assignedTo } = r.assignedTo
    return [slotKey(r), { supportedTargeting: supportedTargetingOf(r), assignedTo, reservePrice: r.reservePriceOverride, billingUnitHours: r.billingUnitHoursOverride, maxCampaigns: r.maxCampaignsOverride }]
  })), [invRows, inventory.data])
  const inv = useDraft(savedEdits)
  /* One reserve price default per display type, shared by every one of its
     rows (Rob, 22 Sep) — a separate draft from the per-slot one above. */
  const savedDefaults = useMemo<Defaults | undefined>(() => inventory.data && Object.fromEntries(invRows.map((r) => [r.displayTypeId, r.displayTypeReservePrice])), [invRows, inventory.data])
  const defaults = useDraft(savedDefaults)
  /* Same one-per-display-type sharing, for the billing unit default (spec
     "Private auctions: two-period model", 23 Sep 2026). */
  const savedBillingUnitDefaults = useMemo<Defaults | undefined>(() => inventory.data && Object.fromEntries(invRows.map((r) => [r.displayTypeId, r.displayTypeBillingUnitHours])), [invRows, inventory.data])
  const billingUnitDefaults = useDraft(savedBillingUnitDefaults)
  /* Same one-per-display-type sharing again, for the max-campaigns default
     (ticket "Available Inventory: Max campaigns column + slot playlist
     statement"). */
  const savedMaxCampaignsDefaults = useMemo<Defaults | undefined>(() => inventory.data && Object.fromEntries(invRows.map((r) => [r.displayTypeId, r.displayTypeMaxCampaigns])), [invRows, inventory.data])
  const maxCampaignsDefaults = useDraft(savedMaxCampaignsDefaults)
  useReportDirty(dirty || inv.dirty || defaults.dirty || billingUnitDefaults.dirty || maxCampaignsDefaults.dirty)
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
      /* The inventory's own fields, saved by the same Save changes — only
         the slots that changed, plus every slot of a display type whose
         reserve price default changed (Rob, 22 Sep), since that's a
         display-type-level field an untouched slot's row still has to
         carry so the server can apply it. */
      if ((inv.dirty || defaults.dirty || billingUnitDefaults.dirty || maxCampaignsDefaults.dirty) && inv.draft && defaults.draft && billingUnitDefaults.draft && maxCampaignsDefaults.draft) {
        const changedSlots = new Set(Object.keys(inv.draft).filter((key) => !deepEqual(inv.draft![key], savedEdits?.[key])))
        const changedTypes = new Set(Object.keys(defaults.draft).filter((id) => defaults.draft![id] !== savedDefaults?.[id]))
        const changedBillingUnitTypes = new Set(Object.keys(billingUnitDefaults.draft).filter((id) => billingUnitDefaults.draft![id] !== savedBillingUnitDefaults?.[id]))
        const changedMaxCampaignsTypes = new Set(Object.keys(maxCampaignsDefaults.draft).filter((id) => maxCampaignsDefaults.draft![id] !== savedMaxCampaignsDefaults?.[id]))
        const items = invRows
          .filter((r) => changedSlots.has(slotKey(r)) || changedTypes.has(r.displayTypeId) || changedBillingUnitTypes.has(r.displayTypeId) || changedMaxCampaignsTypes.has(r.displayTypeId))
          .map((r) => ({
            displayTypeId: r.displayTypeId, slot: r.slot, ...(inv.draft![slotKey(r)] ?? savedEdits![slotKey(r)]),
            reservePriceDefault: defaults.draft![r.displayTypeId] ?? null, billingUnitHoursDefault: billingUnitDefaults.draft![r.displayTypeId] ?? null,
            maxCampaignsDefault: maxCampaignsDefaults.draft![r.displayTypeId] ?? null,
          }))
        await api('PUT', '/admin/v1/available-inventory', { items })
        inv.commitNext()
        defaults.commitNext()
        billingUnitDefaults.commitNext()
        maxCampaignsDefaults.commitNext()
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
    canEdit, currency: data.currency, edits: inv.draft ?? {}, defaults: defaults.draft ?? {}, billingUnitDefaults: billingUnitDefaults.draft ?? {}, maxCampaignsDefaults: maxCampaignsDefaults.draft ?? {}, dsps: inventory.data?.dsps ?? [],
    buyersLists: buyersLists.data?.items ?? [],
    set: (key: string, patch: Partial<SlotEdit>) => inv.setDraft((cur) => (cur ? { ...cur, [key]: { ...cur[key], ...patch } } : cur)),
    setDefault: (displayTypeId: string, v: number | null) => defaults.setDraft((cur) => (cur ? { ...cur, [displayTypeId]: v } : cur)),
    setBillingUnitDefault: (displayTypeId: string, v: number | null) => billingUnitDefaults.setDraft((cur) => (cur ? { ...cur, [displayTypeId]: v } : cur)),
    setMaxCampaignsDefault: (displayTypeId: string, v: number | null) => maxCampaignsDefaults.setDraft((cur) => (cur ? { ...cur, [displayTypeId]: v } : cur)),
    openAddBuyersList: (r: AvailableInventoryRow) => setAddingBuyersListFor(r),
  }
  const context = {
    settings: draft, data, canEdit,
    set: (id: string, patch: Partial<AdvertiserSetting>) => setDraft((cur) => (cur ? { ...cur, [id]: { ...cur[id], ...patch } } : cur)),
    openBookings: (advertiserId: string) => window.open(externalUrl(`${BOOKING_SCHEDULE_PATH}?advertiserId=${encodeURIComponent(advertiserId)}`), '_blank', 'noopener'),
    openCampaigns: (advertiserId: string) => navigate(`/campaign-status?advertiserId=${encodeURIComponent(advertiserId)}`),
  }

  return (
    <div>
      <div className="mb-3.5 flex justify-end">
        {!canEdit && <StatusPill colour={T.muted} icon="visibility">Read only</StatusPill>}
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
        <Button color="primary" variant="text" size="small" icon={<Icon name="calendar_month" size={16} />} style={{ marginTop: 12 }} onClick={() => window.open(externalUrl(BOOKING_SCHEDULE_PATH), '_blank', 'noopener')}>Booking schedule</Button>
      </div>
      {inventory.data && invRows.length === 0 ? (
        <div className="flex items-center gap-2" style={{ fontSize: 12.5, color: T.muted }}>
          <Icon name="view_week" size={18} />
          <span>No advertiser positions yet. Set a slot's owner to <b>Advertiser</b> on a display type.</span>
        </div>
      ) : (
        <>
          <div className="mb-2" style={{ fontSize: 13 }}>{showingCount(invShown ?? invRows.length, invRows.length, `position${invRows.length === 1 ? '' : 's'}/slot${invRows.length === 1 ? '' : 's'}`)}</div>
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

      <BuyersListsTable
        lists={buyersLists.data?.items ?? []}
        canEdit={canEdit}
        onChanged={() => qc.invalidateQueries({ queryKey: ['buyers-lists'] })}
      />

      {canEdit && <SaveBar dirty={dirty || inv.dirty || defaults.dirty || billingUnitDefaults.dirty || maxCampaignsDefaults.dirty} saving={saving} onSave={onSave} onCancel={() => { reset(); inv.reset(); defaults.reset(); billingUnitDefaults.reset(); maxCampaignsDefaults.reset() }} />}

      {/* Picked "+ Add new buyers list…" from a slot's Assigned to picker
          (Rob, 23 Sep): on save, assign the new list straight to that slot. */}
      <BuyersListModal
        open={!!addingBuyersListFor}
        editing={null}
        onClose={() => setAddingBuyersListFor(null)}
        onSaved={(list) => {
          qc.invalidateQueries({ queryKey: ['buyers-lists'] })
          if (addingBuyersListFor) inv.setDraft((cur) => ({ ...(cur ?? {}), [slotKey(addingBuyersListFor)]: { ...edited(invContext, addingBuyersListFor), assignedTo: { partnerIds: [], advertisers: [], whitelistOnly: false, buyersListId: list.id } } }))
          setAddingBuyersListFor(null)
        }}
      />
    </div>
  )
}
