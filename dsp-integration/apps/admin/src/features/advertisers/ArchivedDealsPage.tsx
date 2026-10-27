/* Archived deals: every archived deal on a full-screen page of its own, newest
   archive first (ticket cy45L5xGDqKwzt4diBBa; it was a dialog under Advertisers
   / Inventory). Deals are archived, never deleted, so each keeps its deal ID,
   terms and history; the page is read only. Every column has a filter (a search
   box, or a set for Archived by) so a deal from the past is quick to find. The Slots column lists the slots the deal was
   assigned to when it was archived (they are released as it is archived, so the API keeps them on the deal; ticket
   VHuSQiHQoGCPPvreusgK). */
import type { ColDef } from 'ag-grid-community'
import type { BuyersList } from '@ph-dsp/types'
import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { api } from '../../api/client'
import { Q } from '../../api/queries'
import { Grid } from '../../shared/Grid'
import { Icon } from '../../shared/Icon'
import { searchColumn, setColumn, showingCount } from '../../shared/TableFilters'
import { T } from '../../theme/phTheme'
import { BuyersCell, DEAL_TYPE_LABELS, DealIdCell, DetailsCell, TermCell, slotsTipOf, useDealNames, type Ctx, type P } from './BuyersListsTable'
import type { DealSlot } from './DealDetailsTip'
import { Tip } from '../../shared/Tip'
import { flightMoment, rateValue, termTotalText } from './effectiveTerm'
import { slotLine } from './slotLine'

/* Same "22 Oct 2026 14:05" form as the flight dates, not the browser's locale (E2E 22 Oct 2026: it read 10/22/2026, 2:19:36 AM). */
const fmtDate = (v: string | null) => flightMoment(v) ?? ''
/* How the deal left the live table: cancelled before it started, ended early, or simply archived. */
const outcomeOf = (l: BuyersList) => (l.endKind === 'cancelled' ? 'Cancelled' : l.endKind === 'ended_early' ? 'Ended early' : 'Archived')
const ReasonCell = ({ data }: P) => (data?.endReason ? <Tip title={data.endReason}><span className="truncate" style={{ fontSize: 12.5 }} data-testid={`end-reason-${data.id}`}>{data.endReason}</span></Tip> : <span style={{ fontSize: 12.5, color: T.muted }}>—</span>)
const ArchivedNameCell = ({ data }: P) => (data ? <div className="min-w-0"><div className="truncate" style={{ fontWeight: 500 }}>{data.name}</div><div style={{ fontSize: 11.5, color: T.muted }}>{outcomeOf(data)} · read only</div></div> : null)
/* The deal's slots as the Slots and Details hovers read them, from the snapshot kept when it was archived (ticket TeKdyE4cSeb9EQ9LIJeX):
   the same shape the live table builds from Available Inventory, so both hovers read the same on a live and an archived deal. A deal
   archived before the figures were kept has no play counts; the hovers say "plays n/a" rather than guess. */
const archivedSlotsOf = (l?: BuyersList): DealSlot[] => (l?.assignedSlots ?? []).map((s) => ({
  displayType: s.displayTypeName, description: s.description, storeZone: s.storeZone ?? null, orientation: s.orientation ?? null, zoneName: s.zoneName,
  playlist: s.playlistName === '—' ? '' : s.playlistName ?? '', position: s.position ?? s.label.split(' — ').slice(1).join(' — ') ?? '', slot: s.zoneSlot,
  playsPerWindow: s.playsPerWindow ?? null, displayCount: s.displayCount ?? null, windowHours: s.windowHours ?? 24, vacdPerPlay: s.vacdPerPlay ?? null,
}))
const slotLines = (l?: BuyersList) => (l?.assignedSlots ?? []).map((s) => slotLine(s))
/* One slot per line, none dropped: a person needs to see exactly which slots the deal was in. */
const ArchivedSlotsCell = ({ data }: P) => {
  const lines = slotLines(data)
  return lines.length && data
    ? <Tip title={slotsTipOf(data.id, archivedSlotsOf(data))}><ul className="m-0 list-none py-1 pl-0" style={{ fontSize: 12.5, lineHeight: '18px' }} data-testid={`archived-slots-${data?.id}`}>{lines.map((t, i) => <li key={i}>{t}</li>)}</ul></Tip>
    : <span style={{ fontSize: 12.5, color: T.muted }}>No slots recorded</span>
}
const ArchivedAtCell = ({ data }: P) => (data?.archivedAt ? <span style={{ fontSize: 12.5 }}>{fmtDate(data.archivedAt)}</span> : null)
const ArchivedByCell = ({ data }: P) => (data?.archivedBy ? <span style={{ fontSize: 12.5 }}>{data.archivedBy}</span> : null)

export function ArchivedDealsPage() {
  const { dspName, seatName } = useDealNames()
  const bufferPct = useQuery(Q.advertiserSettings).data?.guaranteeBufferPct ?? 10
  const q = useQuery({ queryKey: ['buyers-lists', 'archived'], queryFn: () => api<{ items: BuyersList[] }>('GET', '/admin/v1/buyers-lists?archived=true') })
  const rows = q.data?.items ?? []
  const [shown, setShown] = useState<number | null>(null)
  const typeText = (l?: BuyersList) => (l ? DEAL_TYPE_LABELS[l.dealType] ?? 'Private auction' : '')
  const columns = useMemo<ColDef<BuyersList>[]>(() => [
    { headerName: 'Deal', flex: 2, minWidth: 180, cellRenderer: ArchivedNameCell, valueGetter: (p) => p.data?.name ?? '', ...searchColumn<BuyersList>('Deal') },
    { headerName: 'Buyer(s)', width: 180, minWidth: 130, cellRenderer: BuyersCell, valueGetter: (p) => [...(p.data?.invitedBuyers ?? []).map((b) => p.context.current.seatName(b.partnerId, b.seatId)), ...(p.data?.invitedCategories ?? [])].join(', '), ...searchColumn<BuyersList>('Buyer(s)') },
    { headerName: 'Details', width: 280, minWidth: 220, cellRenderer: DetailsCell, valueGetter: (p) => `${typeText(p.data)} ${p.data?.termTotal != null ? termTotalText(p.data.termTotal) : rateValue(p.data?.effectiveRateCpm) ?? ''}`, ...searchColumn<BuyersList>('Details') },
    { headerName: 'Flight dates', width: 300, minWidth: 280, cellRenderer: TermCell, valueGetter: (p) => `${fmtDate(p.data?.activeFrom ?? null)} ${fmtDate(p.data?.activeTo ?? null)}`, ...searchColumn<BuyersList>('Flight dates') },
    { headerName: 'Slots', width: 300, minWidth: 220, autoHeight: true, cellRenderer: ArchivedSlotsCell, valueGetter: (p) => slotLines(p.data).join(', '), ...searchColumn<BuyersList>('Slots') },
    { headerName: 'Deal ID', width: 160, minWidth: 140, cellRenderer: DealIdCell, valueGetter: (p) => p.data?.dealId ?? '', ...searchColumn<BuyersList>('Deal ID') },
    { headerName: 'Archived', width: 180, minWidth: 160, cellRenderer: ArchivedAtCell, valueGetter: (p) => fmtDate(p.data?.archivedAt ?? null), ...searchColumn<BuyersList>('Archived') },
    { headerName: 'Reason', width: 220, minWidth: 150, cellRenderer: ReasonCell, valueGetter: (p) => (p.data ? `${outcomeOf(p.data)} ${p.data.endReason ?? ''}` : ''), ...searchColumn<BuyersList>('Reason') },
    { headerName: 'Archived by', width: 140, minWidth: 120, cellRenderer: ArchivedByCell, valueGetter: (p) => p.data?.archivedBy ?? '', ...setColumn<BuyersList>('Archived by', () => rows.map((l) => l.archivedBy ?? '')) },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [rows])
  const context: Ctx['current'] = { canEdit: false, showTargeting: false, bufferPct, capacity: new Map(), slots: new Map(rows.map((l) => [l.id, archivedSlotsOf(l)])), dspName, seatName, onEdit: () => {}, onShare: () => {}, onTerminate: () => {}, onArchive: () => {}, onDelete: () => {} }
  return (
    <div>
      {q.isError ? <div style={{ fontSize: 12.5, color: T.error }}>Archived deals could not be loaded.</div>
        : q.data && rows.length === 0 ? <div className="flex items-center gap-2" style={{ fontSize: 12.5, color: T.muted }}><Icon name="inventory_2" size={18} /><span>No archived deals yet.</span></div>
        : <>
          <div className="mb-2" style={{ fontSize: 13 }}>{showingCount(shown ?? rows.length, rows.length, `archived deal${rows.length === 1 ? '' : 's'}`)}</div>
          <Grid<BuyersList> label="Archived deals" rows={rows} columns={columns} context={context} getRowId={(l) => l.id} rowHeight={52} headerHeight={40} stickyHeader
            onFilterChanged={(e) => setShown(e.api.getDisplayedRowCount())} onRowDataUpdated={(e) => setShown(e.api.getDisplayedRowCount())} />
        </>}
    </div>
  )
}
