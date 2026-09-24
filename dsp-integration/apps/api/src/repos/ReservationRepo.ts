/* Reservations, bids and their outcomes, per position and play window. */
import { type Db, prepared } from '../db/db'

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
  /* When the row was written (read only; insert stamps it). The auction
     breaks a tie on it: the earlier bid wins. */
  createdAt?: string
}

interface Row {
  id: string; partner_id: string; advertiser_id: string | null; campaign_id: string | null; position_id: string; window_start: string
  type: 'reserve' | 'bid'; channel: 'api' | 'openrtb'; bid_cpm: number | null; currency: string; status: ReservationStatus
  clearing_cpm: number | null; reason: string | null; test_mode: number; pricing_type: string | null; handed_off_at: string | null
  created_at: string
}
const toRecord = (r: Row): ReservationRecord => ({
  id: r.id, partnerId: r.partner_id, advertiserId: r.advertiser_id, campaignId: r.campaign_id, positionId: r.position_id, windowStart: r.window_start,
  type: r.type, channel: r.channel, bidCpm: r.bid_cpm, currency: r.currency, status: r.status, clearingCpm: r.clearing_cpm, reason: r.reason,
  testMode: !!r.test_mode, pricingType: r.pricing_type, handedOffAt: r.handed_off_at, createdAt: r.created_at,
})

/* A window is taken once something has won or reserved it. */
export const TAKEN: ReservationStatus[] = ['won', 'reserved']

export interface ReservationRepo {
  get(id: string): ReservationRecord | null
  insert(r: ReservationRecord): ReservationRecord
  update(id: string, patch: Partial<Pick<ReservationRecord, 'status' | 'clearingCpm' | 'reason' | 'handedOffAt'>>): ReservationRecord | null
  forWindow(positionId: string, windowStart: string): ReservationRecord[]
  inRange(positionId: string, from: string, to: string): ReservationRecord[]
  byStatus(status: ReservationStatus[], from?: string, to?: string): ReservationRecord[]
  /* Every window already won or reserved (live, not Test mode) starting in
     [from, to), for every position at once: one ranged query for the whole
     estate, for callers that ask about every position (review, 24 Sep 2026). */
  takenInRange(from: string, to: string): Map<string, Set<string>>
  /* What billing can bill now: won or reserved, live, handed off, with a
     campaign and a clearing price, whose window started at or before
     `endedBy` and that has no billing line item yet. One indexed query
     (reservations (status, window_start); billing_line_items.reservation_id
     is unique) however many windows have ever been sold or billed. */
  billable(endedBy: string): ReservationRecord[]
  /* Live API bids still pending for a window that has already started:
     nothing will clear them now (the auction never ran, or ran before they
     were placed). The tick settles them as lost (scheduler.ts). */
  stalePending(startedBy: string): ReservationRecord[]
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
           status, clearing_cpm, reason, test_mode, pricing_type, handed_off_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(r.id, r.partnerId, r.advertiserId, r.campaignId, r.positionId, r.windowStart, r.type, r.channel, r.bidCpm, r.currency,
        r.status, r.clearingCpm, r.reason, r.testMode ? 1 : 0, r.pricingType, r.handedOffAt, now, now)
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
    forWindow: (positionId, windowStart) =>
      (prepared(db, 'SELECT * FROM reservations WHERE position_id = ? AND window_start = ? ORDER BY created_at, id').all(positionId, windowStart) as unknown as Row[]).map(toRecord),
    inRange: (positionId, from, to) =>
      (prepared(db, 'SELECT * FROM reservations WHERE position_id = ? AND window_start >= ? AND window_start < ? ORDER BY window_start').all(positionId, from, to) as unknown as Row[]).map(toRecord),
    byStatus(status, from = '0000', to = '9999') {
      const rows = prepared(db, `SELECT * FROM reservations WHERE status IN (${status.map(() => '?').join(', ')}) AND window_start >= ? AND window_start < ? ORDER BY window_start, id`)
        .all(...status, from, to) as unknown as Row[]
      return rows.map(toRecord)
    },
    takenInRange(from, to) {
      const rows = prepared(db, "SELECT position_id, window_start FROM reservations WHERE status IN ('won', 'reserved') AND test_mode = 0 AND window_start >= ? AND window_start < ?")
        .all(from, to) as unknown as { position_id: string; window_start: string }[]
      const out = new Map<string, Set<string>>()
      for (const r of rows) {
        let s = out.get(r.position_id)
        if (!s) out.set(r.position_id, (s = new Set()))
        s.add(r.window_start)
      }
      return out
    },
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
