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
import { checkCampaign } from './enforcement'
import { isUniqueViolation } from '../db/db'
import type { ReservationRecord } from '../repos/ReservationRepo'

export async function handOff(ctx: Context, r: ReservationRecord): Promise<ReservationRecord> {
  if (r.testMode || r.handedOffAt || !['won', 'reserved'].includes(r.status) || !r.campaignId) return r
  const notHandedOff = async (why: string) => (await ctx.reservations.update(r.id, { reason: `Not handed off: ${why}` })) as ReservationRecord
  const p = await findPosition(ctx, r.positionId)
  if (!p) return notHandedOff('the position no longer exists.')
  /* The enforcement hook, at the last point before the campaign system (brief, package 11). */
  const refused = await checkCampaign(ctx, r.campaignId)
  if (refused) return notHandedOff(refused.reason.replace(/^The/, 'the'))
  /* default is mandatory (decision, 22 Sep), so its creative is what hands
     off by default; which version actually plays is existing targeting
     evaluation, unchanged. assets[0] is a defensive fallback only, for a
     record predating the requirement.
     The APPROVED version's assets, not the latest upload's (Q38, Rob,
     29 Sep 2026): while an edit awaits review the live version keeps
     playing, and the moment the edit is approved it is the live version —
     read here, at hand-off, so a window handed off before the approval gets
     the old creative and every window after gets the new one, never both.
     An HQ campaign has no approved version and hands off its latest. */
  const live = await ctx.approvals.liveAssetVersion(r.campaignId)
  const assets = await ctx.campaigns.latestAssets(r.campaignId, live ?? undefined)
  const asset = assets.find((a) => a.role === 'default') ?? assets[0]
  const bytes = asset ? await ctx.assets.read(asset.file) : null
  if (!asset || !bytes) return notHandedOff('the campaign has no creative.')
  const checks = fileChecks(readMedia(bytes), bytes.length, p.displayType, ctx.config.assetLimits)
  if (failed(checks).length) return notHandedOff(`the creative doesn’t fit ${p.displayType.name}: ${failed(checks).map((c) => c.detail ?? c.name).join(' ')}`)
  const windowEnd = new Date(Date.parse(r.windowStart) + (await windowMs(ctx, p))).toISOString()
  try {
    await ctx.campaigns.bookSlot({
      id: `bk_${randomUUID().slice(0, 12)}`, campaignId: r.campaignId, displayTypeId: p.displayType.id, slot: p.slot,
      windowStart: r.windowStart, windowEnd,
      /* The approved version's own string, as the approval module gave it
         (eeBT1Qp33GdsPcxG2As3): the booking plays exactly the version it
         was handed. An HQ campaign has no approval, so it carries the
         stand-in's label for its latest assets. */
      assetVersion: live ?? `v${Math.max(...assets.map((a) => a.version))}`,
      /* Personalised versions are eligible only in a reserve-held window
         (Rob, 5 Oct 2026); a won (auction) window plays default/localised. */
      personalisedEligible: r.status === 'reserved',
    })
  } catch (e) {
    /* One campaign per slot per window (migration 0021): never two. */
    if (isUniqueViolation(e)) return notHandedOff('the slot is already booked for that window.')
    throw e
  }
  return (await ctx.reservations.update(r.id, { handedOffAt: ctx.clock().toISOString() })) as ReservationRecord
}
