/* Ticket DbiT9qrFwL4O5ibgSowF: the deal sheet a retail media team shares so a buyer can key a deal into their DSP. */
import { describe, expect, it } from 'vitest'
import { buildApp } from '../src/http/app'
import { expectMatchesContract } from './contract'
import { testContext } from './helpers'

const URL = '/api/admin/v1/buyers-lists'
const list = { name: 'Q4 private auction', description: '', invitedBuyers: [{ partnerId: 'p_google', seatId: '5130001' }], activeFrom: '2026-10-01T00:00:00.000Z', activeTo: '2026-12-31T00:00:00.000Z', floorCpm: 150 }

describe('Deal sheet', () => {
  it('carries the DSP deal ID, type, rate, term, invited seats and the creative spec', async () => {
    const ctx = await testContext()
    await ctx.partners.update('p_google', { seats: [{ id: '5130001', name: 'Nestlé', category: 'Food & Drink' }] })
    const app = buildApp(ctx)
    const created = (await app.inject({ method: 'POST', url: URL, payload: list })).json()
    const res = await app.inject({ method: 'GET', url: `${URL}/${created.id}/deal-sheet` })
    expect(res.statusCode).toBe(200)
    expectMatchesContract('GET', '/admin/v1/buyers-lists/{buyersListId}/deal-sheet', 200, res.json())
    const sheet = res.json()
    expect(sheet).toMatchObject({ buyersListId: created.id, dealType: 'private_auction', rateCpm: 150, rateKind: 'floor', activeFrom: list.activeFrom, activeTo: list.activeTo })
    expect(sheet.entries).toHaveLength(1)
    expect(sheet.entries[0]).toMatchObject({ partnerId: 'p_google', dealId: created.dealId, seats: [{ id: '5130001', name: 'Nestlé' }] })
    expect(sheet.entries[0].setup).toMatch(/DV360/)
    expect(Array.isArray(sheet.creativeRequirements)).toBe(true)
  })

  it('downloads as CSV with one row per DSP deal and creative format, quoting commas', async () => {
    const ctx = await testContext()
    const app = buildApp(ctx)
    const created = (await app.inject({ method: 'POST', url: URL, payload: { ...list, name: 'Food, drink' } })).json()
    const res = await app.inject({ method: 'GET', url: `${URL}/${created.id}/deal-sheet?format=csv` })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toMatch(/text\/csv/)
    expect(res.headers['content-disposition']).toContain(`deal-sheet-${created.id}.csv`)
    const lines = res.body.trim().split('\r\n')
    expect(lines[0]).toContain('Deal ID')
    expect(lines.length).toBeGreaterThanOrEqual(2)
    expect(lines[1]).toContain('"Food, drink"')
    expect(lines[1]).toContain(created.dealId)
  })

  it('has no entries for a category-only list, 404s an unknown list and 400s an unknown format', async () => {
    const ctx = await testContext()
    const app = buildApp(ctx)
    const cat = (await app.inject({ method: 'POST', url: URL, payload: { name: 'Cats', description: '', invitedBuyers: [], invitedCategories: ['Food & Drink'], activeFrom: null, activeTo: null } })).json()
    expect((await app.inject({ method: 'GET', url: `${URL}/${cat.id}/deal-sheet` })).json().entries).toEqual([])
    expect((await app.inject({ method: 'GET', url: `${URL}/nope/deal-sheet` })).statusCode).toBe(404)
    expect((await app.inject({ method: 'GET', url: `${URL}/${cat.id}/deal-sheet?format=pdf` })).statusCode).toBe(400)
  })
})
