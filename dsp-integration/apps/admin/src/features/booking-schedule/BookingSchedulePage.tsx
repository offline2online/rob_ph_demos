/* Booking schedule (Rob, 19–20 Sep): its own page, opened in a new tab from
   Available Inventory or from an advertiser. Every advertiser-owned slot
   across its play windows — booked (advertiser, DSP, campaign type, the CPM
   it was booked at, booking revenue), available or unavailable — with the
   booking revenue per display type and per campaign type, filters for one
   advertiser or one DSP, and daily, weekly or monthly views. Read-only. */
import { useQuery } from '@tanstack/react-query'
import { Alert, DatePicker, Segmented, Select, Spin, Tooltip } from 'antd'
import type { ColDef, ICellRendererParams } from 'ag-grid-community'
import { SLOT_OWNERS, type BookingSchedule as Schedule } from '@ph-dsp/types'
import dayjs, { type Dayjs } from 'dayjs'
import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api } from '../../api/client'
import { Grid } from '../../shared/Grid'
import { Icon } from '../../shared/Icon'
import { WithTip } from '../../shared/InfoTip'
import { SectionLabel } from '../../shared/SectionLabel'
import { T } from '../../theme/phTheme'

type Position = Schedule['positions'][number]
type Cell = Position['windows'][number]
type RevenueRow = Schedule['revenue'][number] & { total?: boolean }
type View = 'Daily' | 'Weekly' | 'Monthly'
/* One column: a single play window (daily), or the windows in a week or month. */
interface Group { key: string; label: string; cells: Cell[] }
interface Row { position: Position; groups: Group[] }
interface Ctx { current: { money: (n: number) => string; view: View } }

const BOOKED = SLOT_OWNERS.advertiser
const DAY = 86_400_000
/* The server allows 92 days at a time. */
const SPAN_DAYS: Record<View, number> = { Daily: 13, Weekly: 83, Monthly: 91 }

export const BOOKING_SCHEDULE_TIP =
  'Every advertiser-owned slot across its play windows: which are booked (reserved or won, at the CPM they were booked at), which can still be bid on, and which can no longer be sold. Booked revenue is the booked CPM × the slot’s assumed views; billed revenue is what billing charged once the window played. Test-mode wins are not counted.'

const fmt = (d: Date, o: Intl.DateTimeFormatOptions) => d.toLocaleDateString('en-GB', { timeZone: 'UTC', ...o })
const windowLabel = (w: { start: string; end: string }) =>
  Date.parse(w.end) - Date.parse(w.start) <= DAY
    ? fmt(new Date(w.start), { weekday: 'short', day: 'numeric', month: 'short' })
    : `${fmt(new Date(w.start), { day: 'numeric', month: 'short' })} – ${fmt(new Date(Date.parse(w.end) - 1), { day: 'numeric', month: 'short' })}`

/* Weekly columns start on the Monday; monthly ones on the first. */
function groupOf(view: View, start: string) {
  const d = new Date(start)
  if (view === 'Monthly') return { key: `${d.getUTCFullYear()}-${d.getUTCMonth()}`, label: fmt(d, { month: 'long', year: 'numeric' }) }
  const monday = new Date(d)
  monday.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7))
  return { key: monday.toISOString(), label: `Week of ${fmt(monday, { day: 'numeric', month: 'short' })}` }
}

const PositionCell = ({ data }: ICellRendererParams<Row>) =>
  data ? (
    <div className="min-w-0 py-1.5">
      <div className="truncate">{data.position.displayTypeName}</div>
      <div className="truncate" style={{ fontSize: 11, color: T.micro }}>Slot {data.position.slot} · {data.position.slotLabel} · {data.position.partnerName ?? 'Any connected DSP'}</div>
    </div>
  ) : null

function WindowCell({ value, context }: ICellRendererParams<Row, Group, Ctx>) {
  if (!value?.cells.length) return null
  const { money, view } = context.current
  const booked = value.cells.filter((c) => c.booking)
  /* A week or a month: how much of it is sold, and to whom. */
  if (view !== 'Daily') {
    const names = [...new Set(booked.map((c) => `${c.booking!.advertiserName} (${c.booking!.pricingType})`))]
    const revenue = booked.reduce((n, c) => n + c.booking!.bookedRevenue, 0)
    const sellable = value.cells.filter((c) => c.status !== 'unavailable').length
    return (
      <Tooltip title={names.length ? `${names.join(', ')} · ${money(revenue)}` : 'Nothing booked in this period.'}>
        <div className="w-full min-w-0 rounded px-1.5 py-1" style={booked.length ? { background: BOOKED.bg, borderLeft: `3px solid ${BOOKED.colour}` } : undefined}>
          <div style={{ fontSize: 12, fontWeight: booked.length ? 500 : 400, color: booked.length ? BOOKED.colour : T.muted }}>
            {booked.length} of {value.cells.length} booked
          </div>
          <div className="truncate" style={{ fontSize: 11, color: T.muted }}>
            {booked.length ? money(revenue) : `${sellable} still sellable`}
          </div>
        </div>
      </Tooltip>
    )
  }
  const cell = value.cells[0]
  if (cell.status === 'available') return <span style={{ fontSize: 12, color: T.success }}>Available</span>
  if (cell.status === 'unavailable') return <span style={{ fontSize: 12, color: T.micro }}>—</span>
  const b = cell.booking!
  const tip = `${b.advertiserName} via ${b.partnerName} · ${b.pricingType} · ${b.type === 'reserve' ? 'Reserved' : 'Won at auction'} at ${b.cpm} CPM · ${b.assumedViews.toLocaleString('en-GB')} assumed views · booked ${money(b.bookedRevenue)}${b.billedRevenue === null ? '' : ` · billed ${money(b.billedRevenue)}`}`
  return (
    <Tooltip title={tip}>
      <div className="w-full min-w-0 rounded px-1.5 py-1" style={{ background: BOOKED.bg, borderLeft: `3px solid ${BOOKED.colour}` }}>
        <div className="flex items-center gap-1 truncate" style={{ fontSize: 12, fontWeight: 500, color: BOOKED.colour }}>
          <Icon name={b.type === 'reserve' ? 'bookmark' : 'gavel'} size={13} />
          <span className="truncate">{b.advertiserName}</span>
        </div>
        <div className="truncate" style={{ fontSize: 11, color: T.muted }}>{b.pricingType} · {b.cpm} CPM · {money(b.bookedRevenue)}</div>
      </div>
    </Tooltip>
  )
}

const NumberCell = ({ value, data, context, colDef }: ICellRendererParams<RevenueRow, number, Ctx>) => (
  <span style={{ fontWeight: data?.total ? 600 : 400 }}>{colDef?.field === 'bookedWindows' ? value : context.current.money(value ?? 0)}</span>
)

export function BookingSchedulePage() {
  const [params, setParams] = useSearchParams()
  const advertiserId = params.get('advertiserId') ?? undefined
  const partnerId = params.get('partnerId') ?? undefined
  const [view, setView] = useState<View>('Daily')
  const [range, setRange] = useState<[Dayjs, Dayjs] | null>(null)
  const from = (range?.[0] ?? dayjs()).format('YYYY-MM-DD')
  const to = (range?.[1] ?? dayjs().add(SPAN_DAYS[view], 'day')).format('YYYY-MM-DD')
  const q = `?from=${from}&to=${to}${advertiserId ? `&advertiserId=${encodeURIComponent(advertiserId)}` : ''}${partnerId ? `&partnerId=${encodeURIComponent(partnerId)}` : ''}`
  const schedule = useQuery({ queryKey: ['booking-schedule', q], queryFn: () => api<Schedule>('GET', `/admin/v1/booking-schedule${q}`) })
  const data = schedule.data
  const currency = data?.currency ?? 'AUD'
  const money = useMemo(() => {
    const f = new Intl.NumberFormat('en-AU', { style: 'currency', currency })
    return (n: number) => f.format(n)
  }, [currency])

  /* Columns: one per window, week or month. */
  const groups = useMemo<{ key: string; label: string; index: number[] }[]>(() => {
    if (!data) return []
    if (view === 'Daily') return data.windows.map((w, i) => ({ key: w.start, label: windowLabel(w), index: [i] }))
    const out = new Map<string, { key: string; label: string; index: number[] }>()
    data.windows.forEach((w, i) => {
      const g = groupOf(view, w.start)
      const existing = out.get(g.key) ?? { ...g, index: [] }
      existing.index.push(i)
      out.set(g.key, existing)
    })
    return [...out.values()]
  }, [data, view])
  const rows = useMemo<Row[]>(
    () => (data?.positions ?? []).map((position) => ({ position, groups: groups.map((g) => ({ key: g.key, label: g.label, cells: g.index.map((i) => position.windows[i]) })) })),
    [data, groups],
  )

  const columns = useMemo<ColDef<Row>[]>(() => [
    { headerName: 'Position', width: 240, minWidth: 200, pinned: 'left', cellRenderer: PositionCell, autoHeight: true },
    ...groups.map((g, i): ColDef<Row> => ({
      headerName: g.label, colId: g.key, width: view === 'Daily' ? 156 : 170, suppressSizeToFit: true,
      valueGetter: (p) => p.data?.groups[i], cellRenderer: WindowCell, cellStyle: { alignItems: 'center' },
    })),
  ], [groups, view])
  const revenueColumns = useMemo<ColDef<RevenueRow>[]>(() => [
    { headerName: 'Display type', field: 'displayTypeName', width: 260, cellStyle: (p) => (p.data?.total ? { fontWeight: 600 } : null) },
    { headerName: 'Booked windows', field: 'bookedWindows', width: 150, cellRenderer: NumberCell },
    { headerName: 'Booked revenue', field: 'bookedRevenue', width: 170, cellRenderer: NumberCell },
    { headerName: 'Billed revenue', field: 'billedRevenue', width: 170, cellRenderer: NumberCell },
  ], [])
  const setFilter = (key: 'advertiserId' | 'partnerId', value?: string, currentAdvertiser?: string) => {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value)
    else next.delete(key)
    /* Changing the DSP drops an advertiser it doesn't bring. */
    if (key === 'partnerId' && currentAdvertiser && !(dsps.find((d) => d.partnerId === value)?.advertisers ?? []).some((a) => a.advertiserId === currentAdvertiser)) {
      if (value) next.delete('advertiserId')
    }
    setParams(next, { replace: true })
  }
  /* The DSP first, then its advertisers (Rob, 20 Sep): picking a DSP narrows the advertiser list. */
  const dsps = data?.dsps ?? []
  const advertiserOptions = useMemo(() => {
    const chosen = partnerId ? dsps.filter((d) => d.partnerId === partnerId) : dsps
    return [...new Map(chosen.flatMap((d) => d.advertisers.map((a) => [a.advertiserId, a.name] as const))).entries()]
      .map(([value, label]) => ({ value, label }))
  }, [dsps, partnerId])
  const ctx: Ctx['current'] = { money, view }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Icon name="calendar_month" size={26} style={{ color: T.primary, marginTop: 2 }} />
        <div className="min-w-[220px] flex-1">
          <h2 className="m-0" style={{ fontSize: 16, fontWeight: 600 }}><WithTip tip={BOOKING_SCHEDULE_TIP}>Booking schedule</WithTip></h2>
          <div className="mt-1" style={{ fontSize: 12, color: T.muted }}>
            {data ? `${data.windows.length} play windows · ${from} to ${to} · times in UTC` : 'Loading…'}
          </div>
        </div>
        <Segmented<View> value={view} onChange={(v) => { setView(v); setRange(null) }} options={['Daily', 'Weekly', 'Monthly']} />
        <DatePicker.RangePicker aria-label="Dates" value={[dayjs(from), dayjs(to)]} allowClear={false}
          onChange={(v) => setRange(v && v[0] && v[1] ? [v[0], v[1]] : null)} />
        <Select allowClear placeholder="All DSPs" aria-label="DSP" style={{ minWidth: 170 }} value={partnerId}
          onChange={(v) => setFilter('partnerId', v, advertiserId)} options={dsps.map((d) => ({ value: d.partnerId, label: d.name }))} />
        <Select allowClear placeholder="All advertisers" aria-label="Advertiser" style={{ minWidth: 180 }} value={advertiserId}
          onChange={(v) => setFilter('advertiserId', v)} options={advertiserOptions} />
      </div>

      {schedule.isError && <Alert className="mb-4" type="error" showIcon message="The booking schedule couldn’t be loaded." />}
      {!data ? <Spin /> : (
        <>
          <SectionLabel><WithTip tip="Per display type, over the play windows shown. Booked revenue = booked CPM × assumed views ÷ 1000; billed revenue comes from billing once a window has played.">Booking revenue</WithTip></SectionLabel>
          <Grid<RevenueRow>
            label="Booking revenue"
            rows={data.revenue}
            columns={revenueColumns}
            context={ctx}
            getRowId={(r) => r.displayTypeId}
            defaultColDef={{ sortable: false, wrapHeaderText: true, autoHeaderHeight: true }}
            pinnedBottomRowData={[{ displayTypeId: 'total', displayTypeName: 'Total', ...data.totals, total: true }]}
          />

          <SectionLabel><WithTip tip="What is selling: baseline and localised campaigns pay the floor, personalised and interactive pay their multipliers on top.">By campaign type</WithTip></SectionLabel>
          {data.byPricingType.length === 0 ? (
            <div style={{ fontSize: 12.5, color: T.muted }}>Nothing booked in this period yet.</div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {data.byPricingType.map((t) => (
                <div key={t.pricingType} className="rounded-md px-3 py-2" style={{ border: `1px solid ${T.borderSubtle}`, minWidth: 150 }}>
                  <div style={{ fontSize: 11, color: T.micro, textTransform: 'capitalize' }}>{t.pricingType}</div>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>{money(t.bookedRevenue)}</div>
                  <div style={{ fontSize: 11, color: T.muted }}>{t.bookedWindows} window{t.bookedWindows === 1 ? '' : 's'}</div>
                </div>
              ))}
            </div>
          )}

          <SectionLabel><WithTip tip="Booked windows show the advertiser (bookmark = reserved, gavel = won at auction), the campaign type, the CPM it was booked at and its booked revenue; hover for the DSP, assumed views and billed revenue. Weekly and monthly views count how much of each period is sold.">Schedule</WithTip></SectionLabel>
          {data.positions.length === 0 ? (
            <div className="flex items-center gap-2" style={{ fontSize: 12.5, color: T.muted }}>
              <Icon name="view_week" size={18} />
              <span>No advertiser positions yet. Set a slot's owner to <b>Advertiser</b> on a display type.</span>
            </div>
          ) : (
            <Grid<Row>
              key={`${view}-${q}`}
              label="Booking schedule"
              rows={rows}
              columns={columns}
              context={ctx}
              getRowId={(r) => r.position.positionId}
              rowHeight={56}
              suppressHorizontalScroll={false}
              stickyHeader
            />
          )}
        </>
      )}
    </div>
  )
}
