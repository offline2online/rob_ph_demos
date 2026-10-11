/* Buyers list term versioning (ticket KcqiJpzR5RXy4TWODYlG): the deal ID and type are fixed; the mutable terms below are versioned. A change to the floor, committed plays, delivery term or auction window leaves buyers who had accepted on their older version (they must accept again); inviting or removing a buyer versions the deal without forcing it. */
import type { InvitedBuyer, TermChange } from '@ph-dsp/types'

export interface TermFields { floorCpm: number | null; committedPlays: number | null; activeFrom: string | null; activeTo: string | null; auctionCloses: string | null; invitedBuyers: InvitedBuyer[]; invitedCategories: string[] }

const REACCEPT = new Set(['floorCpm', 'committedPlays', 'activeFrom', 'activeTo', 'auctionCloses'])
/* The same instant written two ways ("…Z" vs "….000Z") is not a change. */
const instant = (v: string | null) => (v && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : v)
const buyerKeys = (b: InvitedBuyer[]) => b.map((x) => `${x.partnerId}\u0000${x.seatId}`).sort()

export function termChanges(before: TermFields, after: TermFields): TermChange[] {
  const out: TermChange[] = []
  const add = (field: TermChange['field'], from: unknown, to: unknown) => out.push({ field, from, to, requiresReacceptance: REACCEPT.has(field) })
  if ((before.floorCpm ?? null) !== (after.floorCpm ?? null)) add('floorCpm', before.floorCpm ?? null, after.floorCpm ?? null)
  if ((before.committedPlays ?? null) !== (after.committedPlays ?? null)) add('committedPlays', before.committedPlays ?? null, after.committedPlays ?? null)
  if (instant(before.activeFrom) !== instant(after.activeFrom)) add('activeFrom', before.activeFrom, after.activeFrom)
  if (instant(before.activeTo) !== instant(after.activeTo)) add('activeTo', before.activeTo, after.activeTo)
  if (instant(before.auctionCloses) !== instant(after.auctionCloses)) add('auctionCloses', before.auctionCloses, after.auctionCloses)
  if (JSON.stringify(buyerKeys(before.invitedBuyers)) !== JSON.stringify(buyerKeys(after.invitedBuyers))) add('invitedBuyers', before.invitedBuyers, after.invitedBuyers)
  if (JSON.stringify([...before.invitedCategories].sort()) !== JSON.stringify([...after.invitedCategories].sort())) add('invitedCategories', before.invitedCategories, after.invitedCategories)
  return out
}

export const needsReacceptance = (changes: TermChange[]) => changes.some((c) => c.requiresReacceptance)
