/* Bid floor hierarchy (Rob, 7 Oct 2026; slot floor added 17 Oct 2026):
   platform floor, then a per-slot floor, then a per-DSP floor, then a
   per-buyers-list floor. The most specific floor set applies; the platform
   floor and the slot floor are minimums; a blank level inherits from the one
   above. */
import { describe, expect, it } from 'vitest'
import { allPositions } from '../src/domain/positions'
import { resolveBaseFloor } from '../src/domain/pricing'
import { buildBidRequest } from '../src/exchange/openrtb'
import { checkFloor, floorFor } from '../src/exchange/enforcement'
import { buildApp } from '../src/http/app'
import { testContext } from './helpers'

const putDsp = (app: ReturnType<typeof buildApp>, bidder: object) => app.inject({ method: 'PUT', url: '/api/admin/v1/partners/p_google', payload: { bidder } })
const list = { name: 'Floor deal', description: '', invitedBuyers: [{ partnerId: 'p_google', seatId: '5130001' }], activeFrom: null, activeTo: null, auctionCloses: null }

describe('resolveBaseFloor', () => {
  it('the most specific floor set applies; blank inherits from above', () => {
    expect(resolveBaseFloor(100)).toBe(100)
    expect(resolveBaseFloor(100, null, null)).toBe(100)
    expect(resolveBaseFloor(100, 150)).toBe(150)
    expect(resolveBaseFloor(100, 150, 200)).toBe(200)
    expect(resolveBaseFloor(100, null, 200)).toBe(200)
    expect(resolveBaseFloor(100, 150, null)).toBe(150)
  })
  it('a slot floor raises what a blank DSP/list level inherits, and is never undercut by a lower DSP or list floor', () => {
    expect(resolveBaseFloor(100, null, null, null, 180)).toBe(180)
    expect(resolveBaseFloor(100, 150, null, null, 180)).toBe(180)
    expect(resolveBaseFloor(100, 250, null, null, 180)).toBe(250)
    expect(resolveBaseFloor(100, 150, 200, null, 180)).toBe(200)
    expect(resolveBaseFloor(100, null, 120, null, 180)).toBe(180)
    expect(resolveBaseFloor(100, null, null, null, null)).toBe(100)
  })
  it('never goes below the platform floor, even when the platform floor was raised later', () => {
    expect(resolveBaseFloor(300, 150, 200)).toBe(300)
    expect(resolveBaseFloor(300, 150)).toBe(300)
  })
})

describe('bid floor hierarchy end to end', () => {
  it('sends the platform floor when nothing else is set, a higher DSP floor to that DSP only, and a list floor on its deal', async () => {
    const ctx = await testContext()
    const app = buildApp(ctx)
    const p = (await allPositions(ctx))[0]
    const google = async () => (await ctx.partners.get('p_google'))!
    const floorSent = async (partner = google()) => (await buildBidRequest(ctx, p, await partner, 'r1')).imp[0]

    expect(await floorSent()).toMatchObject({ bidfloor: 100, bidfloorcur: 'USD' })

    const saved = await putDsp(app, { floorCpm: 150 })
    expect(saved.statusCode).toBe(200)
    expect(saved.json().bidder.floorCpm).toBe(150)
    expect(await floorSent()).toMatchObject({ bidfloor: 150, bidfloorcur: 'USD' })
    const amazon = await ctx.partners.get('p_amazon')
    if (amazon) expect((await floorSent(Promise.resolve(amazon))).bidfloor).toBe(100)

    /* A deal position: its buyers list's floor wins, and clearing it falls back to the DSP's. */
    const created = await app.inject({ method: 'POST', url: '/api/admin/v1/buyers-lists', payload: { ...list, floorCpm: 200 } })
    expect(created.statusCode).toBe(201)
    expect(created.json().floorCpm).toBe(200)
    const id = created.json().id
    const ext = (await ctx.displayTypes.get('menu_board'))!.phExtensions!
    await ctx.displayTypes.saveExtensions('menu_board', { ...ext, slots: ext.slots.map((s, i) => (i === 1 ? { ...s, listMode: 'deal', buyersListId: id } : s)) })
    const deal = (await allPositions(ctx)).find((x) => x.positionId === 'menu_board.s2')!
    expect((await buildBidRequest(ctx, deal, await google(), 'r2')).imp[0].bidfloor).toBe(200)
    const cleared = await app.inject({ method: 'PUT', url: `/api/admin/v1/buyers-lists/${id}`, payload: { ...list, floorCpm: null } })
    expect(cleared.statusCode).toBe(200)
    expect(cleared.json().floorCpm).toBeNull()
    expect((await buildBidRequest(ctx, deal, await google(), 'r3')).imp[0].bidfloor).toBe(150)

    /* Clearing the DSP floor falls back to the platform's. */
    expect((await putDsp(app, { floorCpm: null })).json().bidder.floorCpm).toBeUndefined()
    expect((await buildBidRequest(ctx, deal, await google(), 'r4')).imp[0].bidfloor).toBe(100)
  })

  it('blocks a DSP or buyers-list floor below the platform floor', async () => {
    const ctx = await testContext()
    const app = buildApp(ctx)
    const dsp = await putDsp(app, { floorCpm: 99 })
    expect(dsp.statusCode).toBe(400)
    expect(dsp.json().error.details[0]).toMatchObject({ field: 'bidder.floorCpm' })
    expect((await putDsp(app, { floorCpm: 0 })).statusCode).toBe(400)
    const l = await app.inject({ method: 'POST', url: '/api/admin/v1/buyers-lists', payload: { ...list, floorCpm: 50 } })
    expect(l.statusCode).toBe(400)
    expect(l.json().error.details[0]).toMatchObject({ field: 'floorCpm' })
    expect((await ctx.partners.get('p_google'))!.bidder.floorCpm).toBeUndefined()
    expect(await ctx.buyersLists.list()).toHaveLength(0)
  })

  it('rejects a bid below the resolved floor for its DSP, and not below the platform floor for another', async () => {
    const ctx = await testContext()
    await putDsp(buildApp(ctx), { floorCpm: 200 })
    const google = (await ctx.partners.get('p_google'))!
    const p = (await allPositions(ctx))[0]
    expect(await floorFor(ctx, null, { partner: google, position: p })).toBe(200)
    expect(await checkFloor(ctx, 150, null, { partner: google, position: p })).toMatchObject({ code: 'below_floor' })
    expect(await checkFloor(ctx, 200, null, { partner: google, position: p })).toBeNull()
    expect(await checkFloor(ctx, 150, null)).toBeNull()
  })

  it('sends a slot floor as imp.bidfloor, rejects a bid below it, and follows the platform floor once it is cleared', async () => {
    const ctx = await testContext()
    const google = (await ctx.partners.get('p_google'))!
    const set = async (floorCpm: number | null) => {
      const ext = (await ctx.displayTypes.get('menu_board'))!.phExtensions!
      await ctx.displayTypes.saveExtensions('menu_board', { ...ext, slots: ext.slots.map((s, i) => (i === 1 ? { ...s, floorCpm } : s)) })
    }
    const slotPos = async () => (await allPositions(ctx)).find((x) => x.positionId === 'menu_board.s2')!
    expect((await buildBidRequest(ctx, await slotPos(), google, 'r1')).imp[0]).toMatchObject({ bidfloor: 100, bidfloorcur: 'USD' })
    await set(175)
    expect((await buildBidRequest(ctx, await slotPos(), google, 'r2')).imp[0]).toMatchObject({ bidfloor: 175, bidfloorcur: 'USD' })
    expect(await checkFloor(ctx, 150, null, { partner: google, position: await slotPos() })).toMatchObject({ code: 'below_floor' })
    expect(await checkFloor(ctx, 175, null, { partner: google, position: await slotPos() })).toBeNull()
    /* A DSP floor below the slot floor never undercuts it; one above raises it. */
    expect((await putDsp(buildApp(ctx), { floorCpm: 120 })).statusCode).toBe(200)
    expect((await buildBidRequest(ctx, await slotPos(), (await ctx.partners.get('p_google'))!, 'r3')).imp[0].bidfloor).toBe(175)
    const raised = await putDsp(buildApp(ctx), { floorCpm: 220 })
    expect(raised.statusCode).toBe(200)
    expect((await buildBidRequest(ctx, await slotPos(), (await ctx.partners.get('p_google'))!, 'r4')).imp[0].bidfloor).toBe(220)
    await putDsp(buildApp(ctx), { floorCpm: null })
    await set(null)
    expect((await buildBidRequest(ctx, await slotPos(), (await ctx.partners.get('p_google'))!, 'r5')).imp[0].bidfloor).toBe(100)
    await ctx.company.save({ ...(await ctx.company.get()), floorCpm: 130 })
    expect((await buildBidRequest(ctx, await slotPos(), (await ctx.partners.get('p_google'))!, 'r6')).imp[0].bidfloor).toBe(130)
  })
})
