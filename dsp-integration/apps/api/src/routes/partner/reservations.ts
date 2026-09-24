/* Reservations and bids for a play window (spec §6):
     POST /v1/reservations        reserve (a position named to this advertiser) or bid (CPM)
     GET  /v1/reservations/{id}   outcome
   Approved campaigns only; every pre-auction check applies here, and again
   when the auction clears the window. */
import { randomUUID } from 'node:crypto'
import type { FastifyPluginAsync } from 'fastify'
import type { Context } from '../../context'
import { assignmentOf, biddingClosesAt, biddingOpensAt, effectivePartnerIds, findPosition, heldFor, windowStartOf } from '../../domain/positions'
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
    if (!start || Number.isNaN(start.getTime()) || windowStartOf(ctx, start).getTime() !== start.getTime()) invalid.push({ field: 'windowStart', reason: `The start of a ${ctx.company.get().playWindowHours}-hour play window (UTC).` })
    if (invalid.length) throw validationFailed(invalid)

    const pos = p!
    const windowStart = start!.toISOString()
    const now = ctx.clock().getTime()
    if (now < biddingOpensAt(ctx, start!).getTime()) throw conflict(`Bidding for that window opens at ${biddingOpensAt(ctx, start!).toISOString()}.`)
    if (now >= biddingClosesAt(ctx, start!).getTime() || auctionClaimed(ctx, windowStart)) throw conflict(`Bidding for that window closed at ${biddingClosesAt(ctx, start!).toISOString()}, when its auction ran.`)
    if (partner.status !== 'connected') throw conflict(`${partner.name} is not connected.`)
    if (!ctx.displays.summaryByDisplayType(pos.displayType.id).displays) throw conflict('The position has no displays in that window.')
    const assignment = assignmentOf(pos.def)
    if (b.type === 'reserve' && assignment !== 'reserved') throw conflict('Only a position held for this advertiser can be reserved; bid for it instead.')
    if (b.type === 'bid' && assignment === 'reserved') throw conflict('This position is held for this advertiser: reserve it instead of bidding.')
    const live = partner.mode === 'live'
    const taken = ctx.reservations.forWindow(pos.positionId, windowStart).filter((r) => !r.testMode && TAKEN.includes(r.status))
    if (live && taken.length) throw conflict('That window is already sold.')
    const mine = ctx.reservations.forWindow(pos.positionId, windowStart).filter((r) => r.advertiserId === b.advertiserId && r.channel === 'api' && ['pending', 'reserved'].includes(r.status))
    if (mine.length) throw conflict('This advertiser already has a reservation or bid for that window.')

    /* Pre-auction enforcement, in the order a bid would fail. */
    const c = campaign!
    const refusal = (await checkCampaign(ctx, c.campaignId))
      ?? checkAdvertiser(ctx, pos, partner, seat!.name, seat!.domain ? [seat!.domain] : [], seat!.id)
      ?? checkTargeting(pos, c.pricingType)
      ?? checkFloor(ctx, b.bidCpm as number, c.pricingType, c.advertiserId)
    if (refusal) throw new HttpError(422, refusal.code, refusal.reason)

    const company = ctx.company.get()
    const reserved = b.type === 'reserve'
    let r: ReservationRecord
    try {
      r = ctx.reservations.insert({
      id: `res_${randomUUID().slice(0, 12)}`, partnerId: partner.id, advertiserId: c.advertiserId ?? null, campaignId: c.campaignId, positionId: pos.positionId, windowStart,
      type: b.type as 'reserve' | 'bid', channel: 'api', bidCpm: b.bidCpm as number, currency: company.currency,
      /* A reservation is booked at its agreed price (Q11); a bid waits for the auction. */
      status: reserved ? 'reserved' : 'pending', clearingCpm: reserved ? (b.bidCpm as number) : null, reason: null,
      testMode: !live, pricingType: c.pricingType ?? null, handedOffAt: null,
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
    /* A reservation is booked now, so it is handed off now. */
    return reply.status(201).send(reservationView(reserved ? await handOff(ctx, r) : r))
  })

  app.get<{ Params: { id: string } }>('/reservations/:id', async (req) => {
    const r = ctx.reservations.get(req.params.id)
    if (!r || r.partnerId !== req.partner.id) throw notFound('Reservation not found.')
    return reservationView(r)
  })
}
