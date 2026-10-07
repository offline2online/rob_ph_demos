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

  it('bandwidth protection: in the restricted window only a cached creative can win; outside it, or off, everything bids as normal', async () => {
    const { ctx, signal, displayId } = await setup()
    const crid = ((await ctx.impressions.get((await signal()).json().impressionId))!).crid as string
    const set = async (patch: Record<string, unknown>) => ctx.company.save({ ...(await ctx.company.get()), ...patch } as any)
    /* NOW is inside a fixed window: an uncached creative is passed over, a cached one plays, and a missing list means none cached. */
    const h = NOW.getUTCHours()
    const hh = (n: number) => `${String((n + 24) % 24).padStart(2, '0')}:00`
    await set({ uncachedRestriction: 'fixed', uncachedRestrictionStart: hh(h - 1), uncachedRestrictionEnd: hh(h + 1) })
    expect((await signal()).json()).toMatchObject({ status: 'no_fill', reason: expect.stringContaining('Restricted window') })
    expect((await signal({ displayId, slot: 2, cachedCrids: ['other'] })).json().status).toBe('no_fill')
    expect((await signal({ displayId, slot: 2, cachedCrids: [crid] })).json()).toMatchObject({ status: 'filled', clearingCpm: 150 })
    /* Outside the window: as normal. */
    await set({ uncachedRestrictionStart: hh(h + 2), uncachedRestrictionEnd: hh(h + 3) })
    expect((await signal()).json().status).toBe('filled')
    /* Store trading hours: restricted only while the player says the store is open; a missing signal never blocks. */
    await set({ uncachedRestriction: 'store_open' })
    expect((await signal({ displayId, slot: 2, storeOpen: true })).json().status).toBe('no_fill')
    expect((await signal({ displayId, slot: 2, storeOpen: true, cachedCrids: [crid] })).json().status).toBe('filled')
    expect((await signal({ displayId, slot: 2, storeOpen: false })).json().status).toBe('filled')
    expect((await signal()).json().status).toBe('filled')
    /* Off: never restricted. */
    await set({ uncachedRestriction: 'off' })
    expect((await signal({ displayId, slot: 2, storeOpen: true })).json().status).toBe('filled')
    /* Bad input is refused. */
    expect((await signal({ displayId, slot: 2, cachedCrids: 'x' })).statusCode).toBe(400)
    expect((await signal({ displayId, slot: 2, storeOpen: 'yes' })).statusCode).toBe(400)
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

  it('serves a creative PH has not seen at bid time, without waiting for approval, and reviews it after the play', async () => {
    const { mocks, signal, played, ctx, displayId } = await setup()
    await mocks.app.inject({ method: 'PUT', url: '/_control/google_dv360/bidder', payload: { advertiserId: '5130002' } })
    const known = (await ctx.approvalCampaigns.listCampaigns({ sources: ['dsp'] })).length
    const fill = (await signal()).json()
    /* Filled from the DSP's own creative URL; nothing was retrieved or queued inside tmax. */
    expect(fill).toMatchObject({ status: 'filled', creativeSource: 'at_bid', creative: { campaignId: null, source: 'at_bid', url: expect.stringContaining('/creatives/') } })
    expect(await ctx.approvalCampaigns.listCampaigns({ sources: ['dsp'] })).toHaveLength(known)

    /* The play is reported: now PH retrieves it and the approval gate sees it. */
    const done = (await played(fill.impressionId)).json()
    expect(done.status).toBe('played')
    const after = await ctx.approvalCampaigns.listCampaigns({ sources: ['dsp'] })
    expect(after).toHaveLength(known + 1)
    const rec = (await ctx.impressions.get(fill.impressionId))!
    expect(rec.campaignId).toMatch(/^c_dsp_/)
    expect(rec.contentHash).toMatch(/^[0-9a-f]{64}$/)
    expect(rec.reviewNote).toMatch(/New creative/)
    expect(ctx.db.prepare('SELECT display_id FROM plays WHERE campaign_id = ?').all(rec.campaignId)).toEqual([{ display_id: displayId }])
    expect(['awaiting_approval', 'approved']).toContain(await ctx.approvals.statusOf(rec.campaignId as string))
  })

  it('a creative still in review keeps playing; a rejection stops it and blocks its content hash everywhere', async () => {
    const { mocks, signal, played, ctx } = await setup()
    await mocks.app.inject({ method: 'PUT', url: '/_control/google_dv360/bidder', payload: { advertiserId: '5130002' } })
    const first = (await signal()).json()
    await played(first.impressionId)
    const rec = (await ctx.impressions.get(first.impressionId))!
    const campaignId = rec.campaignId as string
    expect(await ctx.approvals.statusOf(campaignId)).toBe('awaiting_approval')

    /* Awaiting its post-play review: it plays again, from PH's own copy. */
    const second = (await signal()).json()
    expect(second).toMatchObject({ status: 'filled', creativeSource: 'under_review', creative: { campaignId } })

    /* A reviewer rejects it. */
    await ctx.approvals.reject(campaignId, (await ctx.approvals.view(campaignId)).assetVersion, 'reviewer@retailer.example', 'Not suitable.')
    const third = (await signal()).json()
    expect(third).toMatchObject({ status: 'no_fill' })
    expect(third.reason).toMatch(/rejected|No bid cleared/)
    /* Blocked by content hash, for any crid, DSP or advertiser. */
    expect(await ctx.dspCreatives.blockedBy(rec.contentHash as string)).toBe(campaignId)
    /* Un-rejecting lifts the block. */
    await ctx.approvals.unreject(campaignId, (await ctx.approvals.view(campaignId)).assetVersion, 'reviewer@retailer.example')
    expect(await ctx.dspCreatives.blockedBy(rec.contentHash as string)).toBeNull()
  })

  it('does not review an approved creative again: identical bytes under a stale label resolve to the approved creative', async () => {
    const { ctx, signal, played } = await setup()
    const before = await ctx.approvalCampaigns.listCampaigns({ sources: ['dsp'] })
    const approvedId = (ctx.db.prepare("SELECT campaign_id FROM dsp_creatives WHERE partner_id = 'p_google' AND campaign_id <> ''").get() as { campaign_id: string }).campaign_id
    expect(await ctx.approvals.statusOf(approvedId)).toBe('approved')
    /* The label's last fetch-and-hash is old, so the crid can no longer be trusted without a fresh look: it plays at bid time. */
    ctx.db.prepare("UPDATE dsp_creatives SET verified_at = '2000-01-01T00:00:00.000Z'").run()
    const fill = (await signal()).json()
    expect(fill).toMatchObject({ status: 'filled', creativeSource: 'at_bid' })
    await played(fill.impressionId)
    const rec = (await ctx.impressions.get(fill.impressionId))!
    expect(rec.campaignId).toBe(approvedId)
    expect(rec.reviewNote).toMatch(/identical to creative .*already approved/)
    expect(await ctx.approvalCampaigns.listCampaigns({ sources: ['dsp'] })).toHaveLength(before.length)
    expect(await ctx.approvals.statusOf(approvedId)).toBe('approved')
  })

  it('refuses an at-bid creative that is not under the DSP’s own creative host', async () => {
    const { ctx, signal } = await setup()
    ctx.db.prepare("UPDATE dsp_creatives SET verified_at = '2000-01-01T00:00:00.000Z'").run()
    const real = ctx.bidder.send.bind(ctx.bidder)
    ctx.bidder.send = async (url, req, o) => {
      const res = await real(url, req, o)
      for (const sb of res?.seatbid ?? []) for (const b of sb.bid ?? []) b.iurl = 'https://evil.example/creatives/x.png'
      return res
    }
    const out = (await signal()).json()
    expect(out.status).toBe('no_fill')
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
