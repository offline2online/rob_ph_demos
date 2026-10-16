/* Reservations and bids for a play window (spec §6):
     POST /v1/reservations        reserve (a position named to this advertiser) or bid (CPM)
     GET  /v1/reservations/{id}   outcome
   Approved campaigns only; every pre-auction check applies here, and again
   when the auction clears the window.

   Reserving at a fixed price (reserve-price booking, open questions 45 and
   52) was removed on 17 Oct 2026: a slot now carries a floor CPM, not a
   reserve price, and a buyer who wants a window held at an agreed rate takes a
   Programmatic guaranteed (or preferred) deal, which carries its own rate.
   `type: reserve` is therefore taken only on a position held for this
   advertiser or assigned to a buyers list (deal); the rate is the price agreed
   through the DSP, which must clear the resolved floor (platform, slot, DSP,
   buyers list). The window is held as Reserved at once: a `reserved` row,
   which the auction never clears (the one-live-winner-per-window index,
   migration 0021, counts it), billed at that rate on the window's realised
   VAC-d (billing.ts).
   A reserve commitment no longer locks a private auction's term (the two-period model was retired on 16 Oct 2026). */
import { randomUUID } from 'node:crypto'
import type { FastifyPluginAsync } from 'fastify'
import type { Context } from '../../context'
import { TRANSACTING_CURRENCY } from '../../domain/currency'
import { assignedOf } from '@ph-dsp/types'
import { guaranteedImpressions, personalisedShare } from '../../domain/guarantee'
import { dspDealTerms } from '../../dsp/dealTerms'
import { termStateAt } from '../../billing/term'
import { assignmentOf, assumedViewsPerWindow, effectivePartnerIds, findPosition, heldFor, isRealtime, unsellableReason, windowHoursFor, windowMsFor, windowStartOf } from '../../domain/positions'
import { positionHourGroups, windowOpenFor } from '../../domain/operatingGate'
import { checkAdvertiser, checkCampaign, checkFloor, checkTargeting, checkVersionCount, firstRefusal } from '../../exchange/enforcement'
import { handOff } from '../../exchange/handoff'
import { auctionClaimed } from '../../exchange/scheduler'
import { HttpError, conflict, notFound, validationFailed } from '../../http/errors'
import { type ReservationRecord, TAKEN } from '../../repos/ReservationRepo'
import { partnerAdvertiser } from './campaigns'
import { isUniqueViolation, tx } from '../../db/db'

interface Body { positionId?: unknown; windowStart?: unknown; campaignId?: unknown; advertiserId?: unknown; type?: unknown; bidCpm?: unknown; dealType?: unknown }

export const reservationView = (r: ReservationRecord, provider?: string) => ({
  reservationId: r.id, status: r.status, clearingCpm: r.clearingCpm, currency: r.currency, reason: r.reason,
  /* Guaranteed deal path: preferred holds the price with no volume; guaranteed commits guaranteedImpressions, which the DSP is sent as its guaranteed unit count. */
  dealType: r.dealType ?? 'preferred', forecastImpressions: r.forecastImpressions ?? null, guaranteedImpressions: r.guaranteedImpressions ?? null,
  dspDeal: r.type === 'reserve' && provider ? dspDealTerms(provider, r.dealType ?? 'preferred', r.guaranteedImpressions ?? null) : null,
  /* Snapshotted when the window cleared (ErN9Q2Q1, 30 Sep): a personalised play bills at the clearing CPM times this. Null until then. */
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
    /* preferred (the default) is the existing no-volume reserve; guaranteed commits a volume and only makes sense on a reserve. */
    if (b.dealType !== undefined && b.dealType !== 'preferred' && b.dealType !== 'guaranteed') invalid.push({ field: 'dealType', reason: 'preferred or guaranteed.' })
    else if (b.dealType === 'guaranteed' && b.type !== 'reserve') invalid.push({ field: 'dealType', reason: 'Only a reserve can be guaranteed; a bid is not a commitment to a window.' })
    /* The bid, or the reservation price agreed through the DSP (Q11). */
    if (!(typeof b.bidCpm === 'number' && Number.isFinite(b.bidCpm) && b.bidCpm > 0)) invalid.push({ field: 'bidCpm', reason: b.type === 'reserve' ? 'The agreed rate (CPM) is required.' : 'A CPM greater than 0 is required to bid.' })
    /* The same ceiling a DSP's bid gets (auction.ts): a price no real
       campaign pays must not win a window and be billed. */
    else if (b.bidCpm > ctx.config.maxBidCpm) invalid.push({ field: 'bidCpm', reason: `At most ${ctx.config.maxBidCpm} CPM.` })
    const campaign = typeof b.campaignId === 'string' ? await ctx.campaigns.getCampaign(b.campaignId) : null
    if (!campaign || campaign.partnerId !== partner.id || campaign.advertiserId !== b.advertiserId) invalid.push({ field: 'campaignId', reason: 'Not one of this advertiser’s campaigns.' })
    /* A position this caller can't use (another DSP's, or held for another advertiser) is unknown to it. */
    const p = typeof b.positionId === 'string' ? await findPosition(ctx, b.positionId) : null
    const allowed = p ? await effectivePartnerIds(ctx, p.def) : []
    const hidden = !p || (allowed !== null && !allowed.includes(partner.id)) || (assignmentOf(p.def) === 'reserved' && !!seat && !heldFor(p.def, seat.name))
    if (hidden) invalid.push({ field: 'positionId', reason: 'Unknown position.' })
    const start = typeof b.windowStart === 'string' ? new Date(b.windowStart) : null
    /* The start of one of this position's own windows: its billing unit
       long (OQ27), so a weekly slot's windows start on Mondays. */
    const company = await ctx.company.get()
    const hours = windowHoursFor(p)
    if (!start || Number.isNaN(start.getTime()) || windowStartOf(start, hours * 3_600_000).getTime() !== start.getTime()) invalid.push({ field: 'windowStart', reason: `The start of one of this position's ${hours}-hour play windows (UTC).` })
    if (invalid.length) throw validationFailed(invalid)

    const pos = p!
    if (isRealtime(pos)) throw conflict('This position sells in real time, per impression: it takes no window bids or reservations.')
    const windowStart = start!.toISOString()
    const now = ctx.clock().getTime()
    const nowIso = new Date(now).toISOString()
    /* No company auction schedule any more (Rob, 8 Oct 2026): a window can be
       bid on or booked until it starts, or until its deal auction has been
       claimed; what governs a deal is its own dates, checked below. */
    if (now >= start!.getTime() || (await auctionClaimed(ctx, windowStart, pos.positionId))) throw conflict(`Bidding for that window closed: ${now >= start!.getTime() ? 'it has started' : 'its auction has run'}.`)
    /* Unscored (or duration-less) slot: refused with the reason, never sold at 0 views. */
    const unsellable = await unsellableReason(ctx, pos)
    if (unsellable) throw conflict(unsellable)
    if (!(await ctx.displays.summaryByDisplayType(pos.displayType.id)).displays) throw conflict('The position has no displays in that window.')
    if (!windowOpenFor(await positionHourGroups(ctx, pos), start!, windowMsFor(pos))) throw conflict('That window is outside the operating hours of every display on this position.')
    if (pos.def.salesLocked) throw conflict('This position is locked against new sales: its existing bookings continue, but no further window can be bid on or reserved.')
    const assignment = assignmentOf(pos.def)
    /* A deal takes bids on every window of its flight (16 Oct 2026); only a deal locked under the retired two-period model refuses them (auctionOpenAt): a bid then would be left pending on a window the deal books at its locked rate. */
    /* A waterfall (7 Oct 2026) takes bids while any tier's auction is open;
       the refusal names the top tier's. */
    const deals = assignment === 'deal' ? await Promise.all(assignedOf(pos.def).buyersListIds.map((id) => ctx.buyersLists.get(id))) : []
    const stillOpen = deals.some((d) => { const t = d ? termStateAt(d, windowStart, nowIso) : null; return !(d && t?.active && !t.auctionOpen) })
    /* The deal's delivery term (activeFrom/activeTo) gates what can be bid on or booked: a window outside every assigned list's term is not sold under the deal. */
    if (deals.length && !deals.some((d) => d && termStateAt(d, windowStart, nowIso).active)) throw conflict('That window is outside the delivery term of this private auction (activeFrom/activeTo); it is not sold under the deal.')
    const deal = deals[0] ?? null
    const term = deal ? termStateAt(deal, windowStart, nowIso) : null
    if (deal && term?.active && !term.auctionOpen && !stillOpen) {
      throw conflict(`This private auction's term is locked to a winning bid (${deal.name}); its windows take no further bids.`)
    }
    if (b.type === 'reserve' && assignment !== 'reserved' && assignment !== 'deal') throw conflict('Only a position held for this advertiser, or one assigned to a buyers list (a Programmatic guaranteed or preferred deal), can be reserved; reserving at a fixed price is handled by a deal. Bid for this position instead.')
    if (b.type === 'bid' && assignment === 'reserved') throw conflict('This position is held for this advertiser: reserve it instead of bidding.')
    const live = partner.mode === 'live'
    const forWindow = await ctx.reservations.forWindow(pos.positionId, windowStart)
    const taken = forWindow.filter((r) => !r.testMode && TAKEN.includes(r.status))
    if (live && taken.length) throw conflict(taken.some((r) => r.status === 'reserved') ? 'That window is reserved: it is held outside the open auction.' : 'That window is already sold.')
    const mine = forWindow.filter((r) => r.advertiserId === b.advertiserId && r.channel === 'api' && ['pending', 'reserved'].includes(r.status))
    if (mine.length) throw conflict('This advertiser already has a reservation or bid for that window.')

    /* Pre-auction enforcement, in the order a bid would fail. */
    const c = campaign!
    const refusal = await firstRefusal(
      () => checkCampaign(ctx, c.campaignId),
      () => checkAdvertiser(ctx, pos, partner, seat!.name, seat!.domain ? [seat!.domain] : [], seat!.id, windowStart),
      () => checkTargeting(pos, c.pricingType, b.type === 'reserve'),
      () => checkVersionCount(ctx, pos, c.campaignId),
      /* The rate is checked against the resolved floor (platform, slot, DSP, buyers list): a deal never clears below the slot floor. */
      () => checkFloor(ctx, b.bidCpm as number, c.advertiserId, { partner, position: pos }),
    )
    if (refusal) throw new HttpError(422, refusal.code, refusal.reason)

    const reserved = b.type === 'reserve'
    /* Guaranteed: the forecast for this window (plays x VAC-d, as billing realises it), less the retailer's contingency buffer. */
    /* On a position assigned to a buyers list the list's deal type is authoritative (7 Oct 2026): the reservation never
       sets it independently, so the two cannot disagree about whether volume is promised. A private auction books as preferred (no volume). */
    const listType = deal ? (deal.dealType === 'guaranteed' ? 'guaranteed' : 'preferred') : null
    if (reserved && listType && b.dealType !== undefined && b.dealType !== listType) {
      throw conflict(`${deal!.name} is a ${deal!.dealType === 'private_auction' ? 'private auction' : deal!.dealType} deal: its buyers list sets the deal type, so this reservation can only be ${listType}.`)
    }
    const dealType = reserved ? (listType ?? (b.dealType === 'guaranteed' ? 'guaranteed' : 'preferred')) : 'preferred'
    /* A personalised-targeted deal commits from the targeted assumed views, not the slot's whole VAC-d. */
    const forecast = dealType === 'guaranteed'
      ? Math.round((await assumedViewsPerWindow(ctx, pos)) * (await personalisedShare(c.targeting, (rules) => ctx.audience.targetedShare(pos.displayType.id, rules))))
      : null
    const committed = forecast === null ? null : guaranteedImpressions(forecast, company.guaranteeBufferPct)
    /* Booked at the price agreed through the DSP (Q11). */
    const rate = b.bidCpm as number
    /* The booking, the deal's lock and the settling of other bids are one
       transaction: written together or not at all. */
    const booked = await tx(ctx.db, async (): Promise<{ r: ReservationRecord }> => {
      let r: ReservationRecord
      try {
        r = await ctx.reservations.insert({
        id: `res_${randomUUID().slice(0, 12)}`, partnerId: partner.id, advertiserId: c.advertiserId ?? null, campaignId: c.campaignId, positionId: pos.positionId, windowStart,
        type: b.type as 'reserve' | 'bid', channel: 'api', bidCpm: b.bidCpm as number, currency: TRANSACTING_CURRENCY,
        /* A reservation is booked now at its rate; a bid waits for the auction. */
        status: reserved ? 'reserved' : 'pending', clearingCpm: reserved ? rate : null,
        reason: reserved ? `Reserved at the agreed rate (${rate} ${TRANSACTING_CURRENCY} CPM), outside the open auction.` : null,
        testMode: !live, pricingType: c.pricingType ?? null, handedOffAt: null,
        dealType, forecastImpressions: forecast, guaranteedImpressions: committed,
        })
      } catch (e) {
        /* Two writes for one window racing past the checks above — from two
           API instances, or two requests interleaving at the awaits: the
           database lets exactly one through. Which check it failed decides
           the answer: one open bid per advertiser and window (migration
           0026), or one live sale per window (migration 0021). */
        if (!isUniqueViolation(e)) throw e
        const dup = (await ctx.reservations.forWindow(pos.positionId, windowStart)).some((x) => x.advertiserId === b.advertiserId && x.channel === 'api' && ['pending', 'reserved'].includes(x.status))
        throw conflict(dup ? 'This advertiser already has a reservation or bid for that window.' : 'That window is already sold.')
      }
      /* The window has left the open auction: any bid still waiting on it is
         told so now rather than left pending until the auction skips it. */
      if (reserved && live) {
        for (const x of await ctx.reservations.forWindow(pos.positionId, windowStart)) {
          if (x.status === 'pending') await ctx.reservations.update(x.id, { status: 'lost', reason: 'The window was reserved by another buyer; it is not auctioned.' })
        }
      }
      return { r }
    })
    const r = booked.r
    /* A reservation is booked now, so it is handed off now. */
    return reply.status(201).send(reservationView(reserved ? await handOff(ctx, r) : r, partner.provider))
  })

  app.get<{ Params: { id: string } }>('/reservations/:id', async (req) => {
    const r = await ctx.reservations.get(req.params.id)
    if (!r || r.partnerId !== req.partner.id) throw notFound('Reservation not found.')
    return reservationView(r, req.partner.provider)
  })
}
