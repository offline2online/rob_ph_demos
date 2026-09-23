/* The SSP auction (spec §6 "Selling a play window", §7): clears one play
   window for every sellable position, ahead of the window. Open auction,
   first price (OpenRTB at=1). Candidates are the API bids placed through
   POST /v1/reservations and the bids DSPs return to our OpenRTB requests;
   every pre-auction check applies before any bid can win. A position held
   for a named advertiser is booked by reservation, not auctioned.

   Test-mode DSPs receive requests and their bids are cleared among
   themselves, but a Test-mode win never takes the window, is never billed
   and is never handed off (spec §7). The live winner is handed off
   (handoff.ts).

   Private auctions using the two-period model (spec "…dynamic VAC-d
   billing over the delivery term", 23 Sep 2026) are a third case, between
   "reserved" and a real auction: a deal with auctionCloses set runs a real
   auction same as any other deal until a bid clears within that deadline,
   at which point the winning rate locks (BuyersListRepo.lockWin) and every
   later play window in the delivery term is booked directly at that rate
   — no re-auction, no fresh bids — by bookLockedTermWindow below. Dynamic
   VAC-d billing is otherwise unchanged: each such window still gets its
   own reservation, still billed on its own realised VAC-d
   (exchange/billing.ts), just always at the same locked clearingCpm. A
   deal with no auctionCloses set keeps clearing fresh every window,
   exactly as before this model existed. */
import { randomUUID } from 'node:crypto'
import type { Context } from '../context'
import { auctionOpenAt, isActiveAt, isTermLocked } from '../domain/buyersLists'
import { isComplete } from '../domain/exchange'
import { type PositionRef, allPositions, assignmentOf, effectivePartnerIds, nextWindow } from '../domain/positions'
import type { PartnerRecord } from '../repos/PartnerRepo'
import { type ReservationRecord, TAKEN } from '../repos/ReservationRepo'
import { advertiserSlug, assignedOf, type BuyersList } from '@ph-dsp/types'
import { campaignForCrid, queueCreative } from './creatives'
import { checkAdvertiser, checkCampaign, checkCategories, checkFloor, checkTargeting } from './enforcement'
import { handOff } from './handoff'
import { type Bid, type BidResponse, buildBidRequest } from './openrtb'

export interface PositionOutcome {
  positionId: string
  skipped?: string
  bidRequests: number
  bids: number
  winner: { reservationId: string; partnerId: string; advertiserId: string | null; clearingCpm: number } | null
}
export interface AuctionResult { windowStart: string; positions: PositionOutcome[] }

/* A DSP is sent bid requests once it is connected and its bidder
   integration (endpoint and seat IDs) is complete. */
export const receivesBidRequests = (p: PartnerRecord) => p.status === 'connected' && !!p.bidder.bidderEndpoint && !!p.bidder.seatIds?.length

export async function runAuction(ctx: Context, windowStart: Date = nextWindow(ctx)): Promise<AuctionResult> {
  const start = windowStart.toISOString()
  const exchangeLive = isComplete(ctx.exchange.get())
  const outcomes: PositionOutcome[] = []
  for (const p of allPositions(ctx)) outcomes.push(await clearPosition(ctx, p, start, exchangeLive))
  return { windowStart: start, positions: outcomes }
}

async function clearPosition(ctx: Context, p: PositionRef, start: string, exchangeLive: boolean): Promise<PositionOutcome> {
  const out: PositionOutcome = { positionId: p.positionId, bidRequests: 0, bids: 0, winner: null }
  if (assignmentOf(p.def) === 'reserved') return { ...out, skipped: 'Held for a named advertiser: booked by reservation.' }
  if (!ctx.displays.listByDisplayType(p.displayType.id).length) return { ...out, skipped: 'No displays.' }
  const existing = ctx.reservations.forWindow(p.positionId, start)
  if (existing.some((r) => !r.testMode && TAKEN.includes(r.status))) return { ...out, skipped: 'Already sold.' }

  /* Two-period private auctions (spec "…dynamic VAC-d billing over the
     delivery term"): once this deal's rate is locked, every window in its
     delivery term books directly at that rate — no bidding. Before it
     locks, a deal with auctionCloses set still runs the real auction
     below like any other, until that deadline passes with nothing having
     cleared, at which point it stops soliciting bids for the rest of the
     term (falls through, same as an expired delivery term always has). A
     deal with no auctionCloses set never hits either branch here and
     keeps clearing fresh every window, exactly as before this model
     existed. */
  if (assignmentOf(p.def) === 'deal') {
    const listId = assignedOf(p.def).buyersListId
    const list = listId ? ctx.buyersLists.get(listId) : null
    if (list && isActiveAt(list, start)) {
      if (isTermLocked(list)) return bookLockedTermWindow(ctx, p, start, list, out)
      if (!auctionOpenAt(list, start)) return { ...out, skipped: `Private auction window closed with no clearing bid (${list.name}).` }
    }
  }

  const candidates: ReservationRecord[] = []
  /* Until Exchange settings are complete, no DSP is sent bid requests (spec §7). */
  const allowed = effectivePartnerIds(ctx, p.def)
  const dsps = exchangeLive ? ctx.partners.list().filter((d) => receivesBidRequests(d) && (allowed === null || allowed.includes(d.id))) : []
  for (const dsp of dsps) {
    const url = ctx.config.bidders[dsp.provider as keyof Context['config']['bidders']]?.bidUrl
    if (!url) continue
    out.bidRequests++
    const res = await ctx.bidder.send(url, buildBidRequest(ctx, p, dsp, `req_${randomUUID().slice(0, 12)}`))
    for (const seatbid of res?.seatbid ?? []) {
      for (const bid of seatbid.bid ?? []) {
        out.bids++
        const r = await recordDspBid(ctx, p, dsp, start, res as BidResponse, seatbid.seat, bid)
        if (r.status === 'pending') candidates.push(r)
      }
    }
  }

  /* API bids placed earlier are checked again: approval, lists or pricing may have changed. */
  for (const r of existing.filter((x) => x.channel === 'api' && x.type === 'bid' && x.status === 'pending')) {
    const partner = ctx.partners.get(r.partnerId)
    const seat = partner?.seats.find((s) => advertiserSlug(s.name) === r.advertiserId)
    const refusal = !partner || !seat
      ? { reason: 'The advertiser is no longer on this DSP.' }
      : (await checkCampaign(ctx, r.campaignId as string)) ?? checkAdvertiser(ctx, p, partner, seat.name, seat.domain ? [seat.domain] : [], seat.id) ?? checkTargeting(p, r.pricingType) ?? checkFloor(ctx, r.bidCpm as number, r.pricingType, r.advertiserId)
    if (refusal) ctx.reservations.update(r.id, { status: 'rejected', reason: refusal.reason })
    else candidates.push(r)
  }

  const live = clear(ctx, candidates.filter((c) => !c.testMode))
  clear(ctx, candidates.filter((c) => c.testMode))
  if (live) {
    await handOff(ctx, live)
    out.winner = { reservationId: live.id, partnerId: live.partnerId, advertiserId: live.advertiserId, clearingCpm: live.bidCpm as number }
    /* This window's clear is the deal's ONE term-deciding auction the
       moment it has auctionCloses set and isn't locked yet — lock it now
       so every later window in the delivery term reuses this rate instead
       of re-auctioning (spec "…dynamic VAC-d billing over the delivery
       term"). A deal with no auctionCloses never reaches here locked, so
       it keeps clearing fresh every window as it always has. */
    if (assignmentOf(p.def) === 'deal') {
      const listId = assignedOf(p.def).buyersListId
      const list = listId ? ctx.buyersLists.get(listId) : null
      if (list?.auctionCloses && !isTermLocked(list)) {
        ctx.buyersLists.lockWin(list.id, {
          cpm: live.bidCpm as number, partnerId: live.partnerId, advertiserId: live.advertiserId, campaignId: live.campaignId as string,
          pricingType: live.pricingType, channel: live.channel, lockedAt: ctx.clock().toISOString(),
        })
      }
    }
  }
  return out
}

/* Books this window at a private auction's already-locked rate directly —
   no bidding, no fresh clearing — the same winning identity every window
   in the delivery term hands off to (spec "…dynamic VAC-d billing over the
   delivery term"). Still its own reservation, still billed on its own
   realised VAC-d for this window (billing.ts), always at the same
   clearingCpm. */
async function bookLockedTermWindow(ctx: Context, p: PositionRef, start: string, list: BuyersList, out: PositionOutcome): Promise<PositionOutcome> {
  const win = list.lockedWin!
  const r = ctx.reservations.insert({
    id: `res_${randomUUID().slice(0, 12)}`, partnerId: win.partnerId, advertiserId: win.advertiserId, campaignId: win.campaignId,
    positionId: p.positionId, windowStart: start, type: win.channel === 'openrtb' ? 'bid' : 'reserve', channel: win.channel,
    bidCpm: win.cpm, currency: ctx.company.get().currency, status: 'won', clearingCpm: win.cpm,
    reason: `Private auction: booked at ${list.name}'s locked rate, no re-auction.`, testMode: false, pricingType: win.pricingType, handedOffAt: null,
  })
  await handOff(ctx, r)
  return { ...out, skipped: `Private auction: booked at ${list.name}'s locked rate (${win.cpm}), no re-auction.`, winner: { reservationId: r.id, partnerId: r.partnerId, advertiserId: r.advertiserId, clearingCpm: r.clearingCpm as number } }
}

/* First price: the highest bid wins and pays its bid; ties go to the earlier bid. */
function clear(ctx: Context, candidates: ReservationRecord[]) {
  if (!candidates.length) return null
  const [winner, ...rest] = [...candidates].sort((a, b) => (b.bidCpm as number) - (a.bidCpm as number))
  ctx.reservations.update(winner.id, { status: 'won', clearingCpm: winner.bidCpm, reason: null })
  for (const r of rest) ctx.reservations.update(r.id, { status: 'lost', reason: `Outbid: the window cleared at ${winner.bidCpm} ${winner.currency} CPM.` })
  return ctx.reservations.get(winner.id)
}

/* Records one bid from a DSP's response: a candidate (pending) if it passes
   every pre-auction check, otherwise rejected with the reason. The
   advertiser blocklist is enforced here, on the bid, using the seat and
   advertiser identity in the response (spec §7). */
async function recordDspBid(ctx: Context, p: PositionRef, dsp: PartnerRecord, start: string, res: BidResponse, seatId: string | undefined, bid: Bid): Promise<ReservationRecord> {
  const currency = ctx.company.get().currency
  const base: ReservationRecord = {
    id: `res_${randomUUID().slice(0, 12)}`, partnerId: dsp.id, advertiserId: null, campaignId: null, positionId: p.positionId, windowStart: start,
    type: 'bid', channel: 'openrtb', bidCpm: typeof bid.price === 'number' ? bid.price : null, currency, status: 'pending', clearingCpm: null, reason: null,
    testMode: dsp.mode !== 'live', pricingType: null, handedOffAt: null,
  }
  const reject = (reason: string, extra: Partial<ReservationRecord> = {}) => ctx.reservations.insert({ ...base, ...extra, status: 'rejected', reason })

  if (res.cur && res.cur !== currency) return reject(`Bid in ${res.cur}; the exchange trades in ${currency}.`)
  if (!(typeof bid.price === 'number' && bid.price > 0)) return reject('No price on the bid.')
  if (!seatId || !dsp.bidder.seatIds?.includes(seatId)) return reject(`Seat ${seatId ?? '(none)'} is not one of ${dsp.name}’s seat IDs.`)
  const domains = (bid.adomain ?? []).map((d) => d.trim().toLowerCase())
  const seat = dsp.seats.find((s) => s.domain && domains.includes(s.domain.toLowerCase()))
  if (!seat) return reject(`Unknown advertiser${domains.length ? ` (${domains.join(', ')})` : ''}: not one of ${dsp.name}’s advertisers.`)
  const advertiserId = advertiserSlug(seat.name)
  const refused = checkAdvertiser(ctx, p, dsp, seat.name, domains, seat.id) ?? checkCategories(ctx, p, bid.cat ?? [])
  if (refused) return reject(refused.reason, { advertiserId })
  if (!bid.crid) return reject('No creative ID (crid) on the bid.', { advertiserId })

  const campaignId = campaignForCrid(ctx, dsp.id, bid.crid)
  if (!campaignId) return reject(await queueCreative(ctx, dsp, { crid: bid.crid, iurl: bid.iurl }, { id: advertiserId, name: seat.name }, p), { advertiserId })
  const campaign = ctx.campaigns.getCampaign(campaignId)
  if (!campaign || campaign.advertiserId !== advertiserId) return reject(`Creative ${bid.crid} belongs to another advertiser.`, { advertiserId })
  const late = (await checkCampaign(ctx, campaignId)) ?? checkTargeting(p, campaign.pricingType) ?? checkFloor(ctx, bid.price, campaign.pricingType, advertiserId)
  if (late) return reject(late.reason, { advertiserId, campaignId })
  return ctx.reservations.insert({ ...base, advertiserId, campaignId, pricingType: campaign.pricingType ?? null })
}
