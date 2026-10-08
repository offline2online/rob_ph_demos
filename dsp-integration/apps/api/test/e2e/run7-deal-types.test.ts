/* E2E spec v2 (board doc f34VQZCy2kkWJfBP6Iwp), Run 7 — every deal type end to
   end (ticket rFN7TfIXtValP5hfIq1o, 7 Oct 2026). Each way a slot transacts is
   driven setup → inventory → campaign/approval → bid or reserve → auction →
   hand-off booking → billing, once per type, with the buyers list's
   `dealType` as the single source for what is captured and what the DSP deal
   carries (REQUIREMENTS §5 "Private auctions", "Reserve price", "Guaranteed
   deal path", "Deal type on the buyers list").

     D1 — open RTB (open auction, no buyers list)
     D2 — private auction (PMP / buyers list)
     D3 — preferred deal (reserve, no committed volume)
     D4 — programmatic guaranteed (reserve with committed volume)

   Fixture: the harness's one Advertiser slot (floor 100, assumed views 800 per
   window, two displays, a one-slot rotation). Reserve price 150 where the
   type reserves. The guarantee buffer is Advertiser settings' default, 10%.
   Per-DSP guaranteed-deal field names (DV360 Programmatic Guaranteed, Amazon
   guaranteed deal) are the mapping in src/dsp/dealTerms.ts and are still to be
   confirmed against each DSP's own sandbox — the mocks here only prove the
   mapping is carried, not that a DSP accepts it. */
import type { BuyersListDealType } from '@ph-dsp/types'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { guaranteedImpressions } from '../../src/domain/guarantee'
import { dspDealTerms } from '../../src/dsp/dealTerms'
import { runAuction } from '../../src/exchange/auction'
import { runBilling } from '../../src/exchange/billing'
import { ASSUMED_VIEWS, DT, GOOGLE, day, harness, response, swisseBid } from './harness'

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

/* A buyers-list deal of one type on the fixture's slot, inviting Swisse on Google's seat, with a reserve price on the slot. */
async function dealHarness(dealType: BuyersListDealType, extra: Record<string, unknown> = {}) {
  const h = await harness()
  await h.admin.slot({ reservePrice: RESERVE })
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
    /* No reserve price on the slot and not held: only a bid is open to the buyer. */
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

describe('Run 7 — D2 private auction: invited buyers, deal ID, locked rate', () => {
  const termDeal = async (h: H) => {
    const { id: _id, lockedWin: _l, createdAt: _c, updatedAt: _u, ...l } = (await h.ctx.buyersLists.get('bl_private_auction'))! as Record<string, unknown>
    await h.ctx.buyersLists.update('bl_private_auction', { ...l, activeTo: '2026-09-27T23:59:59.000Z', auctionCloses: day(1).toISOString() } as never)
  }

  it('D2.1 — deal type drives the fields: auctionCloses is captured, committed plays are not', async () => {
    const h = await dealHarness('private_auction')
    const put = (payload: Record<string, unknown>) => h.app.inject({ method: 'POST', url: '/api/admin/v1/buyers-lists', payload: { name: 'D2.1', invitedBuyers: [{ partnerId: 'p_google', seatId: '5130002' }], ...payload } })
    expect((await put({ dealType: 'private_auction', auctionCloses: day(1).toISOString() })).json()).toMatchObject({ dealType: 'private_auction', committedPlays: null, effectiveCommittedPlays: { source: 'none' } })
    const bad = await put({ dealType: 'private_auction', committedPlays: 500 })
    expect(bad.statusCode).toBe(400)
    expect(bad.json().error.details).toEqual([{ field: 'committedPlays', reason: expect.stringContaining('Only a guaranteed deal') }])
  })

  it('D2.2 — invited buyer: approve → bid carrying the deal ID wins, is handed off and billed at the cleared rate', async () => {
    const h = await dealHarness('private_auction')
    const campaignId = await h.approvedCrid('crid-d2', day(0))
    expect((await runAuction(h.ctx, day(1))).positions[0].winner).toMatchObject({ advertiserId: 'swisse', clearingCpm: 150 })
    /* The buyers list is the single source of the DSP deal: the request's deal is built from it. */
    expect(h.bidder.log.bidRequests.at(-1)!.body.imp[0].pmp).toMatchObject({ private_auction: 1, deals: [{ id: `PH-${h.list.id}`, wseat: ['5130002'] }] })
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
    expect((await rowsOf(h, day(2)))[0]).toMatchObject({ status: 'rejected', reason: expect.stringContaining(`requires PH-${h.list.id}`) })
    h.bidder.setScript((req) => ({ body: response(req, [swisseBid(req, { price: FLOOR - 1, crid: 'crid-d2-3' })]) }))
    await runAuction(h.ctx, day(3))
    expect((await rowsOf(h, day(3)))[0]).toMatchObject({ status: 'rejected', reason: `${FLOOR - 1} is below the effective floor of ${FLOOR} USD CPM.` })
    expect([day(1), day(2), day(3)].flatMap((w) => booked(h, w))).toEqual([])
  })

  it('D2.4 — two-period: the first clear locks the rate for the term; later windows book at it, outside-term bids are refused', async () => {
    const h = await dealHarness('private_auction')
    await termDeal(h)
    await h.bidder.control({ mode: 'no_bid' })
    const campaignId = await h.readyApiCampaign('Swisse — D2.4')
    expect((await h.partner.bid(campaignId, day(1), 210)).statusCode).toBe(201)
    expect((await runAuction(h.ctx, day(1))).positions[0].winner).toMatchObject({ clearingCpm: 210 })
    expect((await h.ctx.buyersLists.get(h.list.id))!.lockedWin).toMatchObject({ cpm: 210, advertiserId: 'swisse', campaignId })
    for (const w of [day(2), day(3)]) {
      expect((await runAuction(h.ctx, w)).positions[0]).toMatchObject({ bidRequests: 0, winner: { clearingCpm: 210 } })
      expect(booked(h, w)).toMatchObject([{ campaignId }])
    }
    /* A window past the term is outside the lock and the invitation. */
    const after = await h.partner.bid(campaignId, day(7), 300)
    expect(after.statusCode).toBeGreaterThanOrEqual(400)
    /* Each window billed on its own realised VAC-d at the locked rate. */
    h.playback.script(campaignId, day(2), { plays: 2880, playedSec: EXPECTED_SEC / 2 })
    h.setNow(new Date(day(5).getTime()))
    const items = (await runBilling(h.ctx)).filter((i) => i.windowStart === day(2).toISOString())
    expect(items).toMatchObject([{ cpm: 210, realisedViews: ASSUMED_VIEWS / 2, amount: 84 }])
  })
})

describe('Run 7 — D3 preferred deal: reserve price, no committed volume', () => {
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

  it('D3.2 — approve → reserve at the reserve price: held outside the auction, committed plays NOT captured, handed off, billed realised VAC-d at the reserve price', async () => {
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
    /* A quarter of the time played: billed on that, at the reserve price; the shortfall is not made good. */
    const [item] = await bill(h, campaignId, day(1), { plays: 1440, playedSec: EXPECTED_SEC / 4 })
    expect(item).toMatchObject({ cpm: RESERVE, realisedViews: ASSUMED_VIEWS / 4, amount: 30 })
    expect(await runBilling(h.ctx)).toEqual([])
  })

  it('D3.3 — the list is authoritative: a reservation naming guaranteed is refused (409); a bid or one under the reserve price is refused', async () => {
    const h = await dealHarness('preferred')
    const id = await h.readyApiCampaign('Swisse — D3.3')
    const clash = await reserve(h, id, day(1), { dealType: 'guaranteed' })
    expect(clash.statusCode).toBe(409)
    expect(clash.json().error.message).toContain('its buyers list sets the deal type')
    expect((await h.partner.bid(id, day(1), RESERVE - 20, { type: 'reserve' })).statusCode).toBeGreaterThanOrEqual(400)
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
    /* Only 600 of the 720 committed impressions' worth plays: billed on the realised 600 at the reserve price, nothing made good. */
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
})
