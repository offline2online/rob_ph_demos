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
import { isLive } from '../domain/exchange'
import { type PositionRef, allPositions, assignmentOf, effectivePartnerIds, nextWindow, positionView } from '../domain/positions'
import type { PartnerRecord } from '../repos/PartnerRepo'
import { type ReservationRecord, TAKEN } from '../repos/ReservationRepo'
import { advertiserSlug, assignedOf, type BuyersList } from '@ph-dsp/types'
import { isUniqueViolation } from '../db/db'
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

/* Scalability bounds (review, 23 Sep 2026):
   - POSITION_CONCURRENCY positions clear at once (the default;
     Config.auctionConcurrency, PH_AUCTION_CONCURRENCY, sets it). Each
     position's bid requests already go to every DSP in parallel, so one
     position costs about one bidder round trip however many DSPs there
     are; running positions in bounded batches keeps a 2,400-position
     estate to positions ÷ concurrency × round trip — 12 s at 80 ms, 45 s
     at the 300 ms timeout (measured 24 Sep 2026) — without opening an
     unbounded number of sockets to any one DSP (the bidder's per-DSP QPS
     ceiling still spaces them). Raising it to 64 would clear the same
     estate in about 3 s, at up to 500 requests/s per DSP.
   - MAX_BIDS_PER_RESPONSE: a request carries one impression, so a sane
     response has one bid per seat. Anything past this is ignored rather
     than written, so a misbehaving DSP can't flood the reservations table.
   - One unknown creative is retrieved per DSP response (queueCreative
     fetches it, up to the asset size limit); further unknown creatives in
     the same response are discarded with a reason and retried in a later
     window, so a response full of new crids can't stall the clearing. */
export const POSITION_CONCURRENCY = 16
export const MAX_BIDS_PER_RESPONSE = 10

export async function runAuction(ctx: Context, windowStart: Date = nextWindow(ctx)): Promise<AuctionResult> {
  const start = windowStart.toISOString()
  /* Switched off or incomplete: no DSP is sent a bid request. */
  const exchangeLive = isLive(ctx.exchange.get())
  const positions = allPositions(ctx)
  /* The DSPs that receive bid requests, read once for the whole auction,
     not once per position (review, 24 Sep 2026). */
  const bidders = exchangeLive ? ctx.partners.list().filter(receivesBidRequests) : []
  /* Results keep the estate's order, whatever order batches finish in. */
  const outcomes: PositionOutcome[] = new Array(positions.length)
  let next = 0
  const worker = async () => {
    while (next < positions.length) {
      const i = next++
      const p = positions[i]
      try {
        outcomes[i] = await clearPosition(ctx, p, start, bidders)
      } catch (e) {
        /* One position's failure (a fault in a DSP's answer, a store that
           refused a write) is that position's outcome, not the auction's:
           every other position still clears and the tick still finishes
           (stability review, 24 Sep 2026). What was pending for it is
           settled so no bid is left hanging on a window that has closed. */
        const message = e instanceof Error ? e.message : String(e)
        settlePending(ctx, p.positionId, start, `The auction for this position failed: ${message}`)
        outcomes[i] = { positionId: p.positionId, bidRequests: 0, bids: 0, winner: null, skipped: `Failed: ${message}` }
      }
    }
  }
  const concurrency = Math.max(1, ctx.config.auctionConcurrency || POSITION_CONCURRENCY)
  await Promise.all(Array.from({ length: Math.min(concurrency, positions.length) }, worker))
  return { windowStart: start, positions: outcomes }
}

async function clearPosition(ctx: Context, p: PositionRef, start: string, bidders: PartnerRecord[]): Promise<PositionOutcome> {
  const out: PositionOutcome = { positionId: p.positionId, bidRequests: 0, bids: 0, winner: null }
  if (assignmentOf(p.def) === 'reserved') return { ...out, skipped: 'Held for a named advertiser: booked by reservation.' }
  if (!ctx.displays.summaryByDisplayType(p.displayType.id).displays) return { ...out, skipped: 'No displays.' }
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
  /* Until Exchange settings are complete, no DSP is sent bid requests (spec
     §7): `bidders` is empty then. */
  const allowed = effectivePartnerIds(ctx, p.def, bidders)
  const dsps = bidders.filter((d) => allowed === null || allowed.includes(d.id))
  /* The position as every DSP sees it, once (no advertiser, so no floor multiplier). */
  const view = dsps.length ? positionView(ctx, p, { partner: dsps[0], advertiser: null, unknownAdvertiser: false }) : null
  /* Every DSP for this position at once; responses are then processed in
     the DSPs' own order so the outcome doesn't depend on who answered first. */
  const sent = dsps.flatMap((dsp) => {
    const url = ctx.config.bidders[dsp.provider as keyof Context['config']['bidders']]?.bidUrl
    if (!url) return []
    const reqId = `req_${randomUUID().slice(0, 12)}`
    return [{ dsp, reqId, res: ctx.bidder.send(url, buildBidRequest(ctx, p, dsp, reqId, view!)) }]
  })
  out.bidRequests = sent.length
  for (const { dsp, reqId, res: pending } of sent) {
    const res = await pending
    /* A response to some other request (OpenRTB: BidResponse.id echoes
       BidRequest.id) is no bid; so is anything that isn't the shape of a
       BidResponse — a DSP's malformed answer must not throw here and take
       the whole auction down with it. */
    if (!res || typeof res !== 'object' || (res.id !== undefined && res.id !== reqId)) continue
    let seen = 0
    const budget = { creativeFetches: 1 }
    for (const seatbid of Array.isArray(res.seatbid) ? res.seatbid : []) {
      if (!seatbid || typeof seatbid !== 'object') continue
      for (const bid of Array.isArray(seatbid.bid) ? seatbid.bid : []) {
        if (++seen > MAX_BIDS_PER_RESPONSE) break
        if (!bid || typeof bid !== 'object') continue
        out.bids++
        const r = await recordDspBid(ctx, p, dsp, start, res, typeof seatbid.seat === 'string' ? seatbid.seat : undefined, bid, budget)
        if (r.status === 'pending') candidates.push(r)
      }
    }
  }

  /* API bids are checked again: approval, lists or pricing may have
     changed. Read now, not with `existing` before the bidders answered: a
     bid placed while they were answering (bidding is open until the
     cutoff) is in this auction, not stranded pending after it. */
  const apiBids = ctx.reservations.forWindow(p.positionId, start).filter((x) => x.channel === 'api' && x.type === 'bid' && x.status === 'pending')
  for (const r of apiBids) {
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
  /* Anything still pending for this window now arrived between the read
     above and the clear (the checks above await), or was never a
     candidate: it is settled here, never left pending on a closed window.
     POST /v1/reservations also refuses a bid once the window's auction is
     claimed (auction_runs), so on the scheduled path this finds nothing. */
  settlePending(ctx, p.positionId, start, 'Placed after this window’s auction had cleared.')
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
  let r: ReservationRecord
  try {
    r = ctx.reservations.insert({
    id: `res_${randomUUID().slice(0, 12)}`, partnerId: win.partnerId, advertiserId: win.advertiserId, campaignId: win.campaignId,
    positionId: p.positionId, windowStart: start, type: win.channel === 'openrtb' ? 'bid' : 'reserve', channel: win.channel,
    bidCpm: win.cpm, currency: ctx.company.get().currency, status: 'won', clearingCpm: win.cpm,
    reason: `Private auction: booked at ${list.name}'s locked rate, no re-auction.`, testMode: false, pricingType: win.pricingType, handedOffAt: null,
    })
  } catch (e) {
    /* Another clearing booked this window first (migration 0021). */
    if (isUniqueViolation(e)) return { ...out, skipped: 'Already sold.' }
    throw e
  }
  await handOff(ctx, r)
  return { ...out, skipped: `Private auction: booked at ${list.name}'s locked rate (${win.cpm}), no re-auction.`, winner: { reservationId: r.id, partnerId: r.partnerId, advertiserId: r.advertiserId, clearingCpm: r.clearingCpm as number } }
}

/* First price: the highest bid wins and pays its bid; ties go to the earlier bid.
   Marking the winner can fail on migration 0021's unique index when another
   clearing of the same window (the CLI next to the scheduler, or a second
   instance) already sold it; then nobody here wins, and every candidate is
   told why rather than being left pending. */
function clear(ctx: Context, candidates: ReservationRecord[]) {
  if (!candidates.length) return null
  const [winner, ...rest] = [...candidates].sort((a, b) => (b.bidCpm as number) - (a.bidCpm as number) || (a.createdAt ?? '').localeCompare(b.createdAt ?? ''))
  try {
    ctx.reservations.update(winner.id, { status: 'won', clearingCpm: winner.bidCpm, reason: null })
  } catch (e) {
    if (!isUniqueViolation(e)) throw e
    for (const r of candidates) ctx.reservations.update(r.id, { status: 'lost', reason: 'The window was sold by another clearing of the same auction.' })
    return null
  }
  for (const r of rest) ctx.reservations.update(r.id, { status: 'lost', reason: `Outbid: the window cleared at ${winner.bidCpm} ${winner.currency} CPM.` })
  return ctx.reservations.get(winner.id)
}

/* Marks every bid for the window still pending as lost, with the reason. */
function settlePending(ctx: Context, positionId: string, start: string, reason: string) {
  for (const r of ctx.reservations.forWindow(positionId, start)) if (r.status === 'pending') ctx.reservations.update(r.id, { status: 'lost', reason })
}

/* Records one bid from a DSP's response: a candidate (pending) if it passes
   every pre-auction check, otherwise rejected with the reason. The
   advertiser blocklist is enforced here, on the bid, using the seat and
   advertiser identity in the response (spec §7). */
async function recordDspBid(ctx: Context, p: PositionRef, dsp: PartnerRecord, start: string, res: BidResponse, seatId: string | undefined, bid: Bid, budget: { creativeFetches: number }): Promise<ReservationRecord> {
  const currency = ctx.company.get().currency
  const base: ReservationRecord = {
    id: `res_${randomUUID().slice(0, 12)}`, partnerId: dsp.id, advertiserId: null, campaignId: null, positionId: p.positionId, windowStart: start,
    type: 'bid', channel: 'openrtb', bidCpm: typeof bid.price === 'number' ? bid.price : null, currency, status: 'pending', clearingCpm: null, reason: null,
    testMode: dsp.mode !== 'live', pricingType: null, handedOffAt: null,
  }
  const reject = (reason: string, extra: Partial<ReservationRecord> = {}) => ctx.reservations.insert({ ...base, ...extra, status: 'rejected', reason })

  /* OpenRTB 2.6: a response with no `cur` is in USD. Treating it as the
     exchange's own currency would accept, say, a USD 5 bid as AUD 5. */
  const cur = res.cur ?? 'USD'
  if (cur !== currency) return reject(`Bid in ${cur}; the exchange trades in ${currency}.`)
  if (!(typeof bid.price === 'number' && Number.isFinite(bid.price) && bid.price > 0)) return reject('No price on the bid.')
  /* A price no real campaign pays is a DSP bug or a malformed response; it
     must not win a window and be billed. */
  if (bid.price > ctx.config.maxBidCpm) return reject(`Bid of ${bid.price} ${currency} CPM is above the exchange's ceiling of ${ctx.config.maxBidCpm}.`)
  /* The request carries one impression, id "1" (openrtb.ts). */
  if (bid.impid !== undefined && bid.impid !== '1') return reject(`Bid for impression ${bid.impid}; the request offered impression 1.`)
  if (!seatId || !dsp.bidder.seatIds?.includes(seatId)) return reject(`Seat ${seatId ?? '(none)'} is not one of ${dsp.name}’s seat IDs.`)
  const domains = (bid.adomain ?? []).map((d) => d.trim().toLowerCase())
  const seat = dsp.seats.find((s) => s.domain && domains.includes(s.domain.toLowerCase()))
  if (!seat) return reject(`Unknown advertiser${domains.length ? ` (${domains.join(', ')})` : ''}: not one of ${dsp.name}’s advertisers.`)
  const advertiserId = advertiserSlug(seat.name)
  const refused = checkAdvertiser(ctx, p, dsp, seat.name, domains, seat.id) ?? checkCategories(ctx, p, bid.cat ?? [])
  if (refused) return reject(refused.reason, { advertiserId })
  if (!bid.crid) return reject('No creative ID (crid) on the bid.', { advertiserId })

  const campaignId = campaignForCrid(ctx, dsp.id, bid.crid)
  if (!campaignId) {
    if (budget.creativeFetches <= 0) return reject(`Unknown creative ${bid.crid}; it will be retrieved for review from a later window.`, { advertiserId })
    budget.creativeFetches--
    return reject(await queueCreative(ctx, dsp, { crid: bid.crid, iurl: bid.iurl }, { id: advertiserId, name: seat.name }, p), { advertiserId })
  }
  const campaign = ctx.campaigns.getCampaign(campaignId)
  if (!campaign) return reject(`Creative ${bid.crid} is still being retrieved for review.`, { advertiserId })
  if (campaign.advertiserId !== advertiserId) return reject(`Creative ${bid.crid} belongs to another advertiser.`, { advertiserId })
  const late = (await checkCampaign(ctx, campaignId)) ?? checkTargeting(p, campaign.pricingType) ?? checkFloor(ctx, bid.price, campaign.pricingType, advertiserId)
  if (late) return reject(late.reason, { advertiserId, campaignId })
  return ctx.reservations.insert({ ...base, advertiserId, campaignId, pricingType: campaign.pricingType ?? null })
}
