import { describe, expect, it } from 'vitest'
import { testContext } from './helpers'
import { openDb } from '../src/db/db'
import { migrateUp } from '../src/db/migrate'
import { STORE_TRADING_HOURS } from '../src/seed/tradingHours'

describe('stub store trading hours', () => {
  it('the demo seed gives every store varied hours, all under 24, so Store hours plays fewer than 24 hours', async () => {
    const ctx = await testContext({ demo: true })
    const stores = await ctx.stores.list()
    expect(stores.length).toBeGreaterThan(4)
    for (const s of stores) expect(s.closeHour - s.openHour, s.name).toBeLessThan(24)
    expect(new Set(stores.map((s) => `${s.openHour}-${s.closeHour}`)).size).toBeGreaterThan(3)
  })
})

describe('migration 0087: trading hours on a database that already exists', () => {
  it('gives stub stores still on the 24-hour default their hours, and leaves a store whose hours were set alone', () => {
    const db = openDb(':memory:')
    migrateUp(db, '0086')
    const add = db.prepare('INSERT INTO stores (id, name, region) VALUES (?, ?, ?)')
    add.run('st_sydney_cbd', 'Sydney CBD', 'NSW')
    add.run('st_perth_cbd', 'Perth CBD', 'WA')
    db.prepare("UPDATE stores SET open_hour = 6, close_hour = 23 WHERE id = 'st_perth_cbd'").run()
    migrateUp(db)
    const hours = (id: string) => db.prepare('SELECT open_hour AS o, close_hour AS c FROM stores WHERE id = ?').get(id)
    /* The hosted demo is never re-seeded, so this is how its stores get hours (E2E 22 Oct 2026). */
    expect(hours('st_sydney_cbd')).toEqual({ o: STORE_TRADING_HOURS.st_sydney_cbd[0], c: STORE_TRADING_HOURS.st_sydney_cbd[1] })
    expect(hours('st_perth_cbd')).toEqual({ o: 6, c: 23 })
  })
})
