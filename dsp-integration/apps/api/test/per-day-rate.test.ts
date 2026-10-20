/* Ticket rx1RfF2p7tyqJABWHR0q: a Programmatic guaranteed deal books whole 24-hour days at a flat rate per day. The
   equivalent CPM (rate per day / forecast impressions per day x 1000) comes from the assigned slots, so the floor is
   enforced once a slot is assigned and always at Share. */
import { describe, expect, it } from 'vitest'
import { buildApp } from '../src/http/app'
import { expectMatchesContract } from './contract'
import { testContext } from './helpers'

const URL = '/api/admin/v1/buyers-lists'
const body = { name: 'Takeover', description: '', dealType: 'guaranteed', invitedBuyers: [{ partnerId: 'p_google', seatId: '5130001' }], activeFrom: '2026-10-01T00:00:00.000Z', activeTo: '2026-10-07T23:59:59.999Z', status: 'draft' }

const setup = async () => {
  const ctx = await testContext()
  await ctx.partners.update('p_google', { seats: [{ id: '5130001', name: 'Nestlé', category: 'Food & Drink' }] })
  /* Every slot forecasts 1000 impressions a day (the 24-hour window), so the equivalent CPM equals the rate per day / 1. */
  for (let n = 1; n <= 8; n++) ctx.db.prepare('INSERT INTO audience_vacd (display_type_id, slot, assumed_views_per_window, counted) VALUES (?, ?, ?, 0) ON CONFLICT DO NOTHING').run('menu_board', n, 1000)
  const attach = async (id: string) => {
    const dt = (await ctx.displayTypes.get('menu_board'))!
    const slot = dt.phExtensions!.slots.find((x) => x.owner === 'advertiser')!
    await ctx.displayTypes.saveExtensions('menu_board', { ...dt.phExtensions!, slots: [...dt.phExtensions!.slots.filter((x) => x !== slot), { ...slot, listMode: 'deal', buyersListId: id, buyersListIds: [id] }] as never })
  }
  const floor = (await ctx.company.get()).floorCpm
  return { ctx, app: buildApp(ctx), attach, floor }
}

describe('Programmatic guaranteed: fixed rate per day', () => {
  it('stores the rate per day and has no equivalent CPM until a slot is assigned', async () => {
    const { app } = await setup()
    const res = await app.inject({ method: 'POST', url: URL, payload: { ...body, ratePerDay: 500 } })
    expect(res.statusCode).toBe(201)
    expectMatchesContract('POST', '/admin/v1/buyers-lists', 201, res.json())
    expect(res.json()).toMatchObject({ ratePerDay: 500, equivalentCpm: null })
  })

  it('derives the equivalent CPM from the assigned slots', async () => {
    const { app, attach } = await setup()
    const created = (await app.inject({ method: 'POST', url: URL, payload: { ...body, ratePerDay: 500 } })).json()
    await attach(created.id)
    const listed = (await app.inject({ method: 'GET', url: URL })).json().items.find((l: { id: string }) => l.id === created.id)
    expect(listed.equivalentCpm).toEqual({ min: 500, max: 500 })
  })

  it('refuses a rate whose equivalent CPM is below the slot floor, on save once a slot is assigned', async () => {
    const { app, attach, floor } = await setup()
    const created = (await app.inject({ method: 'POST', url: URL, payload: { ...body, ratePerDay: floor + 100 } })).json()
    await attach(created.id)
    const low = await app.inject({ method: 'PUT', url: `${URL}/${created.id}`, payload: { ...body, ratePerDay: Math.max(0.01, floor - 1) } })
    expect(low.statusCode).toBe(400)
    expect(low.json().error.details[0]).toMatchObject({ field: 'ratePerDay' })
    expect(low.json().error.details[0].reason).toMatch(/below its floor/)
    const ok = await app.inject({ method: 'PUT', url: `${URL}/${created.id}`, payload: { ...body, ratePerDay: floor + 50 } })
    expect(ok.statusCode).toBe(200)
    expect(ok.json().ratePerDay).toBe(floor + 50)
  })

  it('refuses to share a deal whose rate is below the floor, once it has a slot', async () => {
    const { app, attach, floor } = await setup()
    const created = (await app.inject({ method: 'POST', url: URL, payload: { ...body, ratePerDay: Math.max(0.01, floor - 1) } })).json()
    expect(created.id).toBeTruthy()
    await attach(created.id)
    const share = await app.inject({ method: 'POST', url: `${URL}/${created.id}/share` })
    expect(share.statusCode).toBe(400)
    expect(share.json().error.details.some((d: { field: string }) => d.field === 'ratePerDay')).toBe(true)
  })

  it('refuses a rate per day on any other deal type, and a rate that is not a positive number', async () => {
    const { app } = await setup()
    const other = await app.inject({ method: 'POST', url: URL, payload: { ...body, dealType: 'private_auction', ratePerDay: 500 } })
    expect(other.statusCode).toBe(400)
    expect(other.json().error.details[0].field).toBe('ratePerDay')
    for (const bad of [0, -5, '500']) expect((await app.inject({ method: 'POST', url: URL, payload: { ...body, ratePerDay: bad } })).statusCode).toBe(400)
  })

  it('versions a changed rate per day and asks accepted buyers to accept again', async () => {
    const { app, attach, floor } = await setup()
    const created = (await app.inject({ method: 'POST', url: URL, payload: { ...body, ratePerDay: floor + 100 } })).json()
    await attach(created.id)
    await app.inject({ method: 'POST', url: `${URL}/${created.id}/share` })
    const check = (await app.inject({ method: 'POST', url: `${URL}/${created.id}/term-check`, payload: { ...body, ratePerDay: floor + 200 } })).json()
    expect(check.changes).toMatchObject([{ field: 'ratePerDay', from: floor + 100, to: floor + 200, requiresReacceptance: true }])
  })

  it('carries the per-day terms on the deal sheet, its CSV and the DSP-facing deal', async () => {
    const { app, attach, floor } = await setup()
    const rate = floor + 100
    const created = (await app.inject({ method: 'POST', url: URL, payload: { ...body, ratePerDay: rate } })).json()
    await attach(created.id)
    const res = await app.inject({ method: 'GET', url: `${URL}/${created.id}/deal-sheet` })
    expectMatchesContract('GET', '/admin/v1/buyers-lists/{buyersListId}/deal-sheet', 200, res.json())
    const sheet = res.json()
    expect(sheet).toMatchObject({ dealType: 'guaranteed', rateKind: 'fixed', ratePerDay: rate, billingPeriodHours: 24, equivalentCpm: { min: rate, max: rate } })
    expect(sheet.entries[0].inventorySource.rateDetails).toMatchObject({ rate, rateType: 'Fixed per day', currency: 'USD', billingPeriodHours: 24, equivalentCpm: { min: rate, max: rate } })
    expect(sheet.description).toMatch(new RegExp(`${rate} USD per day, a flat rate for each full 24-hour day \\(equivalent ${rate} CPM\\)`))
    const csv = (await app.inject({ method: 'GET', url: `${URL}/${created.id}/deal-sheet?format=csv` })).body.split('\r\n')
    const head = csv[0]!.split(',')
    const row = csv[1]!
    expect(head).toEqual(expect.arrayContaining(['Rate per day', 'Equivalent CPM']))
    expect(row).toContain('Fixed per day')
    const deal = (await app.inject({ method: 'GET', url: `${URL}/${created.id}/deal` })).json()
    expect(deal).toMatchObject({ rateType: 'Fixed per day', ratePerDay: rate, billingPeriodHours: 24, equivalentCpm: { min: rate, max: rate } })
  })

  it('leaves a guaranteed deal without a rate per day as CPM fixed', async () => {
    const { app } = await setup()
    const created = (await app.inject({ method: 'POST', url: URL, payload: { ...body, floorCpm: 200 } })).json()
    const sheet = (await app.inject({ method: 'GET', url: `${URL}/${created.id}/deal-sheet` })).json()
    expect(sheet.ratePerDay ?? null).toBeNull()
    expect(sheet.entries[0].inventorySource.rateDetails.rateType).toBe('CPM fixed')
  })
})
