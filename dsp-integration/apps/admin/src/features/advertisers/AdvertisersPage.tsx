/* Advertisers / Inventory (spec §3, §5; admin only): every advertiser across
   all DSPs, with campaign approval and floor multiplier per advertiser, and
   below it the inventory they can buy — every advertiser-owned slot across
   the estate, which moved here from Advertiser settings (Rob, 20 Sep).
   Campaigns are not approved here. Changes are applied with Save changes. */
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { App, Button, InputNumber, Select, Spin, Switch } from 'antd'
import { Tip } from '../../shared/Tip'
import type { ColDef, ICellRendererParams } from 'ag-grid-community'
import { INTERACTIVE_ENABLED, RESERVE_PRICE_TIP, DEFAULT_BILLING_UNIT_HOURS, DEFAULT_MAX_CAMPAIGNS, MAX_MAX_CAMPAIGNS, MIN_MAX_CAMPAIGNS, SLOT_OWNERS, assignedLabels, type Advertiser, type AdvertiserSetting, type AssignedTo, type AvailableInventoryRow, type BuyersList, type DspAdvertisers, type Session } from '@ph-dsp/types'
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

/* Bidding values are always USD (TRANSACTING_CURRENCY in the API's domain/currency.ts), never the instance's reporting currency. */
const TRANSACTING_CURRENCY = 'USD'
interface Data { currency: string; floorCpm: number; items: Advertiser[] }
type Settings = Record<string, AdvertiserSetting>
type Ctx = { current: { settings: Settings; data: Data; canEdit: boolean; set: (id: string, patch: Partial<AdvertiserSetting>) => void } }
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
  return <span>{`${TRANSACTING_CURRENCY} ${effective(d.floorCpm, settings[data.advertiserId].floorMultiplier).toFixed(2)} CPM`}</span>
}
/* The inventory advertisers can buy: every Advertiser-owned slot on a
   display type (spec §5 "Available Inventory"). No advertisers column. */
export const slotKey = (r: AvailableInventoryRow) => `${r.displayTypeId}:${r.slot}`
/* What Save changes sends for a slot: the fields this table owns.
   reservePrice is this slot's own override; null means it follows its
   display type's shared default (below), not "no reserve" (Rob, 22 Sep;
   spec §1 configuration inheritance — override always wins). */
export interface SlotEdit { assignedTo: Omit<AssignedTo, 'partnerNames' | 'buyersListName' | 'buyersListNames'>; reservePrice: number | null; interactiveReservePrice: number | null; billingUnitHours: number | null; maxCampaigns: number | null }
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
/* Playlist is the primary column (ticket "Available Inventory:
   playlist-primary table (drop Display type column) with Unassigned
   indicator", 27 Sep 2026 — this replaced a separate Display type column
   that used to lead the table). QR Control is flagged here because it is
   what makes interactive targeting possible on this position (Rob, 20 Sep).
   Vision/AI is flagged alongside it, before the QR Control icon (ticket
   "show a computer vision icon when computer vision is enabled on a
   specific display type", 22 Sep) — both are the display type's own
   hardware capability (Display Types → Enabled Features), carried over onto
   the playlist so they aren't lost with the column they used to live on;
   not any one booking's personalised targeting rules. */
const PlaylistCell = ({ data }: ICellRendererParams<AvailableInventoryRow>) =>
  data ? (
    <span className="inline-flex min-w-0 items-center gap-[5px]">
      {/* The name can be long and the column is hard to widen on a touch screen, so
          hovering or tapping it shows the full playlist name (ticket E2iOwJHM, 4 Oct 2026). */}
      <Tip title={data.playlistName}>
        <span className="truncate cursor-pointer" tabIndex={0} aria-label={`Playlist: ${data.playlistName}`}>{data.playlistName}</span>
      </Tip>
      {data.visionAi && (
        <Tip title="Vision/AI is enabled on this display type: on-device computer vision for passerby insight and person match.">
          <span className="inline-flex" aria-label="Vision/AI enabled"><Icon name="visibility" size={15} style={{ color: T.primary }} /></span>
        </Tip>
      )}
      {data.qrControl && (
        <Tip title={INTERACTIVE_ENABLED ? 'QR Control is enabled on this display type, so its slots can support interactive campaigns.' : 'QR Control is enabled on this display type.'}>
          <span className="inline-flex" aria-label="QR Control enabled"><Icon name="qr_code_2" size={15} style={{ color: T.primary }} /></span>
        </Tip>
      )}
      {data.unsellableReason && (
        /* Unscored (or duration-less) slot, ticket 30 Sep 2026: saving is not blocked, but advertisers can't see or bid on it. */
        <Tip title={data.unsellableReason}>
          <span className="inline-flex items-center gap-0.5" role="status" aria-label={data.unsellableReason} style={{ color: T.error }}>
            <Icon name="warning" size={14} /><span style={{ fontSize: 11, whiteSpace: 'normal' }}>{data.unsellableReason}</span>
          </span>
        </Tip>
      )}
      {data.unassigned && (
        <Tip title="This playlist's advertiser slots aren't assigned to any physical display, so they aren't actually playing.">
          <span className="inline-flex items-center gap-0.5" aria-label="Unassigned" style={{ color: T.error }}>
            <Icon name="link_off" size={14} /><span style={{ fontSize: 11 }}>Unassigned</span>
          </span>
        </Tip>
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
  c.edits[slotKey(r)] ?? { assignedTo: r.assignedTo, reservePrice: r.reservePriceOverride, interactiveReservePrice: r.interactiveReservePriceOverride ?? null, billingUnitHours: r.billingUnitHoursOverride, maxCampaigns: r.maxCampaignsOverride }
/* The value this slot actually resolves to right now, following the draft
   default when it has no override of its own — the same "override wins"
   read as reservePriceOf, but against unsaved edits. */
const effectiveReservePrice = (c: InvCtx['current'], r: AvailableInventoryRow): number | null => {
  const override = edited(c, r).reservePrice
  return override ?? c.defaults[r.displayTypeId] ?? null
}
/* Same "override wins" read, against unsaved edits, for the billing unit
   (spec "Private auctions: two-period model", 23 Sep 2026) — unlike
   reserve price, there's no "none" state: the company-wide play window
   (Advertiser settings, platform default 24 hours) applies once neither
   the slot nor its display type sets one (OQ27, 29 Sep 2026). */
const effectiveBillingUnitHours = (c: InvCtx['current'], r: AvailableInventoryRow): number => {
  const override = edited(c, r).billingUnitHours
  return override ?? c.billingUnitDefaults[r.displayTypeId] ?? r.companyPlayWindowHours
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
/* The slot's buyers lists in priority order (7 Oct 2026): the waterfall. */
const tiersOf = (a: { buyersListId: string | null; buyersListIds?: string[] }): string[] => a.buyersListIds ?? (a.buyersListId ? [a.buyersListId] : [])
const assignedValues = (a: Omit<AssignedTo, 'partnerNames' | 'buyersListName' | 'buyersListNames'>) =>
  [...a.partnerIds.map((id) => `dsp:${id}`), ...a.advertisers.map((n) => `adv:${n}`), ...(a.whitelistOnly ? [WHITELIST] : []), ...tiersOf(a).map((id) => `deal:${id}`)]

/* The waterfall as rows in priority order: drag a row (or use the arrows) to
   reorder, top row is tried first. Priority belongs to this slot's
   assignment, so the same list can rank differently on another slot. */
function PriorityList({ label, ids, names, canEdit, onChange }: { label: string; ids: string[]; names: Map<string, string>; canEdit: boolean; onChange: (next: string[]) => void }) {
  const [dragging, setDragging] = useState<number | null>(null)
  const [showAll, setShowAll] = useState(false)
  const LIMIT = 5
  const move = (from: number, to: number) => {
    if (from === to || to < 0 || to >= ids.length) return
    const next = [...ids]
    next.splice(to, 0, ...next.splice(from, 1))
    onChange(next)
  }
  if (ids.length < 1) return null
  const hidden = showAll || ids.length <= LIMIT ? 0 : ids.length - LIMIT
  return (
    <div className="mt-2" role="list" aria-label={`${label}: buyers lists in priority order`}>
      <div style={{ fontSize: 12, color: T.muted }} className="mb-1">Priority: tried top to bottom</div>
      {ids.map((id, i) => i >= ids.length - hidden ? null : (
        <div
          key={id}
          role="listitem"
          draggable={canEdit}
          onDragStart={() => setDragging(i)}
          onDragOver={(e) => { if (dragging !== null) e.preventDefault() }}
          onDrop={(e) => { e.preventDefault(); if (dragging !== null) move(dragging, i); setDragging(null) }}
          onDragEnd={() => setDragging(null)}
          className="mb-1 flex items-center gap-2"
          style={{ border: '1px solid #d9d9d9', borderRadius: 6, padding: '2px 8px', background: dragging === i ? 'rgba(22,155,194,0.10)' : '#fff', cursor: canEdit ? 'grab' : 'default' }}
        >
          {canEdit && <Icon name="drag_indicator" size={16} />}
          <span style={{ fontSize: 12, color: T.muted, minWidth: 14 }} aria-label={`Position ${i + 1}`}>{i + 1}</span>
          <span className="flex-1 truncate" style={{ fontSize: 13 }}>{names.get(id) ?? id}</span>
          {canEdit && (
            <>
              <Button type="text" size="small" aria-label={`Move ${names.get(id) ?? id} up`} disabled={i === 0} onClick={() => move(i, i - 1)} icon={<Icon name="arrow_upward" size={16} />} />
              <Button type="text" size="small" aria-label={`Move ${names.get(id) ?? id} down`} disabled={i === ids.length - 1} onClick={() => move(i, i + 1)} icon={<Icon name="arrow_downward" size={16} />} />
            </>
          )}
        </div>
      ))}
      {hidden > 0 && <Button type="link" size="small" onClick={() => setShowAll(true)}>+{hidden} more</Button>}
    </div>
  )
}

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
      label: 'Buyers and targeting (private auction)',
      options: [
        ...c.buyersLists.map((l) => ({ value: `deal:${l.id}`, label: l.name, note: `${l.invitedBuyers.length} invited buyer${l.invitedBuyers.length === 1 ? '' : 's'}` })),
        { value: ADD_BUYERS_LIST, label: '+ Add new buyers and targeting…' },
      ],
    },
    { label: 'Advertisers', options: [...advertiserDsps.entries()].map(([name, via]) => ({ value: `adv:${name}`, label: `${name} (${via.join(', ')})` })) },
    { label: 'Or', options: [{ value: WHITELIST, label: 'Whitelist only' }] },
  ]
  return (
    <>
    {data.salesLocked && (
      /* Locked against new sales (ticket, 30 Sep 2026): sold, so the
         advertiser can't be removed; releases by itself when the booking
         schedule shows nothing booked. */
      <Tip title={`Slots are sold here, so no new sales are taken and the advertiser can't be removed. Existing bookings keep running. Releases automatically once nothing is booked${data.salesLockedUntil ? ` (last booking ends ${data.salesLockedUntil.slice(0, 10)})` : ''}.`}>
        <span className="mb-1 inline-flex items-center gap-1" style={{ fontSize: 12, color: T.muted }}><Icon name="lock" size={14} />Locked to new sales</span>
      </Tip>
    )}
    <Pills
      label={`${data.displayTypeName} slot ${data.zoneSlot}: assigned to`}
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
          /* Added to the foot of the waterfall; reorder by dragging. */
          const ids = [...tiersOf(a).filter((id) => next.includes(`deal:${id}`)), dealAdded.slice(5)]
          c.set(slotKey(data), { assignedTo: { partnerIds: [], advertisers: [], whitelistOnly: false, buyersListId: ids[0], buyersListIds: ids } })
          return
        }
        /* Removing a pill just drops that tier; the rest keep their order. */
        const keptTiers = tiersOf(a).filter((id) => next.includes(`deal:${id}`))
        if (keptTiers.length && !added.length) {
          c.set(slotKey(data), { assignedTo: { ...a, buyersListId: keptTiers[0], buyersListIds: keptTiers } })
          return
        }
        const advertisers = added.includes(WHITELIST) ? [] : next.filter((v) => v.startsWith('adv:')).map((v) => v.slice(4))
        const whitelistOnly = advertisers.length ? false : next.includes(WHITELIST)
        const partnerIds = next.filter((v) => v.startsWith('dsp:')).map((v) => v.slice(4)).filter((id) => dspNames.has(id))
        c.set(slotKey(data), { assignedTo: { partnerIds, advertisers, whitelistOnly, buyersListId: null, buyersListIds: [] } })
      }}
    />
    <PriorityList
      label={`${data.displayTypeName} slot ${data.zoneSlot}`}
      ids={tiersOf(a)}
      names={new Map(c.buyersLists.map((l) => [l.id, l.name]))}
      canEdit={c.canEdit}
      onChange={(ids) => c.set(slotKey(data), { assignedTo: { ...a, buyersListId: ids[0] ?? null, buyersListIds: ids } })}
    />
    </>
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
    return <span style={{ color: resolved === null ? T.muted : T.text }}>{resolved === null ? 'No reserve' : `${TRANSACTING_CURRENCY} ${resolved}`}</span>
  }
  return (
    <div className="flex w-full min-w-0 items-center gap-1" title={RESERVE_PRICE_TIP}>
      <InputNumber
        size="small" aria-label={`${data.displayTypeName} slot ${data.zoneSlot}: reserve price${overridden ? ' (override)' : ''}`} min={0} step={1} style={{ width: 92 }}
        placeholder="None" prefix={TRANSACTING_CURRENCY} value={value ?? undefined}
        onChange={(v) => {
          const next = v === null || v === undefined ? null : Number(v)
          if (overridden) c.set(slotKey(data), { reservePrice: next })
          else c.setDefault(data.displayTypeId, next)
        }}
      />
      {overridden ? (
        <Tip title={`Reset to ${data.displayTypeName}'s reserve price default`}>
          <Button type="text" size="small" className="px-1" aria-label={`${data.displayTypeName} slot ${data.zoneSlot}: reset reserve price to the display type's default`}
            icon={<Icon name="settings_backup_restore" size={13} />} onClick={() => c.set(slotKey(data), { reservePrice: null })} />
        </Tip>
      ) : value !== null && (
        /* Nothing to diverge from until the display type has a default: a
           slot can't explicitly override to "no reserve" (Rob, 22 Sep) — an
           override is always a real premium, never a way to opt one slot
           out while its siblings have one. */
        <Tip title={`Override just this slot, independent of ${data.displayTypeName}'s other slots`}>
          <Button type="text" size="small" className="px-1" aria-label={`${data.displayTypeName} slot ${data.zoneSlot}: override the reserve price for just this slot`}
            icon={<Icon name="edit" size={13} />} onClick={() => c.set(slotKey(data), { reservePrice: value })} />
        </Tip>
      )}
    </div>
  )
}

/* The reserve price for the interactive experience on this slot (ticket
   5eLDRBqEGhNyJSHSIFFG): only offered while interactive campaigns are
   enabled, on a display type with QR Control. Empty = interactive campaigns follow the slot's ordinary reserve
   price, shown as the placeholder so the fallback is visible. Per slot —
   there is no display-type default for it. */
/* Gate (ticket L32gi3rXFAmwMCUqP1Dj): interaction happens through QR
   Control, so the display type must have it. A price already assigned keeps showing even when
   the gate closes later — prices are never silently hidden. */
const interactiveGateOpen = (qrControl: boolean, e: SlotEdit) => qrControl
const showsInteractiveReserve = (qrControl: boolean, e: SlotEdit) => interactiveGateOpen(qrControl, e) || e.interactiveReservePrice !== null
const INTERACTIVE_RESERVE_HEADER = 'Interactive reserve price'

function InteractiveReservePriceCell({ data, context }: IP) {
  if (!data) return null
  const c = context.current
  const e = edited(c, data)
  if (!showsInteractiveReserve(data.qrControl, e)) return <span style={{ color: T.muted }}>—</span>
  const fallback = effectiveReservePrice(c, data)
  if (!c.canEdit || !interactiveGateOpen(data.qrControl, e)) {
    const resolved = e.interactiveReservePrice ?? fallback
    return <span style={{ color: resolved === null ? T.muted : T.text }}>{resolved === null ? 'No reserve' : `${TRANSACTING_CURRENCY} ${resolved}`}</span>
  }
  return (
    <InputNumber
      size="small" aria-label={`${data.displayTypeName} slot ${data.zoneSlot}: interactive reserve price`} min={0} step={1} style={{ width: 112 }}
      placeholder={fallback === null ? 'None' : String(fallback)} prefix={TRANSACTING_CURRENCY} value={e.interactiveReservePrice ?? undefined}
      onChange={(v) => c.set(slotKey(data), { interactiveReservePrice: v === null || v === undefined ? null : Number(v) })}
    />
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

/* The slot's play-window length: the granularity it is auctioned, booked
   and billed (dynamic VAC-d) against (spec "Private auctions: two-period
   model", 23 Sep 2026; the source of truth since OQ27, 29 Sep 2026).
   Same override/default inheritance and editing UX as ReservePriceCell
   below, in whole hours rather than a CPM; with neither set it follows the
   company-wide play window (Advertiser settings → Auction schedule). */
function BillingUnitCell({ data, context }: IP) {
  if (!data) return null
  const c = context.current
  const override = edited(c, data).billingUnitHours
  const overridden = override !== null
  const value = overridden ? override : (c.billingUnitDefaults[data.displayTypeId] ?? data.companyPlayWindowHours)
  if (!c.canEdit) return <span>{durationLabel(effectiveBillingUnitHours(c, data))}</span>
  return (
    <div className="flex w-full min-w-0 items-center gap-1">
      <InputNumber
        size="small" aria-label={`${data.displayTypeName} slot ${data.zoneSlot}: billing unit (hours)${overridden ? ' (override)' : ''}`} min={1} max={8760} step={1} precision={0} style={{ width: 84 }}
        suffix="h" value={value}
        onChange={(v) => {
          const next = v === null || v === undefined ? data.companyPlayWindowHours : Number(v)
          if (overridden) c.set(slotKey(data), { billingUnitHours: next })
          else c.setBillingUnitDefault(data.displayTypeId, next)
        }}
      />
      {overridden ? (
        <Tip title={`Reset to ${data.displayTypeName}'s billing unit default`}>
          <Button type="text" size="small" className="px-1" aria-label={`${data.displayTypeName} slot ${data.zoneSlot}: reset billing unit to the display type's default`}
            icon={<Icon name="settings_backup_restore" size={13} />} onClick={() => c.set(slotKey(data), { billingUnitHours: null })} />
        </Tip>
      ) : (
        <Tip title={`Override just this slot, independent of ${data.displayTypeName}'s other slots`}>
          <Button type="text" size="small" className="px-1" aria-label={`${data.displayTypeName} slot ${data.zoneSlot}: override the billing unit for just this slot`}
            icon={<Icon name="edit" size={13} />} onClick={() => c.set(slotKey(data), { billingUnitHours: value })} />
        </Tip>
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
        size="small" aria-label={`${data.displayTypeName} slot ${data.zoneSlot}: max campaigns${overridden ? ' (override)' : ''}`} min={MIN_MAX_CAMPAIGNS} max={MAX_MAX_CAMPAIGNS} step={1} style={{ width: 72 }}
        value={value}
        onChange={(v) => {
          const next = v === null || v === undefined ? DEFAULT_MAX_CAMPAIGNS : Math.min(MAX_MAX_CAMPAIGNS, Math.max(MIN_MAX_CAMPAIGNS, Math.round(Number(v))))
          if (overridden) c.set(slotKey(data), { maxCampaigns: next })
          else c.setMaxCampaignsDefault(data.displayTypeId, next)
        }}
      />
      {overridden ? (
        <Tip title={`Reset to ${data.displayTypeName}'s max campaigns default`}>
          <Button type="text" size="small" className="px-1" aria-label={`${data.displayTypeName} slot ${data.zoneSlot}: reset max campaigns to the display type's default`}
            icon={<Icon name="settings_backup_restore" size={13} />} onClick={() => c.set(slotKey(data), { maxCampaigns: null })} />
        </Tip>
      ) : (
        <Tip title={`Override just this slot, independent of ${data.displayTypeName}'s other slots`}>
          <Button type="text" size="small" className="px-1" aria-label={`${data.displayTypeName} slot ${data.zoneSlot}: override max campaigns for just this slot`}
            icon={<Icon name="edit" size={13} />} onClick={() => c.set(slotKey(data), { maxCampaigns: value })} />
        </Tip>
      )}
    </div>
  )
}

const header = (label: string, tip: string) => () => <WithTip tip={tip}><span className="ag-header-cell-text">{label}</span></WithTip>

export function AdvertisersPage() {
  const navigate = useNavigate()
  const { message, modal } = App.useApp()
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
    {
      /* Primary column (ticket "Available Inventory: playlist-primary
         table (drop Display type column) with Unassigned indicator", 27
         Sep 2026): leads the table, carries the display type's enabled
         features and the Unassigned indicator that used to sit on the now-
         removed Display type column. */
      headerName: 'Playlist', width: 230, minWidth: 190, cellRenderer: PlaylistCell, valueGetter: (p) => p.data?.playlistName ?? '', ...searchColumn<AvailableInventoryRow>('Playlist'),
    },
    /* zoneSlot, not the flat slot field: a multi-zone display type's Slot
       column shows this position's number within its own zone's rotation
       (ticket, 28 Sep 2026 — Zone 2's first slot was showing as "Slot 4",
       the flat position across every zone, when each zone runs its own
       separate playlist and starts at slot 1). Equal to `slot` on a
       single-zone display type. */
    { headerName: 'Slot', width: 70, field: 'zoneSlot', suppressSizeToFit: true, cellStyle: { color: T.muted }, ...setColumn<AvailableInventoryRow>('Slot', invValues((r) => [String(r.zoneSlot)])) },
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
          buyersListNames: tiersOf(a).map((id) => buyersLists.data?.items.find((l) => l.id === id)?.name ?? id),
        }).join(', ') || 'All DSPs'
      },
      ...setColumn<AvailableInventoryRow>('Assigned to', () => [
        'All DSPs', 'Whitelist only',
        ...(inventory.data?.dsps ?? []).flatMap((d) => [d.name, ...d.advertisers.map((a) => a.name)]),
        ...(buyersLists.data?.items ?? []).map((l) => `Buyers list: ${l.name}`),
      ]),
    },
    {
      /* Narrowed to fit the input + reset/override control (ticket, 26 Sep
         2026: these three columns were wider than the fields inside them
         needed, crowding the table). */
      headerName: 'Reserve price', width: 150, minWidth: 135, cellRenderer: ReservePriceCell,
      headerComponent: header('Reserve price', `${RESERVE_PRICE_TIP} Set once for the display type and inherited by every slot on it — override just one slot to give it its own value, independent of the others. Empty = no reserve.`),
      valueGetter: (p) => (p.data ? effectiveReservePrice((p.context as InvCtx).current, p.data) ?? -1 : -1),
    },
    {
      headerName: INTERACTIVE_RESERVE_HEADER, width: 170, minWidth: 150, cellRenderer: InteractiveReservePriceCell,
      headerComponent: header('Interactive reserve price', "The reserve price (CPM) for the interactive experience on this slot, so it can be priced apart from the slot's ordinary reserve price. Only available while Interactive is selected in Targeting supported. Empty = interactive campaigns use the slot's reserve price."),
      valueGetter: (p) => {
        if (!p.data) return -1
        const c = (p.context as InvCtx).current
        const e = edited(c, p.data)
        return showsInteractiveReserve(p.data.qrControl, e) ? e.interactiveReservePrice ?? effectiveReservePrice(c, p.data) ?? -1 : -1
      },
    },
    {
      headerName: 'Max campaigns', width: 140, minWidth: 125, cellRenderer: MaxCampaignsCell,
      /* Written for the retail media manager setting this, not the
         advertiser submitting against it (ticket "Max campaigns: … revise
         tooltip for retail media manager") — so no "purchase additional
         slots" line, which reads as advertiser-facing upsell copy. */
      headerComponent: header('Max campaigns', 'The maximum number of campaigns an advertiser can submit to be played for this purchased slot.'),
      valueGetter: (p) => (p.data ? effectiveMaxCampaigns((p.context as InvCtx).current, p.data) : DEFAULT_MAX_CAMPAIGNS),
      ...setColumn<AvailableInventoryRow>('Max campaigns', invValues((r) => [String(r.maxCampaigns)])),
    },
    {
      headerName: 'Billing unit', width: 135, minWidth: 120, cellRenderer: BillingUnitCell,
      headerComponent: header('Billing unit', 'The length of this slot’s play windows: each one is auctioned, booked and billed on its own. Set once for the display type and inherited by every slot on it — override just one slot to give it its own value, independent of the others. With neither set, the play-window length in Advertiser settings applies. Can’t change while windows are still bid on or booked under it.'),
      valueGetter: (p) => (p.data ? effectiveBillingUnitHours((p.context as InvCtx).current, p.data) : DEFAULT_BILLING_UNIT_HOURS),
    },
    { headerName: '', width: 76, suppressSizeToFit: true, cellRenderer: OpenCell },
  ], [invRows, inventory.data, buyersLists.data])
  const saved = useMemo<Settings | undefined>(() => q.data && Object.fromEntries(q.data.items.map((a) => [a.advertiserId, { approvalRequired: a.approvalRequired, floorMultiplier: a.floorMultiplier }])), [q.data])
  const { draft, setDraft, dirty, reset, commitNext } = useDraft(saved)
  const savedEdits = useMemo<Edits | undefined>(() => inventory.data && Object.fromEntries(invRows.map((r) => {
    const { partnerNames: _names, ...assignedTo } = r.assignedTo
    return [slotKey(r), { assignedTo, reservePrice: r.reservePriceOverride, interactiveReservePrice: r.interactiveReservePriceOverride ?? null, billingUnitHours: r.billingUnitHoursOverride, maxCampaigns: r.maxCampaignsOverride }]
  })), [invRows, inventory.data])
  const inv = useDraft(savedEdits)
  const savedEditsNow = (r: AvailableInventoryRow): SlotEdit => (inv.draft ?? {})[slotKey(r)] ?? { assignedTo: r.assignedTo, reservePrice: r.reservePriceOverride, interactiveReservePrice: r.interactiveReservePriceOverride ?? null, billingUnitHours: r.billingUnitHoursOverride, maxCampaigns: r.maxCampaignsOverride }
  const anyInteractiveReserve = INTERACTIVE_ENABLED && invRows.some((r) => showsInteractiveReserve(r.qrControl, savedEditsNow(r)))
  const visibleInventoryColumns = useMemo(
    () => (anyInteractiveReserve ? inventoryColumns : inventoryColumns.filter((col) => col.headerName !== INTERACTIVE_RESERVE_HEADER)),
    [inventoryColumns, anyInteractiveReserve],
  )
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
    { headerName: 'Effective floor', width: 150, minWidth: 140, cellRenderer: EffectiveCell, headerComponent: header('Effective floor', `Floor CPM (${TRANSACTING_CURRENCY} ${data.floorCpm}, set in DSP Integration → Advertiser settings) × this advertiser's floor multiplier.`) },
    /* Campaigns and Bookings columns removed (Rob's ticket, 26 Sep 2026):
       already covered in Campaign Status and the booking schedule, their
       own operational sections. */
  ] : [], [data])

  if (q.error) return <Callout tone="error" icon="block">{q.error instanceof ApiRequestError ? q.error.message : 'Could not load advertisers.'}</Callout>
  if (!data || !draft) return <Spin />

  /* Removing an advertiser from a sold slot is refused (has_dependents,
     `items[n].assignedTo.advertisers`); the admin may lock those slots
     against new sales instead (ticket, 30 Sep 2026). */
  const offerLock = (e: ApiRequestError, sent: { displayTypeId: string; slot: number }[]) => {
    const rows = (e.body?.error.details ?? []).flatMap((d) => {
      const n = /^items\[(\d+)\]\.assignedTo\.advertisers$/.exec(d.field ?? "")?.[1]
      return n === undefined || !sent[Number(n)] ? [] : [{ row: sent[Number(n)], reason: d.reason }]
    })
    if (!rows.length) return false
    modal.confirm({
      title: 'Slots are sold: the advertiser can’t be removed',
      icon: <Icon name="lock" size={22} />,
      width: 520,
      content: (
        <div className="flex flex-col gap-2">
          {rows.map((r) => <div key={slotKey(r.row as AvailableInventoryRow)}>{r.reason}</div>)}
          <div>Existing sold slots keep running. Locking stops any new slot being sold on {rows.length === 1 ? 'this slot' : 'these slots'}, and releases by itself once nothing is booked.</div>
        </div>
      ),
      okText: 'Lock against new sales',
      cancelText: 'Keep as is',
      onOk: async () => {
        try {
          for (const r of rows) await api('PUT', '/admin/v1/available-inventory/lock', { displayTypeId: r.row.displayTypeId, slot: r.row.slot })
          /* Put the refused removals back: the advertiser stays until the lock releases. */
          inv.setDraft((cur) => (cur ? { ...cur, ...Object.fromEntries(rows.map((r) => [slotKey(r.row as AvailableInventoryRow), savedEdits![slotKey(r.row as AvailableInventoryRow)]])) } : cur))
          await qc.invalidateQueries({ queryKey: ['available-inventory'] })
          message.success('Locked against new sales. Existing bookings continue.')
        } catch (err) {
          message.error(err instanceof ApiRequestError ? err.message : 'Could not lock the slot.')
        }
      },
    })
    return true
  }

  const onSave = async () => {
    setSaving(true)
    let sent: { displayTypeId: string; slot: number }[] = []
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
        sent = items
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
      if (e instanceof ApiRequestError && e.status === 409 && offerLock(e, sent)) return
      message.error(e instanceof ApiRequestError ? [e.message, ...(e.body?.error.details ?? []).map((d) => d.reason)].join(' ') : 'Could not save changes.')
    } finally {
      setSaving(false)
    }
  }
  const invContext = {
    /* Lands on Playlist Management now (Rob, 20 Sep; moved 26 Sep 2026 when
       Playlist Settings, where slot assignment lives, moved off the display
       type): the page finds that display type's default playlist and opens
       its settings. */
    open: (id: string) => navigate(`/playlists?displayTypeId=${encodeURIComponent(id)}`),
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
  }

  return (
    <div>
      {/* Booking schedule CTA moved here, top right of the page (ticket, 27
          Sep 2026) — it used to sit beside the Available Inventory heading,
          well below the fold on a page with any real number of advertisers
          or slots. */}
      <div className="mb-3.5 flex items-center justify-end gap-3">
        <Button color="primary" variant="text" size="small" icon={<Icon name="calendar_month" size={16} />} onClick={() => window.open(externalUrl(BOOKING_SCHEDULE_PATH), '_blank', 'noopener')}>Booking schedule</Button>
        {!canEdit && <StatusPill colour={T.muted} icon="visibility">Read only</StatusPill>}
      </div>
      {data.items.length === 0 ? (
        <div className="flex items-center gap-2" style={{ fontSize: 12.5, color: T.muted }}><Icon name="sell" size={18} />No advertisers yet. They appear here once a DSP is connected.</div>
      ) : (
        <>
          <div className="mb-2" style={{ fontSize: 13 }}>{showingCount(shown ?? data.items.length, data.items.length, `advertiser${data.items.length === 1 ? '' : 's'}`)}</div>
          <Grid<Advertiser>
            label="Advertisers" rows={data.items} columns={columns} context={context} getRowId={(a) => a.advertiserId}
            stickyHeader headerHeight={40} floatingFiltersHeight={40} onFilterChanged={(e) => setShown(e.api.getDisplayedRowCount())}
          />
        </>
      )}
      <SectionLabel><WithTip tip="Every advertiser-owned slot across the estate that connected DSPs can bid on. Slots are made available by setting their owner to Advertiser on a display type.">Available Inventory</WithTip></SectionLabel>
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
            columns={visibleInventoryColumns}
            context={invContext}
            getRowId={slotKey}
            rowHeight={52}
            stickyHeader
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
          if (addingBuyersListFor) inv.setDraft((cur) => ({ ...(cur ?? {}), [slotKey(addingBuyersListFor)]: { ...edited(invContext, addingBuyersListFor), assignedTo: { partnerIds: [], advertisers: [], whitelistOnly: false, buyersListId: list.id, buyersListIds: [...tiersOf(edited(invContext, addingBuyersListFor).assignedTo), list.id].filter((x, i, all) => all.indexOf(x) === i) } } }))
          setAddingBuyersListFor(null)
        }}
      />
    </div>
  )
}
