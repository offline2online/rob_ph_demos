import { describe, expect, it } from 'vitest'
import { buildApp } from '../src/http/app'
import { expectMatchesContract } from './contract'
import { runAuction } from '../src/exchange/auction'
import { testContext } from './helpers'

const valid = { enabled: true, organisation: 'Demo Retail Group', domain: 'demoretail.example', sellerId: 'drg-4471', contactEmail: 'adops@demoretail.example' }

describe('Exchange settings and sellers.json (spec §7)', () => {
  it('returns the seller of record and where sellers.json is published', async () => {
    const res = await buildApp(await testContext()).inject({ method: 'GET', url: '/api/admin/v1/exchange' })
    expectMatchesContract('GET', '/admin/v1/exchange', 200, res.json())
    expect(res.json()).toEqual({ ...valid, published: true, sellersJsonUrl: 'https://demoretail.example/sellers.json' })
  })

  it('publishes sellers.json with the platform defaults (PUBLISHER, not confidential)', async () => {
    const res = await buildApp(await testContext()).inject({ method: 'GET', url: '/sellers.json' })
    expect(res.statusCode).toBe(200)
    expectMatchesContract('GET', '/sellers.json', 200, res.json())
    expect(res.json()).toEqual({ contact_email: 'adops@demoretail.example', version: '1.0', sellers: [{ seller_id: 'drg-4471', seller_type: 'PUBLISHER', name: 'Demo Retail Group', domain: 'demoretail.example', is_confidential: 0 }] })
  })

  it('sellers.json is 404 until complete, and with the flag off', async () => {
    const empty = buildApp(await testContext({ seeded: false }))
    expect((await empty.inject({ method: 'GET', url: '/sellers.json' })).statusCode).toBe(404)
    expectMatchesContract('GET', '/sellers.json', 404, undefined)
    expect((await empty.inject({ method: 'GET', url: '/api/admin/v1/exchange' })).json()).toMatchObject({ published: false, sellersJsonUrl: null })
    expect((await buildApp(await testContext({ flag: false })).inject({ method: 'GET', url: '/sellers.json' })).statusCode).toBe(404)
  })

  it('saves all four fields and republishes', async () => {
    const app = buildApp(await testContext({ seeded: false }))
    const res = await app.inject({ method: 'PUT', url: '/api/admin/v1/exchange', payload: { ...valid, domain: ' DemoRetail.example ' } })
    expect(res.statusCode).toBe(200)
    expectMatchesContract('PUT', '/admin/v1/exchange', 200, res.json())
    expect(res.json()).toMatchObject({ domain: 'demoretail.example', published: true })
    expect((await app.inject({ method: 'GET', url: '/sellers.json' })).statusCode).toBe(200)
  })

  it('requires all four fields, a bare domain and a valid email', async () => {
    const app = buildApp(await testContext())
    const res = await app.inject({ method: 'PUT', url: '/api/admin/v1/exchange', payload: { enabled: true, organisation: '', domain: 'https://x.example/', sellerId: 'a', contactEmail: 'nope' } })
    expect(res.statusCode).toBe(400)
    expectMatchesContract('PUT', '/admin/v1/exchange', 400, res.json())
    expect(res.json().error.details.map((d: { field: string }) => d.field)).toEqual(['organisation', 'domain', 'contactEmail'])
  })

  it('needs the switch to be said, on or off', async () => {
    const { enabled: _e, ...noSwitch } = valid
    const res = await buildApp(await testContext()).inject({ method: 'PUT', url: '/api/admin/v1/exchange', payload: noSwitch })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.details.map((d: { field: string }) => d.field)).toEqual(['enabled'])
  })

  it.each([['GET'], ['PUT']] as const)('%s /admin/v1/exchange returns 404 with the flag off', async (method) => {
    const res = await buildApp(await testContext({ flag: false })).inject({ method, url: '/api/admin/v1/exchange', payload: valid })
    expect(res.statusCode).toBe(404)
  })
})

/* The retailer's DSP integration switch (Rob, 24 Sep 2026): off for a new
   instance; off hides the integration from DSPs and deletes nothing. */
describe('DSP integration switch (Exchange settings)', () => {
  const TOKEN = { authorization: 'Bearer poc-token-google-dv360' }
  const off = { ...valid, enabled: false }

  it('starts switched off on a new instance, with blank fields allowed', async () => {
    const app = buildApp(await testContext({ seeded: false }))
    const got = (await app.inject({ method: 'GET', url: '/api/admin/v1/exchange' })).json()
    expect(got).toMatchObject({ enabled: false, published: false, sellersJsonUrl: null })
    expect((await app.inject({ method: 'GET', url: '/api/admin/v1/features' })).json()).toEqual({ dspIntegration: false })
    const res = await app.inject({ method: 'PUT', url: '/api/admin/v1/exchange', payload: { enabled: false, organisation: '', domain: '', sellerId: '', contactEmail: '' } })
    expect(res.statusCode).toBe(200)
    expectMatchesContract('PUT', '/admin/v1/exchange', 200, res.json())
  })

  it('still checks a value that is there while off', async () => {
    const res = await buildApp(await testContext()).inject({ method: 'PUT', url: '/api/admin/v1/exchange', payload: { ...off, contactEmail: 'nope' } })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.details.map((d: { field: string }) => d.field)).toEqual(['contactEmail'])
  })

  it('switched off: unpublished, Partner API and sellers.json 404, no bid requests — and nothing deleted', async () => {
    const ctx = await testContext()
    const app = buildApp(ctx)
    const partnersBefore = ctx.partners.list().length
    const campaignsBefore = (await app.inject({ method: 'GET', url: '/api/admin/v1/campaigns' })).json().items.length
    expect((await app.inject({ method: 'GET', url: '/api/v1/inventory', headers: TOKEN })).statusCode).toBe(200)

    const saved = await app.inject({ method: 'PUT', url: '/api/admin/v1/exchange', payload: off })
    expect(saved.statusCode).toBe(200)
    expectMatchesContract('PUT', '/admin/v1/exchange', 200, saved.json())
    expect(saved.json()).toEqual({ ...off, published: false, sellersJsonUrl: null })

    const features = await app.inject({ method: 'GET', url: '/api/admin/v1/features' })
    expectMatchesContract('GET', '/admin/v1/features', 200, features.json())
    expect(features.json()).toEqual({ dspIntegration: false })
    expect((await app.inject({ method: 'GET', url: '/sellers.json' })).statusCode).toBe(404)
    const partnerApi = await app.inject({ method: 'GET', url: '/api/v1/inventory', headers: TOKEN })
    expect(partnerApi.statusCode).toBe(404)
    expect(partnerApi.json().error.message).toBe('DSP integration is switched off.')
    const auction = await runAuction(ctx)
    expect(auction.positions.reduce((n, p) => n + p.bidRequests, 0)).toBe(0)

    /* Kept: the seller of record, the DSPs and the campaigns. */
    expect(ctx.partners.list().length).toBe(partnersBefore)
    expect((await app.inject({ method: 'GET', url: '/api/admin/v1/campaigns' })).json().items.length).toBe(campaignsBefore)

    /* Back on: everything is as it was. */
    const back = await app.inject({ method: 'PUT', url: '/api/admin/v1/exchange', payload: valid })
    expect(back.json()).toMatchObject({ enabled: true, published: true, organisation: 'Demo Retail Group' })
    expect((await app.inject({ method: 'GET', url: '/api/admin/v1/features' })).json()).toEqual({ dspIntegration: true })
    expect((await app.inject({ method: 'GET', url: '/sellers.json' })).statusCode).toBe(200)
    expect((await app.inject({ method: 'GET', url: '/api/v1/inventory', headers: TOKEN })).statusCode).toBe(200)
  })

  it('features is readable by marketing users (who cannot read Exchange settings), and false with the flag off', async () => {
    const marketing = buildApp(await testContext({ role: 'hq_marketing' }))
    expect((await marketing.inject({ method: 'GET', url: '/api/admin/v1/features' })).json()).toEqual({ dspIntegration: true })
    expect((await marketing.inject({ method: 'GET', url: '/api/admin/v1/exchange' })).statusCode).toBe(403)
    const helpdesk = buildApp(await testContext({ role: 'hq_helpdesk' }))
    expect((await helpdesk.inject({ method: 'GET', url: '/api/admin/v1/features' })).statusCode).toBe(403)
    const flagOff = buildApp(await testContext({ flag: false }))
    expect((await flagOff.inject({ method: 'GET', url: '/api/admin/v1/features' })).json()).toEqual({ dspIntegration: false })
  })
})
