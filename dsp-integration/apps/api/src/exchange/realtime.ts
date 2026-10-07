/* Real-time (player-triggered) bidding, 7 Oct 2026. The other way to sell a
   position, alongside the advance window path (auction.ts): at or just before
   playout the player signals that an impression is available, the exchange
   asks every eligible connected DSP for a bid within tmax (~100-300 ms), the
   winning creative plays and the player reports the proof of play. This is
   how DV360, The Trade Desk and Amazon transact (each answers within tmax;
   none can hold a bid open for days) and how DOOH SSPs such as Broadsign
   Reach run the ad loop: the player holds an open programmatic slot and asks
   just ahead of the impression.

   A slot says which way it is sold (`bidMode`, domain/positions.ts bidModeOf).
   A real-time position takes no window bids or reservations and the window
   auction skips it, so nothing here touches `reservations` or slot bookings
   and migration 0021's one-live-winner-per-window index is unaffected.
   Impressions are their own rows (migration 0047).

   One auction per play (industry-standard DOOH model): every call here is a
   fresh auction with its own impression id and request ids; a win fills that
   one play and nothing is held for the next. Blocks of plays are a deal, not
   an open-auction win.

   One impression, one request per eligible DSP: the advance auction's own
   OpenRTB request (buildBidRequest) with tmax and exp cut to this impression
   and imp.ext.ph.mode = "realtime". Every bid then passes the same
   pre-auction checks as an advance bid (vetBid), first price, ties to the
   earlier DSP. NO creative is fetched inside tmax (budget 0): a creative PH
   has not approved is discarded and retrieved for review by an advance
   window, so only an already-approved, activated creative that fits the
   canvas can fill — except that a creative PH has not seen yet may play at
   bid time and is reviewed after the play (atBid.ts, Rob 7 Oct 2026: there
   is no time for pre-approval within tmax). A Test-mode DSP's bid is cleared among Test bids but never fills
   an impression. The PH Core player side of this is not in this repo
   (PH-CORE-BOUNDARIES.md "Real-time bidding"). */
import { randomUUID } from 'node:crypto'
import type { Context } from '../context'
import { failed, fileChecks } from '../domain/assetChecks'
import { readMedia } from '../domain/media'
import { bidderTuning } from '../domain/partnerInput'
import { isLive } from '../domain/exchange'
import { type PositionRef, assignmentOf, effectivePartnerIds, findPosition, isRealtime, isSellable, positionIdOf, positionView, windowMsFor, windowStartOf } from '../domain/positions'
import { slotDurationSec } from '../domain/slots'
import { conflict, notFound } from '../http/errors'
import type { PartnerRecord } from '../repos/PartnerRepo'
import type { ImpressionRecord } from '../repos/RealtimeImpressionRepo'
import { type VettedBid, MAX_BIDS_PER_RESPONSE, bidUrlFor, receivesBidRequests, vetBid } from './auction'
import { type BidResponse, buildBidRequest } from './openrtb'
import { tx } from '../db/db'
import { mimeFromUrl, reviewAtBidCreative } from './atBid'

export interface Fill {
  impression: ImpressionRecord
  creative?: { campaignId: string | null; source: 'approved' | 'under_review' | 'at_bid'; assetVersion: string; url: string; mimeType: string; durationSec: number | null }
}

interface Candidate { dsp: PartnerRecord; price: number; crid: string; vetted: Extract<VettedBid, { ok: true }> }

/* Clears one impression for the position the display's next slot is. Always
   returns the stored outcome (filled or no_fill); throws only for a request
   that is wrong (unknown display or position, not a real-time position). */
export async function signalImpression(ctx: Context, input: { displayId: string; slot: number }): Promise<Fill> {
  const started = Date.now()
  const now = ctx.clock()
  const display = await ctx.displays.get(input.displayId)
  if (!display) throw notFound('Unknown display.')
  const p = await findPosition(ctx, positionIdOf(display.displayTypeId, input.slot))
  if (!p || p.def.owner !== 'advertiser') throw notFound('Unknown position: that slot is not an Advertiser slot on the display’s display type.')
  if (!isRealtime(p)) throw conflict('This position is sold by play window, not in real time.')

  const hours = (await ctx.company.get()).playWindowHours
  const windowStart = windowStartOf(now, windowMsFor(hours, p)).toISOString()
  const base: ImpressionRecord = {
    id: `imp_${randomUUID().slice(0, 12)}`, positionId: p.positionId, displayId: display.id, windowStart, requestedAt: now.toISOString(), status: 'no_fill', reason: null,
    partnerId: null, advertiserId: null, campaignId: null, crid: null, clearingCpm: null, currency: 'USD', testMode: false, assetVersion: null, expiresAt: null, playedAt: null,
    bidRequests: 0, elapsedMs: null, creativeUrl: null, creativeSource: null, contentHash: null, reviewNote: null,
  }
  const noFill = async (reason: string, extra: Partial<ImpressionRecord> = {}): Promise<Fill> =>
    ({ impression: await ctx.impressions.insert({ ...base, ...extra, status: 'no_fill', reason, elapsedMs: Date.now() - started }) })

  if (!isLive(await ctx.exchange.get())) return noFill('DSP integration is not live.')
  if (!(await isSellable(ctx, p))) return noFill('The position has no audience score.')
  if (p.def.salesLocked) return noFill('The position is locked against new sales.')
  const assignment = assignmentOf(p.def)
  if (assignment === 'reserved' || assignment === 'deal') return noFill('A position held for named advertisers or assigned to a private auction is not sold in real time.')

  const bidders = (await ctx.partners.list()).filter(receivesBidRequests)
  const allowed = await effectivePartnerIds(ctx, p.def, bidders)
  const dsps = bidders.filter((d) => allowed === null || allowed.includes(d.id))
  if (!dsps.length) return noFill('No connected DSP can bid on this position.')

  /* One request per DSP, all at once, each held to the impression's budget. */
  const view = await positionView(ctx, p, { partner: dsps[0], advertiser: null, unknownAdvertiser: false })
  const sent: { dsp: PartnerRecord; reqId: string; res: Promise<BidResponse | null> }[] = []
  const timers: ReturnType<typeof setTimeout>[] = []
  for (const dsp of dsps) {
    const url = bidUrlFor(ctx, dsp)
    if (!url) continue
    const tuning = bidderTuning(dsp.bidder, ctx.config)
    const tmax = Math.min(ctx.config.realtimeTmaxMs, tuning.timeoutMs)
    const reqId = `rt_${randomUUID().slice(0, 12)}`
    const req = await buildBidRequest(ctx, p, dsp, reqId, view)
    req.tmax = tmax
    req.imp[0].exp = Math.max(1, Math.ceil(ctx.config.realtimeFillTtlSec))
    req.imp[0].ext.ph.mode = 'realtime'
    /* The transport aborts at tmax; the race is the backstop if a bidder is slow to be asked (its own QPS spacing). */
    const deadline = new Promise<null>((resolve) => timers.push(setTimeout(resolve, Math.max(0, started + tmax - Date.now())) as unknown as ReturnType<typeof setTimeout>))
    sent.push({ dsp, reqId, res: Promise.race([ctx.bidder.send(url, req, { qps: tuning.qps, timeoutMs: tmax }), deadline]) })
  }
  base.bidRequests = sent.length
  const answers = await Promise.all(sent.map((x) => x.res))
  timers.forEach(clearTimeout)

  const candidates: Candidate[] = []
  for (const [i, { dsp, reqId }] of sent.entries()) {
    const res = answers[i]
    if (!res || typeof res !== 'object' || (res.id !== undefined && res.id !== reqId)) continue
    let seen = 0
    for (const seatbid of Array.isArray(res.seatbid) ? res.seatbid : []) {
      if (!seatbid || typeof seatbid !== 'object') continue
      for (const bid of Array.isArray(seatbid.bid) ? seatbid.bid : []) {
        if (++seen > MAX_BIDS_PER_RESPONSE) break
        if (!bid || typeof bid !== 'object') continue
        const v = await vetBid(ctx, p, dsp, windowStart, res, typeof seatbid.seat === 'string' ? seatbid.seat : undefined, bid, { creativeFetches: 0 }, { atBid: true })
        if (v.ok) candidates.push({ dsp, price: bid.price as number, crid: bid.crid as string, vetted: v })
      }
    }
  }
  if (!candidates.length) return noFill(sent.length ? 'No bid cleared within tmax.' : 'No DSP has a bid endpoint.')

  /* First price: highest bid first, ties to the earlier DSP (sort is stable). A Test-mode DSP's bids never fill. */
  const ranked = [...candidates].sort((a, b) => b.price - a.price)
  const live = ranked.filter((c) => c.dsp.mode === 'live')
  if (!live.length) return noFill('Only Test-mode bids: nothing plays.', { testMode: true, partnerId: ranked[0].dsp.id, advertiserId: ranked[0].vetted.advertiserId, campaignId: ranked[0].vetted.campaignId, crid: ranked[0].crid, clearingCpm: ranked[0].price })

  /* The creative must fit the display type's canvas (as at advance hand-off); a winner whose creative doesn't is passed over. */
  let lastWhy = 'no creative'
  for (const c of live) {
    /* A creative PH has not seen: served from the DSP's own URL now, reviewed after it plays. */
    if (c.vetted.atBid) {
      const { iurl } = c.vetted.atBid
      const impression = await ctx.impressions.insert({
        ...base, status: 'filled', partnerId: c.dsp.id, advertiserId: c.vetted.advertiserId, campaignId: null, crid: c.crid, clearingCpm: c.price,
        assetVersion: null, expiresAt: new Date(now.getTime() + ctx.config.realtimeFillTtlSec * 1000).toISOString(), elapsedMs: Date.now() - started,
        creativeUrl: iurl, creativeSource: 'at_bid',
      })
      return { impression, creative: { campaignId: null, source: 'at_bid', assetVersion: '', url: iurl, mimeType: mimeFromUrl(iurl), durationSec: null } }
    }
    const approved = await ctx.approvals.liveAssetVersion(c.vetted.campaignId)
    const assets = await ctx.campaigns.latestAssets(c.vetted.campaignId, approved ?? undefined)
    const asset = assets.find((a) => a.role === 'default') ?? assets[0]
    const bytes = asset ? await ctx.assets.read(asset.file) : null
    if (!asset || !bytes) { lastWhy = `${c.crid} has no creative`; continue }
    const bad = failed(fileChecks(readMedia(bytes), bytes.length, p.displayType, ctx.config.assetLimits))
    if (bad.length) { lastWhy = `${c.crid} doesn’t fit ${p.displayType.name}: ${bad.map((x) => x.detail ?? x.name).join(' ')}`; continue }
    const assetVersion = approved ?? `v${Math.max(...assets.map((a) => a.version))}`
    const url = `${ctx.config.publicUrl}/assets/${asset.file}`
    const source = approved ? 'approved' as const : 'under_review' as const
    const impression = await ctx.impressions.insert({
      ...base, status: 'filled', partnerId: c.dsp.id, advertiserId: c.vetted.advertiserId, campaignId: c.vetted.campaignId, crid: c.crid, clearingCpm: c.price,
      assetVersion, expiresAt: new Date(now.getTime() + ctx.config.realtimeFillTtlSec * 1000).toISOString(), elapsedMs: Date.now() - started,
      creativeUrl: url, creativeSource: source,
    })
    return { impression, creative: { campaignId: c.vetted.campaignId, source, assetVersion, url, mimeType: asset.mimeType, durationSec: asset.durationSec ?? null } }
  }
  return noFill(`No bidding creative could play: ${lastWhy}.`)
}

/* Proof of play, once, while the fill is still valid. The play row is the
   stand-in's (PH Core's playback store on integration). Returns null when it
   was already played, never filled, or has expired. */
export async function confirmPlayed(ctx: Context, id: string, body: { playedAt?: string; durationSec?: number }): Promise<ImpressionRecord | null> {
  const rec = await ctx.impressions.get(id)
  if (!rec) throw notFound('Unknown impression.')
  const now = ctx.clock().toISOString()
  const playedAt = body.playedAt ?? now
  if (!(await ctx.impressions.markPlayed(id, now, playedAt))) return null
  /* Post-bid approval: a creative PH had not seen is retrieved and put through the approval gate now that it has played. It runs outside the play's own transaction (it fetches over the network), and the play stands whatever the review finds. */
  if (rec.creativeSource === 'at_bid') await ctx.impressions.recordReview(id, await reviewAtBidCreative(ctx, rec))
  const done = (await ctx.impressions.get(id)) as ImpressionRecord
  return tx(ctx.db, async () => {
    const p = await findPosition(ctx, done.positionId)
    const duration = body.durationSec ?? (p ? slotDurationSec(p.displayType) : null) ?? 10
    /* A play needs a campaign to be recorded against: an at-bid creative that could not be retrieved or checked has none (its review note says why). */
    if (done.campaignId) ctx.plays.insertTestPlay({ id: `rtp_${randomUUID().slice(0, 12)}`, displayId: done.displayId, campaignId: done.campaignId, playedAt, durationSec: duration, versionId: done.assetVersion, tier: 'default', receivedAt: now })
    return done
  })
}
