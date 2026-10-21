/* A programmatic guaranteed deal's committed plays are derived, never typed (Rob, 21 Oct 2026): the forecast plays of every
   slot assigned to it over its whole delivery term, less the guarantee buffer. Anything that changes the slots, the term or the
   buffer changes the figure, so the routes that make those changes recompute it here and store the result on the deal
   (BuyersListRepo.setCommittedPlays), where the deal sheet, the DSP payload and delivery read it. */
import type { BuyersList } from '@ph-dsp/types'
import type { Context } from '../context'
import { committedPlaysOf, termDaysOf, termSlotsOf } from './termPrice'

type TermOf = Pick<BuyersList, 'id' | 'dealType' | 'activeFrom' | 'activeTo'>

/* Null for any deal that is not guaranteed, has no slot yet, or has an open-ended term. */
export async function derivedCommittedPlays(ctx: Context, list: TermOf): Promise<number | null> {
  if (list.dealType !== 'guaranteed') return null
  return committedPlaysOf(await termSlotsOf(ctx, list.id), termDaysOf(list.activeFrom, list.activeTo), (await ctx.company.get()).guaranteeBufferPct)
}

/* Stores the derived figure on each deal whose slots just changed; a shared deal whose figure moved is versioned and asks its buyers to accept again. */
export async function refreshCommittedPlays(ctx: Context, listIds: Iterable<string>, by?: string): Promise<void> {
  for (const id of new Set(listIds)) {
    const list = await ctx.buyersLists.get(id)
    if (!list || list.dealType !== 'guaranteed') continue
    await ctx.buyersLists.setCommittedPlays(id, await derivedCommittedPlays(ctx, list), by)
  }
}

/* The deals a slot save adds a slot to or takes one from: `before` and `after` are the buyers list ids assigned to one slot. */
export const changedAssignments = (before: Iterable<string>, after: Iterable<string>): string[] => {
  const was = new Set(before), now = new Set(after)
  return [...new Set([...was, ...now])].filter((id) => was.has(id) !== now.has(id))
}
