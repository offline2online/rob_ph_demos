/* POST /admin/v1/test/plays (E2E Testing Strategy §3.3): the journey runner
   reports plays for a won window so L4 can bill inside one run. */
import { describe, expect, it } from 'vitest'
import { loadConfig } from '../src/config'
import { buildApp } from '../src/http/app'
import type { ReservationRecord } from '../src/repos/ReservationRepo'
import { NOW, testContext } from './helpers'

const W = '2026-09-14T00:00:00.000Z'
const won = (over: Partial<ReservationRecord> = {}): ReservationRecord => ({
  id: 'res_tp_1', partnerId: 'p_google', advertiserId: 'nestle', campaignId: 'c_dsp_nestle', positionId: 'menu_board.s2', windowStart: W, type: 'bid', channel: 'api',
  bidCpm: 100, currency: 'AUD', status: 'won', clearingCpm: 100, reason: null, testMode: false, pricingType: 'localised', handedOffAt: W, personalisedMultiplier: 1.5, ...over,
})

describe('POST /admin/v1/test/plays', () => {
  it('writes plays with their tier, spread over the display type’s displays and inside the window', async () => {
    const ctx = await testContext({ clock: () => NOW })
    await ctx.reservations.insert(won())
    const res = await buildApp(ctx).inject({ method: 'POST', url: '/api/admin/v1/test/plays', payload: { reservationId: 'res_tp_1', plays: [{ tier: 'default', count: 4 }, { tier: 'personalised', count: 2, durationSec: 8 }] } })
    expect(res.statusCode).toBe(201)
    expect(res.json()).toMatchObject({ reservationId: 'res_tp_1', campaignId: 'c_dsp_nestle', positionId: 'menu_board.s2', windowStart: W, total: 6, written: [{ tier: 'default', count: 4 }, { tier: 'personalised', count: 2 }] })
    const t = await ctx.playback.totals({ campaignId: 'c_dsp_nestle', displayTypeId: 'menu_board', from: W, to: res.json().windowEnd })
    expect(t.plays).toBe(6)
    expect(t.personalised).toEqual({ plays: 2, playedSec: 16 })
    const rows = ctx.db.prepare('SELECT display_id, played_at FROM plays WHERE id LIKE ?').all('tp_%') as { display_id: string; played_at: string }[]
    expect(new Set(rows.map((r) => r.display_id)).size).toBeGreaterThan(1)
    expect(rows.every((r) => r.played_at > W && r.played_at < res.json().windowEnd)).toBe(true)
  })

  it('validates the body and refuses an unknown reservation', async () => {
    const app = buildApp(await testContext({ clock: () => NOW }))
    expect((await app.inject({ method: 'POST', url: '/api/admin/v1/test/plays', payload: { plays: [] } })).statusCode).toBe(400)
    expect((await app.inject({ method: 'POST', url: '/api/admin/v1/test/plays', payload: { reservationId: 'x', plays: [{ tier: 'gold', count: 1 }] } })).statusCode).toBe(400)
    expect((await app.inject({ method: 'POST', url: '/api/admin/v1/test/plays', payload: { reservationId: 'nope', plays: [{ tier: 'default', count: 1 }] } })).statusCode).toBe(404)
  })

  it('does not exist in production', async () => {
    expect(loadConfig({ NODE_ENV: 'production', PARTNER_TOKENS: '{"t":"p"}' }).testEndpoints).toBe(false)
    const ctx = await testContext({ clock: () => NOW })
    ctx.config.testEndpoints = false
    await ctx.reservations.insert(won())
    const res = await buildApp(ctx).inject({ method: 'POST', url: '/api/admin/v1/test/plays', payload: { reservationId: 'res_tp_1', plays: [{ tier: 'default', count: 1 }] } })
    expect(res.statusCode).toBe(404)
  })
})
