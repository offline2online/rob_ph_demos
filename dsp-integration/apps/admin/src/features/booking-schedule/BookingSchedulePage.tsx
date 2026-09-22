/* Booking schedule (Rob, 19–20 Sep): its own page, opened in a new tab from
   Available Inventory or from an advertiser. Every advertiser-owned slot
   across its play windows — booked (advertiser, DSP, campaign type, the CPM
   it was booked at, booking revenue), available or unavailable — with the
   booking revenue per display type and per campaign type, filters for one
   advertiser or one DSP, and daily, weekly or monthly views. Read-only.

   Single-advertiser stacking tile (ticket "Booking schedule:
   single-advertiser stacking tile", 22 Sep, superseding the earlier
   same-day "layered reach breakdown" design where three pills were always
   shown per window and two of them read "Sold — other layer"): a slot goes
   to one advertiser now (default is mandatory — ticket "Make default
   creative mandatory"), so each booked window is one tile, the advertiser
   name at the top, stacking whichever layers that one purchase actually
   carries — default always at the base, localised above it when
   provided, personalised at the very top when provided — REQUIREMENTS §6
   "Campaigns and content packages", interface contract "Booking schedule
   reach counts". Localised shows the booked campaign's reach
   (`booking.reach`, from the server's ReachCountSource stand-in), of the
   position's displayCount; personalised shows no count — a match can't be
   predicted ahead of time — but shows which trigger mechanism(s) its
   targeting rules use (ticket "Booking schedule: personalised trigger
   icons"), from broadest/most-frequent to narrowest/rarest: computer
   vision, aggregate store-level, individual. */
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
type Triggers = NonNullable<Booking['personalisedTriggers']>
type RevenueRow = Schedule['revenue'][number] & { total?: boolean }
type View = 'Daily' | 'Weekly' | 'Monthly'
/* One column: a single play window (daily), or the windows in a week or month. */
interface Group { key: string; label: string; cells: Cell[] }
interface Row { position: Position; groups: Group[] }

/* The three layers a booking's tile may stack, keyed the same as
   `booking.layers` (Rob, 22 Sep): default is the mandatory, untargeted
   base; localised and interactive both vary by store rather than by
   visitor so they share the Localised layer; personalised is its own
   layer with no predictable count. */
type LayerKey = keyof Booking['layers']
/* Stacking order, top row to bottom row — personalised at the very top when
   provided, localised above the base when provided, default always at the
   base (ticket "Booking schedule: single-advertiser stacking tile"). */
const LAYERS_TOP_DOWN: LayerKey[] = ['personalised', 'localised', 'default']
const LAYER_ABBR: Record<LayerKey, string> = { default: 'DEFAULT', localised: 'LOC', personalised: 'PERS' }
const LAYER_TIP: Record<LayerKey, string> = {
  default: 'The mandatory, untargeted layer: what plays where nothing more specific matches. Present on every booking.',
  localised: 'Store-level targeting, an upsell on the default layer. Shows this booking’s reach: how many of the display type’s displays its targeting matched, of the total across the retail footprint.',
  personalised: 'One-to-one for the identified visitor, an upsell on the default layer. No reach count — a match can’t be predicted ahead of time — but shows which trigger mechanism(s) its targeting rules use.',
}
/* Trigger-icon ladder, broadest/most-frequent to narrowest/rarest (ticket
   "Booking schedule: personalised trigger icons", 22 Sep): which icons are
   lit tells the viewer the expected activation frequency, and therefore how
   reliably the personalised multiplier will actually be earned. */
const TRIGGER_ORDER: (keyof Triggers)[] = ['computerVision', 'aggregateStore', 'individual']
const TRIGGER_META: Record<keyof Triggers, { icon: string; label: string; tip: string }> = {
  computerVision: { icon: 'visibility', label: 'Computer vision', tip: 'Highest-frequency trigger: fires on almost anyone in front of the screen, no identification needed. Likely to drive the majority of personalised presentations.' },
  aggregateStore: { icon: 'groups', label: 'Aggregate store-level', tip: 'Mid-frequency trigger: based on the aggregate of who is in the store right now, not one identified visitor.' },
  individual: { icon: 'how_to_reg', label: 'Individual (identified)', tip: 'Highest value, lowest frequency: requires the customer to be identified or checked in.' },
}

interface Ctx { current: { money: (n: number) => string; view: View } }

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

/* How many of this position's play windows across the whole range on
   screen are booked, of how many total — and, of those, how many carry
   each upsell layer (ticket "Also for the play windows … show a
   representation of how many are booked versus personalised …", 22 Sep).
   Independent of Daily/Weekly/Monthly, since it reads `position.windows`
   directly rather than the grouped columns — so the same "5 of 14 booked"
   read is always there next to the row's windows, whichever view is on
   screen. The default layer is omitted, same as `GroupedCell` below: it's
   on every booking, so it adds nothing "N of M booked" doesn't already say. */
function windowSummaryOf(position: Position) {
  const booked = position.windows.filter((w) => w.booking)
  const upsells = (['localised', 'personalised'] as const)
    .map((k) => ({ k, n: booked.filter((w) => w.booking!.layers[k]).length }))
    .filter((u) => u.n > 0)
  return { booked: booked.length, total: position.windows.length, upsells }
}

function PositionCell({ data }: ICellRendererParams<Row>) {
  if (!data) return null
  const { booked, total, upsells } = windowSummaryOf(data.position)
  return (
    <div className="min-w-0 py-1.5">
      <div className="truncate">
        {data.position.displayTypeName} <span style={{ color: T.micro }}>({data.position.displayCount})</span>
      </div>
      <div className="truncate" style={{ fontSize: 11, color: T.micro }}>Slot {data.position.slot} · {data.position.slotLabel}</div>
      <div className="flex flex-wrap items-center gap-x-1.5" style={{ fontSize: 10.5, color: T.muted }}>
        <span>{booked} of {total} windows booked</span>
        {upsells.map(({ k, n }) => (
          <span key={k} className="inline-flex items-center gap-0.5">
            <LayerTag layerKey={k} />
            <span style={{ color: T.micro }}>{n}</span>
          </span>
        ))}
      </div>
    </div>
  )
}

/* Who the row's bookings belong to, over the range on screen. */
const advertisersIn = (p: Position) => [...new Set(p.windows.flatMap((w) => (w.booking ? [w.booking.advertiserName] : [])))]
/* Which DSP(s) actually brought those bookings — not `position.partnerNames`
   (who is merely *eligible* to buy the slot), so the DSP shown always lines
   up with the advertiser next to it (ticket, 21 Sep). */
const partnersIn = (p: Position) => [...new Set(p.windows.flatMap((w) => (w.booking ? [w.booking.partnerName] : [])))]

/* One layer's pill within a window column — always rendered alongside the
   other two, and every layer row inside a booked tile: the short prefix
   tells them apart at a glance; the full layer name and its meaning are in
   the tooltip. */
const LayerTag = ({ layerKey }: { layerKey: LayerKey }) => (
  <span className="shrink-0" style={{ fontSize: 9, fontWeight: 700, letterSpacing: 0.3, color: T.micro }}>{LAYER_ABBR[layerKey]}</span>
)

/* One layer row within a booked tile — only rendered for a layer the
   booking actually carries (`booking.layers[layerKey]`), so the tile's
   height is exactly how many of these are provided (ticket "Booking
   schedule: single-advertiser stacking tile"). */
/* No Tooltip of its own any more (ticket "devise a different approach to
   doing hover overs where all the details are potentially covered in a
   single hover over for that specific slot or tile", 22 Sep): a layer row
   used to carry its own tooltip, nested inside the tile's, with a third,
   even more nested one on each lit trigger icon — three hover targets
   stacked on top of each other in a few square pixels, each one's tooltip
   fighting the others' for the pointer as it moved across the tile. One
   Tooltip on the whole tile (`BookingTile`, below) now covers everything
   this row shows, via `layerLine`; this component is purely visual. */
function LayerRow({ layerKey, booking, displayCount }: { layerKey: LayerKey; booking: Booking; displayCount?: number }) {
  if (layerKey === 'personalised') {
    const lit = TRIGGER_ORDER.filter((k) => booking.personalisedTriggers?.[k])
    return (
      <div className="flex items-center gap-1 w-full min-w-0">
        <LayerTag layerKey="personalised" />
        {lit.length === 0
          ? <span style={{ fontSize: 10, color: T.micro }}>Active</span>
          : lit.map((k) => <span key={k} className="flex"><Icon name={TRIGGER_META[k].icon} size={13} style={{ color: BOOKED.colour }} /></span>)}
      </div>
    )
  }
  if (layerKey === 'localised') {
    const reach = booking.reach
    return (
      <div className="flex items-center gap-1 w-full min-w-0">
        <LayerTag layerKey="localised" />
        {reach && displayCount && <span className="truncate" style={{ fontSize: 10, color: T.micro }}>{reach.matchedDisplays} of {displayCount}</span>}
      </div>
    )
  }
  return (
    <div className="flex items-center gap-1 w-full min-w-0">
      <LayerTag layerKey="default" />
    </div>
  )
}

/* One layer's plain-text line for the tile's single combined tooltip
   (see `LayerRow` above) — everything `LAYER_TIP`/`TRIGGER_META` used to
   explain over separate, nested hovers, now folded into the one tip
   `BookingTile` shows. */
function layerLine(k: LayerKey, booking: Booking, displayCount?: number): string {
  if (k === 'personalised') {
    const lit = TRIGGER_ORDER.filter((t) => booking.personalisedTriggers?.[t])
    return `PERS: one-to-one for the identified visitor, no predictable reach${lit.length ? ` — via ${lit.map((t) => TRIGGER_META[t].label).join(', ')}` : ''}`
  }
  if (k === 'localised') {
    const reach = booking.reach
    return `LOC: store-level targeting${reach && displayCount ? `, ${reach.matchedDisplays} of ${displayCount} displays matched (as of ${new Date(reach.asOf).toLocaleString('en-GB', { timeZone: 'UTC' })})` : ''}`
  }
  return 'DEFAULT: the mandatory, untargeted layer, present on every booking'
}

/* A single day's booked window: one tile, the advertiser name as the unit
   at the top, stacking only the layers this one purchase provides — so the
   tile visibly expands and contracts with how successful the upsell has
   been with that advertiser (ticket "Booking schedule: single-advertiser
   stacking tile"). */
function BookingTile({ booking, displayCount, money }: { booking: Booking; displayCount?: number; money: (n: number) => string }) {
  const present = LAYERS_TOP_DOWN.filter((k) => booking.layers[k])
  const layersTip = present.map((k) => layerLine(k, booking, displayCount)).join(' · ')
  const tip = `${booking.advertiserName} via ${booking.partnerName} · ${booking.type === 'reserve' ? 'Reserved' : 'Won at auction'} at ${booking.cpm} CPM · ${booking.assumedViews.toLocaleString('en-GB')} assumed views · booked ${money(booking.bookedRevenue)}${booking.billedRevenue === null ? '' : ` · billed ${money(booking.billedRevenue)}`} · ${layersTip}`
  return (
    <Tooltip title={tip}>
      <div className="flex w-full min-w-0 flex-col gap-0.5 rounded px-1 py-0.5" style={{ background: BOOKED.bg, borderLeft: `3px solid ${BOOKED.colour}` }}>
        <div className="flex items-center gap-1 w-full min-w-0">
          <Icon name={booking.type === 'reserve' ? 'bookmark' : 'gavel'} size={12} />
          <span className="truncate" style={{ fontSize: 11, fontWeight: 600, color: BOOKED.colour }}>{booking.advertiserName}</span>
        </div>
        {present.map((k) => <LayerRow key={k} layerKey={k} booking={booking} displayCount={displayCount} />)}
      </div>
    </Tooltip>
  )
}

/* A single day: the one tile this window can have (one advertiser per
   slot), Available, or unavailable — no per-layer competition any more
   (ticket "Booking schedule: single-advertiser stacking tile" retires the
   earlier "Sold — other layer" model along with the fallback-optional,
   part-sold submission it depended on). */
function DailyCell({ cell, displayCount, money }: { cell: Cell; displayCount?: number; money: (n: number) => string }) {
  if (cell.status === 'unavailable') return <span style={{ fontSize: 11, color: T.micro }}>—</span>
  if (!cell.booking) return <span style={{ fontSize: 11, color: T.success }}>Available</span>
  return <BookingTile booking={cell.booking} displayCount={displayCount} money={money} />
}

/* A week or a month: how many windows were booked at all, and — of those —
   how many carried each upsell layer, so the same "read monetisation at a
   glance" the daily tile gives shows up in the rolled-up views too. The
   default layer is omitted here since it is on every booking and so adds
   nothing the "N of M booked" line doesn't already say. */
function GroupedCell({ cells, money }: { cells: Cell[]; money: (n: number) => string }) {
  const booked = cells.filter((c) => c.booking)
  const sellable = cells.filter((c) => c.status !== 'unavailable' && !c.booking).length
  const names = [...new Set(booked.map((c) => c.booking!.advertiserName))]
  const revenue = booked.reduce((n, c) => n + c.booking!.bookedRevenue, 0)
  const tip = booked.length ? `${names.join(', ')} · ${money(revenue)}` : 'Nothing booked in this period.'
  const upsells = (['localised', 'personalised'] as const).map((k) => ({ k, n: booked.filter((c) => c.booking!.layers[k]).length })).filter((u) => u.n > 0)
  return (
    <Tooltip title={tip}>
      <div className="flex w-full min-w-0 flex-col gap-0.5">
        <span className="truncate" style={{ fontSize: 11, fontWeight: booked.length ? 500 : 400, color: booked.length ? BOOKED.colour : T.muted }}>
          {booked.length ? `${booked.length} of ${cells.length} booked` : `${sellable} open`}
        </span>
        {upsells.map(({ k, n }) => (
          <div key={k} className="flex items-center gap-1">
            <LayerTag layerKey={k} />
            <span style={{ fontSize: 10, color: T.micro }}>{n} of {booked.length}</span>
          </div>
        ))}
      </div>
    </Tooltip>
  )
}

function WindowCell({ value, context, data }: ICellRendererParams<Row, Group, Ctx>) {
  if (!value?.cells.length) return null
  const { money, view } = context.current
  return (
    <div className="flex w-full min-w-0 flex-col justify-center gap-0.5 py-1">
      {view === 'Daily'
        ? <DailyCell cell={value.cells[0]} displayCount={data?.position.displayCount} money={money} />
        : <GroupedCell cells={value.cells} money={money} />}
    </div>
  )
}

const NumberCell = ({ value, data, context, colDef }: ICellRendererParams<RevenueRow, number, Ctx>) => (
  <span style={{ fontWeight: data?.total ? 600 : 400 }}>{colDef?.field === 'bookedWindows' ? value : context.current.money(value ?? 0)}</span>
)

/* Booked ÷ sellable windows for this display type, over the period shown
   (ticket "booking revenue table: % of slots sold", 22 Sep) — nothing to
   divide by (a display type with no sellable capacity in range at all)
   shows a dash rather than a misleading 0%. */
const PercentSoldCell = ({ data }: ICellRendererParams<RevenueRow>) => {
  if (!data || !data.sellableWindows) return <span style={{ color: T.muted }}>—</span>
  const pct = Math.round((data.bookedWindows / data.sellableWindows) * 100)
  return <span style={{ fontWeight: data.total ? 600 : 400 }}>{pct}%</span>
}

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
    {
      /* Wider than before (ticket "remove the Displays column … show that
         number of displays in brackets after the display name", 22 Sep):
         the display count moved into this cell, next to the display type
         name, rather than its own pinned column — and the cell now also
         carries the row's own "N of M windows booked" read (see
         `windowSummaryOf`), so it needs the room. */
      headerName: 'Position', width: 260, minWidth: 220, pinned: 'left', cellRenderer: PositionCell, autoHeight: true,
    },
    ...groups.map((g, i): ColDef<Row> => ({
      /* Wider than before three stacked layer pills replaced one single-layer
         cell (ticket, 21 Sep) — each pill needs room for its FB/LOC/PERS
         label plus its status text. */
      headerName: g.label, colId: g.key, width: view === 'Daily' ? 182 : 186, suppressSizeToFit: true,
      valueGetter: (p) => p.data?.groups[i], cellRenderer: WindowCell, cellStyle: { alignItems: 'center' },
    })),
  ], [groups, view, dsps, advertiserOptions, partnerId, advertiserId])
  /* The header's own "N play windows" line gets the same booked/available
     read every row already carries (ticket "Also for the play windows …
     anytime you use the word Windows please show a representation of how
     many are booked versus … localised … personalised …", 22 Sep) — summed
     across every position on screen, reusing `windowSummaryOf` so the two
     never disagree. */
  const windowsSummary = useMemo(() => {
    if (!data) return null
    let booked = 0
    let total = 0
    let localised = 0
    let personalised = 0
    for (const p of data.positions) {
      const s = windowSummaryOf(p)
      booked += s.booked
      total += s.total
      localised += s.upsells.find((u) => u.k === 'localised')?.n ?? 0
      personalised += s.upsells.find((u) => u.k === 'personalised')?.n ?? 0
    }
    return { booked, total, localised, personalised }
  }, [data])
  const revenueColumns = useMemo<ColDef<RevenueRow>[]>(() => [
    { headerName: 'Display type', field: 'displayTypeName', width: 260, cellStyle: (p) => (p.data?.total ? { fontWeight: 600 } : null) },
    { headerName: 'Booked windows', field: 'bookedWindows', width: 150, cellRenderer: NumberCell },
    {
      /* Ticket "% of slots sold", 22 Sep — booked ÷ sellable windows for
         this display type, over the period shown. */
      headerName: '% sold', field: 'sellableWindows', width: 110, cellRenderer: PercentSoldCell,
    },
    {
      /* Renamed from "Booked revenue" (ticket, 22 Sep) — "estimated" is more
         honest about what this is before a window has actually played:
         booked CPM × assumed views, not confirmed spend. "Billed revenue"
         is dropped from this table on the same ticket — invoicing what
         actually played is the DSP's own concern, not this schedule's. */
      headerName: 'Estimated revenue', field: 'bookedRevenue', width: 170, cellRenderer: NumberCell,
    },
  ], [])
  const ctx: Ctx['current'] = { money, view }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Icon name="calendar_month" size={26} style={{ color: T.primary, marginTop: 2 }} />
        <div className="min-w-[220px] flex-1">
          <h2 className="m-0" style={{ fontSize: 16, fontWeight: 600 }}><WithTip tip={BOOKING_SCHEDULE_TIP}>Booking schedule</WithTip></h2>
          <div className="mt-1" style={{ fontSize: 12, color: T.muted }}>
            {data && windowsSummary
              ? `${data.windows.length} play windows${windowsSummary.total
                ? ` · ${windowsSummary.booked} of ${windowsSummary.total} booked (${windowsSummary.localised} localised, ${windowsSummary.personalised} personalised)`
                : ''} · ${from} to ${to} · times in UTC`
              : 'Loading…'}
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

      {schedule.isError && <Alert className="mb-4" type="error" showIcon message="The booking schedule couldn’t be loaded." />}
      {!data ? <Spin /> : (
        <>
          {/* No "Schedule" section header here (ticket, 21 Sep) — the page's own
              "Booking schedule" title above already covers it; a second header
              immediately above the table was redundant. */}
          {data.positions.length > 0 && (
            <div className="mb-2 flex flex-wrap items-center gap-3" style={{ fontSize: 11, color: T.muted }}>
              <span>One tile per booking, stacking whichever layers it carries — default is always there, top to bottom:</span>
              {LAYERS_TOP_DOWN.map((layer) => (
                <Tooltip key={layer} title={LAYER_TIP[layer]}>
                  <span className="flex items-center gap-1">
                    <span style={{ fontWeight: 700, color: T.micro }}>{LAYER_ABBR[layer]}</span> {layer.charAt(0).toUpperCase() + layer.slice(1)}
                  </span>
                </Tooltip>
              ))}
            </div>
          )}
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
              rowHeight={92}
              headerHeight={40}
              floatingFiltersHeight={40}
              suppressHorizontalScroll={false}
              stickyHeader
            />
          )}

          <SectionLabel><WithTip tip="Per display type, over the play windows shown. % sold = booked ÷ sellable windows. Estimated revenue = booked CPM × assumed views ÷ 1000 — what billing eventually charges, once a window has actually played, may differ.">Booking revenue</WithTip></SectionLabel>
          <Grid<RevenueRow>
            label="Booking revenue"
            rows={data.revenue}
            columns={revenueColumns}
            context={ctx}
            getRowId={(r) => r.displayTypeId}
            defaultColDef={{ sortable: false, wrapHeaderText: true, autoHeaderHeight: true }}
            pinnedBottomRowData={[{ displayTypeId: 'total', displayTypeName: 'Total', ...data.totals, total: true }]}
          />

          <SectionLabel><WithTip tip="What is selling: default and localised campaigns pay the floor, personalised and interactive pay their multipliers on top.">By campaign type</WithTip></SectionLabel>
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
