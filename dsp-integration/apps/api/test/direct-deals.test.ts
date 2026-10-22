/* Direct advertiser deals (ticket krIPF8rPnMwVOmynHNRh, 22 Oct 2026): a deal type with exactly the Programmatic
   guaranteed fields and rules, whose one buyer is a direct advertiser. No DSP seats, no IAB categories, no DSP
   deal entries, no acceptance; Finalise (share) makes it live internally. */
import { describe, expect, it } from 'vitest'
import { buildApp } from '../src/http/app'
import { callerOf, findPosition, windowStatusAt } from '../src/domain/positions'
import { runAuction } from '../src/exchange/auction'
import { multipart, png } from './media'
import { expectMatchesContract } from './contract'
import { testContext } from './helpers'

const URL = '/api/admin/v1/buyers-lists'
const setup = async () => {
  const ctx = await testContext()
  const app = buildApp(ctx)
  await app.inject({ method: 'POST', url: '/api/admin/v1/advertisers/direct', payload: { name: 'Acme Foods' } })
  const deal = (extra: Record<string, unknown> = {}) => ({ name: 'Acme direct', dealType: 'direct', invitedBuyers: [{ partnerId: 'direct', seatId: 'acme-foods' }], activeFrom: '2026-11-01T00:00:00.000Z', activeTo: '2026-11-30T00:00:00.000Z', status: 'draft', ...extra })
  return { ctx, app, deal }
}

describe('Direct advertiser deals', () => {
  it('saves as a draft with a PH deal ID and no DSP deal entries', async () => {
    const { app, deal } = await setup()
    const res = await app.inject({ method: 'POST', url: URL, payload: deal({ floorCpm: 150 }) })
    expect(res.statusCode).toBe(201)
    const body = res.json()
    expect(body.dealType).toBe('direct')
    expect(body.dealId).toMatch(/^PH-[A-Z0-9]{10}$/)
    expect(body.deals).toEqual([])
    expect(body.status).toBe('draft')
    expect(body.invitedBuyers).toEqual([{ partnerId: 'direct', seatId: 'acme-foods' }])
    expect(body.committedPlays).toBeNull()
  })

  it('takes one direct advertiser only: no DSP seats, no categories, no second buyer, no unknown advertiser', async () => {
    const { app, deal } = await setup()
    const post = (extra: Record<string, unknown>) => app.inject({ method: 'POST', url: URL, payload: deal({ floorCpm: 150, ...extra }) })
    expect((await post({ invitedBuyers: [{ partnerId: 'google_dv360', seatId: 'nestle' }] })).statusCode).toBe(400)
    expect((await post({ invitedBuyers: [{ partnerId: 'direct', seatId: 'nobody' }] })).statusCode).toBe(400)
    expect((await post({ invitedCategories: ['Food & Drink'] })).statusCode).toBe(400)
    await app.inject({ method: 'POST', url: '/api/admin/v1/advertisers/direct', payload: { name: 'Beta Co' } })
    expect((await post({ invitedBuyers: [{ partnerId: 'direct', seatId: 'acme-foods' }, { partnerId: 'direct', seatId: 'beta-co' }] })).statusCode).toBe(400)
    /* A direct advertiser is not a DSP buyer on any other deal type. */
    expect((await post({ dealType: 'guaranteed' })).statusCode).toBe(400)
  })

  it('is priced as a fixed CPM or a total for the term, never both; committed plays cannot be typed', async () => {
    const { app, deal } = await setup()
    const post = (extra: Record<string, unknown>) => app.inject({ method: 'POST', url: URL, payload: deal(extra) })
    expect((await post({ floorCpm: 150, termTotal: 5000 })).statusCode).toBe(400)
    expect((await post({ termTotal: 5000 })).statusCode).toBe(201)
    expect((await post({ floorCpm: 150, committedPlays: 100 })).statusCode).toBe(400)
  })

  it('finalises (shares) internally once it has a slot, with no DSP entries or acceptance', async () => {
    const { ctx, app, deal } = await setup()
    const created = (await app.inject({ method: 'POST', url: URL, payload: deal({ floorCpm: 150 }) })).json()
    /* No slot yet. */
    expect((await app.inject({ method: 'POST', url: `${URL}/${created.id}/share` })).statusCode).toBe(400)
    const ext = (await ctx.displayTypes.get('portrait'))!.phExtensions!
    await ctx.displayTypes.saveExtensions('portrait', { ...ext, slots: [{ label: 'Ad', owner: 'advertiser', partnerIds: [], advertisers: [], listMode: 'deal', buyersListId: created.id, buyersListIds: [created.id], storeScope: null, quota: null, zoneId: null } as never] })
    const live = await app.inject({ method: 'POST', url: `${URL}/${created.id}/share` })
    expect(live.statusCode).toBe(200)
    expect(live.json().status).toBe('shared')
    expect(live.json().deals).toEqual([])
    expect(live.json().committedPlays).not.toBeUndefined()
    const sheet = await app.inject({ url: `${URL}/${created.id}/deal-sheet` })
    expect(sheet.json().entries).toEqual([])
    expect((await app.inject({ method: 'POST', url: `${URL}/${created.id}/acceptances`, payload: { partnerId: 'direct', seatId: 'acme-foods' } })).statusCode).toBe(400)
  })
})

/* A finalised Direct advertiser deal reserves its windows (ticket OMwDvy3OUmY9raBtTf7v). Reserving deals (PG or Direct) never
   overlap on a slot: Rob's decision of 22 Oct 2026, no waterfall between them. */
const GOOGLE = { authorization: 'Bearer poc-token-google-dv360' }
const INV = '/api/admin/v1/available-inventory'
const W = '2026-11-03T00:00:00.000Z'

async function sellSetup() {
  const { ctx, app, deal } = await setup()
  const direct = (await app.inject({ method: 'POST', url: URL, payload: deal({ floorCpm: 150 }) })).json()
  const ext = (await ctx.displayTypes.get('portrait'))!.phExtensions!
  const slot = { label: 'Ad', owner: 'advertiser', partnerIds: [], advertisers: [], storeScope: null, quota: null, zoneId: null }
  await ctx.displayTypes.saveExtensions('portrait', { ...ext, slots: [{ ...slot, listMode: 'deal', buyersListId: direct.id, buyersListIds: [direct.id] } as never] })
  ctx.db.prepare('INSERT INTO audience_vacd (display_type_id, slot, assumed_views_per_window, counted) VALUES (?, ?, ?, 1)').run('portrait', 1, 800)
  const assign = (ids: string[]) => app.inject({ method: 'PUT', url: INV, payload: { items: [{ displayTypeId: 'portrait', slot: 1, assignedTo: { buyersListIds: ids }, floorCpm: null }] } })
  /* A second reserving deal: Programmatic guaranteed needs a DSP seat, so a second Direct advertiser stands in. */
  await app.inject({ method: 'POST', url: '/api/admin/v1/advertisers/direct', payload: { name: 'Beta Co' } })
  const other = async (from: string, to: string) => (await app.inject({ method: 'POST', url: URL, payload: deal({ name: 'Beta direct', invitedBuyers: [{ partnerId: 'direct', seatId: 'beta-co' }], floorCpm: 150, activeFrom: from, activeTo: to }) })).json()
  return { ctx, app, direct, assign, other, slot }
}

describe('Direct advertiser deals: no overlapping reserving deals on a slot', () => {
  it('refuses assigning a deal whose flight overlaps one on the slot (409), naming the deal, advertiser, slot and dates', async () => {
    const { app, direct, assign, other } = await sellSetup()
    const clash = await other('2026-11-20T00:00:00.000Z', '2026-12-10T00:00:00.000Z')
    const res = await assign([direct.id, clash.id])
    expect(res.statusCode).toBe(409)
    const msg = res.json().error.message as string
    expect(msg).toContain('Acme direct')
    expect(msg).toContain('Acme Foods')
    expect(msg).toContain('Portrait')
    expect(msg).toContain('slot 1')
    expect(msg).toContain('2026-11-20 to 2026-11-30')
    /* The slot is unchanged. */
    expect((await app.inject({ url: INV })).json().items.find((i: { displayTypeId: string }) => i.displayTypeId === 'portrait').assignedTo.buyersListIds).toEqual([direct.id])
  })

  it('accepts a deal with non-overlapping dates on the same slot', async () => {
    const { direct, assign, other } = await sellSetup()
    const dec = await other('2026-12-01T00:00:00.000Z', '2026-12-31T00:00:00.000Z')
    expect((await assign([direct.id, dec.id])).statusCode).toBe(200)
  })

  it('refuses a flight edit that makes an assigned deal overlap another, and allows one that does not', async () => {
    const { app, direct, assign, other } = await sellSetup()
    const dec = await other('2026-12-01T00:00:00.000Z', '2026-12-31T00:00:00.000Z')
    expect((await assign([direct.id, dec.id])).statusCode).toBe(200)
    const body = (activeFrom: string, activeTo: string) => ({ name: dec.name, dealType: 'direct', invitedBuyers: dec.invitedBuyers, floorCpm: 150, activeFrom, activeTo })
    const bad = await app.inject({ method: 'PUT', url: `${URL}/${dec.id}`, payload: body('2026-11-25T00:00:00.000Z', '2026-12-31T00:00:00.000Z') })
    expect(bad.statusCode).toBe(409)
    expect(bad.json().error.message).toContain('2026-11-25 to 2026-11-30')
    expect((await app.inject({ method: 'PUT', url: `${URL}/${dec.id}`, payload: body('2026-12-02T00:00:00.000Z', '2026-12-31T00:00:00.000Z') })).statusCode).toBe(200)
  })

  it('answers the overlap question before anything is saved (the inline warning and the picker flags)', async () => {
    const { app, direct, other } = await sellSetup()
    const clash = await other('2026-11-20T00:00:00.000Z', '2026-12-10T00:00:00.000Z')
    const dec = await other('2026-12-01T00:00:00.000Z', '2026-12-31T00:00:00.000Z')
    const slotAsk = await app.inject({ method: 'POST', url: '/api/admin/v1/reserving-conflicts', payload: { displayTypeId: 'portrait', slot: 1, buyersListIds: [direct.id, clash.id], candidates: [dec.id] } })
    expect(slotAsk.statusCode).toBe(200)
    expectMatchesContract('POST', '/admin/v1/reserving-conflicts', 200, slotAsk.json())
    expect(slotAsk.json().conflicts).toHaveLength(1)
    expect(slotAsk.json().conflicts[0]).toMatchObject({ dealName: 'Acme direct', advertiser: 'Acme Foods', playlist: 'Portrait', slot: 1, overlapFrom: '2026-11-20', overlapTo: '2026-11-30' })
    /* Beta's December deal meets the November-to-December one just chosen, not Acme's November. */
    expect(Object.keys(slotAsk.json().candidates)).toEqual([dec.id])
    const picker = await app.inject({ method: 'POST', url: '/api/admin/v1/reserving-conflicts', payload: { displayTypeId: 'portrait', slot: 1, buyersListIds: [direct.id], candidates: [clash.id, dec.id] } })
    expect(Object.keys(picker.json().candidates)).toEqual([clash.id])
    const flightAsk = await app.inject({ method: 'POST', url: '/api/admin/v1/reserving-conflicts', payload: { listId: direct.id, activeFrom: '2026-11-01T00:00:00.000Z', activeTo: '2026-11-30T00:00:00.000Z' } })
    expect(flightAsk.json().conflicts).toEqual([])
  })
})

describe('Direct advertiser deals: the exchange reserves the windows', () => {
  it('books the advertiser\'s approved campaign for the flight with no bid request; outside the flight nothing is reserved', async () => {
    const { ctx, app, direct } = await sellSetup()
    expect((await app.inject({ method: 'POST', url: `${URL}/${direct.id}/share` })).statusCode).toBe(200)
    const cid = (await app.inject({ method: 'POST', url: '/api/v1/campaigns', headers: GOOGLE, payload: { advertiserId: 'swisse', name: 'Acme — Portrait', displayTypeId: 'portrait', default: { pricingType: 'localised' } } })).json().campaignId
    const m = multipart({ version: 'default' }, { name: 'portrait.png', bytes: png(1080, 1920) })
    await app.inject({ method: 'POST', url: `/api/v1/campaigns/${cid}/assets`, headers: { ...GOOGLE, ...m.headers }, payload: m.payload })
    await app.inject({ method: 'POST', url: `/api/v1/campaigns/${cid}/submit`, headers: GOOGLE })
    await app.inject({ method: 'POST', url: `/api/admin/v1/campaigns/${cid}/approve`, payload: { assetVersion: 'v1' } })
    await app.inject({ method: 'PUT', url: `/api/admin/v1/campaigns/${cid}/activation`, payload: { enabled: true } })
    ctx.db.prepare("UPDATE campaigns SET advertiser_id = 'acme-foods' WHERE id = ?").run(cid)

    const result = await runAuction(ctx, new Date(W))
    const out = result.positions.find((p) => p.positionId === 'portrait.s1')!
    expect(out.bidRequests).toBe(0)
    expect(out.winner).toMatchObject({ advertiserId: 'acme-foods' })
    const rows = await ctx.reservations.forWindow('portrait.s1', W)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ status: 'reserved', partnerId: 'direct', campaignId: cid, clearingCpm: 150 })
    expect(rows[0].handedOffAt).not.toBeNull()
    expect((await ctx.campaigns.bookings(cid)).map((b) => b.windowStart)).toEqual([W])
    expect((await ctx.campaigns.bookings(cid))[0].personalisedEligible).toBe(true)

    /* Before the flight starts nothing is reserved. */
    const early = await runAuction(ctx, new Date('2026-10-26T00:00:00.000Z'))
    expect(early.positions.find((p) => p.positionId === 'portrait.s1')!.winner).toBeNull()
    expect(await ctx.reservations.forWindow('portrait.s1', '2026-10-26T00:00:00.000Z')).toHaveLength(0)
  })

  it('reads Reserved in availability across the flight, and not outside it', async () => {
    const { ctx, app, direct } = await sellSetup()
    await app.inject({ method: 'POST', url: `${URL}/${direct.id}/share` })
    const p = (await findPosition(ctx, 'portrait.s1'))!
    const at = (d: string) => windowStatusAt(ctx, p, callerOf({} as never, undefined), new Date(`${d}T00:00:00.000Z`))
    expect(await at('2026-11-15')).toBe('reserved')
    expect(await at('2026-11-30')).toBe('reserved')
    expect(await at('2026-12-02')).not.toBe('reserved')
    expect(await at('2026-10-30')).not.toBe('reserved')
  })

  it('reads Reserved across every live Direct deal on the slot, not only the first (E2E 21 Oct 2026)', async () => {
    const { ctx, app, direct, assign, other } = await sellSetup()
    const dec = await other('2026-12-01T00:00:00.000Z', '2026-12-31T23:59:59.999Z')
    expect((await assign([direct.id, dec.id])).statusCode).toBe(200)
    for (const id of [direct.id, dec.id]) await app.inject({ method: 'POST', url: `${URL}/${id}/share` })
    const p = (await findPosition(ctx, 'portrait.s1'))!
    const at = (d: string) => windowStatusAt(ctx, p, callerOf({} as never, undefined), new Date(`${d}T00:00:00.000Z`))
    expect(await at('2026-11-15')).toBe('reserved')
    expect(await at('2026-12-15')).toBe('reserved')
  })
})

/* Campaign authoring: a direct advertiser picks its own live Direct deal (ticket knqu0B2PGTF9PG1EUWYD). */
describe('Direct advertiser deals in campaign authoring', () => {
  const mk = async () => {
    const { ctx, app, deal } = await setup()
    await app.inject({ method: 'POST', url: '/api/admin/v1/advertisers/direct', payload: { name: 'Beta Co' } })
    const make = async (extra: Record<string, unknown>) => (await app.inject({ method: 'POST', url: URL, payload: deal({ floorCpm: 150, ...extra }) })).json()
    const live = async (id: string) => {
      const ext = (await ctx.displayTypes.get('portrait'))!.phExtensions!
      await ctx.displayTypes.saveExtensions('portrait', { ...ext, slots: [{ label: 'Ad', owner: 'advertiser', partnerIds: [], advertisers: [], listMode: 'deal', buyersListId: id, buyersListIds: [id], storeScope: null, quota: null, zoneId: null } as never] })
      return app.inject({ method: 'POST', url: `${URL}/${id}/share` })
    }
    return { ctx, app, make, live }
  }
  const deals = async (app: Awaited<ReturnType<typeof mk>>['app'], id: string, at = '2026-11-10T00:00:00.000Z') =>
    (await app.inject({ url: `/api/admin/v1/advertisers/${id}/deals?at=${at}` })).json().items as { dealId: string; dealType: string }[]

  it('lists only its own finalised deal whose term covers the date', async () => {
    const { app, make, live } = await mk()
    const draft = await make({})
    expect(await deals(app, 'acme-foods')).toEqual([])
    expect((await live(draft.id)).statusCode).toBe(200)
    const items = await deals(app, 'acme-foods')
    expect(items.map((i) => i.dealId)).toEqual([draft.dealId])
    expect(items[0].dealType).toBe('direct')
    expect(await deals(app, 'acme-foods', '2026-12-15T00:00:00.000Z')).toEqual([])
    expect(await deals(app, 'beta-co')).toEqual([])
  })

  it('a campaign takes its own advertiser’s deal ID and refuses another advertiser’s', async () => {
    const { ctx, app, make, live } = await mk()
    const acme = await make({})
    await live(acme.id)
    const { assertInvitedDeals } = await import('../src/domain/advertiserDeals')
    const at = '2026-11-10T00:00:00.000Z'
    await expect(assertInvitedDeals(ctx, 'acme-foods', 'dealId', [acme.dealId], [], at)).resolves.toBeUndefined()
    await expect(assertInvitedDeals(ctx, 'beta-co', 'dealId', [acme.dealId], [], at)).rejects.toMatchObject({ status: 400 })
    await expect(assertInvitedDeals(ctx, 'acme-foods', 'dealId', ['PH-NOPE000000'], [], at)).rejects.toMatchObject({ status: 400 })
    void app
  })
})

/* Flight start and end times, and a time zone mode (ticket yOginusgiFgFkwVHTRFH, 22 Oct 2026). */
describe('Deal flights: times and a time zone mode', () => {
  it('saves the time zone mode with the deal, defaults to the platform, keeps it when an edit omits it, and refuses a bad value', async () => {
    const { app, deal } = await setup()
    const made = (await app.inject({ method: 'POST', url: URL, payload: deal({ floorCpm: 150 }) })).json()
    expect(made.timeZoneMode).toBe('platform')
    const body = { name: made.name, dealType: 'direct', invitedBuyers: made.invitedBuyers, floorCpm: 150, activeFrom: made.activeFrom, activeTo: made.activeTo }
    const store = await app.inject({ method: 'PUT', url: `${URL}/${made.id}`, payload: { ...body, timeZoneMode: 'store' } })
    expect(store.statusCode).toBe(200)
    expect(store.json().timeZoneMode).toBe('store')
    expect((await app.inject({ method: 'PUT', url: `${URL}/${made.id}`, payload: { ...body, name: 'Renamed' } })).json().timeZoneMode).toBe('store')
    expect((await app.inject({ url: `${URL}/${made.id}/deal-sheet` })).json()).toMatchObject({ timeZoneMode: 'store' })
    expect((await app.inject({ method: 'PUT', url: `${URL}/${made.id}`, payload: { ...body, timeZoneMode: 'moon' } })).statusCode).toBe(400)
  })

  it('allows two deals on one slot on the same day when their times do not overlap, and refuses ones that do, with the shared span', async () => {
    const { app, direct, assign, other } = await sellSetup()
    const morning = (await app.inject({ method: 'PUT', url: `${URL}/${direct.id}`, payload: { name: direct.name, dealType: 'direct', invitedBuyers: direct.invitedBuyers, floorCpm: 150, activeFrom: '2026-11-10T08:00:00.000Z', activeTo: '2026-11-10T12:00:00.000Z' } }))
    expect(morning.statusCode).toBe(200)
    /* Starts the moment the morning deal ends: no overlap. */
    const afternoon = await other('2026-11-10T12:00:00.000Z', '2026-11-10T18:00:00.000Z')
    expect((await assign([direct.id, afternoon.id])).statusCode).toBe(200)
    const clash = await other('2026-11-10T11:30:00.000Z', '2026-11-10T13:00:00.000Z')
    const refused = await assign([direct.id, clash.id])
    expect(refused.statusCode).toBe(409)
    expect(refused.json().error.message).toContain('2026-11-10 11:30 to 2026-11-10 12:00')
    const ask = await app.inject({ method: 'POST', url: '/api/admin/v1/reserving-conflicts', payload: { displayTypeId: 'portrait', slot: 1, buyersListIds: [direct.id, clash.id] } })
    expect(ask.json().conflicts[0]).toMatchObject({ overlapFromAt: '2026-11-10T11:30:00.000Z', overlapToAt: '2026-11-10T12:00:00.000Z' })
  })
})
