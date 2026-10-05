/* POST /admin/v1/test/plays (E2E Testing Strategy §3.3): the journey runner
   reports plays for a won window so L4 can bill inside one run. */
import { describe, expect, it } from 'vitest'
import { computeLineItem } from '../src/billing'
import { loadConfig } from '../src/config'
import { findPosition } from '../src/domain/positions'
import { runAuction } from '../src/exchange/auction'
import { buildApp } from '../src/http/app'
import type { ReservationRecord } from '../src/repos/ReservationRepo'
import { NOW, mockDsps, testContext } from './helpers'

const W = '2026-09-14T00:00:00.000Z'
const won = (over: Partial<ReservationRecord> = {}): ReservationRecord => ({
  id: 'res_tp_1', partnerId: 'p_google', advertiserId: 'nestle', campaignId: 'c_dsp_nestle', positionId: 'menu_board.s2', windowStart: W, type: 'bid', channel: 'api',
  bidCpm: 100, currency: 'AUD', status: 'won', clearingCpm: 100, reason: null, testMode: false, pricingType: 'localised', handedOffAt: W, ...over,
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
    const rows = ctx.db.prepare('SELECT display_id, played_at FROM plays WHERE id LIKE ?').all('tp_%') as { display_id: string; played_at: string }[]
    expect(new Set(rows.map((r) => r.display_id)).size).toBeGreaterThan(1)
    expect(rows.every((r) => r.played_at > W && r.played_at < res.json().windowEnd)).toBe(true)
  })

  /* Contract v3.1 row 3 (DDOjJoYjraKROu4Ainj5): every play carries the
     version it showed, which is the version handed off on the booking. */
  it('each play carries the booking’s asset version, and the line item reports plays per version', async () => {
    const ctx = await testContext({ clock: () => NOW, dspFetch: mockDsps().fetchImpl })
    const app = buildApp(ctx)
    await runAuction(ctx, new Date('2026-09-21T00:00:00.000Z'))
    const nestle = (await ctx.approvalCampaigns.listCampaigns({ sources: ['dsp'] })).find((c) => c.name === 'Nestlé — crid-5130001')!.campaignId
    await app.inject({ method: 'PUT', url: `/api/admin/v1/campaigns/${nestle}/activation`, payload: { enabled: true } })
    const res = await runAuction(ctx, new Date('2026-09-22T00:00:00.000Z'))
    const r = (await ctx.reservations.get(res.positions[0].winner!.reservationId))!
    const [booking] = await ctx.campaigns.bookings(r.campaignId as string)
    expect(booking.assetVersion).toEqual(expect.any(String))

    const sent = await app.inject({ method: 'POST', url: '/api/admin/v1/test/plays', payload: { reservationId: r.id, plays: [{ tier: 'default', count: 3 }, { tier: 'default', count: 1, versionId: 'v-other' }, { tier: null, count: 1, versionId: null }] } })
    expect(sent.statusCode).toBe(201)
    expect(sent.json().written).toEqual([
      { tier: 'default', count: 3, versionId: booking.assetVersion },
      { tier: 'default', count: 1, versionId: 'v-other' },
      { tier: null, count: 1, versionId: null },
    ])
    const versions = (ctx.db.prepare('SELECT version_id FROM plays WHERE campaign_id = ?').all(r.campaignId) as { version_id: string | null }[]).map((x) => x.version_id)
    expect(versions.filter((v) => v === booking.assetVersion)).toHaveLength(3)

    const totals = await ctx.playback.totals({ campaignId: r.campaignId as string, displayTypeId: 'menu_board', from: r.windowStart, to: sent.json().windowEnd })
    const byVersion = [{ versionId: null, plays: 1 }, { versionId: booking.assetVersion!, plays: 3 }, { versionId: 'v-other', plays: 1 }]
      .sort((a, b) => (a.versionId ?? '').localeCompare(b.versionId ?? ''))
    expect(totals.byVersion).toEqual(byVersion)
    const item = await computeLineItem(ctx, r, (await findPosition(ctx, r.positionId))!, totals)
    expect(item.playsByVersion).toEqual(byVersion)
  })

  it('validates the body and refuses an unknown reservation', async () => {
    const app = buildApp(await testContext({ clock: () => NOW }))
    expect((await app.inject({ method: 'POST', url: '/api/admin/v1/test/plays', payload: { plays: [] } })).statusCode).toBe(400)
    expect((await app.inject({ method: 'POST', url: '/api/admin/v1/test/plays', payload: { reservationId: 'x', plays: [{ tier: 'gold', count: 1 }] } })).statusCode).toBe(400)
    expect((await app.inject({ method: 'POST', url: '/api/admin/v1/test/plays', payload: { reservationId: 'nope', plays: [{ tier: 'default', count: 1 }] } })).statusCode).toBe(404)
    expect((await app.inject({ method: 'POST', url: '/api/admin/v1/test/plays', payload: { reservationId: 'x', plays: [{ tier: 'default', count: 1, versionId: 7 }] } })).statusCode).toBe(400)
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
