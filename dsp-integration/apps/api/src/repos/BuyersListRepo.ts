/* Buyers lists (spec "Support private auctions"): reusable private-auction
   deal objects, independent of any one slot. */
import type { BuyersList, InvitedBuyer } from '@ph-dsp/types'
import { type Db, fromJson, toJson } from '../db/db'

interface Row { id: string; name: string; description: string; invited_buyers: string; active_from: string | null; active_to: string | null; created_at: string; updated_at: string }

export interface BuyersListRepo {
  list(): BuyersList[]
  get(id: string): BuyersList | null
  insert(l: { id: string; name: string; description: string; invitedBuyers: InvitedBuyer[]; activeFrom: string | null; activeTo: string | null }): BuyersList
  update(id: string, patch: { name: string; description: string; invitedBuyers: InvitedBuyer[]; activeFrom: string | null; activeTo: string | null }): BuyersList | null
  delete(id: string): void
}

export function sqliteBuyersListRepo(db: Db): BuyersListRepo {
  const toRecord = (r: Row): BuyersList => ({
    id: r.id, name: r.name, description: r.description, invitedBuyers: fromJson(r.invited_buyers, []),
    activeFrom: r.active_from, activeTo: r.active_to, createdAt: r.created_at, updatedAt: r.updated_at,
  })
  const row = (id: string) => db.prepare('SELECT * FROM buyers_lists WHERE id = ?').get(id) as Row | undefined
  return {
    list: () => (db.prepare('SELECT * FROM buyers_lists ORDER BY rowid').all() as unknown as Row[]).map(toRecord),
    get: (id) => {
      const r = row(id)
      return r ? toRecord(r) : null
    },
    insert(l) {
      const now = new Date().toISOString()
      db.prepare('INSERT INTO buyers_lists (id, name, description, invited_buyers, active_from, active_to, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(l.id, l.name, l.description, toJson(l.invitedBuyers) ?? '[]', l.activeFrom, l.activeTo, now, now)
      return toRecord(row(l.id) as Row)
    },
    update(id, patch) {
      if (!row(id)) return null
      db.prepare('UPDATE buyers_lists SET name = ?, description = ?, invited_buyers = ?, active_from = ?, active_to = ?, updated_at = ? WHERE id = ?')
        .run(patch.name, patch.description, toJson(patch.invitedBuyers) ?? '[]', patch.activeFrom, patch.activeTo, new Date().toISOString(), id)
      return toRecord(row(id) as Row)
    },
    delete(id) {
      db.prepare('DELETE FROM buyers_lists WHERE id = ?').run(id)
    },
  }
}
