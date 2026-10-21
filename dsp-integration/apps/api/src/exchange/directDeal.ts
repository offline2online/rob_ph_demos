/* A finalised Direct advertiser deal reserves its slot for its whole flight (ticket OMwDvy3OUmY9raBtTf7v, 22 Oct 2026),
   like Programmatic guaranteed but with no DSP: no bid request goes out, no other deal or the open auction can take the
   window (reserving deals never overlap on a slot, domain/reservingDeals.ts), and the advertiser's approved campaigns are
   handed to the campaign system for it. The window reads Reserved in availability (domain/positions.ts windowStatus).

   The campaign system plays one campaign per slot and window (migration 0021), so the exchange books the first
   eligible campaign: one tied to this deal's PH deal ID, then one with no deal ID, each in the order they were created.
   Priorities among a campaign's personalised and localised versions are the campaign system's own; the booking is
   personalised-eligible, as in any reserve booking. */
import { randomUUID } from 'node:crypto'
import { DIRECT_PARTNER_ID, assignedOf, type BuyersList } from '@ph-dsp/types'
import type { Context } from '../context'
import { isUniqueViolation } from '../db/db'
import { TRANSACTING_CURRENCY } from '../domain/currency'
import { isActiveAt } from '../billing/term'
import { equivalentCpmOf, termDaysOf, termSlotsOf } from '../domain/termPrice'
import type { PositionRef } from '../domain/positions'
import type { PositionOutcome } from './auction'
import { checkCampaign, checkTargeting } from './enforcement'
import { handOff } from './handoff'
import { settlePending } from './pending'

/* The finalised Direct advertiser deal on this position that covers the window, if any. */
export async function directDealAt(ctx: Context, p: PositionRef, start: string): Promise<BuyersList | null> {
  for (const id of assignedOf(p.def).buyersListIds) {
    const list = await ctx.buyersLists.get(id)
    if (list?.dealType === 'direct' && list.status === 'shared' && isActiveAt(list, start)) return list
  }
  return null
}

/* The deal's price per thousand views: its fixed CPM, or the equivalent CPM of its total for the term over the slots it is on. */
async function rateOf(ctx: Context, list: BuyersList): Promise<number> {
  if (list.floorCpm != null) return list.floorCpm
  return list.termTotal != null ? equivalentCpmOf(list.termTotal, await termSlotsOf(ctx, list.id), termDaysOf(list.activeFrom, list.activeTo)) ?? 0 : 0
}

export async function bookDirectDealWindow(ctx: Context, p: PositionRef, start: string, list: BuyersList, out: PositionOutcome): Promise<PositionOutcome> {
  await settlePending(ctx, p.positionId, start, `The slot is reserved for ${list.name}, a Direct advertiser deal; no other bid takes this window.`)
  const advertiserId = list.invitedBuyers[0]?.seatId
  if (!advertiserId) return { ...out, skipped: `Reserved for ${list.name}: the deal has no advertiser, so nothing is booked.` }
  const mine = (await ctx.campaigns.listCampaigns({ advertiserId })).filter((c) => (!c.dealId || c.dealId === list.dealId) && (!c.displayTypeId || c.displayTypeId === p.displayType.id))
  const ordered = [...mine.filter((c) => c.dealId === list.dealId), ...mine.filter((c) => !c.dealId)]
  const rate = await rateOf(ctx, list)
  for (const c of ordered) {
    if (await checkCampaign(ctx, c.campaignId)) continue
    if (checkTargeting(p, c.pricingType, true)) continue
    let r
    try {
      r = await ctx.reservations.insert({
        id: `res_${randomUUID().slice(0, 12)}`, partnerId: DIRECT_PARTNER_ID, advertiserId, campaignId: c.campaignId, positionId: p.positionId, windowStart: start,
        type: 'reserve', channel: 'api', bidCpm: rate, currency: TRANSACTING_CURRENCY, status: 'reserved', clearingCpm: rate,
        reason: `Reserved: ${list.name} (${list.dealId}), a Direct advertiser deal, booked for its whole flight with no auction.`, testMode: false, pricingType: c.pricingType ?? null, handedOffAt: null,
        dealType: 'guaranteed',
      })
    } catch (e) {
      if (isUniqueViolation(e)) return { ...out, skipped: 'Already sold.' }
      throw e
    }
    const handed = await handOff(ctx, r)
    /* Not handed off (no creative, doesn't fit): release the window so the next campaign can take it. */
    if (!handed.handedOffAt) { await ctx.reservations.update(r.id, { status: 'lost', reason: handed.reason }); continue }
    return { ...out, skipped: `Reserved for ${list.name}, a Direct advertiser deal: booked with no bid request.`, winner: { reservationId: r.id, partnerId: r.partnerId, advertiserId: r.advertiserId, clearingCpm: rate } }
  }
  return { ...out, skipped: `Reserved for ${list.name}, a Direct advertiser deal, but none of the advertiser's campaigns is approved, activated and ready to play: the window falls to the default campaign.` }
}
