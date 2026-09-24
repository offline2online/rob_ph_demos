/* Scalability and cluster hardening (review for 15,000 displays on a
   client's EKS, 24 Sep 2026). Each test pins one change the review made,
   so it can't come back unnoticed:
   - display counts come from an aggregate, never the display rows;
   - the estate's positions are indexed once per display-type snapshot;
   - the inventory's status filter reads what is taken in one query;
   - billing reads only what it can bill now, and counts plays in SQL;
   - which process clears a window's auction is settled in the database;
   - settled bids are deleted after their retention;
   - uploads in flight are bounded across all partners;
   - an admin-typed endpoint can't name the VPC (SSRF);
   - the process answers /healthz and /readyz for a supervisor;
   - the scheduler, the bind address and the limits are configurable. */
import { describe, expect, it } from 'vitest'
import { loadConfig } from '../src/config'
import { migrateDown, migrateUp } from '../src/db/migrate'
import { isPrivateHost, isPublicHttpsUrl } from '../src/domain/partnerInput'
import { allPositions, callerOf, findPosition, visibilityFor, windowFacts, windowStatus, windowsBetween } from '../src/domain/positions'
import { sweepSettledReservations } from '../src/domain/reservationRetention'
import { runBilling } from '../src/exchange/billing'
import { claimAuction, schedulerTick } from '../src/exchange/scheduler'
import { buildApp } from '../src/http/app'
import type { ReservationRecord, ReservationStatus } from '../src/repos/ReservationRepo'
import { NOW, mockDsps, testContext } from './helpers'
import { multipart, png } from './media'

const GOOGLE = { authorization: 'Bearer poc-token-google-dv360' }

describe('display counts without the display rows', () => {
  it('summaryByDisplayType and storeIdsByDisplayType agree with the rows, and a type with none counts 0', async () => {
    const ctx = await testContext({ demo: true })
    for (const dt of ctx.displayTypes.list()) {
      const rows = ctx.displays.listByDisplayType(dt.id)
      expect(ctx.displays.summaryByDisplayType(dt.id)).toEqual({ displays: rows.length, stores: new Set(rows.map((d) => d.storeId)).size })
      expect([...ctx.displays.storeIdsByDisplayType(dt.id)].sort()).toEqual([...new Set(rows.map((d) => d.storeId))].sort())
    }
    expect(ctx.displays.summaryByDisplayType('no_such_type')).toEqual({ displays: 0, stores: 0 })
  })

  it('is what the inventory reports for every position', async () => {
    const ctx = await testContext({ demo: true })
    const app = buildApp(ctx)
    const items = (await app.inject({ url: '/api/v1/inventory?limit=200', headers: GOOGLE })).json().items as { displayTypeId: string; displayCount: number; storeCount: number }[]
    expect(items.length).toBeGreaterThan(5)
    for (const i of items) {
      const s = ctx.displays.summaryByDisplayType(i.displayTypeId)
      expect([i.displayCount, i.storeCount]).toEqual([s.displays, s.stores])
    }
  })
})

describe('the position index', () => {
  it('finds a position directly, and follows a change to a display type', async () => {
    const ctx = await testContext()
    expect(findPosition(ctx, 'menu_board.s2')?.slot).toBe(2)
    expect(findPosition(ctx, 'menu_board.s9')).toBeNull()
    const before = allPositions(ctx).map((p) => p.positionId)
    expect(before).toContain('menu_board.s2')
    const ext = ctx.displayTypes.get('menu_board')!.phExtensions!
    ctx.displayTypes.saveExtensions('menu_board', { ...ext, slots: ext.slots.map((s, i) => (i === 1 ? { ...s, owner: 'internal' as const } : s)) })
    expect(findPosition(ctx, 'menu_board.s2')).toBeNull()
    expect(allPositions(ctx).map((p) => p.positionId)).toEqual(before.filter((id) => id !== 'menu_board.s2'))
  })
})

describe('the inventory status filter', () => {
  it('reads what is taken once for the estate and answers exactly as a per-position check does', async () => {
    const ctx = await testContext({ clock: () => NOW, bookings: true, demo: true })
    const app = buildApp(ctx)
    const [from, to] = ['2026-09-21', '2026-10-20']
    const starts = windowsBetween(ctx, from, to)!
    const c = callerOf(ctx.partners.get('p_google')!, undefined)
    const counts: Record<string, number> = {}
    for (const status of ['sold', 'available', 'reserved'] as const) {
      /* The per-position path (one ranged query each), as the availability endpoint still does. */
      const expected = allPositions(ctx).filter(visibilityFor(ctx, c)).filter((p) => {
        const f = windowFacts(ctx, p, starts)
        return starts.some((w) => windowStatus(ctx, p, c, w, f) === status)
      }).map((p) => p.positionId)
      const got = (await app.inject({ url: `/api/v1/inventory?status=${status}&from=${from}&to=${to}&limit=200`, headers: GOOGLE })).json().items as { positionId: string }[]
      expect(got.map((i) => i.positionId)).toEqual(expected)
      counts[status] = expected.length
    }
    /* Meaningful: the sample bookings sold some windows in that range. */
    expect(counts.sold).toBeGreaterThan(0)
    expect(counts.available).toBeGreaterThan(0)
  })
})

describe('billing at scale', () => {
  it('counts a window’s plays where they are stored, only on the position’s own displays, and reads only what it can bill', async () => {
    const mocks = mockDsps()
    const ctx = await testContext({ clock: () => NOW, dspFetch: mocks.fetchImpl })
    const windowStart = '2026-09-17T00:00:00.000Z'
    const start = Date.parse(windowStart)
    ctx.reservations.insert({
      id: 'res_big', partnerId: 'p_google', advertiserId: 'nestle', campaignId: 'c_dsp_nestle', positionId: 'menu_board.s2', windowStart, type: 'bid', channel: 'openrtb',
      bidCpm: 100, currency: 'AUD', status: 'won', clearingCpm: 100, reason: null, testMode: false, pricingType: 'localised', handedOffAt: '2026-09-16T18:00:00.000Z',
    })
    /* 1,000 more Menu Boards with 200 plays each in the window, and plays on
       a Landscape display that must not count. */
    const other = ctx.displays.listByDisplayType('landscape')[0].id
    const insDisplay = ctx.db.prepare("INSERT INTO displays (id, name, store, store_id, display_type_id) VALUES (?, ?, 'Big store', 'st_big', 'menu_board')")
    const play = ctx.db.prepare("INSERT INTO plays (id, display_id, campaign_id, played_at, duration_sec) VALUES (?, ?, 'c_dsp_nestle', ?, 15)")
    ctx.db.exec('BEGIN')
    for (let d = 0; d < 1000; d++) {
      insDisplay.run(`big_${d}`, `Big ${d}`)
      for (let i = 0; i < 200; i++) play.run(`p_${d}_${i}`, `big_${d}`, new Date(start + i * 400_000).toISOString())
    }
    for (let i = 0; i < 100; i++) play.run(`other_${i}`, other, new Date(start + i * 1000).toISOString())
    ctx.db.exec('COMMIT')

    const items = runBilling(ctx)
    const big = items.find((i) => i.reservationId === 'res_big')!
    const displays = ctx.displays.summaryByDisplayType('menu_board').displays
    expect(displays).toBe(1003)
    const expectedSec = displays * 86_400 * (1 / 3)
    expect(big).toMatchObject({ plays: 200_000, playedSec: 3_000_000, expectedSec, assumedViews: 1236 })
    expect(big.realisedViews).toBe(Math.round(1236 * Math.min(1, 3_000_000 / expectedSec)))
    /* The seeded 15 Sep window is billed in the same pass, and nothing twice. */
    expect(items.map((i) => i.reservationId).sort()).toEqual(['res_big', 'res_seed_nestle_0915'])
    expect(ctx.reservations.billable(new Date(NOW.getTime() - 86_400_000).toISOString())).toEqual([])
    expect(runBilling(ctx)).toEqual([])
  })
})

describe('one auction per window across processes', () => {
  /* 30 minutes after the 18:00 UTC cutoff for the 21 Sep window. */
  const at = () => new Date('2026-09-20T18:30:00.000Z')
  const W = '2026-09-21T00:00:00.000Z'
  async function ticking() {
    const mocks = mockDsps()
    let requests = 0
    const ctx = await testContext({
      clock: at,
      dspFetch: async (url, init) => {
        if (url.includes('/openrtb2/bid')) requests++
        return mocks.fetchImpl(url, init)
      },
    })
    const run = (ctx.db.prepare('SELECT * FROM auction_runs WHERE window_start = ?').get.bind(null) as unknown as (w: string) => { claimed_by: string; finished_at: string | null } | undefined)
    return { ctx, requests: () => requests, run: (w: string) => ctx.db.prepare('SELECT * FROM auction_runs WHERE window_start = ?').get(w) as { claimed_by: string; finished_at: string | null } | undefined, _run: run }
  }

  it('a tick clears the window once, and a second tick sends no bid request', async () => {
    const { ctx, requests, run } = await ticking()
    await schedulerTick(ctx, () => {})
    const first = requests()
    expect(first).toBeGreaterThan(0)
    expect(run(W)?.finished_at).not.toBeNull()
    await schedulerTick(ctx, () => {})
    expect(requests()).toBe(first)
  })

  it('a window another process holds is skipped; one left unfinished for 15 minutes is taken over', async () => {
    const { ctx, requests, run } = await ticking()
    ctx.db.prepare("INSERT INTO auction_runs (window_start, claimed_at, claimed_by, finished_at) VALUES (?, ?, 'other-pod:1', NULL)").run(W, new Date(at().getTime() - 60_000).toISOString())
    await schedulerTick(ctx, () => {})
    expect(requests()).toBe(0)
    expect(run(W)?.claimed_by).toBe('other-pod:1')
    ctx.db.prepare('UPDATE auction_runs SET claimed_at = ? WHERE window_start = ?').run(new Date(at().getTime() - 20 * 60_000).toISOString(), W)
    await schedulerTick(ctx, () => {})
    expect(requests()).toBeGreaterThan(0)
    expect(run(W)?.claimed_by).not.toBe('other-pod:1')
    expect(run(W)?.finished_at).not.toBeNull()
  })

  it('claimAuction hands a window to exactly one claimant', async () => {
    const ctx = await testContext({ clock: at })
    expect(claimAuction(ctx, W)).toBe(true)
    expect(claimAuction(ctx, W)).toBe(false)
  })
})

describe('settled bids are deleted after their retention', () => {
  it('deletes rejected, lost and stale pending bids older than the retention; keeps won and recent ones', async () => {
    const ctx = await testContext({ clock: () => NOW })
    const rec = (id: string, status: ReservationStatus, windowStart: string): ReservationRecord => ({
      id, partnerId: 'p_google', advertiserId: 'nestle', campaignId: 'c_dsp_nestle', positionId: 'menu_board.s2', windowStart, type: 'bid', channel: 'openrtb',
      bidCpm: 100, currency: 'AUD', status, clearingCpm: status === 'won' ? 100 : null, reason: null, testMode: false, pricingType: null, handedOffAt: null,
    })
    for (const r of [
      rec('old_rejected', 'rejected', '2026-05-01T00:00:00.000Z'), rec('old_lost', 'lost', '2026-05-02T00:00:00.000Z'), rec('old_pending', 'pending', '2026-05-03T00:00:00.000Z'),
      rec('old_won', 'won', '2026-05-04T00:00:00.000Z'), rec('recent_rejected', 'rejected', '2026-09-01T00:00:00.000Z'),
    ]) ctx.reservations.insert(r)
    expect(sweepSettledReservations(ctx.db, 90, () => NOW)).toBe(3)
    expect(['old_rejected', 'old_lost', 'old_pending'].map((id) => ctx.reservations.get(id))).toEqual([null, null, null])
    expect(ctx.reservations.get('old_won')?.status).toBe('won')
    expect(ctx.reservations.get('recent_rejected')?.status).toBe('rejected')
    /* Nothing more to delete: a sweep with nothing due changes nothing. */
    expect(sweepSettledReservations(ctx.db, 90, () => NOW)).toBe(0)
  })
})

describe('uploads in flight are bounded across all partners', () => {
  it('refuses the upload that would exceed the process-wide cap, then frees the slot', async () => {
    const ctx = await testContext()
    ctx.config.maxConcurrentUploads = 1
    ctx.config.maxConcurrentUploadsPerPartner = 5
    const app = buildApp(ctx)
    const created = await app.inject({ method: 'POST', url: '/api/v1/campaigns', headers: GOOGLE, payload: { advertiserId: 'swisse', name: 'Swisse — Sleep', displayTypeId: 'landscape', default: { pricingType: 'localised' } } })
    const id = created.json().campaignId
    const send = () => {
      const m = multipart({ version: 'default' }, { name: 'a.png', bytes: png(1920, 1080, 2_000_000) })
      return app.inject({ method: 'POST', url: `/api/v1/campaigns/${id}/assets`, headers: { ...GOOGLE, ...m.headers }, payload: m.payload })
    }
    const results = await Promise.all([send(), send(), send()])
    const codes = results.map((r) => r.statusCode).sort()
    expect(codes).toContain(201)
    expect(codes).toContain(429)
    expect(results.find((r) => r.statusCode === 429)!.json().error.message).toMatch(/as many uploads as it can/)
    expect((await send()).statusCode).toBe(201)
  })
})

describe('an admin-typed endpoint cannot name the VPC', () => {
  it('refuses private, loopback, link-local, metadata and cluster-local hosts; accepts public https', () => {
    for (const url of [
      'https://169.254.169.254/latest/meta-data/', 'https://10.0.12.7/bid', 'https://172.20.1.1/bid', 'https://192.168.1.1/bid', 'https://127.0.0.1/bid',
      'https://100.64.0.1/bid', 'https://[::1]/bid', 'https://[fd00::1]/bid', 'https://[::ffff:10.0.0.1]/bid',
      'https://localhost/bid', 'https://metadata.google.internal/', 'https://bidder.dsp-exchange.svc/bid', 'https://bidder.svc.cluster.local/bid', 'https://bidder/bid',
      'http://rtb.dsp.example/bid', 'https://user:pw@rtb.dsp.example/bid', 'not a url',
    ]) expect(isPublicHttpsUrl(url), url).toBe(false)
    for (const url of ['https://rtb.dsp.example/openrtb2/bid', 'https://bid.dv360.example.com:8443/rtb', 'https://203.0.113.9/bid']) expect(isPublicHttpsUrl(url), url).toBe(true)
    expect(isPrivateHost('LOCALHOST')).toBe(true)
    expect(isPrivateHost('rtb.dsp.example.')).toBe(false)
  })

  it('DSP Integration refuses such a bidder endpoint on save', async () => {
    const app = buildApp(await testContext())
    const bad = await app.inject({ method: 'PUT', url: '/api/admin/v1/partners/p_google', payload: { bidder: { bidderEndpoint: 'https://169.254.169.254/latest/meta-data/', seatIds: ['884512'] } } })
    expect(bad.statusCode).toBe(400)
    expect(bad.json().error.details).toEqual([{ field: 'bidder.bidderEndpoint', reason: expect.stringContaining('public https://') }])
    const ok = await app.inject({ method: 'PUT', url: '/api/admin/v1/partners/p_google', payload: { bidder: { bidderEndpoint: 'https://rtb.dsp.example/openrtb2/bid', seatIds: ['884512'] } } })
    expect(ok.statusCode).toBe(200)
    expect(ok.json().bidder.bidderEndpoint).toBe('https://rtb.dsp.example/openrtb2/bid')
  })
})

describe('probes for a supervisor', () => {
  it('/healthz answers while the process is up; /readyz only once every migration is applied', async () => {
    const ctx = await testContext()
    const app = buildApp(ctx)
    expect((await app.inject({ url: '/healthz' })).json()).toEqual({ ok: true })
    expect((await app.inject({ url: '/readyz' })).json()).toEqual({ ok: true })
    migrateDown(ctx.db, 1)
    const notReady = await app.inject({ url: '/readyz' })
    expect(notReady.statusCode).toBe(503)
    expect(notReady.json()).toEqual({ ok: false, reason: '1 migration not applied.' })
    expect((await app.inject({ url: '/healthz' })).statusCode).toBe(200)
    migrateUp(ctx.db)
    expect((await app.inject({ url: '/readyz' })).statusCode).toBe(200)
  })
})

describe('cluster configuration', () => {
  it('binds to 127.0.0.1 with the scheduler in-process by default; a container sets the address, the scheduler and the limits', () => {
    const dflt = loadConfig({})
    expect([dflt.host, dflt.scheduler, dflt.auctionConcurrency, dflt.maxConcurrentUploads, dflt.reservationRetentionDays]).toEqual(['127.0.0.1', 'in-process', 16, 4, 90])
    const pod = loadConfig({ API_HOST: '0.0.0.0', PH_SCHEDULER: 'off', PH_AUCTION_CONCURRENCY: '64', PH_MAX_UPLOADS_IN_FLIGHT: '2', PH_RESERVATION_RETENTION_DAYS: '30' })
    expect([pod.host, pod.scheduler, pod.auctionConcurrency, pod.maxConcurrentUploads, pod.reservationRetentionDays]).toEqual(['0.0.0.0', 'off', 64, 2, 30])
    /* Anything but "off" keeps the scheduler in the process. */
    expect(loadConfig({ PH_SCHEDULER: 'yes' }).scheduler).toBe('in-process')
  })
})
