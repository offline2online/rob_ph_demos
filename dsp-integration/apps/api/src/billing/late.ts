/* Settlement is final, late playback is lost revenue (Rob, 4 Oct 2026; spec
   §4 "Billing", api/PH-CORE-BOUNDARIES.md "Analytics event values billing
   consumes").

   A window's line item is the invoice and never changes. A play the platform
   RECEIVES after its window's line item was written (a display that was
   offline and backfills) is not re-billed, credited or trued up; it is
   recorded here, at what it would have been worth, as lost revenue from
   display downtime, by store, display and over time. Plays received before
   the line item (including between the window's end and settlement) count in
   billing and never reach this ledger.

   What a late play would have been worth is billing's own arithmetic over
   the same inputs: its share of the window's expected play time of the
   assumed views (realised VAC-d), at the reservation's cleared CPM, times the
   snapshotted personalised multiplier for a personalised play. The total a
   window could ever have realised is capped at what it was expected to play,
   exactly as billing caps it, so a window cannot be valued above its own
   assumed views however much backfills.

   The scan reads only what arrived since the last one (received_at is
   indexed and a watermark is kept), so a tick costs what arrived, not the
   history. It runs after billing in the same tick, so a play is classified
   against a line item written no later than now. The ledger is an
   operational report for the retailer: it is never shown on or charged to an
   advertiser's invoice, and it never touches a line item. */
import type { Context } from '../context'
import { findPosition } from '../domain/positions'
import { tx } from '../db/db'
import type { LineItem } from './index'
import type { ReceivedPlay } from '../platform/PlaybackSource'
import type { LatePlay } from '../repos/LateLedgerRepo'

const BATCH = 2_000
const round6 = (n: number) => Math.round(n * 1e6) / 1e6

/* The value of one late play against its line item, given how many seconds of
   the window earlier late plays already used. Pure. */
export function valueLatePlay(item: LineItem, play: { durationSec: number; tier?: string | null }, lateSecSoFar: number): { lostViews: number; lostAmount: number } {
  const headroom = Math.max(0, item.expectedSec - item.playedSec - lateSecSoFar)
  const sec = Math.min(play.durationSec, headroom)
  const lostViews = item.expectedSec > 0 ? (item.assumedViews * sec) / item.expectedSec : 0
  const rate = play.tier === 'personalised' && item.personalisedMultiplier !== null ? item.cpm * item.personalisedMultiplier : item.cpm
  return { lostViews: round6(lostViews), lostAmount: round6((lostViews / 1000) * rate) }
}

/* Records every play received since the last scan, up to now, that arrived
   after its window's line item. Idempotent: a play is recorded once. Returns
   how many plays this call recorded. */
export async function recordLatePlays(ctx: Context): Promise<number> {
  const upTo = new Date(ctx.clock().getTime()).toISOString()
  /* Inclusive of the last watermark: a play received in the same millisecond
     as the previous scan's end may have missed it, and the ledger's unique
     play id absorbs the repeats. */
  const since = (await ctx.lateLedger.scannedThrough()) ?? ''
  const display = new Map<string, { storeId: string | null; displayTypeId: string } | null>()
  const lateSec = new Map<string, number>()
  let recorded = 0
  let after: { receivedAt: string; id: string } | undefined
  for (;;) {
    const batch: ReceivedPlay[] = await ctx.playback.receivedBetween({ since, upTo, after, limit: BATCH })
    if (batch.length === 0) break
    await tx(ctx.db, async () => {
      for (const play of batch) {
        if (!play.receivedAt) continue
        let d = display.get(play.displayId)
        if (d === undefined) {
          const rec = await ctx.displays.get(play.displayId)
          display.set(play.displayId, (d = rec ? { storeId: rec.storeId ?? null, displayTypeId: rec.displayTypeId } : null))
        }
        if (!d) continue
        /* The window billing counted this play in: same campaign, same display
           type, the play's own start inside it (as PlaybackSource.totals). */
        let hit: { item: LineItem; computedAt: string } | undefined
        for (const c of await ctx.billing.coveringPlay(play.campaignId, play.playedAt)) {
          if ((await findPosition(ctx, c.item.positionId))?.displayType.id === d.displayTypeId) { hit = c; break }
        }
        if (!hit || play.receivedAt <= hit.computedAt) continue
        const used = lateSec.get(hit.item.id) ?? (await ctx.lateLedger.lateSecFor(hit.item.id))
        const v = valueLatePlay(hit.item, play, used)
        const row: LatePlay = {
          playId: play.id, lineItemId: hit.item.id, reservationId: hit.item.reservationId, campaignId: hit.item.campaignId, positionId: hit.item.positionId,
          displayId: play.displayId, storeId: d.storeId, playedAt: play.playedAt, receivedAt: play.receivedAt, durationSec: play.durationSec, tier: play.tier ?? null,
          cpm: hit.item.cpm, currency: hit.item.currency, personalisedMultiplier: hit.item.personalisedMultiplier, lostViews: v.lostViews, lostAmount: v.lostAmount,
        }
        if (await ctx.lateLedger.insert(row, upTo)) {
          recorded++
          lateSec.set(hit.item.id, used + play.durationSec)
        } else lateSec.set(hit.item.id, used)
      }
    })
    after = { receivedAt: batch[batch.length - 1].receivedAt as string, id: batch[batch.length - 1].id }
    if (batch.length < BATCH) break
  }
  await ctx.lateLedger.setScannedThrough(upTo)
  return recorded
}
