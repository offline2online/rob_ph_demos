import { describe, expect, it } from 'vitest'
import { buildApp } from '../src/http/app'
import { expectMatchesContract } from './contract'
import { testContext } from './helpers'

describe('Advertisers (admin only, spec §3)', () => {
  it('saves approval and floor multiplier; effective floor follows', async () => {
    const app = buildApp(testContext())
    const res = await app.inject({ method: 'PUT', url: '/api/admin/v1/advertisers', payload: { settings: { swisse: { approvalRequired: false, floorMultiplier: 1.25 } } } })
    expect(res.statusCode).toBe(200)
    expectMatchesContract('PUT', '/admin/v1/advertisers', 200, res.body || undefined)
    const list = (await app.inject({ method: 'GET', url: '/api/admin/v1/advertisers' })).json().items
    expect(list.find((a: { advertiserId: string }) => a.advertiserId === 'swisse')).toMatchObject({ approvalRequired: false, floorMultiplier: 1.25, effectiveFloorCpm: 125 })
  })

  it('rejects unknown advertisers and a non-positive multiplier', async () => {
    const res = await buildApp(testContext()).inject({ method: 'PUT', url: '/api/admin/v1/advertisers', payload: { settings: { nobody: { approvalRequired: true, floorMultiplier: 1 }, nestle: { approvalRequired: 'yes', floorMultiplier: 0 } } } })
    expect(res.statusCode).toBe(400)
    expectMatchesContract('PUT', '/admin/v1/advertisers', 400, res.json())
    expect(res.json().error.details.map((d: { field: string }) => d.field)).toEqual(['settings.nobody', 'settings.nestle.approvalRequired', 'settings.nestle.floorMultiplier'])
  })

  it('non-admin sessions get 403', async () => {
    const res = await buildApp(testContext({ role: 'hq_user' })).inject({ method: 'PUT', url: '/api/admin/v1/advertisers', payload: { settings: {} } })
    expect(res.statusCode).toBe(403)
    expectMatchesContract('PUT', '/admin/v1/advertisers', 403, res.json())
  })
})
