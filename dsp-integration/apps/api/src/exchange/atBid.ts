/* At-bid creative with post-bid approval (the real-time path), 7 Oct 2026.
   Rob, 7 Oct 2026: a real-time impression has no time for pre-approval within
   tmax, so the creative the DSP supplies in its bid response is accepted and
   served at bid time, and PH's approval gate reviews it after the play.

   - A creative PH has not seen (a crid with no fresh fetch-and-hash) may win
     and plays on its first win, from the DSP's own creative host
     (DspProvider.ownsCreativeUrl, the same rule the advance path fetches
     under). Nothing is fetched inside tmax.
   - When the play is reported, PH retrieves the creative, hashes it and puts
     it through the approval gate exactly as the advance path does
     (queueCreative): its identity comes from the bytes, so identical bytes
     under another crid or DSP are one creative, an approved creative is not
     reviewed again (safe reuse, OQ40), and one a reviewer already rejected
     stays rejected.
   - A rejection stops the creative playing going forward (its crid resolves
     to a rejected creative, which the real-time vet refuses) and blocks the
     bytes by content hash for every crid, DSP and advertiser
     (DspCreativeRepo.blockedBy; queueCreative honours it on both paths).
   - The DSP's own audit status stays advisory (OQ40): it is on the review as
     information and never approves or blocks anything.
   The player-side serving of the DSP URL is PH Core's (PH-CORE-BOUNDARIES.md
   "Real-time bidding"). */
import type { Context } from '../context'
import { advertiserSlug } from '@ph-dsp/types'
import { type PositionRef, findPosition } from '../domain/positions'
import type { ImpressionRecord } from '../repos/RealtimeImpressionRepo'
import type { PartnerRecord } from '../repos/PartnerRepo'
import { providerOf } from '../dsp/registry'
import { type Bid } from './openrtb'
import { checkFloor, checkTargeting } from './enforcement'
import { queueCreative } from './creatives'
import type { VettedBid } from './auction'

const MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', mp4: 'video/mp4', webm: 'video/webm' }
/* The player is told the type from the URL's extension; the bytes are checked properly in the post-play review. */
export const mimeFromUrl = (url: string): string => {
  try { return MIME[new URL(url).pathname.split('.').pop()?.toLowerCase() ?? ''] ?? 'application/octet-stream' } catch { return 'application/octet-stream' }
}

/* The vet of a bid whose crid PH has no fresh verification for. */
export async function vetAtBidCreative(ctx: Context, p: PositionRef, dsp: PartnerRecord, bid: Bid, advertiser: { id: string; name: string }, seatId: string): Promise<VettedBid> {
  const no = (reason: string, campaignId?: string): VettedBid => ({ ok: false, reason, advertiserId: advertiser.id, ...(campaignId ? { campaignId } : {}) })
  const crid = bid.crid as string
  const iurl = bid.iurl
  if (!iurl || !providerOf(ctx.dsp, dsp.provider)?.ownsCreativeUrl(iurl)) return no(`Unknown creative ${crid}, and no creative URL under ${dsp.name}’s creative host to serve it from.`)
  /* A crid PH has seen before: if what it resolved to was rejected, or its bytes are on the block list, it does not play again. */
  const label = await ctx.dspCreatives.label(dsp.id, crid)
  if (label) {
    if ((await ctx.approvals.statusOf(label.campaignId)) === 'rejected') return no(`Creative ${crid} was rejected on review and no longer plays.`, label.campaignId)
    const blockedBy = label.contentHash ? await ctx.dspCreatives.blockedBy(label.contentHash) : null
    if (blockedBy) return no(`Creative ${crid} is blocked: its content is identical to creative ${blockedBy}, which a reviewer rejected.`, blockedBy)
  }
  /* A creative PH has never held has no campaign yet, so no version count to check. */
  const refused = checkTargeting(p, null) ?? (await checkFloor(ctx, bid.price as number, advertiser.id, { partner: dsp, position: p }))
  if (refused) return no(refused.reason)
  return { ok: true, advertiserId: advertiser.id, campaignId: '', pricingType: null, seatId, atBid: { crid, iurl } }
}

/* The review of an at-bid creative once it has played: retrieve, hash, check and submit it, and say what became of it. Never throws: the play stands either way. */
export async function reviewAtBidCreative(ctx: Context, rec: ImpressionRecord): Promise<{ campaignId: string | null; contentHash: string | null; note: string }> {
  const dsp = rec.partnerId ? await ctx.partners.get(rec.partnerId) : null
  const seatName = dsp?.seats.find((s) => advertiserSlug(s.name) === rec.advertiserId)?.name
  const p = await findPosition(ctx, rec.positionId)
  if (!dsp || !p || !rec.crid || !rec.creativeUrl || !rec.advertiserId) return { campaignId: null, contentHash: null, note: 'The post-play review could not start: the impression is missing its creative details.' }
  try {
    const note = await queueCreative(ctx, dsp, { crid: rec.crid, iurl: rec.creativeUrl }, { id: rec.advertiserId, name: seatName ?? rec.advertiserId }, p)
    const label = await ctx.dspCreatives.label(dsp.id, rec.crid)
    return { campaignId: label?.campaignId ?? null, contentHash: label?.contentHash ?? null, note }
  } catch (e) {
    return { campaignId: null, contentHash: null, note: `The post-play review failed: ${e instanceof Error ? e.message : String(e)}` }
  }
}
