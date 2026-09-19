import { describe, expect, it } from 'vitest'
import { buildApp } from '../src/http/app'
import { expectMatchesContract } from './contract'
import { testContext } from './helpers'

const valid = { organisation: 'Demo Retail Group', domain: 'demoretail.example', sellerId: 'drg-4471', contactEmail: 'adops@demoretail.example' }

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
    const res = await app.inject({ method: 'PUT', url: '/api/admin/v1/exchange', payload: { organisation: '', domain: 'https://x.example/', sellerId: 'a', contactEmail: 'nope' } })
    expect(res.statusCode).toBe(400)
    expectMatchesContract('PUT', '/admin/v1/exchange', 400, res.json())
    expect(res.json().error.details.map((d: { field: string }) => d.field)).toEqual(['organisation', 'domain', 'contactEmail'])
  })

  it.each([['GET'], ['PUT']] as const)('%s /admin/v1/exchange returns 404 with the flag off', async (method) => {
    const res = await buildApp(await testContext({ flag: false })).inject({ method, url: '/api/admin/v1/exchange', payload: valid })
    expect(res.statusCode).toBe(404)
  })
})
