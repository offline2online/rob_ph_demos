/* DSP creatives (spec §3 "Submission"): the creative in a bid response must
   match an approved creative ID. A bid carrying an unknown creative is
   discarded pre-auction, and the creative is retrieved, checked and placed
   in the approval queue (or approved automatically when the advertiser
   doesn't require approval) so it can compete in later windows. */
import { randomUUID } from 'node:crypto'
import type { Context } from '../context'
import { type Check, failed, fileChecks } from '../domain/assetChecks'
import { EXTENSION, readMedia } from '../domain/media'
import type { PositionRef } from '../domain/positions'
import type { PartnerRecord } from '../repos/PartnerRepo'

export const campaignForCrid = (ctx: Context, partnerId: string, crid: string) =>
  (ctx.db.prepare('SELECT campaign_id FROM dsp_creatives WHERE partner_id = ? AND crid = ?').get(partnerId, crid) as { campaign_id: string } | undefined)?.campaign_id ?? null

/* Returns why the bid was discarded. */
export async function queueCreative(ctx: Context, partner: PartnerRecord, bid: { crid: string; iurl?: string }, advertiser: { id: string; name: string }, p: PositionRef): Promise<string> {
  const base = ctx.config.bidders[partner.provider as keyof Context['config']['bidders']]?.creativeBase
  /* Only fetched from the DSP's own creative host, never an arbitrary URL in a bid. */
  if (!bid.iurl || !base || !bid.iurl.startsWith(base)) return `Unknown creative ${bid.crid}, and no creative URL from ${partner.name} to retrieve it from.`
  let bytes: Buffer
  try {
    const res = await ctx.fetch(bid.iurl, { signal: AbortSignal.timeout(10_000) })
    if (!res.ok) return `Unknown creative ${bid.crid}; retrieving it failed (HTTP ${res.status}).`
    bytes = Buffer.from(await res.arrayBuffer())
  } catch (e) {
    return `Unknown creative ${bid.crid}; retrieving it failed (${e instanceof Error ? e.message : String(e)}).`
  }
  const media = readMedia(bytes)
  const checks: Check[] = fileChecks(media, bytes.length, p.displayType, ctx.config.assetLimits)
  if (failed(checks).length) return `Unknown creative ${bid.crid} failed the automated checks: ${failed(checks).map((c) => c.detail ?? c.name).join(' ')}`

  const campaignId = `c_dsp_${randomUUID().slice(0, 12)}`
  ctx.campaigns.createCampaign({
    id: campaignId, name: `${advertiser.name} — ${bid.crid}`, source: 'dsp', advertiserId: advertiser.id, partnerId: partner.id,
    displayTypeId: p.displayType.id, pricingType: 'localised', targeting: { baseline: { pricingType: 'localised' } },
  })
  ctx.campaigns.addAsset({
    id: `as_${randomUUID().slice(0, 12)}`, campaignId, role: 'baseline', file: ctx.assets.put(bytes, EXTENSION[media!.kind]), mimeType: media!.mimeType,
    width: media!.width, height: media!.height, durationSec: media!.durationSec, bitrateKbps: null, sizeBytes: bytes.length,
  })
  ctx.db.prepare('INSERT INTO dsp_creatives (partner_id, crid, campaign_id, created_at) VALUES (?, ?, ?, ?)').run(partner.id, bid.crid, campaignId, new Date().toISOString())
  const view = await ctx.approvals.submit(campaignId, [...checks, { name: 'baseline_present', passed: true }, { name: 'targeting_permitted', passed: true }], partner.name)
  return view.status === 'approved'
    ? `New creative ${bid.crid}: approved automatically; it can compete from the next window.`
    : `New creative ${bid.crid}: queued for approval.`
}
