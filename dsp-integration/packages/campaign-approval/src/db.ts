/* The SQL surface the module needs (node:sqlite's DatabaseSync fits it).

   Async-capable like the host's seams (ticket v2iKDJQA0wmisXhp7ebV): each
   statement may answer at once (node:sqlite) or with a promise (a Postgres
   adapter), and the module awaits whatever it gets. prepare() itself stays
   synchronous — it only names a statement; an adapter can prepare lazily on
   first run. */
export type Awaitable<T> = T | Promise<T>

export interface SqlStatement {
  run(...args: unknown[]): Awaitable<unknown>
  get(...args: unknown[]): Awaitable<unknown>
  all(...args: unknown[]): Awaitable<unknown[]>
}

export interface SqlDb {
  exec(sql: string): Awaitable<unknown>
  prepare(sql: string): SqlStatement
}

/* Sync-first composition, as the host's db.ts andThen: f runs at once when
   v is already a value (node:sqlite), and only waits when v is a promise.
   The eligibility check behind every bid reads through here, so the
   SQLite path pays no microtask for being awaitable. */
export const andThen = <T, U>(v: Awaitable<T>, f: (t: T) => Awaitable<U>): Awaitable<U> => (v instanceof Promise ? v.then(f) : f(v))
/* Promise.all for Awaitable values: the plain array when none is a promise. */
export const allOf = <T>(vs: Awaitable<T>[]): Awaitable<T[]> => (vs.some((v) => v instanceof Promise) ? Promise.all(vs) : (vs as T[]))
