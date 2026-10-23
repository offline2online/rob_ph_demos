import { describe, expect, it } from 'vitest'
import { buildApp } from '../src/http/app'
import { expectMatchesContract } from './contract'
import { testContext } from './helpers'

describe('Advertisers (admin only, spec §3)', () => {
  it('saves campaign approval', async () => {
    const app = buildApp(await testContext())
    const res = await app.inject({ method: 'PUT', url: '/api/admin/v1/advertisers', payload: { settings: { swisse: { approvalRequired: false } } } })
    expect(res.statusCode).toBe(200)
    expectMatchesContract('PUT', '/admin/v1/advertisers', 200, res.body || undefined)
    const list = (await app.inject({ method: 'GET', url: '/api/admin/v1/advertisers' })).json().items
    expect(list.find((a: { advertiserId: string }) => a.advertiserId === 'swisse')).toMatchObject({ approvalRequired: false })
  })

  it('rejects unknown advertisers and a non-boolean approval', async () => {
    const res = await buildApp(await testContext()).inject({ method: 'PUT', url: '/api/admin/v1/advertisers', payload: { settings: { nobody: { approvalRequired: true }, nestle: { approvalRequired: 'yes' } } } })
    expect(res.statusCode).toBe(400)
    expectMatchesContract('PUT', '/admin/v1/advertisers', 400, res.json())
    expect(res.json().error.details.map((d: { field: string }) => d.field)).toEqual(['settings.nobody', 'settings.nestle.approvalRequired'])
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
    expectMatchesContract('POST', '/admin/v1/advertisers/direct', 201, add.json())
    expect(add.json()).toEqual({ advertiserId: 'acme-foods', name: 'Acme Foods', audiences: [] })
    const list = await app.inject({ method: 'GET', url: '/api/admin/v1/advertisers' })
    expectMatchesContract('GET', '/admin/v1/advertisers', 200, list.json())
    const items = list.json().items as { advertiserId: string; via: string[]; direct: boolean }[]
    expect(items.find((a) => a.advertiserId === 'acme-foods')).toMatchObject({ via: [], direct: true, approvalRequired: true })
    expect(items.find((a) => a.advertiserId === 'swisse')?.direct).toBe(false)
    /* Its settings save like any other advertiser's. */
    expect((await app.inject({ method: 'PUT', url: '/api/admin/v1/advertisers', payload: { settings: { 'acme-foods': { approvalRequired: false } } } })).statusCode).toBe(200)
    expect((await app.inject({ method: 'DELETE', url: '/api/admin/v1/advertisers/direct/acme-foods' })).statusCode).toBe(204)
    expect(((await app.inject({ method: 'GET', url: '/api/admin/v1/advertisers' })).json().items as { advertiserId: string }[]).some((a) => a.advertiserId === 'acme-foods')).toBe(false)
  })

  it('renames a direct advertiser, keeping its id; refuses a DSP advertiser, a taken name and a bad name', async () => {
    const app = buildApp(await testContext())
    await app.inject({ method: 'POST', url: '/api/admin/v1/advertisers/direct', payload: { name: 'Acme Foods' } })
    await app.inject({ method: 'POST', url: '/api/admin/v1/advertisers/direct', payload: { name: 'Beta Drinks' } })
    const patch = (id: string, name: unknown) => app.inject({ method: 'PATCH', url: `/api/admin/v1/advertisers/direct/${id}`, payload: { name } })
    const ok = await patch('acme-foods', '  Acme   Foods Ltd ')
    expect(ok.statusCode).toBe(200)
    expectMatchesContract('PATCH', '/admin/v1/advertisers/direct/{advertiserId}', 200, ok.json())
    expect(ok.json()).toEqual({ advertiserId: 'acme-foods', name: 'Acme Foods Ltd' })
    const items = (await app.inject({ method: 'GET', url: '/api/admin/v1/advertisers' })).json().items as { advertiserId: string; name: string; direct: boolean }[]
    expect(items.find((a) => a.advertiserId === 'acme-foods')).toMatchObject({ name: 'Acme Foods Ltd', direct: true })
    expect(items.some((a) => a.name === 'Acme Foods')).toBe(false)
    expect((await patch('acme-foods', 'Beta Drinks')).statusCode).toBe(409)
    /* A renamed advertiser keeps its old id: nobody else may take that, nor the name it now shows. */
    expect((await patch('beta-drinks', 'Acme Foods')).statusCode).toBe(409)
    expect((await app.inject({ method: 'POST', url: '/api/admin/v1/advertisers/direct', payload: { name: 'Acme Foods Ltd' } })).statusCode).toBe(409)
    expect((await patch('acme-foods', 'Nestlé')).statusCode).toBe(409)
    expect((await patch('nestle', 'Nestle Foods')).statusCode).toBe(404)
    expect((await patch('nobody', 'X')).statusCode).toBe(404)
    expect((await patch('acme-foods', '   ')).statusCode).toBe(400)
    expect((await patch('acme-foods', '!!!')).statusCode).toBe(400)
    expect((await patch('acme-foods', 'x'.repeat(81))).statusCode).toBe(400)
    const nonAdmin = await buildApp(await testContext({ role: 'hq_marketing' })).inject({ method: 'PATCH', url: '/api/admin/v1/advertisers/direct/acme-foods', payload: { name: 'Z' } })
    expect(nonAdmin.statusCode).toBe(403)
  })

  it('treats a direct record shadowed by a DSP seat as a direct advertiser, not "Not a direct advertiser"', async () => {
    const ctx = await testContext()
    const app = buildApp(ctx)
    await ctx.company.addDirectAdvertiser('swisse', 'Swisse')
    const items = (await app.inject({ method: 'GET', url: '/api/admin/v1/advertisers' })).json().items as { advertiserId: string; direct: boolean }[]
    expect(items.find((a) => a.advertiserId === 'swisse')?.direct).toBe(false)
    /* Swisse has campaigns, so it is refused for that reason (409), not as "not direct" (404). */
    const del = await app.inject({ method: 'DELETE', url: '/api/admin/v1/advertisers/direct/swisse' })
    expect(del.statusCode).toBe(409)
    expect(del.json().detail ?? del.body).toMatch(/campaigns or bookings/)
  })

  it('refuses any named buyer, direct or a DSP’s, in Available Inventory’s Assigned to, pointing to deals', async () => {
    const app = buildApp(await testContext())
    expect((await app.inject({ method: 'POST', url: '/api/admin/v1/advertisers/direct', payload: { name: 'Acme Foods' } })).statusCode).toBe(201)
    const save = (advertisers: string[]) => app.inject({ method: 'PUT', url: '/api/admin/v1/available-inventory', payload: { items: [{ displayTypeId: 'menu_board', slot: 2, assignedTo: { partnerIds: [], advertisers, whitelistOnly: false } }] } })
    const res = await save(['Acme Foods'])
    expect(res.statusCode).toBe(400)
    expect(JSON.stringify(res.json())).toMatch(/Acme Foods can't be assigned to a slot directly.*Direct advertiser deal/)
    /* A DSP advertiser (Nestlé via Google DSP) is refused the same way, alone or alongside another. */
    const dsp = await save(['Nestlé'])
    expect(dsp.statusCode).toBe(400)
    expect(JSON.stringify(dsp.json())).toMatch(/Nestlé can't be assigned to a slot directly.*Programmatic guaranteed deal/)
    expect((await save(['Acme Foods', 'Nestlé'])).statusCode).toBe(400)
    expect((await save(['Nobody Ltd'])).statusCode).toBe(400)
  })

  it('keeps a direct advertiser already held on a sold slot when the slot is resaved, and still refuses adding one', async () => {
    const ctx = await testContext()
    const app = buildApp(ctx)
    await app.inject({ method: 'POST', url: '/api/admin/v1/advertisers/direct', payload: { name: 'Acme Foods' } })
    /* What migration 0082 leaves on a slot with a live booking: the direct advertiser stays until its bookings have played. */
    const dt = (await ctx.displayTypes.get('menu_board'))!
    await ctx.displayTypes.saveExtensions(dt.id, { ...dt.phExtensions!, slots: dt.phExtensions!.slots.map((s, i) => (i === 1 ? { ...s, advertisers: ['Acme Foods', 'Nestlé'], listMode: null } : s)) })
    const save = (slot: number, advertisers: string[]) => app.inject({ method: 'PUT', url: '/api/admin/v1/available-inventory', payload: { items: [{ displayTypeId: 'menu_board', slot, assignedTo: { partnerIds: [], advertisers, whitelistOnly: false } }] } })
    expect((await save(2, ['Acme Foods', 'Nestlé'])).statusCode).toBe(200)
    expect((await save(2, ['Nestlé'])).statusCode).toBe(200)
    /* Gone once removed, and never onto another slot. */
    expect((await save(2, ['Acme Foods', 'Nestlé'])).statusCode).toBe(400)
    expect((await save(1, ['Acme Foods'])).statusCode).toBe(400)
  })

  it('refuses to delete a direct advertiser still assigned to a slot (legacy data), naming the slot', async () => {
    const ctx = await testContext()
    const app = buildApp(ctx)
    await app.inject({ method: 'POST', url: '/api/admin/v1/advertisers/direct', payload: { name: 'Acme Foods' } })
    /* The API no longer assigns one, so the leftover assignment is written straight to the display type. */
    const holdAcme = async (advertisers: string[]) => {
      const dt = (await ctx.displayTypes.get('menu_board'))!
      const ext = dt.phExtensions!
      await ctx.displayTypes.saveExtensions(dt.id, { ...ext, slots: ext.slots.map((s, i) => (i === 1 ? { ...s, advertisers } : s)) })
    }
    await holdAcme(['Acme Foods'])
    const del = () => app.inject({ method: 'DELETE', url: '/api/admin/v1/advertisers/direct/acme-foods' })
    const res = await del()
    expect(res.statusCode).toBe(409)
    expect(res.json().error.message).toMatch(/Acme Foods is assigned to a slot.*slot 2/)
    await holdAcme([])
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
    /* Deleting one that is already gone is not an error. */
    const del = () => app.inject({ method: 'DELETE', url: '/api/admin/v1/advertisers/direct/own-brand' })
    expect((await del()).statusCode).toBe(204)
    expect((await del()).statusCode).toBe(204)
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
