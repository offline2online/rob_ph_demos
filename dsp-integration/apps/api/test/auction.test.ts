import Ajv2020 from 'ajv/dist/2020'
import type { Slot } from '@ph-dsp/types'
import { describe, expect, it } from 'vitest'
import { runAuction } from '../src/exchange/auction'
import type { BidRequest } from '../src/exchange/openrtb'
import { buildApp } from '../src/http/app'
import { expectMatchesContract } from './contract'
import { NOW, mockDsps, testContext } from './helpers'
import { OPENRTB_26_DOOH_REQUEST } from './openrtb-schema'

const GOOGLE = { authorization: 'Bearer poc-token-google-dv360' }
const W1 = new Date('2026-09-21T00:00:00.000Z')
const W2 = new Date('2026-09-22T00:00:00.000Z')

async function setup() {
  const mocks = mockDsps()
  const sent: { url: string; body: BidRequest }[] = []
  const fetchImpl: typeof mocks.fetchImpl = async (url, init) => {
    if (url.includes('/openrtb2/bid')) sent.push({ url, body: JSON.parse(String(init?.body)) })
    return mocks.fetchImpl(url, init)
  }
  const ctx = await testContext({ clock: () => NOW, dspFetch: fetchImpl })
  const app = buildApp(ctx)
  const bidder = (b: Record<string, unknown>) => mocks.app.inject({ method: 'PUT', url: '/_control/google_dv360/bidder', payload: b })
  const setSlot = (patch: Partial<Slot>) => {
    const ext = ctx.displayTypes.get('menu_board')!.phExtensions!
    ctx.displayTypes.saveExtensions('menu_board', { ...ext, slots: ext.slots.map((s, i) => (i === 1 ? { ...s, ...patch } : s)) })
  }
  const reserve = (body: Record<string, unknown>) => app.inject({ method: 'POST', url: '/api/v1/reservations', headers: GOOGLE, payload: body })
  const approve = (id: string, assetVersion = 'v1') => app.inject({ method: 'POST', url: `/api/admin/v1/campaigns/${id}/approve`, payload: { assetVersion } })
  const rows = (start = W1) => ctx.reservations.forWindow('menu_board.s2', start.toISOString())
  /* Only an approved and activated campaign can bid or win (Q14). */
  const activate = (id: string) => app.inject({ method: 'PUT', url: `/api/admin/v1/campaigns/${id}/activation`, payload: { enabled: true } })
  const queued = async (name: string) => (await ctx.approvalCampaigns.listCampaigns({ sources: ['dsp'] })).find((c) => c.name === name)!.campaignId
  return { ctx, app, mocks, sent, bidder, setSlot, reserve, approve, activate, queued, rows }
}

describe('OpenRTB 2.6 DOOH bid requests', () => {
  it('validate as OpenRTB 2.6 with DOOH and SupplyChain, carrying floor, audience and lists, and no visitor data', async () => {
    const { ctx, sent } = await setup()
    await runAuction(ctx, W1)
    expect(sent).toHaveLength(1)
    const { url, body } = sent[0]
    expect(url).toBe('http://mocks.test/dv360/openrtb2/bid')
    const validate = new Ajv2020({ strict: false, allErrors: true }).compile(OPENRTB_26_DOOH_REQUEST)
    expect(validate(body), JSON.stringify(validate.errors)).toBe(true)
    expect(body).toMatchObject({
      imp: [{
        id: '1', video: { w: 5760, h: 1080, minduration: 1, maxduration: 15 }, banner: { w: 5760, h: 1080 },
        bidfloor: 100, bidfloorcur: 'AUD', qty: { multiplier: 1236, sourcetype: 2 }, exp: 86400,
        ext: { ph: { orientation: 'landscape', slotDurationSec: 15, loopLengthSec: 45, shareOfVoice: 0.333 } },
      }],
      dooh: { id: 'menu_board', venuetype: ['retail.grocery'], venuetypetax: 1, publisher: { id: 'drg-4471', name: 'Demo Retail Group', domain: 'demoretail.example' } },
      source: { schain: { complete: 1, ver: '1.0', nodes: [{ asi: 'demoretail.example', sid: 'drg-4471', hp: 1 }] } },
      cur: ['AUD'], bcat: ['IAB13'], badv: [], tmax: 300, at: 1,
    })
    expect(body).not.toHaveProperty('user')
    expect(body).not.toHaveProperty('device')
    expect(JSON.stringify(body)).not.toMatch(/visitor|personalis|gender|age"|segment|sku|cv_/i)
  })

  it('sends the advertiser blacklist as domains (badv), and nothing until Exchange settings are complete', async () => {
    const { ctx, sent } = await setup()
    ctx.company.save({ ...ctx.company.get(), advertiserBlacklist: ['Swisse', 'redbull.com'], advertiserWhitelist: ['Nestlé'] })
    await runAuction(ctx, W1)
    expect(sent[0].body.badv).toEqual(['swisse.com', 'redbull.com'])
    ctx.exchange.save({ ...ctx.exchange.get(), sellerId: '' })
    await runAuction(ctx, W2)
    expect(sent).toHaveLength(1)
  })
})

describe('the auction', () => {
  it('discards a bid with an unknown creative and queues it; once approved it wins a later window, first price', async () => {
    const { ctx, app, rows, activate } = await setup()
    const first = await runAuction(ctx, W1)
    expect(first.positions).toEqual([{ positionId: 'menu_board.s2', bidRequests: 1, bids: 1, winner: null }])
    expect(rows()).toMatchObject([{ status: 'rejected', channel: 'openrtb', advertiserId: 'nestle', reason: 'New creative crid-5130001: approved automatically; it can compete from the next window.' }])
    /* Nestlé doesn't require approval, so the creative was approved automatically. */
    const queued = (await ctx.approvalCampaigns.listCampaigns({ sources: ['dsp'] })).find((c) => c.name === 'Nestlé — crid-5130001')!
    expect(await ctx.approvals.view(queued.campaignId)).toMatchObject({ status: 'approved', mode: 'auto' })
    expect(queued.creative).toMatchObject({ mimeType: 'image/png', width: 5760, height: 1080 })
    /* Approved but not yet activated: it can't win. */
    expect((await runAuction(ctx, new Date('2026-09-25T00:00:00.000Z'))).positions[0].winner).toBeNull()
    expect(rows(new Date('2026-09-25T00:00:00.000Z'))[0].reason).toBe('The campaign is approved but not activated.')
    await activate(queued.campaignId)

    const second = await runAuction(ctx, W2)
    expect(second.positions[0].winner).toMatchObject({ partnerId: 'p_google', advertiserId: 'nestle', clearingCpm: 150 })
    const avail = await app.inject({ method: 'GET', url: '/api/v1/inventory/menu_board.s2/availability?from=2026-09-22&to=2026-09-22', headers: GOOGLE })
    expect(avail.json().windows[0].status).toBe('sold')
    expect((await runAuction(ctx, W2)).positions[0].skipped).toBe('Already sold.')
  })

  it('keeps an unapproved creative out until the retailer approves it', async () => {
    const { ctx, bidder, approve, activate, rows } = await setup()
    await bidder({ advertiserId: '5130002' })
    await runAuction(ctx, W1)
    expect(rows()[0]).toMatchObject({ status: 'rejected', advertiserId: 'swisse', reason: 'New creative crid-5130002: queued for approval.' })
    const queued = (await ctx.approvalCampaigns.listCampaigns({ sources: ['dsp'] })).find((c) => c.name === 'Swisse — crid-5130002')!
    await runAuction(ctx, W2)
    expect(rows(W2)[0]).toMatchObject({ status: 'rejected', reason: 'The campaign is not approved.' })
    expect((await approve(queued.campaignId)).statusCode).toBe(200)
    await activate(queued.campaignId)
    const third = await runAuction(ctx, new Date('2026-09-23T00:00:00.000Z'))
    expect(third.positions[0].winner).toMatchObject({ advertiserId: 'swisse', clearingCpm: 150 })
  })

  it('enforces the effective floor, the blacklist, whitelist-only and categories before a bid can win', async () => {
    const { ctx, bidder, setSlot, rows, activate, queued } = await setup()
    await runAuction(ctx, W1)
    await activate(await queued('Nestlé — crid-5130001'))
    const reason = async (start: Date) => {
      await runAuction(ctx, start)
      return rows(start)[0].reason
    }
    await bidder({ mode: 'below_floor' })
    /* Half the sent floor of 100 is 50; Nestlé's own floor is 100 × 0.8. */
    expect(await reason(W2)).toBe('50 is below the effective floor of 80 AUD CPM.')
    await bidder({ mode: 'bid', priceCpm: 150 })
    ctx.company.save({ ...ctx.company.get(), advertiserBlacklist: ['Nestlé'], advertiserWhitelist: ['Swisse'] })
    expect(await reason(new Date('2026-09-23T00:00:00.000Z'))).toBe('Nestlé is on the advertiser blacklist.')
    ctx.company.save({ ...ctx.company.get(), advertiserBlacklist: [], advertiserWhitelist: ['Swisse'] })
    setSlot({ listMode: 'whitelist_only' })
    expect(await reason(new Date('2026-09-24T00:00:00.000Z'))).toBe('Nestlé is not on the advertiser whitelist for this whitelist-only position.')
    setSlot({ listMode: 'rtb' })
    ctx.company.save({ ...ctx.company.get(), categoryBlacklist: ['Food & Drink'] })
    expect(await reason(new Date('2026-09-25T00:00:00.000Z'))).toBe('Category IAB8 is on the category blacklist.')
    ctx.company.save({ ...ctx.company.get(), categoryBlacklist: [] })
    await bidder({ adomain: 'unknown.example' })
    expect(await reason(new Date('2026-09-26T00:00:00.000Z'))).toBe('Unknown advertiser (unknown.example): not one of Google DSP’s advertisers.')
  })

  it('never lets a Test-mode win take the window', async () => {
    const { ctx, rows, activate, queued } = await setup()
    await runAuction(ctx, W1)
    await activate(await queued('Nestlé — crid-5130001'))
    ctx.partners.update('p_google', { mode: 'test' })
    const res = await runAuction(ctx, W2)
    expect(res.positions[0].winner).toBeNull()
    expect(rows(W2)[0]).toMatchObject({ status: 'won', testMode: true })
    const view = await buildApp(ctx).inject({ method: 'GET', url: '/api/v1/inventory/menu_board.s2/availability?from=2026-09-22&to=2026-09-22', headers: GOOGLE })
    expect(view.json().windows[0].status).toBe('available')
  })
})

describe('POST /v1/reservations and GET …/{id}', () => {
  const BID = { positionId: 'menu_board.s2', windowStart: '2026-09-21T00:00:00.000Z', campaignId: 'c_api_swisse', advertiserId: 'swisse', type: 'bid', bidCpm: 200 }

  it('takes a bid for an approved campaign, and the auction clears it against DSP bids', async () => {
    const { ctx, app, approve, activate, queued, reserve } = await setup()
    await runAuction(ctx, new Date('2026-09-25T00:00:00.000Z'))
    await activate(await queued('Nestlé — crid-5130001'))
    await approve('c_api_swisse')
    await activate('c_api_swisse')
    const res = await reserve(BID)
    expect(res.statusCode).toBe(201)
    expectMatchesContract('POST', '/v1/reservations', 201, res.json())
    expect(res.json()).toMatchObject({ status: 'pending', clearingCpm: null, currency: 'AUD', reason: null })
    const out = await runAuction(ctx, W1)
    expect(out.positions[0].winner).toMatchObject({ advertiserId: 'swisse', clearingCpm: 200 })
    const got = await app.inject({ method: 'GET', url: `/api/v1/reservations/${res.json().reservationId}`, headers: GOOGLE })
    expectMatchesContract('GET', '/v1/reservations/{reservationId}', 200, got.json())
    expect(got.json()).toMatchObject({ status: 'won', clearingCpm: 200 })
    expect(ctx.reservations.forWindow('menu_board.s2', BID.windowStart).find((r) => r.channel === 'openrtb')).toMatchObject({ status: 'lost', reason: 'Outbid: the window cleared at 200 AUD CPM.' })
    expect((await reserve(BID)).statusCode).toBe(409)
  })

  it('refuses before the auction: not approved, below the floor, blacklisted', async () => {
    const { ctx, approve, activate, reserve } = await setup()
    const refused = async (body: Record<string, unknown>) => {
      const res = await reserve({ ...BID, ...body })
      expect(res.statusCode).toBe(422)
      expectMatchesContract('POST', '/v1/reservations', 422, res.json())
      return [res.json().error.code, res.json().error.message]
    }
    expect(await refused({})).toEqual(['not_approved', 'The campaign is not approved.'])
    await approve('c_api_swisse')
    expect(await refused({})).toEqual(['not_approved', 'The campaign is approved but not activated.'])
    await activate('c_api_swisse')
    expect(await refused({ bidCpm: 99 })).toEqual(['below_floor', '99 is below the effective floor of 100 AUD CPM.'])
    ctx.company.save({ ...ctx.company.get(), advertiserBlacklist: ['Swisse'], advertiserWhitelist: [] })
    expect(await refused({})).toEqual(['advertiser_blocked', 'Swisse is on the advertiser blacklist.'])
  })

  it('reserves a position held for the advertiser at the price agreed through the DSP (Q11)', async () => {
    const { ctx, approve, activate, reserve, setSlot } = await setup()
    await approve('c_api_swisse')
    await activate('c_api_swisse')
    setSlot({ listMode: null, advertiser: 'Swisse' })
    expect((await reserve(BID)).statusCode).toBe(409)
    const noPrice = await reserve({ ...BID, type: 'reserve', bidCpm: undefined })
    expect(noPrice.json().error.details).toEqual([{ field: 'bidCpm', reason: 'The agreed reservation price (CPM) is required.' }])
    const cheap = await reserve({ ...BID, type: 'reserve', bidCpm: 90 })
    expect(cheap.json().error).toMatchObject({ code: 'below_floor', message: '90 is below the effective floor of 100 AUD CPM.' })
    const res = await reserve({ ...BID, type: 'reserve', bidCpm: 175 })
    expect(res.statusCode).toBe(201)
    expect(res.json()).toMatchObject({ status: 'reserved', clearingCpm: 175, currency: 'AUD' })
    expect((await runAuction(ctx, W1)).positions[0].skipped).toBe('Held for a named advertiser: booked by reservation.')
    expect((await reserve({ ...BID, type: 'reserve' })).statusCode).toBe(409)
  })

  it('only takes bids while the window’s auction is open (Q13): from 7 days before until the auction runs 6 hours before', async () => {
    const { reserve, approve, activate } = await setup()
    await approve('c_api_swisse')
    await activate('c_api_swisse')
    const early = await reserve({ ...BID, windowStart: '2026-09-28T00:00:00.000Z' })
    expect(early.statusCode).toBe(409)
    expectMatchesContract('POST', '/v1/reservations', 409, early.json())
    expect(early.json().error.message).toBe('Bidding for that window opens at 2026-09-21T00:00:00.000Z.')
    expect((await reserve({ ...BID, windowStart: '2026-09-27T00:00:00.000Z' })).statusCode).toBe(201)
  })

  it('refuses a bid once the window’s auction has run', async () => {
    const ctx = await testContext({ clock: () => new Date('2026-09-20T18:00:00.000Z') })
    const app = buildApp(ctx)
    await app.inject({ method: 'POST', url: '/api/admin/v1/campaigns/c_api_swisse/approve', payload: { assetVersion: 'v1' } })
    await app.inject({ method: 'PUT', url: '/api/admin/v1/campaigns/c_api_swisse/activation', payload: { enabled: true } })
    const late = await app.inject({ method: 'POST', url: '/api/v1/reservations', headers: GOOGLE, payload: BID })
    expect(late.statusCode).toBe(409)
    expect(late.json().error.message).toBe('Bidding for that window closed at 2026-09-20T18:00:00.000Z, when its auction ran.')
  })

  it('validates the request, and hides other partners’ reservations', async () => {
    const { app, reserve } = await setup()
    const res = await reserve({ positionId: 'menu_board.s1', windowStart: '2026-09-21T06:00:00.000Z', campaignId: 'c_dsp_loreal', advertiserId: 'loreal', type: 'bid' })
    expect(res.statusCode).toBe(400)
    expectMatchesContract('POST', '/v1/reservations', 400, res.json())
    expect(res.json().error.details.map((d: { field: string }) => d.field)).toEqual(['advertiserId', 'bidCpm', 'campaignId', 'positionId', 'windowStart'])
    const past = await reserve({ ...BID, windowStart: '2026-09-20T00:00:00.000Z' })
    expect(past.json().error.details).toEqual([{ field: 'windowStart', reason: 'That window can no longer be sold.' }])
    const other = await app.inject({ method: 'GET', url: '/api/v1/reservations/res_nope', headers: GOOGLE })
    expect(other.statusCode).toBe(404)
    expectMatchesContract('GET', '/v1/reservations/{reservationId}', 404, other.json())
  })
})
