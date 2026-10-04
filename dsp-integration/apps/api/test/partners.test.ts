import { describe, expect, it } from 'vitest'
import { buildApp } from '../src/http/app'
import { expectMatchesContract } from './contract'
import { mockDsps, testContext } from './helpers'

const setup = async () => {
  const mocks = mockDsps()
  const ctx = await testContext({ dspFetch: mocks.fetchImpl })
  return { ctx, mocks, app: buildApp(ctx) }
}
const call = (app: ReturnType<typeof buildApp>, method: 'GET' | 'PUT' | 'POST', url: string, payload?: object) => app.inject({ method, url: `/api/admin/v1${url}`, payload })

describe('DSP connection — Google DSP (DV360) against the mock DV360 API', () => {
  it('connects with the saved credentials and pulls the advertisers as seats', async () => {
    const { app } = await setup()
    const res = await call(app, 'POST', '/partners/p_google/connect')
    expect(res.statusCode).toBe(200)
    expectMatchesContract('POST', '/admin/v1/partners/{partnerId}/connect', 200, res.json())
    expect(res.json()).toMatchObject({ status: 'connected', seats: [{ id: '5130001', name: 'Nestlé' }, { id: '5130002', name: 'Swisse' }] })
    expect(Date.parse(res.json().lastSync)).not.toBeNaN()
  })

  it('pulls advertisers a tester adds on the mock DSP', async () => {
    const { app, mocks } = await setup()
    await mocks.app.inject({ method: 'POST', url: '/_control/google_dv360/advertisers', payload: { name: 'Arnott’s', seatId: '884512', domain: 'arnotts.com' } })
    const res = await call(app, 'POST', '/partners/p_google/connect')
    expect(res.json().seats.map((s: { name: string }) => s.name)).toEqual(['Nestlé', 'Swisse', 'Arnott’s'])
  })

  it('reports the DSP’s own error when it rejects the credentials', async () => {
    const { app, mocks } = await setup()
    await mocks.app.inject({ method: 'PUT', url: '/_control/google_dv360/auth', payload: { accept: false, error: 'invalid_grant', description: 'Invalid JWT Signature.' } })
    const res = await call(app, 'POST', '/partners/p_google/connect')
    expect(res.json()).toMatchObject({ status: 'error', lastSync: 'Invalid JWT Signature.' })
    expect(res.json().issues[0]).toEqual({ kind: 'connection_error', message: 'Invalid JWT Signature.' })
  })

  it('reports a partner ID the service account cannot access', async () => {
    const { app } = await setup()
    await call(app, 'PUT', '/partners/p_google', { credentials: { partnerId: '999999' } })
    const res = await call(app, 'POST', '/partners/p_google/connect')
    expect(res.json()).toMatchObject({ status: 'error', lastSync: 'Partner 999999: The caller does not have permission' })
  })

  it('rejects a key file that is not a service-account key', async () => {
    const { app } = await setup()
    await call(app, 'PUT', '/partners/p_google', { credentials: { privateKeyJson: 'not json' } })
    expect((await call(app, 'POST', '/partners/p_google/connect')).json().lastSync).toBe('Private key (JSON) is not a service account key file.')
  })

  it('disconnect returns to Test and clears the seats', async () => {
    const { app } = await setup()
    const res = await call(app, 'POST', '/partners/p_google/disconnect')
    expectMatchesContract('POST', '/admin/v1/partners/{partnerId}/disconnect', 200, res.json())
    expect(res.json()).toMatchObject({ status: 'draft', mode: 'test', lastSync: null, seats: [] })
  })
})

describe('DSP page save (PUT /admin/v1/partners/{id})', () => {
  it('secrets are write-only: omitted keeps, a new value replaces, never returned', async () => {
    const { app, ctx } = await setup()
    const res = await call(app, 'PUT', '/partners/p_amazon', { credentials: { lwaClientId: 'amzn1.new', refreshToken: 'Atzr|new-token' } })
    expect(res.statusCode).toBe(200)
    expectMatchesContract('PUT', '/admin/v1/partners/{partnerId}', 200, res.json())
    expect(res.json().credentials).toMatchObject({ lwaClientId: 'amzn1.new', lwaClientSecret: { set: true }, refreshToken: { set: true } })
    expect(res.body).not.toContain('Atzr|new-token')
    expect(ctx.partners.secrets('p_amazon')).toEqual({ lwaClientSecret: 'poc-placeholder-secret', refreshToken: 'Atzr|new-token' })
  })

  it('Live is refused unless connected with the bidder integration complete (no real spend)', async () => {
    const { app } = await setup()
    const amazon = await call(app, 'PUT', '/partners/p_amazon', { mode: 'live', bidder: { bidderEndpoint: 'https://bid.example/openrtb2', seatIds: ['s1'] } })
    expect(amazon.statusCode).toBe(409)
    expectMatchesContract('PUT', '/admin/v1/partners/{partnerId}', 409, amazon.json())
    await call(app, 'PUT', '/partners/p_google', { mode: 'test' })
    const noBidder = await call(app, 'PUT', '/partners/p_google', { mode: 'live', bidder: { seatIds: [] } })
    expect(noBidder.statusCode).toBe(409)
    expect((await call(app, 'PUT', '/partners/p_google', { mode: 'live' })).json().mode).toBe('live')
  })

  it('keeps a DSP’s advertiser lists to its own synced seat IDs', async () => {
    const { app } = await setup()
    /* Google's seats are Nestlé 5130001 and Swisse 5130002; the seed whitelists both. */
    const saved = await call(app, 'PUT', '/partners/p_google', { advertiserWhitelist: [' 5130001 '], advertiserBlacklist: ['5130002'] })
    expect(saved.statusCode).toBe(200)
    expect(saved.json()).toMatchObject({ advertiserWhitelist: ['5130001'], advertiserBlacklist: ['5130002'] })
    /* Free text, a name, or another DSP's seat is not an identifier this DSP issued. */
    for (const entry of ['Red Bull', 'Nestlé', '588104411']) {
      const bad = await call(app, 'PUT', '/partners/p_google', { advertiserBlacklist: [entry] })
      expect(bad.statusCode).toBe(400)
      expect(bad.json().error.details).toEqual([{ field: 'advertiserBlacklist', reason: expect.stringContaining('not a seat or advertiser synced from Google DSP') }])
    }
    const both = await call(app, 'PUT', '/partners/p_google', { advertiserBlacklist: ['5130001'] })
    expect(both.statusCode).toBe(400)
    expect(both.json().error.details).toEqual([{ field: 'advertiserWhitelist', reason: 'Nestlé is on both the whitelist and the blacklist.' }])
  })

  it('category lists are central only: no per-DSP override, nothing about them on a DSP', async () => {
    const { app } = await setup()
    const res = await call(app, 'PUT', '/partners/p_google', { listsLinked: false, categoryBlacklist: ['Finance', 'Food & Drink'] })
    expect(res.statusCode).toBe(200)
    expect(res.json()).not.toHaveProperty('listsLinked')
    expect(res.json()).not.toHaveProperty('categoryWhitelist')
    expect(res.json()).not.toHaveProperty('categoryBlacklist')
    expect(res.json().advertiserWhitelist).toEqual(['5130001', '5130002'])
  })

  it('validates credentials, bidder endpoint and the fixed Amazon region', async () => {
    const { app } = await setup()
    const res = await call(app, 'PUT', '/partners/p_google', { credentials: { nope: 'x' }, bidder: { bidderEndpoint: 'http://insecure.example' } })
    expect(res.json().error.details.map((d: { field: string }) => d.field)).toEqual(['credentials.nope', 'bidder.bidderEndpoint'])
  })
})

describe('Add a DSP (POST /admin/v1/partners)', () => {
  it('starts in Test; one per provider', async () => {
    const { app } = await setup()
    const res = await call(app, 'POST', '/partners', { provider: 'the_trade_desk' })
    expect(res.statusCode).toBe(201)
    expectMatchesContract('POST', '/admin/v1/partners', 201, res.json())
    expect(res.json()).toMatchObject({ id: 'p_the_trade_desk', name: 'The Trade Desk', status: 'draft', mode: 'test', seats: [] })
    expect(res.json().issues.map((i: { kind: string }) => i.kind)).toEqual(['missing_credentials', 'missing_bidder_fields'])
    expect((await call(app, 'POST', '/partners', { provider: 'the_trade_desk' })).statusCode).toBe(409)
    expect((await call(app, 'POST', '/partners', { provider: 'nope' })).statusCode).toBe(400)
  })
})
