/* Applies every migration in this package's migrations/ folder, in order —
   so a test database always has the schema the store expects, including
   migrations added after the test was written (0102 added seq). */
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const DIR = fileURLToPath(new URL('../migrations/', import.meta.url))

export function migrateAll(db: { exec(sql: string): void }) {
  for (const f of readdirSync(DIR).filter((n) => n.endsWith('.up.sql')).sort()) db.exec(readFileSync(DIR + f, 'utf8'))
}
