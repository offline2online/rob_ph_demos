/* Books a play window at a private auction's already-locked rate (the
   two-period model's second half; the term rules are in ./term). The
   exchange's auction calls this for a locked deal in place of bidding. */
import { randomUUID } from 'node:crypto'
import type { Context } from '../context'
import { isUniqueViolation } from '../db/db'
import { type PositionRef, assignmentOf } from '../domain/positions'
import { isTermLocked } from './term'
import { floorFor } from '../exchange/enforcement'
import { handOff } from '../exchange/handoff'
import { settlePending } from '../exchange/pending'
import type { PositionOutcome } from '../exchange/auction'
import type { ReservationRecord } from '../repos/ReservationRepo'
import { assignedOf, type BuyersList } from '@ph-dsp/types'

/* Books this window at a private auction's already-locked rate directly —
   no bidding, no fresh clearing — the same winning identity every window
   in the delivery term hands off to (spec "…dynamic VAC-d billing over the
   delivery term"). Still its own reservation, still billed on its own
   realised VAC-d for this window (billing.ts), always at the same
   clearingCpm. */
export async function bookLockedTermWindow(ctx: Context, p: PositionRef, start: string, list: BuyersList, out: PositionOutcome): Promise<PositionOutcome> {
  const win = list.lockedWin!
  /* The term is locked to its winner: any other bid for this window is told so, never left pending. */
  settlePending(ctx, p.positionId, start, `The term is locked at ${win.cpm} ${ctx.company.get().currency} CPM to another bid (${list.name}); no other bid takes this window.`)
  /* Only a connected DSP can write (REQUIREMENTS §7): if the locked winner's
     DSP has since disconnected or failed its re-test, book nothing and hand
     nothing off; the window falls through to the default campaign. */
  const partner = ctx.partners.get(win.partnerId)
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
  const floor = floorFor(ctx, win.pricingType, win.advertiserId)
  if (win.cpm < floor) {
    return { ...out, skipped: `Private auction: the locked rate (${win.cpm}) is below the effective floor of ${floor} ${ctx.company.get().currency} CPM, so this window is not sold under ${list.name}.` }
  }
  /* A term locked by a reserve-price commitment (OQ52) is programmatic
     guaranteed: each window is booked as Reserved, the same as the window
     the buyer committed to. */
  const reserve = win.source === 'reserve'
  let r: ReservationRecord
  try {
    r = ctx.reservations.insert({
    id: `res_${randomUUID().slice(0, 12)}`, partnerId: win.partnerId, advertiserId: win.advertiserId, campaignId: win.campaignId,
    positionId: p.positionId, windowStart: start, type: win.channel === 'openrtb' ? 'bid' : 'reserve', channel: win.channel,
    bidCpm: win.cpm, currency: ctx.company.get().currency, status: reserve ? 'reserved' : 'won', clearingCpm: win.cpm,
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

/* This window's clear is the deal's ONE term-deciding auction the moment it
   has auctionCloses set and isn't locked yet: lock it now so every later
   window in the delivery term reuses this rate instead of re-auctioning
   (spec "…dynamic VAC-d billing over the delivery term"). A deal with no
   auctionCloses never reaches here locked, so it keeps clearing fresh every
   window as it always has. */
export function lockTermOnClear(ctx: Context, p: PositionRef, live: ReservationRecord): void {
  if (assignmentOf(p.def) !== 'deal') return
  const listId = assignedOf(p.def).buyersListId
  const list = listId ? ctx.buyersLists.get(listId) : null
  if (list?.auctionCloses && !isTermLocked(list)) {
    ctx.buyersLists.lockWin(list.id, {
      cpm: live.bidCpm as number, partnerId: live.partnerId, advertiserId: live.advertiserId, campaignId: live.campaignId as string,
      pricingType: live.pricingType, channel: live.channel, lockedAt: ctx.clock().toISOString(), source: 'auction',
    })
  }
}
