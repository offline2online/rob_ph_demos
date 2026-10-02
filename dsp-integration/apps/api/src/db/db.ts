/* SQLite through node:sqlite. All SQL in this repo is plain and
   Postgres-compatible (TEXT / INTEGER / REAL, JSON stored as TEXT) so the
   repository layer can move to the platform's database unchanged. */
import { AsyncLocalStorage } from 'node:async_hooks'
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
       own pool and MVCC give the same properties.
       Switching a fresh file to WAL needs a lock SQLite does not wait for
       through busy_timeout, so a second process opening the same new
       database at the same moment failed outright with "database is
       locked" — the intermittent start-up failure in
       test/multiprocess.test.ts that stopped dsp-api-deploy.yml on 28 Sep
       2026. WAL is recorded in the file once any process sets it, so the
       switch is retried briefly instead. */
    db.exec(`PRAGMA busy_timeout = ${BUSY_WAIT_MS}`)
    setWalMode(db)
    db.exec('PRAGMA synchronous = NORMAL')
  }
  return db
}

function setWalMode(db: Db) {
  const pause = new Int32Array(new SharedArrayBuffer(4))
  for (let attempt = 0; ; attempt++) {
    try {
      db.exec('PRAGMA journal_mode = WAL')
      return
    } catch (err) {
      if (attempt >= 100 || !/database is locked|SQLITE_BUSY/i.test(String((err as Error).message))) throw err
      Atomics.wait(pause, 0, 0, 50)
    }
  }
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
export const isUniqueViolation = (e: unknown) => {
  if (!(e instanceof Error)) return false
  /* SQLite (node:sqlite) says so in the message; Postgres (node-postgres)
     sets SQLSTATE 23505 on .code and says "duplicate key value violates
     unique constraint" (ticket gAi2mkcm43uW6hrchOjh). */
  if ((e as { code?: unknown }).code === '23505') return true
  return /UNIQUE constraint failed|duplicate key value violates unique constraint/.test(e.message)
}

/* A seam's answer: the SQLite stand-ins answer at once, a platform service
   (or a Postgres adapter) answers with a promise. Callers always await it
   (Scope & Seam Reconciliation Review, 1 Oct 2026, finding #19; ticket
   cUdX4dmTMB2mvxJczHvT). */
export type Awaitable<T> = T | Promise<T>

/* Sync-first composition, for the few paths that run once per position on
   every Partner API read: f runs at once when v is already a value (every
   SQLite seam), and only waits when v is a promise (a real platform
   service). An `await` on a plain value still costs a microtask, and an
   async function a promise; a page of inventory paid for hundreds of them
   (bench, 2 Oct 2026). Anywhere else, plain await is clearer — use that. */
export const andThen = <T, U>(v: Awaitable<T>, f: (t: T) => Awaitable<U>): Awaitable<U> => (v instanceof Promise ? v.then(f) : f(v))
/* Promise.all for Awaitable values: the array itself when none is a promise. */
export function allOf<T extends readonly unknown[]>(vs: readonly [...T]): Awaitable<{ -readonly [K in keyof T]: Awaited<T[K]> }> {
  return (vs.some((v) => v instanceof Promise) ? Promise.all(vs) : vs) as never
}

/* ── Transactions on one SQLite connection ────────────────────────────────
   node:sqlite gives this process ONE synchronous connection. While every
   seam was synchronous a transaction ran start to finish in one turn of the
   event loop, so nothing else could touch the connection in the middle of
   it. Once callers await, a transaction body yields at every await, and
   anything else that runs then would execute its statements INSIDE that
   transaction — committed or rolled back with it, and reading its
   uncommitted rows.

   So (Rob, 1 Oct 2026): one transaction at a time per database, in the order
   they asked (a FIFO lock). A transaction started inside another one, in the
   same async call chain, joins it — no second BEGIN, no deadlock. And every
   statement from OUTSIDE the open transaction waits until it ends:
   gate()/onFree() below, which context.ts puts in front of every seam and
   repository method. The lock is the SQLite adapter's: a Postgres adapter
   gives each transaction its own pooled connection and needs none of it.

   Never await network I/O inside a transaction: the whole database waits
   for it. */
interface TxLock {
  /* Resolves when the transaction holding the lock (or queued last) ends. */
  tail: Promise<void>
  /* The open transaction, if any: its token, and a promise that resolves when it ends. */
  open: { token: symbol; done: Promise<void> } | null
}
const locks = new WeakMap<Db, TxLock>()
const lockOf = (db: Db) => {
  let l = locks.get(db)
  if (!l) locks.set(db, (l = { tail: Promise.resolve(), open: null }))
  return l
}
/* Which transaction (per database) the current async call chain is inside.
   On Node 22 an enabled AsyncLocalStorage turns on async_hooks, which tax
   every promise in the process (~10% of Partner API throughput, measured
   2 Oct 2026). Nothing reads the store while no transaction is open or
   waiting, so it is switched off between them: run() switches it back on,
   and disable() turns the hooks off once no store is enabled. */
const inside = new AsyncLocalStorage<Map<Db, symbol>>()
let txActive = 0
const ownsOpenTx = (db: Db, l: TxLock) => !!l.open && inside.getStore()?.get(db) === l.open.token

/* In-process caches over this database (company settings, display types,
   display counts) register here and are dropped when a transaction rolls
   back: a read inside the transaction may have cached rows that are now
   gone. A commit needs nothing — the writes that changed them already
   dropped them. */
const rollbackListeners = new WeakMap<Db, Set<() => void>>()
export function onRollback(db: Db, fn: () => void): () => void {
  let set = rollbackListeners.get(db)
  if (!set) rollbackListeners.set(db, (set = new Set()))
  set.add(fn)
  return () => set.delete(fn)
}
const rollback = (db: Db) => {
  db.exec('ROLLBACK')
  for (const fn of rollbackListeners.get(db) ?? []) fn()
}

/* null when the caller may use the connection right now (no transaction
   open, or it is the caller's own); otherwise a promise that resolves when
   the open transaction ends — check again then, another may have started. */
export function busy(db: Db): Promise<void> | null {
  const l = locks.get(db)
  if (!l || !l.open || ownsOpenTx(db, l)) return null
  return l.open.done
}

/* Run fn against the connection as soon as no other call chain's
   transaction is open: at once (synchronously, returning fn's value) when
   it is free, else after that transaction ends. fn must be synchronous —
   the check and the statements happen in one turn, so nothing can open a
   transaction in between. */
export function onFree<T>(db: Db, fn: () => T): Awaitable<T> {
  const wait = busy(db)
  return wait ? wait.then(() => onFree(db, fn)) : fn()
}

/* Wraps every method of a seam or repository so each call goes through
   onFree. A method that returns a promise (a real platform service) is
   passed through untouched once it has started. Plain accessors rather than
   a Proxy: a seam call is on every hot path, and a Proxy trap cost ~70 ns a
   call against ~5 ns for this (2 Oct 2026). Assigning a method on the
   wrapper replaces it on the seam itself, as the Proxy did; anything that
   isn't a method is read through from the seam. */
export function gate<T extends object>(db: Db, target: T): T {
  const l = lockOf(db)
  const t = target as Record<PropertyKey, unknown>
  const wrap = (f: (...a: unknown[]) => unknown) => (...args: unknown[]) =>
    l.open && !ownsOpenTx(db, l) ? onFree(db, () => f.apply(target, args)) : f.apply(target, args)
  const out = Object.create(target) as T
  for (let o: object | null = target; o && o !== Object.prototype; o = Object.getPrototypeOf(o)) {
    for (const key of Reflect.ownKeys(o)) {
      if (key === 'constructor' || Object.prototype.hasOwnProperty.call(out, key)) continue
      const d = Object.getOwnPropertyDescriptor(o, key)
      if (typeof d?.value !== 'function') continue
      let fn: unknown
      let via: unknown
      Object.defineProperty(out, key, {
        configurable: true,
        enumerable: d.enumerable,
        get() {
          const v = t[key]
          if (v !== fn) {
            fn = v
            via = typeof v === 'function' ? wrap(v as (...a: unknown[]) => unknown) : v
          }
          return via
        },
        set(v) {
          t[key] = v
        },
      })
    }
  }
  return out
}

/* Run fn inside a transaction; rolls back on throw. 'IMMEDIATE' (the
   default) takes the write lock before fn runs, so two processes doing the
   same check-then-write serialise on it, busy_timeout makes the second one
   wait, and its check sees the first one's writes. A DEFERRED transaction
   reads first and upgrades to the write lock later; if another process
   committed in between, SQLite refuses the upgrade at once with "database
   is locked" — busy_timeout is never consulted (stability review, 24 Sep
   2026; and the intermittent multiprocess.test.ts crash after 9f51d91,
   when every tx() site was DEFERRED: 9x7eZw6BOgI7HSrVaffa, 2 Oct 2026).
   Every transaction in this build writes, so pass 'DEFERRED' only for a
   read-only one.
   Waits its turn behind any other transaction on this database (see above);
   inside one it joins it, and the mode of the outer transaction holds. */
export async function tx<T>(db: Db, fn: () => Awaitable<T>, mode: 'DEFERRED' | 'IMMEDIATE' = 'IMMEDIATE'): Promise<T> {
  const l = lockOf(db)
  if (ownsOpenTx(db, l)) return await fn()
  txActive++
  let release!: () => void
  const done = new Promise<void>((r) => (release = r))
  const before = l.tail
  l.tail = before.then(() => done)
  await before
  const token = Symbol('tx')
  l.open = { token, done }
  try {
    if (mode === 'IMMEDIATE') await beginImmediate(db)
    else db.exec('BEGIN')
    let out: T
    try {
      const chain = new Map(inside.getStore() ?? [])
      chain.set(db, token)
      out = await inside.run(chain, fn)
    } catch (e) {
      rollback(db)
      throw e
    }
    db.exec('COMMIT')
    return out
  } finally {
    l.open = null
    if (--txActive === 0) inside.disable()
    release()
  }
}

/* BEGIN IMMEDIATE without blocking the event loop. busy_timeout waits for
   another connection's write lock inside SQLite, synchronously: with the
   lock held by a transaction that is itself awaiting (in another process,
   or another connection in this one, as the e2e harness's "second
   process" is), the whole process stalls, and in one process it can never
   be released — a deadlock until the timeout. So the attempt is made with
   busy_timeout at 0 (set and restored in the same synchronous turn, so no
   other statement on this connection runs with it), and a busy database is
   retried after yielding, for the same 5 s busy_timeout would have
   waited. */
const BUSY_WAIT_MS = 5000
async function beginImmediate(db: Db) {
  const deadline = Date.now() + BUSY_WAIT_MS
  for (let pause = 2; ; pause = Math.min(pause * 2, 50)) {
    db.exec('PRAGMA busy_timeout = 0')
    try {
      db.exec('BEGIN IMMEDIATE')
      return
    } catch (err) {
      if (!/database is locked|SQLITE_BUSY/i.test(String((err as Error).message)) || Date.now() >= deadline) throw err
    } finally {
      db.exec(`PRAGMA busy_timeout = ${BUSY_WAIT_MS}`)
    }
    await new Promise((r) => setTimeout(r, pause))
  }
}

/* The synchronous transaction, for start-up only (migrations, before the
   server takes a request): nothing else can be running then. It refuses to
   run while an async transaction is open on this database — that would be
   a BEGIN inside it. */
export function txSync<T>(db: Db, fn: () => T, mode: 'DEFERRED' | 'IMMEDIATE' = 'DEFERRED'): T {
  if (locks.get(db)?.open) throw new Error('txSync: a transaction is already open on this database; use tx()')
  db.exec(mode === 'IMMEDIATE' ? 'BEGIN IMMEDIATE' : 'BEGIN')
  try {
    const out = fn()
    db.exec('COMMIT')
    return out
  } catch (e) {
    rollback(db)
    throw e
  }
}
