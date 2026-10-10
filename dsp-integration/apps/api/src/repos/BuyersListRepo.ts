/* Buyers lists (spec "Support private auctions"): reusable private-auction
   deal objects, independent of any one slot. Two-period model (23 Sep
   2026): auction_closes is the deal's own one-time bidding deadline;
   locked_win (JSON, see LockedWin) is null until that auction clears, and
   set once, never overwritten — see lockWin. */
import type { BuyersList, BuyersListDealType, Condition, InvitedBuyer, LockedWin } from '@ph-dsp/types'
import { randomInt } from 'node:crypto'
import { type Db, fromJson, prepared, toJson, type Awaitable } from '../db/db'

interface Row {
  id: string; deal_id: string; name: string; description: string; deal_type: BuyersListDealType; invited_buyers: string; invited_categories: string; targeting: string; active_from: string | null; active_to: string | null
  auction_closes: string | null; locked_win: string | null; committed_plays: number | null; floor_cpm: number | null; created_at: string; updated_at: string
}

/* The deal ID the platform mints for a new list: PH- plus 10 characters from an alphabet without look-alikes (no 0/O, 1/I/L), e.g. PH-7K2M9QXW4B. Never typed, never edited; the unique index makes a collision a retry, not a duplicate. */
const DEAL_ID_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'
export const mintDealId = (): string => `PH-${Array.from({ length: 10 }, () => DEAL_ID_ALPHABET[randomInt(DEAL_ID_ALPHABET.length)]).join('')}`

export interface DealRow { deal_id: string; list_id: string; partner_id: string; retired_at: string | null }

export interface BuyersListRepo {
  list(): Awaitable<BuyersList[]>
  get(id: string): Awaitable<BuyersList | null>
  insert(l: { id: string; dealId?: string; name: string; description: string; dealType?: BuyersListDealType; invitedBuyers: InvitedBuyer[]; invitedCategories?: string[]; targeting?: Condition[]; activeFrom: string | null; activeTo: string | null; auctionCloses: string | null; committedPlays?: number | null; floorCpm?: number | null }): Awaitable<BuyersList>
  update(id: string, patch: { name: string; description: string; dealType: BuyersListDealType; invitedBuyers: InvitedBuyer[]; invitedCategories?: string[]; targeting?: Condition[]; activeFrom: string | null; activeTo: string | null; auctionCloses: string | null; committedPlays?: number | null; floorCpm?: number | null }): Awaitable<BuyersList | null>
  delete(id: string): Awaitable<void>
  /* The deal ID this DSP bids under on the list: its existing deal, else (a DSP admitted by IAB category rather than a named seat) one minted on first use. Null if the list doesn't exist. */
  dealIdFor(listId: string, partnerId: string): Awaitable<string | null>
  /* Locks this deal's rate for the rest of its delivery term, at the first
     clearing bid within its auction window — idempotent: a term already
     locked is left untouched (first clear wins, spec "…dynamic VAC-d
     billing over the delivery term"). Returns null if the deal doesn't
     exist or is already locked. */
  lockWin(id: string, win: LockedWin): Awaitable<BuyersList | null>
}

export function sqliteBuyersListRepo(db: Db): BuyersListRepo {
  /* The list's own deal ID (its first DSP) leads, then by when each was minted. */
  const dealsOf = (listId: string, listDealId: string) => (prepared(db, 'SELECT * FROM buyers_list_deals WHERE list_id = ? ORDER BY created_at, deal_id').all(listId) as unknown as DealRow[]).sort((x, y) => Number(y.deal_id === listDealId) - Number(x.deal_id === listDealId)).map((d) => ({ partnerId: d.partner_id, dealId: d.deal_id, retiredAt: d.retired_at }))
  /* One deal per DSP the list names a seat on (ticket fgBVnNItNcu7qMBUtqH7). The list's own deal_id (minted at create, quoted by bids since 0067) goes to its first DSP; a later DSP mints its own. A DSP whose last named seat went is retired, not deleted; inviting it again revives the same ID. */
  const syncDeals = (listId: string, listDealId: string, invited: InvitedBuyer[]) => {
    const now = new Date().toISOString()
    const named = [...new Set(invited.map((b) => b.partnerId))]
    const have = new Map((prepared(db, 'SELECT * FROM buyers_list_deals WHERE list_id = ?').all(listId) as unknown as DealRow[]).map((d) => [d.partner_id, d]))
    for (const partnerId of named) {
      const d = have.get(partnerId)
      if (!d) {
        const id = have.size === 0 && !prepared(db, 'SELECT 1 FROM buyers_list_deals WHERE deal_id = ?').get(listDealId) ? listDealId : mintDealId()
        prepared(db, 'INSERT INTO buyers_list_deals (deal_id, list_id, partner_id, created_at) VALUES (?, ?, ?, ?)').run(id, listId, partnerId, now)
        have.set(partnerId, { deal_id: id, list_id: listId, partner_id: partnerId, retired_at: null })
      } else if (d.retired_at) prepared(db, 'UPDATE buyers_list_deals SET retired_at = NULL WHERE deal_id = ?').run(d.deal_id)
    }
    for (const d of have.values()) if (!named.includes(d.partner_id) && !d.retired_at) prepared(db, 'UPDATE buyers_list_deals SET retired_at = ? WHERE deal_id = ?').run(now, d.deal_id)
  }
  const toRecord = (r: Row): BuyersList => ({
    id: r.id, dealId: r.deal_id, deals: dealsOf(r.id, r.deal_id), name: r.name, description: r.description, dealType: r.deal_type, invitedBuyers: fromJson(r.invited_buyers, []), invitedCategories: fromJson(r.invited_categories, []), targeting: fromJson(r.targeting, []),
    activeFrom: r.active_from, activeTo: r.active_to, auctionCloses: r.auction_closes, lockedWin: fromJson(r.locked_win, null),
    committedPlays: r.committed_plays, floorCpm: r.floor_cpm, deliveredPlays: 0,
    /* Resolved against the platform and DSP levels by the admin route (withDelivery); the row alone can't know them. */
    effectiveCommittedPlays: { min: r.committed_plays, max: r.committed_plays, source: r.committed_plays == null ? 'none' : 'buyer' },
    effectiveRateCpm: { min: r.floor_cpm, max: r.floor_cpm, source: r.floor_cpm == null ? 'none' : 'buyer' },
    createdAt: r.created_at, updatedAt: r.updated_at,
  })
  const row = (id: string) => prepared(db, 'SELECT * FROM buyers_lists WHERE id = ?').get(id) as Row | undefined
  return {
    list: () => (prepared(db, 'SELECT * FROM buyers_lists ORDER BY seq').all() as unknown as Row[]).map(toRecord),
    get: (id) => {
      const r = row(id)
      return r ? toRecord(r) : null
    },
    insert(l) {
      const now = new Date().toISOString()
      const ids = l.dealId ?? mintDealId()
      prepared(db, 'INSERT INTO buyers_lists (id, deal_id, name, description, deal_type, invited_buyers, invited_categories, targeting, active_from, active_to, auction_closes, locked_win, committed_plays, floor_cpm, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(l.id, ids, l.name, l.description, l.dealType ?? 'private_auction', toJson(l.invitedBuyers) ?? '[]', toJson(l.invitedCategories ?? []) ?? '[]', toJson(l.targeting) ?? '[]', l.activeFrom, l.activeTo, l.auctionCloses, null, l.committedPlays ?? null, l.floorCpm ?? null, now, now)
      syncDeals(l.id, ids, l.invitedBuyers)
      return toRecord(row(l.id) as Row)
    },
    update(id, patch) {
      if (!row(id)) return null
      prepared(db, 'UPDATE buyers_lists SET name = ?, description = ?, deal_type = ?, invited_buyers = ?, invited_categories = ?, targeting = ?, active_from = ?, active_to = ?, auction_closes = ?, committed_plays = ?, floor_cpm = ?, updated_at = ? WHERE id = ?')
        .run(patch.name, patch.description, patch.dealType, toJson(patch.invitedBuyers) ?? '[]', toJson(patch.invitedCategories ?? []) ?? '[]', toJson(patch.targeting) ?? '[]', patch.activeFrom, patch.activeTo, patch.auctionCloses, patch.committedPlays ?? null, patch.floorCpm ?? null, new Date().toISOString(), id)
      syncDeals(id, (row(id) as Row).deal_id, patch.invitedBuyers)
      return toRecord(row(id) as Row)
    },
    dealIdFor(listId, partnerId) {
      const r = row(listId)
      if (!r) return null
      const existing = prepared(db, 'SELECT * FROM buyers_list_deals WHERE list_id = ? AND partner_id = ?').get(listId, partnerId) as unknown as DealRow | undefined
      if (existing) return existing.deal_id
      const first = !prepared(db, 'SELECT 1 FROM buyers_list_deals WHERE list_id = ?').get(listId)
      const id = first ? r.deal_id : mintDealId()
      prepared(db, 'INSERT INTO buyers_list_deals (deal_id, list_id, partner_id, created_at) VALUES (?, ?, ?, ?)').run(id, listId, partnerId, new Date().toISOString())
      return id
    },
    delete(id) {
      prepared(db, 'DELETE FROM buyers_list_deals WHERE list_id = ?').run(id)
      prepared(db, 'DELETE FROM buyers_lists WHERE id = ?').run(id)
    },
    lockWin(id, win) {
      const r = row(id)
      if (!r || r.locked_win) return null
      prepared(db, 'UPDATE buyers_lists SET locked_win = ?, updated_at = ? WHERE id = ?').run(toJson(win), new Date().toISOString(), id)
      return toRecord(row(id) as Row)
    },
  }
}
