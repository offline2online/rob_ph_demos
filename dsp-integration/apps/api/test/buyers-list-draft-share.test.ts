/* Deal lifecycle: Save as draft -> Finalise -> Share deal (ticket QG40V1vVwqp9NtFmlC9H). */
import { describe, expect, it } from 'vitest'
import { buildApp } from '../src/http/app'
import { expectMatchesContract } from './contract'
import { testContext } from './helpers'

const GOOGLE = { authorization: 'Bearer poc-token-google-dv360' }
const U = '/api/admin/v1/buyers-lists'
const body = { name: 'Q4 deal', description: 'FMCG', invitedBuyers: [{ partnerId: 'p_google', seatId: '5130001' }], activeFrom: null, activeTo: null, floorCpm: 120 }

async function setup() {
  const ctx = await testContext()
  const app = buildApp(ctx)
  const created = await app.inject({ method: 'POST', url: U, payload: { ...body, status: 'draft' } })
  expect(created.statusCode, JSON.stringify(created.json())).toBe(201)
  return { ctx, app, id: created.json().id as string, created: created.json() }
}
const assign = async (ctx: Awaited<ReturnType<typeof testContext>>, id: string) => {
  const dt = (await ctx.displayTypes.get('menu_board'))!
  const slot = dt.phExtensions!.slots.find((s) => s.owner === 'advertiser')!
  await ctx.displayTypes.saveExtensions('menu_board', { ...dt.phExtensions!, slots: [...dt.phExtensions!.slots.filter((s) => s !== slot), { ...slot, listMode: 'deal', buyersListId: id, buyersListIds: [id] }] as never })
}

describe('Buyers list draft -> share', () => {
  it('saves as a draft: not shared, no slots, nothing offered to the DSP', async () => {
    const { app, created } = await setup()
    expect(created).toMatchObject({ status: 'draft', sharedAt: null, assignedSlots: [] })
    expectMatchesContract('POST', '/admin/v1/buyers-lists', 201, created)
    const deals = await app.inject({ method: 'GET', url: '/api/v1/deals', headers: GOOGLE })
    expect(deals.json().items.map((d: { name: string }) => d.name)).not.toContain('Q4 deal')
  })

  it('an API client that omits status still creates a shared deal, as before drafts existed', async () => {
    const app = buildApp(await testContext())
    const r = await app.inject({ method: 'POST', url: U, payload: body })
    expect(r.json()).toMatchObject({ status: 'shared' })
    expect(r.json().sharedAt).toEqual(expect.any(String))
    expect((await app.inject({ method: 'POST', url: U, payload: { ...body, status: 'bogus' } })).statusCode).toBe(400)
  })

  it('cannot be shared until it has a slot, then shares and appears to the invited DSP', async () => {
    const { ctx, app, id } = await setup()
    const refused = await app.inject({ method: 'POST', url: `${U}/${id}/share` })
    expect(refused.statusCode).toBe(400)
    expect(JSON.stringify(refused.json())).toContain('at least one slot')

    await assign(ctx, id)
    const listed = (await app.inject({ method: 'GET', url: U })).json().items.find((l: { id: string }) => l.id === id)
    expect(listed.assignedSlots).toHaveLength(1)
    expect(listed.assignedSlots[0].label).toContain('—')
    expectMatchesContract('GET', '/admin/v1/buyers-lists', 200, { items: [listed] })
    /* Ticket c5S06G5mN6F3GJTI8bxD: each slot says its number within its zone, the zone and the display type's description. */
    expect(listed.assignedSlots[0]).toMatchObject({ displayTypeName: expect.any(String), slot: expect.any(Number), zoneSlot: expect.any(Number) })
    expect(listed.assignedSlots[0]).toHaveProperty('zoneName')
    expect(listed.assignedSlots[0]).toHaveProperty('description')
    const sheet = (await app.inject({ method: 'GET', url: `${U}/${id}/deal-sheet` })).json()
    expect(sheet.slots).toHaveLength(1)
    expect(sheet.slots[0]).toMatchObject({ positionId: listed.assignedSlots[0].positionId, zoneSlot: listed.assignedSlots[0].zoneSlot, zoneName: listed.assignedSlots[0].zoneName })
    expectMatchesContract('GET', '/admin/v1/buyers-lists/{buyersListId}/deal-sheet', 200, sheet)
    expect((await app.inject({ method: 'GET', url: `${U}/${id}/deal-sheet?format=csv` })).body).toContain('Slots')

    const shared = await app.inject({ method: 'POST', url: `${U}/${id}/share` })
    expect(shared.statusCode, JSON.stringify(shared.json())).toBe(200)
    expectMatchesContract('POST', '/admin/v1/buyers-lists/{buyersListId}/share', 200, shared.json())
    expect(shared.json()).toMatchObject({ status: 'shared', termVersion: 1 })
    expect(shared.json().buyerAcceptance[0].state).toBe('pending')
    const deals = await app.inject({ method: 'GET', url: '/api/v1/deals', headers: GOOGLE })
    expect(deals.json().items.map((d: { name: string }) => d.name)).toContain('Q4 deal')
    /* Sharing again is a no-op. */
    const again = await app.inject({ method: 'POST', url: `${U}/${id}/share` })
    expect(again.json().sharedAt).toBe(shared.json().sharedAt)
    expect((await app.inject({ method: 'POST', url: `${U}/nope/share` })).statusCode).toBe(404)
  })

  it('a category-only deal has no named buyer to share with', async () => {
    const ctx = await testContext()
    const app = buildApp(ctx)
    const r = await app.inject({ method: 'POST', url: U, payload: { ...body, invitedBuyers: [], invitedCategories: ['Automotive'], status: 'draft' } })
    expect(r.statusCode, JSON.stringify(r.json())).toBe(201)
    await assign(ctx, r.json().id)
    const share = await app.inject({ method: 'POST', url: `${U}/${r.json().id}/share` })
    expect(share.statusCode).toBe(400)
    expect(JSON.stringify(share.json())).toContain('named buyer')
  })

  it('editing a draft needs no re-approval; editing a shared deal does', async () => {
    const { ctx, app, id } = await setup()
    const check = await app.inject({ method: 'POST', url: `${U}/${id}/term-check`, payload: { ...body, floorCpm: 150 } })
    expect(check.json()).toMatchObject({ requiresReacceptance: false, nextVersion: 1, affectedBuyers: [] })
    const draftPut = await app.inject({ method: 'PUT', url: `${U}/${id}`, payload: { ...body, floorCpm: 150, status: 'shared' } })
    expect(draftPut.json()).toMatchObject({ status: 'draft', termVersion: 1, floorCpm: 150 })
    expect((await app.inject({ method: 'POST', url: `${U}/${id}/acceptances`, payload: { partnerId: 'p_google', seatId: '5130001' } })).statusCode).toBe(400)

    await assign(ctx, id)
    await app.inject({ method: 'POST', url: `${U}/${id}/share` })
    await app.inject({ method: 'POST', url: `${U}/${id}/acceptances`, payload: { partnerId: 'p_google', seatId: '5130001' } })
    const after = await app.inject({ method: 'POST', url: `${U}/${id}/term-check`, payload: { ...body, floorCpm: 175 } })
    expect(after.json()).toMatchObject({ requiresReacceptance: true, nextVersion: 2 })
    const put = await app.inject({ method: 'PUT', url: `${U}/${id}`, payload: { ...body, floorCpm: 175 } })
    expect(put.json()).toMatchObject({ status: 'shared', termVersion: 2 })
    expect(put.json().buyerAcceptance[0].state).toBe('reacceptance_required')
  })
})
