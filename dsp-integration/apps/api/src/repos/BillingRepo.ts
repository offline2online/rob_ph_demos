/* Billing line items (billing/index.ts): written once per billed window —
   reservation_id is unique, so a second tick billing the same window at
   the same moment writes nothing — and read back in window order. */
import type { LineItem } from '../billing'
import { type Db, prepared, type Awaitable } from '../db/db'

export interface BillingRepo {
  /* Writes the line item unless the reservation already has one; whether this call wrote it. */
  insert(item: LineItem, computedAt: string): Awaitable<boolean>
  /* Every line item, by window start then id. */
  list(): Awaitable<LineItem[]>
  /* Which of these reservations already have a line item. One call, so the
     answer is read in one step. */
  billedAmong(reservationIds: string[]): Awaitable<Set<string>>
}

export function sqliteBillingRepo(db: Db): BillingRepo {
  return {
    insert: (item, computedAt) => prepared(db,
      `INSERT INTO billing_line_items (id, reservation_id, partner_id, advertiser_id, campaign_id, position_id, window_start, window_end, plays,
         played_sec, expected_sec, assumed_views, realised_views, cpm, currency, amount, computed_at,
         personalised_plays, personalised_views, personalised_multiplier, personalised_amount, plays_by_version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (reservation_id) DO NOTHING`,
    ).run(item.id, item.reservationId, item.partnerId, item.advertiserId, item.campaignId, item.positionId, item.windowStart, item.windowEnd, item.plays,
      item.playedSec, item.expectedSec, item.assumedViews, item.realisedViews, item.cpm, item.currency, item.amount, computedAt,
      item.personalisedPlays, item.personalisedViews, item.personalisedMultiplier, item.personalisedAmount, JSON.stringify(item.playsByVersion ?? [])).changes > 0,
    list: () => (prepared(db, 'SELECT * FROM billing_line_items ORDER BY window_start, id').all() as Record<string, unknown>[]).map((r) => ({
      id: r.id as string, reservationId: r.reservation_id as string, partnerId: r.partner_id as string, advertiserId: r.advertiser_id as string | null,
      campaignId: r.campaign_id as string, positionId: r.position_id as string, windowStart: r.window_start as string, windowEnd: r.window_end as string,
      plays: r.plays as number, playedSec: r.played_sec as number, expectedSec: r.expected_sec as number, assumedViews: r.assumed_views as number,
      realisedViews: r.realised_views as number, cpm: r.cpm as number, currency: r.currency as string, amount: r.amount as number,
      personalisedPlays: r.personalised_plays as number, personalisedViews: r.personalised_views as number,
      personalisedMultiplier: r.personalised_multiplier as number | null, personalisedAmount: r.personalised_amount as number,
      playsByVersion: JSON.parse((r.plays_by_version as string | null) ?? '[]') as LineItem['playsByVersion'],
    })),
    billedAmong: (reservationIds) => new Set(reservationIds.filter((id) => !!prepared(db, 'SELECT 1 FROM billing_line_items WHERE reservation_id = ?').get(id))),
  }
}
