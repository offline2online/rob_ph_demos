/* Buyers lists (spec "Support private auctions"): reusable private-auction
   deal objects, independent of any one slot. Two-period model (23 Sep
   2026): auction_closes is the deal's own one-time bidding deadline;
   locked_win (JSON, see LockedWin) is null until that auction clears, and
   set once, never overwritten — see lockWin. */
import type { BuyerAcceptance, BuyersList, BuyersListDealType, Condition, InvitedBuyer, LockedWin, TermChange, TimeZoneMode, TermVersion } from '@ph-dsp/types'
import { DIRECT_PARTNER_ID } from '@ph-dsp/types'
import { needsReacceptance, termChanges } from '../domain/termVersions'
import { randomInt } from 'node:crypto'
import { type Db, fromJson, prepared, toJson, tx, type Awaitable } from '../db/db'

interface Row {
  id: string; deal_id: string; name: string; description: string; deal_type: 'private_auction' | 'preferred' | 'guaranteed'; invited_buyers: string; invited_categories: string; targeting: string; active_from: string | null; active_to: string | null
  auction_closes: string | null; locked_win: string | null; committed_plays: number | null; floor_cpm: number | null; term_total: number | null; below_floor_override: number; below_floor_override_by: string | null; below_floor_override_at: string | null; created_at: string; updated_at: string; term_version: number; reaccept_version: number; shared_at: string | null; direct: number; archived_at: string | null; archived_by: string | null; time_zone_mode: 'platform' | 'store'
}
interface AcceptanceRow { partner_id: string; seat_id: string; accepted_version: number; accepted_at: string }
interface VersionRow { version: number; at: string; by_name: string; changes: string; requires_reacceptance: number }

/* The deal ID the platform mints for a new list: PH- plus 10 characters from an alphabet without look-alikes (no 0/O, 1/I/L), e.g. PH-7K2M9QXW4B. Never typed, never edited; the unique index makes a collision a retry, not a duplicate. */
const DEAL_ID_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'
export const mintDealId = (): string => `PH-${Array.from({ length: 10 }, () => DEAL_ID_ALPHABET[randomInt(DEAL_ID_ALPHABET.length)]).join('')}`

/* A Direct advertiser deal is stored as a guaranteed deal with the direct flag set (migration 0081). */
const storedType = (d: BuyersListDealType | undefined): 'private_auction' | 'preferred' | 'guaranteed' => (d === 'direct' ? 'guaranteed' : d ?? 'private_auction')

export interface DealRow { deal_id: string; list_id: string; partner_id: string; retired_at: string | null }

export interface BuyersListRepo {
  /* Live deals by default (every consumer wants those); 'archived' is the archive, 'all' both. The SSP change history snapshots 'all', so archiving reads as an update, not a delete. */
  list(scope?: 'live' | 'archived' | 'all'): Awaitable<BuyersList[]>
  get(id: string): Awaitable<BuyersList | null>
  insert(l: { by?: string; id: string; dealId?: string; name: string; description: string; dealType?: BuyersListDealType; invitedBuyers: InvitedBuyer[]; invitedCategories?: string[]; targeting?: Condition[]; activeFrom: string | null; activeTo: string | null; timeZoneMode?: TimeZoneMode; auctionCloses: string | null; committedPlays?: number | null; floorCpm?: number | null; termTotal?: number | null; belowFloorOverride?: boolean; /* false: saved as a draft, shared with no DSP yet. Omitted: shared, as every list was before drafts existed. */ shared?: boolean }): Awaitable<BuyersList>
  update(id: string, patch: { by?: string; name: string; description: string; dealType: BuyersListDealType; invitedBuyers: InvitedBuyer[]; invitedCategories?: string[]; targeting?: Condition[]; activeFrom: string | null; activeTo: string | null; /* Omitted keeps the stored mode. */ timeZoneMode?: TimeZoneMode; auctionCloses: string | null; committedPlays?: number | null; floorCpm?: number | null; termTotal?: number | null; belowFloorOverride?: boolean }): Awaitable<BuyersList | null>
  /* Stores the committed plays derived from the deal's assigned slots, term and guarantee buffer (never typed in). On a shared deal a changed figure versions the terms and asks accepted buyers to accept again; a draft has been sent to no one, so nothing is versioned. Null if the list doesn't exist. */
  setCommittedPlays(id: string, committedPlays: number | null, by?: string): Awaitable<BuyersList | null>
  /* Deals are never deleted. Archiving keeps the row, its deal IDs, terms and history; `by` is the person's name, or 'system' at the end of flight. Idempotent (an archived deal keeps its first archive). Null if the list doesn't exist. */
  /* `at`: when it was archived; the scheduler passes its own clock so a test clock is honoured. Default now. */
  archive(id: string, by: string, at?: string): Awaitable<BuyersList | null>
  /* Permanently removes a deal that was never shared (a draft): the row, its per-DSP deal IDs, term versions and acceptances. The route has already refused a shared or archived deal. False if the list doesn't exist. */
  delete(id: string): Awaitable<boolean>
  /* Shares a draft deal with its invited buyers: stamps shared_at. From here its term changes ask buyers to re-accept. Idempotent (a shared deal keeps its first shared_at). Null if the list doesn't exist. */
  share(id: string): Awaitable<BuyersList | null>
  /* Records that a named invited buyer accepted the deal's current terms. Null if the list doesn't exist; the route has already checked the seat is invited. */
  accept(id: string, partnerId: string, seatId: string): Awaitable<BuyersList | null>
  /* Newest first. */
  termVersions(id: string): Awaitable<TermVersion[]>
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
    const named = [...new Set(invited.map((b) => b.partnerId))].filter((id) => id !== DIRECT_PARTNER_ID)
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
  /* One entry per named invited buyer: pending until it accepts; accepted while it holds a version at or after the last change that needed re-acceptance. */
  const acceptanceOf = (r: Row): BuyerAcceptance[] => {
    const have = new Map((prepared(db, 'SELECT * FROM buyers_list_acceptances WHERE list_id = ?').all(r.id) as unknown as AcceptanceRow[]).map((a) => [`${a.partner_id}\u0000${a.seat_id}`, a]))
    return (fromJson(r.invited_buyers, []) as InvitedBuyer[]).map((b) => {
      const a = have.get(`${b.partnerId}\u0000${b.seatId}`)
      return { partnerId: b.partnerId, seatId: b.seatId, state: !a ? 'pending' : a.accepted_version >= r.reaccept_version ? 'accepted' : 'reacceptance_required', acceptedVersion: a?.accepted_version ?? null, acceptedAt: a?.accepted_at ?? null }
    })
  }
  const toRecord = (r: Row): BuyersList => ({
    id: r.id, dealId: r.deal_id, deals: dealsOf(r.id, r.deal_id), name: r.name, description: r.description, dealType: r.direct ? 'direct' : r.deal_type, invitedBuyers: fromJson(r.invited_buyers, []), invitedCategories: fromJson(r.invited_categories, []), targeting: fromJson(r.targeting, []),
    activeFrom: r.active_from, activeTo: r.active_to, timeZoneMode: r.time_zone_mode ?? 'platform', auctionCloses: r.auction_closes, lockedWin: fromJson(r.locked_win, null),
    committedPlays: r.committed_plays, floorCpm: r.floor_cpm, termTotal: r.term_total, belowFloorOverride: r.below_floor_override === 1, belowFloorOverrideBy: r.below_floor_override_by, belowFloorOverrideAt: r.below_floor_override_at, equivalentCpm: null, deliveredPlays: 0,
    /* Resolved against the platform and DSP levels by the admin route (withDelivery); the row alone can't know them. */
    effectiveCommittedPlays: { min: r.committed_plays, max: r.committed_plays, source: r.committed_plays == null ? 'none' : 'buyer' },
    effectiveRateCpm: { min: r.floor_cpm, max: r.floor_cpm, source: r.floor_cpm == null ? 'none' : 'buyer' },
    /* A Direct advertiser deal has no buyer acceptance (Finalise makes it live), so it reports none rather than a pending one. */
    termVersion: r.term_version, buyerAcceptance: r.direct ? [] : acceptanceOf(r),
    status: r.archived_at ? 'archived' : r.shared_at ? 'shared' : 'draft', sharedAt: r.shared_at, archivedAt: r.archived_at, archivedBy: r.archived_by, assignedSlots: [],
    createdAt: r.created_at, updatedAt: r.updated_at,
  })
  const row = (id: string) => prepared(db, 'SELECT * FROM buyers_lists WHERE id = ?').get(id) as Row | undefined
  return {
    list: (scope = 'live') => (prepared(db, `SELECT * FROM buyers_lists ${scope === 'all' ? '' : scope === 'archived' ? 'WHERE archived_at IS NOT NULL' : 'WHERE archived_at IS NULL'} ORDER BY seq`).all() as unknown as Row[]).map(toRecord),
    get: (id) => {
      const r = row(id)
      return r ? toRecord(r) : null
    },
    insert(l) {
      const now = new Date().toISOString()
      const ids = l.dealId ?? mintDealId()
      prepared(db, 'INSERT INTO buyers_lists (id, deal_id, name, description, deal_type, invited_buyers, invited_categories, targeting, active_from, active_to, auction_closes, locked_win, committed_plays, floor_cpm, term_total, created_at, updated_at, shared_at, direct, below_floor_override, below_floor_override_by, below_floor_override_at, time_zone_mode) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(l.id, ids, l.name, l.description, storedType(l.dealType), toJson(l.invitedBuyers) ?? '[]', toJson(l.invitedCategories ?? []) ?? '[]', toJson(l.targeting) ?? '[]', l.activeFrom, l.activeTo, l.auctionCloses, null, l.committedPlays ?? null, l.floorCpm ?? null, l.termTotal ?? null, now, now, l.shared === false ? null : now, l.dealType === 'direct' ? 1 : 0, l.belowFloorOverride ? 1 : 0, l.belowFloorOverride ? l.by ?? 'system' : null, l.belowFloorOverride ? now : null, l.timeZoneMode ?? 'platform')
      syncDeals(l.id, ids, l.invitedBuyers)
      prepared(db, 'INSERT INTO buyers_list_term_versions (list_id, version, at, by_name, changes, requires_reacceptance) VALUES (?, 1, ?, ?, ?, 0)').run(l.id, now, l.by ?? 'system', '[]')
      return toRecord(row(l.id) as Row)
    },
    update(id, patch) {
      const before = row(id)
      if (!before) return null
      const now = new Date().toISOString()
      return tx(db, () => {
        const was = toRecord(before)
        /* A draft has been sent to no one, so nobody has terms to re-accept: its edits are not versioned. */
        const changes = !before.shared_at ? [] : termChanges(was, { floorCpm: patch.floorCpm ?? null, termTotal: patch.termTotal ?? null, committedPlays: patch.committedPlays ?? null, activeFrom: patch.activeFrom, activeTo: patch.activeTo, auctionCloses: patch.auctionCloses, invitedBuyers: patch.invitedBuyers, invitedCategories: patch.invitedCategories ?? [] })
        const version = before.term_version + (changes.length ? 1 : 0)
        const reaccept = needsReacceptance(changes) ? version : before.reaccept_version
        prepared(db, 'UPDATE buyers_lists SET name = ?, description = ?, deal_type = ?, direct = ?, invited_buyers = ?, invited_categories = ?, targeting = ?, active_from = ?, active_to = ?, auction_closes = ?, committed_plays = ?, floor_cpm = ?, term_total = ?, term_version = ?, reaccept_version = ?, updated_at = ?, below_floor_override = ?, below_floor_override_by = ?, below_floor_override_at = ?, time_zone_mode = ? WHERE id = ?')
          .run(patch.name, patch.description, storedType(patch.dealType), patch.dealType === 'direct' ? 1 : 0, toJson(patch.invitedBuyers) ?? '[]', toJson(patch.invitedCategories ?? []) ?? '[]', toJson(patch.targeting) ?? '[]', patch.activeFrom, patch.activeTo, patch.auctionCloses, patch.committedPlays ?? null, patch.floorCpm ?? null, patch.termTotal ?? null, version, reaccept, now, patch.belowFloorOverride ? 1 : 0, patch.belowFloorOverride ? patch.by ?? 'system' : null, patch.belowFloorOverride ? now : null, patch.timeZoneMode ?? before.time_zone_mode ?? 'platform', id)
        if (changes.length) prepared(db, 'INSERT INTO buyers_list_term_versions (list_id, version, at, by_name, changes, requires_reacceptance) VALUES (?, ?, ?, ?, ?, ?)').run(id, version, now, patch.by ?? 'system', toJson(changes) ?? '[]', needsReacceptance(changes) ? 1 : 0)
        /* A removed buyer's acceptance goes with it; re-inviting starts pending. */
        const keep = new Set(patch.invitedBuyers.map((b) => `${b.partnerId}\u0000${b.seatId}`))
        for (const a of prepared(db, 'SELECT * FROM buyers_list_acceptances WHERE list_id = ?').all(id) as unknown as AcceptanceRow[]) {
          if (!keep.has(`${a.partner_id}\u0000${a.seat_id}`)) prepared(db, 'DELETE FROM buyers_list_acceptances WHERE list_id = ? AND partner_id = ? AND seat_id = ?').run(id, a.partner_id, a.seat_id)
        }
        syncDeals(id, before.deal_id, patch.invitedBuyers)
        return toRecord(row(id) as Row)
      })
    },
    setCommittedPlays(id, committedPlays, by) {
      const before = row(id)
      if (!before) return null
      if ((before.committed_plays ?? null) === committedPlays) return toRecord(before)
      const now = new Date().toISOString()
      return tx(db, () => {
        const was = toRecord(before)
        const changes = !before.shared_at ? [] : termChanges(was, { ...was, committedPlays })
        const version = before.term_version + (changes.length ? 1 : 0)
        const reaccept = needsReacceptance(changes) ? version : before.reaccept_version
        prepared(db, 'UPDATE buyers_lists SET committed_plays = ?, term_version = ?, reaccept_version = ?, updated_at = ? WHERE id = ?').run(committedPlays, version, reaccept, now, id)
        if (changes.length) prepared(db, 'INSERT INTO buyers_list_term_versions (list_id, version, at, by_name, changes, requires_reacceptance) VALUES (?, ?, ?, ?, ?, ?)').run(id, version, now, by ?? 'system', toJson(changes) ?? '[]', needsReacceptance(changes) ? 1 : 0)
        return toRecord(row(id) as Row)
      })
    },
    share(id) {
      const r = row(id)
      if (!r) return null
      if (!r.shared_at) {
        const now = new Date().toISOString()
        /* Every invited buyer starts pending on the terms as shared. */
        prepared(db, 'UPDATE buyers_lists SET shared_at = ?, reaccept_version = term_version, updated_at = ? WHERE id = ?').run(now, now, id)
      }
      return toRecord(row(id) as Row)
    },
    accept(id, partnerId, seatId) {
      const r = row(id)
      if (!r) return null
      prepared(db, 'INSERT INTO buyers_list_acceptances (list_id, partner_id, seat_id, accepted_version, accepted_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (list_id, partner_id, seat_id) DO UPDATE SET accepted_version = excluded.accepted_version, accepted_at = excluded.accepted_at')
        .run(id, partnerId, seatId, r.term_version, new Date().toISOString())
      return toRecord(r)
    },
    termVersions(id) {
      return (prepared(db, 'SELECT * FROM buyers_list_term_versions WHERE list_id = ? ORDER BY version DESC').all(id) as unknown as VersionRow[])
        .map((v) => ({ version: v.version, at: v.at, by: v.by_name, changes: fromJson(v.changes, []) as TermChange[], requiresReacceptance: !!v.requires_reacceptance }))
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
    archive(id, by, at) {
      const r = row(id)
      if (!r) return null
      if (!r.archived_at) {
        const now = at ?? new Date().toISOString()
        prepared(db, 'UPDATE buyers_lists SET archived_at = ?, archived_by = ?, updated_at = ? WHERE id = ?').run(now, by, now, id)
      }
      return toRecord(row(id) as Row)
    },
    delete(id) {
      if (!row(id)) return false
      for (const t of ['buyers_list_acceptances', 'buyers_list_term_versions', 'buyers_list_deals']) prepared(db, `DELETE FROM ${t} WHERE list_id = ?`).run(id)
      prepared(db, 'DELETE FROM buyers_lists WHERE id = ?').run(id)
      return true
    },
    lockWin(id, win) {
      const r = row(id)
      if (!r || r.locked_win) return null
      prepared(db, 'UPDATE buyers_lists SET locked_win = ?, updated_at = ? WHERE id = ?').run(toJson(win), new Date().toISOString(), id)
      return toRecord(row(id) as Row)
    },
  }
}
