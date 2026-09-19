/* Booking schedule (Rob, 19 Sep; reached from Available Inventory): every
   advertiser-owned slot across its play windows — booked, available or
   unavailable — with the booking revenue per display type. Live bookings
   only: a Test-mode win is never real revenue. */
import type { BookingSchedule } from '@ph-dsp/types'
import type { FastifyPluginAsync } from 'fastify'
import type { Context } from '../../context'
import { lineItems } from '../../exchange/billing'
import type { Guards } from '../../http/app'
import { validationFailed } from '../../http/errors'
import { allPositions, assignmentOf, nextWindow, windowMs, windowStartOf, windowsBetween } from '../../domain/positions'
import { TAKEN } from '../../repos/ReservationRepo'
import { advertiserSlug } from '@ph-dsp/types'

const DAY = 86_400_000
const round2 = (n: number) => Math.round(n * 100) / 100

export interface ScheduleFilter { campaignId?: string; advertiserId?: string; partnerId?: string }

export function bookingSchedule(ctx: Context, starts: Date[], f: ScheduleFilter = {}): BookingSchedule {
  const len = windowMs(ctx)
  const partners = ctx.partners.list()
  /* Advertiser names come from the DSPs' seats, keyed by their slug. */
  const advertiserName = new Map(partners.flatMap((p) => p.seats.map((s) => [advertiserSlug(s.name), s.name] as const)))
  const billed = new Map(lineItems(ctx).map((l) => [l.reservationId, l.amount]))
  const firstSellable = nextWindow(ctx).getTime()
  const revenue = new Map<string, BookingSchedule['revenue'][number]>()
  const byType = new Map<string, BookingSchedule['byPricingType'][number]>()

  const positions = allPositions(ctx).map((p) => {
    const hasDisplays = ctx.displays.listByDisplayType(p.displayType.id).length > 0
    const views = ctx.audience.forSlot(p.displayType.id, p.slot).assumedViewsPerWindow
    const rev = revenue.get(p.displayType.id) ?? { displayTypeId: p.displayType.id, displayTypeName: p.displayType.name, bookedWindows: 0, bookedRevenue: 0, billedRevenue: 0 }
    revenue.set(p.displayType.id, rev)
    const windows = starts.map((start) => {
      const r = ctx.reservations.forWindow(p.positionId, start.toISOString()).find((x) => !x.testMode && TAKEN.includes(x.status) && x.clearingCpm !== null
        && (!f.campaignId || x.campaignId === f.campaignId) && (!f.advertiserId || x.advertiserId === f.advertiserId) && (!f.partnerId || x.partnerId === f.partnerId))
      if (r) {
        const bookedRevenue = round2((views / 1000) * (r.clearingCpm as number))
        const bill = billed.get(r.id) ?? null
        rev.bookedWindows++
        rev.bookedRevenue = round2(rev.bookedRevenue + bookedRevenue)
        rev.billedRevenue = round2(rev.billedRevenue + (bill ?? 0))
        const type = (r.pricingType ?? 'baseline') as BookingSchedule['byPricingType'][number]['pricingType']
        const t = byType.get(type) ?? { pricingType: type, bookedWindows: 0, bookedRevenue: 0 }
        t.bookedWindows++
        t.bookedRevenue = round2(t.bookedRevenue + bookedRevenue)
        byType.set(type, t)
        return {
          start: start.toISOString(), status: 'booked' as const,
          booking: {
            reservationId: r.id, campaignId: r.campaignId as string, advertiserId: r.advertiserId, partnerId: r.partnerId,
            pricingType: (r.pricingType ?? 'baseline') as BookingSchedule['byPricingType'][number]['pricingType'], type: r.type, advertiserName: (r.advertiserId && advertiserName.get(r.advertiserId)) || r.advertiserId || '—',
            partnerName: partners.find((x) => x.id === r.partnerId)?.name ?? r.partnerId, cpm: r.clearingCpm as number, assumedViews: views, bookedRevenue, billedRevenue: bill,
          },
        }
      }
      const open = hasDisplays && start.getTime() >= firstSellable
      return { start: start.toISOString(), status: open ? ('available' as const) : ('unavailable' as const), booking: null }
    })
    return {
      positionId: p.positionId, displayTypeId: p.displayType.id, displayTypeName: p.displayType.name, slot: p.slot, slotLabel: p.def.label,
      partnerName: p.def.partnerId ? partners.find((x) => x.id === p.def.partnerId)?.name ?? null : null, assignment: assignmentOf(p.def), windows,
    }
  })
  const rows = [...revenue.values()]
  return {
    currency: ctx.company.get().currency,
    windows: starts.map((s) => ({ start: s.toISOString(), end: new Date(s.getTime() + len).toISOString() })),
    positions,
    revenue: rows,
    byPricingType: [...byType.values()],
    totals: {
      bookedWindows: rows.reduce((n, r) => n + r.bookedWindows, 0),
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
