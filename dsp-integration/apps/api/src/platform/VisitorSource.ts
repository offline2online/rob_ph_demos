/* The Live Visitor Profile project's Visitor API, as this build needs it (shared/interface-contract.md, "Visitor segments
   for a play"; ticket dmcbOIDGV3FnBQ66KYIb, 22 Oct 2026). Segment membership is Visitor Profile's data and the choice of
   version at play time is PH Core's; this build only states the shape both meet at, so a stand-in can be tested against
   it. Nothing in the exchange calls it: a booking hands PH Core the whole campaign and PH Core's player asks the visitor
   side which segments the person in front of the screen is in. */
import type { Awaitable } from '../db/db'

export interface VisitorSource {
  /* The Visitor Segments values the visitor is in now (the values of `visitor.visitor_segments`); empty when unknown. */
  segmentsFor(visitorId: string): Awaitable<string[]>
}

/* Stand-in: segments are pushed (the Visitor API's write side) and read back. */
export function memoryVisitorSource() {
  const segments = new Map<string, Set<string>>()
  const source: VisitorSource = { segmentsFor: (id) => [...(segments.get(id) ?? [])] }
  return { source, push: (visitorId: string, values: string[]) => segments.set(visitorId, new Set(values)) }
}
