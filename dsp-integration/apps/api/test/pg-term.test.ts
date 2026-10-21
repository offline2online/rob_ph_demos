/* Ticket LjkTqL4rdegolMoFCYVJ (21 Oct 2026): a Programmatic guaranteed deal covers a whole delivery term. Its committed plays
   are derived from the slots assigned to it over that term, less the guarantee buffer, never typed in or defaulted; its price is
   a fixed CPM or a total for the term; and a slot change on a shared deal needs the caller's confirmation because buyers must
   accept again. */
import { describe, expect, it } from 'vitest'
import { buildApp } from '../src/http/app'
import { termSlotsOf } from '../src/domain/termPrice'
import { expectMatchesContract } from './contract'
import { testContext } from './helpers'

const URL = '/api/admin/v1/buyers-lists'
const INV = '/api/admin/v1/available-inventory'
const body = { name: 'November flight', description: '', dealType: 'guaranteed', invitedBuyers: [{ partnerId: 'p_google', seatId: '5130001' }], activeFrom: '2026-10-01T00:00:00.000Z', activeTo: '2026-10-07T23:59:59.999Z', status: 'draft' }

const setup = async () => {
  const ctx = await testContext()
  await ctx.partners.update('p_google', { seats: [{ id: '5130001', name: 'Nestlé', category: 'Food & Drink' }] })
  /* Every slot is scored, so it has an impressions forecast. */
  for (let n = 1; n <= 8; n++) ctx.db.prepare('INSERT INTO audience_vacd (display_type_id, slot, assumed_views_per_window, counted) VALUES (?, ?, ?, 0) ON CONFLICT DO NOTHING').run('menu_board', n, 1000)
  /* Slot 3 is a retail slot on the fixture; make it a second advertiser slot. */
  const dt = (await ctx.displayTypes.get('menu_board'))!
  await ctx.displayTypes.saveExtensions('menu_board', { ...dt.phExtensions!, slots: dt.phExtensions!.slots.map((s, i) => (i === 2 ? { ...s, owner: 'advertiser', listMode: 'rtb', storeScope: null } : s)) as never })
  const app = buildApp(ctx)
  /* The forecast over the whole 7-day term for what is assigned today, and the total that works out to a CPM over it. */
  const impressions = async (id: string) => (await termSlotsOf(ctx, id)).reduce((n, s) => n + s.impressionsPerDay, 0) * 7
  const totalAt = async (id: string, cpm: number) => Math.round(((cpm * (await impressions(id))) / 1000) * 100) / 100
  /* The real slot save, which is what recalculates committed plays. */
  const assign = (slots: Record<number, string | null>, confirmReshare?: boolean) => app.inject({
    method: 'PUT', url: INV,
    payload: { ...(confirmReshare === undefined ? {} : { confirmReshare }), items: Object.entries(slots).map(([slot, id]) => ({ displayTypeId: 'menu_board', slot: Number(slot), assignedTo: { partnerIds: [], advertisers: [], whitelistOnly: false, buyersListId: id } })) },
  })
  const create = async (extra: Record<string, unknown> = {}) => (await app.inject({ method: 'POST', url: URL, payload: { ...body, ...extra } })).json()
  const get = async (id: string) => (await app.inject({ method: 'GET', url: URL })).json().items.find((l: { id: string }) => l.id === id)
  const floor = (await ctx.company.get()).floorCpm
  const buffer = (await ctx.company.get()).guaranteeBufferPct
  return { ctx, app, assign, create, get, floor, buffer, impressions, totalAt }
}

describe('Programmatic guaranteed: committed plays derived from the assigned slots', () => {
  it('has no committed plays when the deal is created, and refuses one typed in', async () => {
    const { app, create } = await setup()
    expect(await create()).toMatchObject({ committedPlays: null, effectiveCommittedPlays: { min: null, max: null, source: 'none' } })
    const typed = await app.inject({ method: 'POST', url: URL, payload: { ...body, committedPlays: 5000 } })
    expect(typed.statusCode).toBe(400)
    expect(typed.json().error.details[0].field).toBe('committedPlays')
  })

  it('equals floor(forecast plays of every assigned slot over the whole term x (1 - buffer))', async () => {
    const { ctx, assign, create, get, buffer } = await setup()
    const { id } = await create()
    expect((await assign({ 2: id })).statusCode).toBe(200)
    const oneSlot = await termSlotsOf(ctx, id)
    expect(oneSlot).toHaveLength(1)
    const perDay = oneSlot[0]!.playsPerDay
    expect(perDay).toBeGreaterThan(0)
    const expected = (days: number, perDayPlays: number) => Math.floor(perDayPlays * days * (1 - buffer / 100))
    expect((await get(id)).committedPlays).toBe(expected(7, perDay))
    expect((await get(id)).effectiveCommittedPlays).toMatchObject({ min: expected(7, perDay), max: expected(7, perDay) })

    /* A second slot adds its plays. */
    expect((await assign({ 2: id, 3: id })).statusCode).toBe(200)
    const two = (await termSlotsOf(ctx, id)).reduce((n, s) => n + s.playsPerDay, 0)
    expect((await get(id)).committedPlays).toBe(expected(7, two))
    expect(two).toBeGreaterThan(perDay)
  })

  it('drops when the term is shortened, and a single day is a one-day term', async () => {
    const { ctx, app, assign, create, get, buffer } = await setup()
    const { id } = await create()
    await assign({ 2: id })
    const full = (await get(id)).committedPlays as number
    const perDay = (await termSlotsOf(ctx, id))[0]!.playsPerDay
    const three = await app.inject({ method: 'PUT', url: `${URL}/${id}`, payload: { ...body, activeTo: '2026-10-03T23:59:59.999Z' } })
    expect(three.statusCode).toBe(200)
    expect(three.json().committedPlays).toBe(Math.floor(perDay * 3 * (1 - buffer / 100)))
    expect(three.json().committedPlays).toBeLessThan(full)
    const one = await app.inject({ method: 'PUT', url: `${URL}/${id}`, payload: { ...body, activeFrom: '2026-10-01T00:00:00.000Z', activeTo: '2026-10-01T23:59:59.999Z' } })
    expect(one.json().committedPlays).toBe(Math.floor(perDay * (1 - buffer / 100)))
  })

  it('is null for an open-ended term or a deal with no slot', async () => {
    const { app, assign, create, get } = await setup()
    const { id } = await create()
    expect((await get(id)).committedPlays).toBeNull()
    await assign({ 2: id })
    const open = await app.inject({ method: 'PUT', url: `${URL}/${id}`, payload: { ...body, activeTo: null } })
    expect(open.json().committedPlays).toBeNull()
  })

  it('refuses to save a changed slot on a shared deal without confirmation, then versions it once confirmed', async () => {
    const { ctx, app, assign, create, get } = await setup()
    const { id } = await create()
    await assign({ 2: id })
    expect((await app.inject({ method: 'POST', url: `${URL}/${id}/share` })).statusCode).toBe(200)
    await app.inject({ method: 'POST', url: `${URL}/${id}/acceptances`, payload: { partnerId: 'p_google', seatId: '5130001' } })
    const shared = await get(id)
    expect(shared).toMatchObject({ status: 'shared', termVersion: 1 })
    expect(shared.buyerAcceptance[0]).toMatchObject({ state: 'accepted' })

    const held = await assign({ 2: id, 3: id })
    expect(held.statusCode).toBe(400)
    expect(held.json().error.details[0]).toMatchObject({ field: 'confirmReshare' })
    expect(held.json().error.details[0].reason).toMatch(/re-shared and accepted again/)
    /* Cancelling leaves the deal and its slots as they were. */
    expect((await get(id)).committedPlays).toBe(shared.committedPlays)
    expect((await ctx.displayTypes.get('menu_board'))!.phExtensions!.slots[2]!.buyersListIds ?? []).not.toContain(id)

    const confirmed = await assign({ 2: id, 3: id }, true)
    expect(confirmed.statusCode).toBe(200)
    const after = await get(id)
    expect(after.committedPlays).toBeGreaterThan(shared.committedPlays)
    expect(after.termVersion).toBe(2)
    expect(after.buyerAcceptance[0]).toMatchObject({ state: 'reacceptance_required' })
    const versions = (await app.inject({ method: 'GET', url: `${URL}/${id}/term-versions` })).json().items
    expect(versions[0].changes).toMatchObject([{ field: 'committedPlays', requiresReacceptance: true }])
  })

  it('needs no confirmation for a draft, or for a slot the deal already had', async () => {
    const { assign, create, get } = await setup()
    const { id } = await create()
    expect((await assign({ 2: id })).statusCode).toBe(200)
    expect((await assign({ 2: id, 3: id })).statusCode).toBe(200)
    expect((await get(id)).termVersion).toBe(1)
  })

  it('warns, in the dry run, that a changed term changes the committed plays', async () => {
    const { app, assign, create } = await setup()
    const { id } = await create()
    await assign({ 2: id })
    await app.inject({ method: 'POST', url: `${URL}/${id}/share` })
    const check = (await app.inject({ method: 'POST', url: `${URL}/${id}/term-check`, payload: { ...body, activeTo: '2026-10-14T23:59:59.999Z' } })).json()
    expect(check.requiresReacceptance).toBe(true)
    expect(check.changes.map((c: { field: string }) => c.field)).toEqual(expect.arrayContaining(['committedPlays', 'activeTo']))
  })

  it('shares with the figure the slots give today', async () => {
    const { ctx, app, assign, create, buffer } = await setup()
    const { id } = await create()
    await assign({ 2: id })
    /* Slot assignment written behind the route's back is still picked up at Share. */
    const dt = (await ctx.displayTypes.get('menu_board'))!
    await ctx.displayTypes.saveExtensions('menu_board', { ...dt.phExtensions!, slots: dt.phExtensions!.slots.map((s, i) => (i === 2 ? { ...s, owner: 'advertiser', listMode: 'deal', buyersListId: id, buyersListIds: [id] } : s)) as never })
    const shared = (await app.inject({ method: 'POST', url: `${URL}/${id}/share` })).json()
    const perDay = (await termSlotsOf(ctx, id)).reduce((n, s) => n + s.playsPerDay, 0)
    expect(shared.committedPlays).toBe(Math.floor(perDay * 7 * (1 - buffer / 100)))
  })
})

describe('Programmatic guaranteed: a fixed CPM or a total for the term', () => {
  it('stores the total and has no equivalent CPM until a slot is assigned', async () => {
    const { app } = await setup()
    const res = await app.inject({ method: 'POST', url: URL, payload: { ...body, termTotal: 700 } })
    expect(res.statusCode).toBe(201)
    expectMatchesContract('POST', '/admin/v1/buyers-lists', 201, res.json())
    expect(res.json()).toMatchObject({ termTotal: 700, equivalentCpm: null })
  })

  it('derives the equivalent CPM over the whole term from the assigned slots', async () => {
    const { assign, create, get, impressions } = await setup()
    const { id } = await create({ termTotal: 700 })
    await assign({ 2: id })
    const cpm = Math.round((700 / (await impressions(id))) * 100000) / 100
    expect(cpm).toBeGreaterThan(0)
    expect((await get(id)).equivalentCpm).toEqual({ min: cpm, max: cpm })
  })

  it('refuses a total worth less than the slot floors over the term, on save once a slot is assigned', async () => {
    const { app, assign, create, floor, totalAt } = await setup()
    const { id } = await create({ termTotal: 1000 })
    await assign({ 2: id })
    const low = await app.inject({ method: 'PUT', url: `${URL}/${id}`, payload: { ...body, termTotal: await totalAt(id, floor - 1) } })
    expect(low.statusCode).toBe(400)
    expect(low.json().error.details[0]).toMatchObject({ field: 'termTotal' })
    expect(low.json().error.details[0].reason).toMatch(/below their floors/)
    const total = await totalAt(id, floor + 50)
    const ok = await app.inject({ method: 'PUT', url: `${URL}/${id}`, payload: { ...body, termTotal: total } })
    expect(ok.statusCode).toBe(200)
    expect(ok.json().termTotal).toBe(total)
  })

  it('refuses to share a deal whose total is below the floors, once it has a slot', async () => {
    const { app, assign, create, floor, totalAt } = await setup()
    const { id } = await create({ termTotal: 1 })
    await assign({ 2: id })
    expect(await totalAt(id, floor - 1)).toBeGreaterThan(1)
    await app.inject({ method: 'PUT', url: `${URL}/${id}`, payload: { ...body, termTotal: await totalAt(id, floor - 1) } }).then((r) => expect(r.statusCode).toBe(400))
    const share = await app.inject({ method: 'POST', url: `${URL}/${id}/share` })
    expect(share.statusCode).toBe(400)
    expect(share.json().error.details.some((d: { field: string }) => d.field === 'termTotal')).toBe(true)
  })

  it('refuses a total on any other deal type, a total that is not positive, both prices at once, and the retired rate per day', async () => {
    const { app } = await setup()
    const other = await app.inject({ method: 'POST', url: URL, payload: { ...body, dealType: 'private_auction', termTotal: 500 } })
    expect(other.statusCode).toBe(400)
    expect(other.json().error.details[0].field).toBe('termTotal')
    for (const bad of [0, -5, '500']) expect((await app.inject({ method: 'POST', url: URL, payload: { ...body, termTotal: bad } })).statusCode).toBe(400)
    const both = await app.inject({ method: 'POST', url: URL, payload: { ...body, termTotal: 500, floorCpm: 200 } })
    expect(both.statusCode).toBe(400)
    expect(both.json().error.details[0].field).toBe('termTotal')
    const perDay = await app.inject({ method: 'POST', url: URL, payload: { ...body, ratePerDay: 500 } })
    expect(perDay.statusCode).toBe(400)
    expect(perDay.json().error.details[0].field).toBe('ratePerDay')
  })

  it('versions a changed total and asks accepted buyers to accept again', async () => {
    const { app, assign, create, floor, totalAt } = await setup()
    const { id } = await create({ termTotal: 1000 })
    await assign({ 2: id })
    const from = await totalAt(id, floor + 100), to = await totalAt(id, floor + 200)
    await app.inject({ method: 'PUT', url: `${URL}/${id}`, payload: { ...body, termTotal: from } })
    await app.inject({ method: 'POST', url: `${URL}/${id}/share` })
    const check = (await app.inject({ method: 'POST', url: `${URL}/${id}/term-check`, payload: { ...body, termTotal: to } })).json()
    expect(check.changes).toMatchObject([{ field: 'termTotal', from, to, requiresReacceptance: true }])
  })

  it('carries the term, the total and the derived volume on the deal sheet, its CSV and the DSP-facing deal', async () => {
    const { app, assign, create, get, impressions, floor, totalAt } = await setup()
    const { id } = await create({ termTotal: 700 })
    await assign({ 2: id })
    const total = await totalAt(id, floor + 10)
    await app.inject({ method: 'PUT', url: `${URL}/${id}`, payload: { ...body, termTotal: total } })
    const cpm = Math.round((total / (await impressions(id))) * 100000) / 100
    const committed = (await get(id)).committedPlays as number
    const res = await app.inject({ method: 'GET', url: `${URL}/${id}/deal-sheet` })
    expectMatchesContract('GET', '/admin/v1/buyers-lists/{buyersListId}/deal-sheet', 200, res.json())
    const sheet = res.json()
    expect(sheet).toMatchObject({ dealType: 'guaranteed', rateKind: 'fixed', termTotal: total, termDays: 7, committedPlays: committed, equivalentCpm: { min: cpm, max: cpm }, activeFrom: body.activeFrom, activeTo: body.activeTo })
    expect(sheet.entries[0].inventorySource.rateDetails).toMatchObject({ rate: total, rateType: 'Fixed per term', currency: 'USD', termDays: 7, equivalentCpm: { min: cpm, max: cpm } })
    expect(sheet.description).toContain(`${total} USD for the whole term, a fixed total (equivalent ${cpm} CPM)`)
    const csv = (await app.inject({ method: 'GET', url: `${URL}/${id}/deal-sheet?format=csv` })).body.split('\r\n')
    expect(csv[0]!.split(',')).toEqual(expect.arrayContaining(['Total for the term', 'Equivalent CPM', 'Guaranteed plays']))
    expect(csv[1]).toContain('Fixed per term')
    const deal = (await app.inject({ method: 'GET', url: `${URL}/${id}/deal` })).json()
    expect(deal).toMatchObject({ rateType: 'Fixed per term', termTotal: total, termDays: 7, committedPlays: committed, equivalentCpm: { min: cpm, max: cpm } })
  })

  it('leaves a guaranteed deal on a fixed CPM as CPM fixed', async () => {
    const { app, create } = await setup()
    const { id } = await create({ floorCpm: 200 })
    const sheet = (await app.inject({ method: 'GET', url: `${URL}/${id}/deal-sheet` })).json()
    expect(sheet.termTotal ?? null).toBeNull()
    expect(sheet.rateKind).toBe('fixed')
    expect(sheet.entries[0].inventorySource.rateDetails.rateType).toBe('CPM fixed')
  })
})
