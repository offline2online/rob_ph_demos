/* Unsold real-time slots (domain/unsold.ts): hourly aggregate of impression
   opportunities that found no buyer. Append-only upserts; the retention sweep
   deletes whole old hours. Read by the unsold-slots report. */
import { type Db, prepared, type Awaitable } from '../db/db'

export type UnsoldReason = 'no_bids' | 'below_floor' | 'uncached' | 'no_creative' | 'other'
export const UNSOLD_REASONS: UnsoldReason[] = ['no_bids', 'below_floor', 'uncached', 'no_creative', 'other']
export type UnsoldBy = 'store' | 'display' | 'display_type' | 'hour' | 'day'

export interface UnsoldOpportunity {
  hour: string
  displayId: string
  positionId: string
  reason: UnsoldReason
  currency: string
  storeId: string | null
  displayTypeId: string
  floorCpm: number
  views: number
}
export interface UnsoldRow { key: string; label: string; currency: string; impressions: number; floorCpmAvg: number; missedViews: number; missedAmount: number; reasons: Partial<Record<UnsoldReason, number>> }
export interface UnsoldQuery { from: string; to: string; by: UnsoldBy; storeId?: string; displayId?: string; displayTypeId?: string }

export interface UnsoldSlotRepo {
  record(o: UnsoldOpportunity): Awaitable<void>
  /* Opportunities whose hour is in [from, to), both ISO instants. */
  report(q: UnsoldQuery): Awaitable<UnsoldRow[]>
  /* Deletes whole hours before `cutoff` (ISO instant); returns the rows deleted. */
  deleteBefore(cutoff: string): Awaitable<number>
}

const round6 = (n: number) => Math.round(n * 1e6) / 1e6

export function sqliteUnsoldSlotRepo(db: Db): UnsoldSlotRepo {
  return {
    record: (o) => {
      prepared(db,
        `INSERT INTO unsold_slots (hour, display_id, position_id, reason, currency, store_id, display_type_id, impressions, floor_cpm_sum, missed_views, missed_amount)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
         ON CONFLICT (hour, display_id, position_id, reason, currency) DO UPDATE SET impressions = impressions + 1, floor_cpm_sum = floor_cpm_sum + excluded.floor_cpm_sum,
           missed_views = missed_views + excluded.missed_views, missed_amount = missed_amount + excluded.missed_amount`,
      ).run(o.hour, o.displayId, o.positionId, o.reason, o.currency, o.storeId, o.displayTypeId, o.floorCpm, o.views, (o.views / 1000) * o.floorCpm)
    },
    report: ({ from, to, by, storeId, displayId, displayTypeId }) => {
      const [key, label, group] = by === 'store'
        ? ['COALESCE(u.store_id, \'\')', 'COALESCE(MAX(s.name), MAX(u.store_id), \'Unknown store\')', 'u.store_id']
        : by === 'display'
          ? ['u.display_id', 'COALESCE(MAX(d.name), u.display_id)', 'u.display_id']
          : by === 'display_type'
            ? ['u.display_type_id', 'COALESCE(MAX(t.name), u.display_type_id)', 'u.display_type_id']
            : by === 'hour'
              ? ['substr(u.hour, 12, 2)', 'substr(u.hour, 12, 2) || \':00\'', 'substr(u.hour, 12, 2)']
              : ['substr(u.hour, 1, 10)', 'substr(u.hour, 1, 10)', 'substr(u.hour, 1, 10)']
      const where = ['u.hour >= ?', 'u.hour < ?']
      const args: string[] = [from.slice(0, 13), to.slice(0, 13)]
      if (storeId) { where.push('u.store_id = ?'); args.push(storeId) }
      if (displayId) { where.push('u.display_id = ?'); args.push(displayId) }
      if (displayTypeId) { where.push('u.display_type_id = ?'); args.push(displayTypeId) }
      const rows = prepared(db,
        `SELECT ${key} AS k, ${label} AS label, u.currency AS currency, u.reason AS reason, SUM(u.impressions) AS n, SUM(u.floor_cpm_sum) AS floor_sum,
                SUM(u.missed_views) AS views, SUM(u.missed_amount) AS amount
           FROM unsold_slots u LEFT JOIN stores s ON s.id = u.store_id LEFT JOIN displays d ON d.id = u.display_id LEFT JOIN display_types t ON t.id = u.display_type_id
          WHERE ${where.join(' AND ')} GROUP BY ${group}, u.currency, u.reason`,
      ).all(...args) as { k: string; label: string; currency: string; reason: UnsoldReason; n: number; floor_sum: number; views: number; amount: number }[]
      /* Fold the per-reason rows into one row per group and currency. */
      const out = new Map<string, UnsoldRow & { floorSum: number }>()
      for (const r of rows) {
        const id = `${r.k}\u0000${r.currency}`
        const row = out.get(id) ?? { key: r.k, label: r.label, currency: r.currency, impressions: 0, floorCpmAvg: 0, missedViews: 0, missedAmount: 0, reasons: {}, floorSum: 0 }
        row.impressions += r.n; row.floorSum += r.floor_sum; row.missedViews += r.views; row.missedAmount += r.amount
        row.reasons[r.reason] = (row.reasons[r.reason] ?? 0) + r.n
        out.set(id, row)
      }
      return [...out.values()].map(({ floorSum, ...r }) => ({ ...r, floorCpmAvg: r.impressions ? round6(floorSum / r.impressions) : 0, missedViews: round6(r.missedViews), missedAmount: round6(r.missedAmount) }))
        .sort((a, b) => (by === 'day' || by === 'hour' ? a.key.localeCompare(b.key) : b.missedAmount - a.missedAmount || a.key.localeCompare(b.key)) || a.currency.localeCompare(b.currency))
    },
    deleteBefore: (cutoff) => Number(prepared(db, 'DELETE FROM unsold_slots WHERE hour < ?').run(cutoff.slice(0, 13)).changes),
  }
}
