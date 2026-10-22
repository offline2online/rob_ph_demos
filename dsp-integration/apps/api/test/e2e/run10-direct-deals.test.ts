/* Run 10 — Flow 3, advertiser direct, via a Direct advertiser deal (Z1, X1–X5; ticket H8YNT4aXwSqD6gffTkAz, 7/7 of the
   direct-advertiser-via-deals series; Rob's decisions of 22 Oct 2026). A direct advertiser (Red Bull, no DSP) reaches a slot
   only through a Direct advertiser deal: an internal PH deal ID, flight dates and a price. It is never in a slot's Assigned
   to. The exchange reserves the windows and sends no bid request; revenue is recorded and reported, never invoiced.
   Walkthrough for a person: docs/dsp-integration/AWS-DEMO-TEST-FLOW.md section B. Unit-level cases for each ticket:
   direct-deals.test.ts, advertisers.test.ts, clear-direct-slots-migration.test.ts, direct-deal-revenue.test.ts.
   Nothing reaches the network (harness.ts). */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { assertInvitedDeals } from '../../src/domain/advertiserDeals'
import { runAuction } from '../../src/exchange/auction'
import { lineItems, runBilling } from '../../src/exchange/billing'
import { DT, POS, day, harness } from './harness'

afterEach(() => {
  vi.unstubAllGlobals()
})

type H = Awaited<ReturnType<typeof harness>>
const DEALS = '/api/admin/v1/buyers-lists'
const INV = '/api/admin/v1/available-inventory'
const iso = (n: number) => day(n).toISOString()

/* Red Bull as a direct advertiser, and a finalised Direct advertiser deal for days 1 to 5 of the fixture's slot at 150 CPM. */
async function redBullDeal(h: H, extra: Record<string, unknown> = {}) {
  expect((await h.app.inject({ method: 'POST', url: '/api/admin/v1/advertisers/direct', payload: { name: 'Red Bull' } })).statusCode).toBe(201)
  const created = await h.app.inject({
    method: 'POST', url: DEALS,
    payload: { name: 'Red Bull direct', dealType: 'direct', invitedBuyers: [{ partnerId: 'direct', seatId: 'red-bull' }], activeFrom: iso(1), activeTo: iso(5), floorCpm: 150, status: 'draft', ...extra },
  })
  expect(created.statusCode).toBe(201)
  const deal = created.json() as { id: string; dealId: string } & Record<string, unknown>
  /* The slot is sold through the deal alone: no DSP, no advertiser named in Assigned to. */
  await h.admin.slot({ listMode: 'deal', buyersListId: deal.id, buyersListIds: [deal.id], partnerIds: [], advertisers: [] })
  return deal
}
const finalise = (h: H, id: string) => h.app.inject({ method: 'POST', url: `${DEALS}/${id}/share` })

/* An approved, activated campaign belonging to Red Bull (the Partner API has no direct token, so the fixture's is re-owned). */
async function redBullCampaign(h: H, name = 'Red Bull — Wings') {
  const id = await h.readyApiCampaign(name)
  h.ctx.db.prepare("UPDATE campaigns SET advertiser_id = 'red-bull' WHERE id = ?").run(id)
  return id
}

describe('Run 10 — Flow 3: a direct advertiser reaches a slot through a Direct advertiser deal', () => {
  it('Z1 — a direct advertiser is created with no DSP, listed as direct with no seat IDs', async () => {
    const h = await harness()
    expect((await h.app.inject({ method: 'POST', url: '/api/admin/v1/advertisers/direct', payload: { name: 'Red Bull' } })).statusCode).toBe(201)
    const items = (await h.app.inject({ url: '/api/admin/v1/advertisers' })).json().items as { advertiserId: string; direct: boolean; seats?: unknown[] }[]
    const rb = items.find((a) => a.advertiserId === 'red-bull')
    expect(rb).toMatchObject({ direct: true })
    expect(rb?.seats ?? []).toEqual([])
  })

  it('X1a — no advertiser can be put in Assigned to; the refusal points to a Direct advertiser deal', async () => {
    const h = await harness()
    await h.app.inject({ method: 'POST', url: '/api/admin/v1/advertisers/direct', payload: { name: 'Red Bull' } })
    const res = await h.app.inject({ method: 'PUT', url: INV, payload: { items: [{ displayTypeId: DT, slot: 1, floorCpm: null, assignedTo: { partnerIds: [], advertisers: ['Red Bull'], whitelistOnly: false } }] } })
    expect(res.statusCode).toBe(400)
    expect(JSON.stringify(res.json())).toMatch(/Red Bull can't be assigned to a slot directly.*Direct advertiser deal/)
  })

  it('X1b — the deal carries an internal PH deal ID, flight dates and a price; it is one-to-one with the advertiser and has no DSP entries', async () => {
    const h = await harness()
    const deal = await redBullDeal(h)
    const body = deal
    expect(body).toMatchObject({ dealType: 'direct', floorCpm: 150, deals: [], invitedBuyers: [{ partnerId: 'direct', seatId: 'red-bull' }] })
    expect(body.dealId).toMatch(/^PH-[A-Z0-9]{10}$/)
    expect(body.activeFrom).toBe(iso(1))
    expect(body.activeTo).toBe(iso(5))
    /* Price is a fixed CPM or a total for the term, never both; a second buyer is refused. */
    const bad = (extra: Record<string, unknown>) => h.app.inject({ method: 'POST', url: DEALS, payload: { name: 'x', dealType: 'direct', invitedBuyers: [{ partnerId: 'direct', seatId: 'red-bull' }], activeFrom: iso(1), activeTo: iso(2), status: 'draft', ...extra } })
    expect((await bad({ floorCpm: 150, termTotal: 5000 })).statusCode).toBe(400)
    expect((await bad({ floorCpm: 150, invitedBuyers: [{ partnerId: 'direct', seatId: 'red-bull' }, { partnerId: 'p_google', seatId: '884513' }] })).statusCode).toBe(400)
  })

  it('X1c — the finalised deal reserves its windows: no bid request, excluded from open real-time, only its advertiser plays', async () => {
    const h = await harness()
    const deal = await redBullDeal(h)
    expect((await finalise(h, deal.id)).json()).toMatchObject({ status: 'shared', deals: [] })
    const cid = await redBullCampaign(h)
    const out = (await runAuction(h.ctx, day(2))).positions.find((p) => p.positionId === POS)!
    expect(out.bidRequests).toBe(0)
    expect(out.winner).toMatchObject({ advertiserId: 'red-bull' })
    expect(h.bidder.log.bidRequests).toHaveLength(0)
    const rows = await h.rows(day(2))
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ status: 'reserved', partnerId: 'direct', campaignId: cid, clearingCpm: 150 })
    /* The player's open real-time signal does not sell it. */
    expect((await h.signal()).status).not.toBe('filled')
    /* Outside the flight nothing is reserved. */
    expect((await runAuction(h.ctx, day(7))).positions.find((p) => p.positionId === POS)!.winner).toBeNull()
  })

  it('X1d — two reserving deals never overlap on a slot (409, naming the deal, advertiser and dates); disjoint flights are accepted', async () => {
    const h = await harness()
    const deal = await redBullDeal(h)
    await h.app.inject({ method: 'POST', url: '/api/admin/v1/advertisers/direct', payload: { name: 'Gatorade' } })
    const other = async (from: number, to: number) => (await h.app.inject({ method: 'POST', url: DEALS, payload: { name: 'Gatorade direct', dealType: 'direct', invitedBuyers: [{ partnerId: 'direct', seatId: 'gatorade' }], activeFrom: iso(from), activeTo: iso(to), floorCpm: 150, status: 'draft' } })).json()
    const assign = (ids: string[]) => h.app.inject({ method: 'PUT', url: INV, payload: { items: [{ displayTypeId: DT, slot: 1, floorCpm: null, assignedTo: { buyersListIds: ids } }] } })
    const clash = await other(4, 9)
    const refused = await assign([deal.id, clash.id])
    expect(refused.statusCode).toBe(409)
    expect(refused.json().error.message).toMatch(/Red Bull direct.*Red Bull/)
    const clear = await other(6, 9)
    expect((await assign([deal.id, clear.id])).statusCode).toBe(200)
  })

  it('X2 — revenue is recorded per window at the deal rate (partnerId direct) and reported, but never invoiced', async () => {
    const h = await harness()
    const deal = await redBullDeal(h)
    await finalise(h, deal.id)
    const cid = await redBullCampaign(h)
    await runAuction(h.ctx, day(2))
    h.playback.script(cid, day(2), { plays: 2000, playedSec: 30_000 })
    h.setNow(new Date(day(3).getTime() + 60_000))
    const billed = (await runBilling(h.ctx)).filter((i) => i.partnerId === 'direct' && i.windowStart === iso(2))
    expect(billed).toHaveLength(1)
    expect(billed[0]).toMatchObject({ advertiserId: 'red-bull', campaignId: cid, positionId: POS, cpm: 150 })
    expect((await lineItems(h.ctx)).filter((i) => i.partnerId === 'direct' && i.windowStart === iso(2))).toHaveLength(1)
    for (const url of ['/api/admin/v1/invoices', '/api/admin/v1/billing']) expect((await h.app.inject({ url })).statusCode).toBe(404)
    const schedule = (await h.app.inject({ url: `/api/admin/v1/booking-schedule?from=${iso(1).slice(0, 10)}&to=${iso(6).slice(0, 10)}&partnerId=direct` })).json()
    expect(schedule.totals.bookedWindows).toBeGreaterThan(0)
    expect(JSON.stringify(schedule)).toContain('Red Bull (Direct)')
  })

  it('X3 — campaigns carry the advertiser’s own PH deal ID; another advertiser’s ID is refused; a campaign with none still plays', async () => {
    const h = await harness()
    const deal = await redBullDeal(h)
    await finalise(h, deal.id)
    const at = iso(2)
    const listed = (await h.app.inject({ url: `/api/admin/v1/advertisers/red-bull/deals?at=${at}` })).json().items as { dealId: string; dealType: string }[]
    expect(listed.map((d) => d.dealId)).toEqual([deal.dealId])
    expect(listed[0].dealType).toBe('direct')
    await expect(assertInvitedDeals(h.ctx, 'red-bull', 'dealId', [deal.dealId], [], at)).resolves.toBeUndefined()
    await expect(assertInvitedDeals(h.ctx, 'swisse', 'dealId', [deal.dealId], [], at)).rejects.toMatchObject({ status: 400 })
    await redBullCampaign(h)
    expect((await runAuction(h.ctx, day(2))).positions.find((p) => p.positionId === POS)!.winner).toMatchObject({ advertiserId: 'red-bull' })
  })

  it('X4/X5 — the booking is personalised-eligible and handed off with the approved asset version; several campaigns are first-eligible-wins, one per window', async () => {
    const h = await harness()
    const deal = await redBullDeal(h)
    await finalise(h, deal.id)
    const first = await redBullCampaign(h, 'Red Bull — first')
    await redBullCampaign(h, 'Red Bull — second')
    await runAuction(h.ctx, day(2))
    const rows = await h.rows(day(2))
    expect(rows).toHaveLength(1)
    expect(rows[0].campaignId).toBe(first)
    expect(rows[0].handedOffAt).not.toBeNull()
    const bookings = await h.ctx.campaigns.bookings(first)
    expect(bookings.map((b) => b.windowStart)).toEqual([iso(2)])
    expect(bookings[0].personalisedEligible).toBe(true)
    expect(h.campaigns.handoffs.filter((b) => b.windowStart === iso(2))).toHaveLength(1)
    expect(h.campaigns.refusedBookings).toHaveLength(0)
  })
})
