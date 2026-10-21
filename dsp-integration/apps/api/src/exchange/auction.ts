/* The private-auction (deal) clearing (spec §6, §7): clears one play window
   for the positions assigned to a buyers list, ahead of the window. First
   price (OpenRTB at=1). Candidates are the API bids placed through
   POST /v1/reservations and the bids DSPs return to our OpenRTB requests;
   every pre-auction check applies before any bid can win. A position held
   for a named advertiser is booked by reservation, not auctioned.

   This is the ONLY window auction left (Rob, 8 Oct 2026). Every position
   that is not a deal or held for named advertisers is sold in real time,
   per impression (realtime.ts), and has no window auction, no advance
   bidding and no company auction schedule. The scheduler
   (scheduler.ts dueDealAuctions) triggers this per deal window, one window
   ahead.

   Test-mode DSPs receive requests and their bids are cleared among
   themselves, but a Test-mode win never takes the window, is never billed
   and is never handed off (spec §7). The live winner is handed off
   (handoff.ts).

   Private auctions are industry standard (16 Oct 2026): invited buyers bid
   on each slot throughout the flight, first price, against the deal's CPM
   floor. There is no auction window, no rate lock and nothing held between
   windows; a window with no clearing bid falls through to the open auction
   or default campaign. Only a deal locked under the retired two-period model
   keeps booking its locked rate until flight end (bookLockedTermWindow,
   billing/lockedTerm.ts), billed on each window's own realised VAC-d.

   The waterfall is PG, preferred deal, private auction, open auction. A
   preferred deal (one named buyer, a fixed CPM) gets first look at each
   slot: if its buyer bids at or above the fixed CPM the window is sold to it
   at that fixed CPM; otherwise (it passes) the slot goes to the next tier.
   Nothing is reserved ahead of the window: PG is the only type that
   reserves inventory.

   Reservation booking needs nothing new here. A window a buyer reserved on a
   held or deal position (POST /v1/reservations; the reserve price was removed
   on 17 Oct 2026, a deal carries its own rate) already has its `reserved` row, so
   this position is skipped for that window. No bid request goes out, and
   migration 0021's one-live-winner index would refuse a second sale anyway.
   A legacy locked rate (either source) never books a window below the
   effective floor (deals never bypass the floor, OQ45).

   Windows are per slot (OQ27, Rob 29 Sep 2026): each position's window is
   its own billing unit long (positions.ts windowMs(ctx, p)), all laid from
   the same Monday anchor. An auction is for a window start, and clears
   every position whose own window starts then — a Monday clears the daily
   slots and the weekly ones together; a Tuesday only the daily ones. A
   locked-rate term's windows are therefore its slot's billing unit long,
   each booked (and billed) as its own reservation. */
import { randomUUID } from 'node:crypto'
import type { Context } from '../context'
import { TRANSACTING_CURRENCY } from '../domain/currency'
import { bookLockedTermWindow, termStateAt } from '../billing'
import { isLive } from '../domain/exchange'
import { type PositionRef, allPositions, assignmentOf, inGlobalDeal, tierOf, effectivePartnerIds, fallsThroughToOpen, filterAsync, isRealtime, isSellable, nextWindow, positionView, windowMsFor, windowStartOf } from '../domain/positions'
import type { PartnerRecord } from '../repos/PartnerRepo'
import { type ReservationRecord, TAKEN } from '../repos/ReservationRepo'
import { advertiserSlug, assignedOf, type BuyersList } from '@ph-dsp/types'
import { isUniqueViolation, tx } from '../db/db'
import { queueCreative, verifiedCampaign } from './creatives'
import { vetAtBidCreative } from './atBid'
import { checkAdvertiser, checkAudiences, checkCampaign, checkCampaignAtBid, checkCategories, checkFloor, checkTargeting, checkVersionCount, firstRefusal } from './enforcement'
import { handOff } from './handoff'
import { settlePending } from './pending'
import { bidderTuning } from '../domain/partnerInput'
import { providerOf } from '../dsp/registry'
import { type Bid, type BidResponse, buildBidRequest } from './openrtb'
import { GLOBAL_DEAL_ID } from '../domain/exchange'
import { positionHourGroups, windowOpenFor } from '../domain/operatingGate'

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
/* Where this DSP's bid request goes (config.bidEndpointSource): its saved
   bidder endpoint, or the provider's sandbox URL. */
export const bidUrlFor = (ctx: Context, dsp: PartnerRecord) =>
  ctx.config.bidEndpointSource === 'partner' ? dsp.bidder.bidderEndpoint?.trim() || undefined : providerOf(ctx.dsp, dsp.provider)?.bidUrl
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
/* Waterfall rank by deal type: lower is tried first. A guaranteed deal reserves its inventory and is not auctioned. */
const TIER_RANK: Record<BuyersList['dealType'], number> = { guaranteed: 0, direct: 0, preferred: 1, private_auction: 2 }
export const POSITION_CONCURRENCY = 16
export const MAX_BIDS_PER_RESPONSE = 10

/* Which positions to clear (exchange/scheduler.ts dueDealAuctions). */
export interface AuctionOptions { positions?: readonly PositionRef[] }

/* Clears one window for private-auction (deal) positions only: every other
   position is sold in real time (realtime.ts), with no window auction. */
export async function runAuction(ctx: Context, at?: Date, opts: AuctionOptions = {}): Promise<AuctionResult> {
  const windowStart = at ?? (await nextWindow(ctx))
  const start = windowStart.toISOString()
  /* Switched off or incomplete: no DSP is sent a bid request. */
  const exchangeLive = isLive(await ctx.exchange.get())
  /* The deal positions whose own window starts here (OQ27), or the ones the caller names. */
  const startingHere = opts.positions
    ? [...opts.positions]
    : (await allPositions(ctx)).filter((p) => assignmentOf(p.def) === 'deal' && windowStartOf(windowStart, windowMsFor(p)).getTime() === windowStart.getTime())
  /* Unscored slots are skipped: no audience score means no assumed views to sell. */
  const positions = await filterAsync(startingHere, (p) => isSellable(ctx, p))
  /* The DSPs that receive bid requests, read once for the whole auction,
     not once per position (review, 24 Sep 2026). */
  const bidders = exchangeLive ? (await ctx.partners.list()).filter(receivesBidRequests) : []
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
        await settlePending(ctx, p.positionId, start, `The auction for this position failed: ${message}`)
        outcomes[i] = { positionId: p.positionId, bidRequests: 0, bids: 0, winner: null, skipped: `Failed: ${message}` }
      }
    }
  }
  const concurrency = Math.max(1, ctx.config.auctionConcurrency || POSITION_CONCURRENCY)
  await Promise.all(Array.from({ length: Math.min(concurrency, positions.length) }, worker))
  return { windowStart: start, positions: outcomes }
}

/* One position's window auction, in this order:
   1. skip what isn't sold by window auction or can't be sold now — real-time
      positions, ones held by reservation, no displays, outside every
      display's operating hours, a window already taken;
   2. build the waterfall of tiers from its buyers lists (one tier per list,
      ranked PG → preferred → private auction);
   3. a tier under a locked term books the window outright at its rate;
   4. a position locked against new sales sells nothing new;
   5. otherwise auction tier by tier until one yields a winner at its floor;
   6. settle any API bid still pending, so none outlives its window;
   7. hand the winner off to the campaign store (exchange/handoff.ts).
   Returns what happened (skipped and why, requests, bids, the winner) for
   the auction's result and its log. */
async function clearPosition(ctx: Context, p: PositionRef, start: string, bidders: PartnerRecord[]): Promise<PositionOutcome> {
  const out: PositionOutcome = { positionId: p.positionId, bidRequests: 0, bids: 0, winner: null }
  if (isRealtime(p)) return { ...out, skipped: 'Sold in real time, per impression: no window auction.' }
  if (assignmentOf(p.def) === 'reserved') return { ...out, skipped: 'Held for a named advertiser: booked by reservation.' }
  if (!(await ctx.displays.summaryByDisplayType(p.displayType.id)).displays) return { ...out, skipped: 'No displays.' }
  /* Zone-based operating hours: a window none of the position's displays is open for gets no bid request. */
  if (!windowOpenFor(await positionHourGroups(ctx, p), new Date(start), windowMsFor(p))) return { ...out, skipped: 'Outside operating hours: no display is open in this window.' }
  const existing = await ctx.reservations.forWindow(p.positionId, start)
  const taken = existing.find((r) => !r.testMode && TAKEN.includes(r.status))
  if (taken) return { ...out, skipped: taken.status === 'reserved' ? 'Reserved: held outside the open auction.' : 'Already sold.' }

  /* The waterfall (7 Oct 2026, Broadsign model): a position assigned several
     buyers lists tries them top-down, one list per tier. The first tier whose
     auction yields a winning bid at its floor takes the window; each tier
     before it that did not falls through. A tier is the position as if only
     that list were assigned to it (tierOf), so every check (invited buyers,
     deal ID, the three-level floor, the term) is that list's own. A position
     with one list, or none, is a single tier and runs exactly as before. */
  const listIds = assignmentOf(p.def) === 'deal' ? assignedOf(p.def).buyersListIds : []
  /* Waterfall order: PG, preferred deal, private auction (open auction is the real-time fall-through). The assigned order breaks ties within a type. */
  const lists = await Promise.all(listIds.map((id) => ctx.buyersLists.get(id)))
  const ordered = listIds.map((id, i) => ({ id, list: lists[i], i })).sort((a, b) => (TIER_RANK[a.list?.dealType ?? 'private_auction'] - TIER_RANK[b.list?.dealType ?? 'private_auction']) || a.i - b.i)
  const tiers = listIds.length > 1 ? ordered.map((o) => tierOf(p, o.id)) : [p]

  /* A deal locked under the retired two-period model (before 16 Oct 2026)
     books every window of its flight at its locked rate, with no bidding,
     until the flight ends. Every other deal takes bids on each window. */
  const open: PositionRef[] = []
  for (const tp of tiers) {
    if (assignmentOf(tp.def) !== 'deal') { open.push(tp); continue }
    const list = await ctx.buyersLists.get(assignedOf(tp.def).buyersListId as string)
    const term = list ? termStateAt(list, start) : null
    if (list && term?.active && term.locked) return bookLockedTermWindow(ctx, tp, start, list, out)
    open.push(tp)
  }

  /* Locked against new sales (30 Sep 2026): windows already booked were
     handled above and a locked term keeps booking at its rate; nothing new
     is solicited, and a bid placed before the lock is settled as lost. */
  if (p.def.salesLocked) {
    await settlePending(ctx, p.positionId, start, 'This position is locked against new sales; nothing was sold.')
    return { ...out, skipped: 'Locked against new sales.' }
  }

  let live: ReservationRecord | null = null
  for (const [i, tp] of open.entries()) {
    live = await auctionTier(ctx, tp, start, bidders, out, i === open.length - 1)
    if (live) break
  }
  /* Anything still pending for this window now arrived between the read
     above and the clear (the checks above await), or was never a
     candidate: it is settled here, never left pending on a closed window.
     POST /v1/reservations also refuses a bid once the window's auction is
     claimed (auction_runs), so on the scheduled path this finds nothing. */
  await settlePending(ctx, p.positionId, start, 'Placed after this window’s auction had cleared.')
  if (!live && fallsThroughToOpen(p.def, (await ctx.exchange.get()).globalDealEnabled === true)) out.skipped = 'No deal won this window: plays fall through to the real-time Open auction.'
  if (live) {
    await handOff(ctx, live)
    out.winner = { reservationId: live.id, partnerId: live.partnerId, advertiserId: live.advertiserId, clearingCpm: (live.clearingCpm ?? live.bidCpm) as number }
  }
  return out
}

/* One tier's auction: bid requests to the DSPs this tier invites, the API
   bids already placed, every pre-auction check against this tier's list
   and floor, then the clear. Returns the live winner, or null when the
   tier yields no valid winning bid at its floor, so the waterfall falls
   through. An API bid this tier refuses is left pending for the next tier
   to judge, and rejected only by the last (a bid below tier one's floor
   may clear tier two's). */
async function auctionTier(ctx: Context, p: PositionRef, start: string, bidders: PartnerRecord[], out: PositionOutcome, last: boolean): Promise<ReservationRecord | null> {
  const candidates: ReservationRecord[] = []
  /* Until Exchange settings are complete, no DSP is sent bid requests (spec
     §7): `bidders` is empty then. */
  const allowed = await effectivePartnerIds(ctx, p.def, bidders)
  const dsps = bidders.filter((d) => allowed === null || allowed.includes(d.id))
  /* The position as every DSP sees it, once (no advertiser, so no floor multiplier). */
  const view = dsps.length ? await positionView(ctx, p, { partner: dsps[0], advertiser: null, unknownAdvertiser: false }, start) : null
  /* Every DSP for this position at once; responses are then processed in
     the DSPs' own order so the outcome doesn't depend on who answered first. */
  const sent: { dsp: PartnerRecord; reqId: string; res: ReturnType<Context['bidder']['send']> }[] = []
  for (const dsp of dsps) {
    const url = bidUrlFor(ctx, dsp)
    if (!url) continue
    const reqId = `req_${randomUUID().slice(0, 12)}`
    sent.push({ dsp, reqId, res: ctx.bidder.send(url, await buildBidRequest(ctx, p, dsp, reqId, view!), bidderTuning(dsp.bidder, ctx.config)) })
  }
  out.bidRequests += sent.length
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
  const apiBids = (await ctx.reservations.forWindow(p.positionId, start)).filter((x) => x.channel === 'api' && x.type === 'bid' && x.status === 'pending')
  for (const r of apiBids) {
    const partner = await ctx.partners.get(r.partnerId)
    const seat = partner?.seats.find((s) => advertiserSlug(s.name) === r.advertiserId)
    /* Connection first: disconnecting a DSP clears its seats, so the seat
       check would otherwise always answer before the real reason. */
    const refusal = !partner
      ? { reason: 'The advertiser is no longer on this DSP.' }
      : partner.status !== 'connected'
      ? { reason: `${partner.name} is not connected.` }
      : !seat
      ? { reason: 'The advertiser is no longer on this DSP.' }
      : await firstRefusal(
        () => checkCampaign(ctx, r.campaignId as string),
        () => checkAdvertiser(ctx, p, partner, seat.name, seat.domain ? [seat.domain] : [], seat.id, start),
        () => checkTargeting(p, r.pricingType),
        () => checkAudiences(ctx, r.campaignId as string, { partnerId: partner.id, seatId: seat.id }),
        () => checkVersionCount(ctx, p, r.campaignId as string),
        () => checkFloor(ctx, r.bidCpm as number, r.advertiserId, { partner, position: p }),
      )
    if (refusal) { if (last) await ctx.reservations.update(r.id, { status: 'rejected', reason: refusal.reason }) }
    else candidates.push(r)
  }

  /* A preferred deal clears at its fixed CPM, not at the buyer's bid: the buyer bids at or above it (anything lower was refused at the floor above) or passes, and a pass sends the slot to the next tier. */
  const tierList = assignmentOf(p.def) === 'deal' ? await ctx.buyersLists.get(assignedOf(p.def).buyersListId as string) : null
  const fixedCpm = tierList?.dealType === 'preferred' ? tierList.floorCpm : null
  const winner = await clear(ctx, candidates.filter((c) => !c.testMode), fixedCpm)
  await clear(ctx, candidates.filter((c) => c.testMode), fixedCpm)
  return winner
}

/* First price: the highest bid wins and pays its bid; ties go to the earlier bid.
   Marking the winner can fail on migration 0021's unique index when another
   clearing of the same window (the CLI next to the scheduler, or a second
   instance) already sold it; then nobody here wins, and every candidate is
   told why rather than being left pending. One transaction: the winner and
   every loser are marked together. */
async function clear(ctx: Context, candidates: ReservationRecord[], fixedCpm: number | null = null): Promise<ReservationRecord | null> {
  if (!candidates.length) return null
  const [winner, ...rest] = [...candidates].sort((a, b) => (b.bidCpm as number) - (a.bidCpm as number) || (a.createdAt ?? '').localeCompare(b.createdAt ?? ''))
  const price = fixedCpm ?? (winner.bidCpm as number)
  return tx(ctx.db, async () => {
    try {
      await ctx.reservations.update(winner.id, { status: 'won', clearingCpm: price, reason: fixedCpm === null ? null : `Preferred deal: first look taken at the fixed CPM of ${fixedCpm} ${winner.currency}.` })
    } catch (e) {
      if (!isUniqueViolation(e)) throw e
      for (const r of candidates) await ctx.reservations.update(r.id, { status: 'lost', reason: 'The window was sold by another clearing of the same auction.' })
      return null
    }
    for (const r of rest) await ctx.reservations.update(r.id, { status: 'lost', reason: `Outbid: the window cleared at ${price} ${winner.currency} CPM.` })
    return ctx.reservations.get(winner.id)
  })
}

/* A DSP bid, vetted against every pre-auction check (spec §7): either
   rejected with the reason (and who it was from, once known), or the
   advertiser, creative and pricing type it would compete with. Shared by the
   window auction (recorded as a reservation) and the real-time path
   (exchange/realtime.ts, recorded on its own impression). The advertiser
   blocklist is enforced here, on the bid, using the seat and advertiser
   identity in the response (spec §7). */
export type VettedBid = { ok: false; reason: string; code?: string; advertiserId?: string; campaignId?: string } | { ok: true; advertiserId: string; campaignId: string; pricingType: string | null; seatId: string; atBid?: { crid: string; iurl: string } }

/* The real-time path's at-bid creative (exchange/atBid.ts): there is no time to retrieve and review a creative inside tmax, so a creative PH has not seen yet may fill, and is reviewed after it plays. */
export interface VetOptions { atBid?: boolean }

/* Records one bid from a DSP's response: a candidate (pending) if it passes
   every pre-auction check, otherwise rejected with the reason. */
async function recordDspBid(ctx: Context, p: PositionRef, dsp: PartnerRecord, start: string, res: BidResponse, seatId: string | undefined, bid: Bid, budget: { creativeFetches: number }): Promise<ReservationRecord> {
  const base: ReservationRecord = {
    id: `res_${randomUUID().slice(0, 12)}`, partnerId: dsp.id, advertiserId: null, campaignId: null, positionId: p.positionId, windowStart: start,
    type: 'bid', channel: 'openrtb', bidCpm: typeof bid.price === 'number' ? bid.price : null, currency: TRANSACTING_CURRENCY, status: 'pending', clearingCpm: null, reason: null,
    testMode: dsp.mode !== 'live', pricingType: null, handedOffAt: null, seatId: seatId ?? null,
  }
  const v = await vetBid(ctx, p, dsp, start, res, seatId, bid, budget)
  if (!v.ok) return ctx.reservations.insert({ ...base, advertiserId: v.advertiserId ?? null, campaignId: v.campaignId ?? null, status: 'rejected', reason: v.reason })
  return ctx.reservations.insert({ ...base, advertiserId: v.advertiserId, campaignId: v.campaignId, pricingType: v.pricingType })
}

/* Every pre-auction check on one DSP bid, cheapest and most basic first, and
   the first refusal wins (its reason is what the reservation or impression
   records): the response's currency, the price (present, finite, under the
   ceiling), the impression id, the seat, the deal ID a deal position
   requires (or the global deal's eligibility), the advertiser (from adomain
   against the DSP's synced seats), the retailer's advertiser and category
   lists, the creative (crid → a fetched-and-hashed creative PH has approved;
   unknown ones are queued for review, or on the real-time path may fill and
   be reviewed after the play), then the campaign's approval, its pricing
   type against the position, the version count and the floor. A pass is a
   candidate; the auction then ranks candidates by price. */
export async function vetBid(ctx: Context, p: PositionRef, dsp: PartnerRecord, start: string, res: BidResponse, seatId: string | undefined, bid: Bid, budget: { creativeFetches: number }, opts: VetOptions = {}): Promise<VettedBid> {
  const currency = TRANSACTING_CURRENCY
  const reject = async (reason: string, extra: { advertiserId?: string; campaignId?: string; code?: string } = {}): Promise<VettedBid> => ({ ok: false, reason, ...extra })

  /* The exchange transacts in USD on every instance (domain/currency.ts):
     DV360 and The Trade Desk bid USD only, so there is no conversion. `cur`
     is a validation check, never a conversion input: a bid in any other
     currency is rejected, and so is one that names none (OpenRTB would read
     that as USD; we do not guess). */
  if (!res.cur) return reject(`Bid names no currency; the exchange trades in ${currency} and does not convert.`)
  if (res.cur !== currency) return reject(`Bid in ${res.cur}; the exchange trades in ${currency} and does not convert.`)
  if (!(typeof bid.price === 'number' && Number.isFinite(bid.price) && bid.price > 0)) return reject('No price on the bid.')
  /* A price no real campaign pays is a DSP bug or a malformed response; it
     must not win a window and be billed. */
  if (bid.price > ctx.config.maxBidCpm) return reject(`Bid of ${bid.price} ${currency} CPM is above the exchange's ceiling of ${ctx.config.maxBidCpm}.`)
  /* The request carries one impression, id "1" (openrtb.ts). */
  if (bid.impid !== undefined && bid.impid !== '1') return reject(`Bid for impression ${bid.impid}; the request offered impression 1.`)
  if (!seatId || !dsp.bidder.seatIds?.includes(seatId)) return reject(`Seat ${seatId ?? '(none)'} is not one of ${dsp.name}’s seat IDs.`)
  /* A deal position clears only bids quoting its deal ID (pmp.deals). */
  if (assignmentOf(p.def) === 'deal') {
    const listId = assignedOf(p.def).buyersListId
    const required = listId ? await ctx.buyersLists.dealIdFor(listId, dsp.id) : undefined
    if (!required || bid.dealid !== required) return reject(`Bid ${bid.dealid ? `quotes deal ${bid.dealid}` : 'has no dealid'}; this private auction requires ${required ?? 'its deal ID'}.`)
  }
  /* The global deal ID is only good on a position that is in the global deal (8 Oct 2026): quoting it elsewhere, or while the master switch is off, is refused rather than silently treated as open. Quoting it on an eligible position competes exactly as open exchange (same floor, first-price, same checks). */
  if (bid.dealid === GLOBAL_DEAL_ID && !inGlobalDeal(p.def, (await ctx.exchange.get()).globalDealEnabled === true)) return reject(`Bid quotes the global deal ${GLOBAL_DEAL_ID}; this position is not in the global deal.`)
  const domains = (bid.adomain ?? []).map((d) => d.trim().toLowerCase())
  const seat = dsp.seats.find((s) => s.domain && domains.includes(s.domain.toLowerCase()))
  if (!seat) return reject(`Unknown advertiser${domains.length ? ` (${domains.join(', ')})` : ''}: not one of ${dsp.name}’s advertisers.`)
  const advertiserId = advertiserSlug(seat.name)
  const refused = await firstRefusal(() => checkAdvertiser(ctx, p, dsp, seat.name, domains, seat.id, start), () => checkCategories(ctx, p, dsp, bid.cat ?? []))
  if (refused) return reject(refused.reason, { advertiserId })
  if (!bid.crid) return reject('No creative ID (crid) on the bid.', { advertiserId })

  /* The crid is only a label: it resolves to a creative only while its fetch-and-hash is fresh and the creative URL unchanged. */
  const campaignId = await verifiedCampaign(ctx, dsp.id, bid.crid, bid.iurl)
  if (!campaignId && opts.atBid) return vetAtBidCreative(ctx, p, dsp, bid, { id: advertiserId, name: seat.name }, seat.id)
  if (!campaignId) {
    /* The one-retrieval budget is spent inside queueCreative, only once a fetch is really attempted: a refused (off-path) URL must not use it up. */
    return reject(await queueCreative(ctx, dsp, { crid: bid.crid, iurl: bid.iurl, ext: bid.ext && typeof bid.ext === 'object' ? bid.ext : undefined }, { id: advertiserId, name: seat.name }, p, budget), { advertiserId })
  }
  const campaign = await ctx.campaigns.getCampaign(campaignId)
  if (!campaign) return reject(`Creative ${bid.crid} is still being retrieved for review.`, { advertiserId })
  if (campaign.advertiserId !== advertiserId) return reject(`Creative ${bid.crid} belongs to another advertiser.`, { advertiserId })
  const price = bid.price
  const late = await firstRefusal(
    () => (opts.atBid ? checkCampaignAtBid(ctx, campaignId) : checkCampaign(ctx, campaignId)),
    () => checkTargeting(p, campaign.pricingType),
    () => checkAudiences(ctx, campaignId, { partnerId: dsp.id, seatId: seat.id }),
    () => checkVersionCount(ctx, p, campaignId),
    () => checkFloor(ctx, price, advertiserId, { partner: dsp, position: p }),
  )
  if (late) return reject(late.reason, { advertiserId, campaignId, code: late.code })
  return { ok: true, advertiserId, campaignId, pricingType: campaign.pricingType ?? null, seatId: seat.id }
}
