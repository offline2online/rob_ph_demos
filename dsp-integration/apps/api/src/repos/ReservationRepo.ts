/* Reservations, bids and their outcomes, per position and play window. */
import { type Db, prepared, type Awaitable } from '../db/db'

export type ReservationStatus = 'pending' | 'won' | 'lost' | 'reserved' | 'rejected'
export interface ReservationRecord {
  id: string
  partnerId: string
  advertiserId: string | null
  campaignId: string | null
  positionId: string
  windowStart: string
  type: 'reserve' | 'bid'
  channel: 'api' | 'openrtb'
  bidCpm: number | null
  currency: string
  status: ReservationStatus
  clearingCpm: number | null
  reason: string | null
  testMode: boolean
  pricingType: string | null
  handedOffAt: string | null
  /* Guaranteed deal path: 'preferred' is the no-volume reserve; 'guaranteed' commits guaranteedImpressions
     (the forecast less the buffer, domain/guarantee.ts). Both null on a preferred deal and on a bid. */
  dealType?: 'preferred' | 'guaranteed'
  forecastImpressions?: number | null
  guaranteedImpressions?: number | null
  /* When the row was written (read only; insert stamps it). The auction
     breaks a tie on it: the earlier bid wins. */
  createdAt?: string
}

interface Row {
  id: string; partner_id: string; advertiser_id: string | null; campaign_id: string | null; position_id: string; window_start: string
  type: 'reserve' | 'bid'; channel: 'api' | 'openrtb'; bid_cpm: number | null; currency: string; status: ReservationStatus
  clearing_cpm: number | null; reason: string | null; test_mode: number; pricing_type: string | null; handed_off_at: string | null
  created_at: string; deal_type: 'preferred' | 'guaranteed'; forecast_impressions: number | null; guaranteed_impressions: number | null
}
const toRecord = (r: Row): ReservationRecord => ({
  id: r.id, partnerId: r.partner_id, advertiserId: r.advertiser_id, campaignId: r.campaign_id, positionId: r.position_id, windowStart: r.window_start,
  type: r.type, channel: r.channel, bidCpm: r.bid_cpm, currency: r.currency, status: r.status, clearingCpm: r.clearing_cpm, reason: r.reason,
  testMode: !!r.test_mode, pricingType: r.pricing_type, handedOffAt: r.handed_off_at, createdAt: r.created_at,
  dealType: r.deal_type ?? 'preferred', forecastImpressions: r.forecast_impressions ?? null, guaranteedImpressions: r.guaranteed_impressions ?? null,
})

/* A window is taken once something has won or reserved it. */
export const TAKEN: ReservationStatus[] = ['won', 'reserved']

export interface ReservationRepo {
  get(id: string): Awaitable<ReservationRecord | null>
  insert(r: ReservationRecord): Awaitable<ReservationRecord>
  update(id: string, patch: Partial<Pick<ReservationRecord, 'status' | 'clearingCpm' | 'reason' | 'handedOffAt'>>): Awaitable<ReservationRecord | null>
  forWindow(positionId: string, windowStart: string): Awaitable<ReservationRecord[]>
  inRange(positionId: string, from: string, to: string): Awaitable<ReservationRecord[]>
  byStatus(status: ReservationStatus[], from?: string, to?: string): Awaitable<ReservationRecord[]>
  /* Every window already won or reserved (live, not Test mode) starting in
     [from, to), for every position at once: one ranged query for the whole
     estate, for callers that ask about every position (review, 24 Sep 2026).
     Position → window start → which of the two took it (a reserve-price
     hold reads Reserved, not Sold — OQ52). */
  takenInRange(from: string, to: string): Awaitable<Map<string, Map<string, ReservationStatus>>>
  /* Per campaign, its live (non-test) won/reserved windows: how many in all,
     and the first that starts at or after `now`. Counted in the database —
     the campaigns list used to load every sale ever made to count them. */
  liveByCampaign(now: string): Awaitable<Map<string, { bookedWindows: number; nextWindowStart: string | null }>>
  /* What billing can bill now: won or reserved, live, handed off, with a
     campaign and a clearing price, whose window started at or before
     `endedBy` and that has no billing line item yet. One indexed query
     (reservations (status, window_start); billing_line_items.reservation_id
     is unique) however many windows have ever been sold or billed. */
  billable(endedBy: string): Awaitable<ReservationRecord[]>
  /* Live API bids still pending for a window that has already started:
     nothing will clear them now (the auction never ran, or ran before they
     were placed). The tick settles them as lost (scheduler.ts). */
  stalePending(startedBy: string): Awaitable<ReservationRecord[]>
  /* Deletes settled bids nothing reads any more — rejected, lost and
     never-cleared pending — whose window started before `cutoff`; how many
     went (domain/reservationRetention.ts). Won and reserved are kept. */
  deleteSettledBefore(cutoff: string): Awaitable<number>
}

export function sqliteReservationRepo(db: Db): ReservationRepo {
  const get = (id: string) => {
    const r = prepared(db, 'SELECT * FROM reservations WHERE id = ?').get(id) as Row | undefined
    return r ? toRecord(r) : null
  }
  return {
    get,
    insert(r) {
      const now = new Date().toISOString()
      prepared(db,
        `INSERT INTO reservations (id, partner_id, advertiser_id, campaign_id, position_id, window_start, type, channel, bid_cpm, currency,
           status, clearing_cpm, reason, test_mode, pricing_type, handed_off_at, created_at, updated_at, deal_type, forecast_impressions, guaranteed_impressions)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(r.id, r.partnerId, r.advertiserId, r.campaignId, r.positionId, r.windowStart, r.type, r.channel, r.bidCpm, r.currency,
        r.status, r.clearingCpm, r.reason, r.testMode ? 1 : 0, r.pricingType, r.handedOffAt, now, now, r.dealType ?? 'preferred', r.forecastImpressions ?? null, r.guaranteedImpressions ?? null)
      return get(r.id) as ReservationRecord
    },
    update(id, patch) {
      const cur = get(id)
      if (!cur) return null
      const n = { ...cur, ...patch }
      prepared(db, 'UPDATE reservations SET status = ?, clearing_cpm = ?, reason = ?, handed_off_at = ?, updated_at = ? WHERE id = ?')
        .run(n.status, n.clearingCpm, n.reason, n.handedOffAt, new Date().toISOString(), id)
      return get(id)
    },
    /* created_at is the wall clock to the millisecond, so two bids can share
       it; seq (migration 0037) then keeps them in the order they arrived. Ordering by id (a
       random token) made "equal bids: the one placed first wins" a coin toss
       whenever both landed in the same millisecond. */
    forWindow: (positionId, windowStart) =>
      (prepared(db, 'SELECT * FROM reservations WHERE position_id = ? AND window_start = ? ORDER BY created_at, seq').all(positionId, windowStart) as unknown as Row[]).map(toRecord),
    inRange: (positionId, from, to) =>
      (prepared(db, 'SELECT * FROM reservations WHERE position_id = ? AND window_start >= ? AND window_start < ? ORDER BY window_start').all(positionId, from, to) as unknown as Row[]).map(toRecord),
    byStatus(status, from = '0000', to = '9999') {
      const rows = prepared(db, `SELECT * FROM reservations WHERE status IN (${status.map(() => '?').join(', ')}) AND window_start >= ? AND window_start < ? ORDER BY window_start, id`)
        .all(...status, from, to) as unknown as Row[]
      return rows.map(toRecord)
    },
    takenInRange(from, to) {
      const rows = prepared(db, "SELECT position_id, window_start, status FROM reservations WHERE status IN ('won', 'reserved') AND test_mode = 0 AND window_start >= ? AND window_start < ?")
        .all(from, to) as unknown as { position_id: string; window_start: string; status: ReservationStatus }[]
      const out = new Map<string, Map<string, ReservationStatus>>()
      for (const r of rows) {
        let s = out.get(r.position_id)
        if (!s) out.set(r.position_id, (s = new Map()))
        s.set(r.window_start, r.status)
      }
      return out
    },
    liveByCampaign(now) {
      const rows = prepared(db, `SELECT campaign_id, COUNT(*) AS n, MIN(CASE WHEN window_start >= ? THEN window_start END) AS next
         FROM reservations WHERE status IN ('won', 'reserved') AND test_mode = 0 AND campaign_id IS NOT NULL GROUP BY campaign_id`)
        .all(now) as unknown as { campaign_id: string; n: number; next: string | null }[]
      return new Map(rows.map((r) => [r.campaign_id, { bookedWindows: r.n, nextWindowStart: r.next }]))
    },
    deleteSettledBefore: (cutoff) =>
      Number(prepared(db, "DELETE FROM reservations WHERE status IN ('rejected', 'lost', 'pending') AND window_start < ?").run(cutoff).changes),
    stalePending: (startedBy) =>
      (prepared(db, "SELECT * FROM reservations WHERE status = 'pending' AND window_start <= ? ORDER BY window_start, id").all(startedBy) as unknown as Row[]).map(toRecord),
    billable: (endedBy) =>
      (prepared(db,
        `SELECT r.* FROM reservations r
          WHERE r.status IN ('won', 'reserved') AND r.test_mode = 0 AND r.handed_off_at IS NOT NULL
            AND r.campaign_id IS NOT NULL AND r.clearing_cpm IS NOT NULL AND r.window_start <= ?
            AND NOT EXISTS (SELECT 1 FROM billing_line_items b WHERE b.reservation_id = r.id)
          ORDER BY r.window_start, r.id`,
      ).all(endedBy) as unknown as Row[]).map(toRecord),
  }
}
