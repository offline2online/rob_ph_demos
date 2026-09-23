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
import { prepared } from '../db/db'
import { readCapped } from '../dsp/bidder'

export const campaignForCrid = (ctx: Context, partnerId: string, crid: string) =>
  (prepared(ctx.db, 'SELECT campaign_id FROM dsp_creatives WHERE partner_id = ? AND crid = ?').get(partnerId, crid) as { campaign_id: string } | undefined)?.campaign_id ?? null

/* The creative URL in a bid may only point under the DSP's own creative
   host and path. Compared after URL normalisation, so `…/creatives/../x`
   (which a plain string prefix check lets through) is refused. */
export function underBase(url: string, base: string) {
  try {
    const u = new URL(url)
    const b = new URL(base)
    return u.origin === b.origin && u.pathname.startsWith(b.pathname) && !u.username && !u.password
  } catch {
    return false
  }
}

/* Returns why the bid was discarded. */
export async function queueCreative(ctx: Context, partner: PartnerRecord, bid: { crid: string; iurl?: string }, advertiser: { id: string; name: string }, p: PositionRef): Promise<string> {
  const base = ctx.config.bidders[partner.provider as keyof Context['config']['bidders']]?.creativeBase
  /* Only fetched from the DSP's own creative host, never an arbitrary URL in a bid. */
  if (!bid.iurl || !base || !underBase(bid.iurl, base)) return `Unknown creative ${bid.crid}, and no creative URL from ${partner.name} to retrieve it from.`

  /* Claim the crid before fetching: the (partner_id, crid) primary key lets
     exactly one concurrent auction retrieve a given creative. A loser skips
     the fetch; the claim is released if retrieval or the checks fail, so a
     later window can try again. */
  const campaignId = `c_dsp_${randomUUID().slice(0, 12)}`
  const claimed = prepared(ctx.db, 'INSERT INTO dsp_creatives (partner_id, crid, campaign_id, created_at) VALUES (?, ?, ?, ?) ON CONFLICT (partner_id, crid) DO NOTHING')
    .run(partner.id, bid.crid, campaignId, new Date().toISOString()).changes > 0
  if (!claimed) return `Unknown creative ${bid.crid}: already being retrieved for review.`
  const release = (why: string) => {
    prepared(ctx.db, 'DELETE FROM dsp_creatives WHERE partner_id = ? AND crid = ? AND campaign_id = ?').run(partner.id, bid.crid, campaignId)
    return why
  }

  /* Never read more than the largest asset the checks would accept. */
  const maxBytes = Math.max(ctx.config.assetLimits.maxImageBytes, ctx.config.assetLimits.maxVideoBytes)
  let bytes: Buffer | null
  try {
    const res = await ctx.fetch(bid.iurl, { signal: AbortSignal.timeout(10_000) })
    if (!res.ok) return release(`Unknown creative ${bid.crid}; retrieving it failed (HTTP ${res.status}).`)
    bytes = await readCapped(res, maxBytes)
  } catch (e) {
    return release(`Unknown creative ${bid.crid}; retrieving it failed (${e instanceof Error ? e.message : String(e)}).`)
  }
  if (!bytes) return release(`Unknown creative ${bid.crid} is larger than the asset size limit.`)
  const media = readMedia(bytes)
  const checks: Check[] = fileChecks(media, bytes.length, p.displayType, ctx.config.assetLimits)
  if (failed(checks).length) return release(`Unknown creative ${bid.crid} failed the automated checks: ${failed(checks).map((c) => c.detail ?? c.name).join(' ')}`)

  ctx.campaigns.createCampaign({
    id: campaignId, name: `${advertiser.name} — ${bid.crid}`, source: 'dsp', advertiserId: advertiser.id, partnerId: partner.id,
    displayTypeId: p.displayType.id, pricingType: 'localised', targeting: { default: { pricingType: 'localised' } },
  })
  ctx.campaigns.addAsset({
    id: `as_${randomUUID().slice(0, 12)}`, campaignId, role: 'default', file: ctx.assets.put(bytes, EXTENSION[media!.kind]), mimeType: media!.mimeType,
    width: media!.width, height: media!.height, durationSec: media!.durationSec, bitrateKbps: null, sizeBytes: bytes.length,
  })
  const view = await ctx.approvals.submit(campaignId, [...checks, { name: 'default_present', passed: true }, { name: 'targeting_permitted', passed: true }], partner.name)
  return view.status === 'approved'
    ? `New creative ${bid.crid}: approved automatically; it can compete from the next window.`
    : `New creative ${bid.crid}: queued for approval.`
}
