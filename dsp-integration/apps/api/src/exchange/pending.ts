/* Settling the API bids (POST /v1/reservations) a window's auction did not
   decide: they are marked lost, with the reason, so no bid is ever left
   pending for ever (stability review, 24 Sep 2026). Called by the auction
   when a position clears or fails, and by the scheduler's sweep for windows
   that started with no auction. */
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
