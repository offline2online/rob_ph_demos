/* E2E spec v2.8, Run 3 — category-scoped buyers lists (P12–P14; ticket
   M9aTqeDgGfRZoL3AEw9i). A deal that invites an IAB category invites every
   synced seat the DSP reports in it; same enforcement as named buyers. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { runAuction } from '../../src/exchange/auction'
import { DT, day, harness } from './harness'

afterEach(() => {
  vi.unstubAllGlobals()
})

type Opts = { invitedBuyers?: { partnerId: string; seatId: string }[]; invitedCategories?: string[]; categories?: Record<string, string>; block?: string[] }
async function categoryHarness(o: Opts = {}) {
  const h = await harness()
  const google = (await h.ctx.partners.get('p_google'))!
  const cats = o.categories ?? { '5130001': 'Food & Drink', '5130002': 'Health & Fitness' }
  await h.ctx.partners.update('p_google', { seats: google.seats.map((s) => ({ ...s, category: cats[s.id] })), ...(o.block ? { blockList: o.block } : {}) })
  const list = await h.ctx.buyersLists.insert({
    id: 'bl_cat', name: 'Category deal', description: 'Run 3 P12–P14', invitedBuyers: o.invitedBuyers ?? [], invitedCategories: o.invitedCategories ?? ['Health & Fitness'],
    activeFrom: null, activeTo: null, auctionCloses: null,
  })
  await h.admin.slot({ listMode: 'deal', buyersListId: list.id, partnerIds: [] })
  return { ...h, list }
}

describe('Run 3 — category-scoped buyers lists', () => {
  it('P12 — a seat in the invited category wins; a seat in another category is not_invited', async () => {
    const h = await categoryHarness()
    await h.approvedCrid('crid-p12', day(0))
    expect((await runAuction(h.ctx, day(1))).positions[0].winner).toMatchObject({ advertiserId: 'swisse' })
    expect(h.bidder.log.bidRequests.at(-1)!.body.imp[0].pmp!.deals![0].wseat).toEqual(['5130002'])
    const nestle = await h.readyApiCampaign('Nestlé — P12', 'localised', 'nestle')
    const api = await h.partner.bid(nestle, day(2), 400, { advertiserId: 'nestle' })
    expect(api.statusCode).toBe(422)
    expect(api.json().error).toMatchObject({ code: 'not_invited', message: 'Nestlé is not an invited buyer on this private auction (Category deal).' })
  })

  it('P13 — named advertisers work alongside a category (union)', async () => {
    const h = await categoryHarness({ invitedCategories: ['Beauty'], invitedBuyers: [{ partnerId: 'p_google', seatId: '5130002' }] })
    await h.approvedCrid('crid-p13', day(0))
    expect((await runAuction(h.ctx, day(1))).positions[0].winner).toMatchObject({ advertiserId: 'swisse' })
  })

  it('P13b — the advertiser blacklist still subtracts from the category', async () => {
    const h = await categoryHarness({ block: ['5130002'] })
    await h.bidder.control({ mode: 'bid', priceCpm: 150, advertiserId: '5130002', crid: 'crid-p13b' })
    const out = await runAuction(h.ctx, day(0))
    expect(out.positions[0].winner).toBeNull()
    expect((await h.rows(day(0)))[0]).toMatchObject({ status: 'rejected', advertiserId: 'swisse' })
  })

  it('P14 — a category no seat reports admits nobody; the window falls through', async () => {
    const h = await categoryHarness({ categories: {} })
    expect((await runAuction(h.ctx, day(0))).positions[0]).toMatchObject({ bidRequests: 0, winner: null })
    expect(h.campaigns.handoffs.filter((b) => b.displayTypeId === DT)).toEqual([])
  })
})
