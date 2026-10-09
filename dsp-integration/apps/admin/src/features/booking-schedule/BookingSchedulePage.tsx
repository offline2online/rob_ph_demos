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
   reach counts". Localised shows a pill with no count (the reach-count
   API left this build's scope on 30 Sep); personalised shows no count
   either — a match can't be predicted ahead of time — but shows which trigger mechanism(s) its
   targeting rules use (ticket "Booking schedule: personalised trigger
   icons"), from broadest/most-frequent to narrowest/rarest: computer
   vision, aggregate store-level, individual. */
import { useQuery } from '@tanstack/react-query'
import { Alert, DatePicker, Segmented, Spin } from 'antd'
import { Tip } from '../../shared/Tip'
import type { ColDef, ICellRendererParams } from 'ag-grid-community'
import { SLOT_OWNERS, type BookingCapacity, type BookingSchedule as Schedule } from '@ph-dsp/types'
import dayjs, { type Dayjs } from 'dayjs'
import { Fragment, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api } from '../../api/client'
import { Grid } from '../../shared/Grid'
import { Icon } from '../../shared/Icon'
import { WithTip } from '../../shared/InfoTip'
import { SectionLabel } from '../../shared/SectionLabel'
import { externalSetColumn } from '../../shared/TableFilters'
import { T } from '../../theme/phTheme'
/* The hosted build's read-only snapshot (see src/demo/staticApi.ts). */
import { isSnapshotDemo } from '../../demo/mode'

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
/* Trigger-icon ladder, broadest/most-frequent to narrowest/rarest (ticket
   "Booking schedule: personalised trigger icons", 22 Sep): which icons are
   lit tells the viewer the expected activation frequency, and therefore how
   often a personalised version will actually play. */
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
  /* A real-time position has no forward windows to count (ticket
     vhRFN1K3N4Giw1Z0OEI6, 8 Oct 2026): only a booking made before it went
     real-time counts, and then against itself. */
  return { booked: booked.length, total: position.realTime ? booked.length : position.windows.length, upsells }
}

function PositionCell({ data }: ICellRendererParams<Row>) {
  if (!data) return null
  const { booked, total, upsells } = windowSummaryOf(data.position)
  return (
    <div className="min-w-0 py-1.5">
      <div className="truncate">
        {data.position.displayTypeName} <span style={{ color: T.micro }}>({data.position.displayCount})</span>
      </div>
      {/* Multi-zone: numbered within the zone, as Available Inventory does (A0GyTNsA, 1 Oct 2026). */}
      <div className="truncate" style={{ fontSize: 11, color: T.micro }}>
        {data.position.zoneName ? `${data.position.zoneName} / Slot ${data.position.zoneSlot}` : `Slot ${data.position.slot}`} · {data.position.slotLabel}
      </div>
      <div className="flex flex-wrap items-center gap-x-1.5" style={{ fontSize: 10.5, color: T.muted }}>
        {data.position.realTime
          ? <span>Real time · sold per impression · {data.position.recentPlays ?? 0} play{data.position.recentPlays === 1 ? '' : 's'} in the last 7 days</span>
          : <span>{booked} of {total} windows booked</span>}
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
function LayerRow({ layerKey, booking }: { layerKey: LayerKey; booking: Booking }) {
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
    return (
      <div className="flex items-center gap-1 w-full min-w-0">
        <LayerTag layerKey="localised" />
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
function layerLine(k: LayerKey, booking: Booking): string {
  if (k === 'personalised') {
    const lit = TRIGGER_ORDER.filter((t) => booking.personalisedTriggers?.[t])
    return `PERS: one-to-one for the identified visitor, no predictable reach${lit.length ? ` — via ${lit.map((t) => TRIGGER_META[t].label).join(', ')}` : ''}`
  }
  if (k === 'localised') {
    return 'LOC: store-level targeting'
  }
  return 'DEFAULT: the mandatory, untargeted layer, present on every booking'
}

/* A single day's booked window: one tile, the advertiser name as the unit
   at the top, stacking only the layers this one purchase provides — so the
   tile visibly expands and contracts with how successful the upsell has
   been with that advertiser (ticket "Booking schedule: single-advertiser
   stacking tile"). */
function BookingTile({ booking, money }: { booking: Booking; money: (n: number) => string }) {
  const present = LAYERS_TOP_DOWN.filter((k) => booking.layers[k])
  const layersTip = present.map((k) => layerLine(k, booking)).join(' · ')
  const tip = `${booking.advertiserName} via ${booking.partnerName} · ${booking.type === 'reserve' ? 'Reserved' : 'Won at auction'} at ${booking.cpm} CPM · ${booking.assumedViews.toLocaleString('en-GB')} assumed views · booked ${money(booking.bookedRevenue)} · ${layersTip}`
  return (
    <Tip title={tip}>
      <div className="flex w-full min-w-0 flex-col gap-0.5 rounded px-1 py-0.5" style={{ background: BOOKED.bg, borderLeft: `3px solid ${BOOKED.colour}` }}>
        <div className="flex items-center gap-1 w-full min-w-0">
          <Icon name={booking.type === 'reserve' ? 'bookmark' : 'gavel'} size={12} />
          <span className="truncate" style={{ fontSize: 11, fontWeight: 600, color: BOOKED.colour }}>{booking.advertiserName}</span>
        </div>
        {present.map((k) => <LayerRow key={k} layerKey={k} booking={booking} />)}
      </div>
    </Tip>
  )
}

/* A single day: the one tile this window can have (one advertiser per
   slot), Available, or unavailable — no per-layer competition any more
   (ticket "Booking schedule: single-advertiser stacking tile" retires the
   earlier "Sold — other layer" model along with the fallback-optional,
   part-sold submission it depended on). */
function DailyCell({ cell, money }: { cell: Cell; money: (n: number) => string }) {
  if (cell.status === 'unavailable') return <span style={{ fontSize: 11, color: T.micro }}>—</span>
  if (!cell.booking) return <span style={{ fontSize: 11, color: T.success }}>Available</span>
  return <BookingTile booking={cell.booking} money={money} />
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
    <Tip title={tip}>
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
    </Tip>
  )
}

function WindowCell({ value, context, data }: ICellRendererParams<Row, Group, Ctx>) {
  if (!value?.cells.length) return null
  /* Real-time inventory is sold per impression: no booked / available grid. */
  if (data?.position.realTime && !value.cells.some((c) => c.booking)) return <span style={{ fontSize: 11, color: T.micro }}>—</span>
  const { money, view } = context.current
  return (
    <div className="flex w-full min-w-0 flex-col justify-center gap-0.5 py-1">
      {view === 'Daily'
        ? <DailyCell cell={value.cells[0]} money={money} />
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

/* Plays per day (decision Rob 9 Oct 2026): the day is how a retailer reads a
   booking, but the window is what clears, so each figure is the plays of every
   window in the stores' trading hours rolled up to the day. Pre-booked deals
   are netted off firmly; the rest is only "available to bid" (indicative, the
   auction decides). A segment cut is its own screens x plays, and cuts overlap
   on screens, so they are never added to each other or to the estate figure. */
const PLAYS_TIP = 'Plays per day = the plays of every billing-unit window running in the stores’ trading hours that day (not a flat 24h ÷ billing unit). Pre-booked = plays committed by deals, netted off firmly. Available to bid = the rest, indicative: the auction decides. Segment cuts overlap on screens, so they do not add up to the total.'
const plays = (n: number) => n.toLocaleString('en-GB')

function PlaysPerDay({ data }: { data: BookingCapacity }) {
  const [open, setOpen] = useState<Set<string>>(new Set())
  const toggle = (id: string) => setOpen((o) => { const n = new Set(o); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const head = { fontSize: 11, fontWeight: 600, color: T.micro, textAlign: 'left' as const, padding: '6px 8px', borderBottom: `1px solid ${T.borderSubtle}`, whiteSpace: 'nowrap' as const }
  const cell = { fontSize: 11.5, padding: '6px 8px', borderBottom: `1px solid ${T.borderSubtle}`, verticalAlign: 'top' as const, whiteSpace: 'nowrap' as const }
  /* An answer without the capacity shape (an API from before this table, or the
     offline snapshot) reads as "nothing to show", never a crash of the whole page. */
  if (!Array.isArray(data.positions) || !Array.isArray(data.days) || data.positions.length === 0) return <div style={{ fontSize: 12.5, color: T.muted }}>No advertiser positions yet.</div>
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ borderCollapse: 'collapse', width: '100%' }} aria-label="Plays per day">
        <thead>
          <tr>
            <th style={head}>Position</th>
            {data.days.map((d) => <th key={d} style={head}>{fmt(new Date(d), { weekday: 'short', day: 'numeric', month: 'short' })}</th>)}
          </tr>
        </thead>
        <tbody>
          {data.positions.map((p) => {
            const isOpen = open.has(p.positionId)
            const cuts = p.days?.[0]?.segments?.map((x) => x.segment) ?? []
            return (
              <Fragment key={p.positionId}>
                <tr>
                  <td style={cell}>
                    <button type="button" className="inline-flex items-center gap-1" style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer', font: 'inherit' }}
                      aria-expanded={isOpen} onClick={() => toggle(p.positionId)}>
                      <Icon name={isOpen ? 'expand_less' : 'expand_more'} size={16} />
                      <span>{p.displayTypeName}</span>
                    </button>
                    <div style={{ fontSize: 10.5, color: T.muted, paddingLeft: 18 }}>
                      Slot {p.slot} · {p.screens} screens · {p.windowHours}h window{p.realtime ? ' · real time' : ''}
                    </div>
                  </td>
                  {p.days.map((d) => (
                    <td key={d.date} style={cell}>
                      <div style={{ fontWeight: 600 }}>{plays(d.totalPlays)} plays</div>
                      <div style={{ color: BOOKED.colour }}>{plays(d.firmPlays)} pre-booked</div>
                      <div style={{ color: T.success }}>{plays(d.availableToBid)} available to bid</div>
                    </td>
                  ))}
                </tr>
                {isOpen && (
                  <tr>
                    <td style={{ ...cell, color: T.muted }}>
                      {cuts.length ? 'Available to bid within each cut (cuts overlap, not additive)' : 'No localized segment is targeted yet.'}
                    </td>
                    {p.days.map((d) => (
                      <td key={d.date} style={cell}>
                        {d.deals.map((x) => <div key={x.reservationId} style={{ color: BOOKED.colour }}>{x.advertiserName}: {plays(x.plays)} plays</div>)}
                        {d.segments.map((x) => (
                          <div key={x.segment}>
                            <b>{x.segment}</b> · {x.screens} screens · {plays(x.totalPlays)} plays
                            <div style={{ color: T.muted }}>{plays(x.firmPlays)} pre-booked · {plays(x.availableToBid)} available to bid within this cut</div>
                          </div>
                        ))}
                      </td>
                    ))}
                  </tr>
                )}
              </Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
  )
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
  /* Plays per day reads the first fortnight of the range: a column per day. */
  const capacityTo = dayjs(from).add(13, 'day').isBefore(dayjs(to)) ? dayjs(from).add(13, 'day').format('YYYY-MM-DD') : to
  const capacity = useQuery({ queryKey: ['booking-capacity', from, capacityTo], queryFn: () => api<BookingCapacity>('GET', `/admin/v1/booking-schedule/capacity?from=${from}&to=${capacityTo}`) })
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
                : ''}`
              : 'Loading…'}
          </div>
        </div>
        <Segmented<View> value={view} onChange={(v) => { setView(v); setRange(null) }} options={['Daily', 'Weekly', 'Monthly']} />
        {/* The hosted demo holds a snapshot per view, not per arbitrary range,
            so it fixes the dates rather than showing a range it doesn't have. */}
        <Tip title={isSnapshotDemo() ? 'Fixed in the hosted demo: its data is a snapshot. Run the POC locally to pick a range.' : ''}>
          <DatePicker.RangePicker aria-label="Dates" value={[dayjs(from), dayjs(to)]} allowClear={false} disabled={isSnapshotDemo()}
            onChange={(v) => setRange(v && v[0] && v[1] ? [v[0], v[1]] : null)} />
        </Tip>
      </div>

      {schedule.isError && <Alert className="mb-4" type="error" showIcon message="The booking schedule couldn’t be loaded." />}
      {!data ? <Spin /> : (
        <>
          {/* No "Schedule" section header here (ticket, 21 Sep) — the page's own
              "Booking schedule" title above already covers it; a second header
              immediately above the table was redundant. The "one tile per
              booking …" layer-legend line that used to sit here was removed
              (ticket, 27 Sep 2026) so the table sits directly under the
              header's play-windows summary — each layer is still labelled on
              its own tile (LayerRow/LayerTag) and explained in the tile's
              hover tooltip (layerLine), so nothing here was the only place
              that information lived. */}
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

          <SectionLabel><WithTip tip={PLAYS_TIP}>Plays per day</WithTip></SectionLabel>
          {capacity.isError && <Alert className="mb-4" type="error" showIcon message="Plays per day couldn’t be loaded." />}
          {capacity.data ? <PlaysPerDay data={capacity.data} /> : !capacity.isError && <Spin />}

          <SectionLabel><WithTip tip="Per display type, over the play windows shown. % sold = booked ÷ sellable windows of booked-ahead (deal and reserved) positions only; positions sold in real time, per play, are left out, and a display type with only those shows a dash. Estimated revenue = booked CPM × assumed views ÷ 1000 — what billing eventually charges, once a window has actually played, may differ.">Booking revenue</WithTip></SectionLabel>
          <Grid<RevenueRow>
            label="Booking revenue"
            rows={data.revenue}
            columns={revenueColumns}
            context={ctx}
            getRowId={(r) => r.displayTypeId}
            defaultColDef={{ sortable: false, wrapHeaderText: true, autoHeaderHeight: true }}
            pinnedBottomRowData={[{ displayTypeId: 'total', displayTypeName: 'Total', ...data.totals, total: true }]}
          />

          <SectionLabel><WithTip tip="What is selling: every campaign clears the floor and bills at its committed CPM whatever version plays.">By campaign type</WithTip></SectionLabel>
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
