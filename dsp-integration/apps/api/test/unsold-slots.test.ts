/* Unsold real-time slots (ticket 3BXfWxs2jkN6S7awLXhQ): no-fill impression opportunities are aggregated hourly, valued at the resolved floor x assumed views, and reported by store, display, display type, hour and day. */
import { describe, expect, it } from 'vitest'
import { findPosition, windowMsFor, windowStartOf } from '../src/domain/positions'
import { runAuction } from '../src/exchange/auction'
import { buildApp } from '../src/http/app'
import { NOW, mockDsps, testContext } from './helpers'
import { openDb } from '../src/db/db'
import { loadMigrations, migrateDown, migrateUp } from '../src/db/migrate'
import { sweepUnsold } from '../src/domain/unsold'

const PLAYER = { authorization: 'Bearer poc-token-player' }
const GOOGLE = { authorization: 'Bearer poc-token-google-dv360' }
const W1 = new Date('2026-09-21T00:00:00.000Z')

/* The mock DSP's creative has to be known and approved before it can fill a real-time impression (no creative is fetched inside tmax), so one deal auction on slot 2 (which sits on an open deal until the slot goes open) runs first and introduces it. */
async function setup(opts: { realtime?: boolean } = {}) {
  const mocks = mockDsps()
  const sent: { url: string; body: Record<string, any> }[] = []
  const fetchImpl: typeof mocks.fetchImpl = async (url, init) => {
    if (url.includes('/openrtb2/bid')) sent.push({ url, body: JSON.parse(String(init?.body)) })
    return mocks.fetchImpl(url, init)
  }
  const ctx = await testContext({ byWindow: true, clock: () => NOW, dspFetch: fetchImpl })
  const app = buildApp(ctx)
  await runAuction(ctx, W1)
  /* A slot is real time when it is open (not on a deal, not held for named advertisers): 'window' puts it back on the open deal. */
  const setMode = async (mode: 'window' | 'realtime') => {
    const ext = (await ctx.displayTypes.get('menu_board'))!.phExtensions!
    await ctx.displayTypes.saveExtensions('menu_board', { ...ext, slots: ext.slots.map((s, i) => (i === 1 ? (mode === 'realtime' ? { ...s, listMode: 'rtb' as const, buyersListId: null } : { ...s, listMode: 'deal' as const, buyersListId: 'bl_test_open' }) : s)) })
  }
  if (opts.realtime !== false) await setMode('realtime')
  const displayId = ((await ctx.displays.listByDisplayType('menu_board'))[0]).id
  sent.length = 0
  const signal = (body: Record<string, unknown> = { displayId, slot: 2 }) => app.inject({ method: 'POST', url: '/api/player/v1/impressions', headers: PLAYER, payload: body })
  const played = (id: string, payload: Record<string, unknown> = {}) => app.inject({ method: 'POST', url: `/api/player/v1/impressions/${id}/played`, headers: PLAYER, payload })
  return { ctx, app, mocks, sent, setMode, displayId, signal, played }
}


const mode = (mocks: Awaited<ReturnType<typeof setup>>['mocks'], m: string) => mocks.app.inject({ method: 'PUT', url: '/_control/google_dv360/bidder', payload: { mode: m } })
const report = async (app: Awaited<ReturnType<typeof setup>>['app'], q: string) => (await app.inject({ method: 'GET', url: `/api/admin/v1/reports/unsold?from=2026-09-20&to=2026-09-20${q}` })).json()

describe('unsold real-time slots', () => {
  it('records no bids and below-floor bids with their reason, valued at the floor, and reports them', async () => {
    const { ctx, app, mocks, signal, displayId } = await setup()
    await mode(mocks, 'no_bid')
    expect((await signal()).json().status).toBe('no_fill')
    await mode(mocks, 'below_floor')
    expect((await signal()).json().status).toBe('no_fill')
    expect((await signal()).json().status).toBe('no_fill')

    const rows = ctx.db.prepare('SELECT reason, impressions, floor_cpm_sum, missed_views, missed_amount FROM unsold_slots ORDER BY reason').all() as { reason: string; impressions: number; floor_cpm_sum: number; missed_views: number; missed_amount: number }[]
    expect(rows.map((r) => [r.reason, r.impressions])).toEqual([['below_floor', 2], ['no_bids', 1]])
    const floor = (await ctx.company.get()).floorCpm
    expect(rows[0].floor_cpm_sum).toBeCloseTo(2 * floor, 6)
    expect(rows[0].missed_views).toBeGreaterThan(0)
    expect(rows[0].missed_amount).toBeCloseTo((rows[0].missed_views / 1000) * floor, 6)

    const total = await report(app, '&by=store')
    expect(total.totals).toHaveLength(1)
    expect(total.totals[0]).toMatchObject({ currency: 'USD', impressions: 3, reasons: { below_floor: 2, no_bids: 1 } })
    expect(total.rows).toHaveLength(1)
    const hour = await report(app, '&by=hour')
    expect(hour.rows).toMatchObject([{ key: '10', label: '10:00', impressions: 3 }])
    expect((await report(app, `&by=display&displayId=${displayId}`)).rows).toMatchObject([{ key: displayId, impressions: 3 }])
    expect((await report(app, '&by=display_type')).rows).toMatchObject([{ key: 'menu_board', impressions: 3 }])
    expect((await report(app, '&by=day')).rows).toMatchObject([{ key: '2026-09-20', impressions: 3 }])
    expect(total.totals[0].missedAmount).toBeCloseTo(3 * (rows[0].missed_amount / 2), 1)
  })

  it('does not record a filled impression, or a test-mode outcome', async () => {
    const { ctx, signal } = await setup()
    expect((await signal()).json().status).toBe('filled')
    expect(ctx.db.prepare('SELECT COUNT(*) AS n FROM unsold_slots').get()).toEqual({ n: 0 })
    await ctx.partners.update('p_google', { mode: 'test' } as never)
    expect((await signal()).json().status).toBe('no_fill')
    expect(ctx.db.prepare('SELECT COUNT(*) AS n FROM unsold_slots').get()).toEqual({ n: 0 })
  })

  it('aggregates rather than storing a row per impression, and the retention sweep drops old hours', async () => {
    const { ctx, mocks, signal } = await setup()
    await mode(mocks, 'no_bid')
    for (let i = 0; i < 5; i++) await signal()
    expect(ctx.db.prepare('SELECT COUNT(*) AS n, SUM(impressions) AS i FROM unsold_slots').get()).toEqual({ n: 1, i: 5 })
    expect(await sweepUnsold(ctx, 400, () => new Date(NOW.getTime() + 399 * 86_400_000))).toBe(0)
    expect(await sweepUnsold(ctx, 400, () => new Date(NOW.getTime() + 401 * 86_400_000))).toBe(1)
  })

  it('refuses a bad range or grouping, and migration 0073 reverses cleanly', async () => {
    const { app } = await setup()
    for (const q of ['from=2026-09-15&to=2026-09-14', 'from=2026-09-14&to=2026-09-14&by=campaign'])
      expect((await app.inject({ method: 'GET', url: `/api/admin/v1/reports/unsold?${q}` })).statusCode).toBe(400)
    const db = openDb(':memory:')
    migrateUp(db)
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'unsold_slots'").all()).toHaveLength(1)
    migrateDown(db, loadMigrations().filter((m) => m.version >= '0073').length)
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'unsold_slots'").all()).toHaveLength(0)
  })
})
