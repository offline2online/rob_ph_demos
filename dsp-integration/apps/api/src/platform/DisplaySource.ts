/* Stand-in for Displays & Devices. Read only: used for the display type
   delete check (spec §1), store and display counts, and billing. */
import { type Db, prepared } from '../db/db'

/* storeId is the platform's store (StoreSource); store is its name. */
export interface DisplayRecord { id: string; name: string; storeId: string; store: string; displayTypeId: string }
export interface DisplaySummary { displays: number; stores: number }

export interface DisplaySource {
  list(): DisplayRecord[]
  listByDisplayType(displayTypeId: string): DisplayRecord[]
  /* How many displays a display type has, in how many stores — without
     reading the displays. This is the hot one (scalability review, 24 Sep
     2026): every position on an inventory page, every availability check,
     every bid request and every bid placed asks it, and reading 1,000
     display rows to count them was most of a request on a 15,000-display
     estate (an inventory page fell to 20 req/s). */
  summaryByDisplayType(displayTypeId: string): DisplaySummary
  /* The distinct stores a display type is in, for the inventory's store and
     region filters — at most one row per store, never one per display. */
  storeIdsByDisplayType(displayTypeId: string): string[]
}

interface Row { id: string; name: string; store_id: string; store: string; display_type_id: string }
const toRecord = (r: Row): DisplayRecord => ({ id: r.id, name: r.name, storeId: r.store_id, store: r.store, displayTypeId: r.display_type_id })
const SELECT = 'SELECT d.id, d.name, d.store_id, COALESCE(s.name, d.store) AS store, d.display_type_id FROM displays d LEFT JOIN stores s ON s.id = d.store_id'

/* The per-type counts are one GROUP BY over the displays table, kept as a
   snapshot for SNAPSHOT_TTL_MS — the same pattern as display types and
   company settings. Displays change through the platform, never through
   this API, so a change is seen within a second and costs nothing in
   between. On integration the real Displays & Devices service answers the
   count itself (PH-CORE-BOUNDARIES.md, DisplaySource). */
export const SNAPSHOT_TTL_MS = 1_000
const NONE: DisplaySummary = Object.freeze({ displays: 0, stores: 0 })

export const sqliteDisplaySource = (db: Db): DisplaySource => {
  let snap: { at: number; byType: Map<string, DisplaySummary> } | null = null
  const summaries = () => {
    if (!snap || Date.now() - snap.at > SNAPSHOT_TTL_MS) {
      const rows = prepared(db, 'SELECT display_type_id AS id, COUNT(*) AS displays, COUNT(DISTINCT store_id) AS stores FROM displays GROUP BY display_type_id')
        .all() as unknown as { id: string; displays: number; stores: number }[]
      snap = { at: Date.now(), byType: new Map(rows.map((r) => [r.id, Object.freeze({ displays: r.displays, stores: r.stores })])) }
    }
    return snap.byType
  }
  return {
    list: () => (prepared(db, `${SELECT} ORDER BY d.rowid`).all() as unknown as Row[]).map(toRecord),
    listByDisplayType: (id) => (prepared(db, `${SELECT} WHERE d.display_type_id = ? ORDER BY d.rowid`).all(id) as unknown as Row[]).map(toRecord),
    summaryByDisplayType: (id) => summaries().get(id) ?? NONE,
    storeIdsByDisplayType: (id) =>
      (prepared(db, 'SELECT DISTINCT store_id FROM displays WHERE display_type_id = ? AND store_id IS NOT NULL').all(id) as unknown as { store_id: string }[]).map((r) => r.store_id),
  }
}
