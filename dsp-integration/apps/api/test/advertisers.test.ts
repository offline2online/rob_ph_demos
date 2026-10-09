import { describe, expect, it } from 'vitest'
import { buildApp } from '../src/http/app'
import { expectMatchesContract } from './contract'
import { testContext } from './helpers'

describe('Advertisers (admin only, spec §3)', () => {
  it('saves approval and floor multiplier; effective floor follows', async () => {
    const app = buildApp(await testContext())
    const res = await app.inject({ method: 'PUT', url: '/api/admin/v1/advertisers', payload: { settings: { swisse: { approvalRequired: false, floorMultiplier: 1.25 } } } })
    expect(res.statusCode).toBe(200)
    expectMatchesContract('PUT', '/admin/v1/advertisers', 200, res.body || undefined)
    const list = (await app.inject({ method: 'GET', url: '/api/admin/v1/advertisers' })).json().items
    expect(list.find((a: { advertiserId: string }) => a.advertiserId === 'swisse')).toMatchObject({ approvalRequired: false, floorMultiplier: 1.25, effectiveFloorCpm: 125 })
  })

  it('rejects unknown advertisers and a non-positive multiplier', async () => {
    const res = await buildApp(await testContext()).inject({ method: 'PUT', url: '/api/admin/v1/advertisers', payload: { settings: { nobody: { approvalRequired: true, floorMultiplier: 1 }, nestle: { approvalRequired: 'yes', floorMultiplier: 0 } } } })
    expect(res.statusCode).toBe(400)
    expectMatchesContract('PUT', '/admin/v1/advertisers', 400, res.json())
    expect(res.json().error.details.map((d: { field: string }) => d.field)).toEqual(['settings.nobody', 'settings.nestle.approvalRequired', 'settings.nestle.floorMultiplier'])
  })

  it('non-admin sessions get 403', async () => {
    const res = await buildApp(await testContext({ role: 'hq_marketing' })).inject({ method: 'PUT', url: '/api/admin/v1/advertisers', payload: { settings: {} } })
    expect(res.statusCode).toBe(403)
    expectMatchesContract('PUT', '/admin/v1/advertisers', 403, res.json())
  })

  it('counts each advertiser’s campaigns by approval status (Rob, 20 Sep)', async () => {
    const res = await buildApp(await testContext()).inject({ method: 'GET', url: '/api/admin/v1/advertisers' })
    const byId = Object.fromEntries(res.json().items.map((a: { advertiserId: string; campaigns: unknown }) => [a.advertiserId, a.campaigns]))
    /* Seeded: Nestlé approved automatically, Swisse one awaiting and one draft, L'Oréal rejected. */
    expect(byId.nestle).toEqual({ draft: 0, awaiting_approval: 0, approved: 1, rejected: 0 })
    expect(byId.swisse).toEqual({ draft: 1, awaiting_approval: 1, approved: 0, rejected: 0 })
    expect(byId.loreal).toEqual({ draft: 0, awaiting_approval: 0, approved: 0, rejected: 1 })
  })

  it('adds, lists and removes a direct advertiser (no DSP)', async () => {
    const app = buildApp(await testContext())
    const add = await app.inject({ method: 'POST', url: '/api/admin/v1/advertisers/direct', payload: { name: '  Acme   Foods ' } })
    expect(add.statusCode).toBe(201)
    expectMatchesContract('POST', '/admin/v1/advertisers', 201, add.json())
    expect(add.json()).toEqual({ advertiserId: 'acme-foods', name: 'Acme Foods' })
    const list = await app.inject({ method: 'GET', url: '/api/admin/v1/advertisers' })
    expectMatchesContract('GET', '/admin/v1/advertisers', 200, list.json())
    const items = list.json().items as { advertiserId: string; via: string[]; direct: boolean }[]
    expect(items.find((a) => a.advertiserId === 'acme-foods')).toMatchObject({ via: [], direct: true, approvalRequired: true })
    expect(items.find((a) => a.advertiserId === 'swisse')?.direct).toBe(false)
    /* Its settings save like any other advertiser's. */
    expect((await app.inject({ method: 'PUT', url: '/api/admin/v1/advertisers', payload: { settings: { 'acme-foods': { approvalRequired: false, floorMultiplier: 0.9 } } } })).statusCode).toBe(200)
    expect((await app.inject({ method: 'DELETE', url: '/api/admin/v1/advertisers/direct/acme-foods' })).statusCode).toBe(204)
    expect(((await app.inject({ method: 'GET', url: '/api/admin/v1/advertisers' })).json().items as { advertiserId: string }[]).some((a) => a.advertiserId === 'acme-foods')).toBe(false)
  })

  it('refuses a duplicate, a blank name, a DSP advertiser, and non-admins', async () => {
    const app = buildApp(await testContext())
    const post = (name: unknown) => app.inject({ method: 'POST', url: '/api/admin/v1/advertisers/direct', payload: { name } })
    expect((await post('')).statusCode).toBe(400)
    expect((await post('!!!')).statusCode).toBe(400)
    expect((await post('Swisse')).statusCode).toBe(409)
    expect((await post('Own Brand')).statusCode).toBe(201)
    expect((await post('own  brand')).statusCode).toBe(409)
    expect((await app.inject({ method: 'DELETE', url: '/api/admin/v1/advertisers/direct/swisse' })).statusCode).toBe(404)
    const marketing = buildApp(await testContext({ role: 'hq_marketing' }))
    expect((await marketing.inject({ method: 'POST', url: '/api/admin/v1/advertisers/direct', payload: { name: 'X' } })).statusCode).toBe(403)
  })
})
