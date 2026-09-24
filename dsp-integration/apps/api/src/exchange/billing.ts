/* Billing (spec §4 "Billing", §7 "Proof of play is the billing record"):
   dynamic VAC-d. Once a window has ended, every live, handed-off win or
   reservation is reconciled against the existing playback data, read only:

     expected = displays × window length × the slot's share of voice
     played   = the campaign's actual play time on those displays in the window
     realised VAC-d = assumed views per window × min(1, played / expected)
     amount   = realised VAC-d / 1000 × the clearing CPM

   Plays that didn't happen (display offline, store closed, loop cut short)
   are not billed (Q29). Line items are stored only: no UI, report or API.

   Scalability (review, 24 Sep 2026). Billing runs every minute in the API
   process, so it reads only what it can bill now — the database answers
   "won or reserved, live, handed off, window ended, not billed yet" in one
   indexed query (ReservationRepo.billable) instead of this code loading
   every line item ever written and every window ever won to compare them
   (1.3 s a tick after 100,000 windows). The plays are counted and summed
   where they are stored (PlaybackSource.totals) instead of being read row
   by row: one window on 1,000 displays is 1.9 million plays, which took
   23 s and held every request on the API's one thread. */
import { randomUUID } from 'node:crypto'
import type { Context } from '../context'
import { prepared } from '../db/db'
import { findPosition, windowMs } from '../domain/positions'
import { slotCountOf } from '../domain/slots'

export interface LineItem {
  id: string
  reservationId: string
  partnerId: string
  advertiserId: string | null
  campaignId: string
  positionId: string
  windowStart: string
  windowEnd: string
  plays: number
  playedSec: number
  expectedSec: number
  assumedViews: number
  realisedViews: number
  cpm: number
  currency: string
  amount: number
}

const round2 = (n: number) => Math.round(n * 100) / 100

/* Bills every live, handed-off window that has ended and isn't billed yet. */
export function runBilling(ctx: Context): LineItem[] {
  const now = ctx.clock().getTime()
  const len = windowMs(ctx)
  const out: LineItem[] = []
  /* A window has ended once its start is a whole window ago. */
  for (const r of ctx.reservations.billable(new Date(now - len).toISOString())) {
    const end = Date.parse(r.windowStart) + len
    const p = findPosition(ctx, r.positionId)
    if (!p) continue
    const displays = ctx.displays.summaryByDisplayType(p.displayType.id).displays
    const played = ctx.playback.totals({ campaignId: r.campaignId as string, displayTypeId: p.displayType.id, from: r.windowStart, to: new Date(end).toISOString() })
    const slots = slotCountOf(p.displayType)
    const share = slots ? 1 / slots : 1
    const expectedSec = displays * (len / 1000) * share
    const assumedViews = ctx.audience.forSlot(p.displayType.id, p.slot).assumedViewsPerWindow
    const realisedViews = Math.round(assumedViews * (expectedSec > 0 ? Math.min(1, played.playedSec / expectedSec) : 0))
    const item: LineItem = {
      id: `bl_${randomUUID().slice(0, 12)}`, reservationId: r.id, partnerId: r.partnerId, advertiserId: r.advertiserId, campaignId: r.campaignId as string,
      positionId: r.positionId, windowStart: r.windowStart, windowEnd: new Date(end).toISOString(), plays: played.plays, playedSec: played.playedSec, expectedSec,
      assumedViews, realisedViews, cpm: r.clearingCpm as number, currency: r.currency, amount: round2((realisedViews / 1000) * (r.clearingCpm as number)),
    }
    prepared(ctx.db,
      `INSERT INTO billing_line_items (id, reservation_id, partner_id, advertiser_id, campaign_id, position_id, window_start, window_end, plays,
         played_sec, expected_sec, assumed_views, realised_views, cpm, currency, amount, computed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(item.id, item.reservationId, item.partnerId, item.advertiserId, item.campaignId, item.positionId, item.windowStart, item.windowEnd, item.plays,
      item.playedSec, item.expectedSec, item.assumedViews, item.realisedViews, item.cpm, item.currency, item.amount, new Date(now).toISOString())
    out.push(item)
  }
  return out
}

export function lineItems(ctx: Context): LineItem[] {
  const rows = ctx.db.prepare('SELECT * FROM billing_line_items ORDER BY window_start, id').all() as Record<string, unknown>[]
  return rows.map((r) => ({
    id: r.id as string, reservationId: r.reservation_id as string, partnerId: r.partner_id as string, advertiserId: r.advertiser_id as string | null,
    campaignId: r.campaign_id as string, positionId: r.position_id as string, windowStart: r.window_start as string, windowEnd: r.window_end as string,
    plays: r.plays as number, playedSec: r.played_sec as number, expectedSec: r.expected_sec as number, assumedViews: r.assumed_views as number,
    realisedViews: r.realised_views as number, cpm: r.cpm as number, currency: r.currency as string, amount: r.amount as number,
  }))
}
