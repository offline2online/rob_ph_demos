import { describe, expect, it } from 'vitest'
import { buildApp } from '../src/http/app'
import { expectMatchesContract } from './contract'
import { testContext } from './helpers'

const list = {
  name: 'Q4 private auction', description: 'Invited FMCG brands only',
  invitedBuyers: [{ partnerId: 'p_google', seatId: '5130001' }],
  activeFrom: null, activeTo: null,
}

describe('Buyers lists (spec "Support private auctions")', () => {
  it('creates, lists, updates and deletes a buyers list', async () => {
    const app = buildApp(await testContext())
    const created = await app.inject({ method: 'POST', url: '/api/admin/v1/buyers-lists', payload: list })
    expect(created.statusCode).toBe(201)
    expectMatchesContract('POST', '/admin/v1/buyers-lists', 201, created.json())
    const id = created.json().id
    expect(created.json()).toMatchObject(list)

    const listed = await app.inject({ method: 'GET', url: '/api/admin/v1/buyers-lists' })
    expectMatchesContract('GET', '/admin/v1/buyers-lists', 200, listed.json())
    expect(listed.json().items).toHaveLength(1)

    const updated = await app.inject({
      method: 'PUT', url: `/api/admin/v1/buyers-lists/${id}`,
      payload: { ...list, name: 'Q4 private auction (renamed)', invitedBuyers: [...list.invitedBuyers, { partnerId: 'p_google', seatId: '5130002' }] },
    })
    expect(updated.statusCode).toBe(200)
    expectMatchesContract('PUT', '/admin/v1/buyers-lists/{buyersListId}', 200, updated.json())
    expect(updated.json().name).toBe('Q4 private auction (renamed)')
    expect(updated.json().invitedBuyers).toHaveLength(2)

    const deleted = await app.inject({ method: 'DELETE', url: `/api/admin/v1/buyers-lists/${id}` })
    expect(deleted.statusCode).toBe(204)
    expect((await app.inject({ method: 'GET', url: '/api/admin/v1/buyers-lists' })).json().items).toHaveLength(0)
  })

  it('rejects an empty name, no invited buyers, an unknown DSP, a seat the DSP never synced, a DSP that is not connected, and an active window the wrong way round', async () => {
    const app = buildApp(await testContext())
    const fields = async (payload: Record<string, unknown>) => {
      const res = await app.inject({ method: 'POST', url: '/api/admin/v1/buyers-lists', payload })
      expect(res.statusCode).toBe(400)
      expectMatchesContract('POST', '/admin/v1/buyers-lists', 400, res.json())
      return res.json().error.details.map((d: { field: string }) => d.field)
    }
    expect(await fields({ ...list, name: '  ' })).toEqual(['name'])
    expect(await fields({ ...list, invitedBuyers: [] })).toEqual(['invitedBuyers'])
    expect(await fields({ ...list, invitedBuyers: [{ partnerId: 'p_nope', seatId: '5130001' }] })).toEqual(['invitedBuyers[0].partnerId'])
    expect(await fields({ ...list, invitedBuyers: [{ partnerId: 'p_google', seatId: 'Nestlé' }] })).toEqual(['invitedBuyers[0].seatId'])
    expect(await fields({ ...list, invitedBuyers: [{ partnerId: 'p_amazon', seatId: '588104411' }] })).toEqual(['invitedBuyers[0].partnerId'])
    expect(await fields({ ...list, invitedBuyers: [{ identifierType: 'brandEntity', value: 'Nestlé' }] })).toEqual(['invitedBuyers[0].partnerId'])
    expect(await fields({ ...list, activeFrom: '2026-10-01T00:00:00Z', activeTo: '2026-09-01T00:00:00Z' })).toEqual(['activeTo'])
  })

  it("404s updating or deleting a buyers list that doesn't exist", async () => {
    const app = buildApp(await testContext())
    expect((await app.inject({ method: 'PUT', url: '/api/admin/v1/buyers-lists/bl_nope', payload: list })).statusCode).toBe(404)
    expect((await app.inject({ method: 'DELETE', url: '/api/admin/v1/buyers-lists/bl_nope' })).statusCode).toBe(404)
  })

  it("can't be deleted while a slot is assigned to it, and can be assigned from Available Inventory", async () => {
    const ctx = await testContext()
    const app = buildApp(ctx)
    const created = await app.inject({ method: 'POST', url: '/api/admin/v1/buyers-lists', payload: list })
    const id = created.json().id

    const save = (buyersListId: string | null) => app.inject({
      method: 'PUT', url: '/api/admin/v1/available-inventory',
      payload: { items: [{ displayTypeId: 'menu_board', slot: 2, assignedTo: { partnerIds: [], advertisers: [], whitelistOnly: false, buyersListId } }] },
    })
    const assigned = await save(id)
    expect(assigned.statusCode).toBe(200)
    expect(assigned.json().items[0].assignedTo).toMatchObject({ buyersListId: id, buyersListName: 'Q4 private auction' })
    expect((await ctx.displayTypes.get('menu_board'))!.phExtensions!.slots[1]).toMatchObject({ listMode: 'deal', buyersListId: id })

    const blocked = await app.inject({ method: 'DELETE', url: `/api/admin/v1/buyers-lists/${id}` })
    expect(blocked.statusCode).toBe(409)
    expectMatchesContract('DELETE', '/admin/v1/buyers-lists/{buyersListId}', 409, blocked.json())

    /* Unassign, then the delete succeeds. */
    expect((await save(null)).statusCode).toBe(200)
    expect((await app.inject({ method: 'DELETE', url: `/api/admin/v1/buyers-lists/${id}` })).statusCode).toBe(204)
  })

  it('rejects assigning a slot to both a buyers list and named advertisers, or an unknown buyers list', async () => {
    const app = buildApp(await testContext())
    const save = (assignedTo: Record<string, unknown>) => app.inject({
      method: 'PUT', url: '/api/admin/v1/available-inventory',
      payload: { items: [{ displayTypeId: 'menu_board', slot: 2, assignedTo }] },
    })
    const res1 = await save({ partnerIds: [], advertisers: ['Nestlé'], whitelistOnly: false, buyersListId: 'bl_nope' })
    expect(res1.statusCode).toBe(400)
    expect(res1.json().error.details.map((d: { field: string }) => d.field)).toContain('items[0].assignedTo.buyersListId')

    const res2 = await save({ partnerIds: [], advertisers: [], whitelistOnly: false, buyersListId: 'bl_nope' })
    expect(res2.statusCode).toBe(400)
    expect(res2.json().error.details.map((d: { field: string }) => d.field)).toEqual(['items[0].assignedTo.buyersListId'])
  })

  describe('targeting criteria (buyers and targeting definition)', () => {
    const post = (app: ReturnType<typeof buildApp>, targeting: unknown) =>
      app.inject({ method: 'POST', url: '/api/admin/v1/buyers-lists', payload: { ...list, targeting } })

    it('stores enabled criteria on the list and defaults to none', async () => {
      const app = buildApp(await testContext())
      expect((await post(app, undefined)).json().targeting).toEqual([])
      const crit = [
        { source: 'store', variable: 'store.variable_segments', op: 'include', values: ['Cold Day'] },
        { source: 'store', variable: 'store.fixed_segments', op: 'include', values: ['Airport'] },
        { source: 'store', variable: 'store.state', op: 'include', values: ['NSW'] },
        { source: 'store', variable: 'store.display_tags', op: 'include', values: ['Entrance'] },
      ]
      const res = await post(app, crit)
      expect(res.statusCode, res.body).toBe(201)
      expectMatchesContract('POST', '/admin/v1/buyers-lists', 201, res.json())
      expect(res.json().targeting).toEqual(crit)
      expect((await app.inject({ method: 'GET', url: '/api/admin/v1/buyers-lists' })).json().items[0].targeting).toBeDefined()
    })

    it('refuses a personalised criterion the retailer has not enabled for the DSP, and accepts it once enabled', async () => {
      const app = buildApp(await testContext())
      const personalised = [{ source: 'visitor', variable: 'visitor.visitor_segments', op: 'include', values: ['Fitness'] }]
      const refused = await post(app, personalised)
      expect(refused.statusCode).toBe(400)
      expect(JSON.stringify(refused.json())).toContain('targeting[0].variable')
      const vars = (await app.inject({ method: 'GET', url: '/api/admin/v1/targeting-variables' })).json().items as { key: string; access: unknown }[]
      const access = Object.fromEntries(vars.map((v) => [v.key, v.access]))
      access['visitor.visitor_segments'] = ['p_google']
      expect((await app.inject({ method: 'PUT', url: '/api/admin/v1/targeting-variables', payload: { access } })).statusCode).toBe(200)
      const ok = await post(app, personalised)
      expect(ok.statusCode).toBe(201)
      expect(ok.json().targeting).toEqual(personalised)
    })

    it('rejects an unknown variable, a wrong operator and empty values', async () => {
      const app = buildApp(await testContext())
      expect((await post(app, [{ variable: 'nope', op: 'include', values: ['x'] }])).statusCode).toBe(400)
      expect((await post(app, [{ variable: 'store.state', op: 'greater_than', values: ['x'] }])).statusCode).toBe(400)
      expect((await post(app, [{ variable: 'store.state', op: 'include', values: [] }])).statusCode).toBe(400)
    })
  })
})
