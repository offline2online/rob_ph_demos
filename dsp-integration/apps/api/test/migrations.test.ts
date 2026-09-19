import { describe, expect, it } from 'vitest'
import { openDb } from '../src/db/db'
import { appliedVersions, loadMigrations, migrateDown, migrateUp } from '../src/db/migrate'

const tables = (db: ReturnType<typeof openDb>) =>
  (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name != 'schema_migrations' ORDER BY name").all() as { name: string }[]).map((r) => r.name)

describe('migrations', () => {
  it('every migration has a down script and versions are unique and ordered', () => {
    const ms = loadMigrations()
    expect(ms.length).toBeGreaterThanOrEqual(7)
    expect(new Set(ms.map((m) => m.version)).size).toBe(ms.length)
    expect(ms.map((m) => m.version)).toEqual([...ms.map((m) => m.version)].sort())
  })

  it('round-trips: up, all the way down, and up again', () => {
    const db = openDb(':memory:')
    migrateUp(db)
    const full = tables(db)
    expect(full).toEqual(expect.arrayContaining(['display_types', 'playlists', 'displays', 'campaigns', 'plays', 'partners', 'company_advertiser_settings', 'advertiser_settings', 'variable_access', 'exchange']))
    migrateDown(db, loadMigrations().length)
    expect(tables(db)).toEqual([])
    expect(appliedVersions(db)).toEqual([])
    migrateUp(db)
    expect(tables(db)).toEqual(full)
  })

  it('reverts each migration one step at a time', () => {
    const db = openDb(':memory:')
    migrateUp(db)
    const n = loadMigrations().length
    for (let i = n; i > 0; i--) {
      expect(appliedVersions(db).length).toBe(i)
      migrateDown(db, 1)
    }
    expect(appliedVersions(db)).toEqual([])
  })

  it('is idempotent', () => {
    const db = openDb(':memory:')
    migrateUp(db)
    expect(migrateUp(db)).toEqual([])
  })
})
