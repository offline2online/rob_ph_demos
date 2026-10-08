/* Guaranteed deal path (Rob, 7 Oct 2026) beside the reserve-price booking (open questions 45 and 52, decided by Rob
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
import { guaranteedImpressions } from '../src/domain/guarantee'
import { dspDealTerms } from '../src/dsp/dealTerms'
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

async function setup(slot: Partial<Slot> = {}, dealType: 'private_auction' | 'guaranteed' = 'private_auction') {
  let now = NOW
  const ctx = await testContext({ byWindow: true, clock: () => now })
  /* On a position under a buyers list the list's deal type is authoritative: a guaranteed reserve needs a guaranteed list. */
  if (dealType === 'guaranteed') {
    const open = (await ctx.buyersLists.get('bl_test_open'))!
    await ctx.buyersLists.update(open.id, { name: open.name, description: '', dealType: 'guaranteed', invitedBuyers: open.invitedBuyers, activeFrom: null, activeTo: null, auctionCloses: null })
  }
  const app = buildApp(ctx)
  /* Portrait: one advertiser slot, reserve price 150 CPM (floor 100). */
  const ext = (await ctx.displayTypes.get('portrait'))!.phExtensions!
  await ctx.displayTypes.saveExtensions('portrait', {
    ...ext,
    slots: [{ label: 'Ad', owner: 'advertiser', partnerIds: [], advertisers: [], listMode: 'deal', buyersListId: 'bl_test_open', storeScope: null, quota: null, zoneId: null, reservePrice: 150, ...slot } as Slot],
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


const settings = async (app: Awaited<ReturnType<typeof setup>>['app'], guaranteeBufferPct?: number) => {
  const cur = (await app.inject({ url: '/api/admin/v1/advertiser-settings' })).json()
  const input = cur
  return app.inject({ method: 'PUT', url: '/api/admin/v1/advertiser-settings', payload: guaranteeBufferPct === undefined ? input : { ...input, guaranteeBufferPct } })
}

describe('guaranteed deal path: forecast (plays x VAC-d) less the contingency buffer', () => {
  it('defaults the buffer to 10% and commits 90% of the 800 forecast', async () => {
    const { app, post, RESERVE, rows } = await setup({}, 'guaranteed')
    expect((await app.inject({ url: '/api/admin/v1/advertiser-settings' })).json().guaranteeBufferPct).toBe(10)
    const res = await post({ ...RESERVE, dealType: 'guaranteed' })
    expect(res.statusCode).toBe(201)
    expectMatchesContract('POST', '/v1/reservations', 201, res.json())
    expect(res.json()).toMatchObject({ status: 'reserved', dealType: 'guaranteed', forecastImpressions: 800, guaranteedImpressions: 720, clearingCpm: 150 })
    /* Sent to the DSP as the guaranteed unit count. */
    expect(res.json().dspDeal).toEqual({ dealType: 'guaranteed', dspDealKind: 'programmatic_guaranteed', unitCount: 720, unit: 'impressions' })
    expect((await rows())[0]).toMatchObject({ dealType: 'guaranteed', forecastImpressions: 800, guaranteedImpressions: 720 })
  })

  it('changing the buffer in Advertiser settings changes the committed figure', async () => {
    const { app, post, RESERVE } = await setup({}, 'guaranteed')
    expect((await settings(app, 25)).json().guaranteeBufferPct).toBe(25)
    const res = await post({ ...RESERVE, dealType: 'guaranteed' })
    expect(res.json()).toMatchObject({ forecastImpressions: 800, guaranteedImpressions: 600 })
    /* Saving without the field keeps it. */
    expect((await settings(app)).json().guaranteeBufferPct).toBe(25)
  })

  it('refuses a buffer outside 0-50', async () => {
    const { app } = await setup()
    expect((await settings(app, 80)).statusCode).toBe(400)
    expect((await settings(app, -1)).statusCode).toBe(400)
    expect((await settings(app, 0)).statusCode).toBe(200)
  })

  it('leaves the no-guarantee reserve (preferred deal) unchanged: no volume', async () => {
    const { post, RESERVE, rows } = await setup()
    const res = await post(RESERVE)
    expect(res.statusCode).toBe(201)
    expect(res.json()).toMatchObject({ status: 'reserved', dealType: 'preferred', forecastImpressions: null, guaranteedImpressions: null, clearingCpm: 150 })
    expect(res.json().dspDeal).toEqual({ dealType: 'preferred', dspDealKind: 'preferred_deal', unitCount: null, unit: null })
    expect((await rows())[0]).toMatchObject({ dealType: 'preferred', guaranteedImpressions: null })
  })

  it('refuses guaranteed on a bid, and maps Amazon to its guaranteed deal', async () => {
    const { post, RESERVE, NESTLE_BID } = await setup()
    expect((await post({ ...NESTLE_BID, dealType: 'guaranteed' })).statusCode).toBe(400)
    expect((await post({ ...RESERVE, dealType: 'sometimes' })).statusCode).toBe(400)
    expect(dspDealTerms('amazon_dsp', 'guaranteed', 720)).toEqual({ dealType: 'guaranteed', dspDealKind: 'guaranteed_deal', unitCount: 720, unit: 'impressions' })
    expect(guaranteedImpressions(999, 10)).toBe(899)
  })
})
