import { describe, expect, it } from 'vitest'
import { buildApp } from '../src/http/app'
import { expectMatchesContract } from './contract'
import { testContext } from './helpers'

const input = {
  currency: 'NZD', floorCpm: 120, personalisedMultiplier: 1.6, interactiveMultiplier: 2.5,
  advertiserWhitelist: ['Nestlé', ' Swisse '], advertiserBlacklist: ['Red Bull', 'red bull'], categoryWhitelist: ['Food & Drink'], categoryBlacklist: ['Finance'],
}

describe('Advertiser settings (spec §4, §6)', () => {
  it('saves pricing and lists, trimming and de-duplicating entries', async () => {
    const app = buildApp(await testContext())
    const res = await app.inject({ method: 'PUT', url: '/api/admin/v1/advertiser-settings', payload: input })
    expect(res.statusCode).toBe(200)
    expectMatchesContract('PUT', '/admin/v1/advertiser-settings', 200, res.json())
    expect(res.json()).toMatchObject({ currency: 'NZD', floorCpm: 120, advertiserWhitelist: ['Nestlé', 'Swisse'], advertiserBlacklist: ['Red Bull'] })
  })

  it('rejects an entry on both lists (case-insensitive), a non-ISO currency and a non-positive floor', async () => {
    const app = buildApp(await testContext())
    const res = await app.inject({ method: 'PUT', url: '/api/admin/v1/advertiser-settings', payload: { ...input, currency: 'XYZ1', floorCpm: 0, advertiserBlacklist: ['NESTLÉ'], categoryBlacklist: ['food & drink'] } })
    expect(res.statusCode).toBe(400)
    expectMatchesContract('PUT', '/admin/v1/advertiser-settings', 400, res.json())
    expect(res.json().error.details.map((d: { field: string }) => d.field)).toEqual(['currency', 'floorCpm', 'advertiserWhitelist', 'categoryWhitelist'])
  })

  it('Available Inventory lists every advertiser-owned slot, with no advertisers column', async () => {
    const res = await buildApp(await testContext()).inject({ method: 'GET', url: '/api/admin/v1/available-inventory' })
    expectMatchesContract('GET', '/admin/v1/available-inventory', 200, res.json())
    expect(res.json().items).toEqual([{ displayTypeId: 'menu_board', displayTypeName: 'Menu Board — Long Format', touchPoint: 'Digital Signage', playlistName: 'Menu Board Playlist', slot: 2, position: 'Supplier slot', partnerName: 'Google DSP' }])
  })

  it.each([['PUT', '/advertiser-settings'], ['GET', '/available-inventory']] as const)('%s %s returns 404 with the flag off', async (method, path) => {
    expect((await buildApp(await testContext({ flag: false })).inject({ method, url: `/api/admin/v1${path}`, payload: input })).statusCode).toBe(404)
  })
})
