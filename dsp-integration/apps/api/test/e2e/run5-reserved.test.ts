/* E2E spec v2 (board doc f34VQZCy2kkWJfBP6Iwp), Run 5 — reserved.
   Fixture: a reserve price (CPM premium) of 150 on each display type,
   overridden to 220 on the fixture's slot; a second display type follows
   its default. R3/R4 are the known gap (open question 52): a "reserve"
   reservation clears against the ordinary floor, not the reserve price, and
   nothing takes a reserve-priced slot out of the open auction. The tests
   pin that gap exactly as REQUIREMENTS describes it, so a change in it is
   noticed. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { runAuction } from '../../src/exchange/auction'
import { DT, DT_B, GOOGLE, POS, POS_B, day, fixture, harness } from './harness'

afterEach(() => {
  vi.unstubAllGlobals()
})

async function reservedHarness() {
  const h = await harness()
  fixture(h.ctx, { second: true })
  for (const dt of [DT, DT_B]) {
    const t = h.ctx.displayTypes.get(dt)!
    h.ctx.displayTypes.saveExtensions(dt, { ...t.phExtensions!, reservePrice: 150 } as never)
  }
  h.admin.slot({ reservePrice: 220 })
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
    const t = h.ctx.displayTypes.get(DT_B)!
    h.ctx.displayTypes.saveExtensions(DT_B, { ...t.phExtensions!, reservePrice: 175 } as never)
    const t2 = h.ctx.displayTypes.get(DT)!
    h.ctx.displayTypes.saveExtensions(DT, { ...t2.phExtensions!, reservePrice: 90 } as never)
    expect((await pos(POS_B)).json().reservePrice).toBe(175)
    expect((await pos(POS)).json().reservePrice).toBe(220)
  })

  it('R2 — a reserved slot (held for a named advertiser) is excluded from the open auction', async () => {
    const h = await reservedHarness()
    await h.approvedCrid('crid-r2', day(0))
    hold(h)
    const before = h.bidder.log.bidRequests.filter((r) => (r.body as { dooh?: { id?: string } }).dooh?.id === DT).length
    const out = await runAuction(h.ctx, day(1))
    const p = out.positions.find((x) => x.positionId === POS)!
    expect(p).toMatchObject({ bidRequests: 0, bids: 0, winner: null, skipped: 'Held for a named advertiser: booked by reservation.' })
    expect(h.bidder.log.bidRequests.filter((r) => (r.body as { dooh?: { id?: string } }).dooh?.id === DT).length).toBe(before)
    /* A bid on it is refused: reserve it instead. */
    const id = await h.readyApiCampaign('Swisse — R2')
    const bid = await h.partner.bid(id, day(2), 500)
    expect(bid.statusCode).toBe(409)
    expect(bid.json().error.message).toBe('This position is held for this advertiser: reserve it instead of bidding.')
  })

  it('R3 — a reservation below the reserve price — known gap (OQ52): it clears against the ordinary floor, as described', async () => {
    const h = await reservedHarness()
    hold(h)
    const id = await h.readyApiCampaign('Swisse — R3')
    const reserve = (w: Date, bidCpm: number) => h.partner.bid(id, w, bidCpm, { type: 'reserve' })
    /* Below the ordinary floor: refused, against the floor. */
    const underFloor = await reserve(day(0), 90)
    expect(underFloor.statusCode).toBe(422)
    expect(underFloor.json().error).toMatchObject({ code: 'below_floor', message: '90 is below the effective floor of 100 AUD CPM.' })
    /* Above the floor but below the 220 reserve price: taken (the gap). */
    const underReserve = await reserve(day(0), 150)
    expect(underReserve.statusCode).toBe(201)
    expect(underReserve.json()).toMatchObject({ status: 'reserved', clearingCpm: 150 })
  })

  it('R4 — a type: reserve reservation clears against the ordinary floor, and a reserve-priced open slot stays in the open auction — known gap (OQ52), as described', async () => {
    const h = await reservedHarness()
    await h.approvedCrid('crid-r4', day(0))
    /* The open (rtb) slot with a 220 reserve price: auctioned as usual, cleared at 150 — the reserve price isn't a floor there either. */
    const out = await runAuction(h.ctx, day(1))
    expect(out.positions.find((x) => x.positionId === POS)!.winner).toMatchObject({ clearingCpm: 150 })
    /* Held for Swisse: a reserve at the ordinary floor is booked and handed off at once. */
    hold(h)
    const id = await h.readyApiCampaign('Swisse — R4')
    const res = await h.partner.bid(id, day(2), 100, { type: 'reserve' })
    expect(res.statusCode).toBe(201)
    expect(res.json()).toMatchObject({ status: 'reserved', clearingCpm: 100 })
    expect(h.campaigns.handoffs.filter((b) => b.windowStart === day(2).toISOString())).toMatchObject([{ campaignId: id, displayTypeId: DT }])
  })
})
