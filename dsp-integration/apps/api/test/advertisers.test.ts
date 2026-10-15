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

  it('holds a slot for a direct advertiser from Available Inventory’s Assigned to', async () => {
    const app = buildApp(await testContext())
    expect((await app.inject({ method: 'POST', url: '/api/admin/v1/advertisers/direct', payload: { name: 'Acme Foods' } })).statusCode).toBe(201)
    const save = (advertisers: string[]) => app.inject({ method: 'PUT', url: '/api/admin/v1/available-inventory', payload: { items: [{ displayTypeId: 'menu_board', slot: 2, assignedTo: { partnerIds: [], advertisers, whitelistOnly: false } }] } })
    const res = await save(['Acme Foods'])
    expect(res.statusCode).toBe(200)
    expect(res.json().items[0].assignedTo).toMatchObject({ advertisers: ['Acme Foods'], partnerIds: [], openAuction: false })
    /* Alongside a DSP advertiser too; an unknown name is still refused. */
    expect((await save(['Acme Foods', 'Nestlé'])).json().items[0].assignedTo).toMatchObject({ advertisers: ['Acme Foods', 'Nestlé'], partnerIds: ['p_google'] })
    expect((await save(['Nobody Ltd'])).statusCode).toBe(400)
  })

  it('refuses to delete a direct advertiser still assigned to a slot, naming the slot', async () => {
    const app = buildApp(await testContext())
    await app.inject({ method: 'POST', url: '/api/admin/v1/advertisers/direct', payload: { name: 'Acme Foods' } })
    await app.inject({ method: 'PUT', url: '/api/admin/v1/available-inventory', payload: { items: [{ displayTypeId: 'menu_board', slot: 2, assignedTo: { partnerIds: [], advertisers: ['Acme Foods'], whitelistOnly: false } }] } })
    const del = () => app.inject({ method: 'DELETE', url: '/api/admin/v1/advertisers/direct/acme-foods' })
    const res = await del()
    expect(res.statusCode).toBe(409)
    expect(res.json().error.message).toMatch(/Acme Foods is assigned to a slot.*slot 2/)
    await app.inject({ method: 'PUT', url: '/api/admin/v1/available-inventory', payload: { items: [{ displayTypeId: 'menu_board', slot: 2, assignedTo: { partnerIds: [], advertisers: [], whitelistOnly: false } }] } })
    expect((await del()).statusCode).toBe(204)
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
  describe('DSP seat mapping and deal resolution (ticket T0gLfo2zDrRXPVGcvEoL)', () => {
    const base = '/api/admin/v1/advertisers'
    const deal = (app: ReturnType<typeof buildApp>, name: string, invitedBuyers: { partnerId: string; seatId: string }[], extra: object = {}) =>
      app.inject({ method: 'POST', url: '/api/admin/v1/buyers-lists', payload: { name, invitedBuyers, activeFrom: null, activeTo: null, ...extra } })

    it('maps an advertiser to synced seats and resolves exactly the deals inviting them', async () => {
      const app = buildApp(await testContext())
      const swisse = { partnerId: 'p_google', seatId: '5130002' }
      expect((await deal(app, 'Swisse deal', [swisse])).statusCode).toBe(201)
      expect((await deal(app, 'Nestle deal', [{ partnerId: 'p_google', seatId: '5130001' }])).statusCode).toBe(201)
      const put = await app.inject({ method: 'PUT', url: `${base}/swisse/seats`, payload: { seats: [swisse, swisse] } })
      expect(put.statusCode).toBe(200)
      expectMatchesContract('PUT', '/admin/v1/advertisers/{advertiserId}/seats', 200, put.json())
      expect(put.json().dspSeats).toEqual([{ ...swisse, partnerName: expect.any(String), seatName: 'Swisse', synced: true }])
      const deals = await app.inject({ method: 'GET', url: `${base}/swisse/deals` })
      expectMatchesContract('GET', '/admin/v1/advertisers/{advertiserId}/deals', 200, deals.json())
      expect(deals.json().items.map((d: { name: string }) => d.name)).toEqual(['Swisse deal'])
      /* The same seat id under another DSP is a different seat: no match. */
      expect((await app.inject({ method: 'GET', url: `${base}/nestle/deals` })).json().items).toEqual([])
    })

    it('limits resolution to the deal’s delivery term', async () => {
      const app = buildApp(await testContext())
      const seat = { partnerId: 'p_google', seatId: '5130002' }
      await deal(app, 'Past', [seat], { activeFrom: '2026-01-01T00:00:00Z', activeTo: '2026-02-01T00:00:00Z' })
      await deal(app, 'Now', [seat], { activeFrom: '2026-09-01T00:00:00Z', activeTo: '2026-12-01T00:00:00Z' })
      await app.inject({ method: 'PUT', url: `${base}/swisse/seats`, payload: { seats: [seat] } })
      const names = async (at?: string) => (await app.inject({ method: 'GET', url: `${base}/swisse/deals${at ? `?at=${at}` : ''}` })).json().items.map((d: { name: string }) => d.name)
      expect(await names()).toEqual(['Now'])
      expect(await names('2026-01-15T00:00:00Z')).toEqual(['Past'])
      expect((await app.inject({ method: 'GET', url: `${base}/swisse/deals?at=nope` })).statusCode).toBe(400)
    })

    it('refuses unsynced or typed seats, non-admins, and any seat on a direct advertiser, which resolves no deals', async () => {
      const app = buildApp(await testContext())
      const put = (id: string, seats: unknown) => app.inject({ method: 'PUT', url: `${base}/${id}/seats`, payload: { seats } })
      const bad = await put('swisse', [{ partnerId: 'p_google', seatId: 'typed-by-hand' }, { partnerId: 'nope', seatId: '1' }])
      expect(bad.statusCode).toBe(400)
      expect(bad.json().error.details.map((d: { field: string }) => d.field)).toEqual(['seats[0].seatId', 'seats[1].partnerId'])
      expect((await put('swisse', 'x')).statusCode).toBe(400)
      expect((await put('nobody', [])).statusCode).toBe(404)
      await app.inject({ method: 'POST', url: `${base}/direct`, payload: { name: 'Acme Foods' } })
      expect((await put('acme-foods', [{ partnerId: 'p_google', seatId: '5130002' }])).statusCode).toBe(400)
      expect((await app.inject({ method: 'GET', url: `${base}/acme-foods/deals` })).json().items).toEqual([])
      expect((await buildApp(await testContext({ role: 'hq_marketing' })).inject({ method: 'PUT', url: `${base}/swisse/seats`, payload: { seats: [] } })).statusCode).toBe(403)
    })

    it('a re-sync that drops (re-keys) a seat keeps it shown as not synced and stops resolving through it', async () => {
      const ctx = await testContext()
      const app = buildApp(ctx)
      const seat = { partnerId: 'p_google', seatId: '5130002' }
      await deal(app, 'Swisse deal', [seat])
      await app.inject({ method: 'PUT', url: `${base}/swisse/seats`, payload: { seats: [seat] } })
      const p = (await ctx.partners.get('p_google'))!
      await ctx.partners.update('p_google', { ...p, seats: p.seats.map((x) => (x.id === seat.seatId ? { ...x, id: 'reissued-1' } : x)) })
      const sw = (await app.inject({ method: 'GET', url: base })).json().items.find((a: { advertiserId: string }) => a.advertiserId === 'swisse')
      expect(sw.dspSeats).toEqual([{ ...seat, partnerName: expect.any(String), seatName: null, synced: false }])
      expect((await app.inject({ method: 'GET', url: `${base}/swisse/deals` })).json().items).toEqual([])
    })
  })
})
