import { describe, expect, it } from 'vitest'
import { runAuction } from '../src/exchange/auction'
import { buildApp } from '../src/http/app'
import { expectMatchesContract } from './contract'
import { NOW, mockDsps, testContext } from './helpers'

const setup = async () => {
  const mocks = mockDsps()
  const ctx = await testContext({ dspFetch: mocks.fetchImpl, clock: () => NOW })
  const app = buildApp(ctx)
  const call = (method: 'GET' | 'PUT' | 'POST', url: string, payload?: object) => app.inject({ method, url: `/api/admin/v1${url}`, payload })
  const control = (method: 'PUT' | 'POST', url: string, payload?: object) => mocks.app.inject({ method, url: `/_control${url}`, payload })
  return { ctx, app, mocks, call, control }
}

describe('Amazon Ads DSP against the mock Amazon Ads API (LWA + Ads API)', () => {
  it('reports the refresh token rejected, as seeded', async () => {
    const { call } = await setup()
    const res = await call('POST', '/partners/p_amazon/connect')
    expectMatchesContract('POST', '/admin/v1/partners/{partnerId}/connect', 200, res.json())
    expect(res.json()).toMatchObject({ status: 'error', lastSync: 'Refresh token rejected: The request has an invalid grant parameter : refresh_token' })
    expect(res.json().issues[0]).toEqual({ kind: 'connection_error', message: 'Refresh token rejected: The request has an invalid grant parameter : refresh_token' })
  })

  it('connects once the login is accepted, scoped by region, profile and entity, and pulls the advertisers', async () => {
    const { call, control } = await setup()
    await control('PUT', '/amazon_dsp/auth', { accept: true })
    const res = await call('POST', '/partners/p_amazon/connect')
    expect(res.json()).toMatchObject({ status: 'connected', seats: [{ id: '588104411', name: "L'Oréal" }] })

    await call('PUT', '/partners/p_amazon', { credentials: { entityId: 'ENTITY-OTHER' } })
    expect((await call('POST', '/partners/p_amazon/connect')).json().lastSync).toBe('Profile 3390127745 doesn’t belong to entity ENTITY-OTHER.')
    await call('PUT', '/partners/p_amazon', { credentials: { entityId: 'ENTITY8Q1R5T', region: 'North America (NA)' } })
    expect((await call('POST', '/partners/p_amazon/connect')).json().lastSync).toBe('Profile 3390127745 is not available to this login in North America (NA).')
  })

  it('pages through advertisers and keeps each advertiser’s domain for matching bids', async () => {
    const { ctx, call, control } = await setup()
    await control('PUT', '/amazon_dsp/auth', { accept: true })
    for (let i = 0; i < 120; i++) await control('POST', '/amazon_dsp/advertisers', { id: `adv-${i}`, name: `Brand ${i}`, seatId: 'amzn-seat-1', domain: `brand${i}.example` })
    const res = await call('POST', '/partners/p_amazon/connect')
    expect(res.json().seats).toHaveLength(121)
    expect(ctx.partners.get('p_amazon')!.seats[1]).toEqual({ id: 'adv-0', name: 'Brand 0', domain: 'brand0.example' })
    /* The API returns only id and name. */
    expect(res.json().seats[1]).toEqual({ id: 'adv-0', name: 'Brand 0' })
  })
})

describe('The Trade Desk against the mock TTD API v3', () => {
  const addTtd = async (call: Awaited<ReturnType<typeof setup>>['call']) => {
    await call('POST', '/partners', { provider: 'the_trade_desk' })
    return call('PUT', '/partners/p_the_trade_desk', { credentials: { supplySourceId: 'ss-481', ttdPartnerId: 'phub-retail', apiToken: 'ttd-secret-token', region: 'APAC' } })
  }

  it('connects with the API token and pulls the partner’s advertisers; the token is never returned', async () => {
    const { ctx, call } = await setup()
    const saved = await addTtd(call)
    expect(saved.json().credentials.apiToken).toEqual({ set: true })
    const res = await call('POST', '/partners/p_the_trade_desk/connect')
    expectMatchesContract('POST', '/admin/v1/partners/{partnerId}/connect', 200, res.json())
    expect(res.json()).toMatchObject({ status: 'connected', seats: [{ id: 'ttd-adv-1', name: 'Arnott’s' }] })
    expect(res.body).not.toContain('ttd-secret-token')
    expect(ctx.partners.get('p_the_trade_desk')!.seats[0].domain).toBe('arnotts.com')
  })

  it('reports a rejected token or the wrong partner', async () => {
    const { call, control } = await setup()
    await addTtd(call)
    await control('PUT', '/the_trade_desk/auth', { accept: false, description: 'Authentication failed: the TTD-Auth token has expired.' })
    expect((await call('POST', '/partners/p_the_trade_desk/connect')).json()).toMatchObject({ status: 'error', lastSync: 'API token rejected: Authentication failed: the TTD-Auth token has expired.' })
    await control('PUT', '/the_trade_desk/auth', { accept: true })
    await call('PUT', '/partners/p_the_trade_desk', { credentials: { ttdPartnerId: 'someone-else' } })
    expect((await call('POST', '/partners/p_the_trade_desk/connect')).json().lastSync).toBe('You do not have access to partner someone-else.')
  })

  it('once connected with its bidder integration, receives bid requests and its advertisers compete', async () => {
    const { ctx, call } = await setup()
    await addTtd(call)
    await call('POST', '/partners/p_the_trade_desk/connect')
    await call('PUT', '/partners/p_the_trade_desk', { bidder: { bidderEndpoint: 'https://bid.thetradedesk.example/openrtb2', seatIds: ['ttd-seat-1'] } })
    /* Tie the Menu Board's advertiser slot to TTD, so only TTD bids for it. */
    const ext = ctx.displayTypes.get('menu_board')!.phExtensions!
    ctx.displayTypes.saveExtensions('menu_board', { ...ext, slots: ext.slots.map((s, i) => (i === 1 ? { ...s, partnerId: 'p_the_trade_desk' } : s)) })
    await runAuction(ctx, new Date('2026-09-21T00:00:00.000Z'))
    const [first] = ctx.reservations.forWindow('menu_board.s2', '2026-09-21T00:00:00.000Z')
    expect(first).toMatchObject({ partnerId: 'p_the_trade_desk', advertiserId: 'arnotts', status: 'rejected', reason: 'New creative crid-ttd-adv-1: queued for approval.' })
  })
})
