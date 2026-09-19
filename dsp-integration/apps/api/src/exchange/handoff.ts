/* Hand-off (spec §7 "Creative retrieval and hand-off"): a won or reserved
   window's campaign is confirmed approved, its creative validated against
   the display type's canvas, then booked into that slot and window in the
   existing campaign system, which distributes and plays it as it does today.
   Test-mode wins are never handed off. Playback is not touched. */
import { randomUUID } from 'node:crypto'
import type { Context } from '../context'
import { failed, fileChecks } from '../domain/assetChecks'
import { readMedia } from '../domain/media'
import { findPosition, windowMs } from '../domain/positions'
import type { ReservationRecord } from '../repos/ReservationRepo'

export async function handOff(ctx: Context, r: ReservationRecord): Promise<ReservationRecord> {
  if (r.testMode || r.handedOffAt || !['won', 'reserved'].includes(r.status) || !r.campaignId) return r
  const notHandedOff = (why: string) => ctx.reservations.update(r.id, { reason: `Not handed off: ${why}` }) as ReservationRecord
  const p = findPosition(ctx, r.positionId)
  if (!p) return notHandedOff('the position no longer exists.')
  /* The enforcement hook, at the last point before the campaign system (brief, package 11). */
  if (!(await ctx.approvals.isCampaignEligible(r.campaignId))) return notHandedOff('the campaign is not approved.')
  const baseline = ctx.campaigns.latestAssets(r.campaignId).find((a) => a.role === 'baseline')
  const bytes = baseline ? ctx.assets.read(baseline.file) : null
  if (!baseline || !bytes) return notHandedOff('the campaign has no baseline creative.')
  const checks = fileChecks(readMedia(bytes), bytes.length, p.displayType, ctx.config.assetLimits)
  if (failed(checks).length) return notHandedOff(`the creative doesn’t fit ${p.displayType.name}: ${failed(checks).map((c) => c.detail ?? c.name).join(' ')}`)
  ctx.campaigns.bookSlot({
    id: `bk_${randomUUID().slice(0, 12)}`, campaignId: r.campaignId, displayTypeId: p.displayType.id, slot: p.slot,
    windowStart: r.windowStart, windowEnd: new Date(Date.parse(r.windowStart) + windowMs(ctx)).toISOString(),
  })
  return ctx.reservations.update(r.id, { handedOffAt: ctx.clock().toISOString() }) as ReservationRecord
}
