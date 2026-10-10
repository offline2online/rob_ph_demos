/* Buyers list entitlement (spec "Support private auctions"): who is one of
   a deal's invited buyers, which DSPs that implies, and (in billing/term.ts) whether
   the deal is currently active. An invited buyer is a seat (advertiser)
   the DSP itself synced, picked from that DSP's seats — { partnerId, seatId }
   — so entitlement is an exact match on the identifier the DSP bids under;
   nothing is matched by name (ticket W8wjh2wtFTnHZUO0Exuu, Rob 4 Oct 2026).
   A list may also invite whole IAB categories; those resolve live (below).

   The two-period model (delivery term, auctionCloses, the locked rate) is
   judged in billing/term.ts, not here. */
import type { BuyersList } from '@ph-dsp/types'
import type { PartnerRecord } from '../repos/PartnerRepo'
import { isActiveAt } from '../billing/term'

/* Is this seat of this DSP one of the list's invited buyers? */
export function isInvitedBuyer(list: BuyersList, partner: Pick<PartnerRecord, 'id' | 'seats'>, seatId?: string | null): boolean {
  if (!seatId) return false
  if (list.invitedBuyers.some((b) => b.partnerId === partner.id && b.seatId === seatId)) return true
  /* Invited by IAB category (Rob, 7 Oct 2026): resolved live against the seat's DSP-reported category, so a seat the DSP re-categorises, or a new one it syncs, moves in or out of the deal with no edit. A category no seat reports admits nobody. */
  if (!list.invitedCategories.length) return false
  const category = partner.seats.find((s) => s.id === seatId)?.category
  return !!category && list.invitedCategories.includes(category)
}

/* Every partner with a synced seat among the list's invited buyers —
   the DSPs a deal's bid requests actually go to. */
export function invitedPartnerIds(list: BuyersList, partners: PartnerRecord[]): string[] {
  return partners.filter((p) => p.seats.some((seat) => isInvitedBuyer(list, p, seat.id))).map((p) => p.id)
}

/* Deals an advertiser is an invited buyer on (ticket T0gLfo2zDrRXPVGcvEoL): the
   lists whose invited buyers include any of the advertiser's mapped
   { partnerId, seatId }, matched exactly, whose delivery term covers `at`.
   A direct advertiser maps no seats and so resolves to none. Category
   invitations are deliberately not counted: only a mapped seat is matched. */
export function dealsForSeats(lists: BuyersList[], seats: { partnerId: string; seatId: string }[], at: string): BuyersList[] {
  if (!seats.length) return []
  return lists.filter((l) => isActiveAt(l, at) && l.invitedBuyers.some((b) => seats.some((s) => s.partnerId === b.partnerId && s.seatId === b.seatId)))
}
