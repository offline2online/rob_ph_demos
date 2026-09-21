/* The SQL surface the module needs (node:sqlite's DatabaseSync fits it). */
export interface SqlDb {
  exec(sql: string): void
  prepare(sql: string): { run(...args: unknown[]): unknown; get(...args: unknown[]): unknown; all(...args: unknown[]): unknown[] }
}
