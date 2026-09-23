/* Security and scalability hardening (review, 23 Sep 2026). Each test pins
   one defect the review reproduced, so it can't come back unnoticed:
   - two clearings of one window must never sell it twice (migration 0021);
   - a DSP's bid response is validated and bounded before it is trusted;
   - a creative URL can't escape the DSP's creative path;
   - one unknown creative is retrieved per response, once across auctions. */
import { describe, expect, it } from 'vitest'
import { runAuction } from '../src/exchange/auction'
import { underBase } from '../src/exchange/creatives'
import { httpBidder, readCapped } from '../src/dsp/bidder'
import type { BidRequest, BidResponse } from '../src/exchange/openrtb'
import { buildApp } from '../src/http/app'
import { NOW, mockDsps, testContext } from './helpers'
import { openDb } from '../src/db/db'
import { migrateUp } from '../src/db/migrate'

const W1 = new Date('2026-09-21T00:00:00.000Z')
const W2 = new Date('2026-09-22T00:00:00.000Z')
const POS = 'menu_board.s2'

/* The auction against the mock DSPs, with two test hooks on bid requests:
   `delayMs` holds each bid response (so two auctions genuinely overlap), and
   `rewrite` edits the mock's response before the exchange sees it. */
async function setup() {
  const mocks = mockDsps()
  const hooks: { delayMs: number; rewrite?: (res: BidResponse, req: BidRequest) => unknown } = { delayMs: 0 }
  const fetchImpl: typeof mocks.fetchImpl = async (url, init) => {
    const res = await mocks.fetchImpl(url, init)
    if (!url.includes('/openrtb2/bid')) return res
    if (hooks.delayMs) await new Promise((r) => setTimeout(r, hooks.delayMs))
    if (!hooks.rewrite || res.status !== 200) return res
    const body = hooks.rewrite((await res.json()) as BidResponse, JSON.parse(String(init?.body)) as BidRequest)
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  const ctx = await testContext({ clock: () => NOW, dspFetch: fetchImpl })
  const app = buildApp(ctx)
  const rows = (start = W1) => ctx.reservations.forWindow(POS, start.toISOString())
  /* Nestlé's first bid queues its creative (approved automatically); activate
     it so it can win from the next window. */
  const readyToWin = async () => {
    await runAuction(ctx, W1)
    const c = (await ctx.approvalCampaigns.listCampaigns({ sources: ['dsp'] })).find((x) => x.name === 'Nestlé — crid-5130001')!
    await app.inject({ method: 'PUT', url: `/api/admin/v1/campaigns/${c.campaignId}/activation`, payload: { enabled: true } })
    return c.campaignId
  }
  return { ctx, hooks, rows, readyToWin }
}

describe('one live sale per position and window', () => {
  it('two auctions clearing the same window at once sell it once, and book it once', async () => {
    const { ctx, hooks, rows, readyToWin } = await setup()
    const campaignId = await readyToWin()
    hooks.delayMs = 50
    const [a, b] = await Promise.all([runAuction(ctx, W2), runAuction(ctx, W2)])
    const winners = [a, b].map((r) => r.positions.find((p) => p.positionId === POS)!.winner).filter(Boolean)
    expect(winners).toHaveLength(1)
    expect(rows(W2).filter((r) => r.status === 'won' && !r.testMode)).toHaveLength(1)
    /* The loser's candidate is told why, not left pending. */
    expect(rows(W2).filter((r) => r.status === 'pending')).toHaveLength(0)
    expect(ctx.campaigns.bookings(campaignId).filter((bk) => bk.windowStart === W2.toISOString())).toHaveLength(1)
  })

  it('the database refuses a second live winner, but not a Test-mode one', async () => {
    const { ctx } = await setup()
    const row = (over: Record<string, unknown>) => ({
      id: `res_${Math.random().toString(16).slice(2, 10)}`, partnerId: 'p_google', advertiserId: 'nestle', campaignId: null, positionId: POS,
      windowStart: W2.toISOString(), type: 'bid' as const, channel: 'openrtb' as const, bidCpm: 150, currency: 'AUD', status: 'won' as const,
      clearingCpm: 150, reason: null, testMode: false, pricingType: 'localised', handedOffAt: null, ...over,
    })
    ctx.reservations.insert(row({}))
    expect(() => ctx.reservations.insert(row({ status: 'reserved' }))).toThrow(/UNIQUE constraint failed/)
    expect(() => ctx.reservations.insert(row({ testMode: true }))).not.toThrow()
    expect(() => ctx.reservations.insert(row({ status: 'lost' }))).not.toThrow()
  })
})

describe('migration 0021 on a database that already sold a window twice', () => {
  it('keeps the earliest winner and booking, marks the rest, then enforces uniqueness', () => {
    const db = openDb(':memory:')
    migrateUp(db, '0020')
    const res = db.prepare(`INSERT INTO reservations (id, partner_id, position_id, window_start, type, channel, currency, status, test_mode, created_at, updated_at)
      VALUES (?, 'p_google', 'menu_board.s2', '2026-09-22T00:00:00.000Z', 'bid', 'openrtb', 'AUD', ?, ?, ?, ?)`)
    res.run('r1', 'won', 0, '2026-09-20T18:00:00.000Z', '2026-09-20T18:00:00.000Z')
    res.run('r2', 'won', 0, '2026-09-20T18:00:01.000Z', '2026-09-20T18:00:01.000Z')
    res.run('r3', 'won', 1, '2026-09-20T18:00:02.000Z', '2026-09-20T18:00:02.000Z')
    const bk = db.prepare(`INSERT INTO campaign_slot_bookings (id, campaign_id, display_type_id, slot, window_start, window_end, created_at)
      VALUES (?, ?, 'menu_board', 2, '2026-09-22T00:00:00.000Z', '2026-09-23T00:00:00.000Z', ?)`)
    bk.run('b1', 'c1', '2026-09-20T18:00:00.000Z')
    bk.run('b2', 'c2', '2026-09-20T18:00:01.000Z')
    migrateUp(db)
    const status = Object.fromEntries((db.prepare('SELECT id, status FROM reservations ORDER BY id').all() as { id: string; status: string }[]).map((r) => [r.id, r.status]))
    /* The Test-mode win is left alone: it never took the window. */
    expect(status).toEqual({ r1: 'won', r2: 'lost', r3: 'won' })
    expect((db.prepare('SELECT id FROM campaign_slot_bookings').all() as { id: string }[]).map((r) => r.id)).toEqual(['b1'])
    expect(() => res.run('r4', 'reserved', 0, '2026-09-20T18:00:03.000Z', '2026-09-20T18:00:03.000Z')).toThrow(/UNIQUE/)
  })
})

describe('bid responses are validated before they are trusted', () => {
  it('treats a response with no currency as USD (OpenRTB default), not the exchange currency', async () => {
    const { ctx, hooks, rows, readyToWin } = await setup()
    await readyToWin()
    hooks.rewrite = (res) => ({ ...res, cur: undefined })
    const out = await runAuction(ctx, W2)
    expect(out.positions[0].winner).toBeNull()
    expect(rows(W2)[0]).toMatchObject({ status: 'rejected', reason: 'Bid in USD; the exchange trades in AUD.' })
  })

  it('rejects a price above the ceiling and a bid for an impression it was not offered', async () => {
    const { ctx, hooks, rows, readyToWin } = await setup()
    await readyToWin()
    hooks.rewrite = (res) => ({ ...res, seatbid: res.seatbid!.map((sb) => ({ ...sb, bid: sb.bid!.map((b) => ({ ...b, price: 1e9 })) })) })
    await runAuction(ctx, W2)
    expect(rows(W2)[0].reason).toBe('Bid of 1000000000 AUD CPM is above the exchange\'s ceiling of 10000.')
    const W3 = new Date('2026-09-23T00:00:00.000Z')
    hooks.rewrite = (res) => ({ ...res, seatbid: res.seatbid!.map((sb) => ({ ...sb, bid: sb.bid!.map((b) => ({ ...b, impid: '7' })) })) })
    await runAuction(ctx, W3)
    expect(rows(W3)[0].reason).toBe('Bid for impression 7; the request offered impression 1.')
  })

  it('ignores a response to some other request id', async () => {
    const { ctx, hooks, rows, readyToWin } = await setup()
    await readyToWin()
    hooks.rewrite = (res) => ({ ...res, id: 'someone-elses-request' })
    const out = await runAuction(ctx, W2)
    expect(out.positions[0]).toMatchObject({ bidRequests: 1, bids: 0, winner: null })
    expect(rows(W2)).toEqual([])
  })

  /* 150 bids stays under the 64 KB response cap, so this isolates the count cap. */
  it('reads at most MAX_BIDS_PER_RESPONSE bids, so a DSP cannot flood the reservations table', async () => {
    const { ctx, hooks, rows, readyToWin } = await setup()
    await readyToWin()
    hooks.rewrite = (res) => ({ ...res, seatbid: res.seatbid!.map((sb) => ({ ...sb, bid: Array.from({ length: 150 }, (_, i) => ({ ...sb.bid![0], id: `b${i}` })) })) })
    const out = await runAuction(ctx, W2)
    expect(out.positions[0].bids).toBe(10)
    expect(rows(W2)).toHaveLength(10)
    expect(out.positions[0].winner).not.toBeNull()
  })

  it('retrieves one unknown creative per response; the rest wait for a later window', async () => {
    const { ctx, hooks, rows } = await setup()
    hooks.rewrite = (res) => ({ ...res, seatbid: res.seatbid!.map((sb) => ({ ...sb, bid: [0, 1, 2].map((i) => ({ ...sb.bid![0], id: `b${i}`, crid: `${sb.bid![0].crid}-${i}` })) })) })
    await runAuction(ctx, W1)
    const reasons = rows().map((r) => r.reason)
    expect(reasons.filter((r) => /approved automatically|queued for approval/.test(r ?? ''))).toHaveLength(1)
    expect(reasons.filter((r) => /retrieved for review from a later window/.test(r ?? ''))).toHaveLength(2)
  })

  it('retrieves a creative once even when two auctions see it at the same time', async () => {
    const { ctx, hooks } = await setup()
    hooks.delayMs = 30
    await Promise.all([runAuction(ctx, W1), runAuction(ctx, W2)])
    const dsp = await ctx.approvalCampaigns.listCampaigns({ sources: ['dsp'] })
    expect(dsp.filter((c) => c.name === 'Nestlé — crid-5130001')).toHaveLength(1)
  })
})

describe('bounded reads from DSPs', () => {
  const big = (n: number, headers: Record<string, string> = {}) => new Response('x'.repeat(n), { headers })

  it('readCapped returns the body under the cap and null over it, declared or streamed', async () => {
    expect((await readCapped(big(10), 16))!.toString()).toBe('xxxxxxxxxx')
    expect(await readCapped(big(10, { 'content-length': '999999' }), 16)).toBeNull()
    expect(await readCapped(big(100), 16)).toBeNull()
  })

  it('an oversized bid response is no bid', async () => {
    const bidder = httpBidder(async () => new Response(JSON.stringify({ id: 'r', seatbid: [], pad: 'x'.repeat(100_000) }), { status: 200 }), { timeoutMs: 300, qps: 1000, maxResponseBytes: 64 * 1024 })
    expect(await bidder.send('http://dsp.test/bid', {} as BidRequest)).toBeNull()
  })

  it('a creative URL must stay under the DSP creative path after normalisation', () => {
    const base = 'http://mocks.test/dv360/creatives/'
    expect(underBase('http://mocks.test/dv360/creatives/a.png?w=1', base)).toBe(true)
    expect(underBase('http://mocks.test/dv360/creatives/../../ttd/creatives/a.png', base)).toBe(false)
    expect(underBase('http://mocks.test/dv360/creatives/%2e%2e/%2e%2e/admin', base)).toBe(false)
    expect(underBase('http://evil.test/dv360/creatives/a.png', base)).toBe(false)
    expect(underBase('http://user:pw@mocks.test/dv360/creatives/a.png', base)).toBe(false)
    expect(underBase('not a url', base)).toBe(false)
  })
})
