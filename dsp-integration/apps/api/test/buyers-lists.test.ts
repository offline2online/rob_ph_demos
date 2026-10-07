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

  /* 7 Oct 2026, open question 45: volume is carried by deals, never the open auction. */
  describe('committed plays (volume lives on the deal)', () => {
    const term = { activeFrom: '2026-10-01T00:00:00.000Z', activeTo: '2026-10-31T00:00:00.000Z' }
    const item = (id: string, positionId: string, windowStart: string, plays: number) => ({
      id: `bl_${id}`, reservationId: id, partnerId: 'p_google', advertiserId: 'nestle', campaignId: 'c_x', positionId, windowStart, windowEnd: windowStart,
      plays, playedSec: 1, expectedSec: 1, assumedViews: 1, realisedViews: 1, cpm: 1, currency: 'AUD', amount: 1, playsByVersion: [],
    })

    it('saves, returns and edits committedPlays; null means per play', async () => {
      const app = buildApp(await testContext())
      const created = await app.inject({ method: 'POST', url: '/api/admin/v1/buyers-lists', payload: { ...list, ...term, committedPlays: 1000 } })
      expect(created.statusCode).toBe(201)
      expectMatchesContract('POST', '/admin/v1/buyers-lists', 201, created.json())
      expect(created.json()).toMatchObject({ committedPlays: 1000, deliveredPlays: 0 })
      const plain = await app.inject({ method: 'POST', url: '/api/admin/v1/buyers-lists', payload: list })
      expect(plain.json()).toMatchObject({ committedPlays: null, deliveredPlays: 0 })
      const updated = await app.inject({ method: 'PUT', url: `/api/admin/v1/buyers-lists/${created.json().id}`, payload: { ...list, ...term, committedPlays: null } })
      expectMatchesContract('PUT', '/admin/v1/buyers-lists/{buyersListId}', 200, updated.json())
      expect(updated.json().committedPlays).toBeNull()
    })

    it('refuses zero, fractions, negatives and non-numbers', async () => {
      const app = buildApp(await testContext())
      for (const committedPlays of [0, 1.5, -3, '1000']) {
        const res = await app.inject({ method: 'POST', url: '/api/admin/v1/buyers-lists', payload: { ...list, committedPlays } })
        expect(res.statusCode).toBe(400)
        expect(res.json().error.details.map((d: { field: string }) => d.field)).toEqual(['committedPlays'])
      }
    })

    it("meters delivery in plays at the deal's positions, inside its term only", async () => {
      const ctx = await testContext()
      const app = buildApp(ctx)
      const id = (await app.inject({ method: 'POST', url: '/api/admin/v1/buyers-lists', payload: { ...list, ...term, committedPlays: 1000 } })).json().id
      await app.inject({
        method: 'PUT', url: '/api/admin/v1/available-inventory',
        payload: { items: [{ displayTypeId: 'menu_board', slot: 2, assignedTo: { partnerIds: [], advertisers: [], whitelistOnly: false, buyersListId: id } }] },
      })
      await ctx.billing.insert(item('a', 'menu_board.s2', '2026-10-05T00:00:00.000Z', 120), '2026-10-06T00:00:00.000Z')
      await ctx.billing.insert(item('b', 'menu_board.s2', '2026-10-20T00:00:00.000Z', 80), '2026-10-21T00:00:00.000Z')
      await ctx.billing.insert(item('c', 'menu_board.s2', '2026-09-20T00:00:00.000Z', 500), '2026-09-21T00:00:00.000Z') // before the term
      await ctx.billing.insert(item('d', 'menu_board.s1', '2026-10-05T00:00:00.000Z', 700), '2026-10-06T00:00:00.000Z') // another position
      const listed = (await app.inject({ method: 'GET', url: '/api/admin/v1/buyers-lists' })).json()
      expectMatchesContract('GET', '/admin/v1/buyers-lists', 200, listed)
      expect(listed.items[0]).toMatchObject({ committedPlays: 1000, deliveredPlays: 200 })
    })

    it('a deal with no commitment reports no delivery: the open auction holds no volume', async () => {
      const ctx = await testContext()
      const app = buildApp(ctx)
      const id = (await app.inject({ method: 'POST', url: '/api/admin/v1/buyers-lists', payload: list })).json().id
      await app.inject({
        method: 'PUT', url: '/api/admin/v1/available-inventory',
        payload: { items: [{ displayTypeId: 'menu_board', slot: 2, assignedTo: { partnerIds: [], advertisers: [], whitelistOnly: false, buyersListId: id } }] },
      })
      await ctx.billing.insert(item('a', 'menu_board.s2', '2026-10-05T00:00:00.000Z', 120), '2026-10-06T00:00:00.000Z')
      expect((await app.inject({ method: 'GET', url: '/api/admin/v1/buyers-lists' })).json().items[0]).toMatchObject({ committedPlays: null, deliveredPlays: 0 })
    })
  })
  /* 7 Oct 2026: the deal type lives on the list and decides which fields it may carry. */
  describe('deal type', () => {
    const post = (app: ReturnType<typeof buildApp>, payload: Record<string, unknown>) => app.inject({ method: 'POST', url: '/api/admin/v1/buyers-lists', payload: { ...list, ...payload } })

    it('defaults to a private auction, or guaranteed when an older client sends committedPlays', async () => {
      const app = buildApp(await testContext())
      const plain = await post(app, {})
      expectMatchesContract('POST', '/admin/v1/buyers-lists', 201, plain.json())
      expect(plain.json().dealType).toBe('private_auction')
      expect((await post(app, { committedPlays: 500 })).json().dealType).toBe('guaranteed')
    })

    it('only a guaranteed deal commits volume; only a private auction has an auction window', async () => {
      const app = buildApp(await testContext())
      const guaranteed = await post(app, { dealType: 'guaranteed', committedPlays: 800 })
      expect(guaranteed.statusCode).toBe(201)
      expect(guaranteed.json()).toMatchObject({ dealType: 'guaranteed', committedPlays: 800 })
      const preferred = await post(app, { dealType: 'preferred' })
      expect(preferred.statusCode).toBe(201)
      expect(preferred.json()).toMatchObject({ dealType: 'preferred', committedPlays: null, auctionCloses: null, effectiveCommittedPlays: { source: 'none' } })
      const closes = '2026-10-10T00:00:00.000Z'
      expect((await post(app, { dealType: 'private_auction', auctionCloses: closes })).json().auctionCloses).toBe(closes)
      for (const [payload, field] of [
        [{ dealType: 'preferred', committedPlays: 100 }, 'committedPlays'],
        [{ dealType: 'private_auction', committedPlays: 100 }, 'committedPlays'],
        [{ dealType: 'guaranteed', auctionCloses: closes }, 'auctionCloses'],
        [{ dealType: 'preferred', auctionCloses: closes }, 'auctionCloses'],
        [{ dealType: 'sealed_bid' }, 'dealType'],
      ] as const) {
        const res = await post(app, payload)
        expect(res.statusCode).toBe(400)
        expect(res.json().error.details.map((d: { field: string }) => d.field)).toEqual([field])
      }
    })
  })
})
