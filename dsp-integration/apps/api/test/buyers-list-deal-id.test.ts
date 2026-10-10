/* Ticket 5CCgGEYSkVoDTH9yNSYu: a buyers list carries a platform-minted, immutable deal ID; the deal type is fixed too, so changing it mints a new deal. */
import { describe, expect, it } from 'vitest'
import { buildApp } from '../src/http/app'
import { expectMatchesContract } from './contract'
import { testContext } from './helpers'

const list = { name: 'Q4 private auction', description: '', invitedBuyers: [{ partnerId: 'p_google', seatId: '5130001' }], activeFrom: null, activeTo: null }
const URL = '/api/admin/v1/buyers-lists'

describe('Buyers list deal ID', () => {
  it('mints a unique PH- deal ID on create and refuses a typed one', async () => {
    const app = buildApp(await testContext())
    const a = await app.inject({ method: 'POST', url: URL, payload: list })
    const b = await app.inject({ method: 'POST', url: URL, payload: list })
    expect(a.json().dealId).toMatch(/^PH-[0-9A-Z]{10}$/)
    expect(b.json().dealId).not.toBe(a.json().dealId)
    const typed = await app.inject({ method: 'POST', url: URL, payload: { ...list, dealId: 'PH-MINE' } })
    expect(typed.statusCode).toBe(400)
    expect(typed.json().error.details.map((d: { field: string }) => d.field)).toEqual(['dealId'])
  })

  it('keeps the ID on an in-place edit, 400s a different one, and mints a new deal when the type changes', async () => {
    const app = buildApp(await testContext())
    const created = (await app.inject({ method: 'POST', url: URL, payload: list })).json()
    const put = (payload: Record<string, unknown>) => app.inject({ method: 'PUT', url: `${URL}/${created.id}`, payload })

    const same = await put({ ...list, floorCpm: 150 })
    expect(same.statusCode).toBe(200)
    expectMatchesContract('PUT', '/admin/v1/buyers-lists/{buyersListId}', 200, same.json())
    expect(same.json()).toMatchObject({ id: created.id, dealId: created.dealId, floorCpm: 150 })
    expect((await put({ ...list, dealId: created.dealId })).statusCode).toBe(200)
    expect((await put({ ...list, dealId: 'PH-OTHER' })).statusCode).toBe(400)

    const changed = await put({ ...list, dealType: 'preferred' })
    expect(changed.statusCode).toBe(201)
    expectMatchesContract('PUT', '/admin/v1/buyers-lists/{buyersListId}', 201, changed.json())
    expect(changed.json().id).not.toBe(created.id)
    expect(changed.json().dealId).not.toBe(created.dealId)
    expect(changed.json().dealType).toBe('preferred')

    const items = (await app.inject({ method: 'GET', url: URL })).json().items
    expect(items).toHaveLength(2)
    expect(items.find((l: { id: string }) => l.id === created.id)).toMatchObject({ dealType: 'private_auction', dealId: created.dealId })
  })

  it('an edit that omits dealType leaves a preferred deal as it is', async () => {
    const app = buildApp(await testContext())
    const created = (await app.inject({ method: 'POST', url: URL, payload: { ...list, dealType: 'preferred' } })).json()
    const res = await app.inject({ method: 'PUT', url: `${URL}/${created.id}`, payload: { ...list, name: 'Renamed' } })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ id: created.id, dealId: created.dealId, dealType: 'preferred' })
  })

  it('the database refuses to change a deal ID', async () => {
    const ctx = await testContext()
    const l = await ctx.buyersLists.insert({ id: 'bl_x', name: 'x', description: '', invitedBuyers: [], activeFrom: null, activeTo: null, auctionCloses: null })
    await expect(Promise.resolve().then(() => ctx.db.exec(`UPDATE buyers_lists SET deal_id = 'PH-NEW' WHERE id = '${l.id}'`))).rejects.toThrow(/cannot be changed/)
  })
})
