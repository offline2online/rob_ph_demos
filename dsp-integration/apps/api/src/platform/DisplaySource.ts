/* Stand-in for Displays & Devices. Read only: used for the display type
   delete check (spec §1) and store/display counts. */
import type { Db } from '../db/db'

/* storeId is the platform's store (StoreSource); store is its name. */
export interface DisplayRecord { id: string; name: string; storeId: string; store: string; displayTypeId: string }

export interface DisplaySource {
  list(): DisplayRecord[]
  listByDisplayType(displayTypeId: string): DisplayRecord[]
}

interface Row { id: string; name: string; store_id: string; store: string; display_type_id: string }
const toRecord = (r: Row): DisplayRecord => ({ id: r.id, name: r.name, storeId: r.store_id, store: r.store, displayTypeId: r.display_type_id })
const SELECT = 'SELECT d.id, d.name, d.store_id, COALESCE(s.name, d.store) AS store, d.display_type_id FROM displays d LEFT JOIN stores s ON s.id = d.store_id'

export const sqliteDisplaySource = (db: Db): DisplaySource => ({
  list: () => (db.prepare(`${SELECT} ORDER BY d.rowid`).all() as unknown as Row[]).map(toRecord),
  listByDisplayType: (id) => (db.prepare(`${SELECT} WHERE d.display_type_id = ? ORDER BY d.rowid`).all(id) as unknown as Row[]).map(toRecord),
})
