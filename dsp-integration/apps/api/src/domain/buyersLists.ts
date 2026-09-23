/* Buyers list entitlement (spec "Support private auctions"): who is one of
   a deal's invited buyers, which DSPs that implies, and whether the deal is
   currently active. Matching is automatic for brandEntity (the advertiser's
   name, same case-insensitive match as the existing advertiser lists) and
   dspSeatId (a DSP's own seat ID); "other" is recorded on the list but has
   no automated match in this POC — see InvitedBuyer in the API contract.

   Two-period model (spec "Private auctions: two-period model" and
   "…dynamic VAC-d billing over the delivery term", 23 Sep 2026):
   activeFrom/activeTo is the deal's DELIVERY TERM — the span being awarded
   — unchanged from before. auctionCloses is a second, narrower period: the
   deal's own one-time bidding deadline. A deal with no auctionCloses set
   behaves exactly as it always has (a real auction, cleared fresh every
   play window, for as long as the delivery term covers it). Once
   auctionCloses is set and a bid clears within it, the winning CPM locks
   (lockedWin) for the rest of the delivery term: every later play window
   is booked directly at that rate, at that winner's realised VAC-d, with
   no re-auction (exchange/auction.ts). */
import type { BuyersList } from '@ph-dsp/types'
import type { PartnerRecord } from '../repos/PartnerRepo'

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

/* Is this specific seat (by name and/or DSP seat ID) one of the list's invited buyers? */
export function isInvitedBuyer(list: BuyersList, name: string, seatId?: string | null): boolean {
  return list.invitedBuyers.some((b) => {
    if (b.identifierType === 'brandEntity') return same(b.value, name)
    if (b.identifierType === 'dspSeatId') return !!seatId && b.value === seatId
    return false
  })
}

/* Every partner with a seat matching one of the list's invited buyers —
   the DSPs a deal's bid requests actually go to. */
export function invitedPartnerIds(list: BuyersList, partners: PartnerRecord[]): string[] {
  const ids = new Set<string>()
  for (const p of partners) for (const seat of p.seats) if (isInvitedBuyer(list, seat.name, seat.id)) ids.add(p.id)
  return [...ids]
}

/* Whether the deal's delivery term (activeFrom/activeTo) covers `at`
   (inclusive; no bound = open-ended). */
export function isActiveAt(list: BuyersList, at: string): boolean {
  const t = Date.parse(at)
  if (list.activeFrom && t < Date.parse(list.activeFrom)) return false
  if (list.activeTo && t > Date.parse(list.activeTo)) return false
  return true
}

/* True once a winning bid has locked this deal's rate for the rest of its
   delivery term — every later play window is booked at lockedWin.cpm
   without a fresh auction (spec "…dynamic VAC-d billing over the delivery
   term"). */
export const isTermLocked = (list: BuyersList): boolean => list.lockedWin !== null

/* True while this deal's one-time term auction can still take bids: no
   auctionCloses set (the deal isn't using the two-period model, and clears
   fresh every window as it always has), or the deadline hasn't passed yet
   — and the term isn't locked already. Once auctionCloses passes with
   nothing having cleared, the deal stops soliciting bids for the rest of
   this delivery term: it never got a rate to hold, the same "falls
   through, no reserve floor ever crossed" outcome as an expired delivery
   term. */
export function auctionOpenAt(list: BuyersList, at: string): boolean {
  if (isTermLocked(list)) return false
  return !list.auctionCloses || Date.parse(at) <= Date.parse(list.auctionCloses)
}
