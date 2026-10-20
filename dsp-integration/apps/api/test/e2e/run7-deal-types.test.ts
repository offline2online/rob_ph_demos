/* E2E spec v2 (board doc f34VQZCy2kkWJfBP6Iwp), Run 7 — every deal type end to
   end (ticket rFN7TfIXtValP5hfIq1o, 7 Oct 2026). Each way a slot transacts is
   driven setup → inventory → campaign/approval → bid or reserve → auction →
   hand-off booking → billing, once per type, with the buyers list's
   `dealType` as the single source for what is captured and what the DSP deal
   carries (REQUIREMENTS §5 "Private auctions", "Guaranteed
   deal path", "Deal type on the buyers list").

     D1 — open RTB (open auction, no buyers list)
     D2 — private auction (PMP / buyers list)
     D3 — preferred deal (reserve, no committed volume)
     D4 — programmatic guaranteed (reserve with committed volume; D4.6 is the
          AWS demo's 24-hour booking)
     D5 — Computer Vision gender targeting on a deal (guaranteed, with lighter
          preferred and private-auction variants); never the open real-time slot

   Fixture: the harness's one Advertiser slot (floor 100, assumed views 800 per
   window, two displays, a one-slot rotation). Agreed rate 150 where the
   type reserves. The guarantee buffer is Advertiser settings' default, 10%.
   Per-DSP guaranteed-deal field names (DV360 Programmatic Guaranteed, Amazon
   guaranteed deal) are the mapping in src/dsp/dealTerms.ts and are still to be
   confirmed against each DSP's own sandbox — the mocks here only prove the
   mapping is carried, not that a DSP accepts it. */
import type { BuyersListDealType } from '@ph-dsp/types'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { png } from '../media'
import { checkTargeting } from '../../src/exchange/enforcement'
import { findPosition } from '../../src/domain/positions'
import { guaranteedImpressions } from '../../src/domain/guarantee'
import { dspDealTerms } from '../../src/dsp/dealTerms'
import { runAuction } from '../../src/exchange/auction'
import { runBilling } from '../../src/exchange/billing'
import { ASSUMED_VIEWS, DT, GOOGLE, POS, day, harness, response, swisseBid } from './harness'

afterEach(() => {
  vi.unstubAllGlobals()
})

type H = Awaited<ReturnType<typeof harness>>
const FLOOR = 100
const RESERVE = 150
const BUFFER_PCT = 10
const COMMITTED = guaranteedImpressions(ASSUMED_VIEWS, BUFFER_PCT)
/* Two displays × a day × a one-slot rotation. */
const EXPECTED_SEC = 2 * 86_400
const booked = (h: H, w: Date) => h.campaigns.handoffs.filter((b) => b.windowStart === w.toISOString() && b.displayTypeId === DT)
const anyBooked = (h: H) => h.campaigns.handoffs.filter((b) => b.displayTypeId === DT)
const rowsOf = async (h: H, w: Date) => (await h.rows(w)).filter((r) => !r.testMode)

/* A buyers-list deal of one type on the fixture's slot, inviting Swisse on Google's seat. */
async function dealHarness(dealType: BuyersListDealType, extra: Record<string, unknown> = {}) {
  const h = await harness()
  const list = await h.ctx.buyersLists.insert({
    id: `bl_${dealType}`, name: `E2E ${dealType}`, description: 'Run 7 fixture', dealType, invitedBuyers: [{ partnerId: 'p_google', seatId: '5130002' }],
    activeFrom: null, activeTo: null, auctionCloses: null, committedPlays: dealType === 'guaranteed' ? 900 : null, ...extra,
  } as never)
  await h.admin.slot({ listMode: 'deal', buyersListId: list.id, partnerIds: [] })
  return { ...h, list }
}
const reserve = (h: H, id: string, w: Date, extra: Record<string, unknown> = {}, headers = GOOGLE) =>
  h.partner.bid(id, w, RESERVE, { type: 'reserve', ...extra }, headers)
/* The sold window played in full, then billed once it is over. */
const bill = async (h: H, campaignId: string, w: Date, plays: { plays: number; playedSec: number }) => {
  h.playback.script(campaignId, w, plays)
  h.setNow(new Date(w.getTime() + 86_400_000 + 60_000))
  return (await runBilling(h.ctx)).filter((i) => i.windowStart === w.toISOString())
}

describe('Run 7 — D1 open deal: per-window auction, first price, no volume', () => {
  /* The open auction by window is gone (8 Oct 2026): an open slot is sold per play (D1.5). The fixture's slot sits on one perpetual open deal, which clears a fresh first-price auction every window, as a buyers list with no auctionCloses always has. */
  it('D1.1 — set up → approve → bid above the floor wins at its own price, is handed off and billed on realised VAC-d', async () => {
    const h = await harness()
    expect((await h.ctx.buyersLists.list()).length, 'one perpetual open deal').toBe(1)
    const campaignId = await h.approvedCrid('crid-d1', day(0))
    const out = await runAuction(h.ctx, day(1))
    expect(out.positions[0]).toMatchObject({ bidRequests: 1, winner: { advertiserId: 'swisse', clearingCpm: 150 } })
    /* No auctionCloses: nothing is locked or carried beyond this window. */
    expect((await h.ctx.buyersLists.get('bl_e2e_open'))!.lockedWin).toBeNull()
    expect(await rowsOf(h, day(1))).toMatchObject([{ campaignId, status: 'won', clearingCpm: 150, dealType: 'preferred', guaranteedImpressions: null }])
    expect(booked(h, day(1))).toMatchObject([{ campaignId, displayTypeId: DT, slot: 1 }])
    expect(booked(h, day(2))).toEqual([])
    /* Billed on what played (half the expected time), at the cleared price — no make-good. */
    const [item, ...rest] = await bill(h, campaignId, day(1), { plays: 2880, playedSec: EXPECTED_SEC / 2 })
    expect(rest).toEqual([])
    expect(item).toMatchObject({ campaignId, cpm: 150, assumedViews: ASSUMED_VIEWS, realisedViews: ASSUMED_VIEWS / 2, amount: 60 })
  })

  it('D1.2 — a bid below the effective floor falls through to the default; nothing is booked or billed', async () => {
    const h = await harness()
    await h.approvedCrid('crid-d1-low', day(0))
    h.bidder.setScript((req) => ({ body: response(req, [swisseBid(req, { price: FLOOR - 1, crid: 'crid-d1-low' })]) }))
    expect((await runAuction(h.ctx, day(1))).positions[0].winner).toBeNull()
    expect((await rowsOf(h, day(1)))[0]).toMatchObject({ status: 'rejected', reason: `${FLOOR - 1} is below the effective floor of ${FLOOR} USD CPM.` })
    expect(booked(h, day(1))).toEqual([])
    h.setNow(new Date(day(2).getTime() + 60_000))
    expect(await runBilling(h.ctx)).toEqual([])
  })

  it('D1.3 — the highest of several bids clears at its own price (first price)', async () => {
    const h = await harness()
    await h.approvedCrid('crid-d1-multi', day(0))
    const rival = await h.readyApiCampaign('Swisse — D1.3 rival')
    expect((await h.partner.bid(rival, day(1), 260)).statusCode).toBe(201)
    expect((await runAuction(h.ctx, day(1))).positions[0].winner).toMatchObject({ clearingCpm: 260 })
    expect(booked(h, day(1))).toMatchObject([{ campaignId: rival }])
    expect((await rowsOf(h, day(1))).find((r) => r.campaignId !== rival)).toMatchObject({ status: 'lost' })
  })

  it('D1.4 — an open window cannot be reserved as a deal (the open auction holds no block of plays)', async () => {
    const h = await harness()
    const id = await h.readyApiCampaign('Swisse — D1.4')
    /* Off its deal and not held, the slot is open real time: no window is reserved at any price (the reserve price is gone, 17 Oct 2026). */
    await h.admin.slot({ listMode: 'rtb', buyersListId: null, buyersListIds: [] })
    const res = await reserve(h, id, day(1))
    expect(res.statusCode).toBe(409)
    /* A guaranteed deal type cannot ride on a bid either. */
    expect((await h.partner.bid(id, day(1), 200, { dealType: 'guaranteed' })).statusCode).toBe(400)
    expect(anyBooked(h)).toEqual([])
  })

  it('D1.5 — real-time per impression: the player signals, the request is cut to the impression, a bid above the floor fills it first price, proof of play is logged', async () => {
    const h = await harness()
    /* The creative has to be known and approved before it can fill inside tmax: one deal auction introduces it. Then the slot goes open, which is real time. */
    const campaignId = await h.approvedCrid('crid-d1-rt', day(0))
    await h.admin.slot({ listMode: 'rtb', buyersListId: null })
    const PLAYER = { authorization: 'Bearer poc-token-player' }
    const signal = await h.app.inject({ method: 'POST', url: '/api/player/v1/impressions', headers: PLAYER, payload: { displayId: `d_${DT}_1`, slot: 1 } })
    expect(signal.statusCode).toBe(200)
    const fill = signal.json()
    expect(fill).toMatchObject({ status: 'filled', clearingCpm: 150, creative: { campaignId } })
    expect(h.bidder.log.bidRequests.at(-1)!.body).toMatchObject({ imp: [{ ext: { ph: { mode: 'realtime' } } }] })
    expect(h.bidder.log.bidRequests.at(-1)!.body.imp[0].pmp).toBeUndefined()
    const played = await h.app.inject({ method: 'POST', url: `/api/player/v1/impressions/${fill.impressionId}/played`, headers: PLAYER, payload: { durationSec: 15 } })
    expect(played.json().status).toBe('played')
  })
})

describe('Run 7 — D2 private auction: invited buyers, deal ID, a first-price bid per slot', () => {
  it('D2.1 — deal type drives the fields: no auction window, no committed plays', async () => {
    const h = await dealHarness('private_auction')
    const put = (payload: Record<string, unknown>) => h.app.inject({ method: 'POST', url: '/api/admin/v1/buyers-lists', payload: { name: 'D2.1', invitedBuyers: [{ partnerId: 'p_google', seatId: '5130002' }], ...payload } })
    expect((await put({ dealType: 'private_auction' })).json()).toMatchObject({ dealType: 'private_auction', committedPlays: null, auctionCloses: null, effectiveCommittedPlays: { source: 'none' } })
    /* The auction window is retired (16 Oct 2026): invited buyers bid per slot throughout the flight. */
    const window = await put({ dealType: 'private_auction', auctionCloses: day(1).toISOString() })
    expect(window.statusCode).toBe(400)
    expect(window.json().error.details).toEqual([{ field: 'auctionCloses', reason: expect.stringContaining('no longer have an auction window') }])
    const bad = await put({ dealType: 'private_auction', committedPlays: 500 })
    expect(bad.statusCode).toBe(400)
    expect(bad.json().error.details).toEqual([{ field: 'committedPlays', reason: expect.stringContaining('Only a guaranteed deal') }])
  })

  it('D2.2 — invited buyer: approve → bid carrying the deal ID wins, is handed off and billed at the cleared rate', async () => {
    const h = await dealHarness('private_auction')
    const campaignId = await h.approvedCrid('crid-d2', day(0))
    expect((await runAuction(h.ctx, day(1))).positions[0].winner).toMatchObject({ advertiserId: 'swisse', clearingCpm: 150 })
    /* The buyers list is the single source of the DSP deal: the request's deal is built from it. */
    expect(h.bidder.log.bidRequests.at(-1)!.body.imp[0].pmp).toMatchObject({ private_auction: 1, deals: [{ id: h.list.dealId, wseat: ['5130002'] }] })
    expect(booked(h, day(1))).toMatchObject([{ campaignId, displayTypeId: DT }])
    const [item] = await bill(h, campaignId, day(1), { plays: 5760, playedSec: EXPECTED_SEC })
    expect(item).toMatchObject({ cpm: 150, realisedViews: ASSUMED_VIEWS, amount: 120 })
  })

  it('D2.3 — an uninvited buyer, a bid without the deal ID and one below the floor are all refused', async () => {
    const h = await dealHarness('private_auction')
    await h.approvedCrid('crid-d2-3', day(0))
    const nestle = await h.readyApiCampaign('Nestlé — D2.3', 'localised', 'nestle')
    const api = await h.partner.bid(nestle, day(1), 400, { advertiserId: 'nestle' })
    expect(api.statusCode).toBe(422)
    expect(api.json().error.code).toBe('not_invited')
    h.bidder.setScript((req) => ({ body: response(req, [{ ...swisseBid(req, { price: 150, crid: 'crid-d2-3' }), dealid: 'PH-other' }]) }))
    await runAuction(h.ctx, day(2))
    expect((await rowsOf(h, day(2)))[0]).toMatchObject({ status: 'rejected', reason: expect.stringContaining(`requires ${h.list.dealId}`) })
    h.bidder.setScript((req) => ({ body: response(req, [swisseBid(req, { price: FLOOR - 1, crid: 'crid-d2-3' })]) }))
    await runAuction(h.ctx, day(3))
    expect((await rowsOf(h, day(3)))[0]).toMatchObject({ status: 'rejected', reason: `${FLOOR - 1} is below the effective floor of ${FLOOR} USD CPM.` })
    expect([day(1), day(2), day(3)].flatMap((w) => booked(h, w))).toEqual([])
  })

  it('D2.4 — per-slot bidding: two invited buyers clear on successive slots, each at its own first price; no rate lock is written; a slot with no bid falls through', async () => {
    const h = await dealHarness('private_auction', { invitedBuyers: [{ partnerId: 'p_google', seatId: '5130002' }, { partnerId: 'p_google', seatId: '5130001' }], activeTo: '2026-09-27T23:59:59.000Z' })
    await h.bidder.control({ mode: 'no_bid' })
    const swisse = await h.readyApiCampaign('Swisse — D2.4')
    const nestle = await h.readyApiCampaign('Nestlé — D2.4', 'localised', 'nestle')
    expect((await h.partner.bid(swisse, day(1), 210)).statusCode).toBe(201)
    expect((await h.partner.bid(nestle, day(2), 180, { advertiserId: 'nestle' })).statusCode).toBe(201)
    expect((await runAuction(h.ctx, day(1))).positions[0].winner).toMatchObject({ advertiserId: 'swisse', clearingCpm: 210 })
    expect((await runAuction(h.ctx, day(2))).positions[0].winner).toMatchObject({ advertiserId: 'nestle', clearingCpm: 180 })
    /* Nothing is held between slots: no lock, and a slot nobody bid on is not sold. */
    expect((await h.ctx.buyersLists.get(h.list.id))!.lockedWin).toBeNull()
    expect((await runAuction(h.ctx, day(3))).positions[0].winner).toBeNull()
    expect(booked(h, day(3))).toEqual([])
    /* Bidding stays open on later slots of the flight; a window past it is outside the deal. */
    expect((await h.partner.bid(swisse, day(4), 200)).statusCode).toBe(201)
    expect((await h.partner.bid(swisse, day(7), 300)).statusCode).toBeGreaterThanOrEqual(400)
    /* Each window billed on its own realised VAC-d at its own cleared rate. */
    h.playback.script(swisse, day(1), { plays: 2880, playedSec: EXPECTED_SEC / 2 })
    h.setNow(new Date(day(5).getTime()))
    const items = (await runBilling(h.ctx)).filter((i) => i.windowStart === day(1).toISOString())
    expect(items).toMatchObject([{ cpm: 210, realisedViews: ASSUMED_VIEWS / 2, amount: 84 }])
  })
})

describe('Run 7 — D3 preferred deal: one named buyer, fixed CPM, first look per slot, no committed volume', () => {
  it('D3.1 — deal type drives the fields: no committed plays, no auction window; the list reports no effective volume', async () => {
    const h = await dealHarness('preferred')
    expect(h.list).toMatchObject({ dealType: 'preferred', committedPlays: null, auctionCloses: null })
    const list = (await h.app.inject({ method: 'GET', url: '/api/admin/v1/buyers-lists' })).json().items.find((l: { id: string }) => l.id === h.list.id)
    expect(list).toMatchObject({ dealType: 'preferred', effectiveCommittedPlays: { min: null, max: null, source: 'none' } })
    for (const payload of [{ committedPlays: 100 }, { auctionCloses: day(1).toISOString() }]) {
      const res = await h.app.inject({ method: 'POST', url: '/api/admin/v1/buyers-lists', payload: { name: 'D3.1', dealType: 'preferred', invitedBuyers: [{ partnerId: 'p_google', seatId: '5130002' }], ...payload } })
      expect(res.statusCode).toBe(400)
    }
  })

  it('D3.2 — approve → reserve at the agreed rate: held outside the auction, committed plays NOT captured, handed off, billed realised VAC-d at that rate', async () => {
    const h = await dealHarness('preferred')
    const campaignId = await h.readyApiCampaign('Swisse — D3.2')
    const res = await reserve(h, campaignId, day(1))
    expect(res.statusCode).toBe(201)
    expect(res.json()).toMatchObject({ status: 'reserved', dealType: 'preferred', clearingCpm: RESERVE, forecastImpressions: null, guaranteedImpressions: null })
    /* What the DSP is told: a preferred deal with no unit count. */
    expect(res.json().dspDeal).toEqual({ dealType: 'preferred', dspDealKind: 'preferred_deal', unitCount: null, unit: null })
    expect(await rowsOf(h, day(1))).toMatchObject([{ type: 'reserve', status: 'reserved', dealType: 'preferred', guaranteedImpressions: null }])
    expect(booked(h, day(1))).toMatchObject([{ campaignId, displayTypeId: DT, slot: 1 }])
    /* The auction never opens the window. */
    const before = h.bidder.log.bidRequests.length
    expect((await runAuction(h.ctx, day(1))).positions[0]).toMatchObject({ bidRequests: 0, winner: null })
    expect(h.bidder.log.bidRequests.length).toBe(before)
    /* A quarter of the time played: billed on that, at the agreed rate; the shortfall is not made good. */
    const [item] = await bill(h, campaignId, day(1), { plays: 1440, playedSec: EXPECTED_SEC / 4 })
    expect(item).toMatchObject({ cpm: RESERVE, realisedViews: ASSUMED_VIEWS / 4, amount: 30 })
    expect(await runBilling(h.ctx)).toEqual([])
  })

  it('D3.4 — first look at the fixed CPM: the buyer takes a slot at the fixed CPM (not its bid); on a pass the slot is unsold; nothing is reserved', async () => {
    const h = await dealHarness('preferred', { floorCpm: 140, activeTo: '2026-09-27T23:59:59.000Z' })
    await h.bidder.control({ mode: 'no_bid' })
    const campaignId = await h.readyApiCampaign('Swisse — D3.4')
    expect((await h.partner.bid(campaignId, day(1), 210)).statusCode).toBe(201)
    const taken = await runAuction(h.ctx, day(1))
    expect(taken.positions[0].winner).toMatchObject({ advertiserId: 'swisse', clearingCpm: 140 })
    expect(await rowsOf(h, day(1))).toMatchObject([{ status: 'won', bidCpm: 210, clearingCpm: 140 }])
    /* A pass: no bid for day 2, so the slot goes unsold, and no window was held for it in advance. */
    expect(await rowsOf(h, day(2))).toEqual([])
    expect((await runAuction(h.ctx, day(2))).positions[0].winner).toBeNull()
    expect((await h.ctx.buyersLists.get(h.list.id))!.lockedWin).toBeNull()
  })

  it('D3.3 — the list is authoritative: a reservation naming guaranteed is refused (409); a bid or one under the floor is refused', async () => {
    const h = await dealHarness('preferred')
    const id = await h.readyApiCampaign('Swisse — D3.3')
    const clash = await reserve(h, id, day(1), { dealType: 'guaranteed' })
    expect(clash.statusCode).toBe(409)
    expect(clash.json().error.message).toContain('its buyers list sets the deal type')
    expect((await h.partner.bid(id, day(1), RESERVE - 60, { type: 'reserve' })).statusCode).toBe(422)
    expect(anyBooked(h)).toEqual([])
  })
})

describe('Run 7 — D4 programmatic guaranteed: reserve with committed volume', () => {
  it('D4.1 — deal type drives the fields: committed plays captured and reported, no auction window', async () => {
    const h = await dealHarness('guaranteed')
    expect(h.list).toMatchObject({ dealType: 'guaranteed', committedPlays: 900 })
    const list = (await h.app.inject({ method: 'GET', url: '/api/admin/v1/buyers-lists' })).json().items.find((l: { id: string }) => l.id === h.list.id)
    expect(list.effectiveCommittedPlays).toMatchObject({ min: expect.anything() })
    const bad = await h.app.inject({ method: 'POST', url: '/api/admin/v1/buyers-lists', payload: { name: 'D4.1', dealType: 'guaranteed', committedPlays: 900, auctionCloses: day(1).toISOString(), invitedBuyers: [{ partnerId: 'p_google', seatId: '5130002' }] } })
    expect(bad.statusCode).toBe(400)
  })

  it('D4.2 — approve → reserve: committed volume = floor(forecast × (1 − buffer%)), carried to DV360 as Programmatic Guaranteed, billed realised VAC-d (no make-good)', async () => {
    const h = await dealHarness('guaranteed')
    expect((await h.app.inject({ url: '/api/admin/v1/advertiser-settings' })).json().guaranteeBufferPct).toBe(BUFFER_PCT)
    const campaignId = await h.readyApiCampaign('Swisse — D4.2')
    const res = await reserve(h, campaignId, day(1))
    expect(res.statusCode).toBe(201)
    expect(COMMITTED).toBe(Math.floor(ASSUMED_VIEWS * (1 - BUFFER_PCT / 100)))
    expect(res.json()).toMatchObject({ status: 'reserved', dealType: 'guaranteed', clearingCpm: RESERVE, forecastImpressions: ASSUMED_VIEWS, guaranteedImpressions: COMMITTED })
    expect(res.json().dspDeal).toEqual({ dealType: 'guaranteed', dspDealKind: 'programmatic_guaranteed', unitCount: COMMITTED, unit: 'impressions' })
    expect(await rowsOf(h, day(1))).toMatchObject([{ type: 'reserve', dealType: 'guaranteed', forecastImpressions: ASSUMED_VIEWS, guaranteedImpressions: COMMITTED }])
    expect(booked(h, day(1))).toMatchObject([{ campaignId }])
    expect((await runAuction(h.ctx, day(1))).positions[0]).toMatchObject({ bidRequests: 0, winner: null })
    /* Only 600 of the 720 committed impressions' worth plays: billed on the realised 600 at the agreed rate, nothing made good. */
    const [item] = await bill(h, campaignId, day(1), { plays: 4320, playedSec: EXPECTED_SEC * 0.75 })
    expect(item).toMatchObject({ cpm: RESERVE, realisedViews: ASSUMED_VIEWS * 0.75, amount: 90 })
    expect(await runBilling(h.ctx)).toEqual([])
  })

  it('D4.3 — the buffer is the retailer’s: changing it in Advertiser settings changes the next booking’s commitment', async () => {
    const h = await dealHarness('guaranteed')
    const cur = (await h.app.inject({ url: '/api/admin/v1/advertiser-settings' })).json()
    const input = cur
    expect((await h.app.inject({ method: 'PUT', url: '/api/admin/v1/advertiser-settings', payload: { ...input, guaranteeBufferPct: 25 } })).statusCode).toBe(200)
    const id = await h.readyApiCampaign('Swisse — D4.3')
    expect((await reserve(h, id, day(1))).json()).toMatchObject({ forecastImpressions: ASSUMED_VIEWS, guaranteedImpressions: guaranteedImpressions(ASSUMED_VIEWS, 25) })
  })

  it('D4.4 — the same figure goes to each DSP in its own deal shape: DV360 Programmatic Guaranteed, Amazon guaranteed deal (field names to confirm in each sandbox)', () => {
    expect(dspDealTerms('google_dv360', 'guaranteed', COMMITTED)).toEqual({ dealType: 'guaranteed', dspDealKind: 'programmatic_guaranteed', unitCount: COMMITTED, unit: 'impressions' })
    expect(dspDealTerms('amazon_dsp', 'guaranteed', COMMITTED)).toEqual({ dealType: 'guaranteed', dspDealKind: 'guaranteed_deal', unitCount: COMMITTED, unit: 'impressions' })
  })

  it('D4.5 — a window already reserved cannot be sold again, to a bid or a second reservation', async () => {
    const h = await dealHarness('guaranteed')
    const id = await h.readyApiCampaign('Swisse — D4.5')
    expect((await reserve(h, id, day(1))).statusCode).toBe(201)
    const second = await reserve(h, id, day(1))
    expect(second.statusCode).toBe(409)
    expect(h.campaigns.handoffs.filter((b) => b.windowStart === day(1).toISOString())).toHaveLength(1)
    expect(h.campaigns.refusedBookings).toEqual([])
  })

  /* AWS demo path 2 (ticket sGXWYJjMiQAlzXrhwQ8y, 20 Oct 2026): one slot, one advertiser, one full day at a fixed CPM with a guaranteed impression count. Playing the creative for the 24 hours is PH Core's; this asserts what the exchange owns — the booking, its window, the price, the guarantee and the bill. */
  it('D4.6 — 24-hour PG: one slot booked for exactly 24 h at a fixed CPM with guaranteed impressions, billed once for the full day', async () => {
    const h = await dealHarness('guaranteed')
    const campaignId = await h.readyApiCampaign('Swisse — D4.6')
    const res = await reserve(h, campaignId, day(1))
    expect(res.statusCode).toBe(201)
    expect(res.json()).toMatchObject({ status: 'reserved', dealType: 'guaranteed', clearingCpm: RESERVE, guaranteedImpressions: COMMITTED })
    const [b] = booked(h, day(1))
    expect(b).toMatchObject({ campaignId, windowStart: day(1).toISOString(), windowEnd: day(2).toISOString() })
    expect(new Date(b.windowEnd).getTime() - new Date(b.windowStart).getTime()).toBe(86_400_000)
    /* No auction runs on a reserved window: the slot is the advertiser's for the full day. */
    expect((await runAuction(h.ctx, day(1))).positions[0]).toMatchObject({ bidRequests: 0, winner: null })
    /* The full day plays: billed once, at the fixed CPM, on the realised views. */
    const items = await bill(h, campaignId, day(1), { plays: 5760, playedSec: EXPECTED_SEC })
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ cpm: RESERVE, realisedViews: ASSUMED_VIEWS, amount: 120 })
    expect(await runBilling(h.ctx)).toEqual([])
    /* Reserving that day does not take the slot off the market for the next one. */
    expect(booked(h, day(2))).toEqual([])
  })
})

/* D5 — a premium paid to target a gender through Computer Vision (variable
   store.cv_gender), on webcam (Vision/AI) screens (ticket U8jqGDjvUjs8C4rkXG2E,
   8 Oct 2026; needs IYNdMlPtQ7rhplRwbK0q: personalised targeting on every deal
   type, never the open real-time slot). Committed volume comes from the
   gendered subset of the slot's VAC-d (AudienceSource.targetedShare), not the
   whole slot. The POC share is a fixed fraction per AND group of rules; PH
   Core supplies the measured detection rate. */
const MALE = [[{ source: 'store', variable: 'store.cv_gender', op: 'match_exactly', values: ['Male'] }]]
const RTB_ONLY = 'the open real-time auction clears default and localised only'

/* The slot has Vision/AI on its display type and the retailer has opened store.cv_gender to every DSP. */
async function cvHarness(dealType: BuyersListDealType, extra: Record<string, unknown> = {}) {
  const h = await dealHarness(dealType, extra)
  const dt = (await h.ctx.displayTypes.get(DT))! as { enabledFeatures?: { visionAi?: Record<string, unknown> } }
  await h.ctx.displayTypes.saveRecord(DT, { ...dt, enabledFeatures: { ...dt.enabledFeatures, visionAi: { ...dt.enabledFeatures?.visionAi, enabled: true } } } as never)
  expect(((await h.ctx.displayTypes.get(DT)) as { enabledFeatures?: { visionAi?: { enabled?: boolean } } }).enabledFeatures?.visionAi?.enabled).toBe(true)
  await h.ctx.company.saveVariableAccess({ ...(await h.ctx.company.variableAccess()), 'store.cv_gender': 'all' })
  return h
}
/* A personalised campaign: the mandatory default plus a Male version, submitted, approved and activated. */
async function cvCampaign(h: H, name: string) {
  const created = await h.partner.create({ advertiserId: 'swisse', name, displayTypeId: DT, default: { pricingType: 'personalised' }, targeted: [{ id: 'men', priority: 1, pricingType: 'personalised', rules: MALE }] })
  expect(created.statusCode, created.body).toBe(201)
  const id = created.json().campaignId as string
  for (const version of ['default', 'men']) expect((await h.partner.upload(id, version, png(1920, 1080))).statusCode).toBe(201)
  expect((await h.partner.submit(id)).statusCode).toBe(200)
  const ap = await h.admin.approve(id, (await h.ctx.approvals.view(id)).assetVersion as string); expect(ap.statusCode, ap.body).toBe(200)
  expect((await h.admin.activate(id)).statusCode).toBe(200)
  return id
}

describe('Run 7 — D5 Computer Vision gender on a deal: personalised, targeted forecast', () => {
  it('D5.1 — guaranteed: Male targeting is accepted; volume = floor(gendered forecast × (1 − buffer%)), not the whole-slot VAC-d; DV360 PG / Amazon guaranteed deal carry it; personalised-eligible; billed realised VAC-d, no make-good', async () => {
    const h = await cvHarness('guaranteed')
    const campaignId = await cvCampaign(h, 'Swisse — D5.1')
    const targeted = Math.round(ASSUMED_VIEWS * (await h.ctx.audience.targetedShare(DT, MALE as never)))
    const committed = guaranteedImpressions(targeted, BUFFER_PCT)
    expect(targeted, 'the gendered subset is smaller than the whole slot').toBeLessThan(ASSUMED_VIEWS)
    expect(committed).toBeLessThan(COMMITTED)
    const res = await reserve(h, campaignId, day(1))
    expect(res.statusCode, res.body).toBe(201)
    expect(res.json()).toMatchObject({ status: 'reserved', dealType: 'guaranteed', clearingCpm: RESERVE, forecastImpressions: targeted, guaranteedImpressions: committed })
    expect(res.json().dspDeal).toEqual({ dealType: 'guaranteed', dspDealKind: 'programmatic_guaranteed', unitCount: committed, unit: 'impressions' })
    expect(dspDealTerms('amazon_dsp', 'guaranteed', committed)).toEqual({ dealType: 'guaranteed', dspDealKind: 'guaranteed_deal', unitCount: committed, unit: 'impressions' })
    /* Held outside the auction, handed off, and the personalised version may play in the deal-held window. */
    expect(await rowsOf(h, day(1))).toMatchObject([{ type: 'reserve', dealType: 'guaranteed', forecastImpressions: targeted, guaranteedImpressions: committed }])
    expect(booked(h, day(1))).toMatchObject([{ campaignId, displayTypeId: DT, personalisedEligible: true }])
    expect((await runAuction(h.ctx, day(1))).positions[0]).toMatchObject({ bidRequests: 0, winner: null })
    /* A quarter of the time played: billed on the realised VAC-d at the deal rate; the shortfall against the commitment is not made good. */
    const [item] = await bill(h, campaignId, day(1), { plays: 1440, playedSec: EXPECTED_SEC / 4 })
    expect(item).toMatchObject({ campaignId, cpm: RESERVE, realisedViews: ASSUMED_VIEWS / 4 })
    expect(ASSUMED_VIEWS / 4).toBeLessThan(committed)
    expect(item.amount).toBeCloseTo((ASSUMED_VIEWS / 4 / 1000) * RESERVE, 2)
    expect(await runBilling(h.ctx)).toEqual([])
  })

  it('D5.2 — the same targeting on an open real-time position is still refused targeting_not_supported', async () => {
    const h = await cvHarness('guaranteed')
    const campaignId = await cvCampaign(h, 'Swisse — D5.2')
    await h.admin.slot({ listMode: 'rtb', buyersListId: null, buyersListIds: [] })
    const pos = (await findPosition(h.ctx, POS))!
    expect(checkTargeting(pos, 'personalised')).toMatchObject({ code: 'targeting_not_supported', reason: expect.stringContaining(RTB_ONLY) })
    expect(checkTargeting(pos, 'localised')).toBeNull()
    /* Nothing is booked for it through the API either. */
    expect((await h.partner.bid(campaignId, day(1), 300)).statusCode).toBeGreaterThanOrEqual(400)
    expect(anyBooked(h)).toEqual([])
  })

  it('D5.3 — preferred variant: accepted, no committed volume, personalised-eligible, billed at the agreed rate', async () => {
    const h = await cvHarness('preferred')
    const campaignId = await cvCampaign(h, 'Swisse — D5.3')
    const res = await reserve(h, campaignId, day(1))
    expect(res.statusCode, res.body).toBe(201)
    expect(res.json()).toMatchObject({ status: 'reserved', dealType: 'preferred', clearingCpm: RESERVE, forecastImpressions: null, guaranteedImpressions: null })
    expect(res.json().dspDeal).toEqual({ dealType: 'preferred', dspDealKind: 'preferred_deal', unitCount: null, unit: null })
    expect(booked(h, day(1))).toMatchObject([{ campaignId, personalisedEligible: true }])
    const [item] = await bill(h, campaignId, day(1), { plays: 2880, playedSec: EXPECTED_SEC / 2 })
    expect(item).toMatchObject({ cpm: RESERVE, realisedViews: ASSUMED_VIEWS / 2, amount: 60 })
  })

  it('D5.4 — private-auction variant: a gendered bid clears per slot at its own first price with no rate lock, personalised-eligible', async () => {
    const h = await cvHarness('private_auction')
    await h.bidder.control({ mode: 'no_bid' })
    const campaignId = await cvCampaign(h, 'Swisse — D5.4')
    expect((await h.partner.bid(campaignId, day(1), 210)).statusCode).toBe(201)
    expect((await runAuction(h.ctx, day(1))).positions[0].winner).toMatchObject({ clearingCpm: 210 })
    expect((await h.ctx.buyersLists.get(h.list.id))!.lockedWin).toBeNull()
    expect(booked(h, day(1))).toMatchObject([{ campaignId, personalisedEligible: true }])
    expect((await h.partner.bid(campaignId, day(2), 190)).statusCode).toBe(201)
    expect((await runAuction(h.ctx, day(2))).positions[0].winner).toMatchObject({ clearingCpm: 190 })
    expect(booked(h, day(2))).toMatchObject([{ campaignId, personalisedEligible: true }])
  })
})
