import { describe, expect, it } from 'vitest'
import { runBilling } from '../src/exchange/billing'
import { buildApp } from '../src/http/app'
import type { ReservationRecord } from '../src/repos/ReservationRepo'
import { expectMatchesContract } from './contract'
import { NOW, testContext } from './helpers'

const booking = (over: Partial<ReservationRecord>): ReservationRecord => ({
  id: 'r_x', partnerId: 'p_google', advertiserId: 'swisse', campaignId: 'c_api_swisse', positionId: 'menu_board.s2', windowStart: '2026-09-22T00:00:00.000Z',
  type: 'reserve', channel: 'api', bidCpm: 175, currency: 'AUD', status: 'reserved', clearingCpm: 175, reason: null, testMode: false, pricingType: 'localised', handedOffAt: null, ...over,
})

const setup = async (flag = true) => {
  const ctx = await testContext({ clock: () => NOW, flag })
  const app = buildApp(ctx)
  return { ctx, get: (q = '') => app.inject({ method: 'GET', url: `/api/admin/v1/booking-schedule${q}` }) }
}

describe('GET /admin/v1/booking-schedule', () => {
  it('shows every advertiser slot across the current window and the next 13', async () => {
    const { get } = await setup()
    const res = await get()
    expect(res.statusCode).toBe(200)
    expectMatchesContract('GET', '/admin/v1/booking-schedule', 200, res.json())
    const body = res.json()
    expect(body.windows).toHaveLength(14)
    expect(body.windows[0]).toEqual({ start: '2026-09-20T00:00:00.000Z', end: '2026-09-21T00:00:00.000Z' })
    expect(body.positions.map((p: { positionId: string }) => p.positionId)).toEqual(['menu_board.s2'])
    expect(body.positions[0]).toMatchObject({ displayTypeName: 'Menu Board — Long Format', slot: 2, slotLabel: 'Supplier slot', partnerName: 'Google DSP', assignment: 'rtb' })
    /* The current window can no longer be sold; the next one can. */
    expect(body.positions[0].windows.slice(0, 2).map((w: { status: string }) => w.status)).toEqual(['unavailable', 'available'])
    expect(body.totals).toEqual({ bookedWindows: 0, bookedRevenue: 0, billedRevenue: 0 })
  })

  it('shows each booking at the price it was booked at, with booked and billed revenue per display type', async () => {
    const { ctx, get } = await setup()
    ctx.reservations.insert(booking({}))
    ctx.reservations.insert(booking({ id: 'r_test', windowStart: '2026-09-23T00:00:00.000Z', testMode: true, status: 'won', type: 'bid' }))
    runBilling(ctx)
    const res = await get('?from=2026-09-15&to=2026-09-23')
    expectMatchesContract('GET', '/admin/v1/booking-schedule', 200, res.json())
    const [pos] = res.json().positions
    const at = (d: string) => pos.windows.find((w: { start: string }) => w.start.startsWith(d))
    /* The seeded 15 Sep window: won at 120 CPM, 1,236 assumed views; billed on what played. */
    expect(at('2026-09-15')).toEqual({ start: '2026-09-15T00:00:00.000Z', status: 'booked', booking: { reservationId: 'res_seed_nestle_0915', type: 'bid', advertiserName: 'Nestlé', partnerName: 'Google DSP', cpm: 120, assumedViews: 1236, bookedRevenue: 148.32, billedRevenue: 74.16 } })
    /* Reserved at the price agreed through the DSP. */
    expect(at('2026-09-22')).toMatchObject({ status: 'booked', booking: { type: 'reserve', advertiserName: 'Swisse', cpm: 175, bookedRevenue: 216.3, billedRevenue: null } })
    /* A Test-mode win is not a booking. */
    expect(at('2026-09-23')).toMatchObject({ status: 'available', booking: null })
    expect(at('2026-09-16').status).toBe('unavailable')
    expect(res.json().revenue).toEqual([{ displayTypeId: 'menu_board', displayTypeName: 'Menu Board — Long Format', bookedWindows: 2, bookedRevenue: 364.62, billedRevenue: 74.16 }])
    expect(res.json().totals).toEqual({ bookedWindows: 2, bookedRevenue: 364.62, billedRevenue: 74.16 })
  })

  it('needs a valid range of at most 92 days, and is behind the flag', async () => {
    const { get } = await setup()
    for (const q of ['?from=2026-09-20', '?from=2026-09-20&to=2026-12-31', '?from=2026-09-22&to=2026-09-21']) {
      const res = await get(q)
      expect(res.statusCode).toBe(400)
      expectMatchesContract('GET', '/admin/v1/booking-schedule', 400, res.json())
    }
    expect((await (await setup(false)).get()).statusCode).toBe(404)
  })
})
