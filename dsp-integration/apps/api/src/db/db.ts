/* SQLite through node:sqlite. All SQL in this repo is plain and
   Postgres-compatible (TEXT / INTEGER / REAL, JSON stored as TEXT) so the
   repository layer can move to the platform's database unchanged. */
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync, type StatementSync } from 'node:sqlite'

export type Db = DatabaseSync

export function openDb(file: string): Db {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true })
  const db = new DatabaseSync(file)
  db.exec('PRAGMA foreign_keys = ON')
  if (file !== ':memory:') {
    /* Concurrency and latency (a file database is what `npm run dev:api`
       and the auction CLI share):
       - WAL lets the Partner API's reads run while the auction or an admin
         save is writing, instead of queueing behind the write lock.
       - busy_timeout makes a second process (the auction CLI next to the
         API) wait briefly for the lock rather than fail with SQLITE_BUSY.
       - synchronous = NORMAL is the recommended pairing with WAL: durable
         across an application crash, fsyncs only at checkpoints.
       On integration these move to the platform's database (Postgres), whose
       own pool and MVCC give the same properties. */
    db.exec('PRAGMA journal_mode = WAL')
    db.exec('PRAGMA busy_timeout = 5000')
    db.exec('PRAGMA synchronous = NORMAL')
  }
  return db
}

/* Prepared-statement cache, one per database. `db.prepare()` parses and
   plans the SQL on every call; the hot read paths (inventory, availability,
   the auction) call the same few statements thousands of times a second, so
   each repository takes its statements from here instead. Keyed by the SQL
   text, so a statement built with a variable IN (…) list caches one entry
   per list length — a small, bounded set. */
const statements = new WeakMap<Db, Map<string, StatementSync>>()
export function prepared(db: Db, sql: string): StatementSync {
  let m = statements.get(db)
  if (!m) statements.set(db, (m = new Map()))
  let st = m.get(sql)
  if (!st) m.set(sql, (st = db.prepare(sql)))
  return st
}

export const toJson = (v: unknown) => (v === undefined || v === null ? null : JSON.stringify(v))
export const fromJson = <T>(v: unknown, fallback: T): T => (typeof v === 'string' ? (JSON.parse(v) as T) : fallback)

/* True when a write failed on a UNIQUE constraint — how a second writer
   learns it lost a race the database settled (e.g. migration 0021's "one
   live winner per position and window"). */
export const isUniqueViolation = (e: unknown) => e instanceof Error && /UNIQUE constraint failed/.test(e.message)

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
