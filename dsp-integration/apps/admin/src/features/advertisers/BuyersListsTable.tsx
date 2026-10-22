/* Deals and buyers lists table (spec "Support private auctions" — Available
   Inventory UX): view, manage and edit the buyers lists that are then
   selectable in Available Inventory's Assigned to column, underneath that
   table (Rob, 23 Sep). */
import { Button, Modal } from 'antd'
import type { ColDef, ICellRendererParams } from 'ag-grid-community'
import { DIRECT_PARTNER_ID, isGuaranteedLike, OPERATOR_LABELS, TARGETING_VARIABLES, storeZoneLabel, type BuyersList, type StoreZone } from '@ph-dsp/types'
import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { Q } from '../../api/queries'
import { api, ApiRequestError } from '../../api/client'
import { DeleteDialog } from '../../shared/DeleteDialog'
import { Grid } from '../../shared/Grid'
import { Icon } from '../../shared/Icon'
import { WithTip } from '../../shared/InfoTip'
import { searchColumn, setColumn } from '../../shared/TableFilters'
import { Tip } from '../../shared/Tip'
import { SectionLabel } from '../../shared/SectionLabel'
import { T } from '../../theme/phTheme'
import { BuyersListModal } from './BuyersListModal'
import { DealSheetModal } from './DealSheetModal'
import { buyerStatusOf, flightDays, flightMoment, slotPlaysOver, termTotalText, rateTypeOf, rateValue, sourceLabel, valueOf, valueText, zoneLabelOf } from './effectiveTerm'

type Capacity = Map<string, { plays: number; displayTypes: number; positions: number }>
type SlotInfo = { displayType: string; description: string | null; storeZone: StoreZone | null; orientation?: 'landscape' | 'portrait' | null; zoneName: string | null; playlist: string; position: string; slot: number; playsPerWindow: number | null; displayCount: number | null; windowHours: number }
/* Secondary text inside a Tip (dark background). */
const TIP_MUTED = 'rgba(255,255,255,0.65)'
type Ctx = { current: { capacity: Capacity; slots: Map<string, SlotInfo[]>; dspName: (partnerId: string) => string; seatName: (partnerId: string, seatId: string) => string; onEdit: (l: BuyersList) => void; onArchive: (l: BuyersList) => void; onShare: (l: BuyersList) => void; canEdit: boolean; showTargeting: boolean; bufferPct: number } }
type P = ICellRendererParams<BuyersList, unknown, Ctx>

/* One line per targeting rule, in the words of the criteria picker: "State: includes selected NSW, VIC". */
const targetingLines = (l: BuyersList): string[] =>
  (l.targeting ?? []).map((c) => `${TARGETING_VARIABLES.find((v) => v.key === c.variable)?.label ?? c.variable}: ${OPERATOR_LABELS[c.op] ?? c.op} ${c.values.join(', ')}`.trim())

/* The name is the way in (ph-designer: a row's name opens it; the icon button is only a shortcut). */
const NameCell = ({ data, context }: P) => {
  if (!data) return null
  const name = context.current.canEdit ? (
    <button
      type="button"
      className="block max-w-full truncate border-0 bg-transparent p-0 text-left hover:underline"
      style={{ color: T.primary, cursor: 'pointer', font: 'inherit', fontWeight: 500 }}
      onClick={() => context.current.onEdit(data)}
    >
      {data.name}
    </button>
  ) : (
    <div className="truncate" style={{ fontWeight: 500 }}>{data.name}</div>
  )
  const rules = context.current.showTargeting ? targetingLines(data) : []
  return (
    <div className="min-w-0">
      {/* The description and targeting rules are not extra lines in the row: hovering the name shows them under the name. */}
      {data.description || rules.length
        ? <Tip title={<div>
          <div style={{ fontWeight: 500 }}>{data.name}</div>
          {data.description && <div>{data.description}</div>}
          {rules.length > 0 && <div data-testid={`targeting-tip-${data.id}`} style={data.description ? { marginTop: 4 } : undefined}>
            <div style={{ fontWeight: 500 }}>Targeting criteria</div>
            {rules.map((r) => <div key={r}>{r}</div>)}
          </div>}
        </div>}>{name}</Tip>
        : name}
      {data.status === 'draft' && <div style={{ fontSize: 11.5, color: T.muted }} data-testid={`draft-${data.id}`}>{data.dealType === 'direct' ? 'Draft · not live yet' : 'Draft · not shared with any DSP'}</div>}
      {/* A Direct advertiser deal is never shared with a DSP or accepted by a buyer: Finalise makes it live (E2E 21 Oct 2026, it read "Shared · Pending" for good). */}
      {data.status === 'shared' && data.dealType === 'direct' && <div style={{ fontSize: 11.5, color: T.muted }} data-testid={`status-${data.id}`}>Live · direct, not sent to a DSP</div>}
      {/* A shared deal's status in DV360's words, alongside PH's Shared. */}
      {data.dealType !== 'direct' && (() => {
        const s = buyerStatusOf(data)
        return s && <div style={{ fontSize: 11.5, color: s.reacceptance ? T.error : T.muted }} data-testid={`status-${data.id}`}>Shared · {s.label}{s.reacceptance ? ' · re-acceptance required' : ''}</div>
      })()}
    </div>
  )
}
/* Who the deal is for: named advertisers, IAB categories, or both (a union). */
const BuyersCell = ({ data, context }: P) => {
  if (!data) return null
  const { dspName, seatName } = context.current
  /* A Direct advertiser or programmatic guaranteed deal has exactly one buyer, so it is named rather than counted. */
  const buyers = (data.dealType === 'direct' || data.dealType === 'guaranteed') && data.invitedBuyers.length === 1 ? seatName(data.invitedBuyers[0].partnerId, data.invitedBuyers[0].seatId)
    : data.invitedBuyers.length ? `${data.invitedBuyers.length} buyer${data.invitedBuyers.length === 1 ? '' : 's'}` : ''
  const cats = (data.invitedCategories ?? []).length ? `Category: ${data.invitedCategories.join(', ')}` : ''
  const text = [buyers, cats].filter(Boolean).join(' + ')
  const categoryOnly = !buyers && !!cats
  const rows = data.invitedBuyers.map((b) => `${seatName(b.partnerId, b.seatId)} (${dspName(b.partnerId)})`)
  const note = categoryOnly ? `${text} — no named buyer: can’t be shared or authored until one is added` : ''
  const tip = rows.length || cats ? (
    <div>
      {rows.length > 0 && <div style={{ fontWeight: 500 }}>Buyers</div>}
      {rows.map((r) => <div key={r}>{r}</div>)}
      {cats && <div style={rows.length ? { marginTop: 4 } : undefined}>{cats}</div>}
      {note && <div style={{ marginTop: 4 }}>{note}</div>}
    </div>
  ) : null
  const cell = <span className="truncate">{text}{categoryOnly && <span style={{ color: T.muted }}> · not shareable</span>}</span>
  return tip ? <Tip title={tip}>{cell}</Tip> : cell
}
/* The slots the deal is assigned to (Available Inventory's Assigned to column); hover lists each with its details. */
const SlotsCell = ({ data, context }: P) => {
  if (!data) return null
  const rows = context.current.slots.get(data.id) ?? []
  if (!rows.length) return <span style={{ color: T.muted }}>Not assigned</span>
  const tip = (
    <div>
      <div style={{ fontWeight: 500 }}>Assigned slots</div>
      {rows.map((r, i) => (
        <div key={i} style={{ marginTop: 4 }}>
          <div style={{ fontWeight: 500 }}>{r.displayType}{r.orientation && !r.displayType.toLowerCase().includes(r.orientation) ? ` ${r.orientation === 'portrait' ? 'Portrait' : 'Landscape'}` : ''}{r.displayCount != null ? ` (${num(r.displayCount)} display${r.displayCount === 1 ? '' : 's'})` : ''}{r.description ? ` (${r.description})` : ''}</div>
          <div>{r.playlist || 'No playlist'}{r.zoneName ? ` · ${r.zoneName}` : ''}</div>
          {/* The IAB store zone set on the display type (ticket yZ8BvwUQV4Yc7a0IVwak, 15 Oct 2026). */}
          <div>IAB zone: {storeZoneLabel(r.storeZone) ?? 'Not defined'}</div>
          <div>{r.position} (slot {r.slot}){r.playsPerWindow != null ? ` · ${num(r.playsPerWindow)}${r.displayCount != null ? ` (${num(r.playsPerWindow * r.displayCount)} total)` : ''} plays per window` : ''}</div>
        </div>
      ))}
    </div>
  )
  return <Tip title={tip}><span style={{ fontSize: 12.5 }}>{rows.length} slot{rows.length === 1 ? '' : 's'}</span></Tip>
}
/* The flight dates (spec "Private auctions: two-period model", 23 Sep
   2026) — the span this deal is awarded for; was "Active window" before
   the auction window (bidding deadline) became a separate period. */
const TermCell = ({ data }: P) => {
  if (!data) return null
  const from = flightMoment(data.activeFrom)
  const to = flightMoment(data.activeTo)
  if (!from && !to) return <span style={{ color: T.muted }}>Always active</span>
  return <span style={{ fontSize: 12.5 }}>{from ?? 'No start date'} → {to ?? 'No end date'}<div style={{ fontSize: 11.5, color: T.muted }}>{zoneLabelOf(data.timeZoneMode)}</div></span>
}
/* Details (ticket nfDLP1CZiPjGfN8FG764): the rate, the deal type and a one-line summary in the cell; the hover is a compact,
   programmatic read of the deal over its whole flight. It does not repeat the Slots hover (per-window slot copy): per slot it
   gives only the total plays and total value, then the deal's total. The rate the deal locked in, once it has one; until then the
   rate it inherits platform -> DSP -> this list, so the cell is never blank. */
const MAX_TIP_SLOTS = 5
const num = (n: number) => n.toLocaleString('en-US')
const DetailsCell = ({ data, context }: P) => {
  if (!data) return null
  const perTerm = isGuaranteedLike(data.dealType) && data.termTotal != null
  const rate = data.lockedWin ? `Locked: ${data.lockedWin.cpm} CPM` : perTerm ? termTotalText(data.termTotal) : rateValue(data.effectiveRateCpm)
  const rateType = data.lockedWin ? '' : rateTypeOf(data.dealType, data.termTotal)
  const typeLabel = DEAL_TYPE_LABELS[data.dealType] ?? 'Private auction'
  const src = sourceLabel(data.effectiveRateCpm?.source ?? 'none')
  const slots = context.current.slots.get(data.id) ?? []
  const days = flightDays(data.activeFrom, data.activeTo)
  const plays = slots.map((s) => slotPlaysOver(s, days))
  const counted = plays.filter((n): n is number => n !== null)
  const totalPlays = counted.reduce((a, n) => a + n, 0)
  const complete = slots.length > 0 && counted.length === slots.length
  const total = complete ? valueText(valueOf(data, totalPlays, totalPlays)) : null
  const flight = data.activeFrom || data.activeTo ? `${flightMoment(data.activeFrom) ?? 'No start date'} → ${flightMoment(data.activeTo) ?? 'No end date'} (${zoneLabelOf(data.timeZoneMode)})` : 'Always active'
  /* The cell's one-line summary: slots, plays and value over the flight, or why there is no total yet. */
  const summary = !slots.length ? 'Not assigned to a slot' : days == null ? 'Open flight: no total' : !complete ? `${slots.length} slot${slots.length === 1 ? '' : 's'}` : [`${slots.length} slot${slots.length === 1 ? '' : 's'}`, `${num(totalPlays)} plays`, total].filter(Boolean).join(' · ')
  /* The hover sits on the tooltip's dark background, where T.muted (black at 45%) is invisible (E2E 22 Oct 2026): secondary text is white at 65% there. */
  const sub = (l: string, v: string) => <div><span style={{ color: TIP_MUTED }}>{l}: </span>{v}</div>
  const tip = (
    <div data-testid={`details-tip-${data.id}`}>
      <div style={{ fontWeight: 500 }}>{typeLabel}</div>
      {sub('Rate', `${rate ?? 'Per play'}${rateType ? ` ${rateType}` : ''}${src && !perTerm && !data.lockedWin ? ` (${src})` : ''}`)}
      {sub('Flight', flight)}
      {sub('Period', days == null ? (data.activeFrom || data.activeTo ? 'Open flight' : 'Always active') : `${num(days)} day${days === 1 ? '' : 's'}`)}
      {data.dealType === 'direct' && <>
        {sub('Advertiser', data.invitedBuyers.length ? context.current.seatName(data.invitedBuyers[0].partnerId, data.invitedBuyers[0].seatId) : 'None yet')}
        {sub('Deal ID', data.dealId)}
      </>}
      <div style={{ marginTop: 6, fontWeight: 500 }}>Over the whole flight</div>
      {!slots.length ? <div>No assigned slots.</div>
        : days == null ? <div>Set a start and an end date to total the plays and value.</div>
        : <>
          {slots.slice(0, MAX_TIP_SLOTS).map((s, i) => {
            const p = plays[i]
            const v = p === null || !complete ? null : valueText(valueOf(data, p, totalPlays))
            return <div key={i} data-testid={`details-slot-${data.id}-${i}`}>{s.displayType} · slot {s.slot}: {p === null ? 'plays n/a' : `${num(p)} plays`}{v ? ` · ${v}` : ''}</div>
          })}
          {slots.length > MAX_TIP_SLOTS && <div style={{ color: TIP_MUTED }}>+ {slots.length - MAX_TIP_SLOTS} more slot{slots.length - MAX_TIP_SLOTS === 1 ? '' : 's'}</div>}
          <div style={{ marginTop: 4, fontWeight: 500 }} data-testid={`details-total-${data.id}`}>Deal total: {complete ? `${num(totalPlays)} plays${total ? ` · ${total}` : ''}` : 'not available for every slot'}</div>
          {!perTerm && !data.lockedWin && <div style={{ color: TIP_MUTED }}>Value = plays ÷ 1,000 × CPM.</div>}
        </>}
    </div>
  )
  return (
    <Tip title={tip} styles={{ root: { maxWidth: 'min(320px, calc(100vw - 32px))' } }}>
      <div className="min-w-0">
        <div className="truncate"><span style={{ fontSize: 12.5 }}>{rate ?? 'Per play'}</span> {rateType && <span style={{ fontSize: 12.5, color: T.muted }} data-testid={`rate-type-${data.id}`}>{rateType}</span>}{data.belowFloorOverride && <span data-testid={`below-floor-${data.id}`} style={{ fontSize: 11.5, color: T.error }}> · Below floor (override)</span>}</div>
        <div className="truncate" style={{ fontSize: 11.5, color: T.muted }} data-testid={`details-summary-${data.id}`}>{typeLabel} · {summary}</div>
      </div>
    </Tip>
  )
}
const DealIdCell = ({ data, context }: P) => {
  if (!data) return null
  const live = (data.deals ?? []).filter((d) => !d.retiredAt)
  const cell = <span style={{ fontSize: 12.5, fontFamily: 'monospace' }}>{live.map((d) => d.dealId).join(', ') || data.dealId}</span>
  /* One deal ID per DSP that has an invited buyer; hover names which DSP each belongs to. */
  if (!live.length) return cell
  return <Tip title={<div>{live.map((d) => <div key={d.dealId}>{context.current.dspName(d.partnerId)}: <span style={{ fontFamily: 'monospace' }}>{d.dealId}</span></div>)}</div>}>{cell}</Tip>
}
const DEAL_TYPE_LABELS = { private_auction: 'Private auction', preferred: 'Preferred deal', guaranteed: 'Programmatic guaranteed', direct: 'Direct advertiser' } as const
const ActionsCell = ({ data, context }: P) =>
  data ? (
    <span className="inline-flex gap-1">
      {data.status === 'shared' && data.dealType !== 'direct' && <Button type="text" size="small" aria-label={`Deal sheet for ${data.name}`} icon={<Icon name="ios_share" size={15} />} onClick={() => context.current.onShare(data)} />}
      <Button type="text" size="small" aria-label={`Edit ${data.name}`} icon={<Icon name="edit" size={15} />} onClick={() => context.current.onEdit(data)} />
      <Button type="text" size="small" aria-label={`Archive ${data.name}`} icon={<Icon name="archive" size={15} />} onClick={() => context.current.onArchive(data)} />
    </span>
  ) : null

/* Same "22 Oct 2026 14:05" form as the flight dates, not the browser's locale (E2E 22 Oct 2026: it read 10/22/2026, 2:19:36 AM). */
const fmtDate = (v: string | null) => flightMoment(v) ?? ''
const ArchivedNameCell = ({ data }: P) => (data ? <div className="min-w-0"><div className="truncate" style={{ fontWeight: 500 }}>{data.name}</div><div style={{ fontSize: 11.5, color: T.muted }}>Archived · read only</div></div> : null)
const ArchivedAtCell = ({ data }: P) => (data?.archivedAt ? <span style={{ fontSize: 12.5 }}>{fmtDate(data.archivedAt)}</span> : null)
const ArchivedByCell = ({ data }: P) => (data?.archivedBy ? <span style={{ fontSize: 12.5 }}>{data.archivedBy}</span> : null)

/* View Archived Deals: the historic table of every archived deal, newest archive first (ticket bCcJ2e00CRLxtd98Utlr). Deals are archived, never deleted, so each keeps its deal ID, terms and history; read only. */
function ArchivedDealsModal({ open, onClose, bufferPct, dspName, seatName }: { open: boolean; onClose: () => void; bufferPct: number; dspName: (id: string) => string; seatName: (p: string, s: string) => string }) {
  const q = useQuery({ queryKey: ['buyers-lists', 'archived'], enabled: open, queryFn: () => api<{ items: BuyersList[] }>('GET', '/admin/v1/buyers-lists?archived=true') })
  const rows = q.data?.items ?? []
  const typeText = (l?: BuyersList) => (l ? DEAL_TYPE_LABELS[l.dealType] ?? 'Private auction' : '')
  const columns = useMemo<ColDef<BuyersList>[]>(() => [
    { headerName: 'Deal', flex: 2, minWidth: 180, cellRenderer: ArchivedNameCell, valueGetter: (p) => p.data?.name ?? '', ...searchColumn<BuyersList>('Deal') },
    { headerName: 'Buyer(s)', width: 180, minWidth: 130, cellRenderer: BuyersCell, valueGetter: (p) => [...(p.data?.invitedBuyers ?? []).map((b) => p.context.current.seatName(b.partnerId, b.seatId)), ...(p.data?.invitedCategories ?? [])].join(', '), ...searchColumn<BuyersList>('Buyer(s)') },
    { headerName: 'Details', width: 280, minWidth: 220, cellRenderer: DetailsCell, valueGetter: (p) => `${typeText(p.data)} ${p.data?.termTotal != null ? termTotalText(p.data.termTotal) : rateValue(p.data?.effectiveRateCpm) ?? ''}`, ...searchColumn<BuyersList>('Details') },
    { headerName: 'Flight dates', width: 300, minWidth: 280, cellRenderer: TermCell, valueGetter: (p) => `${fmtDate(p.data?.activeFrom ?? null)} ${fmtDate(p.data?.activeTo ?? null)}`, ...searchColumn<BuyersList>('Flight dates') },
    { headerName: 'Deal ID', width: 160, minWidth: 140, cellRenderer: DealIdCell, valueGetter: (p) => p.data?.dealId ?? '', ...searchColumn<BuyersList>('Deal ID') },
    { headerName: 'Archived', width: 180, minWidth: 160, cellRenderer: ArchivedAtCell, valueGetter: (p) => fmtDate(p.data?.archivedAt ?? null), ...searchColumn<BuyersList>('Archived') },
    { headerName: 'Archived by', width: 140, minWidth: 120, cellRenderer: ArchivedByCell, valueGetter: (p) => p.data?.archivedBy ?? '', ...setColumn<BuyersList>('Archived by', () => rows.map((l) => l.archivedBy ?? '')) },
  ], [rows])
  const context = { canEdit: false, showTargeting: false, bufferPct, capacity: new Map(), slots: new Map(), dspName, seatName, onEdit: () => {}, onShare: () => {}, onArchive: () => {} }
  return (
    <Modal open={open} width={1180} onCancel={onClose} footer={<Button onClick={onClose}>Close</Button>} title={<span className="inline-flex items-center gap-2.5"><Icon name="inventory_2" size={20} />Archived deals</span>}>
      <div style={{ fontSize: 12.5, color: T.muted, marginBottom: 12 }}>Deals are archived, never deleted. An archived deal is read only and takes no new bookings or bids, but its deal ID, terms, campaigns, bookings and billing remain. A deal whose flight has ended and whose last window is billed is archived automatically, by system.</div>
      {q.isError ? <div style={{ fontSize: 12.5, color: T.error }}>Archived deals could not be loaded.</div>
        : q.data && rows.length === 0 ? <div className="flex items-center gap-2" style={{ fontSize: 12.5, color: T.muted }}><Icon name="inventory_2" size={18} /><span>No archived deals yet.</span></div>
        : <Grid<BuyersList> label="Archived deals" rows={rows} columns={columns} context={context} getRowId={(l) => l.id} rowHeight={52} headerHeight={40} />}
    </Modal>
  )
}

export function BuyersListsTable({ lists, canEdit, capacity, slots, onChanged, showTargeting = false }: { showTargeting?: boolean; lists: BuyersList[]; canEdit: boolean; capacity: Capacity; slots: Map<string, SlotInfo[]>; onChanged: () => void }) {
  const partners = useQuery(Q.partners)
  const bufferPct = useQuery(Q.advertiserSettings).data?.guaranteeBufferPct ?? 10
  /* A Direct advertiser deal's buyer is a direct advertiser (partner "direct", seat = its advertiser id), not a DSP seat. */
  const advertisers = useQuery({ queryKey: Q.advertisers.queryKey, queryFn: () => api<{ items: { advertiserId: string; name: string }[] }>('GET', '/admin/v1/advertisers') })
  const dspName = (id: string) => (id === DIRECT_PARTNER_ID ? 'Direct' : (partners.data ?? []).find((p) => p.id === id)?.name ?? id)
  const seatName = (pid: string, sid: string) => (pid === DIRECT_PARTNER_ID ? (advertisers.data?.items ?? []).find((a) => a.advertiserId === sid)?.name : (partners.data ?? []).find((p) => p.id === pid)?.seats?.find((x) => x.id === sid)?.name) ?? sid
  const [modalOpen, setModalOpen] = useState(false)
  const [editingSnapshot, setEditing] = useState<BuyersList | null>(null)
  /* Read the open list from the live rows, so slots assigned while it is open (or since it was last opened) enable Finalise at once. */
  const editing = editingSnapshot ? lists.find((l) => l.id === editingSnapshot.id) ?? editingSnapshot : null
  const [deleting, setDeleting] = useState<BuyersList | null>(null)
  const [sharing, setSharing] = useState<BuyersList | null>(null)
  const [deleteError, setDeleteError] = useState<ApiRequestError | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [archiveOpen, setArchiveOpen] = useState(false)

  /* Memoised: a new array each render makes AG Grid reload its columns and remount every cell,
     so a late re-render (the partners query resolving) swapped the cells out from under a click.
     Cells read anything that changes (names, capacity, handlers) through context.current. */
  const columns = useMemo<ColDef<BuyersList>[]>(() => [
    { headerName: 'Deals and buyers lists', flex: 2, minWidth: 220, cellRenderer: NameCell, valueGetter: (p) => `${p.data?.name}|${p.data?.description}|${JSON.stringify(p.data?.targeting ?? [])}|${p.data?.status}|${p.data?.dealType}|${p.data?.termVersion}|${JSON.stringify(p.data?.buyerAcceptance ?? [])}` },
    { headerName: 'Deal ID', field: 'dealId', width: 170, minWidth: 150, cellRenderer: DealIdCell },
    /* These cells have no field, so AG Grid saw an unchanged value (undefined) after a save and kept the old cell:
       an edited deal type kept showing "Private auction". Each gets a valueGetter over everything it renders. */
    { headerName: 'Details', width: 300, minWidth: 240, cellRenderer: DetailsCell, valueGetter: (p) => JSON.stringify([p.data?.dealType, p.data?.lockedWin, p.data?.effectiveRateCpm, p.data?.termTotal, p.data?.belowFloorOverride, p.data?.activeFrom, p.data?.activeTo, p.data?.dealId, p.data?.invitedBuyers ?? [], p.context.current.slots.get(p.data?.id ?? '') ?? []]) },
    { headerName: 'Buyer(s)', width: 190, minWidth: 130, cellRenderer: BuyersCell, valueGetter: (p) => JSON.stringify([p.data?.invitedBuyers ?? [], p.data?.invitedCategories ?? []]) },
    { headerName: 'Slots', width: 150, minWidth: 120, cellRenderer: SlotsCell, valueGetter: (p) => JSON.stringify(p.context.current.slots.get(p.data?.id ?? '') ?? []) },
    /* Start and end each carry a time now (ticket yOginusgiFgFkwVHTRFH): wide enough not to clip the end time (E2E 22 Oct 2026). */
    { headerName: 'Flight dates', width: 300, minWidth: 280, cellRenderer: TermCell, valueGetter: (p) => `${p.data?.activeFrom}|${p.data?.activeTo}` },
    ...(canEdit ? [{ headerName: '', width: 120, suppressSizeToFit: true, cellRenderer: ActionsCell }] : []),
  ], [canEdit])
  const context = {
    canEdit, showTargeting, bufferPct, capacity, slots, dspName, seatName,
    onEdit: (l: BuyersList) => {
      setEditing(l)
      setModalOpen(true)
    },
    onShare: (l: BuyersList) => setSharing(l),
    onArchive: (l: BuyersList) => {
      setDeleting(l)
      setDeleteError(null)
    },
  }

  const confirmDelete = async () => {
    if (!deleting) return
    setDeleteBusy(true)
    try {
      await api('POST', `/admin/v1/buyers-lists/${deleting.id}/archive`)
      setDeleting(null)
      onChanged()
    } catch (e) {
      setDeleteError(e instanceof ApiRequestError ? e : null)
    } finally {
      setDeleteBusy(false)
    }
  }

  /* Known from the rows already on screen, so the dialog says why Delete is off the moment it opens
     rather than after a refused click (deals are archived, never deleted); the API still enforces it (and names its own reasons) as a backstop. */
  const assigned = deleting ? slots.get(deleting.id) ?? [] : []
  const slotLine = (r: SlotInfo) => `${r.displayType}${r.description ? ` (${r.description})` : ''} · ${r.playlist || 'No playlist'} · ${r.position} (slot ${r.slot})`
  const blockedMessage = deleting && (assigned.length
    ? `“${deleting.name}” can’t be archived because it is assigned to ${assigned.length} slot${assigned.length === 1 ? '' : 's'}.`
    : deleteError?.message)

  return (
    <div className="mb-7">
      {/* Wraps on a phone: with View Archived Deals beside it the primary button was pushed off a 390px screen (E2E 22 Oct 2026). */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <SectionLabel style={{ margin: 0 }}>
          <WithTip tip="Deals and buyers lists decide who can buy your advertiser slots, and on what terms. Each list sets the deal type (private auction, preferred deal or programmatic guaranteed), the buyers, the flight dates and the rate. To set one up: 1. Create a buyers list. 2. Assign it to slots in Available Inventory's Assigned to column. 3. Finalise the deal terms, then confirm and share the deal with the DSPs.">
            Deals and buyers lists
          </WithTip>
        </SectionLabel>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="link" style={{ padding: 0 }} icon={<Icon name="inventory_2" size={16} />} onClick={() => setArchiveOpen(true)}>View Archived Deals</Button>
          {canEdit && (
            <Button type="primary" icon={<Icon name="add" size={16} />} onClick={() => { setEditing(null); setModalOpen(true) }}>
              New deal and buyers list
            </Button>
          )}
        </div>
      </div>
      {lists.length === 0 ? (
        <div className="flex items-center gap-2" style={{ fontSize: 12.5, color: T.muted }}>
          <Icon name="gavel" size={18} />
          <span>No deals or buyers lists yet. Create a buyers list, then assign it to slots in Available Inventory.</span>
        </div>
      ) : (
        <Grid<BuyersList> label="Deals and buyers lists" rows={lists} columns={columns} context={context} getRowId={(l) => l.id} rowHeight={52} headerHeight={40} stickyHeader />
      )}
      <BuyersListModal showTargeting={showTargeting} open={modalOpen} editing={editing} onClose={() => setModalOpen(false)} onSaved={() => onChanged()} />
      <DealSheetModal list={sharing} onClose={() => setSharing(null)} />
      <ArchivedDealsModal open={archiveOpen} onClose={() => setArchiveOpen(false)} bufferPct={bufferPct} dspName={dspName} seatName={seatName} />
      {deleting && (
        <DeleteDialog
          open={!!deleting} name={deleting.name}
          blockedReason={blockedMessage} action="Archive" icon="archive"
          deleting={deleteBusy} onDelete={confirmDelete} onClose={() => setDeleting(null)}
        >
          {assigned.length ? (
            <>
              <div>{blockedMessage} Unassign it from each slot below in Available Inventory (the Assigned to column), then archive it.</div>
              <ul className="mt-2 mb-0 pl-[18px]">
                {assigned.map((r, i) => <li key={i}>{slotLine(r)}</li>)}
              </ul>
            </>
          ) : (
            <>
              {deleteError ? <div>{deleteError.message}</div> : 'This moves the deal to View Archived Deals. It leaves this table and the Assigned to picker, takes no new bookings or bids and becomes read-only; its deal ID, terms, campaigns, bookings and billing stay.'}
              {deleteError?.body?.error.details?.length ? (
                <ul className="mt-2 mb-0 pl-[18px]">
                  {deleteError.body.error.details.map((d, i) => <li key={i}>{d.reason}</li>)}
                </ul>
              ) : null}
            </>
          )}
        </DeleteDialog>
      )}
    </div>
  )
}
