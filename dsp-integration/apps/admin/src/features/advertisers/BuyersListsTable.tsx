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
import { buyerStatusOf, cpmKindHint, termTotalText, rateTypeOf, rateValue, sourceLabel } from './effectiveTerm'

type Capacity = Map<string, { plays: number; displayTypes: number; positions: number }>
type SlotInfo = { displayType: string; description: string | null; storeZone: StoreZone | null; zoneName: string | null; playlist: string; position: string; slot: number; playsPerWindow: number | null }
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
  /* A Direct advertiser deal has exactly one buyer, so it is named rather than counted. */
  const buyers = data.dealType === 'direct' && data.invitedBuyers.length === 1 ? seatName(data.invitedBuyers[0].partnerId, data.invitedBuyers[0].seatId)
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
          <div style={{ fontWeight: 500 }}>{r.displayType}{r.description ? ` (${r.description})` : ''}</div>
          <div>{r.playlist || 'No playlist'}{r.zoneName ? ` · ${r.zoneName}` : ''}</div>
          {/* The IAB store zone set on the display type (ticket yZ8BvwUQV4Yc7a0IVwak, 15 Oct 2026). */}
          <div>IAB zone: {storeZoneLabel(r.storeZone) ?? 'Not defined'}</div>
          <div>{r.position} (slot {r.slot}){r.playsPerWindow != null ? ` · ${r.playsPerWindow.toLocaleString('en-US')} plays per window` : ''}</div>
        </div>
      ))}
    </div>
  )
  return <Tip title={tip}><span style={{ fontSize: 12.5 }}>{rows.length} slot{rows.length === 1 ? '' : 's'}</span></Tip>
}
const fmt = (v: string | null) => (v ? new Date(v).toLocaleString() : null)
/* The flight dates (spec "Private auctions: two-period model", 23 Sep
   2026) — the span this deal is awarded for; was "Active window" before
   the auction window (bidding deadline) became a separate period. */
const TermCell = ({ data }: P) => {
  if (!data) return null
  const from = fmt(data.activeFrom)
  const to = fmt(data.activeTo)
  if (!from && !to) return <span style={{ color: T.muted }}>Always active</span>
  return <span style={{ fontSize: 12.5 }}>{from ?? 'No start date'} → {to ?? 'No end date'}</span>
}
/* Rate (USD CPM): the rate a deal locked in for the rest of its flight, once it has one; until then the
   rate it inherits platform -> DSP -> this list, so the cell is never blank. */
const Sub = ({ children }: { children: string }) => <div style={{ fontSize: 11.5, color: T.muted }}>{children}</div>
const RateCell = ({ data, context }: P) => {
  if (!data) return null
  if (data.lockedWin) return <Tip title="Locked: the rate this deal's auction settled at, billed for the rest of its flight."><span style={{ fontSize: 12.5, color: T.primary }}>Locked: {data.lockedWin.cpm} CPM</span></Tip>
  const perTerm = isGuaranteedLike(data.dealType) && data.termTotal != null
  const text = perTerm ? termTotalText(data.termTotal) : rateValue(data.effectiveRateCpm)
  const src = sourceLabel(data.effectiveRateCpm?.source ?? 'none')
  /* A per-day rate's hover also lists each assigned slot with its anticipated plays and the plays left after the guarantee buffer. */
  const { bufferPct } = context.current
  const slots = perTerm ? context.current.slots.get(data.id) ?? [] : []
  const base = `${cpmKindHint(data.dealType, data.termTotal)}${src ? ` Source: ${src}.` : ''}`
  const tip = perTerm && slots.length ? (
    <div>
      <div>{base}</div>
      {slots.map((r, i) => (
        <div key={i} style={{ marginTop: 6 }} data-testid={`rate-slot-${data.id}-${i}`}>
          <div style={{ fontWeight: 500 }}>{r.displayType}{r.description ? ` (${r.description})` : ''}</div>
          <div>{r.playlist || 'No playlist'}{r.zoneName ? ` · ${r.zoneName}` : ''}</div>
          <div>{r.position} (slot {r.slot})</div>
          {r.playsPerWindow != null
            ? <>
              <div>Anticipated plays: {r.playsPerWindow.toLocaleString('en-US')} expected in total</div>
              <div>{Math.max(0, Math.floor(r.playsPerWindow * (1 - bufferPct / 100))).toLocaleString('en-US')} after the {bufferPct}% buffer</div>
            </>
            : <div>Anticipated plays: not available</div>}
        </div>
      ))}
    </div>
  ) : base
  return text
    ? <Tip title={tip}><div><span style={{ fontSize: 12.5 }}>{text}</span> <span style={{ fontSize: 12.5, color: T.muted }} data-testid={`rate-type-${data.id}`}>{rateTypeOf(data.dealType, data.termTotal)}</span>{!perTerm && <Sub>{src}</Sub>}{data.belowFloorOverride && <div data-testid={`below-floor-${data.id}`} style={{ fontSize: 11.5, color: T.error }}>Below floor (override)</div>}</div></Tip>
    : <span style={{ color: T.muted }}>Per play</span>
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
const DealTypeCell = ({ data }: P) => (data ? <span style={{ fontSize: 12.5 }}>{DEAL_TYPE_LABELS[data.dealType] ?? 'Private auction'}</span> : null)
const ActionsCell = ({ data, context }: P) =>
  data ? (
    <span className="inline-flex gap-1">
      {data.status === 'shared' && data.dealType !== 'direct' && <Button type="text" size="small" aria-label={`Deal sheet for ${data.name}`} icon={<Icon name="ios_share" size={15} />} onClick={() => context.current.onShare(data)} />}
      <Button type="text" size="small" aria-label={`Edit ${data.name}`} icon={<Icon name="edit" size={15} />} onClick={() => context.current.onEdit(data)} />
      <Button type="text" size="small" aria-label={`Archive ${data.name}`} icon={<Icon name="archive" size={15} />} onClick={() => context.current.onArchive(data)} />
    </span>
  ) : null

const fmtDate = (v: string | null) => (v ? new Date(v).toLocaleString() : '')
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
    { headerName: 'Deal type', width: 170, minWidth: 150, cellRenderer: DealTypeCell, valueGetter: (p) => typeText(p.data), ...setColumn<BuyersList>('Deal type', () => rows.map(typeText)) },
    { headerName: 'Buyers', width: 180, minWidth: 130, cellRenderer: BuyersCell, valueGetter: (p) => [...(p.data?.invitedBuyers ?? []).map((b) => p.context.current.seatName(b.partnerId, b.seatId)), ...(p.data?.invitedCategories ?? [])].join(', '), ...searchColumn<BuyersList>('Buyers') },
    { headerName: 'Rate / total', width: 180, minWidth: 150, cellRenderer: RateCell, valueGetter: (p) => (p.data?.termTotal != null ? termTotalText(p.data.termTotal) : rateValue(p.data?.effectiveRateCpm)), ...searchColumn<BuyersList>('Rate / total') },
    { headerName: 'Flight dates', width: 250, minWidth: 210, cellRenderer: TermCell, valueGetter: (p) => `${fmtDate(p.data?.activeFrom ?? null)} ${fmtDate(p.data?.activeTo ?? null)}`, ...searchColumn<BuyersList>('Flight dates') },
    { headerName: 'Deal ID', width: 160, minWidth: 140, cellRenderer: DealIdCell, valueGetter: (p) => p.data?.dealId ?? '', ...searchColumn<BuyersList>('Deal ID') },
    { headerName: 'Archived', width: 170, minWidth: 140, cellRenderer: ArchivedAtCell, valueGetter: (p) => fmtDate(p.data?.archivedAt ?? null), ...searchColumn<BuyersList>('Archived') },
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
    { headerName: 'Rate', width: 200, minWidth: 170, cellRenderer: RateCell, valueGetter: (p) => JSON.stringify([p.data?.dealType, p.data?.lockedWin, p.data?.effectiveRateCpm, p.data?.termTotal, p.data?.belowFloorOverride, p.context.current.slots.get(p.data?.id ?? '') ?? [], p.context.current.bufferPct]) },
    /* These cells have no field, so AG Grid saw an unchanged value (undefined) after a save and kept the old cell:
       an edited deal type kept showing "Private auction". Each gets a valueGetter over everything it renders. */
    { headerName: 'Deal type', width: 170, minWidth: 150, cellRenderer: DealTypeCell, valueGetter: (p) => p.data?.dealType ?? '' },
    { headerName: 'Buyers', width: 190, minWidth: 130, cellRenderer: BuyersCell, valueGetter: (p) => JSON.stringify([p.data?.invitedBuyers ?? [], p.data?.invitedCategories ?? []]) },
    { headerName: 'Slots', width: 150, minWidth: 120, cellRenderer: SlotsCell, valueGetter: (p) => JSON.stringify(p.context.current.slots.get(p.data?.id ?? '') ?? []) },
    { headerName: 'Flight dates', width: 260, minWidth: 220, cellRenderer: TermCell, valueGetter: (p) => `${p.data?.activeFrom}|${p.data?.activeTo}` },
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
      <div className="mb-3 flex items-center justify-between gap-3">
        <SectionLabel style={{ margin: 0 }}>
          <WithTip tip="Deals and buyers lists decide who can buy your advertiser slots, and on what terms. Each list sets the deal type (private auction, preferred deal or programmatic guaranteed), the buyers, the flight dates and the rate. To set one up: 1. Create a buyers list. 2. Assign it to slots in Available Inventory's Assigned to column. 3. Finalise the deal terms, then confirm and share the deal with the DSPs.">
            Deals and buyers lists
          </WithTip>
        </SectionLabel>
        <div className="flex items-center gap-3">
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
