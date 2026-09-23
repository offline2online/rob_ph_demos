/* Buyers list entitlement (spec "Support private auctions"): who is one of
   a deal's invited buyers, which DSPs that implies, and whether the deal is
   currently active. Matching is automatic for brandEntity (the advertiser's
   name, same case-insensitive match as the existing advertiser lists) and
   dspSeatId (a DSP's own seat ID); "other" is recorded on the list but has
   no automated match in this POC — see InvitedBuyer in the API contract. */
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

/* Whether the deal's active window covers `at` (inclusive; no bound = open-ended). */
export function isActiveAt(list: BuyersList, at: string): boolean {
  const t = Date.parse(at)
  if (list.activeFrom && t < Date.parse(list.activeFrom)) return false
  if (list.activeTo && t > Date.parse(list.activeTo)) return false
  return true
}
