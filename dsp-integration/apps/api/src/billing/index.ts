/* Billing (spec §4 "Billing", §7 "Proof of play is the billing record"):
   dynamic VAC-d. Once a window has ended, every live, handed-off win or
   reservation is reconciled against the existing playback data, read only:

     expected = displays × window length × the slot's share of voice
     played   = the campaign's actual play time on those displays in the window
     realised VAC-d = assumed views per window × min(1, played / expected)
     amount   = realised VAC-d / 1000 × the clearing CPM

   Plays that didn't happen (display offline, store closed, loop cut short)
   are not billed (Q29). Line items are stored only: no UI, report or API.

   Per slot (OQ27, Rob 29 Sep 2026): the window length here is the slot's
   own billing unit (positions.ts windowMs(ctx, p) — slot override, else
   display type default, else the company play window), so a slot with a
   168-hour unit bills one line item a week, on that week's realised VAC-d,
   with a week's expected seconds and a week's assumed views.

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
import type { PlayTotals } from '../platform/PlaybackSource'
import { assumedViewsPerWindow, findPosition, shortestWindowMs, windowMs, type PositionRef } from '../domain/positions'
import type { ReservationRecord } from '../repos/ReservationRepo'
import { rotationSizeOf } from '../domain/slots'

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

export { bookLockedTermWindow, lockTermOnClear } from './lockedTerm'
export { auctionOpenAt, isActiveAt, isTermLocked, lockedTermSpan, termStateAt, type TermState } from './term'

/* What a line item is billed on. Only proof of play exists: realised VAC-d
   from the plays the playback data recorded. Engagement-based billing for
   interactive campaigns (BUILD-PLAN section 10) is declared here so the gap
   is one visible method, not an absence: asking for it fails loudly rather
   than billing a campaign on plays that say nothing about its engagement. */
export type BillingBasis = 'proof-of-play' | 'engagement'
export const BILLING_BASIS: BillingBasis = 'proof-of-play'

export class NotImplementedError extends Error {
  constructor(what: string) { super(`${what} is not implemented`); this.name = 'NotImplementedError' }
}

export function assertBillingBasis(basis: BillingBasis): void {
  if (basis !== 'proof-of-play') throw new NotImplementedError('Engagement-based billing (BUILD-PLAN section 10)')
}

/* The billing unit of a position, in ms: its slot's billingUnitHours, else
   its display type's default, else the company play window (OQ27, Rob
   29 Sep 2026). This is not informational: it is the length of every window
   billed for the position, so a slot with a 168-hour unit bills one line
   item a week. */
export const billingUnitMs = (ctx: Context, p: PositionRef): number => windowMs(ctx, p)

const round2 = (n: number) => Math.round(n * 100) / 100

/* The seam: a cleared reservation plus the playback totals for its window
   in, one line item out. The maths is pure (no clock, no database write);
   the caller decides whether the window has ended and where the totals
   come from. */
export function computeLineItem(ctx: Context, r: ReservationRecord, p: PositionRef, played: PlayTotals, basis: BillingBasis = BILLING_BASIS): LineItem {
  assertBillingBasis(basis)
  const len = billingUnitMs(ctx, p)
  const end = Date.parse(r.windowStart) + len
  const displays = ctx.displays.summaryByDisplayType(p.displayType.id).displays
  const slots = rotationSizeOf(p.displayType, p.slot)
  const share = slots ? 1 / slots : 1
  const expectedSec = displays * (len / 1000) * share
  const assumedViews = assumedViewsPerWindow(ctx, p)
  const realisedViews = Math.round(assumedViews * (expectedSec > 0 ? Math.min(1, played.playedSec / expectedSec) : 0))
  return {
    id: `bl_${randomUUID().slice(0, 12)}`, reservationId: r.id, partnerId: r.partnerId, advertiserId: r.advertiserId, campaignId: r.campaignId as string,
    positionId: r.positionId, windowStart: r.windowStart, windowEnd: new Date(end).toISOString(), plays: played.plays, playedSec: played.playedSec, expectedSec,
    assumedViews, realisedViews, cpm: r.clearingCpm as number, currency: r.currency, amount: round2((realisedViews / 1000) * (r.clearingCpm as number)),
  }
}

/* Writes the line item. reservation_id is unique: a second tick billing the
   same window at the same moment (two API instances, a CronJob beside the
   API) writes nothing, and neither throws. The first line item stands.
   Returns whether this call wrote it. */
export function writeLineItem(ctx: Context, item: LineItem, computedAt: string): boolean {
  return prepared(ctx.db,
    `INSERT INTO billing_line_items (id, reservation_id, partner_id, advertiser_id, campaign_id, position_id, window_start, window_end, plays,
       played_sec, expected_sec, assumed_views, realised_views, cpm, currency, amount, computed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (reservation_id) DO NOTHING`,
  ).run(item.id, item.reservationId, item.partnerId, item.advertiserId, item.campaignId, item.positionId, item.windowStart, item.windowEnd, item.plays,
    item.playedSec, item.expectedSec, item.assumedViews, item.realisedViews, item.cpm, item.currency, item.amount, computedAt).changes > 0
}

/* Bills one cleared reservation from the totals for its window. Idempotent
   on billing_line_items.reservation_id: null when a line item already
   exists for it. */
export function billReservation(ctx: Context, r: ReservationRecord, p: PositionRef, played: PlayTotals, basis: BillingBasis = BILLING_BASIS): LineItem | null {
  const item = computeLineItem(ctx, r, p, played, basis)
  return writeLineItem(ctx, item, new Date(ctx.clock().getTime()).toISOString()) ? item : null
}

/* Bills every live, handed-off window that has ended and isn't billed yet. */
export function runBilling(ctx: Context): LineItem[] {
  const now = ctx.clock().getTime()
  const out: LineItem[] = []
  /* A window has ended once its start is a whole window ago. Windows differ
     in length by slot, so the query asks for everything the shortest one
     could have ended by, and each is checked against its own length. */
  for (const r of ctx.reservations.billable(new Date(now - shortestWindowMs(ctx)).toISOString())) {
    const p = findPosition(ctx, r.positionId)
    if (!p) continue
    const end = Date.parse(r.windowStart) + billingUnitMs(ctx, p)
    if (end > now) continue
    const played = ctx.playback.totals({ campaignId: r.campaignId as string, displayTypeId: p.displayType.id, from: r.windowStart, to: new Date(end).toISOString() })
    const item = billReservation(ctx, r, p, played)
    if (item) out.push(item)
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
