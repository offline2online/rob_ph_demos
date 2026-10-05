/* The late-play ledger (billing/late.ts): one row per play the platform
   received after its window's line item was written, valued at the window's
   cleared CPM. Written only by the ledger job and read by the lost-revenue
   report; the line items themselves are never touched (settlement is final,
   Rob, 4 Oct 2026). */
import { type Db, prepared, type Awaitable } from '../db/db'

export interface LatePlay {
  playId: string
  lineItemId: string
  reservationId: string
  campaignId: string
  positionId: string
  displayId: string
  storeId: string | null
  playedAt: string
  receivedAt: string
  durationSec: number
  tier: string | null
  cpm: number
  currency: string
  /* The realised VAC-d the play would have carried, and what it would have billed. */
  lostViews: number
  lostAmount: number
}

export type LostRevenueBy = 'store' | 'display' | 'day'
export interface LostRevenueRow { key: string; label: string; storeId: string | null; currency: string; plays: number; lostSec: number; lostViews: number; lostAmount: number }
export interface LostRevenueQuery { from: string; to: string; by: LostRevenueBy; storeId?: string; displayId?: string }

export interface LateLedgerRepo {
  /* Records the play unless it is already in the ledger; whether this call wrote it. */
  insert(p: LatePlay, recordedAt: string): Awaitable<boolean>
  /* Seconds of a line item's window already recorded as late, so a window
     is never valued above the time it was expected to play. */
  lateSecFor(lineItemId: string): Awaitable<number>
  scannedThrough(): Awaitable<string | null>
  setScannedThrough(at: string): Awaitable<void>
  /* Lost revenue for plays that PLAYED in [from, to), grouped. */
  report(q: LostRevenueQuery): Awaitable<LostRevenueRow[]>
}

export function sqliteLateLedgerRepo(db: Db): LateLedgerRepo {
  return {
    insert: (p, recordedAt) => prepared(db,
      `INSERT INTO late_plays (play_id, line_item_id, reservation_id, campaign_id, position_id, display_id, store_id, played_at, received_at, duration_sec,
         tier, cpm, currency, lost_views, lost_amount, recorded_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (play_id) DO NOTHING`,
    ).run(p.playId, p.lineItemId, p.reservationId, p.campaignId, p.positionId, p.displayId, p.storeId, p.playedAt, p.receivedAt, p.durationSec,
      p.tier, p.cpm, p.currency, p.lostViews, p.lostAmount, recordedAt).changes > 0,
    lateSecFor: (lineItemId) => (prepared(db, 'SELECT COALESCE(SUM(duration_sec), 0) AS s FROM late_plays WHERE line_item_id = ?').get(lineItemId) as { s: number }).s,
    scannedThrough: () => (prepared(db, 'SELECT scanned_through FROM late_play_scan WHERE id = 1').get() as { scanned_through: string } | undefined)?.scanned_through ?? null,
    setScannedThrough: (at) => { prepared(db, 'INSERT INTO late_play_scan (id, scanned_through) VALUES (1, ?) ON CONFLICT (id) DO UPDATE SET scanned_through = excluded.scanned_through').run(at) },
    report: ({ from, to, by, storeId, displayId }) => {
      /* The group's key and label. A play on a display or store the platform
         no longer lists keeps its id as the label. */
      const [key, label, group] = by === 'store'
        ? ['COALESCE(l.store_id, \'\')', 'COALESCE(MAX(s.name), MAX(l.store_id), \'Unknown store\')', 'l.store_id, l.currency']
        : by === 'display'
          ? ['l.display_id', 'COALESCE(MAX(d.name), l.display_id)', 'l.display_id, l.currency']
          : ['substr(l.played_at, 1, 10)', 'substr(l.played_at, 1, 10)', 'substr(l.played_at, 1, 10), l.currency']
      const where = ['l.played_at >= ?', 'l.played_at < ?']
      const args: string[] = [from, to]
      if (storeId) { where.push('l.store_id = ?'); args.push(storeId) }
      if (displayId) { where.push('l.display_id = ?'); args.push(displayId) }
      const rows = prepared(db,
        `SELECT ${key} AS k, ${label} AS label, MAX(l.store_id) AS store_id, l.currency AS currency, COUNT(*) AS plays,
                SUM(l.duration_sec) AS lost_sec, SUM(l.lost_views) AS lost_views, SUM(l.lost_amount) AS lost_amount
           FROM late_plays l LEFT JOIN stores s ON s.id = l.store_id LEFT JOIN displays d ON d.id = l.display_id
          WHERE ${where.join(' AND ')} GROUP BY ${group} ORDER BY ${by === 'day' ? 'k, currency' : 'lost_amount DESC, k, currency'}`,
      ).all(...args) as { k: string; label: string; store_id: string | null; currency: string; plays: number; lost_sec: number; lost_views: number; lost_amount: number }[]
      return rows.map((r) => ({ key: r.k, label: r.label, storeId: r.store_id, currency: r.currency, plays: r.plays, lostSec: r.lost_sec, lostViews: r.lost_views, lostAmount: r.lost_amount }))
    },
  }
}
