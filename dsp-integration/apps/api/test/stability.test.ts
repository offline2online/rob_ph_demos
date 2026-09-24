/* Stability under concurrency and at the edges (review, 24 Sep 2026).
   Every case here was tried against the code before the fix it pins, and
   the ones marked "reproduced" failed then:
   - simultaneous bids and reservations for one window, from one advertiser
     and from several, at the awaits inside the route and across processes;
   - a bid placed while the auction is waiting on the bidders (reproduced:
     it was stranded pending for ever);
   - a DSP whose answer isn't a BidResponse (reproduced: one bad answer took
     the whole auction down, and the tick retried it for ever);
   - a fault in one scheduled job (reproduced: billing failing stopped the
     auction due in the same minute);
   - a cutoff missed by more than an hour (reproduced: the window was never
     auctioned and its bids never settled);
   - an API bid with no ceiling (reproduced: a 1e12 CPM bid was taken);
   - claims, takeovers and re-runs of the scheduled auction;
   - what a partner can send in a reservation body. */
import { describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Slot } from '@ph-dsp/types'
import { runAuction } from '../src/exchange/auction'
import { runBilling, lineItems } from '../src/exchange/billing'
import { claimAuction, schedulerTick } from '../src/exchange/scheduler'
import type { BidRequest, BidResponse } from '../src/exchange/openrtb'
import { buildApp } from '../src/http/app'
import { openDb, prepared } from '../src/db/db'
import { migrateUp } from '../src/db/migrate'
import { createContext } from '../src/context'
import { loadConfig } from '../src/config'
import { staticFlags } from '../src/flags/Flags'
import { staticSession } from '../src/auth/session'
import { aesGcmSecretsStore } from '../src/secrets/SecretsStore'
import { seed } from '../src/seed/seed'
import { NOW, TEST_KEY, mockDsps, testContext } from './helpers'

const GOOGLE = { authorization: 'Bearer poc-token-google-dv360' }
const W1 = new Date('2026-09-21T00:00:00.000Z')
const W2 = new Date('2026-09-22T00:00:00.000Z')
const POS = 'menu_board.s2'
const SWISSE = { positionId: POS, windowStart: W1.toISOString(), campaignId: 'c_api_swisse', advertiserId: 'swisse', type: 'bid', bidCpm: 200 }
/* Nestlé's campaign is seeded approved and activated, so it can bid through the API too. */
const NESTLE = { ...SWISSE, campaignId: 'c_dsp_nestle', advertiserId: 'nestle', bidCpm: 150 }
/* 18:00 UTC on 20 Sep is W1's auction cutoff (seed: auctionCutoffTime 18:00). */
const AT_CUTOFF = new Date('2026-09-20T18:00:30.000Z')

async function setup(clock: () => Date = () => NOW) {
  const mocks = mockDsps()
  const hooks: { delayMs: number; rewrite?: (res: BidResponse, req: BidRequest) => unknown } = { delayMs: 0 }
  const fetchImpl: typeof mocks.fetchImpl = async (url, init) => {
    const res = await mocks.fetchImpl(url, init)
    if (!url.includes('/openrtb2/bid')) return res
    if (hooks.delayMs) await new Promise((r) => setTimeout(r, hooks.delayMs))
    if (!hooks.rewrite || res.status !== 200) return res
    const body = hooks.rewrite((await res.json()) as BidResponse, JSON.parse(String(init?.body)) as BidRequest)
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  const ctx = await testContext({ clock, dspFetch: fetchImpl })
  /* Capacity, not the limiter, is under test. */
  ctx.config.partnerRateLimit = { perSecond: 100_000, burst: 100_000 }
  const app = buildApp(ctx)
  const reserve = (body: Record<string, unknown>) => app.inject({ method: 'POST', url: '/api/v1/reservations', headers: GOOGLE, payload: body })
  const ready = async () => {
    await app.inject({ method: 'POST', url: '/api/admin/v1/campaigns/c_api_swisse/approve', payload: { assetVersion: 'v1' } })
    await app.inject({ method: 'PUT', url: '/api/admin/v1/campaigns/c_api_swisse/activation', payload: { enabled: true } })
  }
  const setSlot = (patch: Partial<Slot>) => {
    const ext = ctx.displayTypes.get('menu_board')!.phExtensions!
    ctx.displayTypes.saveExtensions('menu_board', { ...ext, slots: ext.slots.map((s, i) => (i === 1 ? { ...s, ...patch } : s)) })
  }
  const rows = (start = W1) => ctx.reservations.forWindow(POS, start.toISOString())
  const status = (rs: ReturnType<typeof rows>) => rs.map((r) => `${r.channel}:${r.advertiserId}:${r.status}`).sort()
  const tick = async (c = ctx) => {
    const logs: string[] = []
    let error: string | null = null
    await schedulerTick(c, (m) => logs.push(m)).catch((e) => { error = (e as Error).message })
    return { logs, error }
  }
  const claims = () => prepared(ctx.db, 'SELECT * FROM auction_runs ORDER BY window_start').all() as { window_start: string; claimed_by: string; finished_at: string | null; claimed_at: string }[]
  return { ctx, app, hooks, reserve, ready, setSlot, rows, status, tick, claims }
}

describe('simultaneous bids and reservations for one window', () => {
  it('an advertiser sending the same bid eight times at once holds exactly one', async () => {
    const { reserve, ready, rows } = await setup()
    await ready()
    const res = await Promise.all(Array.from({ length: 8 }, () => reserve(SWISSE)))
    const codes = res.map((r) => r.statusCode).sort()
    expect(codes).toEqual([201, 409, 409, 409, 409, 409, 409, 409])
    for (const r of res.filter((x) => x.statusCode === 409)) expect(r.json().error.message).toBe('This advertiser already has a reservation or bid for that window.')
    expect(rows().filter((r) => r.status === 'pending')).toHaveLength(1)
  })

  it('the database refuses a second open API bid for an advertiser and window even when the route’s check is bypassed', async () => {
    const { ctx } = await setup()
    const row = (over: Record<string, unknown>) => ({
      id: `res_${Math.random().toString(16).slice(2, 10)}`, partnerId: 'p_google', advertiserId: 'swisse', campaignId: 'c_api_swisse', positionId: POS,
      windowStart: W2.toISOString(), type: 'bid' as const, channel: 'api' as const, bidCpm: 150, currency: 'AUD', status: 'pending' as const,
      clearingCpm: null, reason: null, testMode: false, pricingType: 'localised', handedOffAt: null, ...over,
    })
    ctx.reservations.insert(row({}))
    expect(() => ctx.reservations.insert(row({}))).toThrow(/UNIQUE constraint failed/)
    /* Settled rows, another advertiser, and a DSP's bids are not in the way. */
    expect(() => ctx.reservations.insert(row({ status: 'lost' }))).not.toThrow()
    expect(() => ctx.reservations.insert(row({ advertiserId: 'nestle', campaignId: 'c_dsp_nestle' }))).not.toThrow()
    expect(() => ctx.reservations.insert(row({ channel: 'openrtb' }))).not.toThrow()
  })

  it('migration 0026 keeps the earliest of an advertiser’s duplicate bids and marks the rest lost', () => {
    const db = openDb(':memory:')
    migrateUp(db, '0025')
    const ins = db.prepare("INSERT INTO reservations (id, partner_id, advertiser_id, position_id, window_start, type, channel, bid_cpm, currency, status, created_at, updated_at) VALUES (?, 'p_google', 'swisse', ?, ?, 'bid', 'api', 100, 'AUD', 'pending', ?, ?)")
    ins.run('r1', POS, W1.toISOString(), '2026-09-20T09:00:00Z', '2026-09-20T09:00:00Z')
    ins.run('r2', POS, W1.toISOString(), '2026-09-20T09:00:01Z', '2026-09-20T09:00:01Z')
    ins.run('r3', POS, W2.toISOString(), '2026-09-20T09:00:02Z', '2026-09-20T09:00:02Z')
    migrateUp(db, '0026')
    const rows = db.prepare('SELECT id, status, reason FROM reservations ORDER BY id').all() as { id: string; status: string; reason: string | null }[]
    expect(rows.map((r) => [r.id, r.status])).toEqual([['r1', 'pending'], ['r2', 'lost'], ['r3', 'pending']])
    expect(rows[1].reason).toMatch(/migration 0026/)
    expect(() => ins.run('r4', POS, W1.toISOString(), '2026-09-20T09:00:03Z', '2026-09-20T09:00:03Z')).toThrow(/UNIQUE constraint failed/)
  })

  it('two advertisers bidding at the same moment both hold a bid; the higher wins and the other is told it was outbid', async () => {
    const { ctx, reserve, ready, rows } = await setup()
    await ready()
    const codes = (await Promise.all([reserve(SWISSE), reserve(NESTLE), reserve(SWISSE), reserve(NESTLE)])).map((r) => r.statusCode).sort()
    expect(codes).toEqual([201, 201, 409, 409])
    const out = await runAuction(ctx, W1)
    expect(out.positions[0].winner).toMatchObject({ advertiserId: 'swisse', clearingCpm: 200 })
    expect(rows().find((r) => r.advertiserId === 'nestle' && r.channel === 'api')).toMatchObject({ status: 'lost', reason: 'Outbid: the window cleared at 200 AUD CPM.' })
    expect(rows().filter((r) => r.status === 'pending')).toHaveLength(0)
  })

  it('equal bids: the one placed first wins, whichever order the auction read them in', async () => {
    let t = NOW
    const { ctx, reserve, ready } = await setup(() => t)
    await ready()
    expect((await reserve({ ...NESTLE, bidCpm: 200 })).statusCode).toBe(201)
    t = new Date(NOW.getTime() + 1000)
    expect((await reserve(SWISSE)).statusCode).toBe(201)
    const out = await runAuction(ctx, W1)
    expect(out.positions[0].winner).toMatchObject({ advertiserId: 'nestle', clearingCpm: 200 })
  })

  it('six reservations at once for a position held for one advertiser book it once', async () => {
    const { ctx, reserve, ready, setSlot, rows } = await setup()
    await ready()
    setSlot({ listMode: null, advertisers: ['Swisse'] })
    const res = await Promise.all(Array.from({ length: 6 }, () => reserve({ ...SWISSE, type: 'reserve' })))
    expect(res.map((r) => r.statusCode).sort()).toEqual([201, 409, 409, 409, 409, 409])
    expect(rows().filter((r) => r.status === 'reserved')).toHaveLength(1)
    expect(ctx.campaigns.bookings('c_api_swisse').filter((b) => b.windowStart === W1.toISOString()).length).toBeLessThanOrEqual(1)
  })
})

describe('a bid arriving while the auction is running', () => {
  it('placed while the bidders are answering, it is in this auction — never left pending', async () => {
    const { ctx, hooks, reserve, ready, rows } = await setup()
    await ready()
    hooks.delayMs = 120
    const auction = runAuction(ctx, W1)
    await new Promise((r) => setTimeout(r, 40))
    expect((await reserve(SWISSE)).statusCode).toBe(201)
    const out = await auction
    expect(out.positions[0].winner).toMatchObject({ advertiserId: 'swisse', clearingCpm: 200 })
    expect(rows().filter((r) => r.status === 'pending')).toHaveLength(0)
  })

  it('once a tick has claimed the window’s auction, a bid is refused even if this process’s clock is still before the cutoff', async () => {
    const { ctx, reserve, ready } = await setup()
    await ready()
    expect(claimAuction(ctx, W1.toISOString())).toBe(true)
    const res = await reserve(SWISSE)
    expect(res.statusCode).toBe(409)
    expect(res.json().error.message).toMatch(/^Bidding for that window closed at/)
    /* Another window is unaffected. */
    expect((await reserve({ ...SWISSE, windowStart: W2.toISOString() })).statusCode).toBe(201)
  })

  it('anything still pending when the position clears is settled with a reason', async () => {
    const { ctx, reserve, ready, rows } = await setup()
    await ready()
    /* A bid that slips in at the last await inside the auction (the
       approval check) — simulated by inserting it from that check. */
    const eligible = ctx.approvals.isCampaignEligible.bind(ctx.approvals)
    let slipped = false
    ctx.approvals.isCampaignEligible = async (id) => {
      const ok = await eligible(id)
      if (!slipped) {
        slipped = true
        await reserve(NESTLE)
      }
      return ok
    }
    expect((await reserve(SWISSE)).statusCode).toBe(201)
    slipped = false
    await runAuction(ctx, W1)
    const pending = rows().filter((r) => r.status === 'pending')
    expect(pending).toHaveLength(0)
    expect(rows().find((r) => r.advertiserId === 'nestle' && r.channel === 'api')!.status).toMatch(/lost/)
  })
})

describe('a DSP whose answer is not a bid response', () => {
  const SHAPES: [string, (res: BidResponse) => unknown][] = [
    ['seatbid is an object', (res) => ({ id: res.id, seatbid: { bid: [] } })],
    ['bid is a string', (res) => ({ id: res.id, seatbid: [{ seat: '884512', bid: 'nope' }] })],
    ['a bid is null', (res) => ({ id: res.id, seatbid: [{ seat: '884512', bid: [null, 7] }] })],
    ['a seatbid is null', (res) => ({ id: res.id, seatbid: [null] })],
    ['seat is not a string', (res) => ({ id: res.id, seatbid: [{ seat: 884512, bid: [{ price: 5 }] }] })],
    ['the body is a JSON string', () => '"just a string"'],
    ['the body is a JSON number', () => '42'],
    ['the body is an array', () => '[]'],
  ]
  for (const [name, rewrite] of SHAPES) {
    it(`${name}: the auction still clears, and the API bid still wins`, async () => {
      const { ctx, hooks, reserve, ready, rows } = await setup()
      await ready()
      expect((await reserve(SWISSE)).statusCode).toBe(201)
      hooks.rewrite = rewrite
      const out = await runAuction(ctx, W1)
      expect(out.positions[0].skipped).toBeUndefined()
      expect(out.positions[0].winner).toMatchObject({ advertiserId: 'swisse' })
      expect(rows().filter((r) => r.status === 'pending')).toHaveLength(0)
    })
  }

  it('a fault while clearing one position is that position’s outcome; the tick finishes and the claim is kept', async () => {
    let t = NOW
    const { ctx, reserve, ready, rows, tick, claims } = await setup(() => t)
    await ready()
    expect((await reserve(SWISSE)).statusCode).toBe(201)
    const insert = ctx.reservations.insert
    ctx.reservations.insert = (r) => {
      if (r.channel === 'openrtb') throw new Error('reservations store refused the write')
      return insert(r)
    }
    t = AT_CUTOFF
    const { logs, error } = await tick()
    expect(error).toBeNull()
    expect(logs).toContain('Auction cleared 2026-09-21T00:00:00.000Z: 0 of 1 positions won, 1 failed.')
    expect(rows().filter((r) => r.status === 'pending')).toHaveLength(0)
    expect(rows().find((r) => r.channel === 'api')).toMatchObject({ status: 'lost', reason: 'The auction for this position failed: reservations store refused the write' })
    expect(claims()).toMatchObject([{ window_start: W1.toISOString(), finished_at: expect.any(String) }])
  })
})

describe('the scheduled tick', () => {
  const billableRow = (ctx: Awaited<ReturnType<typeof setup>>['ctx']) =>
    ctx.reservations.insert({
      id: 'res_ended', partnerId: 'p_google', advertiserId: 'swisse', campaignId: 'c_api_swisse', positionId: POS, windowStart: '2026-09-18T00:00:00.000Z',
      type: 'bid', channel: 'api', bidCpm: 200, currency: 'AUD', status: 'won', clearingCpm: 200, reason: null, testMode: false, pricingType: 'localised', handedOffAt: '2026-09-17T18:00:00.000Z',
    })

  it('a billing fault is logged and reported, and the auction due in the same minute still runs', async () => {
    let t = NOW
    const { ctx, reserve, ready, rows, tick } = await setup(() => t)
    await ready()
    expect((await reserve(SWISSE)).statusCode).toBe(201)
    billableRow(ctx)
    ctx.playback.totals = () => { throw new Error('playback store down') }
    t = AT_CUTOFF
    const { logs, error } = await tick()
    expect(logs).toContain('Billing failed: playback store down')
    expect(logs.some((l) => l.startsWith('Auction cleared 2026-09-21'))).toBe(true)
    expect(error).toBe('Scheduler tick: Billing: playback store down')
    expect(rows().find((r) => r.channel === 'api')!.status).toBe('won')
    expect(lineItems(ctx)).toHaveLength(0)
  })

  it('a cutoff missed by hours is still auctioned while the window hasn’t started', async () => {
    let t = NOW
    const { reserve, ready, rows, tick } = await setup(() => t)
    await ready()
    expect((await reserve(SWISSE)).statusCode).toBe(201)
    t = new Date('2026-09-20T23:30:00.000Z')
    const { logs } = await tick()
    expect(logs.some((l) => l.startsWith('Auction cleared 2026-09-21'))).toBe(true)
    expect(rows().find((r) => r.channel === 'api')!.status).toBe('won')
  })

  it('a window that started with no auction settles its bids as lost instead of leaving them pending', async () => {
    let t = NOW
    const { ctx, reserve, ready, rows, tick } = await setup(() => t)
    await ready()
    expect((await reserve(SWISSE)).statusCode).toBe(201)
    t = new Date('2026-09-21T06:00:00.000Z')
    const { logs } = await tick()
    expect(logs).toContain('Settled 1 bid for windows that started without an auction.')
    expect(logs.some((l) => l.startsWith('Auction cleared 2026-09-21'))).toBe(false)
    expect(rows().find((r) => r.channel === 'api')).toMatchObject({ status: 'lost', reason: 'The window started with no auction clearing this bid; nothing was sold.' })
    expect(ctx.reservations.stalePending(t.toISOString())).toHaveLength(0)
  })

  it('two ticks at once in one process clear the window once', async () => {
    let t = NOW
    const { hooks, reserve, ready, tick } = await setup(() => t)
    await ready()
    expect((await reserve(SWISSE)).statusCode).toBe(201)
    hooks.delayMs = 50
    t = AT_CUTOFF
    const [a, b] = await Promise.all([tick(), tick()])
    expect([...a.logs, ...b.logs].filter((l) => l.startsWith('Auction cleared'))).toHaveLength(1)
    /* And a tick after that has nothing to clear. */
    expect((await tick()).logs.filter((l) => l.startsWith('Auction cleared'))).toHaveLength(0)
  })

  it('takes over a claim left unfinished for 15 minutes, and leaves a fresher one alone', async () => {
    let t = AT_CUTOFF
    const { ctx, tick, claims } = await setup(() => t)
    const claim = (ageMin: number) => prepared(ctx.db, "INSERT OR REPLACE INTO auction_runs (window_start, claimed_at, claimed_by, finished_at) VALUES (?, ?, 'other-host:1', NULL)")
      .run(W1.toISOString(), new Date(t.getTime() - ageMin * 60_000).toISOString())
    claim(14)
    expect((await tick()).logs.filter((l) => l.startsWith('Auction cleared'))).toHaveLength(0)
    expect(claims()[0].claimed_by).toBe('other-host:1')
    claim(16)
    expect((await tick()).logs.filter((l) => l.startsWith('Auction cleared'))).toHaveLength(1)
    expect(claims()[0]).toMatchObject({ claimed_by: expect.not.stringMatching(/^other-host/), finished_at: expect.any(String) })
  })

  it('an auction that throws outright releases its claim, and the next tick runs it', async () => {
    const { ctx, tick, claims } = await setup(() => AT_CUTOFF)
    const list = ctx.partners.list
    ctx.partners.list = () => { throw new Error('partners store down') }
    const first = await tick()
    expect(first.error).toBe('Scheduler tick: Auction: partners store down')
    expect(claims()).toHaveLength(0)
    ctx.partners.list = list
    const second = await tick()
    expect(second.error).toBeNull()
    expect(second.logs.filter((l) => l.startsWith('Auction cleared'))).toHaveLength(1)
  })

  it('finished claims older than the bid retention are swept; recent and unfinished ones are kept', async () => {
    const { ctx, tick, claims } = await setup(() => NOW)
    const ins = prepared(ctx.db, 'INSERT INTO auction_runs (window_start, claimed_at, claimed_by, finished_at) VALUES (?, ?, ?, ?)')
    ins.run('2026-01-01T00:00:00.000Z', '2025-12-31T18:00:00Z', 'x', '2025-12-31T18:01:00Z')
    ins.run('2026-01-02T00:00:00.000Z', '2026-01-01T18:00:00Z', 'x', null)
    ins.run('2026-09-01T00:00:00.000Z', '2026-08-31T18:00:00Z', 'x', '2026-08-31T18:01:00Z')
    await tick()
    expect(claims().map((c) => c.window_start)).toEqual(['2026-01-02T00:00:00.000Z', '2026-09-01T00:00:00.000Z'])
  })

  it('switched off, the tick still bills and settles but never claims an auction', async () => {
    let t = NOW
    const { ctx, reserve, ready, tick, claims } = await setup(() => t)
    await ready()
    expect((await reserve(SWISSE)).statusCode).toBe(201)
    billableRow(ctx)
    ctx.exchange.save({ ...ctx.exchange.get(), enabled: false })
    t = AT_CUTOFF
    const { logs, error } = await tick()
    expect(error).toBeNull()
    /* The seed's own past window is billable too. */
    expect(logs).toContainEqual(expect.stringMatching(/^Billed \d+ ended windows?\.$/))
    expect(claims()).toHaveLength(0)
  })
})

describe('billing when two processes tick at once', () => {
  it('writes one line item per window and neither tick throws', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'ph-bill-')), 'poc.sqlite')
    const make = () => createContext({
      config: { ...loadConfig({ DSP_MOCKS_URL: 'http://mocks.test' }), dbFile: file, assetsDir: mkdtempSync(join(tmpdir(), 'ph-assets-')) },
      db: openDb(file), flags: staticFlags(true), session: staticSession('hq_admin'), secrets: aesGcmSecretsStore(TEST_KEY), clock: () => NOW,
    })
    const a = make()
    await seed(a, { bookings: false, demo: false })
    const b = make()
    a.reservations.insert({
      id: 'res_ended', partnerId: 'p_google', advertiserId: 'swisse', campaignId: 'c_api_swisse', positionId: POS, windowStart: '2026-09-18T00:00:00.000Z',
      type: 'bid', channel: 'api', bidCpm: 200, currency: 'AUD', status: 'won', clearingCpm: 200, reason: null, testMode: false, pricingType: 'localised', handedOffAt: '2026-09-17T18:00:00.000Z',
    })
    /* Both read the same billable rows (this one and the seed's past
       window), both compute, one insert per window lands. */
    const due = a.reservations.billable('2026-09-19T10:00:00.000Z').length
    expect(due).toBeGreaterThanOrEqual(1)
    const [x, y] = [runBilling(a), runBilling(b)]
    expect(x.length + y.length).toBe(due)
    const items = lineItems(a)
    expect(items).toHaveLength(due)
    expect(new Set(items.map((i) => i.reservationId)).size).toBe(due)
    expect(runBilling(b)).toHaveLength(0)
    a.db.close()
    b.db.close()
  })
})

describe('what a partner can send to POST /v1/reservations', () => {
  const field = (res: { json(): { error: { details?: { field: string }[] } } }) => res.json().error.details?.map((d) => d.field)

  it('bounds the price: above zero, finite, and at most the exchange ceiling', async () => {
    const { ctx, reserve, ready } = await setup()
    await ready()
    for (const bidCpm of [0, -1, -0, '200', 1e12, ctx.config.maxBidCpm + 0.01, null, true]) {
      const res = await reserve({ ...SWISSE, bidCpm })
      expect(res.statusCode, String(bidCpm)).toBe(400)
      expect(field(res)).toContain('bidCpm')
    }
    expect((await reserve({ ...SWISSE, bidCpm: ctx.config.maxBidCpm })).statusCode).toBe(201)
  })

  it('takes a window start in any ISO form and normalises it; refuses anything that isn’t a window start', async () => {
    const { reserve, ready } = await setup()
    await ready()
    const res = await reserve({ ...SWISSE, windowStart: '2026-09-21T10:00:00+10:00' })
    expect(res.statusCode).toBe(201)
    expect((await reserve(SWISSE)).statusCode).toBe(409)
    /* A bare date is midnight UTC — a window start — so it is taken (and here refused as a duplicate). */
    expect((await reserve({ ...SWISSE, windowStart: '2026-09-21' })).statusCode).toBe(409)
    for (const windowStart of ['2026-09-21T01:00:00Z', 'tomorrow', 1758412800000, null, '']) {
      const r = await reserve({ ...SWISSE, windowStart })
      expect(r.statusCode, String(windowStart)).toBe(400)
      expect(field(r)).toContain('windowStart')
    }
  })

  it('answers a client error, never 500, to a body that isn’t an object', async () => {
    const { app, ready } = await setup()
    await ready()
    for (const payload of ['null', '[]', '"x"', '7', '']) {
      const res = await app.inject({ method: 'POST', url: '/api/v1/reservations', headers: { ...GOOGLE, 'content-type': 'application/json' }, payload })
      expect(res.statusCode, payload).toBeLessThan(500)
    }
  })

  it('a bid for a position removed from the estate after it was placed is settled, not stranded', async () => {
    let t = NOW
    const { reserve, ready, setSlot, rows, tick } = await setup(() => t)
    await ready()
    expect((await reserve(SWISSE)).statusCode).toBe(201)
    setSlot({ owner: 'internal' } as Partial<Slot>)
    t = AT_CUTOFF
    await tick()
    expect(rows().filter((r) => r.status === 'pending')).toHaveLength(1)
    t = new Date('2026-09-21T00:01:00.000Z')
    await tick()
    expect(rows().filter((r) => r.status === 'pending')).toHaveLength(0)
  })
})
