/* DSP creatives (spec §3 "Submission"): the creative in a bid response must
   match an approved creative ID. A bid carrying an unknown creative is
   discarded pre-auction, and the creative is retrieved, checked and placed
   in the approval queue (or approved automatically when the advertiser
   doesn't require approval) so it can compete in later windows.

   Q40 (Rob, 29 Sep 2026): PH's approval stays the source of truth. The
   DSP's own audit of the creative is recorded as an advisory check and
   never approves it. Approval is keyed on the DSP creative ID and the
   content hash: the crid's campaign id is derived from (DSP, crid), so the
   safe-reuse clearance a human approval writes is a clearance of that crid
   at those exact bytes — a byte-identical creative under the same crid is
   never re-audited, while different bytes under it are a new version for
   review (and, once one version is approved, a pending edit that leaves
   the approved one running, Q38). */
import { createHash, randomUUID } from 'node:crypto'
import type { Context } from '../context'
import { type Check, failed, fileChecks } from '../domain/assetChecks'
import { EXTENSION, readMedia } from '../domain/media'
import type { PositionRef } from '../domain/positions'
import type { PartnerRecord } from '../repos/PartnerRepo'
import { prepared } from '../db/db'
import { readCapped } from '../dsp/bidder'
import { providerOf } from '../dsp/registry'

/* The campaign a DSP creative ID becomes: the same every time the crid is
   retrieved, so approval (and safe reuse) follows the crid. */
export const dspCampaignId = (partnerId: string, crid: string) => `c_dsp_${createHash('sha256').update(`${partnerId}\n${crid}`).digest('hex').slice(0, 12)}`

export const campaignForCrid = (ctx: Context, partnerId: string, crid: string) =>
  (prepared(ctx.db, 'SELECT campaign_id FROM dsp_creatives WHERE partner_id = ? AND crid = ?').get(partnerId, crid) as { campaign_id: string } | undefined)?.campaign_id ?? null

/* The creative URL in a bid may only point under the DSP's own creative
   host and path: each DSP's own rule (DspProvider.ownsCreativeUrl), built
   on this normalised comparison. */
export { underBase } from '../dsp/DspProvider'

/* Returns why the bid was discarded. */
export async function queueCreative(ctx: Context, partner: PartnerRecord, bid: { crid: string; iurl?: string; ext?: { creativeAudit?: unknown } }, advertiser: { id: string; name: string }, p: PositionRef, budget?: { creativeFetches: number }): Promise<string> {
  const dsp = providerOf(ctx.dsp, partner.provider)
  /* Only fetched from the DSP's own creative host, never an arbitrary URL in a bid. */
  if (!bid.iurl || !dsp?.ownsCreativeUrl(bid.iurl)) return `Unknown creative ${bid.crid}, and no creative URL from ${partner.name} to retrieve it from.`
  /* One retrieval per DSP response: spent only now that a fetch will really be attempted. */
  if (budget) {
    if (budget.creativeFetches <= 0) return `Unknown creative ${bid.crid}; it will be retrieved for review from a later window.`
    budget.creativeFetches--
  }

  /* Claim the crid before fetching: the (partner_id, crid) primary key lets
     exactly one concurrent auction retrieve a given creative. A loser skips
     the fetch; the claim is released if retrieval or the checks fail, so a
     later window can try again. */
  const campaignId = dspCampaignId(partner.id, bid.crid)
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

  /* The crid seen before (its claim was released since, but its campaign
     remains): this retrieval is a new version of that campaign, not a new one. */
  const existing = ctx.campaigns.getCampaign(campaignId)
  const before = existing ? (await ctx.approvals.view(campaignId)).status : 'draft'
  if (!existing) {
    ctx.campaigns.createCampaign({
      id: campaignId, name: `${advertiser.name} — ${bid.crid}`, source: 'dsp', advertiserId: advertiser.id, partnerId: partner.id,
      displayTypeId: p.displayType.id, pricingType: 'localised', targeting: { default: { pricingType: 'localised' } },
    })
  }
  ctx.campaigns.addAsset({
    id: `as_${randomUUID().slice(0, 12)}`, campaignId, role: 'default', file: ctx.assets.put(bytes, EXTENSION[media!.kind]), mimeType: media!.mimeType,
    width: media!.width, height: media!.height, durationSec: media!.durationSec, bitrateKbps: null, sizeBytes: bytes.length,
    contentHash: createHash('sha256').update(bytes).digest('hex'),
  })
  /* The DSP's audit rides along as information for the reviewer only. */
  const audit = dsp.auditCheck(bid.ext?.creativeAudit)
  const all: Check[] = [...checks, { name: 'default_present', passed: true }, { name: 'targeting_permitted', passed: true }, ...(audit ? [audit] : [])]
  const view = before === 'approved' || before === 'awaiting_approval'
    ? await ctx.approvals.changed(campaignId, partner.name, all)
    : await ctx.approvals.submit(campaignId, all, partner.name)
  /* Approved automatically means it may compete, as the message below says: no separate activation step. */
  if (view.status === 'approved' && !existing) ctx.campaigns.setActivation(campaignId, true)
  const reused = view.checks.some((c) => c.name === 'previously_cleared')
  return view.status === 'approved'
    ? `New creative ${bid.crid}: ${reused ? 'identical to a creative a reviewer already approved' : 'approved automatically'}; it can compete from the next window.`
    : `New creative ${bid.crid}: queued for approval.`
}
