/* The admin read paths reworked in the 3 Oct 2026 performance review:
   the booking schedule, the campaigns list and Advertisers no longer load
   all of history per request. These pin the two repository reads they now
   rely on; the screens' own outputs are pinned by booking-schedule,
   campaigns and advertisers tests. */
import { describe, expect, it } from 'vitest'
import type { ReservationRecord } from '../src/repos/ReservationRepo'
import { NOW, testContext } from './helpers'

const res = (id: string, over: Partial<ReservationRecord> = {}): ReservationRecord => ({
  id, partnerId: 'p_google', advertiserId: 'nestle', campaignId: 'c_x', positionId: 'menu_board.s2', windowStart: '2026-09-01T00:00:00.000Z', type: 'bid', channel: 'api',
  bidCpm: 100, currency: 'AUD', status: 'won', clearingCpm: 100, reason: null, testMode: false, pricingType: 'localised', handedOffAt: null, ...over,
})

describe('admin read paths', () => {
  it('liveByCampaign counts live won/reserved windows per campaign and finds the next one from now', async () => {
    const ctx = await testContext({ clock: () => NOW })
    const now = NOW.toISOString()
    const day = (n: number) => new Date(Date.parse('2030-01-01T00:00:00.000Z') + n * 86_400_000).toISOString()
    await ctx.reservations.insert(res('a1', { campaignId: 'c_x', windowStart: '2020-01-01T00:00:00.000Z' }))
    await ctx.reservations.insert(res('a2', { campaignId: 'c_x', windowStart: day(3), status: 'reserved' }))
    await ctx.reservations.insert(res('a3', { campaignId: 'c_x', windowStart: day(1), positionId: 'menu_board.s3' }))
    await ctx.reservations.insert(res('a4', { campaignId: 'c_x', windowStart: day(0), status: 'lost' }))
    await ctx.reservations.insert(res('a5', { campaignId: 'c_x', windowStart: day(0), positionId: 'menu_board.s4', testMode: true }))
    await ctx.reservations.insert(res('b1', { campaignId: 'c_y', windowStart: '2021-01-01T00:00:00.000Z' }))
    const live = await ctx.reservations.liveByCampaign(now)
    expect(live.get('c_x')).toEqual({ bookedWindows: 3, nextWindowStart: day(1) })
    expect(live.get('c_y')).toEqual({ bookedWindows: 1, nextWindowStart: null })
    expect(live.has('c_none')).toBe(false)
  })

  it('amountsFor reads only the asked reservations, in chunks, whatever the list length', async () => {
    const ctx = await testContext({ clock: () => NOW })
    const ids = Array.from({ length: 1203 }, (_, i) => `r${i}`)
    for (const id of ids.filter((_, i) => i % 3 === 0)) {
      await ctx.billing.insert({
        id: `bl_${id}`, reservationId: id, partnerId: 'p_google', advertiserId: 'nestle', campaignId: 'c_x', positionId: 'menu_board.s2', windowStart: '2026-09-01T00:00:00.000Z', windowEnd: '2026-09-02T00:00:00.000Z',
        plays: 1, playedSec: 1, expectedSec: 1, assumedViews: 1, realisedViews: 1, cpm: 1, currency: 'AUD', amount: Number(id.slice(1)), personalisedPlays: 0, personalisedViews: 0, personalisedMultiplier: null, personalisedAmount: 0, playsByVersion: [],
      }, NOW.toISOString())
    }
    const all = await ctx.billing.amountsFor(ids)
    expect(all.size).toBe(401)
    expect(all.get('r600')).toBe(600)
    expect(all.has('r601')).toBe(false)
    expect([...(await ctx.billing.amountsFor(['r3', 'nope'])).entries()]).toEqual([['r3', 3]])
    expect((await ctx.billing.amountsFor([])).size).toBe(0)
    expect((await ctx.billing.billedAmong(['r0', 'r1', 'r1203'])).size).toBe(1)
  })
})
