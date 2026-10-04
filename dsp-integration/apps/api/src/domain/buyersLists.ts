/* Buyers list entitlement (spec "Support private auctions"): who is one of
   a deal's invited buyers, which DSPs that implies, and (in billing/term.ts) whether
   the deal is currently active. An invited buyer is a seat (advertiser)
   the DSP itself synced, picked from that DSP's seats — { partnerId, seatId }
   — so entitlement is an exact match on the identifier the DSP bids under;
   nothing is matched by name (ticket W8wjh2wtFTnHZUO0Exuu, Rob 4 Oct 2026).

   The two-period model (delivery term, auctionCloses, the locked rate) is
   judged in billing/term.ts, not here. */
import type { BuyersList } from '@ph-dsp/types'
import type { PartnerRecord } from '../repos/PartnerRepo'

/* Is this seat of this DSP one of the list's invited buyers? */
export function isInvitedBuyer(list: BuyersList, partnerId: string, seatId?: string | null): boolean {
  return !!seatId && list.invitedBuyers.some((b) => b.partnerId === partnerId && b.seatId === seatId)
}

/* Every partner with a synced seat among the list's invited buyers —
   the DSPs a deal's bid requests actually go to. */
export function invitedPartnerIds(list: BuyersList, partners: PartnerRecord[]): string[] {
  return partners.filter((p) => p.seats.some((seat) => isInvitedBuyer(list, p.id, seat.id))).map((p) => p.id)
}
