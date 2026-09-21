import { describe, expect, it } from 'vitest'
import { buildMocks } from '../src/app'

describe('mock DSP control API', () => {
  it('adds and removes seats and advertisers, and resets to the seed', async () => {
    const { app } = buildMocks()
    expect((await app.inject({ method: 'POST', url: '/_control/the_trade_desk/seats', payload: { seatId: 'ttd-2', name: 'Second seat' } })).statusCode).toBe(201)
    const add = await app.inject({ method: 'POST', url: '/_control/the_trade_desk/advertisers', payload: { name: 'Coca-Cola', seatId: 'ttd-2', domain: 'coca-cola.com', categories: ['Food & Drink'] } })
    expect(add.statusCode).toBe(201)
    expect((await app.inject({ method: 'DELETE', url: '/_control/the_trade_desk/seats/ttd-2' })).statusCode).toBe(409)
    expect((await app.inject({ method: 'POST', url: '/_control/the_trade_desk/advertisers', payload: { name: 'X', seatId: 'nope' } })).statusCode).toBe(400)
    await app.inject({ method: 'DELETE', url: `/_control/the_trade_desk/advertisers/${add.json().id}` })
    expect((await app.inject({ method: 'DELETE', url: '/_control/the_trade_desk/seats/ttd-2' })).statusCode).toBe(200)
    await app.inject({ method: 'POST', url: '/_control/google_dv360/seats', payload: { seatId: 'x' } })
    await app.inject({ method: 'POST', url: '/_control/reset' })
    expect((await app.inject({ method: 'GET', url: '/_control/google_dv360' })).json().seats).toHaveLength(2)
  })

  it('serves the test page', async () => {
    const res = await buildMocks().app.inject({ method: 'GET', url: '/' })
    expect(res.headers['content-type']).toMatch(/text\/html/)
    expect(res.body).toContain('Mock DSPs')
  })
})

describe('mock DV360 API', () => {
  it('requires an OAuth token and the JWT-bearer grant', async () => {
    const { app } = buildMocks()
    const noAuth = await app.inject({ method: 'GET', url: '/dv360/v4/advertisers?partnerId=884512' })
    expect(noAuth.statusCode).toBe(401)
    expect(noAuth.json().error.status).toBe('UNAUTHENTICATED')
    const badGrant = await app.inject({ method: 'POST', url: '/dv360/token', payload: 'grant_type=client_credentials', headers: { 'content-type': 'application/x-www-form-urlencoded' } })
    expect(badGrant.json().error).toBe('unsupported_grant_type')
  })
})

describe('mock bidder (OpenRTB 2.6)', () => {
  const req = { id: 'req_1', imp: [{ id: '1', bidfloor: 100, video: { w: 1920, h: 1080 } }], cur: ['AUD'] }

  it('bids from one of the DSP’s seats and advertisers, with a retrievable creative', async () => {
    const { app } = buildMocks()
    const res = await app.inject({ method: 'POST', url: '/dv360/openrtb2/bid', headers: { host: 'mocks.test' }, payload: req })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({
      id: 'req_1', cur: 'AUD',
      seatbid: [{ seat: '884512', bid: [{ impid: '1', price: 150, crid: 'crid-5130001', adomain: ['nestle.com'], cat: ['IAB8'], iurl: 'http://mocks.test/dv360/creatives/crid-5130001.png?w=1920&h=1080' }] }],
    })
    const png = await app.inject({ method: 'GET', url: '/dv360/creatives/crid-5130001.png?w=1920&h=1080' })
    expect(png.headers['content-type']).toBe('image/png')
    expect(png.rawPayload.readUInt32BE(16)).toBe(1920)
  })

  it('follows the tester’s behaviour: no bid, below the floor, another advertiser, crid and adomain overrides', async () => {
    const { app } = buildMocks()
    const bid = async (b: Record<string, unknown>) => {
      expect((await app.inject({ method: 'PUT', url: '/_control/google_dv360/bidder', payload: b })).statusCode).toBe(200)
      return app.inject({ method: 'POST', url: '/dv360/openrtb2/bid', payload: req })
    }
    expect((await bid({ mode: 'no_bid' })).statusCode).toBe(204)
    expect((await bid({ mode: 'below_floor' })).json().seatbid[0].bid[0].price).toBe(50)
    const other = (await bid({ mode: 'bid', advertiserId: '5130002', crid: 'unapproved-1', adomain: 'redbull.com' })).json().seatbid[0]
    expect(other).toMatchObject({ seat: '884513', bid: [{ crid: 'unapproved-1', adomain: ['redbull.com'], cat: ['IAB7'] }] })
    expect((await app.inject({ method: 'PUT', url: '/_control/google_dv360/bidder', payload: { mode: 'sometimes' } })).statusCode).toBe(400)
  })
})

describe('mock Amazon Ads and The Trade Desk APIs', () => {
  it('Amazon: LWA refresh-token grant, then profiles and DSP advertisers in the profile’s region', async () => {
    const { app } = buildMocks()
    const form = { 'content-type': 'application/x-www-form-urlencoded' }
    const grant = 'grant_type=refresh_token&refresh_token=Atzr%7Cx&client_id=c&client_secret=s'
    const rejected = await app.inject({ method: 'POST', url: '/amazon/eu/auth/o2/token', headers: form, payload: grant })
    expect(rejected.json()).toEqual({ error: 'invalid_grant', error_description: 'The request has an invalid grant parameter : refresh_token' })
    await app.inject({ method: 'PUT', url: '/_control/amazon_dsp/auth', payload: { accept: true } })
    const token = (await app.inject({ method: 'POST', url: '/amazon/eu/auth/o2/token', headers: form, payload: grant })).json().access_token
    const h = { authorization: `Bearer ${token}`, 'amazon-advertising-api-clientid': 'c' }
    expect((await app.inject({ method: 'GET', url: '/amazon/eu/v2/profiles', headers: h })).json()[0]).toMatchObject({ profileId: 3390127745, accountInfo: { id: 'ENTITY8Q1R5T' } })
    expect((await app.inject({ method: 'GET', url: '/amazon/na/v2/profiles', headers: h })).json()).toEqual([])
    const advs = await app.inject({ method: 'GET', url: '/amazon/eu/dsp/advertisers', headers: { ...h, 'amazon-advertising-api-scope': '3390127745' } })
    expect(advs.json()).toEqual({ totalResults: 1, response: [{ advertiserId: '588104411', name: "L'Oréal", currency: 'AUD', url: 'https://www.loreal.com', country: 'AU', timezone: 'Australia/Sydney' }] })
  })

  it('TTD: TTD-Auth header, partner-scoped advertiser query', async () => {
    const { app } = buildMocks()
    const body = { PartnerId: 'phub-retail', PageStartIndex: 0, PageSize: 10 }
    expect((await app.inject({ method: 'POST', url: '/ttd/v3/advertiser/query/partner', payload: body })).statusCode).toBe(401)
    const res = await app.inject({ method: 'POST', url: '/ttd/v3/advertiser/query/partner', headers: { 'ttd-auth': 't' }, payload: body })
    expect(res.json()).toMatchObject({ Result: [{ AdvertiserId: 'ttd-adv-1', AdvertiserName: 'Arnott’s', DomainAddress: 'https://arnotts.com' }], TotalFilteredCount: 1 })
    expect((await app.inject({ method: 'POST', url: '/ttd/v3/advertiser/query/partner', headers: { 'ttd-auth': 't' }, payload: { ...body, PartnerId: 'x' } })).statusCode).toBe(403)
  })
})
