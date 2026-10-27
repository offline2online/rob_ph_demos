/* Booking schedule (Rob, 19 Sep; reached from Available Inventory): every
   advertiser-owned slot across its play windows — booked, available or
   unavailable — with the booking revenue per display type. Live bookings
   only: a Test-mode win is never real revenue.

   Each booking is one advertiser's single purchase, stacking whichever of
   the three layers it actually carries (ticket "Booking schedule:
   single-advertiser stacking tile", 22 Sep, superseding the earlier
   same-day "layered reach breakdown" design where all three layers'
   pills were always shown and competed for one window's single-layer
   capacity — that model is retired along with the fallback-optional
   submission it depended on): default (mandatory since the same-day
   "Make default creative mandatory" ticket, so always present),
   localised (a pill with no count: the reach-count API left this
   build's scope on 30 Sep and the part-sold model it served was retired
   on 22 Sep, so the position's plain displayCount is the only sizing)
   and personalised (no count — matching can't be predicted ahead of
   time — but a breakdown of which trigger mechanism(s) its rules use,
   ticket "Booking schedule: personalised trigger icons"). */
import type { BookingSchedule } from '@ph-dsp/types'
import { TARGETING_VARIABLES, PLATFORM_DEFAULT_BILLING_UNIT_HOURS, assignedOf } from '@ph-dsp/types'
import type { FastifyPluginAsync } from 'fastify'
import type { Context } from '../../context'
import type { Guards } from '../../http/app'
import { validationFailed } from '../../http/errors'
import { audienceOf } from '../../domain/displayTypes'
import { allPositions, assignmentOf, assumedViewsFor, effectivePartnerIds, isRealtime, nextWindow, shortestWindowMs, windowMs, windowStartOf, windowsBetween } from '../../domain/positions'
import type { StoredTargeting } from '../../domain/targetingSummary'
import { TAKEN, type ReservationRecord } from '../../repos/ReservationRepo'
import { TRANSACTING_CURRENCY } from '../../domain/currency'
import { isActiveAt } from '../../billing/term'
import { baseFloorFor } from '../../exchange/enforcement'
import { plannedDirectBookings } from '../../exchange/directDeal'
import { zonePlaceOf } from '../../domain/displayTypes'
import { playbackWindowLabel } from '../../domain/dailyCapacity'
import { DIRECT_PARTNER_ID, advertiserSlug, directLabel } from '@ph-dsp/types'

/* What a Direct advertiser deal's booking reads as in the DSP column: it has no DSP (ticket EipHu2GUdlbZMpPGCTjF). */
const DIRECT_LABEL = 'Direct'
const DAY = 86_400_000
const HOUR = 3_600_000
/* How far back a real-time position's plays are counted (ticket vhRFN1K3N4Giw1Z0OEI6, 8 Oct 2026). */
export const RECENT_PLAYS_DAYS = 7
/* A flight starting within this many days with its default still unapproved is at risk (ticket S5PZyZ3MFr45LTM0zfAK, 22 Oct 2026). */
export const DEFAULT_RISK_DAYS = 3
const round2 = (n: number) => Math.round(n * 100) / 100

export interface ScheduleFilter { campaignId?: string; advertiserId?: string; partnerId?: string }

type Booking = NonNullable<BookingSchedule['positions'][number]['windows'][number]['booking']>
type Layers = Booking['layers']
type Triggers = Booking['personalisedTriggers']
type Approval = NonNullable<Booking['approval']>
type TargetedVersion = NonNullable<StoredTargeting['targeted']>[number]

const targetedOf = async (ctx: Context, campaignId: string | null): Promise<TargetedVersion[]> =>
  ((await ctx.campaigns.getCampaign(campaignId ?? ''))?.targeting as StoredTargeting | null)?.targeted ?? []

/* Which of the three layers this booking's campaign actually carries:
   whichever layer is currently won/reserved for this window, plus any
   other targeted version the campaign submitted — the advertiser's whole
   purchase, not just the one layer playing right now. Interactive counts
   as localised for this breakdown (same grouping the schedule has always
   used: it varies by store, not by visitor). */
function layersOf(targeted: TargetedVersion[], activePricingType: string | null): Layers {
  const has = (t: string) => activePricingType === t || targeted.some((v) => v.pricingType === t)
  return { default: true, localised: has('localised') || has('interactive'), personalised: has('personalised') }
}

/* Trigger icons for the personalised layer (ticket "Booking schedule:
   personalised trigger icons", 22 Sep): from broadest/most-frequent to
   narrowest/rarest — computer vision (any `store.cv_*` variable, fires on
   almost anyone in front of the screen), aggregate store-level (any other
   `source: 'store'` personalisation variable — the aggregate of who is in
   the store) and individual (any `source: 'visitor'` variable — the
   customer is identified/checked in). More than one may be lit when the
   rules combine tiers. null when there is no personalised layer at all;
   all false when there is one but its rules don't classify (an older or
   hand-built record with no real targeting rules). */
function triggersOf(targeted: TargetedVersion[], hasPersonalised: boolean): Triggers {
  if (!hasPersonalised) return null
  const conditions = targeted.filter((v) => v.pricingType === 'personalised').flatMap((v) => v.rules.flat())
  const triggers = { computerVision: false, aggregateStore: false, individual: false }
  for (const c of conditions) {
    const def = TARGETING_VARIABLES.find((v) => v.key === c.variable)
    if (!def || def.group !== 'personalisation') continue
    if (def.key.startsWith('store.cv_')) triggers.computerVision = true
    else if (def.source === 'store') triggers.aggregateStore = true
    else triggers.individual = true
  }
  return triggers
}

/* The tile's approval state (ticket S5PZyZ3MFr45LTM0zfAK, 22 Oct 2026). The default creative guarantees the slot is
   filled: approved is secured; otherwise it is at risk (red) when this tile's own window starts within
   DEFAULT_RISK_DAYS of now, else a warning (orange). The counters are approved of submitted among the advertiser's
   campaigns booked on this position, split by each campaign's own type; there is no per-version approval. */
export function approvalOf(defaultApproved: boolean, startsInDays: number, localised: Approval['localised'], personalised: Approval['personalised']): Approval {
  return { defaultApproved, defaultRisk: defaultApproved ? 'secured' : startsInDays <= DEFAULT_RISK_DAYS ? 'at_risk' : 'warning', startsInDays, localised, personalised }
}

/* The Monthly view's server roll-up (ticket Hh87Dja2TgYrug606Uq0, 26 Oct 2026): a year is far too many cells to build one by one (the 92-day view
   already costs about 23 s at the largest bench shape), so a Monthly request gets one rollup cell per position and calendar month, counted from the
   same live bookings and window lengths as the per-window path, and no per-window cells at all. */
export interface ScheduleOptions { monthly?: boolean }
/* Calendar months are the Monthly view's columns; the longest range it serves. */
export const MONTHLY_MAX_DAYS = 365
export const MAX_DAYS = 92

export async function bookingSchedule(ctx: Context, starts: Date[], f: ScheduleFilter = {}, opts: ScheduleOptions = {}): Promise<BookingSchedule> {
  const monthly = !!opts.monthly
  const len = await shortestWindowMs(ctx)
  /* A column's span: the finest window in the estate (each position's own window can be longer, `len` below). */
  const columnMs = len
  const partners = await ctx.partners.list()
  /* Advertiser names come from the DSPs' seats, keyed by their slug. */
  const direct = await ctx.company.directAdvertisers()
  const advertiserName = new Map([...direct.map((d) => [d.advertiserId, directLabel(d.name)] as const), ...partners.flatMap((p) => p.seats.map((s) => [advertiserSlug(s.name), s.name] as const))])
  const partnerName = new Map(partners.map((x) => [x.id, x.name] as const))
  const revenue = new Map<string, BookingSchedule['revenue'][number]>()
  const byType = new Map<string, BookingSchedule['byPricingType'][number]>()

  /* Every live sale shown, read in ONE ranged query and indexed by position
     and window (review, 3 Oct 2026): the schedule used to ask for each
     position's every column twice — 2,408 positions × 14 columns was
     67,000 queries a page — and read every line item ever written to find
     the few it shows. There is at most one live (non-test) won/reserved
     row per position and window (migration 0021), so the index holds
     exactly the row each cell needs. */
  const estate = await allPositions(ctx)
  const lenOf = new Map<string, number>()
  for (const p of estate) lenOf.set(p.positionId, await windowMs(ctx, p))
  const lens = new Set(lenOf.values())
  const from = Math.min(...[...lens].map((l) => windowStartOf(starts[0], l).getTime()))
  const to = starts[starts.length - 1].getTime() + 1
  const live = new Map<string, ReservationRecord>()
  for (const r of await ctx.reservations.byStatus(TAKEN, new Date(from).toISOString(), new Date(to).toISOString())) {
    if (!r.testMode && r.clearingCpm !== null) live.set(`${r.positionId}|${r.windowStart}`, r)
  }
  /* A finalised Direct advertiser deal holds every window of its flight, booked by the exchange only a window ahead: the rest read as its booking too (ticket TWJmiwQpPu9Y4tAUjncC). */
  for (const r of await plannedDirectBookings(ctx, estate, (p) => lenOf.get(p.positionId) as number, from, to, new Set(live.keys()))) live.set(`${r.positionId}|${r.windowStart}`, r)
  /* The campaigns each advertiser has live on each position in this range, for the tile's approval counters. */
  const campaignsOn = new Map<string, Set<string>>()
  for (const r of live.values()) {
    if (!r.advertiserId || !r.campaignId) continue
    const k = `${r.positionId}|${r.advertiserId}`
    campaignsOn.set(k, (campaignsOn.get(k) ?? new Set()).add(r.campaignId))
  }
  /* Approval is per campaign: its status and its type (localised / personalised) are read once each per request. */
  let statuses: ReturnType<typeof ctx.approvals.statuses> | undefined
  const isApproved = async (campaignId: string) => {
    if (!campaignId) return false
    statuses ??= ctx.approvals.statuses()
    return (await statuses).get(campaignId) === 'approved'
  }
  /* The counters are the same for every tile of one position and advertiser, so they are worked out once per request. */
  const typeMemo = new Map<string, Promise<string | null | undefined>>()
  const typeOf = (campaignId: string) => {
    let t = typeMemo.get(campaignId)
    if (!t) typeMemo.set(campaignId, (t = Promise.resolve(ctx.campaigns.getCampaign(campaignId)).then((c) => c?.pricingType)))
    return t
  }
  const countsMemo = new Map<string, Promise<{ localised: { approved: number; submitted: number }; personalised: { approved: number; submitted: number } }>>()
  const countsFor = (key: string) => {
    let c = countsMemo.get(key)
    if (!c) countsMemo.set(key, (c = (async () => {
      const counts = { localised: { approved: 0, submitted: 0 }, personalised: { approved: 0, submitted: 0 } }
      for (const id of campaignsOn.get(key) ?? []) {
        const t = await typeOf(id)
        const k = t === 'personalised' ? 'personalised' : t === 'localised' || t === 'interactive' ? 'localised' : null
        if (!k) continue
        counts[k].submitted++
        if (await isApproved(id)) counts[k].approved++
      }
      return counts
    })()))
    return c
  }
  const billed = await ctx.billing.amountsFor([...live.values()].map((r) => r.id))
  /* Per request, not per cell: a campaign's targeting and a window length's
     first sellable window are the same for every cell that asks. */
  const targetedMemo = new Map<string, Promise<TargetedVersion[]>>()
  const targetedFor = (campaignId: string | null) => {
    let t = targetedMemo.get(campaignId ?? '')
    if (!t) targetedMemo.set(campaignId ?? '', (t = targetedOf(ctx, campaignId)))
    return t
  }
  /* A buyers list is the same for every position that names it: read once per request. */
  const buyersListMemo = new Map<string, ReturnType<Context['buyersLists']['get']>>()
  const buyersList = (id: string) => {
    let l = buyersListMemo.get(id)
    if (!l) buyersListMemo.set(id, (l = ctx.buyersLists.get(id)))
    return l
  }
  const firstSellableMemo = new Map<number, number>()
  /* Real-time (open / whitelist-only) positions are sold per impression and
     never booked ahead (ticket vhRFN1K3N4Giw1Z0OEI6, 8 Oct 2026): instead of
     a forward grid they report the live plays proved in the last week, read
     in one grouped query. */
  const recentPlays = await ctx.impressions.playedCountsSince(new Date(ctx.clock().getTime() - RECENT_PLAYS_DAYS * DAY).toISOString())
  /* Expected fill (ticket bhiyhqKpLPBDlySEfGNB): the last week's real-time opportunities and how many were filled, per position. Like the
     plays above it is history, not a forecast per window, so it is the same in every view. The advertiser / DSP / campaign filter narrows
     the fills to that buyer's share of the same opportunities. */
  const fills = await ctx.impressions.fillCountsSince(new Date(ctx.clock().getTime() - RECENT_PLAYS_DAYS * DAY).toISOString(), { advertiserId: f.advertiserId, partnerId: f.partnerId, campaignId: f.campaignId })

  /* Assumed views (VAC-d) per column (ticket eNlz3fJab4Ehqg9hbf4C, 26 Oct 2026): the display-derived figure is the same for every slot of a
     display type with no score of its own (slot 0 never has one), so it is read once per type and column, from the hour-of-week profiles
     (else the type's default VAC-d). A slot with its own audience score stays flat, scaled to the column's length. */
  const derivedMemo = new Map<string, Promise<number>>()
  const derivedViews = (p: (typeof estate)[number], column: Date) => {
    const k = `${p.displayType.id}|${column.getTime()}`
    let v = derivedMemo.get(k)
    if (!v) derivedMemo.set(k, (v = Promise.resolve(audienceOf(ctx.audience, p.displayType, 0, { startMs: column.getTime(), endMs: column.getTime() + columnMs })).then((a) => a.assumedViewsPerWindow)))
    return v
  }
  const flatMemo = new Map<string, Promise<number>>()
  const flatDerived = (p: (typeof estate)[number]) => {
    let v = flatMemo.get(p.displayType.id)
    if (!v) flatMemo.set(p.displayType.id, (v = Promise.resolve(audienceOf(ctx.audience, p.displayType, 0)).then((a) => a.assumedViewsPerWindow)))
    return v
  }

  /* Monthly: the column index of each month, and the live bookings by position then window start. */
  const colMs = starts.map((s) => s.getTime())
  const monthOf = (ms: number) => { const d = new Date(ms); return d.getUTCFullYear() * 12 + d.getUTCMonth() }
  const months: { key: number; start: Date; end: Date }[] = []
  const colMonth: number[] = []
  if (monthly) {
    for (const ms of colMs) {
      const key = monthOf(ms)
      if (months[months.length - 1]?.key !== key) months.push({ key, start: months.length ? new Date(Date.UTC(Math.floor(key / 12), key % 12, 1)) : new Date(ms), end: new Date(Date.UTC(Math.floor(key / 12), (key % 12) + 1, 1)) })
      colMonth.push(months.length - 1)
    }
  }
  const liveByPosition = new Map<string, Map<number, ReservationRecord>>()
  if (monthly) {
    for (const r of live.values()) {
      let m = liveByPosition.get(r.positionId)
      if (!m) liveByPosition.set(r.positionId, (m = new Map()))
      m.set(Date.parse(r.windowStart), r)
    }
  }
  /* A display type's derived views for every column, read once per type (not once per position and column). */
  const derivedRowMemo = new Map<string, Promise<number[]>>()
  const derivedRow = (p: (typeof estate)[number]) => {
    let v = derivedRowMemo.get(p.displayType.id)
    if (!v) derivedRowMemo.set(p.displayType.id, (v = Promise.all(starts.map((c) => derivedViews(p, c)))))
    return v
  }

  /* Only advertisers with something booked in this range are worth filtering
     by (Rob, 20 Sep), so the picker is built before any filter is applied. */
  const booked = new Set<string>()
  if (monthly) for (const r of live.values()) { if (r.advertiserId) booked.add(r.advertiserId) }
  else for (const p of estate) {
    const own = lenOf.get(p.positionId) as number
    for (const start of new Set(starts.map((s) => windowStartOf(s, own).toISOString()))) {
      const r = live.get(`${p.positionId}|${start}`)
      if (r?.advertiserId) booked.add(r.advertiserId)
    }
  }

  const positions = []
  /* A display type's display count is the same for each of its positions: read once per type. */
  const displayCountMemo = new Map<string, number>()
  for (const p of estate) {
    let displayCountOfType = displayCountMemo.get(p.displayType.id)
    if (displayCountOfType === undefined) displayCountMemo.set(p.displayType.id, (displayCountOfType = (await ctx.displays.summaryByDisplayType(p.displayType.id)).displays))
    const displayCount = displayCountOfType
    const hasDisplays = displayCount > 0
    /* The slot's own score is read once: both its figure for this position's window and its flat figure below come from it. */
    const ownFlat = (await Promise.resolve(audienceOf(ctx.audience, p.displayType, p.slot))).assumedViewsPerWindow
    const views = assumedViewsFor(ownFlat, p)
    /* Columns are the finest grid (the shortest window in the estate);
       this position's own window is its billing unit long (OQ27), so a
       column shows the window of its own that the column falls in — a
       weekly slot's booking spans its week's columns — and each of its
       windows counts once towards booked and sellable. */
    const len = lenOf.get(p.positionId) as number
    let firstSellable = firstSellableMemo.get(len)
    if (firstSellable === undefined) firstSellableMemo.set(len, (firstSellable = (await nextWindow(ctx, len)).getTime()))
    const counted = new Set<number>()
    const rev = revenue.get(p.displayType.id) ?? { displayTypeId: p.displayType.id, displayTypeName: p.displayType.name, bookedWindows: 0, sellableWindows: 0, bookedRevenue: 0, billedRevenue: 0, realtimeOpportunities: 0, realtimeFilled: 0, totalViews: 0, bookedViews: 0, availableViews: 0, availableWindows: 0, availableValue: 0 }
    revenue.set(p.displayType.id, rev)
    const realTime = isRealtime(p)
    if (realTime) {
      const h = fills.get(p.positionId)
      const filtered = !!(f.advertiserId || f.partnerId || f.campaignId)
      rev.realtimeOpportunities += h?.opportunities ?? 0
      rev.realtimeFilled += (filtered ? h?.filledFor : h?.filled) ?? 0
    }
    /* The flights of the live Direct advertiser deals on this position: a window in one that the exchange has not booked
       yet is reserved for the deal's advertiser, not available to anyone else (E2E 21 Oct 2026: it read Available). */
    const directFlights = (await Promise.all(assignedOf(p.def).buyersListIds.map(buyersList)))
      .filter((l): l is NonNullable<typeof l> => !!l && l.dealType === 'direct' && l.status === 'shared')
    /* A slot scored on its own (audience_vacd) differs from its type's display-derived flat figure and stays flat. */
    const ownScored = ownFlat !== (await flatDerived(p))
    /* One row of views per display type (read once), then a plain lookup per cell: an await per cell was most of the 92-day cost. */
    const flatColumnViews = Math.round(ownFlat * (columnMs / HOUR / PLATFORM_DEFAULT_BILLING_UNIT_HOURS))
    const derivedRowOf = monthly || ownScored ? null : await derivedRow(p)
    /* Available (ticket Ltlu40NbXod3d8NwFF6Z): what is left to sell, at this position's floor CPM (the base floor it clears at, in the
       exchange currency) x the assumed views of each unbooked column / 1000. */
    const floor = await baseFloorFor(ctx, { position: p }, buyersList)
    const windows: BookingSchedule['positions'][number]['windows'] = []
    for (let ci = 0; ci < (monthly ? 0 : starts.length); ci++) {
      const column = starts[ci]

      const start = windowStartOf(column, len)
      const first = !counted.has(start.getTime())
      counted.add(start.getTime())
      /* Sellable capacity ignores the advertiser/DSP filter (Rob, 22 Sep,
         ticket "% of slots sold"): it's this display type's whole market,
         not just what one advertiser could have bought, so % sold reads
         the same whichever filter is applied. */
      /* Booked-ahead inventory only (ticket 1n6upwMWSLGxszhg5u7k, 8 Oct 2026):
         an open or whitelist-only position is sold per impression and is
         never pre-booked, so counting its windows would read as under-selling.
         A display type with only real-time positions has no sellable windows
         and the table shows a dash. */
      if (first && hasDisplays && !realTime && start.getTime() >= firstSellable) rev.sellableWindows++
      const sellable = first && hasDisplays && !realTime && start.getTime() >= firstSellable
      const x = live.get(`${p.positionId}|${start.toISOString()}`)
      const r = x && (!f.campaignId || x.campaignId === f.campaignId) && (!f.partnerId || x.partnerId === f.partnerId) ? x : undefined
      /* With an advertiser filter the other advertisers' tiles stay on the grid, named, so the page can grey them out
         (ticket zebMTdEEJFkVG5AVGiET); they are left out of every total below, which read the filtered advertiser only. */
      const inFilter = !f.advertiserId || r?.advertiserId === f.advertiserId
      const columnViews = hasDisplays || r ? (derivedRowOf ? derivedRowOf[ci] : flatColumnViews) : 0
      if (r) {
        if (inFilter) { rev.bookedViews += columnViews; rev.totalViews += columnViews }
        const bookedRevenue = round2((views / 1000) * (r.clearingCpm as number))
        const bill = billed.get(r.id) ?? null
        const type = (r.pricingType ?? 'default') as BookingSchedule['byPricingType'][number]['pricingType']
        if (first && inFilter) {
          rev.bookedWindows++
          rev.bookedRevenue = round2(rev.bookedRevenue + bookedRevenue)
          rev.billedRevenue = round2(rev.billedRevenue + (bill ?? 0))
          const t = byType.get(type) ?? { pricingType: type, bookedWindows: 0, bookedRevenue: 0 }
          t.bookedWindows++
          t.bookedRevenue = round2(t.bookedRevenue + bookedRevenue)
          byType.set(type, t)
        }
        /* The campaign's full submission — its own targeted versions,
           regardless of which one this particular window's reservation
           actually won — drives the tile's layers and, when personalised,
           its trigger icons. */
        const targeted = await targetedFor(r.campaignId)
        const layers = layersOf(targeted, r.pricingType)
        const counts = await countsFor(`${r.positionId}|${r.advertiserId}`)
        const approval = approvalOf(await isApproved(r.campaignId ?? ''), round2((start.getTime() - ctx.clock().getTime()) / DAY), counts.localised, counts.personalised)
        windows.push({
          start: column.toISOString(), status: 'booked' as const, assumedViews: columnViews,
          booking: {
            reservationId: r.id, campaignId: r.campaignId ?? '', advertiserId: r.advertiserId, partnerId: r.partnerId,
            pricingType: type, type: r.type, advertiserName: (r.advertiserId && advertiserName.get(r.advertiserId)) || r.advertiserId || '—',
            partnerName: r.partnerId === DIRECT_PARTNER_ID ? DIRECT_LABEL : partnerName.get(r.partnerId) ?? r.partnerId, cpm: r.clearingCpm as number, assumedViews: views, bookedRevenue, billedRevenue: bill,
            layers, personalisedTriggers: triggersOf(targeted, layers.personalised), approval,
          },
        })
        continue
      }
      /* No forward grid for a real-time position: an unbooked column is a
         dash, never "available". (A booking already on one — made before the
         position went real-time — still shows, since it is real revenue.) */
      const open = hasDisplays && !realTime && start.getTime() >= firstSellable
      const reserved = open && directFlights.some((l) => isActiveAt(l, start.toISOString()))
      /* A window held for a Direct deal counts as booked; with an advertiser filter picked it is nobody's in particular, so it is left out. */
      if (reserved && !f.advertiserId) { rev.bookedViews += columnViews; rev.totalViews += columnViews }
      else if (open && !reserved) {
        rev.availableViews += columnViews; rev.totalViews += columnViews
        rev.availableValue = round2(rev.availableValue + (floor / 1000) * columnViews)
        if (sellable) rev.availableWindows++
      }
      windows.push({ start: column.toISOString(), status: reserved ? ('reserved' as const) : open ? ('available' as const) : ('unavailable' as const), assumedViews: open ? columnViews : null, booking: null })
    }
    if (monthly) {
      const mine = liveByPosition.get(p.positionId)
      const row = ownScored ? null : await derivedRow(p)
      const flatColumn = ownScored ? Math.round(ownFlat * (columnMs / HOUR / PLATFORM_DEFAULT_BILLING_UNIT_HOURS)) : 0
      const cells = months.map(() => ({ windows: 0, booked: 0, open: 0, reserved: 0, localised: 0, personalised: 0, bookedRevenue: 0, views: 0, viewed: false, advertisers: new Set<string>() }))
      let windowStart = Number.NaN
      let windowEnd = Number.NEGATIVE_INFINITY
      let reservedHere = false
      for (let j = 0; j < colMs.length; j++) {
        const cell = cells[colMonth[j]]
        const first = colMs[j] >= windowEnd
        if (first) {
          windowStart = windowStartOf(new Date(colMs[j]), len).getTime()
          windowEnd = windowStart + len
          reservedHere = directFlights.length > 0 && windowStart >= firstSellable && directFlights.some((l) => isActiveAt(l, new Date(windowStart).toISOString()))
          cell.windows++
        }
        const sellable = first && hasDisplays && !realTime && windowStart >= firstSellable
        if (sellable) rev.sellableWindows++
        const x = mine?.get(windowStart)
        const r = x && (!f.campaignId || x.campaignId === f.campaignId) && (!f.partnerId || x.partnerId === f.partnerId) ? x : undefined
        const inFilter = !f.advertiserId || r?.advertiserId === f.advertiserId
        const columnViews = hasDisplays || r ? (row ? row[j] : flatColumn) : 0
        if (r) {
          if (inFilter) { rev.bookedViews += columnViews; rev.totalViews += columnViews }
          cell.views += columnViews
          cell.viewed = true
          if (first && inFilter) {
            const bookedRevenue = round2((views / 1000) * (r.clearingCpm as number))
            const type = (r.pricingType ?? 'default') as BookingSchedule['byPricingType'][number]['pricingType']
            rev.bookedWindows++
            rev.bookedRevenue = round2(rev.bookedRevenue + bookedRevenue)
            rev.billedRevenue = round2(rev.billedRevenue + (billed.get(r.id) ?? 0))
            const t = byType.get(type) ?? { pricingType: type, bookedWindows: 0, bookedRevenue: 0 }
            t.bookedWindows++
            t.bookedRevenue = round2(t.bookedRevenue + bookedRevenue)
            byType.set(type, t)
            const layers = layersOf(await targetedFor(r.campaignId), r.pricingType)
            cell.booked++
            cell.bookedRevenue = round2(cell.bookedRevenue + bookedRevenue)
            if (layers.localised) cell.localised++
            if (layers.personalised) cell.personalised++
            cell.advertisers.add((r.advertiserId && advertiserName.get(r.advertiserId)) || r.advertiserId || '—')
          }
          continue
        }
        const open = hasDisplays && !realTime && windowStart >= firstSellable
        const reserved = open && reservedHere
        if (reserved && !f.advertiserId) { rev.bookedViews += columnViews; rev.totalViews += columnViews }
        else if (open && !reserved) {
          rev.availableViews += columnViews; rev.totalViews += columnViews
          rev.availableValue = round2(rev.availableValue + (floor / 1000) * columnViews)
          if (sellable) rev.availableWindows++
        }
        if (open) { cell.views += columnViews; cell.viewed = true }
        if (first && reserved) cell.reserved++
        else if (first && open) cell.open++
      }
      months.forEach((m, i) => {
        const c = cells[i]
        windows.push({
          start: m.start.toISOString(), status: c.booked ? 'booked' : c.open ? 'available' : c.reserved ? 'reserved' : 'unavailable', assumedViews: c.viewed ? c.views : null, booking: null,
          rollup: { windows: c.windows, booked: c.booked, open: c.open, reserved: c.reserved, localised: c.localised, personalised: c.personalised, advertisers: [...c.advertisers], bookedRevenue: c.bookedRevenue },
        })
      })
    }
    positions.push({
      positionId: p.positionId, displayTypeId: p.displayType.id, displayTypeName: p.displayType.name, slot: p.slot, slotLabel: p.def.label, displayCount, playbackWindow: playbackWindowLabel(p.displayType.phExtensions),
      /* Multi-zone: "Zone n / Slot m", as Available Inventory numbers it
         (A0GyTNsA, 1 Oct 2026); positionId stays the flat index. */
      zoneName: zonePlaceOf(p.displayType, p.slot)?.zoneName ?? null, zoneSlot: zonePlaceOf(p.displayType, p.slot)?.zoneSlot ?? p.slot,
      partnerNames: ((await effectivePartnerIds(ctx, p.def, partners, buyersList)) ?? []).map((id) => partnerName.get(id) ?? id), assignment: assignmentOf(p.def), realTime, recentPlays: realTime ? (recentPlays.get(p.positionId) ?? 0) : null, windows,
    })
  }
  /* One advertiser selected: only the positions it actually holds (Rob, 20 Sep). */
  const shown = f.advertiserId ? positions.filter((p) => p.windows.some((w) => w.booking?.advertiserId === f.advertiserId || (w.rollup?.booked ?? 0) > 0)) : positions
  const rows = [...revenue.values()]
  return {
    /* Booked CPM x views is in the exchange's one currency, not the instance's display currency. */
    currency: TRANSACTING_CURRENCY,
    windows: monthly ? months.map((m) => ({ start: m.start.toISOString(), end: m.end.toISOString() })) : starts.map((s) => ({ start: s.toISOString(), end: new Date(s.getTime() + len).toISOString() })),
    positions: shown,
    revenue: rows,
    /* What the filters offer: each DSP and the advertisers it brings (Rob, 20 Sep). */
    dsps: partners.map((p) => ({
      partnerId: p.id, name: p.name,
      advertisers: p.seats.map((s) => ({ advertiserId: advertiserSlug(s.name), name: s.name })).filter((a) => booked.has(a.advertiserId)),
    })),
    /* Direct advertisers (no DSP) with something booked: offered when no DSP is picked. */
    directAdvertisers: direct.filter((d) => booked.has(d.advertiserId) && !partners.some((p) => p.seats.some((x) => advertiserSlug(x.name) === d.advertiserId))).map((d) => ({ advertiserId: d.advertiserId, name: directLabel(d.name) })),
    byPricingType: [...byType.values()],
    totals: {
      bookedWindows: rows.reduce((n, r) => n + r.bookedWindows, 0),
      sellableWindows: rows.reduce((n, r) => n + r.sellableWindows, 0),
      bookedRevenue: round2(rows.reduce((n, r) => n + r.bookedRevenue, 0)),
      billedRevenue: round2(rows.reduce((n, r) => n + r.billedRevenue, 0)),
      realtimeOpportunities: rows.reduce((n, r) => n + r.realtimeOpportunities, 0),
      realtimeFilled: rows.reduce((n, r) => n + r.realtimeFilled, 0),
      totalViews: rows.reduce((n, r) => n + r.totalViews, 0),
      bookedViews: rows.reduce((n, r) => n + r.bookedViews, 0),
      availableViews: rows.reduce((n, r) => n + r.availableViews, 0),
      availableWindows: rows.reduce((n, r) => n + r.availableWindows, 0),
      availableValue: round2(rows.reduce((n, r) => n + r.availableValue, 0)),
    },
  }
}

export const bookingScheduleRoutes = (ctx: Context, guards: Guards): FastifyPluginAsync => async (app) => {
  app.get<{ Querystring: { from?: string; to?: string; view?: string; campaignId?: string; advertiserId?: string; partnerId?: string } }>('/booking-schedule', async (req) => {
    guards.flagged()
    const { from, to, view, campaignId, advertiserId, partnerId } = req.query
    if (view !== undefined && !['daily', 'weekly', 'monthly'].includes(view)) throw validationFailed([{ field: 'view', reason: 'view is daily, weekly or monthly.' }])
    const monthly = view === 'monthly'
    let starts: Date[] | null
    /* The columns: the shortest window in the estate (OQ27 — every slot's
       window is its own billing unit), so no slot's window is finer than a
       column; bookingSchedule maps each column to each slot's own window. */
    const len = await shortestWindowMs(ctx)
    if (!from && !to) {
      /* For one campaign: every window it is booked in, however far out. */
      const booked = campaignId ? (await ctx.reservations.byStatus(['won', 'reserved'])).filter((r) => r.campaignId === campaignId && !r.testMode).map((r) => Date.parse(r.windowStart)) : []
      const first = Math.min(windowStartOf(ctx.clock(), len).getTime(), ...booked)
      const last = Math.max(windowStartOf(ctx.clock(), len).getTime() + 13 * len, ...booked)
      starts = Array.from({ length: Math.floor((last - first) / len) + 1 }, (_, i) => new Date(first + i * len))
    } else {
      const a = Date.parse(`${from}T00:00:00Z`)
      const b = Date.parse(`${to}T00:00:00Z`)
      starts = from && to && b - a <= (monthly ? MONTHLY_MAX_DAYS : MAX_DAYS) * DAY ? windowsBetween(from, to, len) : null
      /* A window that started before `from` but is still running is included. */
      if (starts) {
        const running = windowStartOf(new Date(a), len)
        if (running.getTime() < a) starts = [running, ...starts]
      }
    }
    if (!starts) throw validationFailed([{ field: 'from', reason: `from and to are dates (YYYY-MM-DD), from ≤ to, at most ${monthly ? MONTHLY_MAX_DAYS : MAX_DAYS} days apart${monthly ? '' : ' (the Monthly view allows 365)'}.` }])
    return bookingSchedule(ctx, starts, { campaignId, advertiserId, partnerId }, { monthly })
  })
}