/* E2E spec v2 (board doc f34VQZCy2kkWJfBP6Iwp), Run 5 — reserved.
   Fixture: the platform floor of 100 CPM on every slot, overridden to 220
   (a slot floor) on the fixture's slot; a second display type follows the
   platform floor. The reserve price was removed on 17 Oct 2026 (ticket
   EEm4tA5fSB6RKlEjNhVu): R1 follows the slot floor's inheritance; R3/R4
   follow the reservation flow for a held or deal position (open questions
   45 and 52): a `type: reserve` commitment is booked at the rate the buyer
   agrees, which must clear the resolved floor (platform, slot, DSP, buyers
   list), and takes that window out of the open auction. */
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
  await h.admin.slot({ floorCpm: 220 })
  return h
}
const hold = (h: Awaited<ReturnType<typeof harness>>) => h.admin.slot({ listMode: null, advertisers: ['Swisse'], partnerIds: ['p_google'] })

describe('Run 5 — reserved', () => {
  it('R1 — a slot’s own floor always wins over the inherited platform floor', async () => {
    const h = await reservedHarness()
    const pos = (id: string) => h.app.inject({ method: 'GET', url: `/api/v1/inventory/${id}`, headers: GOOGLE })
    expect((await pos(POS)).json().pricing.effectiveFloorCpm).toEqual({ localised: 220 })
    expect((await pos(POS_B)).json().pricing.effectiveFloorCpm).toEqual({ localised: 100 })
    expect((await pos(POS)).json()).not.toHaveProperty('reservePrice')
    const rows = (await h.app.inject({ method: 'GET', url: '/api/admin/v1/available-inventory' })).json().items as { displayTypeId: string; floorCpm: number; floorCpmOverride: number | null; platformFloorCpm: number }[]
    expect(rows.find((r) => r.displayTypeId === DT)).toMatchObject({ floorCpm: 220, floorCpmOverride: 220, platformFloorCpm: 100 })
    expect(rows.find((r) => r.displayTypeId === DT_B)).toMatchObject({ floorCpm: 100, floorCpmOverride: null, platformFloorCpm: 100 })
    /* A new platform floor reaches the slot that follows it, never the overridden one. */
    await h.ctx.company.save({ ...(await h.ctx.company.get()), floorCpm: 130 })
    expect((await pos(POS_B)).json().pricing.effectiveFloorCpm).toEqual({ localised: 130 })
    expect((await pos(POS)).json().pricing.effectiveFloorCpm).toEqual({ localised: 220 })
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

  it('R3 — a reservation below the slot floor is refused; one at or above it is booked at the agreed rate', async () => {
    const h = await reservedHarness()
    const id = await h.readyApiCampaign('Swisse — R3')
    const reserve = (w: Date, bidCpm: number) => h.partner.bid(id, w, bidCpm, { type: 'reserve' })
    /* Below the 220 slot floor (though above the platform floor): refused. */
    const underFloor = await reserve(day(0), 150)
    expect(underFloor.statusCode).toBe(422)
    expect(underFloor.json().error).toMatchObject({ code: 'below_floor', message: '150 is below the effective floor of 220 USD CPM.' })
    /* At or above it: booked at the agreed rate. */
    const over = await reserve(day(0), 250)
    expect(over.statusCode).toBe(201)
    expect(over.json()).toMatchObject({ status: 'reserved', clearingCpm: 250 })
    /* Clearing the slot floor returns it to the platform floor: 150 now clears. */
    await h.admin.setFloorCpm(null)
    expect((await reserve(day(1), 150)).statusCode).toBe(201)
  })

  it('R4 — a reservation takes its window out of the open auction; a window nobody committed to is auctioned as usual', async () => {
    const h = await reservedHarness()
    await h.admin.setFloorCpm(null)
    await h.approvedCrid('crid-r4', day(0))
    /* No commitment: auctioned as usual, cleared at the bid (150). */
    const open = await runAuction(h.ctx, day(1))
    expect(open.positions.find((x) => x.positionId === POS)!.winner).toMatchObject({ clearingCpm: 150 })
    /* Committed: booked and handed off at once, at the agreed 220. */
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
