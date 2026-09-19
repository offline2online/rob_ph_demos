/* Stand-in for Displays & Devices. Read only: used for the display type
   delete check (spec §1) and store/display counts. */
import type { Db } from '../db/db'

export interface DisplayRecord { id: string; name: string; store: string; displayTypeId: string }

export interface DisplaySource {
  list(): DisplayRecord[]
  listByDisplayType(displayTypeId: string): DisplayRecord[]
}

interface Row { id: string; name: string; store: string; display_type_id: string }
const toRecord = (r: Row): DisplayRecord => ({ id: r.id, name: r.name, store: r.store, displayTypeId: r.display_type_id })

export const sqliteDisplaySource = (db: Db): DisplaySource => ({
  list: () => (db.prepare('SELECT * FROM displays ORDER BY rowid').all() as unknown as Row[]).map(toRecord),
  listByDisplayType: (id) => (db.prepare('SELECT * FROM displays WHERE display_type_id = ? ORDER BY rowid').all(id) as unknown as Row[]).map(toRecord),
})
