/* Reservations and bids for a play window (spec §6):
     POST /v1/reservations        reserve (a position named to this advertiser) or bid (CPM)
     GET  /v1/reservations/{id}   outcome
   Approved campaigns only; every pre-auction check applies here, and again
   when the auction clears the window.

   Reserve-price booking (open questions 45 and 52, decided by Rob on 29 Sep
   2026, programmatic guaranteed): `type: reserve` on a position with a
   reserve price (reservePriceOf: the slot's override, else its display
   type's default) is a buyer's commitment to that window at the reserve
   price. It may be made ahead of the open auction, up to the cutoff. The
   window is held as Reserved at once: a `reserved` row, which the auction
   never clears (the one-live-winner-per-window index, migration 0021, counts
   it). It is booked and billed at the reserve price itself on the window's
   realised VAC-d (billing.ts): a floor commitment, not a guaranteed volume,
   with no make-good. "Premium" names what the reservePrice is (a CPM above
   what the open auction asks), not an amount added to the floor. The
   reserve price never undercuts the floor: below the buyer's effective
   floor, the booking is refused `below_floor`, like any other rate.
   On a private auction (deal) using the two-period model, the same
   commitment accepts the deal's terms for its whole delivery term: it
   locks the term at the reserve price (BuyersListRepo.lockWin, source
   `reserve`), and every later window of the term is then held and booked
   by the existing locked-term path (billing/lockedTerm.ts bookLockedTermWindow), not a
   parallel one. */
import { randomUUID } from 'node:crypto'
import type { FastifyPluginAsync } from 'fastify'
import type { Context } from '../../context'
import { assignedOf, reservePriceOf } from '@ph-dsp/types'
import { termStateAt } from '../../billing/term'
import { assignmentOf, biddingClosesAt, biddingOpensAt, effectivePartnerIds, findPosition, heldFor, unsellableReason, windowHoursOf, windowStartOf } from '../../domain/positions'
import { multiplierToSnapshot } from '../../domain/pricing'
import { checkAdvertiser, checkCampaign, checkFloor, checkTargeting } from '../../exchange/enforcement'
import { handOff } from '../../exchange/handoff'
import { auctionClaimed } from '../../exchange/scheduler'
import { HttpError, conflict, notFound, validationFailed } from '../../http/errors'
import { type ReservationRecord, TAKEN } from '../../repos/ReservationRepo'
import { partnerAdvertiser } from './campaigns'
import { isUniqueViolation } from '../../db/db'

interface Body { positionId?: unknown; windowStart?: unknown; campaignId?: unknown; advertiserId?: unknown; type?: unknown; bidCpm?: unknown }

export const reservationView = (r: ReservationRecord) => ({
  reservationId: r.id, status: r.status, clearingCpm: r.clearingCpm, currency: r.currency, reason: r.reason,
})

export const reservationRoutes = (ctx: Context): FastifyPluginAsync => async (app) => {
  app.post<{ Body: Body }>('/reservations', async (req, reply) => {
    const b = req.body ?? {}
    const partner = req.partner
    /* A DSP that isn't connected can't write at all (spec §7), whatever else is
       wrong with the body — disconnecting clears its seats, so validating the
       advertiser first would answer 400 instead of 409. */
    if (partner.status !== 'connected') throw conflict(`${partner.name} is not connected.`)
    const invalid: { field: string; reason: string }[] = []
    const seat = typeof b.advertiserId === 'string' ? partnerAdvertiser(partner, b.advertiserId) : null
    if (!seat) invalid.push({ field: 'advertiserId', reason: `Not an advertiser on ${partner.name}.` })
    if (b.type !== 'reserve' && b.type !== 'bid') invalid.push({ field: 'type', reason: 'reserve or bid.' })
    /* The bid, or the reservation price agreed through the DSP (Q11). */
    if (!(typeof b.bidCpm === 'number' && Number.isFinite(b.bidCpm) && b.bidCpm > 0)) invalid.push({ field: 'bidCpm', reason: b.type === 'reserve' ? 'The agreed reservation price (CPM) is required.' : 'A CPM greater than 0 is required to bid.' })
    /* The same ceiling a DSP's bid gets (auction.ts): a price no real
       campaign pays must not win a window and be billed. */
    else if (b.bidCpm > ctx.config.maxBidCpm) invalid.push({ field: 'bidCpm', reason: `At most ${ctx.config.maxBidCpm} CPM.` })
    const campaign = typeof b.campaignId === 'string' ? ctx.campaigns.getCampaign(b.campaignId) : null
    if (!campaign || campaign.partnerId !== partner.id || campaign.advertiserId !== b.advertiserId) invalid.push({ field: 'campaignId', reason: 'Not one of this advertiser’s campaigns.' })
    /* A position this caller can't use (another DSP's, or held for another advertiser) is unknown to it. */
    const p = typeof b.positionId === 'string' ? findPosition(ctx, b.positionId) : null
    const allowed = p ? effectivePartnerIds(ctx, p.def) : []
    const hidden = !p || (allowed !== null && !allowed.includes(partner.id)) || (assignmentOf(p.def) === 'reserved' && !!seat && !heldFor(p.def, seat.name))
    if (hidden) invalid.push({ field: 'positionId', reason: 'Unknown position.' })
    const start = typeof b.windowStart === 'string' ? new Date(b.windowStart) : null
    /* The start of one of this position's own windows: its billing unit
       long (OQ27), so a weekly slot's windows start on Mondays. */
    const hours = windowHoursOf(ctx, p)
    if (!start || Number.isNaN(start.getTime()) || windowStartOf(ctx, start, hours * 3_600_000).getTime() !== start.getTime()) invalid.push({ field: 'windowStart', reason: `The start of one of this position's ${hours}-hour play windows (UTC).` })
    if (invalid.length) throw validationFailed(invalid)

    const pos = p!
    const windowStart = start!.toISOString()
    const reservePrice = reservePriceOf(pos.displayType, pos.def)
    /* A reserve-price commitment is at least the posted reserve price
       (OQ52); it is booked at the reserve price itself, below. */
    if (b.type === 'reserve' && reservePrice !== null && (b.bidCpm as number) < reservePrice) {
      throw validationFailed([{ field: 'bidCpm', reason: `The reserve price for this position is ${reservePrice} ${ctx.company.get().currency} CPM; commit to at least that.` }])
    }
    const now = ctx.clock().getTime()
    /* A reservation is made in advance of the open auction (spec §5
       "Reserve price"), so only a bid waits for bidding to open. Both stop
       at the cutoff. */
    if (b.type === 'bid' && now < biddingOpensAt(ctx, start!).getTime()) throw conflict(`Bidding for that window opens at ${biddingOpensAt(ctx, start!).toISOString()}.`)
    if (now >= biddingClosesAt(ctx, start!).getTime() || auctionClaimed(ctx, windowStart)) throw conflict(`Bidding for that window closed at ${biddingClosesAt(ctx, start!).toISOString()}, when its auction ran.`)
    /* Unscored (or duration-less) slot: refused with the reason, never sold at 0 views. */
    const unsellable = unsellableReason(ctx, pos)
    if (unsellable) throw conflict(unsellable)
    if (!ctx.displays.summaryByDisplayType(pos.displayType.id).displays) throw conflict('The position has no displays in that window.')
    if (pos.def.salesLocked) throw conflict('This position is locked against new sales: its existing bookings continue, but no further window can be bid on or reserved.')
    const assignment = assignmentOf(pos.def)
    /* A deal's bidding is open only until auctionCloses and never once its term
       is locked (auctionOpenAt): a bid then would be left pending on a window
       the deal no longer sells. A reserve commitment on a deal is refused on
       the same terms: the term's rate is already decided. */
    const deal = assignment === 'deal' ? ctx.buyersLists.get(assignedOf(pos.def).buyersListId ?? '') : null
    const term = deal ? termStateAt(deal, windowStart) : null
    if (deal && term?.active && !term.auctionOpen) {
      throw conflict(term.locked ? `This private auction's term is locked to a winning bid (${deal.name}); its windows take no further bids.` : `Bidding on this private auction closed at ${deal.auctionCloses} (${deal.name}).`)
    }
    if (b.type === 'reserve' && assignment !== 'reserved' && reservePrice === null) throw conflict('Only a position held for this advertiser, or one with a reserve price, can be reserved; bid for it instead.')
    if (b.type === 'bid' && assignment === 'reserved') throw conflict('This position is held for this advertiser: reserve it instead of bidding.')
    const live = partner.mode === 'live'
    const taken = ctx.reservations.forWindow(pos.positionId, windowStart).filter((r) => !r.testMode && TAKEN.includes(r.status))
    if (live && taken.length) throw conflict(taken.some((r) => r.status === 'reserved') ? 'That window is reserved: it is held outside the open auction.' : 'That window is already sold.')
    const mine = ctx.reservations.forWindow(pos.positionId, windowStart).filter((r) => r.advertiserId === b.advertiserId && r.channel === 'api' && ['pending', 'reserved'].includes(r.status))
    if (mine.length) throw conflict('This advertiser already has a reservation or bid for that window.')

    /* Pre-auction enforcement, in the order a bid would fail. */
    const c = campaign!
    const refusal = (await checkCampaign(ctx, c.campaignId))
      ?? checkAdvertiser(ctx, pos, partner, seat!.name, seat!.domain ? [seat!.domain] : [], seat!.id, windowStart)
      ?? checkTargeting(pos, c.pricingType)
      /* A reserve-price booking is checked at the rate it is booked at:
         the reserve price never clears below the floor (OQ45). */
      ?? checkFloor(ctx, b.type === 'reserve' && reservePrice !== null ? reservePrice : (b.bidCpm as number), c.advertiserId)
    if (refusal) throw new HttpError(422, refusal.code, refusal.reason)

    const company = ctx.company.get()
    const reserved = b.type === 'reserve'
    /* Booked at the reserve price when the position has one (OQ52), else
       at the price agreed through the DSP (Q11). */
    const rate = reserved && reservePrice !== null ? reservePrice : (b.bidCpm as number)
    let r: ReservationRecord
    try {
      r = ctx.reservations.insert({
      id: `res_${randomUUID().slice(0, 12)}`, partnerId: partner.id, advertiserId: c.advertiserId ?? null, campaignId: c.campaignId, positionId: pos.positionId, windowStart,
      type: b.type as 'reserve' | 'bid', channel: 'api', bidCpm: b.bidCpm as number, currency: company.currency,
      /* A reservation is booked now at its rate; a bid waits for the auction. */
      status: reserved ? 'reserved' : 'pending', clearingCpm: reserved ? rate : null,
      reason: reserved && reservePrice !== null ? `Reserved at the reserve price (${rate} ${company.currency} CPM), outside the open auction.` : null,
      testMode: !live, pricingType: c.pricingType ?? null, handedOffAt: null,
      personalisedMultiplier: reserved ? multiplierToSnapshot(company, c.pricingType) : null,
      })
    } catch (e) {
      /* Two writes for one window racing past the checks above — from two
         API instances, or two requests interleaving at the awaits: the
         database lets exactly one through. Which check it failed decides
         the answer: one open bid per advertiser and window (migration
         0026), or one live sale per window (migration 0021). */
      if (!isUniqueViolation(e)) throw e
      const dup = ctx.reservations.forWindow(pos.positionId, windowStart).some((x) => x.advertiserId === b.advertiserId && x.channel === 'api' && ['pending', 'reserved'].includes(x.status))
      throw conflict(dup ? 'This advertiser already has a reservation or bid for that window.' : 'That window is already sold.')
    }
    /* On a two-period deal, a live commitment locks the term at that rate
       (first commitment or clear wins; lockWin is idempotent). If a clear
       locked it first, while this request awaited its checks, this booking
       is withdrawn rather than left outside the deal's locked rate. */
    if (reserved && live && deal?.auctionCloses && reservePrice !== null) {
      const locked = ctx.buyersLists.lockWin(deal.id, {
        cpm: rate, partnerId: partner.id, advertiserId: c.advertiserId ?? null, campaignId: c.campaignId,
        pricingType: c.pricingType ?? null, channel: 'api', lockedAt: ctx.clock().toISOString(), source: 'reserve',
      })
      if (!locked) {
        const why = `This private auction's term is locked to a winning bid (${deal.name}); its windows take no further bids.`
        ctx.reservations.update(r.id, { status: 'lost', reason: why })
        throw conflict(why)
      }
    }
    /* The window has left the open auction: any bid still waiting on it is
       told so now rather than left pending until the auction skips it. */
    if (reserved && live) {
      for (const x of ctx.reservations.forWindow(pos.positionId, windowStart)) {
        if (x.status === 'pending') ctx.reservations.update(x.id, { status: 'lost', reason: 'The window was reserved by another buyer; it is not auctioned.' })
      }
    }
    /* A reservation is booked now, so it is handed off now. */
    return reply.status(201).send(reservationView(reserved ? await handOff(ctx, r) : r))
  })

  app.get<{ Params: { id: string } }>('/reservations/:id', async (req) => {
    const r = ctx.reservations.get(req.params.id)
    if (!r || r.partnerId !== req.partner.id) throw notFound('Reservation not found.')
    return reservationView(r)
  })
}
