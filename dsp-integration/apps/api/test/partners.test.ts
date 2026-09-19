import { describe, expect, it } from 'vitest'
import { buildApp } from '../src/http/app'
import { expectMatchesContract } from './contract'
import { mockDsps, testContext } from './helpers'

const setup = () => {
  const mocks = mockDsps()
  const ctx = testContext({ dspFetch: mocks.fetchImpl })
  return { ctx, mocks, app: buildApp(ctx) }
}
const call = (app: ReturnType<typeof buildApp>, method: 'GET' | 'PUT' | 'POST', url: string, payload?: object) => app.inject({ method, url: `/api/admin/v1${url}`, payload })

describe('DSP connection — Google DSP (DV360) against the mock DV360 API', () => {
  it('connects with the saved credentials and pulls the advertisers as seats', async () => {
    const { app } = setup()
    const res = await call(app, 'POST', '/partners/p_google/connect')
    expect(res.statusCode).toBe(200)
    expectMatchesContract('POST', '/admin/v1/partners/{partnerId}/connect', 200, res.json())
    expect(res.json()).toMatchObject({ status: 'connected', seats: [{ id: '5130001', name: 'Nestlé' }, { id: '5130002', name: 'Swisse' }] })
    expect(Date.parse(res.json().lastSync)).not.toBeNaN()
  })

  it('pulls advertisers a tester adds on the mock DSP', async () => {
    const { app, mocks } = setup()
    await mocks.app.inject({ method: 'POST', url: '/_control/google_dv360/advertisers', payload: { name: 'Arnott’s', seatId: '884512', domain: 'arnotts.com' } })
    const res = await call(app, 'POST', '/partners/p_google/connect')
    expect(res.json().seats.map((s: { name: string }) => s.name)).toEqual(['Nestlé', 'Swisse', 'Arnott’s'])
  })

  it('reports the DSP’s own error when it rejects the credentials', async () => {
    const { app, mocks } = setup()
    await mocks.app.inject({ method: 'PUT', url: '/_control/google_dv360/auth', payload: { accept: false, error: 'invalid_grant', description: 'Invalid JWT Signature.' } })
    const res = await call(app, 'POST', '/partners/p_google/connect')
    expect(res.json()).toMatchObject({ status: 'error', lastSync: 'Invalid JWT Signature.' })
    expect(res.json().issues[0]).toEqual({ kind: 'connection_error', message: 'Invalid JWT Signature.' })
  })

  it('reports a partner ID the service account cannot access', async () => {
    const { app } = setup()
    await call(app, 'PUT', '/partners/p_google', { credentials: { partnerId: '999999' } })
    const res = await call(app, 'POST', '/partners/p_google/connect')
    expect(res.json()).toMatchObject({ status: 'error', lastSync: 'Partner 999999: The caller does not have permission' })
  })

  it('rejects a key file that is not a service-account key', async () => {
    const { app } = setup()
    await call(app, 'PUT', '/partners/p_google', { credentials: { privateKeyJson: 'not json' } })
    expect((await call(app, 'POST', '/partners/p_google/connect')).json().lastSync).toBe('Private key (JSON) is not a service account key file.')
  })

  it('disconnect returns to Test and clears the seats', async () => {
    const { app } = setup()
    const res = await call(app, 'POST', '/partners/p_google/disconnect')
    expectMatchesContract('POST', '/admin/v1/partners/{partnerId}/disconnect', 200, res.json())
    expect(res.json()).toMatchObject({ status: 'draft', mode: 'test', lastSync: null, seats: [] })
  })
})

describe('DSP page save (PUT /admin/v1/partners/{id})', () => {
  it('secrets are write-only: omitted keeps, a new value replaces, never returned', async () => {
    const { app, ctx } = setup()
    const res = await call(app, 'PUT', '/partners/p_amazon', { credentials: { lwaClientId: 'amzn1.new', refreshToken: 'Atzr|new-token' } })
    expect(res.statusCode).toBe(200)
    expectMatchesContract('PUT', '/admin/v1/partners/{partnerId}', 200, res.json())
    expect(res.json().credentials).toMatchObject({ lwaClientId: 'amzn1.new', lwaClientSecret: { set: true }, refreshToken: { set: true } })
    expect(res.body).not.toContain('Atzr|new-token')
    expect(ctx.partners.secrets('p_amazon')).toEqual({ lwaClientSecret: 'poc-placeholder-secret', refreshToken: 'Atzr|new-token' })
  })

  it('Live is refused unless connected with the bidder integration complete (no real spend)', async () => {
    const { app } = setup()
    const amazon = await call(app, 'PUT', '/partners/p_amazon', { mode: 'live', bidder: { bidderEndpoint: 'https://bid.example/openrtb2', seatIds: ['s1'] } })
    expect(amazon.statusCode).toBe(409)
    expectMatchesContract('PUT', '/admin/v1/partners/{partnerId}', 409, amazon.json())
    await call(app, 'PUT', '/partners/p_google', { mode: 'test' })
    const noBidder = await call(app, 'PUT', '/partners/p_google', { mode: 'live', bidder: { seatIds: [] } })
    expect(noBidder.statusCode).toBe(409)
    expect((await call(app, 'PUT', '/partners/p_google', { mode: 'live' })).json().mode).toBe('live')
  })

  it('unlinking copies the company lists down; relinking discards the DSP’s own lists', async () => {
    const { app } = setup()
    const unlinked = await call(app, 'PUT', '/partners/p_google', { listsLinked: false })
    expect(unlinked.json()).toMatchObject({ listsLinked: false, advertiserWhitelist: ['Nestlé', 'Swisse', 'Arnott’s'], advertiserBlacklist: ['Red Bull', 'Monster Energy'] })
    const edited = await call(app, 'PUT', '/partners/p_google', { advertiserBlacklist: ['Red Bull', 'Monster Energy', 'Nestlé'] })
    expect(edited.statusCode).toBe(400)
    const relinked = await call(app, 'PUT', '/partners/p_google', { listsLinked: true })
    expect(relinked.json().listsLinked).toBe(true)
    expect(relinked.json()).not.toHaveProperty('advertiserBlacklist')
  })

  it('validates credentials, bidder endpoint and the fixed Amazon region', async () => {
    const { app } = setup()
    const res = await call(app, 'PUT', '/partners/p_google', { credentials: { nope: 'x' }, bidder: { bidderEndpoint: 'http://insecure.example' } })
    expect(res.json().error.details.map((d: { field: string }) => d.field)).toEqual(['credentials.nope', 'bidder.bidderEndpoint'])
  })
})

describe('Add a DSP (POST /admin/v1/partners)', () => {
  it('starts in Test, adopting the company lists; one per provider', async () => {
    const { app } = setup()
    const res = await call(app, 'POST', '/partners', { provider: 'the_trade_desk' })
    expect(res.statusCode).toBe(201)
    expectMatchesContract('POST', '/admin/v1/partners', 201, res.json())
    expect(res.json()).toMatchObject({ id: 'p_the_trade_desk', name: 'The Trade Desk', status: 'draft', mode: 'test', listsLinked: true, seats: [] })
    expect(res.json().issues.map((i: { kind: string }) => i.kind)).toEqual(['missing_credentials', 'missing_bidder_fields'])
    expect((await call(app, 'POST', '/partners', { provider: 'the_trade_desk' })).statusCode).toBe(409)
    expect((await call(app, 'POST', '/partners', { provider: 'nope' })).statusCode).toBe(400)
  })
})
