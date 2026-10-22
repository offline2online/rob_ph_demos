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
import { isRealtime, nextWindow, windowStartOf, type PositionRef } from '../domain/positions'
import type { ReservationRecord } from '../repos/ReservationRepo'
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
export async function rateOf(ctx: Context, list: BuyersList): Promise<number> {
  if (list.floorCpm != null) return list.floorCpm
  return list.termTotal != null ? equivalentCpmOf(list.termTotal, await termSlotsOf(ctx, list.id), termDaysOf(list.activeFrom, list.activeTo)) ?? 0 : 0
}

/* The advertiser's campaigns that may play on this position under the deal, in booking order. */
async function directDealCampaigns(ctx: Context, p: PositionRef, list: BuyersList, advertiserId: string) {
  const mine = (await ctx.campaigns.listCampaigns({ advertiserId })).filter((c) => (!c.dealId || c.dealId === list.dealId) && (!c.displayTypeId || c.displayTypeId === p.displayType.id))
  return [...mine.filter((c) => c.dealId === list.dealId), ...mine.filter((c) => !c.dealId)]
}

/* The bookings a finalised Direct advertiser deal holds on its slots before the exchange has written them (ticket TWJmiwQpPu9Y4tAUjncC,
   22 Oct 2026). The exchange books a deal's window one window ahead, but the deal reserves every window of its flight from the moment it is
   finalised, so the booking schedule, its revenue tables and plays per day read each unbooked window as the deal's booking: the advertiser,
   the campaign that will play (the first eligible, approved or not) and the deal's rate. Nothing is stored; `taken` keys (`position|windowStart`)
   are windows that already have a live row, which wins. Real-time and sales-locked positions are never booked ahead. */
export async function plannedDirectBookings(ctx: Context, positions: PositionRef[], lenOf: (p: PositionRef) => number, fromMs: number, toMs: number, taken: Set<string>): Promise<ReservationRecord[]> {
  const out: ReservationRecord[] = []
  const lists = new Map<string, BuyersList | null>()
  const rates = new Map<string, number>()
  const campaigns = new Map<string, Promise<{ campaignId: string; pricingType: string | null } | null>>()
  for (const p of positions) {
    if (isRealtime(p) || p.def.salesLocked) continue
    const ids = assignedOf(p.def).buyersListIds
    if (!ids.length) continue
    const deals: BuyersList[] = []
    for (const id of ids) {
      if (!lists.has(id)) lists.set(id, (await ctx.buyersLists.get(id)) ?? null)
      const l = lists.get(id)
      if (l && l.dealType === 'direct' && l.status === 'shared' && l.invitedBuyers[0]?.seatId) deals.push(l)
    }
    if (!deals.length) continue
    if (!(await ctx.displays.summaryByDisplayType(p.displayType.id)).displays) continue
    const len = lenOf(p)
    const firstSellable = (await nextWindow(ctx, len)).getTime()
    for (let t = Math.max(windowStartOf(new Date(fromMs), len).getTime(), firstSellable); t < toMs; t += len) {
      const start = new Date(t).toISOString()
      if (taken.has(`${p.positionId}|${start}`)) continue
      const list = deals.find((l) => isActiveAt(l, start))
      if (!list) continue
      const advertiserId = list.invitedBuyers[0].seatId as string
      if (!rates.has(list.id)) rates.set(list.id, await rateOf(ctx, list))
      const key = `${list.id}|${p.positionId}`
      if (!campaigns.has(key)) campaigns.set(key, directDealCampaigns(ctx, p, list, advertiserId).then((c) => (c[0] ? { campaignId: c[0].campaignId, pricingType: c[0].pricingType ?? null } : null)))
      const campaign = await campaigns.get(key) ?? null
      const rate = rates.get(list.id) as number
      out.push({
        id: `deal_${list.id}_${p.positionId}_${t}`, partnerId: DIRECT_PARTNER_ID, advertiserId, campaignId: campaign?.campaignId ?? null, positionId: p.positionId, windowStart: start,
        type: 'reserve', channel: 'api', bidCpm: rate, currency: TRANSACTING_CURRENCY, status: 'reserved', clearingCpm: rate,
        reason: `Reserved: ${list.name} (${list.dealId}), a Direct advertiser deal.`, testMode: false, pricingType: campaign?.pricingType ?? null, handedOffAt: null, dealType: 'guaranteed',
      })
    }
  }
  return out
}

export async function bookDirectDealWindow(ctx: Context, p: PositionRef, start: string, list: BuyersList, out: PositionOutcome): Promise<PositionOutcome> {
  await settlePending(ctx, p.positionId, start, `The slot is reserved for ${list.name}, a Direct advertiser deal; no other bid takes this window.`)
  const advertiserId = list.invitedBuyers[0]?.seatId
  if (!advertiserId) return { ...out, skipped: `Reserved for ${list.name}: the deal has no advertiser, so nothing is booked.` }
  const ordered = await directDealCampaigns(ctx, p, list, advertiserId)
  const rate = await rateOf(ctx, list)
  /* Why the last eligible campaign could not take the window, so the outcome names the real cause (E2E 21 Oct 2026: a failed hand-off read as "not approved"). */
  let notHanded: string | null = null
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
    if (!handed.handedOffAt) { notHanded = handed.reason?.replace(/^Not handed off: /, '') || 'no creative fits'; await ctx.reservations.update(r.id, { status: 'lost', reason: handed.reason }); continue }
    return { ...out, skipped: `Reserved for ${list.name}, a Direct advertiser deal: booked with no bid request.`, winner: { reservationId: r.id, partnerId: r.partnerId, advertiserId: r.advertiserId, clearingCpm: rate } }
  }
  return { ...out, skipped: notHanded
    ? `Reserved for ${list.name}, a Direct advertiser deal, but its advertiser's campaign could not be handed off (${notHanded}): the window falls to the default campaign.`
    : `Reserved for ${list.name}, a Direct advertiser deal, but none of the advertiser's campaigns is approved, activated and ready to play: the window falls to the default campaign.` }
}
