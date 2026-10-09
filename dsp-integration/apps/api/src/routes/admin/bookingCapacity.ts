/* Booking schedule, plays per day (decision Rob 9 Oct 2026): per advertiser
   slot and day, the slot's total plays (every billing-unit window in the
   stores' trading hours, domain/dailyCapacity.ts), the plays pre-booked deals
   hold outright (reserve bookings; firm), and the rest, which is only
   "available to bid" and indicative: the auction decides. Each localized
   segment a campaign actually targets is a further cut: its screens x plays,
   its own pre-booked plays netted off. Segments overlap on screens, so cuts
   are never additive to each other or to the whole-estate figure. */
import type { BookingCapacity } from '@ph-dsp/types'
import type { FastifyPluginAsync } from 'fastify'
import type { Context } from '../../context'
import type { Guards } from '../../http/app'
import { validationFailed } from '../../http/errors'
import { allPositions, isRealtime, maxPlayLengthSecFor, windowMs, windowStartOf } from '../../domain/positions'
import { playsForGroups, screensOf, segmentsTargeted, type ScreenGroup } from '../../domain/dailyCapacity'
import { rotationSizeOf } from '../../domain/slots'
import { TAKEN } from '../../repos/ReservationRepo'
import { advertiserSlug, directLabel } from '@ph-dsp/types'

const DAY = 86_400_000

export async function bookingCapacity(ctx: Context, days: Date[]): Promise<BookingCapacity> {
  const company = await ctx.company.get()
  const stores = new Map((await ctx.stores.list()).map((s) => [s.id, s]))
  const partners = await ctx.partners.list()
  const advertiserName = new Map([...(await ctx.company.directAdvertisers()).map((d) => [d.advertiserId, directLabel(d.name)] as const), ...partners.flatMap((p) => p.seats.map((s) => [advertiserSlug(s.name), s.name] as const))])
  /* Segments any campaign targets: each becomes a cut wherever a store carries it. */
  const targetedSegments = [...new Set((await ctx.campaigns.listCampaigns()).flatMap((c) => segmentsTargeted(c.targeting)))].sort()
  const first = days[0].getTime()
  const last = days[days.length - 1].getTime() + DAY
  const taken = (await ctx.reservations.byStatus(TAKEN, new Date(first - 92 * DAY).toISOString(), new Date(last).toISOString())).filter((r) => !r.testMode && r.type === 'reserve')

  const positions: BookingCapacity['positions'] = []
  for (const p of await allPositions(ctx)) {
    const len = await windowMs(ctx, p)
    const loopSec = maxPlayLengthSecFor(company.maxPlayLengthSec, p) * Math.max(1, rotationSizeOf(p.displayType, p.slot))
    /* Displays grouped by store, then by trading hours, whole estate and per segment. */
    const perStore = new Map<string, number>()
    for (const d of await ctx.displays.listByDisplayType(p.displayType.id)) perStore.set(d.storeId, (perStore.get(d.storeId) ?? 0) + 1)
    const groupsOf = (keep: (segments: string[]) => boolean): ScreenGroup[] => {
      const byHours = new Map<string, ScreenGroup>()
      for (const [storeId, screens] of perStore) {
        const s = stores.get(storeId)
        if (s && !keep(s.segments)) continue
        const hours = { open: s?.openHour ?? 0, close: s?.closeHour ?? 24 }
        const key = `${hours.open}-${hours.close}`
        const g = byHours.get(key) ?? { hours, screens: 0 }
        g.screens += screens
        byHours.set(key, g)
      }
      return [...byHours.values()]
    }
    const estate = groupsOf(() => true)
    const cuts = targetedSegments.map((name) => ({ name, groups: groupsOf((segs) => segs.includes(name)) })).filter((c) => screensOf(c.groups) > 0)
    const mine = taken.filter((r) => r.positionId === p.positionId)

    const perDay = days.map((day) => {
      const a = day.getTime()
      const b = a + DAY
      const total = playsForGroups(estate, a, b, len, loopSec)
      const deals = mine.flatMap((r) => {
        const ws = Date.parse(r.windowStart)
        const lo = Math.max(a, ws)
        const hi = Math.min(b, ws + len)
        if (hi <= lo) return []
        /* The booking holds every screen of the slot for its window; only its share of this day counts here. */
        const plays = playsForGroups(estate, lo, hi, len, loopSec)
        return [{ reservationId: r.id, advertiserName: (r.advertiserId && advertiserName.get(r.advertiserId)) || r.advertiserId || '—', plays, _g: { lo, hi } }]
      })
      const firm = Math.min(total, deals.reduce((n, d) => n + d.plays, 0))
      return {
        date: day.toISOString().slice(0, 10), totalPlays: total, firmPlays: firm, availableToBid: Math.max(0, total - firm),
        deals: deals.map(({ _g, ...d }) => d),
        segments: cuts.map((c) => {
          const cap = playsForGroups(c.groups, a, b, len, loopSec)
          const segFirm = Math.min(cap, deals.reduce((n, d) => n + playsForGroups(c.groups, d._g.lo, d._g.hi, len, loopSec), 0))
          return { segment: c.name, screens: screensOf(c.groups), totalPlays: cap, firmPlays: segFirm, availableToBid: Math.max(0, cap - segFirm) }
        }),
      }
    })
    positions.push({
      positionId: p.positionId, displayTypeId: p.displayType.id, displayTypeName: p.displayType.name, slot: p.slot, slotLabel: p.def.label,
      realtime: isRealtime(p), screens: screensOf(estate), windowHours: len / 3_600_000, days: perDay,
    })
  }
  return { days: days.map((d) => d.toISOString().slice(0, 10)), positions }
}

export const bookingCapacityRoutes = (ctx: Context, guards: Guards): FastifyPluginAsync => async (app) => {
  app.get<{ Querystring: { from?: string; to?: string } }>('/booking-schedule/capacity', async (req) => {
    guards.flagged()
    const today = windowStartOf(ctx.clock(), DAY)
    const from = req.query.from ?? today.toISOString().slice(0, 10)
    const to = req.query.to ?? new Date(Date.parse(`${from}T00:00:00Z`) + 13 * DAY).toISOString().slice(0, 10)
    const a = Date.parse(`${from}T00:00:00Z`)
    const b = Date.parse(`${to}T00:00:00Z`)
    if (!Number.isFinite(a) || !Number.isFinite(b) || b < a || b - a > 91 * DAY) {
      throw validationFailed([{ field: 'from', reason: 'from and to are dates (YYYY-MM-DD), from ≤ to, at most 92 days apart.' }])
    }
    const days = Array.from({ length: Math.round((b - a) / DAY) + 1 }, (_, i) => new Date(a + i * DAY))
    return bookingCapacity(ctx, days)
  })
}
