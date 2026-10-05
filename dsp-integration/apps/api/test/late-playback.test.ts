/* Settlement is final; late playback is lost revenue (Rob, 4 Oct 2026; spec
   §4 "Billing"). A window is invoiced on the plays received by the moment it
   settles; plays received after are never billed, and are recorded at the
   cleared CPM alone (no personalised uplift) as lost revenue by store,
   display and over time. */
import { describe, expect, it } from 'vitest'
import { lineItems, recordLatePlays, runBilling, valueLatePlay } from '../src/billing'
import { openDb } from '../src/db/db'
import { loadMigrations, migrateDown, migrateUp } from '../src/db/migrate'
import { buildApp } from '../src/http/app'
import type { ReservationRecord } from '../src/repos/ReservationRepo'
import { testContext } from './helpers'

const W = '2026-09-14T00:00:00.000Z'
const iso = (s: string) => new Date(s).toISOString()
const won = (over: Partial<ReservationRecord> = {}): ReservationRecord => ({
  id: 'res_late_1', partnerId: 'p_google', advertiserId: 'nestle', campaignId: 'c_dsp_nestle', positionId: 'menu_board.s2', windowStart: W, type: 'bid', channel: 'api',
  bidCpm: 100, currency: 'AUD', status: 'won', clearingCpm: 100, reason: null, testMode: false, pricingType: 'localised', handedOffAt: W, ...over,
})

/* Menu Board slot 2: 3 displays, 1/3 share of voice → 86,400 expected seconds a day, 1,236 assumed views, so a 10,800 s play is 154.5 views. */
async function setup() {
  let now = new Date('2026-09-15T06:00:00.000Z')
  const ctx = await testContext({ clock: () => now })
  await ctx.reservations.insert(won())
  const displays = (await ctx.displays.listByDisplayType('menu_board'))
  let n = 0
  const play = (o: { received: string | null; tier?: string | null; display?: number; sec?: number; at?: string }) =>
    ctx.db.prepare('INSERT INTO plays (id, display_id, campaign_id, played_at, duration_sec, tier, received_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(`pl_${++n}`, displays[o.display ?? 0].id, 'c_dsp_nestle', o.at ?? iso('2026-09-14T03:00:00Z'), o.sec ?? 10_800, o.tier ?? null, o.received ? iso(o.received) : null)
  return { ctx, displays, play, advance: (to: string) => (now = new Date(to)) }
}

describe('settlement is final', () => {
  it('counts plays received before settlement, including after the window ended, and bills nothing for later ones', async () => {
    const { ctx, play, advance } = await setup()
    play({ received: '2026-09-14T03:00:10Z' }) // received as played
    play({ received: '2026-09-15T02:00:00Z' }) // after the window ended, before settlement: counts
    play({ received: null }) // no received-at reported: known at settlement, counts
    play({ received: '2026-09-15T07:00:00Z' }) // after settlement: late
    const [item] = await runBilling(ctx)
    expect(item).toMatchObject({ plays: 3, playedSec: 32_400 })
    /* 1,236 × 0.375 = 463.5 → 464 realised views at 100 CPM. */
    expect(item.amount).toBe(46.4)
    advance('2026-09-15T08:00:00.000Z')
    await recordLatePlays(ctx)
    /* The invoice is unchanged by the late play and is never billed again. */
    expect(await runBilling(ctx)).toEqual([])
    expect(await lineItems(ctx)).toEqual([item])
  })

  it('records a late play at the cleared CPM whatever tier played', async () => {
    const { ctx, play, advance } = await setup()
    play({ received: '2026-09-14T03:00:10Z' })
    await runBilling(ctx)
    play({ received: '2026-09-15T07:00:00Z', tier: 'default' })
    play({ received: '2026-09-15T07:00:01Z', tier: 'personalised' })
    advance('2026-09-15T08:00:00.000Z')
    expect(await recordLatePlays(ctx)).toBe(2)
    const rows = ctx.db.prepare('SELECT tier, lost_views, lost_amount, cpm FROM late_plays ORDER BY received_at').all() as Record<string, number | string | null>[]
    expect(rows).toEqual([
      { tier: 'default', lost_views: 154.5, lost_amount: 15.45, cpm: 100 },
      { tier: 'personalised', lost_views: 154.5, lost_amount: 15.45, cpm: 100 },
    ])
  })

  it('is idempotent and only reads what arrived since the last scan', async () => {
    const { ctx, play, advance } = await setup()
    play({ received: '2026-09-14T03:00:10Z' })
    await runBilling(ctx)
    play({ received: '2026-09-15T07:00:00Z' })
    advance('2026-09-15T08:00:00.000Z')
    expect(await recordLatePlays(ctx)).toBe(1)
    expect(await recordLatePlays(ctx)).toBe(0)
    play({ received: '2026-09-15T08:30:00Z' })
    advance('2026-09-15T09:00:00.000Z')
    expect(await recordLatePlays(ctx)).toBe(1)
    expect(ctx.db.prepare('SELECT COUNT(*) AS n FROM late_plays').get()).toEqual({ n: 2 })
  })

  it('does not record a play received before settlement, and waits for a window that is not invoiced yet', async () => {
    const { ctx, play, advance } = await setup()
    play({ received: '2026-09-14T03:00:10Z' })
    /* Before billing has run there is no invoice, so nothing is late. */
    advance('2026-09-15T05:00:00.000Z')
    expect(await recordLatePlays(ctx)).toBe(0)
    advance('2026-09-15T06:00:00.000Z')
    await runBilling(ctx)
    expect(await recordLatePlays(ctx)).toBe(0)
  })

  it('never values a window above its own assumed views, but still records the play', async () => {
    const { ctx, play, advance } = await setup()
    play({ received: '2026-09-14T03:00:10Z', sec: 64_800 }) // three quarters played
    await runBilling(ctx)
    play({ received: '2026-09-15T07:00:00Z', sec: 43_200 }) // would take it past the full window
    play({ received: '2026-09-15T07:00:01Z', sec: 43_200 })
    advance('2026-09-15T08:00:00.000Z')
    await recordLatePlays(ctx)
    const rows = ctx.db.prepare('SELECT lost_views FROM late_plays ORDER BY received_at').all() as { lost_views: number }[]
    expect(rows.map((r) => r.lost_views)).toEqual([309, 0]) // the remaining quarter, then nothing
  })

  it('valueLatePlay: a window with no expected time values nothing', () => {
    expect(valueLatePlay({ expectedSec: 0, playedSec: 0, assumedViews: 100, cpm: 10 } as never, { durationSec: 10 }, 0)).toEqual({ lostViews: 0, lostAmount: 0 })
  })
})

describe('lost revenue report', () => {
  async function withLate() {
    const s = await setup()
    s.play({ received: '2026-09-14T03:00:10Z' })
    await runBilling(s.ctx)
    /* Display 0 offline all night, display 1 less so; the first backfills a day later. */
    s.play({ received: '2026-09-15T07:00:00Z', display: 0, at: iso('2026-09-14T04:00:00Z') })
    s.play({ received: '2026-09-15T07:00:01Z', display: 0, at: iso('2026-09-14T05:00:00Z') })
    s.play({ received: '2026-09-15T07:00:02Z', display: 1, at: iso('2026-09-14T06:00:00Z') })
    s.advance('2026-09-15T08:00:00.000Z')
    await recordLatePlays(s.ctx)
    return s
  }

  it('reports by display, by store and by day, in the currency billed', async () => {
    const { ctx, displays } = await withLate()
    const app = buildApp(ctx)
    const get = async (q: string) => (await app.inject({ method: 'GET', url: `/api/admin/v1/reports/lost-revenue?from=2026-09-14&to=2026-09-14${q}` })).json()
    const byDisplay = await get('&by=display')
    expect(byDisplay.totals).toEqual([{ currency: 'AUD', plays: 3, lostSec: 32_400, lostViews: 463.5, lostAmount: 46.35 }])
    expect(byDisplay.rows[0]).toMatchObject({ key: displays[0].id, plays: 2, lostAmount: 30.9 })
    expect(byDisplay.rows[1]).toMatchObject({ key: displays[1].id, plays: 1, lostAmount: 15.45 })
    const day = await get('&by=day')
    expect(day.rows).toMatchObject([{ key: '2026-09-14', plays: 3, lostAmount: 46.35 }])
    const store = await get('&by=store')
    expect(store.rows.reduce((n: number, r: { lostAmount: number }) => n + r.lostAmount, 0)).toBeCloseTo(46.35, 2)
    expect((await get(`&by=display&displayId=${displays[1].id}`)).totals[0].lostAmount).toBe(15.45)
  })

  it('places a play on the day it played, not the day it arrived', async () => {
    const { ctx } = await withLate()
    const r = (await buildApp(ctx).inject({ method: 'GET', url: '/api/admin/v1/reports/lost-revenue?from=2026-09-15&to=2026-09-15&by=day' })).json()
    expect(r.rows).toEqual([])
    expect(r.totals).toEqual([])
  })

  it('refuses a bad range or grouping', async () => {
    const { ctx } = await setup()
    const app = buildApp(ctx)
    for (const q of ['from=2026-09-15&to=2026-09-14', 'from=nope&to=2026-09-14', 'from=2026-09-14&to=2026-09-14&by=campaign', 'from=2024-01-01&to=2026-09-14'])
      expect((await app.inject({ method: 'GET', url: `/api/admin/v1/reports/lost-revenue?${q}` })).statusCode).toBe(400)
  })
})

describe('migration 0043', () => {
  it('adds received_at and the ledger, and reverses cleanly', () => {
    const db = openDb(':memory:')
    migrateUp(db)
    const cols = (t: string) => (db.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).map((c) => c.name)
    expect(cols('plays')).toContain('received_at')
    expect(cols('late_plays')).toEqual(expect.arrayContaining(['play_id', 'line_item_id', 'lost_amount']))
    /* The campaign-approval module's migrations (0100+) sort after this app's. */
    const after = loadMigrations().filter((m) => m.version > '0043').length
    migrateDown(db, after + 1)
    expect(cols('plays')).not.toContain('received_at')
    expect(cols('late_plays')).toEqual([])
    migrateUp(db)
    expect(cols('plays')).toContain('received_at')
  })
})
