/* Booking schedule (Rob, 19–20 Sep): its own page, opened in a new tab from
   Available Inventory or from an advertiser. Every advertiser-owned slot
   across its play windows — booked (advertiser, DSP, campaign type, the CPM
   it was booked at, booking revenue), available or unavailable — with the
   booking revenue per display type and per campaign type, filters for one
   advertiser or one DSP, and daily, weekly or monthly views. Read-only.

   Layered within each view (Rob, 22 Sep): a Fallback / Localised /
   Personalised tab breaks every slot's reach down by campaign layer —
   REQUIREMENTS §6 "Campaigns and content packages", interface contract
   "Booking schedule reach counts". Fallback = the slot's own display count
   across the whole footprint; Localised = the booked campaign's reach
   (`booking.reach`, from the server's ReachCountSource stand-in), of that
   footprint; Personalised = a plain indicator, no count — matches can't be
   predicted ahead of time. A window's single booking belongs to exactly one
   layer (the reservation/auction engine doesn't split a position's capacity
   between advertisers yet — REQUIREMENTS open question 50); a window booked
   by a different layer shows as "Sold — {layer}" rather than Available, so
   the tab never claims capacity that's actually already spoken for. */
import { useQuery } from '@tanstack/react-query'
import { Alert, DatePicker, Segmented, Spin, Tooltip } from 'antd'
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
import { externalSetColumn } from '../../shared/TableFilters'
import { T } from '../../theme/phTheme'

type Position = Schedule['positions'][number]
type Cell = Position['windows'][number]
type Booking = NonNullable<Cell['booking']>
type RevenueRow = Schedule['revenue'][number] & { total?: boolean }
type View = 'Daily' | 'Weekly' | 'Monthly'
/* One column: a single play window (daily), or the windows in a week or month. */
interface Group { key: string; label: string; cells: Cell[] }
interface Row { position: Position; groups: Group[] }

/* Which of the three layers a booking's pricing type belongs to (Rob,
   22 Sep): baseline is the fallback content, localised and interactive both
   vary by store rather than by visitor so they share the Localised layer,
   personalised is its own layer with no predictable count. */
type Layer = 'Fallback' | 'Localised' | 'Personalised'
const LAYERS: Layer[] = ['Fallback', 'Localised', 'Personalised']
const layerOf = (pricingType: Booking['pricingType']): Layer =>
  pricingType === 'personalised' ? 'Personalised' : pricingType === 'baseline' ? 'Fallback' : 'Localised'
const LAYER_TIP: Record<Layer, string> = {
  Fallback: 'The slot’s fallback content: what plays where nothing more specific matches. Booked/available counts only fallback (baseline) bookings — a window sold to another layer shows as Sold, not Available.',
  Localised: 'Store-level targeting. Shows each booking’s reach: how many of the display type’s displays its targeting matched, of the total across the retail footprint.',
  Personalised: 'One-to-one for the identified visitor. Indicator only — which windows have an active personalised campaign, with no reach count, since a personalised match can’t be predicted ahead of time.',
}

interface Ctx { current: { money: (n: number) => string; view: View; layer: Layer } }

const BOOKED = SLOT_OWNERS.advertiser
const DAY = 86_400_000
/* The server allows 92 days at a time. */
const SPAN_DAYS: Record<View, number> = { Daily: 13, Weekly: 83, Monthly: 91 }
/* The hosted, read-only build (see src/demo/staticApi.ts). */
const DEMO = import.meta.env.VITE_DEMO === '1'

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
      <div className="truncate" style={{ fontSize: 11, color: T.micro }}>Slot {data.position.slot} · {data.position.slotLabel}</div>
    </div>
  ) : null

/* Who the row's bookings belong to, over the range on screen. */
const advertisersIn = (p: Position) => [...new Set(p.windows.flatMap((w) => (w.booking ? [w.booking.advertiserName] : [])))]
/* Which DSP(s) actually brought those bookings — not `position.partnerNames`
   (who is merely *eligible* to buy the slot), so the DSP shown always lines
   up with the advertiser next to it (ticket, 21 Sep). */
const partnersIn = (p: Position) => [...new Set(p.windows.flatMap((w) => (w.booking ? [w.booking.partnerName] : [])))]

/* Muted, not the same red as Unavailable: the window has real demand, just
   not this layer's — showing it as plain Available would overstate what a
   DSP could actually still buy here (Rob, 22 Sep). */
const SoldElsewhere = ({ layer }: { layer: Layer }) => (
  <Tooltip title={`Booked, but as ${layer === 'Fallback' ? 'a localised or personalised' : layer === 'Localised' ? 'a fallback or personalised' : 'a fallback or localised'} campaign — not shown as Available here.`}>
    <span style={{ fontSize: 12, color: T.muted }}>Sold — other layer</span>
  </Tooltip>
)

function WindowCell({ value, context, data }: ICellRendererParams<Row, Group, Ctx>) {
  if (!value?.cells.length) return null
  const { money, view, layer } = context.current
  const inLayer = (c: Cell) => !!c.booking && layerOf(c.booking.pricingType) === layer
  const booked = value.cells.filter(inLayer)
  const soldElsewhere = value.cells.filter((c) => c.booking && !inLayer(c))
  /* A week or a month: how much of it is sold, and to whom, within this layer. */
  if (view !== 'Daily') {
    const names = [...new Set(booked.map((c) => c.booking!.advertiserName))]
    const revenue = booked.reduce((n, c) => n + c.booking!.bookedRevenue, 0)
    const sellable = value.cells.filter((c) => c.status !== 'unavailable' && !c.booking).length
    const tip = booked.length
      ? `${names.join(', ')} · ${money(revenue)}`
      : soldElsewhere.length ? `Nothing in this layer; ${soldElsewhere.length} window${soldElsewhere.length === 1 ? '' : 's'} booked as another layer.` : 'Nothing booked in this period.'
    return (
      <Tooltip title={tip}>
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
  if (cell.booking && !inLayer(cell)) return <SoldElsewhere layer={layer} />
  if (cell.status === 'available') return <span style={{ fontSize: 12, color: T.success }}>Available</span>
  if (cell.status === 'unavailable') return <span style={{ fontSize: 12, color: T.micro }}>—</span>
  const b = cell.booking!
  /* Personalised carries no `reach` from the server (a match can't be
     predicted ahead of time) — so on the Personalised layer this card is
     already an indicator with no count, with no special-casing needed here. */
  const reach = b.reach && data ? `${b.reach.matchedDisplays} of ${data.position.displayCount} displays matched (as of ${new Date(b.reach.asOf).toLocaleString('en-GB', { timeZone: 'UTC' })}) · ${Math.max(data.position.displayCount - b.reach.matchedDisplays, 0)} open for another campaign` : null
  const tip = [
    `${b.advertiserName} via ${b.partnerName} · ${b.pricingType} · ${b.type === 'reserve' ? 'Reserved' : 'Won at auction'} at ${b.cpm} CPM · ${b.assumedViews.toLocaleString('en-GB')} assumed views · booked ${money(b.bookedRevenue)}${b.billedRevenue === null ? '' : ` · billed ${money(b.billedRevenue)}`}`,
    reach,
  ].filter(Boolean).join(' · ')
  return (
    <Tooltip title={tip}>
      <div className="w-full min-w-0 rounded px-1.5 py-1" style={{ background: BOOKED.bg, borderLeft: `3px solid ${BOOKED.colour}` }}>
        <div className="flex items-center gap-1 truncate" style={{ fontSize: 12, fontWeight: 500, color: BOOKED.colour }}>
          <Icon name={b.type === 'reserve' ? 'bookmark' : 'gavel'} size={13} />
          <span className="truncate">{b.advertiserName}</span>
        </div>
        <div className="truncate" style={{ fontSize: 11, color: T.muted }}>{b.pricingType} · {b.cpm} CPM · {money(b.bookedRevenue)}</div>
        {b.reach && data && (
          <div className="truncate" style={{ fontSize: 10.5, color: T.micro }}>{b.reach.matchedDisplays} of {data.position.displayCount} matched</div>
        )}
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
  const [layer, setLayer] = useState<Layer>('Fallback')
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

  /* The DSP first, then its advertisers (Rob, 20 Sep): picking a DSP narrows the advertiser list. */
  const dsps = data?.dsps ?? []
  const advertiserOptions = useMemo(() => {
    const chosen = partnerId ? dsps.filter((d) => d.partnerId === partnerId) : dsps
    return [...new Map(chosen.flatMap((d) => d.advertisers.map((a) => [a.advertiserId, a.name] as const))).entries()]
      .map(([value, label]) => ({ value, label }))
  }, [dsps, partnerId])
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

  const columns = useMemo<ColDef<Row>[]>(() => [
    /* Advertiser, then the DSP it came in via, then Position (ticket, 21 Sep —
       previously Position, DSP, Advertiser). Filtered like every other table:
       a funnel in the filter row. The server applies these two, so they
       narrow every window, not only the rows here. */
    {
      headerName: 'Advertiser', width: 160, minWidth: 140, pinned: 'left', cellStyle: { color: T.muted },
      valueGetter: (p) => (p.data ? advertisersIn(p.data.position).join(', ') || '—' : ''),
      ...externalSetColumn<Row>('Advertiser', advertiserOptions.map((a) => a.label), advertiserOptions.find((a) => a.value === advertiserId)?.label,
        (name) => setFilter('advertiserId', advertiserOptions.find((a) => a.label === name)?.value)),
    },
    {
      headerName: 'DSP', width: 175, minWidth: 150, pinned: 'left', cellStyle: { color: T.muted },
      valueGetter: (p) => (p.data ? partnersIn(p.data.position).join(', ') || 'Any connected DSP' : ''),
      ...externalSetColumn<Row>('DSP', dsps.map((d) => d.name), dsps.find((d) => d.partnerId === partnerId)?.name,
        (name) => setFilter('partnerId', dsps.find((d) => d.name === name)?.partnerId, advertiserId)),
    },
    { headerName: 'Position', width: 230, minWidth: 190, pinned: 'left', cellRenderer: PositionCell, autoHeight: true },
    {
      headerName: 'Displays', width: 100, minWidth: 90, pinned: 'left', cellStyle: { color: T.muted }, suppressSizeToFit: true,
      valueGetter: (p) => p.data?.position.displayCount ?? 0,
    },
    ...groups.map((g, i): ColDef<Row> => ({
      headerName: g.label, colId: g.key, width: view === 'Daily' ? 156 : 170, suppressSizeToFit: true,
      valueGetter: (p) => p.data?.groups[i], cellRenderer: WindowCell, cellStyle: { alignItems: 'center' },
    })),
  ], [groups, view, layer, dsps, advertiserOptions, partnerId, advertiserId])
  const revenueColumns = useMemo<ColDef<RevenueRow>[]>(() => [
    { headerName: 'Display type', field: 'displayTypeName', width: 260, cellStyle: (p) => (p.data?.total ? { fontWeight: 600 } : null) },
    { headerName: 'Booked windows', field: 'bookedWindows', width: 150, cellRenderer: NumberCell },
    { headerName: 'Booked revenue', field: 'bookedRevenue', width: 170, cellRenderer: NumberCell },
    { headerName: 'Billed revenue', field: 'billedRevenue', width: 170, cellRenderer: NumberCell },
  ], [])
  const ctx: Ctx['current'] = { money, view, layer }

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
        {/* The hosted demo holds a snapshot per view, not per arbitrary range,
            so it fixes the dates rather than showing a range it doesn't have. */}
        <Tooltip title={DEMO ? 'Fixed in the hosted demo: its data is a snapshot. Run the POC locally to pick a range.' : ''}>
          <DatePicker.RangePicker aria-label="Dates" value={[dayjs(from), dayjs(to)]} allowClear={false} disabled={DEMO}
            onChange={(v) => setRange(v && v[0] && v[1] ? [v[0], v[1]] : null)} />
        </Tooltip>
      </div>

      {/* Layered within the view above (Rob, 22 Sep): which campaign layer
          every slot's reach is broken down by. */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Tooltip title={LAYER_TIP[layer]}>
          <Segmented<Layer> value={layer} onChange={setLayer} options={LAYERS} />
        </Tooltip>
        <span style={{ fontSize: 12, color: T.muted }}>{LAYER_TIP[layer]}</span>
      </div>

      {schedule.isError && <Alert className="mb-4" type="error" showIcon message="The booking schedule couldn’t be loaded." />}
      {!data ? <Spin /> : (
        <>
          {/* No "Schedule" section header here (ticket, 21 Sep) — the page's own
              "Booking schedule" title above already covers it; a second header
              immediately above the table was redundant. */}
          {data.positions.length === 0 ? (
            <div className="flex items-center gap-2" style={{ fontSize: 12.5, color: T.muted }}>
              <Icon name="view_week" size={18} />
              <span>No advertiser positions yet. Set a slot's owner to <b>Advertiser</b> on a display type.</span>
            </div>
          ) : (
            <Grid<Row>
              key={`${view}-${layer}-${q}`}
              label="Booking schedule"
              rows={rows}
              columns={columns}
              context={ctx}
              getRowId={(r) => r.position.positionId}
              rowHeight={56}
              headerHeight={40}
              floatingFiltersHeight={40}
              suppressHorizontalScroll={false}
              stickyHeader
            />
          )}

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
        </>
      )}
    </div>
  )
}
