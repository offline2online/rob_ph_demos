/* End-to-End Test Spec — Open Auction Floor-Price Path (v1), board doc
   f34VQZCy2kkWJfBP6Iwp on Display Types & DSP Integration. Case ids (A1…D3)
   are the spec's and stay stable across the later paths (private auction,
   reserved, two-period) so results compare.

   Anchor sequence: submit → approve (the hard pre-auction gate) → the
   auction clears the effective floor → hand-off → billing on realised
   dynamic VAC-d. Every external seam is a stub (harness.ts). */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { supportedTargetingOf } from '@ph-dsp/types'
import { findPosition } from '../../src/domain/positions'
import { isLive } from '../../src/domain/exchange'
import { runAuction } from '../../src/exchange/auction'
import { lineItems, runBilling } from '../../src/exchange/billing'
import { handOff } from '../../src/exchange/handoff'
import { receivesBidRequests } from '../../src/exchange/auction'
import type { ReservationRecord } from '../../src/repos/ReservationRepo'
import { png } from '../media'
import { ASSUMED_VIEWS, DT, DT_B, POS, POS_B, day, fixture, harness, response, swisseBid } from './harness'

afterEach(() => {
  vi.unstubAllGlobals()
})

const bookingsFor = (h: Awaited<ReturnType<typeof harness>>, w: Date) => h.campaigns.handoffs.filter((b) => b.windowStart === w.toISOString())

describe('preconditions / fixtures', () => {
  it('exchange complete and on, one Live DSP with endpoint and seat, one single-zone Advertiser slot at floor 100 AUD, localised targeting', async () => {
    const h = await harness()
    const ex = await h.ctx.exchange.get()
    expect(isLive(ex)).toBe(true)
    const sellers = await h.app.inject({ method: 'GET', url: '/sellers.json' })
    expect(sellers.statusCode).toBe(200)
    expect(sellers.json().sellers[0]).toMatchObject({ seller_id: ex.sellerId, domain: ex.domain })
    const google = (await h.ctx.partners.get('p_google'))!
    expect(google).toMatchObject({ status: 'connected', mode: 'live' })
    expect(receivesBidRequests(google)).toBe(true)
    const p = (await findPosition(h.ctx, POS))!
    expect(p.displayType).toMatchObject({ touchPoint: 'Digital Signage', multiZone: { enabled: false } })
    expect((await h.ctx.displays.summaryByDisplayType(DT)).displays).toBeGreaterThan(0)
    expect(supportedTargetingOf(p.def)).toEqual(['localised'])
    expect(await h.ctx.company.get()).toMatchObject({ floorCpm: 100, currency: 'AUD' })
    expect(await h.ctx.company.advertiserSetting('swisse')).toMatchObject({ approvalRequired: true, floorMultiplier: 1 })
  })
})

describe('A. Approval gate (hard precondition)', () => {
  it('A1 — submit with the mandatory default layer + creative → Awaiting approval; retailer approves → Approved', async () => {
    const h = await harness()
    const { id, created, submitted } = await h.submitApiCampaign('Swisse — A1')
    expect(created.json().status).toBe('draft')
    expect(submitted.statusCode).toBe(200)
    expect(submitted.json()).toMatchObject({ status: 'awaiting_approval', mode: 'manual' })
    expect((await h.partner.status(id)).json().status).toBe('awaiting_approval')
    expect((await h.admin.approve(id)).statusCode).toBe(200)
    expect((await h.partner.status(id)).json()).toMatchObject({ status: 'approved', mode: 'manual' })
    /* The creative is in the asset store under its content hash. */
    const asset = (await h.ctx.campaigns.latestAssets(id)).find((a) => a.role === 'default')!
    expect(h.assets.files.has(asset.file)).toBe(true)
    expect(h.assets.hashOf(asset.file)).toMatch(/^[0-9a-f]{32}$/)
  })

  it('A2 — a bid referencing an approved creative ID enters the auction', async () => {
    const h = await harness()
    const campaignId = await h.approvedCrid('crid-a2', day(0))
    const out = await runAuction(h.ctx, day(1))
    const r = await h.rows(day(1))
    expect(r).toHaveLength(1)
    expect(r[0]).toMatchObject({ campaignId, channel: 'openrtb', status: 'won' })
    expect(out.positions[0].winner).toMatchObject({ advertiserId: 'swisse', clearingCpm: 150 })
  })

  it('A3 — a bid referencing an unknown/unapproved creative ID is discarded pre-auction and the creative is queued for later windows', async () => {
    const h = await harness()
    await h.bidder.control({ crid: 'crid-a3' })
    const out = await runAuction(h.ctx, day(0))
    expect(out.positions[0].winner).toBeNull()
    expect((await h.rows(day(0)))[0]).toMatchObject({ status: 'rejected', reason: 'New creative crid-a3: queued for approval.' })
    const id = (await h.queuedCampaign('crid-a3'))!
    expect(await h.ctx.approvals.view(id)).toMatchObject({ status: 'awaiting_approval' })
    /* Still unapproved in the next window: discarded again, never retrieved twice. */
    await runAuction(h.ctx, day(1))
    expect((await h.rows(day(1)))[0]).toMatchObject({ status: 'rejected', reason: 'The campaign is not approved.' })
    expect(h.bidder.log.creativeFetches).toHaveLength(1)
    /* Once approved (and activated) it competes in a later window. */
    await h.admin.approve(id)
    await h.admin.activate(id)
    expect((await runAuction(h.ctx, day(2))).positions[0].winner).toMatchObject({ advertiserId: 'swisse' })
    expect(bookingsFor(h, day(0))).toEqual([])
    expect(bookingsFor(h, day(1))).toEqual([])
  })

  it('A4 — a campaign that is not Approved is excluded from reservation, bidding and hand-off, and cannot be activated', async () => {
    const h = await harness()
    const { id } = await h.submitApiCampaign('Swisse — A4')
    /* Cannot be activated. */
    const act = await h.admin.activate(id)
    expect(act.statusCode).toBeGreaterThanOrEqual(400)
    expect((await h.ctx.campaigns.getCampaign(id))!.activation.enabled).toBe(false)
    /* Reservation / API bid. */
    const res = await h.partner.reserve({ positionId: POS, windowStart: day(0).toISOString(), campaignId: id, advertiserId: 'swisse', type: 'bid', bidCpm: 200 })
    expect(res.statusCode).toBe(422)
    expect(res.json().error.code).toBe('not_approved')
    /* DSP bidding: a queued, unapproved creative can't win. */
    await h.bidder.control({ crid: 'crid-a4' })
    await runAuction(h.ctx, day(1))
    await runAuction(h.ctx, day(2))
    expect((await h.rows(day(2)))[0]).toMatchObject({ status: 'rejected', reason: 'The campaign is not approved.' })
    /* Hand-off: even a won window for an unapproved campaign is never booked into PH Core. */
    const forced = await h.ctx.reservations.insert({
      id: 'res_a4_forced', partnerId: 'p_google', advertiserId: 'swisse', campaignId: id, positionId: POS, windowStart: day(3).toISOString(),
      type: 'bid', channel: 'api', bidCpm: 150, currency: 'AUD', status: 'won', clearingCpm: 150, reason: null, testMode: false, pricingType: 'localised', handedOffAt: null,
    })
    const after = await handOff(h.ctx, forced)
    expect(after).toMatchObject({ handedOffAt: null, reason: 'Not handed off: the campaign is not approved.' })
    expect(h.campaigns.handoffs.filter((b) => b.campaignId === id)).toEqual([])
  })

  it('A5 — a submission missing the mandatory default layer is rejected at automated checks and never reaches the review queue', async () => {
    const h = await harness()
    /* No default layer at all: refused on create. */
    const noDefault = await h.partner.create({
      advertiserId: 'swisse', name: 'Swisse — A5 no default', displayTypeId: DT,
      targeted: [{ id: 'metro', priority: 10, pricingType: 'localised', rules: [[{ source: 'store', variable: 'store.fixed_segments', op: 'include', values: ['Metro'] }]] }],
    })
    expect(noDefault.statusCode).toBe(400)
    expect(noDefault.json().error.details).toEqual([{ field: 'default', reason: 'Required.' }])
    /* A default layer declared but no creative for it: refused on submit. */
    const created = await h.partner.create({
      advertiserId: 'swisse', name: 'Swisse — A5 no default creative', displayTypeId: DT, default: { pricingType: 'localised' },
      targeted: [{ id: 'metro', priority: 10, pricingType: 'localised', rules: [[{ source: 'store', variable: 'store.fixed_segments', op: 'include', values: ['Metro'] }]] }],
    })
    const id = created.json().campaignId as string
    await h.partner.upload(id, 'metro', png(1920, 1080))
    const submitted = await h.partner.submit(id)
    expect(submitted.statusCode).toBe(422)
    expect(submitted.json().error.code).toBe('checks_failed')
    expect(JSON.stringify(submitted.json().error.details)).toMatch(/default/)
    expect((await h.partner.status(id)).json().status).toBe('draft')
    const queue = (await h.ctx.approvalCampaigns.listCampaigns()).map((c) => c.campaignId)
    const awaiting = await Promise.all(queue.map(async (c) => ({ c, s: (await h.ctx.approvals.view(c)).status })))
    expect(awaiting.filter((x) => x.s === 'awaiting_approval').map((x) => x.c)).not.toContain(id)
  })
})

describe('B. Auction / floor', () => {
  it('B1 — a single bid above the effective floor wins; the approved creative is handed off for that slot and window', async () => {
    const h = await harness()
    const campaignId = await h.approvedCrid('crid-b1', day(0))
    await h.bidder.control({ mode: 'bid', priceCpm: 120 })
    const out = await runAuction(h.ctx, day(1))
    expect(out.positions[0]).toMatchObject({ bidRequests: 1, bids: 1, winner: { partnerId: 'p_google', advertiserId: 'swisse', clearingCpm: 120 } })
    /* The floor on the request is the effective base floor. */
    expect(h.bidder.log.bidRequests.at(-1)!.body.imp[0]).toMatchObject({ bidfloor: 100, bidfloorcur: 'AUD' })
    expect(bookingsFor(h, day(1))).toEqual([expect.objectContaining({ campaignId, displayTypeId: DT, slot: 1, windowStart: day(1).toISOString(), windowEnd: day(2).toISOString() })])
    expect((await h.ctx.reservations.get(out.positions[0].winner!.reservationId))!.handedOffAt).not.toBeNull()
  })

  it('B2 — a single bid below the floor does not win; the window falls through to the mandatory default campaign', async () => {
    const h = await harness()
    await h.approvedCrid('crid-b2', day(0))
    await h.bidder.control({ mode: 'below_floor' })
    const out = await runAuction(h.ctx, day(1))
    expect(out.positions[0].winner).toBeNull()
    expect((await h.rows(day(1)))[0]).toMatchObject({ status: 'rejected', reason: '50 is below the effective floor of 100 AUD CPM.' })
    /* Just under the floor is still under it. */
    h.bidder.setScript((req) => ({ body: response(req, [swisseBid(req, { price: 99.99, crid: 'crid-b2' })]) }))
    expect((await runAuction(h.ctx, day(2))).positions[0].winner).toBeNull()
    expect((await h.rows(day(2)))[0].reason).toBe('99.99 is below the effective floor of 100 AUD CPM.')
    /* Nothing booked into PH Core: the slot's own playlist (its default campaign) plays. */
    expect(bookingsFor(h, day(1))).toEqual([])
    expect(bookingsFor(h, day(2))).toEqual([])
    expect((await h.ctx.playlists.get(`pl_${DT}`))!.items.map((i) => i.campaignId)).toEqual(['c_notice'])
  })

  it('B3 — no bid in the window falls through to the default campaign', async () => {
    const h = await harness()
    await h.approvedCrid('crid-b3', day(0))
    await h.bidder.control({ mode: 'no_bid' })
    const out = await runAuction(h.ctx, day(1))
    expect(out.positions[0]).toMatchObject({ bidRequests: 1, bids: 0, winner: null })
    expect(await h.rows(day(1))).toEqual([])
    expect(bookingsFor(h, day(1))).toEqual([])
    const avail = await h.app.inject({ method: 'GET', url: `/api/v1/inventory/${POS}/availability?from=2026-09-22&to=2026-09-22`, headers: { authorization: 'Bearer e2e-token-google' } })
    expect(avail.json().windows[0].status).toBe('available')
  })

  it('B4 — two bids above the floor: the higher clears at its own price (first price); a tie goes to the earlier bid', async () => {
    const h = await harness()
    const high = await h.approvedCrid('crid-b4-high', day(0))
    await h.approvedCrid('crid-b4-low', day(1))
    h.bidder.setScript((req) => ({ body: response(req, [swisseBid(req, { price: 160, crid: 'crid-b4-low' }), swisseBid(req, { price: 180, crid: 'crid-b4-high' })]) }))
    const out = await runAuction(h.ctx, day(2))
    expect(out.positions[0].winner).toMatchObject({ clearingCpm: 180 })
    const rows = await h.rows(day(2))
    expect(rows.find((r) => r.status === 'won')).toMatchObject({ campaignId: high, bidCpm: 180, clearingCpm: 180 })
    expect(rows.find((r) => r.status === 'lost')).toMatchObject({ bidCpm: 160, reason: 'Outbid: the window cleared at 180 AUD CPM.' })

    /* Tie at 170: an API bid placed before the auction vs a DSP bid in it — the earlier one wins. */
    const { id: api } = await h.submitApiCampaign('Swisse — B4 tie')
    await h.admin.approve(api)
    await h.admin.activate(api)
    const placed = await h.partner.reserve({ positionId: POS, windowStart: day(3).toISOString(), campaignId: api, advertiserId: 'swisse', type: 'bid', bidCpm: 170 })
    expect(placed.statusCode).toBe(201)
    await new Promise((r) => setTimeout(r, 5))
    h.bidder.setScript((req) => ({ body: response(req, [swisseBid(req, { price: 170, crid: 'crid-b4-high' })]) }))
    const tie = await runAuction(h.ctx, day(3))
    expect(tie.positions[0].winner).toMatchObject({ reservationId: placed.json().reservationId, clearingCpm: 170 })
    expect((await h.rows(day(3))).find((r) => r.channel === 'openrtb')).toMatchObject({ status: 'lost' })
  })

  it('B5 — a personalised campaign bids and clears against the base floor; the multiplier is a per-play surcharge, not a floor', async () => {
    const h = await harness()
    /* Localised only (default): a personalised campaign can't buy it at all. */
    const { id: pers } = await h.submitApiCampaign('Swisse — B5 personalised', 'personalised')
    await h.admin.approve(pers)
    await h.admin.activate(pers)
    const bid = (bidCpm: number, w = day(0)) => h.partner.reserve({ positionId: POS, windowStart: w.toISOString(), campaignId: pers, advertiserId: 'swisse', type: 'bid', bidCpm })
    const unsupported = await bid(200)
    expect(unsupported.statusCode).toBe(422)
    expect(unsupported.json().error.code).toBe('targeting_not_supported')
    /* Opened up to personalised: the floor is still the base, 100 × 1.0 (Rob, 30 Sep 2026). */
    expect((await h.admin.supportTargeting(['localised', 'personalised'])).statusCode).toBe(200)
    const under = await bid(99)
    expect(under.statusCode).toBe(422)
    expect(under.json().error).toMatchObject({ code: 'below_floor', message: '99 is below the effective floor of 100 AUD CPM.' })
    /* 120 on a 100 floor is accepted (Run 6): no multiplied floor of 150. */
    const at = await bid(120)
    expect(at.statusCode).toBe(201)
    const out = await runAuction(h.ctx, day(0))
    expect(out.positions[0].winner).toMatchObject({ reservationId: at.json().reservationId, clearingCpm: 120 })
    /* The multiplier in force is kept on the reservation for billing personalised plays. */
    expect(await h.ctx.reservations.get(at.json().reservationId)).toMatchObject({ status: 'won', clearingCpm: 120, personalisedMultiplier: 1.5 })
    /* Re-checked at the auction: a pending bid that no longer clears (floor raised) is refused pre-auction. */
    const pending = await bid(105, day(1))
    expect(pending.statusCode).toBe(201)
    await h.ctx.company.save({ ...(await h.ctx.company.get()), floorCpm: 110 })
    await h.bidder.control({ mode: 'no_bid' })
    const later = await runAuction(h.ctx, day(1))
    expect(later.positions[0].winner).toBeNull()
    expect(await h.ctx.reservations.get(pending.json().reservationId)).toMatchObject({ status: 'rejected', reason: '105 is below the effective floor of 110 AUD CPM.' })
  })
})

describe('C. Hand-off & billing', () => {
  it('C1 — the winning creative is fetched, confirmed approved, validated against the canvas, then handed off', async () => {
    const h = await harness()
    const campaignId = await h.approvedCrid('crid-c1', day(0))
    const asset = (await h.ctx.campaigns.latestAssets(campaignId)).find((a) => a.role === 'default')!
    h.assets.reads.length = 0
    const out = await runAuction(h.ctx, day(1))
    expect(out.positions[0].winner).not.toBeNull()
    /* Fetched from the asset store at hand-off. */
    expect(h.assets.reads).toContain(asset.file)
    expect(bookingsFor(h, day(1))).toHaveLength(1)

    /* Confirmed approved: approval withdrawn after the clear → not handed off. */
    const w = day(2)
    const stale = await h.ctx.reservations.insert({
      id: 'res_c1_stale', partnerId: 'p_google', advertiserId: 'swisse', campaignId, positionId: POS, windowStart: w.toISOString(),
      type: 'bid', channel: 'openrtb', bidCpm: 150, currency: 'AUD', status: 'won', clearingCpm: 150, reason: null, testMode: false, pricingType: 'localised', handedOffAt: null,
    })
    await h.admin.activate(campaignId, false)
    expect(await handOff(h.ctx, stale)).toMatchObject({ handedOffAt: null, reason: 'Not handed off: the campaign is approved but not activated.' })
    await h.admin.activate(campaignId, true)

    /* Validated against the canvas: an approved creative for another shape (seeded Swisse, 1080×1920) is refused here. */
    await h.admin.approve('c_api_swisse')
    await h.admin.activate('c_api_swisse')
    const wrong = await h.ctx.reservations.insert({ ...stale, id: 'res_c1_portrait', campaignId: 'c_api_swisse', windowStart: day(3).toISOString() } as ReservationRecord)
    const refused = await handOff(h.ctx, wrong)
    expect(refused.handedOffAt).toBeNull()
    expect(refused.reason).toMatch(/^Not handed off: the creative doesn’t fit E2E Signage: /)
    expect(bookingsFor(h, day(3))).toEqual([])
  })

  it('C2 — billing runs on realised dynamic VAC-d from playback; a play that didn’t happen isn’t billed', async () => {
    const h = await harness()
    const campaignId = await h.approvedCrid('crid-c2', day(0))
    await runAuction(h.ctx, day(1))
    await runAuction(h.ctx, day(2))
    const expectedSec = 2 * 86_400 /* two displays × a day × a one-slot rotation */
    /* Window 1: half the expected play time happened (a display offline). Window 2: nothing played. */
    h.playback.script(campaignId, day(1), { plays: 2880, playedSec: expectedSec / 2 })
    h.playback.script(campaignId, day(2), { plays: 0, playedSec: 0 })
    /* Not over yet: nothing billed. */
    h.setNow(new Date('2026-09-22T12:00:00.000Z'))
    expect(await runBilling(h.ctx)).toEqual([])
    h.setNow(new Date('2026-09-24T00:01:00.000Z'))
    const items = await runBilling(h.ctx)
    expect(items).toMatchObject([
      { campaignId, positionId: POS, windowStart: day(1).toISOString(), plays: 2880, playedSec: expectedSec / 2, expectedSec, assumedViews: ASSUMED_VIEWS, realisedViews: ASSUMED_VIEWS / 2, cpm: 150, currency: 'AUD', amount: 60 },
      { campaignId, windowStart: day(2).toISOString(), plays: 0, realisedViews: 0, amount: 0 },
    ])
    /* The playback stub was asked for exactly the sold window on the display type's displays. */
    expect(h.playback.calls).toContainEqual(expect.objectContaining({ campaignId, displayTypeId: DT, from: day(1).toISOString(), to: day(2).toISOString() }))
    /* Billed once. */
    expect(await runBilling(h.ctx)).toEqual([])
    expect(await lineItems(h.ctx)).toHaveLength(2)
  })

  it('C3 — one live sale per position and play window: two clearings can’t both sell it, and the loser is told why', async () => {
    const h = await harness()
    await h.approvedCrid('crid-c3', day(0))
    /* Two clearings of the same window at once. */
    const [a, b] = await Promise.all([runAuction(h.ctx, day(1)), runAuction(h.ctx, day(1))])
    const winners = [a, b].map((o) => o.positions[0].winner).filter(Boolean)
    expect(winners).toHaveLength(1)
    const rows = await h.rows(day(1))
    expect(rows.filter((r) => r.status === 'won' && !r.testMode)).toHaveLength(1)
    for (const r of rows.filter((x) => x.status !== 'won')) expect(r.reason).toBeTruthy()
    expect(bookingsFor(h, day(1))).toHaveLength(1)
    /* The database refuses a second live sale outright. */
    const won = rows.find((r) => r.status === 'won')!
    /* The seam may throw synchronously (no transaction open) or reject: catch either. */
    await expect((async () => h.ctx.reservations.insert({ ...won, id: 'res_c3_second', createdAt: undefined }))()).rejects.toThrow(/UNIQUE/)
    /* A later reservation for a sold window is told so. */
    const { id: api } = await h.submitApiCampaign('Swisse — C3')
    await h.admin.approve(api)
    await h.admin.activate(api)
    const late = await h.partner.reserve({ positionId: POS, windowStart: day(1).toISOString(), campaignId: api, advertiserId: 'swisse', type: 'bid', bidCpm: 500 })
    expect(late.statusCode).toBe(409)
    expect(late.json().error.message).toMatch(/already sold|closed/)
    /* PH Core's side: at most one booking per slot and window. */
    await expect(h.ctx.campaigns.bookSlot({ ...bookingsFor(h, day(1))[0], id: 'bk_c3_second' })).rejects.toThrow(/one booking per slot and window/)
  })
})

describe('D. Robustness / edge', () => {
  it('D1 — a malformed bid response (not a bid, null bid, oversized body) is that position’s outcome only; every other position still clears', async () => {
    const h = await harness()
    await fixture(h.ctx, { second: true })
    await h.approvedCrid('crid-d1', day(0))
    expect(await h.rows(day(0), POS_B)).toHaveLength(1)
    const bad: Record<string, (req: Parameters<typeof response>[0]) => { status?: number; body?: unknown; raw?: string }> = {
      'not JSON': () => ({ raw: '<html>502 Bad Gateway</html>' }),
      'not a bid response': () => ({ body: 'not a bid' }),
      'a JSON array': () => ({ body: [1, 2, 3] }),
      'a null bid': (req) => ({ body: { id: req.id, cur: 'AUD', seatbid: [{ seat: '884513', bid: [null] }] } }),
      'null seatbid': (req) => ({ body: { id: req.id, cur: 'AUD', seatbid: null } }),
      'a bid with no price': (req) => ({ body: response(req, [swisseBid(req, { price: null, crid: 'crid-d1' })]) }),
      'a string price': (req) => ({ body: response(req, [swisseBid(req, { price: '999', crid: 'crid-d1' })]) }),
      'an oversized body (> 64 KB)': (req) => ({ body: { ...response(req, [swisseBid(req, { price: 150, crid: 'crid-d1' })]), ext: { pad: 'x'.repeat(70 * 1024) } } }),
      'HTTP 500': () => ({ status: 500, body: { error: 'boom' } }),
    }
    let n = 1
    for (const [label, make] of Object.entries(bad)) {
      const w = day(n++)
      h.bidder.setScript((req) => ((req as { dooh?: { id?: string } }).dooh?.id === DT ? make(req) : { body: response(req, [swisseBid(req, { price: 150, crid: 'crid-d1' })]) }))
      const out = await runAuction(h.ctx, w)
      const byId = Object.fromEntries(out.positions.map((p) => [p.positionId, p]))
      expect(byId[POS].winner, label).toBeNull()
      expect(byId[POS].skipped, label).toBeUndefined()
      expect(byId[POS_B].winner, label).toMatchObject({ clearingCpm: 150 })
      expect(bookingsFor(h, w).map((b) => b.displayTypeId), label).toEqual([DT_B])
      expect((await h.rows(w, POS)).filter((r) => r.status === 'won' || r.status === 'pending'), label).toEqual([])
    }
  })

  it('D2 — a bid from a disconnected DSP is refused (connection re-tested and in error)', async () => {
    const h = await harness()
    await h.approvedCrid('crid-d2', day(0))
    const { id: api } = await h.submitApiCampaign('Swisse — D2')
    await h.admin.approve(api)
    await h.admin.activate(api)
    const bid = (w: Date) => h.partner.reserve({ positionId: POS, windowStart: w.toISOString(), campaignId: api, advertiserId: 'swisse', type: 'bid', bidCpm: 200 })

    /* (a) Its connection re-tested and failing (status error, still Live): a bid it placed while connected must not win. */
    const pendingA = await bid(day(1))
    expect(pendingA.statusCode).toBe(201)
    await h.bidder.auth({ accept: false })
    const retest = await h.admin.connect()
    expect(retest.json().status).toBe('error')
    const reqsBefore = h.bidder.log.bidRequests.length
    const outA = await runAuction(h.ctx, day(1))
    expect(h.bidder.log.bidRequests.length, 'no bid request goes to a DSP that is not connected').toBe(reqsBefore)
    expect(outA.positions[0].winner, 'a DSP whose connection is in error must not win').toBeNull()
    expect((await h.ctx.reservations.get(pendingA.json().reservationId))!.status).toBe('rejected')
    expect(bookingsFor(h, day(1))).toEqual([])
    /* …and it can't place a new one. */
    const refusedA = await bid(day(2))
    expect(refusedA.statusCode).toBe(409)
  })

  it('D2 — a bid from a DSP the retailer disconnected is refused (request, placement and pending bids)', async () => {
    const h = await harness()
    const { id: api } = await h.submitApiCampaign('Swisse — D2b')
    await h.admin.approve(api)
    await h.admin.activate(api)
    const bid = (w: Date) => h.partner.reserve({ positionId: POS, windowStart: w.toISOString(), campaignId: api, advertiserId: 'swisse', type: 'bid', bidCpm: 200 })
    const pending = await bid(day(1))
    expect(pending.statusCode).toBe(201)
    expect((await h.admin.disconnect()).statusCode).toBe(200)
    const before = h.bidder.log.bidRequests.length
    const out = await runAuction(h.ctx, day(1))
    expect(h.bidder.log.bidRequests.length).toBe(before)
    expect(out.positions[0].winner).toBeNull()
    expect(await h.ctx.reservations.get(pending.json().reservationId)).toMatchObject({ status: 'rejected' })
    /* Refused (disconnecting clears its seats, so the advertiser is no longer one of its own). */
    const fresh = await bid(day(2))
    expect(fresh.statusCode).toBeGreaterThanOrEqual(400)
    expect(fresh.statusCode).toBeLessThan(500)
    expect(await h.ctx.reservations.forWindow(POS, day(2).toISOString())).toEqual([])
  })

  it('D3 — a bid carrying an unknown creative: one retrieval only, from the DSP’s own creative path; queued for review', async () => {
    const h = await harness()
    h.bidder.setScript((req) => ({ body: response(req, [swisseBid(req, { price: 150, crid: 'crid-d3-one' }), swisseBid(req, { price: 150, crid: 'crid-d3-two' })]) }))
    const out = await runAuction(h.ctx, day(0))
    expect(out.positions[0].winner).toBeNull()
    /* One retrieval per response, from the DSP's own creative path. */
    expect(h.bidder.log.creativeFetches).toEqual(['http://mocks.test/dv360/creatives/crid-d3-one.png?w=1920&h=1080'])
    expect((await h.rows(day(0))).map((r) => r.reason).sort()).toEqual([
      'New creative crid-d3-one: queued for approval.',
      'Unknown creative crid-d3-two; it will be retrieved for review from a later window.',
    ])
    expect(await h.ctx.approvals.view((await h.queuedCampaign('crid-d3-one'))!)).toMatchObject({ status: 'awaiting_approval' })
    /* The same creative on a later bid is not retrieved again; the deferred one is retrieved then. */
    await runAuction(h.ctx, day(1))
    expect(h.bidder.log.creativeFetches).toEqual([
      'http://mocks.test/dv360/creatives/crid-d3-one.png?w=1920&h=1080',
      'http://mocks.test/dv360/creatives/crid-d3-two.png?w=1920&h=1080',
    ])
    expect((await h.rows(day(1)))[0].reason).toBe('The campaign is not approved.')
  })

  it('D3 — a creative URL outside the DSP’s own path is never fetched, and doesn’t use up the response’s one retrieval', async () => {
    const h = await harness()
    h.bidder.setScript((req) => ({
      body: response(req, [
        swisseBid(req, { price: 150, crid: 'crid-d3-evil', iurl: 'http://evil.test/creatives/x.png' }),
        swisseBid(req, { price: 150, crid: 'crid-d3-traversal', iurl: 'http://mocks.test/dv360/creatives/../../_control/state' }),
        swisseBid(req, { price: 150, crid: 'crid-d3-good' }),
      ]),
    }))
    /* The same response in two consecutive windows. */
    await runAuction(h.ctx, day(0))
    await runAuction(h.ctx, day(1))
    /* Never outside the stubs, never off the DSP's creative path. */
    expect(h.bidder.log.refused).toEqual([])
    expect(h.bidder.log.creativeFetches.every((u) => u.startsWith('http://mocks.test/dv360/creatives/') && !u.includes('..'))).toBe(true)
    const reasons = (await h.rows(day(0))).map((r) => r.reason)
    expect(reasons).toContain('Unknown creative crid-d3-evil, and no creative URL from Google DSP to retrieve it from.')
    /* Nothing was retrieved for the two refused URLs, so the one retrieval is still the valid creative's. */
    expect(h.bidder.log.creativeFetches, 'the valid unknown creative was never retrieved').toEqual(['http://mocks.test/dv360/creatives/crid-d3-good.png?w=1920&h=1080'])
    expect(await h.queuedCampaign('crid-d3-good'), 'the valid unknown creative was never queued for review').not.toBeNull()
  })
})
