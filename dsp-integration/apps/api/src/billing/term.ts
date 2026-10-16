/* A deal's delivery-term rules, in one place. Pure predicates over a deal
   (BuyersList): no context, no database, no imports beyond types.

   activeFrom/activeTo is the deal's flight: the span it sells in. A private
   auction takes bids on each slot throughout it (first price, against the
   deal's CPM floor) and clears fresh every play window. The two-period
   model (a one-time auctionCloses deadline and a rate locked to its winner)
   was retired on 16 Oct 2026 to match the industry-standard private auction.
   Only a deal locked before then still carries a lockedWin: every later
   window in its flight is booked directly at that rate
   (billing/lockedTerm.ts) until the flight ends. auctionCloses is kept as a
   record on such a deal and is otherwise inert. */
import type { BuyersList } from '@ph-dsp/types'

/* Whether the deal's delivery term (activeFrom/activeTo) covers `at`
   (inclusive; no bound = open-ended). */
export function isActiveAt(list: Pick<BuyersList, 'activeFrom' | 'activeTo'>, at: string): boolean {
  const t = Date.parse(at)
  if (list.activeFrom && t < Date.parse(list.activeFrom)) return false
  if (list.activeTo && t > Date.parse(list.activeTo)) return false
  return true
}

/* True for a deal locked before the two-period model was retired: every later play window in its flight is booked at lockedWin.cpm without a fresh auction. Nothing writes a new lock. */
export const isTermLocked = (list: BuyersList): boolean => list.lockedWin !== null

/* True while the deal still takes bids: not once a legacy rate lock holds its flight. There is no bidding deadline any more. */
export function auctionOpenAt(list: BuyersList, _at: string): boolean {
  return !isTermLocked(list)
}

export interface TermState { active: boolean; locked: boolean; auctionOpen: boolean }

/* Everything the exchange asks about a deal for one window start, at once.
   `at` is the window start (the delivery term is read there); `now`, when
   given, is the moment bidding is judged against auctionCloses (the route
   takes bids until the deadline passes in real time). Without it the window
   start stands in for it, as the scheduler's one-window-ahead clearing does. */
export const termStateAt = (list: BuyersList, at: string, now: string = at): TermState => ({ active: isActiveAt(list, at), locked: isTermLocked(list), auctionOpen: auctionOpenAt(list, now) })

/* The delivery term of a deal whose rate is locked; null while it is not.
   Every window in it is spoken for: the exchange books each directly at the
   locked rate and takes no other bid for it. */
export const lockedTermSpan = (list: BuyersList): { activeFrom: string | null; activeTo: string | null } | null =>
  isTermLocked(list) ? { activeFrom: list.activeFrom, activeTo: list.activeTo } : null
