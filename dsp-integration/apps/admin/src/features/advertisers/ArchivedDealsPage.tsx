/* Archived deals: every archived deal on a full-screen page of its own, newest
   archive first (ticket cy45L5xGDqKwzt4diBBa; it was a dialog under Advertisers
   / Inventory). Deals are archived, never deleted, so each keeps its deal ID,
   terms and history; the page is read only. Every column has a filter (a search
   box, or a set for Archived by) so a deal from the past is quick to find. */
import { Button } from 'antd'
import type { ColDef } from 'ag-grid-community'
import type { BuyersList } from '@ph-dsp/types'
import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../../api/client'
import { Q } from '../../api/queries'
import { Grid } from '../../shared/Grid'
import { Icon } from '../../shared/Icon'
import { searchColumn, setColumn, showingCount } from '../../shared/TableFilters'
import { T } from '../../theme/phTheme'
import { BuyersCell, DEAL_TYPE_LABELS, DealIdCell, DetailsCell, TermCell, useDealNames, type Ctx, type P } from './BuyersListsTable'
import { flightMoment, rateValue, termTotalText } from './effectiveTerm'

/* Same "22 Oct 2026 14:05" form as the flight dates, not the browser's locale (E2E 22 Oct 2026: it read 10/22/2026, 2:19:36 AM). */
const fmtDate = (v: string | null) => flightMoment(v) ?? ''
const ArchivedNameCell = ({ data }: P) => (data ? <div className="min-w-0"><div className="truncate" style={{ fontWeight: 500 }}>{data.name}</div><div style={{ fontSize: 11.5, color: T.muted }}>Archived · read only</div></div> : null)
const ArchivedAtCell = ({ data }: P) => (data?.archivedAt ? <span style={{ fontSize: 12.5 }}>{fmtDate(data.archivedAt)}</span> : null)
const ArchivedByCell = ({ data }: P) => (data?.archivedBy ? <span style={{ fontSize: 12.5 }}>{data.archivedBy}</span> : null)

export function ArchivedDealsPage() {
  const navigate = useNavigate()
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
    { headerName: 'Deal ID', width: 160, minWidth: 140, cellRenderer: DealIdCell, valueGetter: (p) => p.data?.dealId ?? '', ...searchColumn<BuyersList>('Deal ID') },
    { headerName: 'Archived', width: 180, minWidth: 160, cellRenderer: ArchivedAtCell, valueGetter: (p) => fmtDate(p.data?.archivedAt ?? null), ...searchColumn<BuyersList>('Archived') },
    { headerName: 'Archived by', width: 140, minWidth: 120, cellRenderer: ArchivedByCell, valueGetter: (p) => p.data?.archivedBy ?? '', ...setColumn<BuyersList>('Archived by', () => rows.map((l) => l.archivedBy ?? '')) },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [rows])
  const context: Ctx['current'] = { canEdit: false, showTargeting: false, bufferPct, capacity: new Map(), slots: new Map(), dspName, seatName, onEdit: () => {}, onShare: () => {}, onArchive: () => {} }
  return (
    <div>
      <Button color="primary" variant="text" className="mb-2 px-0" icon={<Icon name="arrow_back" size={16} />} onClick={() => navigate('/advertisers')}>Advertisers / Inventory</Button>
      <div className="mb-1 inline-flex items-center gap-2.5" style={{ fontSize: 16, fontWeight: 500 }}><Icon name="inventory_2" size={20} />Archived deals</div>
      <div style={{ fontSize: 12.5, color: T.muted, marginBottom: 12 }}>Deals are archived, never deleted. An archived deal is read only and takes no new bookings or bids, but its deal ID, terms, campaigns, bookings and billing remain. A deal whose flight has ended and whose last window is billed is archived automatically, by system. Use the filter under each column heading to find a deal from the past.</div>
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
