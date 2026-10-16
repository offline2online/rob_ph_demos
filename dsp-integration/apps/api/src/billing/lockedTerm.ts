/* Books a play window at the rate a private auction locked before the two-period model was retired (16 Oct 2026; term rules in ./term). Nothing locks a new deal any more; the exchange's auction calls this only for a legacy locked deal, in place of bidding, until its flight ends. */
import { randomUUID } from 'node:crypto'
import type { Context } from '../context'
import { TRANSACTING_CURRENCY } from '../domain/currency'
import { isUniqueViolation } from '../db/db'
import { type PositionRef } from '../domain/positions'
import { isTermLocked } from './term'
import { floorFor } from '../exchange/enforcement'
import { handOff } from '../exchange/handoff'
import { settlePending } from '../exchange/pending'
import type { PositionOutcome } from '../exchange/auction'
import type { ReservationRecord } from '../repos/ReservationRepo'
import type { BuyersList } from '@ph-dsp/types'

/* Books this window at a private auction's already-locked rate directly —
   no bidding, no fresh clearing — the same winning identity every window
   in the delivery term hands off to (spec "…dynamic VAC-d billing over the
   delivery term"). Still its own reservation, still billed on its own
   realised VAC-d for this window (billing.ts), always at the same
   clearingCpm. */
export async function bookLockedTermWindow(ctx: Context, p: PositionRef, start: string, list: BuyersList, out: PositionOutcome): Promise<PositionOutcome> {
  const win = list.lockedWin!
  /* The term is locked to its winner: any other bid for this window is told so, never left pending. */
  const company = await ctx.company.get()
  await settlePending(ctx, p.positionId, start, `The term is locked at ${win.cpm} ${TRANSACTING_CURRENCY} CPM to another bid (${list.name}); no other bid takes this window.`)
  /* Only a connected DSP can write (REQUIREMENTS §7): if the locked winner's
     DSP has since disconnected or failed its re-test, book nothing and hand
     nothing off; the window falls through to the default campaign. */
  const partner = await ctx.partners.get(win.partnerId)
  if (!partner || partner.status !== 'connected') {
    return { ...out, skipped: `Private auction: ${partner?.name ?? 'the locked DSP'} is not connected, so the locked window is not booked.` }
  }
  /* A deal's rate sits on top of the floor, never under it (OQ45, Rob,
     29 Sep 2026). A locked rate cleared the floor when it locked, but the
     floor can rise during the term, through the floor CPM, a multiplier or
     the advertiser's floor multiplier. A window whose locked rate is below
     the floor in force now is not sold. It falls through to the default
     campaign, as a deal that clears nothing always has, and is never
     booked below the floor. */
  const floor = await floorFor(ctx, win.advertiserId, { partner, position: p, buyersListId: list.id })
  if (win.cpm < floor) {
    return { ...out, skipped: `Private auction: the locked rate (${win.cpm}) is below the effective floor of ${floor} ${TRANSACTING_CURRENCY} CPM, so this window is not sold under ${list.name}.` }
  }
  /* A term locked by a reserve-price commitment (OQ52) is programmatic
     guaranteed: each window is booked as Reserved, the same as the window
     the buyer committed to. */
  const reserve = win.source === 'reserve'
  let r: ReservationRecord
  try {
    r = await ctx.reservations.insert({
    id: `res_${randomUUID().slice(0, 12)}`, partnerId: win.partnerId, advertiserId: win.advertiserId, campaignId: win.campaignId,
    positionId: p.positionId, windowStart: start, type: win.channel === 'openrtb' ? 'bid' : 'reserve', channel: win.channel,
    bidCpm: win.cpm, currency: TRANSACTING_CURRENCY, status: reserve ? 'reserved' : 'won', clearingCpm: win.cpm,
    reason: reserve ? `Reserved: booked at ${list.name}'s reserve-price commitment, no auction.` : `Private auction: booked at ${list.name}'s locked rate, no re-auction.`, testMode: false, pricingType: win.pricingType, handedOffAt: null,
    })
  } catch (e) {
    /* Another clearing booked this window first (migration 0021). */
    if (isUniqueViolation(e)) return { ...out, skipped: 'Already sold.' }
    throw e
  }
  await handOff(ctx, r)
  return { ...out, skipped: `Private auction: booked at ${list.name}'s locked rate (${win.cpm}), no re-auction.`, winner: { reservationId: r.id, partnerId: r.partnerId, advertiserId: r.advertiserId, clearingCpm: r.clearingCpm as number } }
}
