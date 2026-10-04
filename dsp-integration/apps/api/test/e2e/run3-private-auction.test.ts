/* E2E spec v2 (board doc f34VQZCy2kkWJfBP6Iwp), Run 3 — private auction
   (buyers list). Fixture: a reusable deal on the Advertiser slot inviting
   Swisse (Google seat 884513) and not Nestlé (seat 884512); the floor stays
   on the slot. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { runAuction } from '../../src/exchange/auction'
import { png } from '../media'
import { DT, day, harness, response, swisseBid } from './harness'

afterEach(() => {
  vi.unstubAllGlobals()
})

type Invite = { partnerId: string; seatId: string }
async function dealHarness(opts: { invited?: Invite[]; activeFrom?: string | null; activeTo?: string | null; auctionCloses?: string | null; before?: (h: Awaited<ReturnType<typeof harness>>) => Promise<unknown> } = {}) {
  const h = await harness()
  await opts.before?.(h)
  const list = await h.ctx.buyersLists.insert({
    id: 'bl_e2e', name: 'E2E deal', description: 'Run 3 fixture', invitedBuyers: opts.invited ?? [{ partnerId: 'p_google', seatId: '5130002' }],
    activeFrom: opts.activeFrom ?? null, activeTo: opts.activeTo ?? null, auctionCloses: opts.auctionCloses ?? null,
  })
  await h.admin.slot({ listMode: 'deal', buyersListId: list.id, partnerIds: [] })
  return { ...h, list }
}
const booked = (h: Awaited<ReturnType<typeof harness>>, w: Date) => h.campaigns.handoffs.filter((b) => b.windowStart === w.toISOString())

describe('Run 3 — private auction: approval gate for invited buyers (A1–A5)', () => {
  it('A1 — an invited buyer’s submission (default layer + creative) → Awaiting approval; approved → Approved', async () => {
    const h = await dealHarness()
    const { id, submitted } = await h.submitApiCampaign('Swisse — R3 A1')
    expect(submitted.json().status).toBe('awaiting_approval')
    await h.admin.approve(id)
    expect((await h.partner.status(id)).json().status).toBe('approved')
  })

  it('A2 — an invited buyer’s bid on an approved creative enters the auction', async () => {
    const h = await dealHarness()
    const campaignId = await h.approvedCrid('crid-r3-a2', day(0))
    await runAuction(h.ctx, day(1))
    expect(await h.rows(day(1))).toMatchObject([{ campaignId, status: 'won' }])
  })

  it('A3 — an invited buyer’s unknown creative is discarded pre-auction and queued', async () => {
    const h = await dealHarness()
    await h.bidder.control({ crid: 'crid-r3-a3' })
    expect((await runAuction(h.ctx, day(0))).positions[0].winner).toBeNull()
    expect((await h.rows(day(0)))[0]).toMatchObject({ status: 'rejected', reason: 'New creative crid-r3-a3: queued for approval.' })
    expect(await h.ctx.approvals.view((await h.queuedCampaign('crid-r3-a3'))!)).toMatchObject({ status: 'awaiting_approval' })
  })

  it('A4 — an invited buyer’s campaign that is not Approved can’t reserve, bid or be activated', async () => {
    const h = await dealHarness()
    const { id } = await h.submitApiCampaign('Swisse — R3 A4')
    expect((await h.admin.activate(id)).statusCode).toBeGreaterThanOrEqual(400)
    expect((await h.partner.bid(id, day(0), 200)).json().error.code).toBe('not_approved')
  })

  it('A5 — an invited buyer’s submission missing the default layer is rejected at automated checks', async () => {
    const h = await dealHarness()
    const res = await h.partner.create({ advertiserId: 'swisse', name: 'Swisse — R3 A5', displayTypeId: DT })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.details).toEqual([{ field: 'default', reason: 'Required.' }])
  })
})

describe('Run 3 — private auction: happy', () => {
  it('P1 — an invited buyer bidding above the floor wins and is handed off', async () => {
    const h = await dealHarness()
    const campaignId = await h.approvedCrid('crid-p1', day(0))
    const out = await runAuction(h.ctx, day(1))
    expect(out.positions[0]).toMatchObject({ bidRequests: 1, winner: { advertiserId: 'swisse', clearingCpm: 150 } })
    expect(booked(h, day(1))).toMatchObject([{ campaignId, displayTypeId: DT, slot: 1 }])
  })

  it('P2 — two invited buyers: the higher clears; a tie goes to the earlier bid', async () => {
    const h = await dealHarness({ invited: [{ partnerId: 'p_google', seatId: '5130002' }, { partnerId: 'p_google', seatId: '5130001' }] })
    await h.approvedCrid('crid-p2', day(0))
    const nestle = await h.readyApiCampaign('Nestlé — P2', 'localised', 'nestle')
    /* Nestlé 160 through the API vs Swisse 150 from the DSP. */
    expect((await h.partner.bid(nestle, day(1), 160, { advertiserId: 'nestle' })).statusCode).toBe(201)
    expect((await runAuction(h.ctx, day(1))).positions[0].winner).toMatchObject({ advertiserId: 'nestle', clearingCpm: 160 })
    expect((await h.rows(day(1))).find((r) => r.advertiserId === 'swisse')).toMatchObject({ status: 'lost', reason: 'Outbid: the window cleared at 160 AUD CPM.' })
    /* Tie at 150: Nestlé's bid was placed before the auction ran; Swisse's arrives in it. */
    const early = await h.partner.bid(nestle, day(2), 150, { advertiserId: 'nestle' })
    await new Promise((r) => setTimeout(r, 5))
    expect((await runAuction(h.ctx, day(2))).positions[0].winner).toMatchObject({ reservationId: early.json().reservationId, clearingCpm: 150 })
  })
})

describe('Run 3 — private auction: non-happy', () => {
  it('P3 — an uninvited buyer’s bid → not_invited; it never enters the auction', async () => {
    const h = await dealHarness()
    /* Nestlé needs no approval, so its creative is approved on arrival; activate it so only the invitation stands in the way. */
    await h.bidder.control({ mode: 'bid', priceCpm: 400, advertiserId: '5130001', crid: 'crid-p3' })
    await runAuction(h.ctx, day(0))
    expect((await h.rows(day(0)))[0]).toMatchObject({ status: 'rejected', advertiserId: 'nestle', reason: 'Nestlé is not an invited buyer on this private auction (E2E deal).' })
    const nestle = await h.readyApiCampaign('Nestlé — P3', 'localised', 'nestle')
    const api = await h.partner.bid(nestle, day(1), 400, { advertiserId: 'nestle' })
    expect(api.statusCode).toBe(422)
    expect(api.json().error).toMatchObject({ code: 'not_invited', message: 'Nestlé is not an invited buyer on this private auction (E2E deal).' })
    expect((await runAuction(h.ctx, day(1))).positions[0].winner).toBeNull()
    expect(booked(h, day(1))).toEqual([])
  })

  it('P4 — an empty resolved buyers list admits nobody; the window falls through to the default campaign', async () => {
    const h = await dealHarness({ invited: [{ partnerId: 'p_google', seatId: 'no-such-seat' }] })
    const campaignId = await h.readyApiCampaign('Swisse — P4')
    const out = await runAuction(h.ctx, day(0))
    expect(out.positions[0]).toMatchObject({ bidRequests: 0, bids: 0, winner: null })
    expect((await h.partner.bid(campaignId, day(1), 500)).statusCode).toBeGreaterThanOrEqual(400)
    /* The list deleted outright: the same. */
    await h.ctx.buyersLists.delete(h.list.id)
    expect((await runAuction(h.ctx, day(2))).positions[0]).toMatchObject({ bidRequests: 0, winner: null })
    expect(h.campaigns.handoffs.filter((b) => b.displayTypeId === DT)).toEqual([])
  })

  /* Regression for backlog swTmcohycEecL6gEoRE9 (found by the E2E v2 run, 29 Sep
     2026; fixed on main since). */
  it('P5 — a bid for a window outside activeFrom–activeTo is refused (whatever the clock says)', async () => {
    /* Term: 22–23 Sep (day(1)–day(2)). */
    /* The creative is retrieved and approved on the open slot first. */
    const h = await dealHarness({ activeFrom: day(1).toISOString(), activeTo: '2026-09-23T23:59:59.000Z', before: (x) => x.approvedCrid('crid-p5', day(0)) })
    /* Mid-term, a DSP bid for 25 Sep — after the term — must not win. */
    h.setNow(new Date('2026-09-22T12:00:00.000Z'))
    const after = await runAuction(h.ctx, day(4))
    expect(after.positions[0].winner, 'a window after activeTo was sold to the invited buyer').toBeNull()
    expect(booked(h, day(4))).toEqual([])
    /* Before the term starts, bidding for an in-term window (open 7 days ahead) is admitted. */
    h.setNow(new Date('2026-09-20T10:00:00.000Z'))
    const inTerm = await runAuction(h.ctx, day(2))
    expect(inTerm.positions[0].winner, 'an in-term window was refused because the clock is before activeFrom').toMatchObject({ advertiserId: 'swisse' })
  })

  /* Regression for backlog 6bln0UlpqE6xh7E8SGtX (found by the E2E v2 run, 29 Sep
     2026; fixed on main since). */
  it('P5 — a bid after auctionCloses is refused, never left pending', async () => {
    const h = await dealHarness({ auctionCloses: '2026-09-20T12:00:00.000Z' })
    const id = await h.readyApiCampaign('Swisse — P5 closes')
    h.setNow(new Date('2026-09-20T13:00:00.000Z'))
    const late = await h.partner.bid(id, day(2), 200)
    expect(late.statusCode, 'an API bid placed after auctionCloses was accepted').toBeGreaterThanOrEqual(400)
    const out = await runAuction(h.ctx, day(2))
    expect(out.positions[0]).toMatchObject({ bidRequests: 0, winner: null })
    expect((await h.rows(day(2))).filter((r) => r.status === 'pending'), 'a bid was left pending after the position was skipped').toEqual([])
  })

  it('P6 — an invited buyer below the slot floor doesn’t win (the deal doesn’t lower the floor)', async () => {
    const h = await dealHarness()
    await h.approvedCrid('crid-p6', day(0))
    h.bidder.setScript((req) => ({ body: response(req, [swisseBid(req, { price: 99, crid: 'crid-p6' })]) }))
    expect((await runAuction(h.ctx, day(1))).positions[0].winner).toBeNull()
    expect((await h.rows(day(1)))[0]).toMatchObject({ status: 'rejected', reason: '99 is below the effective floor of 100 AUD CPM.' })
    const id = await h.readyApiCampaign('Swisse — P6')
    expect((await h.partner.bid(id, day(2), 99)).json().error.code).toBe('below_floor')
    expect(booked(h, day(1))).toEqual([])
  })

  it('P7 — an invited buyer that is blocked (advertiser blacklist) is refused with the reason', async () => {
    const h = await dealHarness()
    await h.approvedCrid('crid-p7', day(0))
    await h.ctx.partners.update('p_google', { blockList: ['5130002'] })
    expect((await runAuction(h.ctx, day(1))).positions[0].winner).toBeNull()
    expect((await h.rows(day(1)))[0]).toMatchObject({ status: 'rejected', reason: 'Swisse is on the advertiser blacklist.' })
    const id = (await h.queuedCampaign('crid-p7'))!
    void id
    /* Cleared, then blocked again: the DSP's own blocklist is the only one. */
    await h.ctx.partners.update('p_google', { blockList: [] })
    await h.ctx.partners.update('p_google', { blockList: ['5130002'], allowList: [] })
    expect((await runAuction(h.ctx, day(2))).positions[0].winner).toBeNull()
    expect((await h.rows(day(2)))[0]).toMatchObject({ status: 'rejected', reason: 'Swisse is on the advertiser blacklist.' })
  })

  it('P8 — the approval gate still applies: an invited buyer with an unapproved creative is discarded pre-auction', async () => {
    const h = await dealHarness()
    await h.bidder.control({ crid: 'crid-p8' })
    await runAuction(h.ctx, day(0))
    await runAuction(h.ctx, day(1))
    expect((await h.rows(day(1)))[0]).toMatchObject({ status: 'rejected', reason: 'The campaign is not approved.' })
    const { id } = await h.submitApiCampaign('Swisse — P8')
    await h.partner.upload(id, 'default', png(1920, 1080, 1))
    expect((await h.partner.bid(id, day(2), 300)).json().error.code).toBe('not_approved')
    expect(booked(h, day(1))).toEqual([])
  })
})
