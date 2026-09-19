/* Versioned, reversible migrations: migrations/NNNN_name.up.sql and
   NNNN_name.down.sql, applied in order and recorded in schema_migrations. */
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { type Db, tx } from './db'

const DIR = fileURLToPath(new URL('./migrations/', import.meta.url))

export interface Migration {
  version: string
  name: string
  up: string
  down: string
}

export function loadMigrations(dir = DIR): Migration[] {
  const files = readdirSync(dir)
  return files
    .filter((f) => f.endsWith('.up.sql'))
    .sort()
    .map((f) => {
      const base = f.replace(/\.up\.sql$/, '')
      const down = `${base}.down.sql`
      if (!files.includes(down)) throw new Error(`Migration ${base} has no down script`)
      return { version: base.slice(0, 4), name: base, up: readFileSync(dir + f, 'utf8'), down: readFileSync(dir + down, 'utf8') }
    })
}

const ensureTable = (db: Db) =>
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)')

export function appliedVersions(db: Db): string[] {
  ensureTable(db)
  return (db.prepare('SELECT version FROM schema_migrations ORDER BY version').all() as { version: string }[]).map((r) => r.version)
}

/* Apply every pending migration up to and including `target` (default: all). */
export function migrateUp(db: Db, target?: string, migrations = loadMigrations()): string[] {
  const done = new Set(appliedVersions(db))
  const ran: string[] = []
  for (const m of migrations) {
    if (target && m.version > target) break
    if (done.has(m.version)) continue
    tx(db, () => {
      db.exec(m.up)
      db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)').run(m.version, m.name, new Date().toISOString())
    })
    ran.push(m.name)
  }
  return ran
}

/* Revert the most recent `steps` applied migrations. */
export function migrateDown(db: Db, steps = 1, migrations = loadMigrations()): string[] {
  const applied = appliedVersions(db).reverse().slice(0, steps)
  const ran: string[] = []
  for (const v of applied) {
    const m = migrations.find((x) => x.version === v)
    if (!m) throw new Error(`No migration file for applied version ${v}`)
    tx(db, () => {
      db.exec(m.down)
      db.prepare('DELETE FROM schema_migrations WHERE version = ?').run(v)
    })
    ran.push(m.name)
  }
  return ran
}
