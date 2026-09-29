import type { Context } from '../context'

/* Marks every bid for the window still pending as lost, with the reason. */
export function settlePending(ctx: Context, positionId: string, start: string, reason: string) {
  for (const r of ctx.reservations.forWindow(positionId, start)) if (r.status === 'pending') ctx.reservations.update(r.id, { status: 'lost', reason })
}
