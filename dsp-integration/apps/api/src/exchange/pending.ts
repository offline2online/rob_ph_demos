import type { Context } from '../context'
import { tx } from '../db/db'

/* Marks every bid for the window still pending as lost, with the reason.
   One transaction: a bid placed while this runs is either settled with the
   rest or arrives after it, never half-way through. */
export async function settlePending(ctx: Context, positionId: string, start: string, reason: string) {
  await tx(ctx.db, async () => {
    for (const r of await ctx.reservations.forWindow(positionId, start)) if (r.status === 'pending') await ctx.reservations.update(r.id, { status: 'lost', reason })
  })
}
