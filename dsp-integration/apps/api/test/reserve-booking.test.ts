/* Deals and reserve-price booking (open questions 45 and 52, decided by Rob
   on 29 Sep 2026).
   - OQ45: a deal is per DSP, bilateral, and built on the existing buyers
     list. Its rate is a commitment on top of the same score-driven floor.
     It is never under the floor, and a deal never bypasses the floor.
   - OQ52: a buyer commits to a reserve-priced slot for a future window. The
     window is held as Reserved, out of the open auction, and billed at the
     reserve price on its realised VAC-d. There is no flat guaranteed
     volume and no make-good. */
import type { InvitedBuyer, Slot } from '@ph-dsp/types'
import { describe, expect, it } from 'vitest'
import { runAuction } from '../src/exchange/auction'
import { runBilling } from '../src/exchange/billing'
import { buildApp } from '../src/http/app'
import { effectivePartnerIds, findPosition } from '../src/domain/positions'
import { expectMatchesContract } from './contract'
import { multipart, png } from './media'
import { NOW, testContext } from './helpers'

const GOOGLE = { authorization: 'Bearer poc-token-google-dv360' }
const AMAZON = { authorization: 'Bearer poc-token-amazon-dsp' }
const W1 = '2026-09-21T00:00:00.000Z'
const W2 = '2026-09-22T00:00:00.000Z'
const W3 = '2026-09-23T00:00:00.000Z'

async function setup(slot: Partial<Slot> = {}) {
  let now = NOW
  const ctx = await testContext({ clock: () => now })
  const app = buildApp(ctx)
  /* Portrait: one advertiser slot, reserve price 150 CPM (floor 100). */
  const ext = (await ctx.displayTypes.get('portrait'))!.phExtensions!
  await ctx.displayTypes.saveExtensions('portrait', {
    ...ext,
    slots: [{ label: 'Ad', owner: 'advertiser', partnerIds: [], advertisers: [], listMode: 'rtb', buyersListId: null, storeScope: null, quota: null, zoneId: null, supportedTargeting: ['localised'], reservePrice: 150, ...slot } as Slot],
  })
  ctx.db.prepare('INSERT INTO audience_vacd (display_type_id, slot, assumed_views_per_window, counted) VALUES (?, ?, ?, 1)').run('portrait', 1, 800)
  /* A Swisse campaign whose creative fits Portrait, approved and activated,
     so a booking really hands off and bills. */
  const cid = (await app.inject({ method: 'POST', url: '/api/v1/campaigns', headers: GOOGLE, payload: { advertiserId: 'swisse', name: 'Swisse — Portrait', displayTypeId: 'portrait', default: { pricingType: 'localised' } } })).json().campaignId
  const m = multipart({ version: 'default' }, { name: 'portrait.png', bytes: png(1080, 1920) })
  await app.inject({ method: 'POST', url: `/api/v1/campaigns/${cid}/assets`, headers: { ...GOOGLE, ...m.headers }, payload: m.payload })
  await app.inject({ method: 'POST', url: `/api/v1/campaigns/${cid}/submit`, headers: GOOGLE })
  await app.inject({ method: 'POST', url: `/api/admin/v1/campaigns/${cid}/approve`, payload: { assetVersion: 'v1' } })
  await app.inject({ method: 'PUT', url: `/api/admin/v1/campaigns/${cid}/activation`, payload: { enabled: true } })
  const post = (body: Record<string, unknown>, headers = GOOGLE) => app.inject({ method: 'POST', url: '/api/v1/reservations', headers, payload: body })
  const RESERVE = { positionId: 'portrait.s1', windowStart: W1, campaignId: cid, advertiserId: 'swisse', type: 'reserve', bidCpm: 150 }
  /* Nestlé on the same DSP: approved, activated, and its floor is 80. */
  const NESTLE_BID = { positionId: 'portrait.s1', windowStart: W1, campaignId: 'c_dsp_nestle', advertiserId: 'nestle', type: 'bid', bidCpm: 400 }
  const status = async (from: string, to: string, headers = GOOGLE) =>
    (await app.inject({ url: `/api/v1/inventory/portrait.s1/availability?from=${from}&to=${to}`, headers })).json().windows.map((w: { status: string }) => w.status)
  const rows = async (w = W1) => await ctx.reservations.forWindow('portrait.s1', w)
  return { ctx, app, cid, post, RESERVE, NESTLE_BID, status, rows, setNow: (d: Date) => { now = d } }
}

describe('reserve-price booking (OQ52): commit, hold as Reserved, honour at the reserve price', () => {
  it('holds the window as Reserved at the reserve price, and hands it off at once', async () => {
    const { post, RESERVE, status, rows } = await setup()
    expect(await status('2026-09-21', '2026-09-21')).toEqual(['available'])
    const res = await post(RESERVE)
    expect(res.statusCode).toBe(201)
    expectMatchesContract('POST', '/v1/reservations', 201, res.json())
    expect(res.json()).toMatchObject({ status: 'reserved', clearingCpm: 150, currency: 'AUD' })
    expect((await rows())[0]).toMatchObject({ type: 'reserve', status: 'reserved', clearingCpm: 150, testMode: false })
    expect((await rows())[0].handedOffAt).not.toBeNull()
    /* Reserved to every caller, the holder included: it is spoken for. */
    expect(await status('2026-09-21', '2026-09-22')).toEqual(['reserved', 'available'])
  })

  it('books at the reserve price itself, not above it, and never below it', async () => {
    const { post, RESERVE } = await setup()
    const low = await post({ ...RESERVE, bidCpm: 149 })
    expect(low.statusCode).toBe(400)
    expectMatchesContract('POST', '/v1/reservations', 400, low.json())
    expect(low.json().error).toMatchObject({ code: 'validation_failed', details: [{ field: 'bidCpm', reason: 'The reserve price for this position is 150 AUD CPM; commit to at least that.' }] })
    const res = await post({ ...RESERVE, bidCpm: 200 })
    expect(res.json()).toMatchObject({ status: 'reserved', clearingCpm: 150 })
  })

  it('can be made ahead of the open auction, but not once the window’s auction has run', async () => {
    const { post, RESERVE } = await setup()
    /* 5 Oct: bidding for it doesn't open until 28 Sep; a reservation is taken now. */
    const ahead = await post({ ...RESERVE, windowStart: '2026-10-05T00:00:00.000Z' })
    expect(ahead.statusCode).toBe(201)
    const bid = await post({ ...RESERVE, type: 'bid', windowStart: '2026-10-06T00:00:00.000Z' })
    expect(bid.json().error.message).toBe('Bidding for that window opens at 2026-09-28T18:00:00.000Z.')
    const past = await post({ ...RESERVE, windowStart: '2026-09-20T00:00:00.000Z' })
    expect(past.statusCode).toBe(409)
  })

  it('is not auctioned: a higher bid is refused, one already waiting loses, and the auction skips the window', async () => {
    const { ctx, post, RESERVE, NESTLE_BID, rows } = await setup()
    /* Nestlé's 400 CPM bid is waiting when Swisse commits at 150. */
    const waiting = await post(NESTLE_BID)
    expect(waiting.json().status).toBe('pending')
    expect((await post(RESERVE)).statusCode).toBe(201)
    expect((await rows()).find((r) => r.advertiserId === 'nestle')).toMatchObject({ status: 'lost', reason: 'The window was reserved by another buyer; it is not auctioned.' })
    /* A new, higher bid is refused outright. */
    ctx.db.prepare("DELETE FROM reservations WHERE advertiser_id = 'nestle'").run()
    const higher = await post({ ...NESTLE_BID, bidCpm: 900 })
    expect(higher.statusCode).toBe(409)
    expectMatchesContract('POST', '/v1/reservations', 409, higher.json())
    expect(higher.json().error.message).toBe('That window is reserved: it is held outside the open auction.')
    const out = await runAuction(ctx, new Date(W1))
    expect(out.positions.find((p) => p.positionId === 'portrait.s1')).toMatchObject({ bidRequests: 0, bids: 0, winner: null, skipped: 'Reserved: held outside the open auction.' })
    expect((await rows()).filter((r) => ['won', 'reserved'].includes(r.status))).toEqual([expect.objectContaining({ advertiserId: 'swisse', clearingCpm: 150 })])
  })

  it('is refused where there is no reserve price, and below the buyer’s effective floor', async () => {
    const none = await setup({ reservePrice: null })
    const refused = await none.post(none.RESERVE)
    expect(refused.statusCode).toBe(409)
    expect(refused.json().error.message).toBe('Only a position held for this advertiser, or one with a reserve price, can be reserved; bid for it instead.')
    /* A reserve price of 90 undercuts Swisse's floor of 100: the floor wins. */
    const cheap = await setup({ reservePrice: 90 })
    const res = await cheap.post({ ...cheap.RESERVE, bidCpm: 90 })
    expect(res.statusCode).toBe(422)
    expect(res.json().error).toMatchObject({ code: 'below_floor', message: '90 is below the effective floor of 100 AUD CPM.' })
  })

  it('bills on realised VAC-d at the reserve price: a floor commitment, not a guaranteed volume', async () => {
    const { ctx, cid, post, RESERVE, setNow } = await setup()
    const r = await post(RESERVE)
    /* A quarter of the slot's time actually played in the window. */
    const play = ctx.db.prepare("INSERT INTO plays (id, display_id, campaign_id, played_at, duration_sec) VALUES (?, 'd_1003', ?, ?, 15)")
    for (let i = 0; i < 1440; i++) play.run(`p_${i}`, cid, new Date(Date.parse(W1) + i * 60_000).toISOString())
    setNow(new Date('2026-09-22T06:00:00.000Z'))
    const item = (await runBilling(ctx)).find((i) => i.positionId === 'portrait.s1')
    expect(item).toMatchObject({ reservationId: r.json().reservationId, cpm: 150, assumedViews: 800, playedSec: 21600, expectedSec: 86400, realisedViews: 200, amount: 30 })
    /* Nothing more is owed for the undelivered three quarters: no make-good. */
    expect(await runBilling(ctx)).toEqual([])
  })
})

describe('deals (OQ45): per DSP, on the existing buyers list, never under the floor', () => {
  const termDeal = async (ctx: Awaited<ReturnType<typeof setup>>['ctx'], invited: InvitedBuyer[] = [{ partnerId: 'p_google', seatId: '5130002' }]) =>
    await ctx.buyersLists.insert({ id: 'bl_pg', name: 'Swisse PG', description: '', invitedBuyers: invited, activeFrom: null, activeTo: '2026-09-23T23:59:59.000Z', auctionCloses: '2026-09-21T18:00:00.000Z' })

  it('a reserve commitment on a two-period deal locks the term at the reserve price; every later window is held and booked as Reserved', async () => {
    const { ctx, cid, post, RESERVE, NESTLE_BID, status, rows } = await setup({ listMode: 'deal', buyersListId: 'bl_pg' })
    await termDeal(ctx)
    expect((await post(RESERVE)).json()).toMatchObject({ status: 'reserved', clearingCpm: 150 })
    expect((await ctx.buyersLists.get('bl_pg'))!.lockedWin).toMatchObject({ cpm: 150, partnerId: 'p_google', advertiserId: 'swisse', channel: 'api', source: 'reserve' })
    /* The whole term reads Reserved before any of it is booked. The day after the term is outside the lock. */
    expect(await status('2026-09-21', '2026-09-24')).toEqual(['reserved', 'reserved', 'reserved', 'available'])
    /* A bid for a later window of the term is refused: its rate is decided. */
    const late = await post({ ...NESTLE_BID, windowStart: W2 })
    expect(late.statusCode).toBe(409)
    expect(late.json().error.message).toBe("This private auction's term is locked to a winning bid (Swisse PG); its windows take no further bids.")
    const out = await runAuction(ctx, new Date(W2))
    expect(out.positions.find((p) => p.positionId === 'portrait.s1')).toMatchObject({ bidRequests: 0, winner: { partnerId: 'p_google', advertiserId: 'swisse', clearingCpm: 150 } })
    expect(await rows(W2)).toMatchObject([{ type: 'reserve', status: 'reserved', clearingCpm: 150, campaignId: cid }])
    expect((await rows(W2))[0].handedOffAt).not.toBeNull()
  })

  it('never books a locked rate below the floor in force when the window is booked', async () => {
    const { ctx, post, RESERVE, rows } = await setup({ listMode: 'deal', buyersListId: 'bl_pg' })
    await termDeal(ctx)
    await post(RESERVE)
    /* The floor rises to 200 during the term: the 150 commitment no longer clears it. */
    await ctx.company.save({ ...(await ctx.company.get()), floorCpm: 200 })
    const out = await runAuction(ctx, new Date(W2))
    expect(out.positions.find((p) => p.positionId === 'portrait.s1')).toMatchObject({
      winner: null, skipped: 'Private auction: the locked rate (150) is below the effective floor of 200 AUD CPM, so this window is not sold under Swisse PG.',
    })
    expect(await rows(W2)).toEqual([])
  })

  it('refuses a deal rate below the effective floor at intake, bid or reserve', async () => {
    const { ctx, post, RESERVE } = await setup({ listMode: 'deal', buyersListId: 'bl_pg', reservePrice: 120 })
    await termDeal(ctx)
    await ctx.company.saveAdvertiserSettings({ swisse: { approvalRequired: true, floorMultiplier: 1.5 } })
    const bid = await post({ ...RESERVE, type: 'bid', bidCpm: 140 })
    expect(bid.json().error).toMatchObject({ code: 'below_floor', message: '140 is below the effective floor of 150 AUD CPM.' })
    const reserve = await post({ ...RESERVE, bidCpm: 140 })
    expect(reserve.statusCode).toBe(422)
    expect(reserve.json().error).toMatchObject({ code: 'below_floor', message: '120 is below the effective floor of 150 AUD CPM.' })
    expect((await ctx.buyersLists.get('bl_pg'))!.lockedWin).toBeNull()
  })

  it('is per DSP: a seat-ID deal reaches only that DSP, and a locked term binds one DSP’s buyer', async () => {
    const { ctx, app, post, RESERVE, status } = await setup({ listMode: 'deal', buyersListId: 'bl_pg' })
    /* Swisse also buys through Amazon, connected and live for this test. */
    await ctx.partners.update('p_amazon', { status: 'connected', mode: 'live', bidder: { bidderEndpoint: 'https://amazon.example/bid', seatIds: ['a1'] }, seats: [{ id: '588104411', name: "L'Oréal", domain: 'loreal.com' }, { id: 'amz-swisse', name: 'Swisse', domain: 'swisse.com' }] })
    const p = (await findPosition(ctx, 'portrait.s1'))!

    /* Invited by Google's Swisse seat ID: Amazon isn't party to the deal at all. */
    await termDeal(ctx, [{ partnerId: 'p_google', seatId: '5130002' }])
    expect(await effectivePartnerIds(ctx, p.def)).toEqual(['p_google'])
    expect((await app.inject({ url: '/api/v1/inventory/portrait.s1', headers: AMAZON })).statusCode).toBe(404)
    expect((await app.inject({ url: '/api/v1/inventory/portrait.s1', headers: GOOGLE })).statusCode).toBe(200)

    /* Invited on both DSPs' Swisse seats: either may take it, but the
       commitment is bilateral: the first DSP to commit holds the term. */
    await ctx.buyersLists.delete('bl_pg')
    await termDeal(ctx, [{ partnerId: 'p_google', seatId: '5130002' }, { partnerId: 'p_amazon', seatId: 'amz-swisse' }])
    expect((await effectivePartnerIds(ctx, p.def))!.sort()).toEqual(['p_amazon', 'p_google'])
    expect((await post(RESERVE)).statusCode).toBe(201)
    expect((await ctx.buyersLists.get('bl_pg'))!.lockedWin).toMatchObject({ partnerId: 'p_google' })
    expect(await status('2026-09-23', '2026-09-23', AMAZON)).toEqual(['reserved'])
    const out = await runAuction(ctx, new Date(W3))
    expect(out.positions.find((x) => x.positionId === 'portrait.s1')!.winner).toMatchObject({ partnerId: 'p_google' })
  })
})

/* OQ27 (Rob, 29 Sep 2026): a reserve-price commitment is for one of the
   position's own windows, its billing unit long. */
describe('reserve-price booking on a slot with its own billing unit (OQ27)', () => {
  it('reserves a whole week on a 168-hour slot, starting on its Monday, and hands off the week', async () => {
    const { ctx, cid, post, RESERVE, status, rows } = await setup({ billingUnitHours: 168 })
    const tuesday = await post({ ...RESERVE, windowStart: W2 })
    expect(tuesday.statusCode).toBe(400)
    expect(tuesday.json().error.details).toContainEqual({ field: 'windowStart', reason: "The start of one of this position's 168-hour play windows (UTC)." })
    expect((await post(RESERVE)).statusCode).toBe(201)
    expect((await rows())[0]).toMatchObject({ status: 'reserved', clearingCpm: 150 })
    expect(await status('2026-09-21', '2026-09-27')).toEqual(['reserved'])
    expect((await ctx.campaigns.bookings(cid)).map((b) => [b.windowStart, b.windowEnd])).toEqual([[W1, '2026-09-28T00:00:00.000Z']])
    /* Tuesday's auction doesn't touch the weekly slot at all. */
    expect((await runAuction(ctx, new Date(W2))).positions.find((x) => x.positionId === 'portrait.s1')).toBeUndefined()
  })
})
