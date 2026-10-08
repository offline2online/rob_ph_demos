/* Stand-in for the platform's stores (Rob, Q10). Stores are managed by the
   primary Personalisation Hub platform; this build only reads them: unique
   store IDs, names and regions. Engineering swaps in the platform's store
   service. */
import { type Db, prepared, type Awaitable } from '../db/db'

/* segments: the store's localized segments (fixed and variable); openHour/closeHour: trading hours as whole hours of the day, open inclusive, close exclusive (0-24). */
export interface StoreRecord { id: string; name: string; region: string | null; segments: string[]; openHour: number; closeHour: number }

export interface StoreSource {
  list(): Awaitable<StoreRecord[]>
  get(id: string): Awaitable<StoreRecord | null>
}

interface Row { id: string; name: string; region: string | null; segments: string; open_hour: number; close_hour: number }
const toRecord = (r: Row): StoreRecord => ({ id: r.id, name: r.name, region: r.region, segments: JSON.parse(r.segments) as string[], openHour: r.open_hour, closeHour: r.close_hour })
const SELECT = 'SELECT id, name, region, segments, open_hour, close_hour FROM stores'

export const sqliteStoreSource = (db: Db): StoreSource => ({
  list: () => (prepared(db, `${SELECT} ORDER BY name`).all() as unknown as Row[]).map(toRecord),
  get: (id) => { const r = prepared(db, `${SELECT} WHERE id = ?`).get(id) as unknown as Row | undefined; return r ? toRecord(r) : null },
})
