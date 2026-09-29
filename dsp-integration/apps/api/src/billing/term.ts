/* The two-period model's delivery-term rules, in one place (spec "Private
   auctions: two-period model" and "…dynamic VAC-d billing over the
   delivery term", 23 Sep 2026). Pure predicates over a deal (BuyersList):
   no context, no database, no imports beyond types, so the domain and the
   routes can use them without pulling in the rest of the billing module.

   activeFrom/activeTo is the deal's DELIVERY TERM: the span being awarded.
   auctionCloses is a second, narrower period: the deal's own one-time
   bidding deadline. A deal with no auctionCloses set behaves exactly as it
   always has (a real auction, cleared fresh every play window, for as long
   as the delivery term covers it). Once auctionCloses is set and a bid
   clears within it, the winning CPM locks (lockedWin) for the rest of the
   delivery term: every later play window is booked directly at that rate
   (billing/lockedTerm.ts), at that winner's realised VAC-d, with no
   re-auction. */
import type { BuyersList } from '@ph-dsp/types'

/* Whether the deal's delivery term (activeFrom/activeTo) covers `at`
   (inclusive; no bound = open-ended). */
export function isActiveAt(list: Pick<BuyersList, 'activeFrom' | 'activeTo'>, at: string): boolean {
  const t = Date.parse(at)
  if (list.activeFrom && t < Date.parse(list.activeFrom)) return false
  if (list.activeTo && t > Date.parse(list.activeTo)) return false
  return true
}

/* True once a winning bid has locked this deal's rate for the rest of its
   delivery term — every later play window is booked at lockedWin.cpm
   without a fresh auction. */
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

export interface TermState { active: boolean; locked: boolean; auctionOpen: boolean }

/* Everything the exchange asks about a deal for one window start, at once. */
export const termStateAt = (list: BuyersList, at: string): TermState => ({ active: isActiveAt(list, at), locked: isTermLocked(list), auctionOpen: auctionOpenAt(list, at) })

/* The delivery term of a deal whose rate is locked; null while it is not.
   Every window in it is spoken for: the exchange books each directly at the
   locked rate and takes no other bid for it. */
export const lockedTermSpan = (list: BuyersList): { activeFrom: string | null; activeTo: string | null } | null =>
  isTermLocked(list) ? { activeFrom: list.activeFrom, activeTo: list.activeTo } : null
