/* Booking schedule (Rob, 19 Sep): reached from Available Inventory. Every
   advertiser-owned slot across its play windows — booked (advertiser, DSP,
   the CPM it was booked at, booking revenue), available or unavailable — and
   the booking revenue per display type. Read-only, so no save bar. */
import { useQuery } from '@tanstack/react-query'
import { Alert, Button, DatePicker, Tooltip } from 'antd'
import type { ColDef, ICellRendererParams } from 'ag-grid-community'
import { SLOT_OWNERS, type BookingSchedule as Schedule } from '@ph-dsp/types'
import dayjs, { type Dayjs } from 'dayjs'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../../api/client'
import { Grid } from '../../shared/Grid'
import { Icon } from '../../shared/Icon'
import { WithTip } from '../../shared/InfoTip'
import { SectionLabel } from '../../shared/SectionLabel'
import { T } from '../../theme/phTheme'
import { useSection } from './DspIntegrationLayout'
import { PATHS } from './DspList'
import { SubPageHeader } from './SubPageHeader'

type Position = Schedule['positions'][number]
type Cell = Position['windows'][number]
type RevenueRow = Schedule['revenue'][number] & { total?: boolean }
interface Ctx { current: { money: (n: number) => string } }

const BOOKED = SLOT_OWNERS.advertiser
const DAY = 86_400_000

export const BOOKING_SCHEDULE_TIP =
  'Every advertiser-owned slot across its play windows: which are booked (reserved or won, at the CPM they were booked at), which can still be bid on, and which can no longer be sold. Booked revenue is the booked CPM × the slot’s assumed views; billed revenue is what billing charged once the window played. Test-mode wins are not counted.'

/* "Mon 21 Sep", or "21 Sep – 28 Sep" for windows longer than a day (UTC). */
const windowLabel = (w: Schedule['windows'][number]) => {
  const s = new Date(w.start)
  const e = new Date(Date.parse(w.end) - 1)
  const day = (d: Date, wd = false) => d.toLocaleDateString('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short', ...(wd ? { weekday: 'short' } : {}) })
  return Date.parse(w.end) - Date.parse(w.start) <= DAY ? day(s, true) : `${day(s)} – ${day(e)}`
}

const PositionCell = ({ data }: ICellRendererParams<Position>) =>
  data ? (
    <div className="min-w-0 py-1.5">
      <div className="truncate">{data.displayTypeName}</div>
      <div className="truncate" style={{ fontSize: 11, color: T.micro }}>Slot {data.slot} · {data.slotLabel} · {data.partnerName ?? 'Any connected DSP'}</div>
    </div>
  ) : null

function WindowCell({ value, context }: ICellRendererParams<Position, Cell, Ctx>) {
  if (!value) return null
  if (value.status === 'available') return <span style={{ fontSize: 12, color: T.success }}>Available</span>
  if (value.status === 'unavailable') return <span style={{ fontSize: 12, color: T.micro }}>—</span>
  const b = value.booking!
  const money = context.current.money
  const tip = `${b.advertiserName} via ${b.partnerName} · ${b.type === 'reserve' ? 'Reserved' : 'Won at auction'} at ${b.cpm} CPM · ${b.assumedViews.toLocaleString('en-GB')} assumed views · booked ${money(b.bookedRevenue)}${b.billedRevenue === null ? '' : ` · billed ${money(b.billedRevenue)}`}`
  return (
    <Tooltip title={tip}>
      <div className="w-full min-w-0 rounded px-1.5 py-1" style={{ background: BOOKED.bg, borderLeft: `3px solid ${BOOKED.colour}` }}>
        <div className="flex items-center gap-1 truncate" style={{ fontSize: 12, fontWeight: 500, color: BOOKED.colour }}>
          <Icon name={b.type === 'reserve' ? 'bookmark' : 'gavel'} size={13} />
          <span className="truncate">{b.advertiserName}</span>
        </div>
        <div className="truncate" style={{ fontSize: 11, color: T.muted }}>{b.cpm} CPM · {money(b.bookedRevenue)}</div>
      </div>
    </Tooltip>
  )
}

const NumberCell = ({ value, data, context, colDef }: ICellRendererParams<RevenueRow, number, Ctx>) => (
  <span style={{ fontWeight: data?.total ? 600 : 400 }}>{colDef?.field === 'bookedWindows' ? value : context.current.money(value ?? 0)}</span>
)

export function BookingSchedule() {
  const navigate = useNavigate()
  const { setShowSaveBar } = useSection()
  useEffect(() => {
    setShowSaveBar(false)
    return () => setShowSaveBar(true)
  }, [setShowSaveBar])
  const [range, setRange] = useState<[Dayjs, Dayjs] | null>(null)
  /* The first date picked while choosing a range: at most 92 days either side. */
  const [picking, setPicking] = useState<Dayjs | null>(null)
  const q = range ? `?from=${range[0].format('YYYY-MM-DD')}&to=${range[1].format('YYYY-MM-DD')}` : ''
  const schedule = useQuery({ queryKey: ['booking-schedule', q], queryFn: () => api<Schedule>('GET', `/admin/v1/booking-schedule${q}`) })
  const data = schedule.data
  const currency = data?.currency ?? 'AUD'
  const money = useMemo(() => {
    const f = new Intl.NumberFormat('en-AU', { style: 'currency', currency })
    return (n: number) => f.format(n)
  }, [currency])

  const columns = useMemo<ColDef<Position>[]>(() => [
    { headerName: 'Position', width: 240, minWidth: 200, pinned: 'left', cellRenderer: PositionCell, autoHeight: true },
    ...(data?.windows ?? []).map((w, i): ColDef<Position> => ({
      headerName: windowLabel(w), colId: w.start, width: 156, suppressSizeToFit: true,
      valueGetter: (p) => p.data?.windows[i], cellRenderer: WindowCell, cellStyle: { alignItems: 'center' },
    })),
  ], [data?.windows])
  const revenueColumns = useMemo<ColDef<RevenueRow>[]>(() => [
    { headerName: 'Display type', field: 'displayTypeName', width: 260, cellStyle: (p) => (p.data?.total ? { fontWeight: 600 } : null) },
    { headerName: 'Booked windows', field: 'bookedWindows', width: 150, cellRenderer: NumberCell },
    { headerName: 'Booked revenue', field: 'bookedRevenue', width: 170, cellRenderer: NumberCell },
    { headerName: 'Billed revenue', field: 'billedRevenue', width: 170, cellRenderer: NumberCell },
  ], [])
  const first = data?.windows[0]
  const last = data?.windows[data.windows.length - 1]

  return (
    <>
      <SubPageHeader
        icon="calendar_month"
        title="Booking schedule"
        tip={BOOKING_SCHEDULE_TIP}
        sub={first && last ? `${data.windows.length} play windows · ${windowLabel(first)} to ${windowLabel(last)} · times in UTC` : undefined}
        right={
          <div className="flex items-center gap-2">
            <DatePicker.RangePicker
              aria-label="Dates"
              value={range ?? (first && last ? [dayjs(first.start.slice(0, 10)), dayjs(last.start.slice(0, 10))] : null)}
              onChange={(v) => setRange(v && v[0] && v[1] ? [v[0], v[1]] : null)}
              onCalendarChange={(v) => setPicking(v?.[0] && !v[1] ? v[0] : null)}
              disabledDate={(d) => !!picking && Math.abs(d.diff(picking, 'day')) > 92}
              allowClear={false}
            />
            <Button color="primary" variant="text" icon={<Icon name="arrow_back" size={16} />} onClick={() => navigate(PATHS.advertiserSettings)}>Available Inventory</Button>
          </div>
        }
      />

      {schedule.isError && <Alert className="mt-4" type="error" showIcon message="The booking schedule couldn’t be loaded." />}

      <SectionLabel><WithTip tip="Per display type, over the play windows shown. Booked revenue = booked CPM × assumed views ÷ 1000; billed revenue comes from billing once a window has played.">Booking revenue</WithTip></SectionLabel>
      {data && (
        <Grid<RevenueRow>
          label="Booking revenue"
          rows={data.revenue}
          columns={revenueColumns}
          context={{ money }}
          getRowId={(r) => r.displayTypeId}
          defaultColDef={{ sortable: false, wrapHeaderText: true, autoHeaderHeight: true }}
          pinnedBottomRowData={[{ displayTypeId: 'total', displayTypeName: 'Total', ...data.totals, total: true }]}
        />
      )}

      <SectionLabel><WithTip tip="Booked windows show the advertiser (bookmark = reserved, gavel = won at auction), the CPM it was booked at and its booked revenue; hover for the DSP, assumed views and billed revenue. Available windows can still be bid on; a dash means the window can no longer be sold.">Schedule</WithTip></SectionLabel>
      {data && data.positions.length === 0 ? (
        <div className="flex items-center gap-2" style={{ fontSize: 12.5, color: T.muted }}>
          <Icon name="view_week" size={18} />
          <span>No advertiser positions yet. Set a slot's owner to <b>Advertiser</b> on a display type.</span>
        </div>
      ) : (
        data && (
          <Grid<Position>
            key={q || 'default'}
            label="Booking schedule"
            rows={data.positions}
            columns={columns}
            context={{ money }}
            getRowId={(r) => r.positionId}
            rowHeight={56}
            suppressHorizontalScroll={false}
          />
        )
      )}
    </>
  )
}
