import { describe, expect, it } from 'vitest'
import { buildApp } from '../src/http/app'
import { expectMatchesContract } from './contract'
import { testContext } from './helpers'

describe('GET /admin/v1/session (POC stand-in)', () => {
  it.each(['hq_admin', 'hq_user'] as const)('returns the POC_ROLE user (%s) with no cookie', async (role) => {
    const app = buildApp(await testContext({ role }))
    const res = await app.inject({ method: 'GET', url: '/api/admin/v1/session' })
    expect(res.statusCode).toBe(200)
    expect(res.json().role).toBe(role)
    expectMatchesContract('GET', '/admin/v1/session', 200, res.json())
  })

  it('unknown paths return the contract error shape', async () => {
    const app = buildApp(await testContext())
    const res = await app.inject({ method: 'GET', url: '/api/admin/v1/nope' })
    expect(res.statusCode).toBe(404)
    expect(res.json()).toEqual({ error: { code: 'not_found', message: 'Not found.' } })
  })
})

describe('contract validator', () => {
  it('fails a response carrying a field the contract does not define', () => {
    expect(() => expectMatchesContract('GET', '/admin/v1/session', 200, { userId: 'u', name: 'n', role: 'hq_admin', extra: 1 })).toThrow(/does not match the contract/)
    const adv = { advertiserId: 'a', name: 'A', via: [], approvalRequired: true, floorMultiplier: 1, effectiveFloorCpm: 100 }
    expect(() => expectMatchesContract('GET', '/admin/v1/advertisers', 200, { currency: 'AUD', floorCpm: 100, items: [adv] })).not.toThrow()
    expect(() => expectMatchesContract('GET', '/admin/v1/advertisers', 200, { currency: 'AUD', floorCpm: 100, items: [{ ...adv, seats: [] }] })).toThrow()
    expect(() => expectMatchesContract('GET', '/admin/v1/display-types', 200, { items: [{ id: 'x', name: 'n', touchPoint: 'Kiosk', displayCanvasSize: { width: 1, height: 1, depth: 3 }, playlistSettings: {} }] })).toThrow()
  })
})
