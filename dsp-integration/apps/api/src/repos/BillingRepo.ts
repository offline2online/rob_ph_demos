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
  /* The billed amount of each of these reservations that has a line item —
     what a screen showing a few hundred bookings needs, read without
     loading every line item ever written. */
  amountsFor(reservationIds: string[]): Awaitable<Map<string, number>>
  /* The line items of a campaign whose window holds this moment, with when
     each was written (its settlement time): what the late-play ledger
     matches a late play against. */
  coveringPlay(campaignId: string, playedAt: string): Awaitable<{ item: LineItem; computedAt: string }[]>
}

/* SQLite's default limit on bound parameters is 32,766; a chunk of 500
   keeps every IN list far below it and the statement cache small. */
const CHUNK = 500
/* Each chunk is padded (with its own first id) to one of these lengths, so
   the prepared-statement cache holds four IN statements, not one per list
   length. */
const SIZES = [8, 32, 128, CHUNK]

const toItem = (r: Record<string, unknown>): LineItem => ({
  id: r.id as string, reservationId: r.reservation_id as string, partnerId: r.partner_id as string, advertiserId: r.advertiser_id as string | null,
  campaignId: r.campaign_id as string, positionId: r.position_id as string, windowStart: r.window_start as string, windowEnd: r.window_end as string,
  plays: r.plays as number, playedSec: r.played_sec as number, expectedSec: r.expected_sec as number, assumedViews: r.assumed_views as number,
  realisedViews: r.realised_views as number, cpm: r.cpm as number, currency: r.currency as string, amount: r.amount as number,
  personalisedPlays: r.personalised_plays as number, personalisedViews: r.personalised_views as number,
  personalisedMultiplier: r.personalised_multiplier as number | null, personalisedAmount: r.personalised_amount as number,
  playsByVersion: JSON.parse((r.plays_by_version as string | null) ?? '[]') as LineItem['playsByVersion'],
})

export function sqliteBillingRepo(db: Db): BillingRepo {
  const amounts = (ids: string[]) => {
    const out = new Map<string, number>()
    for (let i = 0; i < ids.length; i += CHUNK) {
      const chunk = ids.slice(i, i + CHUNK)
      const size = SIZES.find((n) => n >= chunk.length) as number
      while (chunk.length < size) chunk.push(chunk[0])
      for (const r of prepared(db, `SELECT reservation_id, amount FROM billing_line_items WHERE reservation_id IN (${chunk.map(() => '?').join(', ')})`).all(...chunk) as { reservation_id: string; amount: number }[]) out.set(r.reservation_id, r.amount)
    }
    return out
  }
  return {
    insert: (item, computedAt) => prepared(db,
      `INSERT INTO billing_line_items (id, reservation_id, partner_id, advertiser_id, campaign_id, position_id, window_start, window_end, plays,
         played_sec, expected_sec, assumed_views, realised_views, cpm, currency, amount, computed_at,
         personalised_plays, personalised_views, personalised_multiplier, personalised_amount, plays_by_version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (reservation_id) DO NOTHING`,
    ).run(item.id, item.reservationId, item.partnerId, item.advertiserId, item.campaignId, item.positionId, item.windowStart, item.windowEnd, item.plays,
      item.playedSec, item.expectedSec, item.assumedViews, item.realisedViews, item.cpm, item.currency, item.amount, computedAt,
      item.personalisedPlays, item.personalisedViews, item.personalisedMultiplier, item.personalisedAmount, JSON.stringify(item.playsByVersion ?? [])).changes > 0,
    list: () => (prepared(db, 'SELECT * FROM billing_line_items ORDER BY window_start, id').all() as Record<string, unknown>[]).map(toItem),
    coveringPlay: (campaignId, playedAt) => (prepared(db, 'SELECT * FROM billing_line_items WHERE campaign_id = ? AND window_start <= ? AND window_end > ? ORDER BY window_start, id')
      .all(campaignId, playedAt, playedAt) as Record<string, unknown>[]).map((r) => ({ item: toItem(r), computedAt: r.computed_at as string })),
    billedAmong: (reservationIds) => new Set(amounts(reservationIds).keys()),
    amountsFor: (reservationIds) => amounts(reservationIds),
  }
}
