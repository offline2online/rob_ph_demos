/* The personalised multiplier is charged per personalised play, not as a
   bid floor (Rob, 30 Sep 2026): bids and the auction clear against the base
   floor, the committed price covers default and localised plays, and a play
   of a personalised version bills at committed price × multiplier. */
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
  bidCpm: 100, currency: 'AUD', status: 'won', clearingCpm: 100, reason: null, testMode: false, pricingType: 'localised', handedOffAt: W, personalisedMultiplier: 1.5, ...over,
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
  it('bills default and localised plays at the committed price and personalised plays at committed × multiplier', async () => {
    const { ctx, p, put, totals } = await setup()
    /* Half the day's expected time played: two default, one localised, one personalised. */
    put(['default', 'default', 'localised', 'personalised'])
    expect(await totals()).toEqual({ plays: 4, playedSec: 43_200, personalised: { plays: 1, playedSec: 10_800 }, byVersion: [{ versionId: null, plays: 4 }] })
    const item = await computeLineItem(ctx, won(), p, await totals())
    /* 1,236 × 0.5 = 618 realised; a quarter of the played time was personalised: 155 views, 463 base. */
    expect(item).toMatchObject({ realisedViews: 618, personalisedPlays: 1, personalisedViews: 155, personalisedMultiplier: 1.5 })
    expect(item.personalisedAmount).toBe(23.25) // 155 / 1000 × 100 × 1.5
    expect(item.amount).toBe(69.55) // 463 / 1000 × 100 + 23.25
    /* Without the split the same day would have billed 61.8. */
    expect(item.amount).toBeGreaterThan(61.8)
  })

  it('bills as before when no play carries a version (null tier)', async () => {
    const { ctx, p, put, totals } = await setup()
    put([null, null, null, null])
    const item = await computeLineItem(ctx, won(), p, await totals())
    expect(item).toMatchObject({ realisedViews: 618, personalisedPlays: 0, personalisedViews: 0, personalisedAmount: 0, amount: 61.8 })
  })

  it('uses the multiplier snapshotted when the window cleared, not today’s setting', async () => {
    const { ctx, p, put, totals } = await setup()
    put(['personalised', 'personalised', 'personalised', 'personalised'])
    await ctx.company.save({ ...(await ctx.company.get()), personalisedMultiplier: 3 })
    const item = await computeLineItem(ctx, won({ personalisedMultiplier: 1.5 }), p, await totals())
    expect(item).toMatchObject({ personalisedViews: 618, personalisedMultiplier: 1.5, personalisedAmount: 92.7, amount: 92.7 })
  })

  it('charges no multiplier on a campaign that has none (interactive, or cleared before the snapshot existed)', async () => {
    const { ctx, p, put, totals } = await setup()
    put(['personalised', 'personalised', 'personalised', 'personalised'])
    const item = await computeLineItem(ctx, won({ personalisedMultiplier: null, pricingType: 'interactive' }), p, await totals())
    expect(item).toMatchObject({ personalisedMultiplier: null, personalisedAmount: 61.8, amount: 61.8 })
  })

  it('stores the split on the line item', async () => {
    const { ctx, p, put, totals } = await setup()
    put(['default', 'personalised'])
    await ctx.reservations.insert(won())
    await billReservation(ctx, won(), p, await totals())
    expect((await lineItems(ctx)).find((i) => i.reservationId === 'res_pers_1')).toMatchObject({ personalisedPlays: 1, personalisedMultiplier: 1.5 })
  })
})

describe('migrations 0033 and 0034', () => {
  const cols = (db: ReturnType<typeof openDb>, t: string) => (db.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).map((c) => c.name)
  it('add nullable play version/tier and the reservation and line-item columns', () => {
    const db = openDb(':memory:')
    migrateUp(db)
    expect(cols(db, 'plays')).toEqual(expect.arrayContaining(['version_id', 'tier']))
    expect(cols(db, 'reservations')).toContain('personalised_multiplier')
    expect(cols(db, 'billing_line_items')).toEqual(expect.arrayContaining(['personalised_plays', 'personalised_views', 'personalised_multiplier', 'personalised_amount']))
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
