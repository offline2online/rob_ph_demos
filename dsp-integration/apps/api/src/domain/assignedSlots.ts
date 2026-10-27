/* The slots a deal is assigned to, as a person reads them. Live deals read these from the display types' saved slots;
   an archived deal keeps the list it held when it was archived (the end-of-flight job releases the slots first), so the
   Archived Deals page can still say which slots each deal was in. */
import { assignedOf } from '@ph-dsp/types'
import type { Context } from '../context'
import { positionIdOf } from './positions'
import { slotDetailOf, type SlotDetail } from './displayTypes'

export type AssignedSlot = SlotDetail & { positionId: string; label: string; displayTypeName: string }

/* Every slot assigned to each list, saved assignments only: what Finalise confirms and what a deal needs at least one of before it can be shared. */
export const assignedSlotsByList = async (ctx: Context) => {
  const out = new Map<string, AssignedSlot[]>()
  for (const t of await ctx.displayTypes.list()) {
    ;(t.phExtensions?.slots ?? []).forEach((s, i) => {
      for (const id of new Set(assignedOf(s).buyersListIds)) out.set(id, [...(out.get(id) ?? []), { positionId: positionIdOf(t.id, i + 1), label: `${t.name} — ${s.label || `slot ${i + 1}`}`, displayTypeName: t.name, ...slotDetailOf(t, i + 1) }])
    })
  }
  return out
}

