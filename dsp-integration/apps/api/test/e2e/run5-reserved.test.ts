/* E2E spec v2 (board doc f34VQZCy2kkWJfBP6Iwp), Run 5 — reserved.
   Fixture: a reserve price (CPM premium) of 150 on each display type,
   overridden to 220 on the fixture's slot; a second display type follows
   its default. R3/R4 follow the reserve-price booking flow (open questions
   45 and 52, decided by Rob on 29 Sep 2026; REQUIREMENTS §5 "Reserve
   price"): a `type: reserve` commitment must be at least the reserve price,
   is booked at the reserve price (which must clear the effective floor),
   and takes that window out of the open auction. A reserve-priced window
   nobody has committed to is auctioned as usual — the reserve price is not
   a floor. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { runAuction } from '../../src/exchange/auction'
import { findPosition } from '../../src/domain/positions'
import { DT, DT_B, GOOGLE, POS, POS_B, day, fixture, harness } from './harness'

afterEach(() => {
  vi.unstubAllGlobals()
})

async function reservedHarness() {
  const h = await harness()
  await fixture(h.ctx, { second: true })
  for (const dt of [DT, DT_B]) {
    const t = (await h.ctx.displayTypes.get(dt))!
    await h.ctx.displayTypes.saveExtensions(dt, { ...t.phExtensions!, reservePrice: 150 } as never)
  }
  await h.admin.slot({ reservePrice: 220 })
  return h
}
const hold = (h: Awaited<ReturnType<typeof harness>>) => h.admin.slot({ listMode: null, advertisers: ['Swisse'], partnerIds: ['p_google'] })

describe('Run 5 — reserved', () => {
  it('R1 — a slot’s override always wins over the display type’s inherited reserve price', async () => {
    const h = await reservedHarness()
    const pos = (id: string) => h.app.inject({ method: 'GET', url: `/api/v1/inventory/${id}`, headers: GOOGLE })
    expect((await pos(POS)).json().reservePrice).toBe(220)
    expect((await pos(POS_B)).json().reservePrice).toBe(150)
    const rows = (await h.app.inject({ method: 'GET', url: '/api/admin/v1/available-inventory' })).json().items as { displayTypeId: string; slot: number; reservePrice: number | null; reservePriceOverride: number | null; displayTypeReservePrice: number | null }[]
    expect(rows.find((r) => r.displayTypeId === DT)).toMatchObject({ reservePrice: 220, reservePriceOverride: 220, displayTypeReservePrice: 150 })
    expect(rows.find((r) => r.displayTypeId === DT_B)).toMatchObject({ reservePrice: 150, reservePriceOverride: null, displayTypeReservePrice: 150 })
    /* A new display-type default reaches the slot that follows it, never the overridden one. */
    const t = (await h.ctx.displayTypes.get(DT_B))!
    await h.ctx.displayTypes.saveExtensions(DT_B, { ...t.phExtensions!, reservePrice: 175 } as never)
    const t2 = (await h.ctx.displayTypes.get(DT))!
    await h.ctx.displayTypes.saveExtensions(DT, { ...t2.phExtensions!, reservePrice: 90 } as never)
    expect((await pos(POS_B)).json().reservePrice).toBe(175)
    expect((await pos(POS)).json().reservePrice).toBe(220)
  })

  it('R2 — a reserved slot (held for a named advertiser) is excluded from the open auction', async () => {
    const h = await reservedHarness()
    await h.approvedCrid('crid-r2', day(0))
    await hold(h)
    const before = h.bidder.log.bidRequests.filter((r) => (r.body as { dooh?: { id?: string } }).dooh?.id === DT).length
    const out = await runAuction(h.ctx, day(1))
    /* The window clearing only ever considers private-auction positions: a held one is not in it, and is told so if asked for by name. */
    expect(out.positions.find((x) => x.positionId === POS)).toBeUndefined()
    const asked = await runAuction(h.ctx, day(1), { positions: [(await findPosition(h.ctx, POS))!] })
    expect(asked.positions[0]).toMatchObject({ bidRequests: 0, bids: 0, winner: null, skipped: 'Held for a named advertiser: booked by reservation.' })
    expect(h.bidder.log.bidRequests.filter((r) => (r.body as { dooh?: { id?: string } }).dooh?.id === DT).length).toBe(before)
    /* A bid on it is refused: reserve it instead. */
    const id = await h.readyApiCampaign('Swisse — R2')
    const bid = await h.partner.bid(id, day(2), 500)
    expect(bid.statusCode).toBe(409)
    expect(bid.json().error.message).toBe('This position is held for this advertiser: reserve it instead of bidding.')
  })

  it('R3 — a reservation below the reserve price is refused; one at or above it is booked at the reserve price, which must clear the floor', async () => {
    const h = await reservedHarness()
    const id = await h.readyApiCampaign('Swisse — R3')
    const reserve = (w: Date, bidCpm: number) => h.partner.bid(id, w, bidCpm, { type: 'reserve' })
    /* Below the 220 reserve price (though above the floor): refused. */
    const underReserve = await reserve(day(0), 150)
    expect(underReserve.statusCode).toBe(400)
    expect(underReserve.json().error).toMatchObject({ code: 'validation_failed', details: [{ field: 'bidCpm', reason: 'The reserve price for this position is 220 USD CPM; commit to at least that.' }] })
    /* Above it: booked at the reserve price, not at the bid. */
    const over = await reserve(day(0), 250)
    expect(over.statusCode).toBe(201)
    expect(over.json()).toMatchObject({ status: 'reserved', clearingCpm: 220 })
    /* A reserve price under the buyer's effective floor can't be booked. */
    await h.admin.slot({ reservePrice: 90 })
    const underFloor = await reserve(day(1), 90)
    expect(underFloor.statusCode).toBe(422)
    expect(underFloor.json().error).toMatchObject({ code: 'below_floor' })
  })

  it('R4 — a reserve commitment takes its window out of the open auction; a reserve-priced window nobody committed to is auctioned as usual', async () => {
    const h = await reservedHarness()
    await h.approvedCrid('crid-r4', day(0))
    /* No commitment: auctioned as usual, cleared at 150 — the reserve price is not a floor. */
    const open = await runAuction(h.ctx, day(1))
    expect(open.positions.find((x) => x.positionId === POS)!.winner).toMatchObject({ clearingCpm: 150 })
    /* Committed at the reserve price: booked and handed off at once, at 220. */
    const id = await h.readyApiCampaign('Swisse — R4')
    const res = await h.partner.bid(id, day(2), 220, { type: 'reserve' })
    expect(res.statusCode).toBe(201)
    expect(res.json()).toMatchObject({ status: 'reserved', clearingCpm: 220 })
    expect(h.campaigns.handoffs.filter((b) => b.windowStart === day(2).toISOString())).toMatchObject([{ campaignId: id, displayTypeId: DT }])
    /* The auction never clears that window, and no bid request goes out for it. */
    const held = await runAuction(h.ctx, day(2))
    expect(held.positions.find((x) => x.positionId === POS)).toMatchObject({ bidRequests: 0, winner: null })
  })
})
