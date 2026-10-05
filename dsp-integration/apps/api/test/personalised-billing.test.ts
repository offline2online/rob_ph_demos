/* There is no personalised multiplier (Rob, 5 Oct 2026): every play bills at
   the window's committed CPM against realised VAC-d, whatever tier played.
   The tier stays on the play for reporting only. */
import { describe, expect, it } from 'vitest'
import { billReservation, computeLineItem, lineItems } from '../src/billing'
import { findPosition } from '../src/domain/positions'
import { openDb } from '../src/db/db'
import { appliedVersions, loadMigrations, migrateDown, migrateUp } from '../src/db/migrate'
import type { ReservationRecord } from '../src/repos/ReservationRepo'
import { NOW, testContext } from './helpers'

const W = '2026-09-14T00:00:00.000Z'
const won = (over: Partial<ReservationRecord> = {}): ReservationRecord => ({
  id: 'res_pers_1', partnerId: 'p_google', advertiserId: 'nestle', campaignId: 'c_dsp_nestle', positionId: 'menu_board.s2', windowStart: W, type: 'bid', channel: 'api',
  bidCpm: 100, currency: 'AUD', status: 'won', clearingCpm: 100, reason: null, testMode: false, pricingType: 'localised', handedOffAt: W, ...over,
})

/* Menu Board slot 2: 3 displays, 1/3 share of voice, so 86,400 expected seconds a day and 1,236 assumed views. */
async function setup() {
  const ctx = await testContext({ clock: () => NOW })
  const p = (await findPosition(ctx, 'menu_board.s2'))!
  const play = ctx.db.prepare('INSERT INTO plays (id, display_id, campaign_id, played_at, duration_sec, tier) VALUES (?, ?, ?, ?, 10800, ?)')
  const at = (i: number) => new Date(Date.parse(W) + i * 3_600_000).toISOString()
  const put = (tiers: (string | null)[]) => tiers.forEach((t, i) => play.run(`pl_${i}`, 'd_1004', 'c_dsp_nestle', at(i), t))
  const totals = () => ctx.playback.totals({ campaignId: 'c_dsp_nestle', displayTypeId: 'menu_board', from: W, to: '2026-09-15T00:00:00.000Z' })
  return { ctx, p, put, totals }
}

describe('billing a personalised play', () => {
  it('bills every play at the committed price whatever tier played, with no split', async () => {
    const { ctx, p, put, totals } = await setup()
    /* Half the day's expected time played: two default, one localised, one personalised. */
    put(['default', 'default', 'localised', 'personalised'])
    expect(await totals()).toEqual({ plays: 4, playedSec: 43_200, byVersion: [{ versionId: null, plays: 4 }] })
    const item = await computeLineItem(ctx, won(), p, await totals())
    /* 1,236 × 0.5 = 618 realised at 100 per thousand. */
    expect(item).toMatchObject({ realisedViews: 618, amount: 61.8 })
    expect(item).not.toHaveProperty('personalisedAmount')
  })

  it('bills the same whether or not any play is personalised', async () => {
    const { ctx, p, put, totals } = await setup()
    put(['personalised', 'personalised', 'personalised', 'personalised'])
    const all = await computeLineItem(ctx, won(), p, await totals())
    expect(all).toMatchObject({ realisedViews: 618, amount: 61.8 })
    const { ctx: c2, p: p2, put: put2, totals: totals2 } = await setup()
    put2([null, null, null, null])
    expect((await computeLineItem(c2, won(), p2, await totals2())).amount).toBe(all.amount)
  })

  it('bills an interactive campaign the same way', async () => {
    const { ctx, p, put, totals } = await setup()
    put(['personalised', 'personalised', 'personalised', 'personalised'])
    expect((await computeLineItem(ctx, won({ pricingType: 'interactive' }), p, await totals())).amount).toBe(61.8)
  })

  it('stores the line item at the committed CPM', async () => {
    const { ctx, p, put, totals } = await setup()
    put(['default', 'personalised'])
    await ctx.reservations.insert(won())
    await billReservation(ctx, won(), p, await totals())
    expect((await lineItems(ctx)).find((i) => i.reservationId === 'res_pers_1')).toMatchObject({ cpm: 100, plays: 2 })
  })
})

describe('migrations 0033 and 0034', () => {
  const cols = (db: ReturnType<typeof openDb>, t: string) => (db.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).map((c) => c.name)
  it('add nullable play version/tier and the reservation and line-item columns', () => {
    const db = openDb(':memory:')
    migrateUp(db)
    expect(cols(db, 'plays')).toEqual(expect.arrayContaining(['version_id', 'tier']))
    /* The old multiplier columns stay (invoices already written keep their split) but nothing reads or writes them. */
    expect(cols(db, 'billing_line_items')).toEqual(expect.arrayContaining(['personalised_plays', 'personalised_amount']))
    /* A play with no tier still inserts (null bills as today); an unknown tier does not. */
    db.prepare("INSERT INTO plays (id, display_id, campaign_id, played_at, duration_sec) VALUES ('x', 'd', 'c', '2026-09-14T00:00:00.000Z', 5)").run()
    expect(() => db.prepare("INSERT INTO plays (id, display_id, campaign_id, played_at, duration_sec, tier) VALUES ('y', 'd', 'c', '2026-09-14T00:00:00.000Z', 5, 'bogus')").run()).toThrow()
  })
  it('leave an existing database intact: rows written before them keep working', () => {
    const db = openDb(':memory:')
    migrateUp(db, '0032')
    expect(cols(db, 'plays')).not.toContain('tier')
    db.prepare("INSERT INTO plays (id, display_id, campaign_id, played_at, duration_sec) VALUES ('old', 'd', 'c', '2026-09-14T00:00:00.000Z', 5)").run()
    migrateUp(db)
    expect(db.prepare("SELECT tier, version_id FROM plays WHERE id = 'old'").get()).toEqual({ tier: null, version_id: null })
    expect(appliedVersions(db)).toEqual(expect.arrayContaining(['0033', '0034']))
    migrateDown(db, loadMigrations().length)
    expect(appliedVersions(db)).toEqual([])
  })
})
