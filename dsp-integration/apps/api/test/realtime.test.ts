import { describe, expect, it } from 'vitest'
import { runAuction } from '../src/exchange/auction'
import { buildApp } from '../src/http/app'
import { NOW, mockDsps, testContext } from './helpers'

const PLAYER = { authorization: 'Bearer poc-token-player' }
const GOOGLE = { authorization: 'Bearer poc-token-google-dv360' }
const W1 = new Date('2026-09-21T00:00:00.000Z')

/* The mock DSP's creative has to be known and approved before it can fill a real-time impression (no creative is fetched inside tmax), so one advance auction on slot 2 runs first and introduces it. */
async function setup(opts: { realtime?: boolean } = {}) {
  const mocks = mockDsps()
  const sent: { url: string; body: Record<string, any> }[] = []
  const fetchImpl: typeof mocks.fetchImpl = async (url, init) => {
    if (url.includes('/openrtb2/bid')) sent.push({ url, body: JSON.parse(String(init?.body)) })
    return mocks.fetchImpl(url, init)
  }
  const ctx = await testContext({ clock: () => NOW, dspFetch: fetchImpl })
  const app = buildApp(ctx)
  await runAuction(ctx, W1)
  const setMode = async (bidMode: 'advance' | 'realtime') => {
    const ext = (await ctx.displayTypes.get('menu_board'))!.phExtensions!
    await ctx.displayTypes.saveExtensions('menu_board', { ...ext, slots: ext.slots.map((s, i) => (i === 1 ? { ...s, bidMode } : s)) })
  }
  if (opts.realtime !== false) await setMode('realtime')
  const displayId = ((await ctx.displays.listByDisplayType('menu_board'))[0]).id
  sent.length = 0
  const signal = (body: Record<string, unknown> = { displayId, slot: 2 }) => app.inject({ method: 'POST', url: '/api/player/v1/impressions', headers: PLAYER, payload: body })
  const played = (id: string, payload: Record<string, unknown> = {}) => app.inject({ method: 'POST', url: `/api/player/v1/impressions/${id}/played`, headers: PLAYER, payload })
  return { ctx, app, mocks, sent, setMode, displayId, signal, played }
}

describe('real-time (player-triggered) bidding', () => {
  it('fills an impression within tmax, first price, and logs the proof of play once', async () => {
    const { ctx, sent, signal, played, displayId } = await setup()
    const res = await signal()
    expect(res.statusCode).toBe(200)
    const fill = res.json()
    expect(fill).toMatchObject({ status: 'filled', clearingCpm: 150, creative: { mimeType: 'image/png' } })
    expect(fill.creative.campaignId).toMatch(/^c_dsp_/)
    /* The request is the advance auction's, cut to the impression. */
    expect(sent).toHaveLength(1)
    expect(sent[0].body).toMatchObject({ tmax: 200, imp: [{ exp: 120, ext: { ph: { mode: 'realtime' } } }] })
    expect(sent[0].body).not.toHaveProperty('user')
    expect(await ctx.impressions.get(fill.impressionId)).toMatchObject({ status: 'filled', partnerId: 'p_google', advertiserId: 'nestle', displayId, positionId: 'menu_board.s2' })

    const done = await played(fill.impressionId, { durationSec: 15 })
    expect(done.statusCode).toBe(200)
    expect(done.json().status).toBe('played')
    expect(ctx.db.prepare('SELECT campaign_id, display_id, duration_sec FROM plays WHERE campaign_id = ?').all(fill.creative.campaignId)).toEqual([{ campaign_id: fill.creative.campaignId, display_id: displayId, duration_sec: 15 }])
    /* Once only. */
    expect((await played(fill.impressionId)).statusCode).toBe(409)
  })

  it('runs one fresh auction per play: one win is one play, and nothing is held for the next', async () => {
    const { ctx, sent, signal, played } = await setup()
    const booked = () => (ctx.db.prepare('SELECT COUNT(*) AS n FROM reservations').get() as { n: number }).n
    const before = booked()
    const first = (await signal()).json()
    expect(first.status).toBe('filled')
    expect(sent).toHaveLength(1)
    expect((await played(first.impressionId)).statusCode).toBe(200)
    const second = (await signal()).json()
    expect(second.status).toBe('filled')
    /* The next play called its own auction: a new auction (impression) id and a new bid request id, and the DSP was asked again. */
    expect(second.impressionId).not.toBe(first.impressionId)
    expect(sent).toHaveLength(2)
    expect(sent[1].body.id).not.toBe(sent[0].body.id)
    /* One win, one play: the first win cannot be played twice, nor the second one counted for the first. */
    expect((await played(first.impressionId)).statusCode).toBe(409)
    expect((await played(second.impressionId)).statusCode).toBe(200)
    expect(ctx.db.prepare("SELECT COUNT(*) AS n FROM plays WHERE id LIKE 'rtp_%'").get()).toEqual({ n: 2 })
    /* No block: nothing is booked, so nothing is held across plays. */
    expect(booked()).toBe(before)
    expect((await ctx.impressions.forPosition('menu_board.s2')).map((i) => i.status)).toEqual(['played', 'played'])
  })

  it('answers no_fill when no bid clears: the bidder says no bid, or bids below the floor', async () => {
    const { mocks, signal } = await setup()
    await mocks.app.inject({ method: 'PUT', url: '/_control/google_dv360/bidder', payload: { mode: 'no_bid' } })
    expect((await signal()).json()).toMatchObject({ status: 'no_fill', reason: 'No bid cleared within tmax.' })
    await mocks.app.inject({ method: 'PUT', url: '/_control/google_dv360/bidder', payload: { mode: 'below_floor' } })
    expect((await signal()).json().status).toBe('no_fill')
  })

  it('never fetches a creative inside tmax: a creative PH has not approved cannot fill', async () => {
    const { mocks, signal, ctx } = await setup()
    await mocks.app.inject({ method: 'PUT', url: '/_control/google_dv360/bidder', payload: { advertiserId: '5130002' } })
    const known = (await ctx.approvalCampaigns.listCampaigns({ sources: ['dsp'] })).length
    const res = (await signal()).json()
    expect(res.status).toBe('no_fill')
    expect(await ctx.approvalCampaigns.listCampaigns({ sources: ['dsp'] })).toHaveLength(known)
  })

  it('answers no_fill when the bidder is slower than tmax', async () => {
    const { ctx, signal } = await setup()
    ctx.bidder.send = () => new Promise((resolve) => setTimeout(() => resolve({ id: 'late', cur: 'USD', seatbid: [] }), 1500))
    const t0 = Date.now()
    const res = (await signal()).json()
    expect(res.status).toBe('no_fill')
    expect(Date.now() - t0).toBeLessThan(900)
  })

  it('leaves advance positions unaffected: the window auction skips a real-time one and still sells an advance one', async () => {
    const { ctx, app, setMode, signal } = await setup()
    const W2 = new Date('2026-09-22T00:00:00.000Z')
    expect((await runAuction(ctx, W2)).positions.find((p) => p.positionId === 'menu_board.s2')).toMatchObject({ skipped: expect.stringContaining('real time'), bidRequests: 0 })
    const avail = await app.inject({ method: 'GET', url: '/api/v1/inventory/menu_board.s2/availability?from=2026-09-22&to=2026-09-22', headers: GOOGLE })
    expect(avail.json().windows[0].status).toBe('unavailable')
    await setMode('advance')
    expect((await signal()).statusCode).toBe(409)
    const again = await runAuction(ctx, new Date('2026-09-23T00:00:00.000Z'))
    expect(again.positions.find((p) => p.positionId === 'menu_board.s2')).toMatchObject({ winner: { advertiserId: 'nestle' } })
  })

  it('refuses window bookings on a real-time position and writes nothing to reservations', async () => {
    const { ctx, app, signal } = await setup()
    const before = (ctx.db.prepare('SELECT COUNT(*) AS n FROM reservations').get() as { n: number }).n
    await signal()
    expect((ctx.db.prepare('SELECT COUNT(*) AS n FROM reservations').get() as { n: number }).n).toBe(before)
    const campaignId = (await ctx.approvalCampaigns.listCampaigns({ sources: ['dsp'] }))[0].campaignId
    const res = await app.inject({ method: 'POST', url: '/api/v1/reservations', headers: GOOGLE, payload: { type: 'bid', positionId: 'menu_board.s2', windowStart: '2026-09-22T00:00:00.000Z', advertiserId: 'nestle', campaignId, bidCpm: 200 } })
    expect(res.statusCode).toBe(409)
    expect(res.json().error.message).toMatch(/real time/)
  })

  it('needs the player token, valid input, a known display and a real-time position', async () => {
    const { app, signal, displayId } = await setup()
    expect((await app.inject({ method: 'POST', url: '/api/player/v1/impressions', payload: { displayId, slot: 2 } })).statusCode).toBe(401)
    expect((await app.inject({ method: 'POST', url: '/api/player/v1/impressions', headers: GOOGLE, payload: { displayId, slot: 2 } })).statusCode).toBe(401)
    expect((await signal({ displayId, slot: 0 })).statusCode).toBe(400)
    expect((await signal({ displayId: 'nope', slot: 2 })).statusCode).toBe(404)
    expect((await signal({ displayId, slot: 1 })).statusCode).toBe(404) // not an Advertiser slot
  })

  it('a position is real-time only by an Advertiser slot’s bidMode, saved from the slot editor', async () => {
    const { ctx, app } = await setup({ realtime: false })
    const ext = (await ctx.displayTypes.get('menu_board'))!.phExtensions!
    const base = ext.slots.map((s) => (s.owner === 'retail' ? { ...s, owner: 'internal' as const } : s))
    const put = (slots: unknown[]) => app.inject({ method: 'PUT', url: '/api/admin/v1/display-types/menu_board/extensions', payload: { ...ext, slots } })
    const bad = await put(base.map((s, i) => (i === 0 ? { ...s, owner: 'internal', bidMode: 'realtime' } : s)))
    expect(bad.statusCode).toBe(400)
    expect(JSON.stringify(bad.json())).toMatch(/Only an Advertiser slot/)
    const ok = await put(base.map((s, i) => (i === 1 ? { ...s, bidMode: 'realtime' } : s)))
    expect(ok.statusCode).toBe(200)
    expect(ok.json().slots[1].bidMode).toBe('realtime')
    expect(ok.json().slots[0].bidMode).toBeUndefined()
    /* Saving it again without bidMode puts the slot back on the window path. */
    expect((await put(base)).json().slots[1].bidMode).toBeUndefined()
  })
})
