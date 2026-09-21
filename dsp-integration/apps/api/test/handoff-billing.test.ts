import { describe, expect, it } from 'vitest'
import { runAuction } from '../src/exchange/auction'
import { lineItems, runBilling } from '../src/exchange/billing'
import { handOff } from '../src/exchange/handoff'
import { buildApp } from '../src/http/app'
import type { ReservationRecord } from '../src/repos/ReservationRepo'
import { NOW, mockDsps, testContext } from './helpers'
import { multipart, png } from './media'

const W1 = new Date('2026-09-21T00:00:00.000Z')
const W2 = new Date('2026-09-22T00:00:00.000Z')

const won = (over: Partial<ReservationRecord>): ReservationRecord => ({
  id: `res_t_${Math.random().toString(16).slice(2, 8)}`, partnerId: 'p_google', advertiserId: 'swisse', campaignId: 'c_api_swisse', positionId: 'menu_board.s2',
  windowStart: W1.toISOString(), type: 'bid', channel: 'api', bidCpm: 150, currency: 'AUD', status: 'won', clearingCpm: 150, reason: null,
  testMode: false, pricingType: 'localised', handedOffAt: null, ...over,
})

async function setup(clock = () => NOW) {
  const mocks = mockDsps()
  const ctx = await testContext({ clock, dspFetch: mocks.fetchImpl })
  const app = buildApp(ctx)
  const activate = (id: string) => app.inject({ method: 'PUT', url: `/api/admin/v1/campaigns/${id}/activation`, payload: { enabled: true } })
  return { ctx, app, mocks, activate }
}

describe('hand-off to the existing campaign system', () => {
  it('books the winning, approved campaign into the slot for its window', async () => {
    const { ctx, activate } = await setup()
    await runAuction(ctx, W1)
    await activate((await ctx.approvalCampaigns.listCampaigns({ sources: ['dsp'] })).find((c) => c.name === 'Nestlé — crid-5130001')!.campaignId)
    const res = await runAuction(ctx, W2)
    const r = ctx.reservations.get(res.positions[0].winner!.reservationId)!
    expect(r.handedOffAt).toBe(NOW.toISOString())
    const campaignId = r.campaignId as string
    expect(ctx.campaigns.bookings(campaignId)).toMatchObject([{ displayTypeId: 'menu_board', slot: 2, windowStart: '2026-09-22T00:00:00.000Z', windowEnd: '2026-09-23T00:00:00.000Z' }])
  })

  it('never hands off a Test-mode win', async () => {
    const { ctx } = await setup()
    await runAuction(ctx, W1)
    ctx.partners.update('p_google', { mode: 'test' })
    await runAuction(ctx, W2)
    expect(ctx.campaigns.bookings().filter((b) => b.windowStart === W2.toISOString())).toEqual([])
  })

  it('hands a reservation off as soon as it is booked', async () => {
    const { ctx, app, activate } = await setup()
    const G = { authorization: 'Bearer poc-token-google-dv360' }
    const id = (await app.inject({ method: 'POST', url: '/api/v1/campaigns', headers: G, payload: { advertiserId: 'swisse', name: 'Swisse — Menu', displayTypeId: 'menu_board', baseline: { pricingType: 'localised' } } })).json().campaignId
    const m = multipart({ version: 'baseline' }, { name: 'menu.png', bytes: png(5760, 1080) })
    await app.inject({ method: 'POST', url: `/api/v1/campaigns/${id}/assets`, headers: { ...G, ...m.headers }, payload: m.payload })
    await app.inject({ method: 'POST', url: `/api/v1/campaigns/${id}/submit`, headers: G })
    await app.inject({ method: 'POST', url: `/api/admin/v1/campaigns/${id}/approve`, payload: { assetVersion: 'v1' } })
    await activate(id)
    const ext = ctx.displayTypes.get('menu_board')!.phExtensions!
    ctx.displayTypes.saveExtensions('menu_board', { ...ext, slots: ext.slots.map((s, i) => (i === 1 ? { ...s, listMode: null, advertisers: ['Swisse'] } : s)) })
    const res = await app.inject({ method: 'POST', url: '/api/v1/reservations', headers: G, payload: { positionId: 'menu_board.s2', windowStart: W1.toISOString(), campaignId: id, advertiserId: 'swisse', type: 'reserve', bidCpm: 100 } })
    expect(res.json()).toMatchObject({ status: 'reserved', clearingCpm: 100 })
    expect(ctx.reservations.get(res.json().reservationId)!.handedOffAt).toBe(NOW.toISOString())
    expect(ctx.campaigns.bookings(id)).toMatchObject([{ displayTypeId: 'menu_board', slot: 2, windowStart: W1.toISOString() }])
  })

  it('refuses a campaign that is no longer approved, or whose creative doesn’t fit the display type', async () => {
    const { ctx, app, activate } = await setup()
    const draft = await handOff(ctx, ctx.reservations.insert(won({ campaignId: 'c_api_swisse_kids' })))
    expect(draft).toMatchObject({ handedOffAt: null, reason: 'Not handed off: the campaign is not approved.' })
    await app.inject({ method: 'POST', url: '/api/admin/v1/campaigns/c_api_swisse/approve', payload: { assetVersion: 'v1' } })
    const inactive = await handOff(ctx, ctx.reservations.insert(won({})))
    expect(inactive.reason).toBe('Not handed off: the campaign is approved but not activated.')
    await activate('c_api_swisse')
    /* Swisse's approved creative is 1080×1920 portrait; the Menu Board is 5760×1080. */
    const portrait = await handOff(ctx, ctx.reservations.insert(won({})))
    expect(portrait.handedOffAt).toBeNull()
    expect(portrait.reason).toMatch(/^Not handed off: the creative doesn’t fit Menu Board — Long Format: /)
    expect(ctx.campaigns.bookings('c_api_swisse')).toEqual([])
  })
})

describe('billing — dynamic VAC-d from existing playback data', () => {
  it('bills the CPM against the assumed views that actually played', async () => {
    const { ctx } = await setup()
    const plays = () => (ctx.db.prepare('SELECT COUNT(*) AS n FROM plays').get() as { n: number }).n
    const before = plays()
    /* Seeded 15 Sep window: 1,920 + 960 plays of 15s on three Menu Boards
       (one offline) = half the slot's expected time, so half its VAC-d. */
    expect(runBilling(ctx)).toMatchObject([{
      reservationId: 'res_seed_nestle_0915', advertiserId: 'nestle', campaignId: 'c_dsp_nestle', positionId: 'menu_board.s2',
      windowStart: '2026-09-15T00:00:00.000Z', windowEnd: '2026-09-16T00:00:00.000Z',
      plays: 2880, playedSec: 43200, expectedSec: 86400, assumedViews: 1236, realisedViews: 618, cpm: 120, currency: 'AUD', amount: 74.16,
    }])
    expect(runBilling(ctx)).toEqual([])
    expect(lineItems(ctx)).toHaveLength(1)
    /* Read only: billing never writes playback data. */
    expect(plays()).toBe(before)
  })

  it('bills nothing for a Test-mode win, a window not handed off, or a window not over yet', async () => {
    const { ctx } = await setup()
    const past = '2026-09-16T00:00:00.000Z'
    ctx.reservations.insert(won({ windowStart: past, testMode: true, handedOffAt: past }))
    ctx.reservations.insert(won({ windowStart: past, handedOffAt: null }))
    ctx.reservations.insert(won({ windowStart: '2026-09-20T00:00:00.000Z', handedOffAt: past }))
    expect(runBilling(ctx).map((i) => i.reservationId)).toEqual(['res_seed_nestle_0915'])
  })

  it('caps a window at the assumed views it was sold on', async () => {
    const { ctx } = await setup()
    const start = Date.parse('2026-09-17T00:00:00.000Z')
    ctx.reservations.insert(won({ id: 'res_full', windowStart: '2026-09-17T00:00:00.000Z', campaignId: 'c_dsp_nestle', advertiserId: 'nestle', clearingCpm: 100, handedOffAt: '2026-09-16T18:00:00.000Z' }))
    const play = ctx.db.prepare("INSERT INTO plays (id, display_id, campaign_id, played_at, duration_sec) VALUES (?, ?, 'c_dsp_nestle', ?, 15)")
    for (const d of ['d_1004', 'd_1005', 'd_1006']) for (let i = 0; i < 2000; i++) play.run(`x_${d}_${i}`, d, new Date(start + i * 43_000).toISOString())
    const item = runBilling(ctx).find((i) => i.reservationId === 'res_full')!
    expect(item).toMatchObject({ realisedViews: 1236, amount: 123.6 })
  })
})
