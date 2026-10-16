/* Unsold real-time slots (ticket 3BXfWxs2jkN6S7awLXhQ, 16 Oct 2026; spec §5
   "Booking revenue", §4 "Billing" lost-revenue report). % sold deliberately
   leaves real-time positions out, so missed revenue on them is recorded here
   instead: every impression opportunity that went unsold (no bid, every bid
   under the floor, no cached creative under the bandwidth restriction, no
   approved creative, any other no fill) is added to an hourly aggregate per
   display and position, valued at the resolved floor CPM x the opportunity's
   share of the assumed views (billing's arithmetic: assumed views x play
   length / expected seconds). Indicative only: never billed, never shown to
   an advertiser. Test-mode traffic is never recorded. */
import type { Context } from '../context'
import { floorFor } from '../exchange/enforcement'
import type { PositionRef } from './positions'
import { assumedViewsPerWindow, maxPlayLengthSecFor, windowMsFor } from './positions'
import { rotationSizeOf } from './slots'
import { TRANSACTING_CURRENCY } from './currency'
import type { UnsoldReason } from '../repos/UnsoldSlotRepo'

/* Assumed views one impression of the position stands for. */
export async function viewsPerImpression(ctx: Context, p: PositionRef, companyMaxPlaySec: number, displays: number): Promise<number> {
  const slots = rotationSizeOf(p.displayType, p.slot)
  const expectedSec = displays * (windowMsFor(p) / 1000) * (slots ? 1 / slots : 1)
  if (expectedSec <= 0) return 0
  return ((await assumedViewsPerWindow(ctx, p)) * maxPlayLengthSecFor(companyMaxPlaySec, p)) / expectedSec
}

export async function recordUnsold(ctx: Context, p: PositionRef, d: { displayId: string; storeId: string | null }, at: Date, reason: UnsoldReason): Promise<void> {
  const company = await ctx.company.get()
  const displays = (await ctx.displays.summaryByDisplayType(p.displayType.id)).displays
  await ctx.unsold.record({
    hour: at.toISOString().slice(0, 13), displayId: d.displayId, positionId: p.positionId, reason, currency: TRANSACTING_CURRENCY, storeId: d.storeId, displayTypeId: p.displayType.id,
    floorCpm: await floorFor(ctx, null, { position: p }), views: await viewsPerImpression(ctx, p, company.maxPlayLengthSec, displays),
  })
}

/* Deletes aggregate hours older than the retention window. */
export function sweepUnsold(ctx: Pick<Context, 'unsold'>, retentionDays: number, now: () => Date = () => new Date()) {
  return ctx.unsold.deleteBefore(new Date(now().getTime() - retentionDays * 86_400_000).toISOString())
}
