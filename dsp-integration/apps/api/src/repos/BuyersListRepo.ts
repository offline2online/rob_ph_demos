/* Buyers lists (spec "Support private auctions"): reusable private-auction
   deal objects, independent of any one slot. Two-period model (23 Sep
   2026): auction_closes is the deal's own one-time bidding deadline;
   locked_win (JSON, see LockedWin) is null until that auction clears, and
   set once, never overwritten — see lockWin. */
import type { BuyersList, InvitedBuyer, LockedWin } from '@ph-dsp/types'
import { type Db, fromJson, toJson } from '../db/db'

interface Row {
  id: string; name: string; description: string; invited_buyers: string; active_from: string | null; active_to: string | null
  auction_closes: string | null; locked_win: string | null; created_at: string; updated_at: string
}

export interface BuyersListRepo {
  list(): BuyersList[]
  get(id: string): BuyersList | null
  insert(l: { id: string; name: string; description: string; invitedBuyers: InvitedBuyer[]; activeFrom: string | null; activeTo: string | null; auctionCloses: string | null }): BuyersList
  update(id: string, patch: { name: string; description: string; invitedBuyers: InvitedBuyer[]; activeFrom: string | null; activeTo: string | null; auctionCloses: string | null }): BuyersList | null
  delete(id: string): void
  /* Locks this deal's rate for the rest of its delivery term, at the first
     clearing bid within its auction window — idempotent: a term already
     locked is left untouched (first clear wins, spec "…dynamic VAC-d
     billing over the delivery term"). Returns null if the deal doesn't
     exist or is already locked. */
  lockWin(id: string, win: LockedWin): BuyersList | null
}

export function sqliteBuyersListRepo(db: Db): BuyersListRepo {
  const toRecord = (r: Row): BuyersList => ({
    id: r.id, name: r.name, description: r.description, invitedBuyers: fromJson(r.invited_buyers, []),
    activeFrom: r.active_from, activeTo: r.active_to, auctionCloses: r.auction_closes, lockedWin: fromJson(r.locked_win, null),
    createdAt: r.created_at, updatedAt: r.updated_at,
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
      db.prepare('INSERT INTO buyers_lists (id, name, description, invited_buyers, active_from, active_to, auction_closes, locked_win, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(l.id, l.name, l.description, toJson(l.invitedBuyers) ?? '[]', l.activeFrom, l.activeTo, l.auctionCloses, null, now, now)
      return toRecord(row(l.id) as Row)
    },
    update(id, patch) {
      if (!row(id)) return null
      db.prepare('UPDATE buyers_lists SET name = ?, description = ?, invited_buyers = ?, active_from = ?, active_to = ?, auction_closes = ?, updated_at = ? WHERE id = ?')
        .run(patch.name, patch.description, toJson(patch.invitedBuyers) ?? '[]', patch.activeFrom, patch.activeTo, patch.auctionCloses, new Date().toISOString(), id)
      return toRecord(row(id) as Row)
    },
    delete(id) {
      db.prepare('DELETE FROM buyers_lists WHERE id = ?').run(id)
    },
    lockWin(id, win) {
      const r = row(id)
      if (!r || r.locked_win) return null
      db.prepare('UPDATE buyers_lists SET locked_win = ?, updated_at = ? WHERE id = ?').run(toJson(win), new Date().toISOString(), id)
      return toRecord(row(id) as Row)
    },
  }
}
