/* Stand-in for the "Booking schedule reach counts" dependency (interface
   contract "Live Visitor Profile ↔ Display Types & DSP Integration",
   §"Booking schedule reach counts", decision 22 Sep): how many displays of
   a display type, across the whole retail footprint, a set of localised
   targeting rules would match — the number that makes a part-sold position
   visible on the booking schedule (§6 REQUIREMENTS, open question 50).
   Point-in-time, as-of stamped; predicates in, counts out, never attribute
   values, per that contract's "Partner targeting permissions" principle.
   Personalisation Hub's real API for this isn't built yet — which system
   hosts it is itself still open in that contract — so this POC approximates
   the match fraction with the same "each AND group halves the audience"
   model AudienceSource.targetedShare already uses for §5's forecast
   endpoint (Q9), applied to a display count rather than a view count.
   Engineering swaps in the real client once the contract names a host. */
import type { Rules } from '../domain/targetingValidation'
import { POC_SHARE_PER_AND_GROUP } from './AudienceSource'

export interface ReachMatch {
  matchedDisplays: number
  asOf: string
}

export interface ReachCountSource {
  /* totalDisplays is the position's own display count (family 1 of the
     envelope: how many physical displays are registered against this
     display type). rules absent/empty means an untargeted (fallback)
     reach — every display matches. */
  matchOf(totalDisplays: number, rules: Rules | undefined): ReachMatch
}

export const pocReachCountSource = (clock: () => Date): ReachCountSource => ({
  matchOf(totalDisplays, rules) {
    const share = rules?.length ? POC_SHARE_PER_AND_GROUP ** rules.length : 1
    return { matchedDisplays: Math.round(totalDisplays * share), asOf: clock().toISOString() }
  },
})
