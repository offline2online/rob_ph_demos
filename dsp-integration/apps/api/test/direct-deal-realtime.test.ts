/* A Direct advertiser deal against the real-time path and Campaign Approval (E2E pass of 21 Oct 2026 on the
   direct-advertiser train, tickets OMwDvy3OUmY9raBtTf7v and knqu0B2PGTF9PG1EUWYD). Built on the e2e harness;
   nothing reaches the network. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { day, harness } from './e2e/harness'

afterEach(() => {
  vi.unstubAllGlobals()
})

type H = Awaited<ReturnType<typeof harness>>
const DEALS = '/api/admin/v1/buyers-lists'
const iso = (n: number) => day(n).toISOString()

/* Red Bull as a direct advertiser, and a finalised Direct advertiser deal for days 1 to 5 of the fixture's slot at 150 CPM. */
async function redBullDeal(h: H, slot: Record<string, unknown> = {}) {
  expect((await h.app.inject({ method: 'POST', url: '/api/admin/v1/advertisers/direct', payload: { name: 'Red Bull' } })).statusCode).toBe(201)
  const deal = (await h.app.inject({
    method: 'POST', url: DEALS,
    payload: { name: 'Red Bull direct', dealType: 'direct', invitedBuyers: [{ partnerId: 'direct', seatId: 'red-bull' }], activeFrom: iso(1), activeTo: iso(5), floorCpm: 150, status: 'draft' },
  })).json() as { id: string }
  await h.admin.slot({ listMode: 'deal', buyersListId: deal.id, buyersListIds: [deal.id], partnerIds: [], advertisers: [], ...slot })
  expect((await h.app.inject({ method: 'POST', url: `${DEALS}/${deal.id}/share` })).statusCode).toBe(200)
  return deal
}

describe('Direct advertiser deals on the real-time path and in Campaign Approval', () => {
  it('with an Open auction tier below it, the slot is not sold in real time during the flight', async () => {
    const h = await harness()
    /* No Red Bull campaign, so the deal books nothing: an unbooked window must not fall through to the open tier. */
    await redBullDeal(h, { openAuction: true })
    h.setNow(new Date(day(2).getTime() + 60_000))
    expect((await h.signal()).status).toBe('no_fill')
    expect(h.bidder.log.bidRequests).toHaveLength(0)
    /* After the flight the open tier sells as usual. */
    h.setNow(new Date(day(7).getTime() + 60_000))
    expect((await h.signal()).statusCode).toBe(200)
    expect(h.bidder.log.bidRequests.length).toBeGreaterThan(0)
  })

  it('Campaign Approval names a direct advertiser, not its slug', async () => {
    const h = await harness()
    await h.app.inject({ method: 'POST', url: '/api/admin/v1/advertisers/direct', payload: { name: 'Red Bull' } })
    /* The Partner API has no direct token, so the fixture's campaign is re-owned, as in Run 10. */
    const cid = await h.readyApiCampaign('Red Bull — Wings')
    h.ctx.db.prepare("UPDATE campaigns SET advertiser_id = 'red-bull' WHERE id = ?").run(cid)
    const items = (await h.app.inject({ url: '/api/admin/v1/campaigns' })).json().items as { campaignId: string; advertiserName: string | null }[]
    expect(items.find((c) => c.campaignId === cid)?.advertiserName).toBe('Red Bull')
  })
})
