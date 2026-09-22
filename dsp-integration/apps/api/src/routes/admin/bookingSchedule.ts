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
   localised (reach.matchedDisplays, from the campaign's own
   targeted-version rules via ctx.reach, the ReachCountSource stand-in —
   REQUIREMENTS §6, interface contract "Booking schedule reach counts")
   and personalised (no count — matching can't be predicted ahead of
   time — but a breakdown of which trigger mechanism(s) its rules use,
   ticket "Booking schedule: personalised trigger icons"). */
import type { BookingSchedule } from '@ph-dsp/types'
import { TARGETING_VARIABLES } from '@ph-dsp/types'
import type { FastifyPluginAsync } from 'fastify'
import type { Context } from '../../context'
import { lineItems } from '../../exchange/billing'
import type { Guards } from '../../http/app'
import { validationFailed } from '../../http/errors'
import { allPositions, assignmentOf, nextWindow, windowMs, windowStartOf, windowsBetween } from '../../domain/positions'
import type { Condition, StoredTargeting } from '../../domain/targetingSummary'
import { TAKEN } from '../../repos/ReservationRepo'
import { advertiserSlug, assignedOf } from '@ph-dsp/types'

const DAY = 86_400_000
const round2 = (n: number) => Math.round(n * 100) / 100

export interface ScheduleFilter { campaignId?: string; advertiserId?: string; partnerId?: string }

type Booking = NonNullable<BookingSchedule['positions'][number]['windows'][number]['booking']>
type Layers = Booking['layers']
type Triggers = Booking['personalisedTriggers']
type TargetedVersion = NonNullable<StoredTargeting['targeted']>[number]

const targetedOf = (ctx: Context, campaignId: string | null): TargetedVersion[] =>
  (ctx.campaigns.getCampaign(campaignId ?? '')?.targeting as StoredTargeting | null)?.targeted ?? []

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

/* The rules driving reach for the localised layer: the campaign's own
   localised/interactive targeted version — a reservation doesn't record
   which specific version won, so this is an approximation, same spirit as
   the POC's other targeting stand-ins (AudienceSource.targetedShare). */
function reachRulesOf(targeted: TargetedVersion[]): Condition[][] | undefined {
  return targeted.find((v) => v.pricingType === 'localised' || v.pricingType === 'interactive')?.rules
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

export function bookingSchedule(ctx: Context, starts: Date[], f: ScheduleFilter = {}): BookingSchedule {
  const len = windowMs(ctx)
  const partners = ctx.partners.list()
  /* Advertiser names come from the DSPs' seats, keyed by their slug. */
  const advertiserName = new Map(partners.flatMap((p) => p.seats.map((s) => [advertiserSlug(s.name), s.name] as const)))
  const billed = new Map(lineItems(ctx).map((l) => [l.reservationId, l.amount]))
  const firstSellable = nextWindow(ctx).getTime()
  const revenue = new Map<string, BookingSchedule['revenue'][number]>()
  const byType = new Map<string, BookingSchedule['byPricingType'][number]>()

  /* Only advertisers with something booked in this range are worth filtering
     by (Rob, 20 Sep), so the picker is built before any filter is applied. */
  const booked = new Set<string>()
  for (const p of allPositions(ctx)) {
    for (const start of starts) {
      for (const r of ctx.reservations.forWindow(p.positionId, start.toISOString())) {
        if (!r.testMode && TAKEN.includes(r.status) && r.clearingCpm !== null && r.advertiserId) booked.add(r.advertiserId)
      }
    }
  }

  const positions = allPositions(ctx).map((p) => {
    const displayCount = ctx.displays.listByDisplayType(p.displayType.id).length
    const hasDisplays = displayCount > 0
    const views = ctx.audience.forSlot(p.displayType.id, p.slot).assumedViewsPerWindow
    const rev = revenue.get(p.displayType.id) ?? { displayTypeId: p.displayType.id, displayTypeName: p.displayType.name, bookedWindows: 0, sellableWindows: 0, bookedRevenue: 0, billedRevenue: 0 }
    revenue.set(p.displayType.id, rev)
    const windows = starts.map((start) => {
      /* Sellable capacity ignores the advertiser/DSP filter (Rob, 22 Sep,
         ticket "% of slots sold"): it's this display type's whole market,
         not just what one advertiser could have bought, so % sold reads
         the same whichever filter is applied. */
      if (hasDisplays && start.getTime() >= firstSellable) rev.sellableWindows++
      const r = ctx.reservations.forWindow(p.positionId, start.toISOString()).find((x) => !x.testMode && TAKEN.includes(x.status) && x.clearingCpm !== null
        && (!f.campaignId || x.campaignId === f.campaignId) && (!f.advertiserId || x.advertiserId === f.advertiserId) && (!f.partnerId || x.partnerId === f.partnerId))
      if (r) {
        const bookedRevenue = round2((views / 1000) * (r.clearingCpm as number))
        const bill = billed.get(r.id) ?? null
        rev.bookedWindows++
        rev.bookedRevenue = round2(rev.bookedRevenue + bookedRevenue)
        rev.billedRevenue = round2(rev.billedRevenue + (bill ?? 0))
        const type = (r.pricingType ?? 'default') as BookingSchedule['byPricingType'][number]['pricingType']
        const t = byType.get(type) ?? { pricingType: type, bookedWindows: 0, bookedRevenue: 0 }
        t.bookedWindows++
        t.bookedRevenue = round2(t.bookedRevenue + bookedRevenue)
        byType.set(type, t)
        /* The campaign's full submission — its own targeted versions,
           regardless of which one this particular window's reservation
           actually won — drives the tile's layers and, when personalised,
           its trigger icons. */
        const targeted = targetedOf(ctx, r.campaignId)
        const layers = layersOf(targeted, r.pricingType)
        /* Localised layer reach: null when this booking has no localised
           layer — personalised reach can't be predicted. */
        const reach = layers.localised ? ctx.reach.matchOf(displayCount, reachRulesOf(targeted)) : null
        return {
          start: start.toISOString(), status: 'booked' as const,
          booking: {
            reservationId: r.id, campaignId: r.campaignId as string, advertiserId: r.advertiserId, partnerId: r.partnerId,
            pricingType: type, type: r.type, advertiserName: (r.advertiserId && advertiserName.get(r.advertiserId)) || r.advertiserId || '—',
            partnerName: partners.find((x) => x.id === r.partnerId)?.name ?? r.partnerId, cpm: r.clearingCpm as number, assumedViews: views, bookedRevenue, billedRevenue: bill,
            reach, layers, personalisedTriggers: triggersOf(targeted, layers.personalised),
          },
        }
      }
      const open = hasDisplays && start.getTime() >= firstSellable
      return { start: start.toISOString(), status: open ? ('available' as const) : ('unavailable' as const), booking: null }
    })
    return {
      positionId: p.positionId, displayTypeId: p.displayType.id, displayTypeName: p.displayType.name, slot: p.slot, slotLabel: p.def.label, displayCount,
      partnerNames: assignedOf(p.def).partnerIds.map((id) => partners.find((x) => x.id === id)?.name ?? id), assignment: assignmentOf(p.def), windows,
    }
  })
  /* One advertiser selected: only the positions it actually holds (Rob, 20 Sep). */
  const shown = f.advertiserId ? positions.filter((p) => p.windows.some((w) => w.booking?.advertiserId === f.advertiserId)) : positions
  const rows = [...revenue.values()]
  return {
    currency: ctx.company.get().currency,
    windows: starts.map((s) => ({ start: s.toISOString(), end: new Date(s.getTime() + len).toISOString() })),
    positions: shown,
    revenue: rows,
    /* What the filters offer: each DSP and the advertisers it brings (Rob, 20 Sep). */
    dsps: partners.map((p) => ({
      partnerId: p.id, name: p.name,
      advertisers: p.seats.map((s) => ({ advertiserId: advertiserSlug(s.name), name: s.name })).filter((a) => booked.has(a.advertiserId)),
    })),
    byPricingType: [...byType.values()],
    totals: {
      bookedWindows: rows.reduce((n, r) => n + r.bookedWindows, 0),
      sellableWindows: rows.reduce((n, r) => n + r.sellableWindows, 0),
      bookedRevenue: round2(rows.reduce((n, r) => n + r.bookedRevenue, 0)),
      billedRevenue: round2(rows.reduce((n, r) => n + r.billedRevenue, 0)),
    },
  }
}

export const bookingScheduleRoutes = (ctx: Context, guards: Guards): FastifyPluginAsync => async (app) => {
  app.get<{ Querystring: { from?: string; to?: string; campaignId?: string; advertiserId?: string; partnerId?: string } }>('/booking-schedule', async (req) => {
    guards.flagged()
    const { from, to, campaignId, advertiserId, partnerId } = req.query
    let starts: Date[] | null
    if (!from && !to) {
      const len = windowMs(ctx)
      /* For one campaign: every window it is booked in, however far out. */
      const booked = campaignId ? ctx.reservations.byStatus(['won', 'reserved']).filter((r) => r.campaignId === campaignId && !r.testMode).map((r) => Date.parse(r.windowStart)) : []
      const first = Math.min(windowStartOf(ctx, ctx.clock()).getTime(), ...booked)
      const last = Math.max(windowStartOf(ctx, ctx.clock()).getTime() + 13 * len, ...booked)
      starts = Array.from({ length: Math.floor((last - first) / len) + 1 }, (_, i) => new Date(first + i * len))
    } else {
      const a = Date.parse(`${from}T00:00:00Z`)
      const b = Date.parse(`${to}T00:00:00Z`)
      starts = from && to && b - a <= 92 * DAY ? windowsBetween(ctx, from, to) : null
      /* A window that started before `from` but is still running is included. */
      if (starts) {
        const running = windowStartOf(ctx, new Date(a))
        if (running.getTime() < a) starts = [running, ...starts]
      }
    }
    if (!starts) throw validationFailed([{ field: 'from', reason: 'from and to are dates (YYYY-MM-DD), from ≤ to, at most 92 days apart.' }])
    return bookingSchedule(ctx, starts, { campaignId, advertiserId, partnerId })
  })
}
