/* Slot lock (ticket "Lock playlist slot against new sales when slots are
   sold", 30 Sep 2026). A sold slot can't lose its advertiser; the admin can
   instead lock it against new sales. The lock is per slot (position), as
   shown in Available Inventory, and releases by itself once the booking
   schedule has no live booking left on it. The release reads bookings only
   (reserved or won windows that have not finished playing, Test mode
   excluded — the same definition of "sold" as the Q47 delete blocks), never
   campaign playback or delivery analytics. */
import type { Context } from '../context'
import { liveCommitments } from './deleteChecks'
import { positionIdOf, windowEnds } from './positions'
import { tx } from '../db/db'
import { TAKEN } from '../repos/ReservationRepo'

/* The live bookings on one slot (1-based, flat across zones), as delete-check
   dependents so a refusal can name each window. */
export const slotLiveBookings = (ctx: Context, displayTypeId: string, slot: number) => liveCommitments(ctx, displayTypeId, slot)

/* When the last live booking on the slot finishes playing; null if none. */
export async function slotBookedUntil(ctx: Context, displayTypeId: string, slot: number): Promise<string | null> {
  const positionId = positionIdOf(displayTypeId, slot)
  const now = ctx.clock().getTime()
  const endOf = await windowEnds(ctx)
  const ends = (await ctx.reservations.byStatus(TAKEN, new Date(now - 366 * 24 * 3_600_000).toISOString()))
    .filter((r) => !r.testMode && r.positionId === positionId)
    .map(endOf)
    .filter((end) => end > now)
  return ends.length ? new Date(Math.max(...ends)).toISOString() : null
}

/* Clears the lock on every slot with no live booking left. Returns how many
   were released. Cheap when nothing is locked: it only walks the display
   types' slot lists. Each display type's read-check-write is one
   transaction, so an admin save in between can't be overwritten. */
export async function releaseSettledSlotLocks(ctx: Context): Promise<number> {
  let released = 0
  for (const listed of await ctx.displayTypes.list()) {
    if (!listed.phExtensions?.slots?.some((s) => s.salesLocked)) continue
    released += await tx(ctx.db, async () => {
      const dt = await ctx.displayTypes.get(listed.id)
      const slots = dt?.phExtensions?.slots
      if (!dt || !slots?.some((s) => s.salesLocked)) return 0
      let n = 0
      const next = []
      for (const [i, s] of slots.entries()) {
        if (!s.salesLocked || (await slotLiveBookings(ctx, dt.id, i + 1)).length) {
          next.push(s)
          continue
        }
        n++
        const { salesLocked: _released, ...rest } = s
        next.push(rest)
      }
      if (n) await ctx.displayTypes.saveExtensions(dt.id, { ...dt.phExtensions!, slots: next })
      return n
    })
  }
  return released
}
