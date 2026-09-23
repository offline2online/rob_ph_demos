/* Stand-in for the platform's stores (Rob, Q10). Stores are managed by the
   primary Personalisation Hub platform; this build only reads them: unique
   store IDs, names and regions. Engineering swaps in the platform's store
   service. */
import { type Db, prepared } from '../db/db'

export interface StoreRecord { id: string; name: string; region: string | null }

export interface StoreSource {
  list(): StoreRecord[]
  get(id: string): StoreRecord | null
}

export const sqliteStoreSource = (db: Db): StoreSource => ({
  list: () => prepared(db, 'SELECT id, name, region FROM stores ORDER BY name').all() as unknown as StoreRecord[],
  get: (id) => (prepared(db, 'SELECT id, name, region FROM stores WHERE id = ?').get(id) as unknown as StoreRecord | undefined) ?? null,
})
