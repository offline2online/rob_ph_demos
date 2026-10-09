import { describe, expect, it } from 'vitest'
import { playsInPeriod, playsForGroups, segmentsTargeted } from '../src/domain/dailyCapacity'
import { buildApp } from '../src/http/app'
import type { ReservationRecord } from '../src/repos/ReservationRepo'
import { expectMatchesContract } from './contract'
import { NOW, sellByWindow, testContext } from './helpers'

const H = 3_600_000
const DAY = 24 * H
const D = Date.UTC(2026, 8, 21)

describe('playsInPeriod: a day rolls up the windows in operating hours', () => {
  it('a 24/7 display on an 8h unit has three windows, 3x the per-window plays', () => {
    /* 60s loop: 480 plays per 8h window. */
    expect(playsInPeriod(D, D + DAY, 8 * H, 60, { open: 0, close: 24 })).toBe(3 * 480)
  })
  it('an in-store display open for one 8h window has one window of plays', () => {
    expect(playsInPeriod(D, D + DAY, 8 * H, 60, { open: 8, close: 16 })).toBe(480)
  })
  it('a partly-open window counts only the plays that fit in the open part', () => {
    expect(playsInPeriod(D, D + DAY, 8 * H, 60, { open: 8, close: 12 })).toBe(240)
    expect(playsInPeriod(D, D + DAY, 8 * H, 60, { open: 6, close: 10 })).toBe(120 + 120)
  })
  it('is nothing when closed all day or there is no loop', () => {
    expect(playsInPeriod(D, D + DAY, 8 * H, 60, { open: 9, close: 9 })).toBe(0)
    expect(playsInPeriod(D, D + DAY, 8 * H, 0, { open: 0, close: 24 })).toBe(0)
  })
  it('sums screens by trading hours', () => {
    const groups = [{ hours: { open: 0, close: 24 }, screens: 2 }, { hours: { open: 8, close: 16 }, screens: 3 }]
    expect(playsForGroups(groups, D, D + DAY, 8 * H, 60)).toBe(2 * 1440 + 3 * 480)
  })
})

describe('segmentsTargeted', () => {
  it('reads the fixed and variable store segments a campaign includes', () => {
    const t = { targeted: [{ rules: [[{ variable: 'store.fixed_segments', op: 'include', values: ['Metro'] }], [{ variable: 'store.hours', op: 'equal', values: ['Open'] }]] }, { rules: [[{ variable: 'store.variable_segments', op: 'match_exactly', values: ['Cold Day'] }, { variable: 'store.fixed_segments', op: 'exclude_or', values: ['Airport'] }]] }] }
    expect(segmentsTargeted(t).sort()).toEqual(['Cold Day', 'Metro'])
    expect(segmentsTargeted(null)).toEqual([])
  })
})

const reserve = (over: Partial<ReservationRecord>): ReservationRecord => ({
  id: 'r_cap', partnerId: 'p_google', advertiserId: 'swisse', campaignId: 'c_api_swisse', positionId: 'menu_board.s2', windowStart: '2026-09-22T00:00:00.000Z',
  type: 'reserve', channel: 'api', bidCpm: 175, currency: 'AUD', status: 'reserved', clearingCpm: 175, reason: null, testMode: false, pricingType: 'localised', handedOffAt: null, ...over,
})

describe('GET /admin/v1/booking-schedule/capacity', () => {
  const setup = async () => {
    const ctx = await testContext({ clock: () => NOW })
    const app = buildApp(ctx)
    await sellByWindow(ctx, 'menu_board', 2)
    const ext = (await ctx.displayTypes.get('menu_board'))!.phExtensions!
    await ctx.displayTypes.saveExtensions('menu_board', { ...ext, slots: ext.slots.map((s, i) => (i === 1 ? { ...s, billingUnitHours: 8, maxPlayLengthSec: 60 } : s)) })
    return { ctx, get: (q = '?from=2026-09-21&to=2026-09-23') => app.inject({ method: 'GET', url: `/api/admin/v1/booking-schedule/capacity${q}` }) }
  }
  const slot = (body: { positions: { positionId: string }[] }) => body.positions.find((p) => p.positionId === 'menu_board.s2') as unknown as {
    screens: number; windowHours: number; days: { date: string; totalPlays: number; firmPlays: number; availableToBid: number; deals: { plays: number }[]; segments: { segment: string; screens: number; totalPlays: number; firmPlays: number; availableToBid: number }[] }[]
  }

  it('rolls plays per day up from the windows in operating hours, one per screen', async () => {
    const { ctx, get } = await setup()
    const res = await get()
    expect(res.statusCode).toBe(200)
    expectMatchesContract('GET', '/admin/v1/booking-schedule/capacity', 200, res.json())
    const s = slot(res.json())
    expect(s.windowHours).toBe(8)
    /* Always-open by default: 3 windows x 480 plays (60s x slots in rotation) per screen. */
    const perScreenDay = s.days[0].totalPlays / s.screens
    expect(Number.isInteger(perScreenDay) && perScreenDay > 0).toBe(true)
    /* One store opens for a single 8h window: its screens drop to a third. */
    const [store] = await ctx.stores.list()
    ctx.db.prepare('UPDATE stores SET open_hour = 8, close_hour = 16 WHERE id = ?').run(store.id)
    const after = slot((await get()).json())
    expect(after.days[0].totalPlays).toBeLessThan(s.days[0].totalPlays)
    expect(after.days[0].totalPlays).toBeGreaterThan(0)
  })

  it('nets a pre-booked reserve off firmly and leaves the rest available to bid', async () => {
    const { ctx, get } = await setup()
    await ctx.reservations.insert(reserve({}))
    const s = slot((await get()).json())
    const [d21, d22] = s.days
    expect(d21.firmPlays).toBe(0)
    /* The deal's one 8h window of the 22nd is firm; the other two windows stay open. */
    expect(d22.deals).toHaveLength(1)
    expect(d22.firmPlays).toBe(d22.deals[0].plays)
    expect(d22.firmPlays).toBe(d22.totalPlays / 3)
    expect(d22.availableToBid).toBe(d22.totalPlays - d22.firmPlays)
  })

  it('cuts availability by each targeted segment, overlapping rather than additive', async () => {
    const { ctx, get } = await setup()
    const stores = await ctx.stores.list()
    /* Every store is Metro; the first is also Airport. Only Metro is targeted by a campaign (the seeded Nestlé one). */
    for (const [i, st] of stores.entries()) ctx.db.prepare('UPDATE stores SET segments = ? WHERE id = ?').run(JSON.stringify(i === 0 ? ['Metro', 'Airport'] : ['Metro']), st.id)
    const s = slot((await get()).json())
    const day = s.days[0]
    expect(day.segments.map((x) => x.segment)).toEqual(['Metro'])
    const metro = day.segments[0]
    expect(metro.screens).toBe(s.screens)
    expect(metro.totalPlays).toBe(day.totalPlays)
    expect(metro.availableToBid).toBe(day.availableToBid)
  })

  it('refuses a bad range', async () => {
    const { get } = await setup()
    expect((await get('?from=2026-09-21&to=2026-01-01')).statusCode).toBe(400)
  })
})
