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
import { listAdvertisers } from './advertisers'

const DAY = 86_400_000
const round2 = (n: number) => Math.round(n * 100) / 100

export function bookingSchedule(ctx: Context, starts: Date[]): BookingSchedule {
  const len = windowMs(ctx)
  const partners = ctx.partners.list()
  const advertiserName = new Map(listAdvertisers(ctx).map((a) => [a.advertiserId, a.name]))
  const billed = new Map(lineItems(ctx).map((l) => [l.reservationId, l.amount]))
  const firstSellable = nextWindow(ctx).getTime()
  const revenue = new Map<string, BookingSchedule['revenue'][number]>()

  const positions = allPositions(ctx).map((p) => {
    const hasDisplays = ctx.displays.listByDisplayType(p.displayType.id).length > 0
    const views = ctx.audience.forSlot(p.displayType.id, p.slot).assumedViewsPerWindow
    const rev = revenue.get(p.displayType.id) ?? { displayTypeId: p.displayType.id, displayTypeName: p.displayType.name, bookedWindows: 0, bookedRevenue: 0, billedRevenue: 0 }
    revenue.set(p.displayType.id, rev)
    const windows = starts.map((start) => {
      const r = ctx.reservations.forWindow(p.positionId, start.toISOString()).find((x) => !x.testMode && TAKEN.includes(x.status) && x.clearingCpm !== null)
      if (r) {
        const bookedRevenue = round2((views / 1000) * (r.clearingCpm as number))
        const bill = billed.get(r.id) ?? null
        rev.bookedWindows++
        rev.bookedRevenue = round2(rev.bookedRevenue + bookedRevenue)
        rev.billedRevenue = round2(rev.billedRevenue + (bill ?? 0))
        return {
          start: start.toISOString(), status: 'booked' as const,
          booking: {
            reservationId: r.id, type: r.type, advertiserName: (r.advertiserId && advertiserName.get(r.advertiserId)) || r.advertiserId || '—',
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
    totals: {
      bookedWindows: rows.reduce((n, r) => n + r.bookedWindows, 0),
      bookedRevenue: round2(rows.reduce((n, r) => n + r.bookedRevenue, 0)),
      billedRevenue: round2(rows.reduce((n, r) => n + r.billedRevenue, 0)),
    },
  }
}

export const bookingScheduleRoutes = (ctx: Context, guards: Guards): FastifyPluginAsync => async (app) => {
  app.get<{ Querystring: { from?: string; to?: string } }>('/booking-schedule', async (req) => {
    guards.flagged()
    const { from, to } = req.query
    let starts: Date[] | null
    if (!from && !to) {
      const first = windowStartOf(ctx, ctx.clock()).getTime()
      starts = Array.from({ length: 14 }, (_, i) => new Date(first + i * windowMs(ctx)))
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
    return bookingSchedule(ctx, starts)
  })
}
