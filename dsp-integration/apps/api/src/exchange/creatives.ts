/* DSP creatives (spec §3 "Submission"): the creative in a bid response must
   match an approved creative. A creative PH has not approved is discarded
   pre-auction, and is retrieved, checked and placed in the approval queue
   (or approved automatically when the advertiser doesn't require approval)
   so it can compete in later windows.

   Creative identity (Rob, 4 Oct 2026, OQ40): PH mints its own identity from
   the content. The creative is fetched and hashed, and its campaign id is
   derived from (advertiser, content hash) — never from the DSP's crid. The
   crid is a reference label recorded against that creative per DSP
   (dsp_creatives), so:
   - identical bytes arriving under different crids, or through two DSPs
     (DV360 and The Trade Desk), are one creative, reviewed and approved once;
   - a crid rotated onto identical bytes resolves to the creative a reviewer
     already approved — no new review;
   - a crid reused for different bytes resolves to a different creative,
     which starts its own review (the old one keeps running as it was).
   Q40 (Rob, 29 Sep 2026): PH's approval stays the source of truth; the
   DSP's own audit of the creative is recorded as an advisory check and
   never approves it. */
import { createHash, randomUUID } from 'node:crypto'
import type { Context } from '../context'
import { type Check, failed, fileChecks } from '../domain/assetChecks'
import { EXTENSION, readMedia } from '../domain/media'
import type { PositionRef } from '../domain/positions'
import type { PartnerRecord } from '../repos/PartnerRepo'
import { readCapped } from '../dsp/bidder'
import { providerOf } from '../dsp/registry'

/* PH's creative identity: derived from the advertiser and the content hash. */
export const creativeCampaignId = (advertiserId: string, contentHash: string) => `c_dsp_${createHash('sha256').update(`${advertiserId}\n${contentHash}`).digest('hex').slice(0, 12)}`

export const campaignForCrid = async (ctx: Context, partnerId: string, crid: string): Promise<string | null> =>
  ctx.dspCreatives.campaignFor(partnerId, crid)

/* The creative a bid's crid resolves to, trusted only while the last
   fetch-and-hash of it is fresh and its URL has not changed. Null means the
   creative must be fetched and hashed again before the bid can compete. */
export async function verifiedCampaign(ctx: Context, partnerId: string, crid: string, iurl?: string): Promise<string | null> {
  const label = await ctx.dspCreatives.label(partnerId, crid)
  if (!label?.contentHash || !label.verifiedAt) return null
  if (iurl && label.iurl !== iurl) return null
  if (Date.now() - Date.parse(label.verifiedAt) > ctx.config.creativeReverifyMs) return null
  return label.campaignId
}

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

  /* Take the crid's verification lease before fetching: exactly one
     concurrent auction retrieves a given crid. A loser skips the fetch; the
     lease is released if retrieval or the checks fail, so a later window can
     try again. */
  const now = new Date()
  const claimed = await ctx.dspCreatives.claim(partner.id, bid.crid, now.toISOString(), new Date(now.getTime() - 60_000).toISOString())
  if (!claimed) return `Unknown creative ${bid.crid}: already being retrieved for review.`
  const release = async (why: string) => {
    await ctx.dspCreatives.release(partner.id, bid.crid)
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

  /* Identity comes from the bytes, never from the crid. */
  const contentHash = createHash('sha256').update(bytes).digest('hex')
  const campaignId = creativeCampaignId(advertiser.id, contentHash)
  /* A rejection blocks these exact bytes everywhere (Rob, 7 Oct 2026): any crid, DSP or advertiser. The crid is pointed at the rejected creative, so its bids are refused as unapproved and it is never queued again. */
  const blockedBy = await ctx.dspCreatives.blockedBy(contentHash)
  if (blockedBy) {
    await ctx.dspCreatives.record(partner.id, bid.crid, blockedBy, contentHash, bid.iurl ?? null, new Date().toISOString())
    return `Creative ${bid.crid} is blocked: its content is identical to creative ${blockedBy}, which a reviewer rejected.`
  }
  const existing = await ctx.campaigns.getCampaign(campaignId)
  if (existing) {
    /* This creative is already in PH (through another crid or DSP, or this crid before it rotated): record the label and stop. */
    await ctx.dspCreatives.record(partner.id, bid.crid, campaignId, contentHash, bid.iurl ?? null, new Date().toISOString())
    const status = (await ctx.approvals.view(campaignId)).status
    return status === 'approved'
      ? `Creative ${bid.crid} is identical to creative ${campaignId}, already approved; it can compete from the next window.`
      : `Creative ${bid.crid} is identical to creative ${campaignId}, already ${status === 'awaiting_approval' ? 'queued for approval' : status}.`
  }
  try {
    await ctx.campaigns.createCampaign({
      id: campaignId, name: `${advertiser.name} — ${bid.crid}`, source: 'dsp', advertiserId: advertiser.id, partnerId: partner.id,
      displayTypeId: p.displayType.id, pricingType: 'localised', targeting: { default: { pricingType: 'localised' } },
    })
  } catch (e) {
    /* The same bytes were just created by a concurrent retrieval through another crid or DSP: that is the one creative. */
    if (!(await ctx.campaigns.getCampaign(campaignId))) { await ctx.dspCreatives.release(partner.id, bid.crid); throw e }
    await ctx.dspCreatives.record(partner.id, bid.crid, campaignId, contentHash, bid.iurl ?? null, new Date().toISOString())
    return `Creative ${bid.crid} is identical to creative ${campaignId}, already queued for approval.`
  }
  const file = await ctx.assets.put(bytes, EXTENSION[media!.kind])
  await ctx.campaigns.addAsset({
    id: `as_${randomUUID().slice(0, 12)}`, campaignId, role: 'default', file, mimeType: media!.mimeType,
    width: media!.width, height: media!.height, durationSec: media!.durationSec, bitrateKbps: null, sizeBytes: bytes.length,
    contentHash,
  })
  /* The DSP's audit rides along as information for the reviewer only. */
  const audit = dsp.auditCheck(bid.ext?.creativeAudit)
  const all: Check[] = [...checks, { name: 'default_present', passed: true }, { name: 'targeting_permitted', passed: true }, ...(audit ? [audit] : [])]
  const view = await ctx.approvals.submit(campaignId, all, partner.name)
  /* Approved automatically means it may compete, as the message below says: no separate activation step. */
  if (view.status === 'approved') await ctx.campaigns.setActivation(campaignId, true)
  await ctx.dspCreatives.record(partner.id, bid.crid, campaignId, contentHash, bid.iurl ?? null, new Date().toISOString())
  const reused = view.checks.some((c) => c.name === 'previously_cleared')
  return view.status === 'approved'
    ? `New creative ${bid.crid}: ${reused ? 'identical to a creative a reviewer already approved' : 'approved automatically'}; it can compete from the next window.`
    : `New creative ${bid.crid}: queued for approval.`
}
