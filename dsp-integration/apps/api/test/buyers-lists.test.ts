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
  it('creates, lists, updates and archives a buyers list', async () => {
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

    const archived = await app.inject({ method: 'POST', url: `/api/admin/v1/buyers-lists/${id}/archive` })
    expect(archived.statusCode).toBe(200)
    expectMatchesContract('POST', '/admin/v1/buyers-lists/{buyersListId}/archive', 200, archived.json())
    expect(archived.json()).toMatchObject({ id, status: 'archived', archivedBy: expect.any(String), archivedAt: expect.any(String) })
    expect((await app.inject({ method: 'GET', url: '/api/admin/v1/buyers-lists' })).json().items).toHaveLength(0)
    const archive = (await app.inject({ method: 'GET', url: '/api/admin/v1/buyers-lists?archived=true' })).json()
    expectMatchesContract('GET', '/admin/v1/buyers-lists', 200, archive)
    expect(archive.items.map((l: { id: string; dealId: string }) => [l.id, l.dealId])).toEqual([[id, created.json().dealId]])
    /* Read-only from here: edit, share and acceptance answer 409, and there is no delete. */
    expect((await app.inject({ method: 'PUT', url: `/api/admin/v1/buyers-lists/${id}`, payload: list })).statusCode).toBe(409)
    expect((await app.inject({ method: 'POST', url: `/api/admin/v1/buyers-lists/${id}/share` })).statusCode).toBe(409)
    expect((await app.inject({ method: 'POST', url: `/api/admin/v1/buyers-lists/${id}/acceptances`, payload: { partnerId: 'p_google', seatId: '5130001' } })).statusCode).toBe(409)
    expect((await app.inject({ method: 'DELETE', url: `/api/admin/v1/buyers-lists/${id}` })).statusCode).toBe(409)
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

  it("404s updating or archiving a buyers list that doesn't exist", async () => {
    const app = buildApp(await testContext())
    expect((await app.inject({ method: 'PUT', url: '/api/admin/v1/buyers-lists/bl_nope', payload: list })).statusCode).toBe(404)
    expect((await app.inject({ method: 'POST', url: '/api/admin/v1/buyers-lists/bl_nope/archive' })).statusCode).toBe(404)
  })

  it('deletes a draft deal for good, but not a shared one', async () => {
    const app = buildApp(await testContext())
    const draft = (await app.inject({ method: 'POST', url: '/api/admin/v1/buyers-lists', payload: { ...list, status: 'draft' } })).json()
    expect(draft.status).toBe('draft')
    const del = await app.inject({ method: 'DELETE', url: `/api/admin/v1/buyers-lists/${draft.id}` })
    expect(del.statusCode).toBe(204)
    expect((await app.inject({ method: 'GET', url: '/api/admin/v1/buyers-lists' })).json().items).toHaveLength(0)
    expect((await app.inject({ method: 'GET', url: '/api/admin/v1/buyers-lists?archived=true' })).json().items).toHaveLength(0)
    expect((await app.inject({ method: 'DELETE', url: `/api/admin/v1/buyers-lists/${draft.id}` })).statusCode).toBe(404)

    const shared = (await app.inject({ method: 'POST', url: '/api/admin/v1/buyers-lists', payload: list })).json()
    expect(shared.status).toBe('shared')
    const refused = await app.inject({ method: 'DELETE', url: `/api/admin/v1/buyers-lists/${shared.id}` })
    expect(refused.statusCode).toBe(409)
    expectMatchesContract('DELETE', '/admin/v1/buyers-lists/{buyersListId}', 409, refused.json())
    expect((await app.inject({ method: 'GET', url: '/api/admin/v1/buyers-lists' })).json().items).toHaveLength(1)
  })

  it("can't be archived while a slot is assigned to it, and can be assigned from Available Inventory", async () => {
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

    const blocked = await app.inject({ method: 'POST', url: `/api/admin/v1/buyers-lists/${id}/archive` })
    expect(blocked.statusCode).toBe(409)
    expect(blocked.json().error.code).toBe('has_dependents')
    expectMatchesContract('POST', '/admin/v1/buyers-lists/{buyersListId}/archive', 409, blocked.json())

    /* Unassign, then the archive succeeds; an archived deal can't be assigned again. */
    expect((await save(null)).statusCode).toBe(200)
    expect((await app.inject({ method: 'POST', url: `/api/admin/v1/buyers-lists/${id}/archive` })).statusCode).toBe(200)
    expect((await save(id)).statusCode).toBeGreaterThanOrEqual(400)
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

    it('only accepts values defined in Shared Targeting Variables, unless the variable is free text', async () => {
      const app = buildApp(await testContext())
      const put = (values: unknown) => app.inject({ method: 'PUT', url: '/api/admin/v1/targeting-variables', payload: { access: { 'store.state': ['p_google'] }, values } })
      /* Nothing defined: open, so lists saved before values existed keep working. */
      expect((await post(app, [{ variable: 'store.state', op: 'include', values: ['NSW'] }])).statusCode).toBe(201)
      expect((await put({ 'store.state': { values: ['NSW', 'VIC'], freeText: false } })).statusCode).toBe(200)
      expect((await post(app, [{ variable: 'store.state', op: 'include', values: ['NSW', 'VIC'] }])).statusCode).toBe(201)
      const refused = await post(app, [{ variable: 'store.state', op: 'include', values: ['QLD'] }])
      expect(refused.statusCode).toBe(400)
      expect(JSON.stringify(refused.json())).toContain('QLD is not defined for')
      expect(JSON.stringify(refused.json())).toContain('in Shared Targeting Variables.')
      expect((await put({ 'store.state': { values: ['NSW'], freeText: true } })).statusCode).toBe(200)
      expect((await post(app, [{ variable: 'store.state', op: 'include', values: ['QLD'] }])).statusCode).toBe(201)
    })

    it('validates an aggregate criterion ("<category>: <n>%") by its category, not the whole string', async () => {
      const app = buildApp(await testContext())
      const put = (values: unknown) => app.inject({ method: 'PUT', url: '/api/admin/v1/targeting-variables', payload: { access: { 'store.reason_for_visit': ['p_google'] }, values } })
      expect((await put({ 'store.reason_for_visit': { values: ['Returns', 'Health and beauty'], freeText: false } })).statusCode).toBe(200)
      const crit = (v: string) => [{ variable: 'store.reason_for_visit', op: 'greater_than', values: [v] }]
      expect((await post(app, crit('Health and beauty: 50%'))).statusCode).toBe(201)
      const unknown = await post(app, crit('Warranty: 50%'))
      expect(unknown.statusCode).toBe(400)
      expect(JSON.stringify(unknown.json())).toContain('Warranty: 50% is not defined for')
      expect((await post(app, crit('Returns'))).statusCode).toBe(400)
      expect((await post(app, crit('Returns: 101%'))).statusCode).toBe(400)
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

    it('derives committedPlays from the assigned slots (21 Oct 2026): none at creation, never typed in', async () => {
      const app = buildApp(await testContext())
      const created = await app.inject({ method: 'POST', url: '/api/admin/v1/buyers-lists', payload: { ...list, ...term, dealType: 'guaranteed' } })
      expect(created.statusCode).toBe(201)
      expectMatchesContract('POST', '/admin/v1/buyers-lists', 201, created.json())
      expect(created.json()).toMatchObject({ committedPlays: null, deliveredPlays: 0 })
      const plain = await app.inject({ method: 'POST', url: '/api/admin/v1/buyers-lists', payload: list })
      expect(plain.json()).toMatchObject({ committedPlays: null, deliveredPlays: 0 })
      const typed = await app.inject({ method: 'PUT', url: `/api/admin/v1/buyers-lists/${created.json().id}`, payload: { ...list, ...term, dealType: 'guaranteed', committedPlays: 1000 } })
      expect(typed.statusCode).toBe(400)
      expect(typed.json().error.details[0].field).toBe('committedPlays')
    })

    it('refuses any typed committedPlays, whatever it is', async () => {
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
      const id = (await app.inject({ method: 'POST', url: '/api/admin/v1/buyers-lists', payload: { ...list, ...term, dealType: 'guaranteed', status: 'draft' } })).json().id
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
      expect(listed.items[0]).toMatchObject({ deliveredPlays: 200 })
      expect(listed.items[0].committedPlays).toBeGreaterThan(200)
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

    it('defaults to a private auction when the type is omitted, and refuses committedPlays from an older client', async () => {
      const app = buildApp(await testContext())
      const plain = await post(app, {})
      expectMatchesContract('POST', '/admin/v1/buyers-lists', 201, plain.json())
      expect(plain.json().dealType).toBe('private_auction')
      expect((await post(app, { committedPlays: 500 })).statusCode).toBe(400)
    })

    it('only a guaranteed deal commits volume; a preferred deal is one buyer at a fixed CPM; no deal has an auction window any more', async () => {
      const app = buildApp(await testContext())
      const guaranteed = await post(app, { dealType: 'guaranteed' })
      expect(guaranteed.statusCode).toBe(201)
      expect(guaranteed.json()).toMatchObject({ dealType: 'guaranteed', committedPlays: null })
      const preferred = await post(app, { dealType: 'preferred', floorCpm: 150 })
      expect(preferred.statusCode).toBe(201)
      expect(preferred.json()).toMatchObject({ dealType: 'preferred', committedPlays: null, auctionCloses: null, effectiveCommittedPlays: { source: 'none' } })
      const closes = '2026-10-10T00:00:00.000Z'
            for (const [payload, field] of [
        [{ dealType: 'preferred', floorCpm: 150, committedPlays: 100 }, 'committedPlays'],
        [{ dealType: 'preferred' }, 'floorCpm'],
        [{ dealType: 'private_auction', auctionCloses: closes }, 'auctionCloses'],
        [{ dealType: 'private_auction', committedPlays: 100 }, 'committedPlays'],
        [{ dealType: 'guaranteed', auctionCloses: closes }, 'auctionCloses'],
        [{ dealType: 'preferred', floorCpm: 150, auctionCloses: closes }, 'auctionCloses'],
        [{ dealType: 'sealed_bid' }, 'dealType'],
      ] as const) {
        const res = await post(app, payload)
        expect(res.statusCode).toBe(400)
        expect(res.json().error.details.map((d: { field: string }) => d.field)).toEqual([field])
      }
    })
  })
})
