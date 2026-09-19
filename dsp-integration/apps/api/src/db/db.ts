/* SQLite through node:sqlite. All SQL in this repo is plain and
   Postgres-compatible (TEXT / INTEGER / REAL, JSON stored as TEXT) so the
   repository layer can move to the platform's database unchanged. */
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

export type Db = DatabaseSync

export function openDb(file: string): Db {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true })
  const db = new DatabaseSync(file)
  db.exec('PRAGMA foreign_keys = ON')
  return db
}

export const toJson = (v: unknown) => (v === undefined || v === null ? null : JSON.stringify(v))
export const fromJson = <T>(v: unknown, fallback: T): T => (typeof v === 'string' ? (JSON.parse(v) as T) : fallback)

/* Run fn inside a transaction; rolls back on throw. */
export function tx<T>(db: Db, fn: () => T): T {
  db.exec('BEGIN')
  try {
    const out = fn()
    db.exec('COMMIT')
    return out
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
}
