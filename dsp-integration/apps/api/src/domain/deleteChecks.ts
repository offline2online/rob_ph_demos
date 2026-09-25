/* Delete checks (spec "Deleting", §1, §2). Server-side: the dialog's
   "Delete is disabled" is enforced here too. */
import type { DeleteCheck } from '@ph-dsp/types'
import type { Context } from '../context'
import { TAKEN } from '../repos/ReservationRepo'
import { positionIdOf } from './positions'
import { zonesOf } from './displayTypes'

/* A display type can't be deleted while any display is assigned to it. */
export function displayTypeDeleteCheck(ctx: Context, id: string): DeleteCheck {
  const dependents = ctx.displays.listByDisplayType(id).map((d) => ({ kind: 'display' as const, name: d.name, detail: d.store }))
  return { canDelete: dependents.length === 0, dependents }
}

/* A playlist can't be deleted while it is a display type's default playlist
   or assigned to a zone: a display type or zone is never left without one. */
export function playlistDeleteCheck(ctx: Context, id: string): DeleteCheck {
  const dependents: DeleteCheck['dependents'] = []
  for (const t of ctx.displayTypes.list()) {
    if (t.defaultPlaylistId === id) dependents.push({ kind: 'display_type_default', name: t.name, detail: 'Default playlist' })
    for (const z of zonesOf(t)) if (z.playlistId === id) dependents.push({ kind: 'zone', name: t.name, detail: z.name })
  }
  return { canDelete: dependents.length === 0, dependents }
}

export const dependentDetails = (c: DeleteCheck) => c.dependents.map((d) => ({ field: d.kind, reason: d.detail ? `${d.name} · ${d.detail}` : d.name }))

/* Q47 default: don't block the delete; log how many of its advertiser
   positions are sold or reserved (live wins/reservations, Test-mode
   excluded — same definition as a "sold" window elsewhere, e.g.
   windowStatus in positions.ts). Counts positions, not reservation rows: an
   advertiser position booked across several play windows counts once. */
export function soldOrReservedPositions(ctx: Context, displayTypeId: string): number {
  const dt = ctx.displayTypes.get(displayTypeId)
  if (!dt) return 0
  const positionIds = new Set((dt.phExtensions?.slots ?? []).flatMap((s, i) => (s.owner === 'advertiser' ? [positionIdOf(displayTypeId, i + 1)] : [])))
  if (!positionIds.size) return 0
  const hit = new Set(ctx.reservations.byStatus(TAKEN).filter((r) => !r.testMode && positionIds.has(r.positionId)).map((r) => r.positionId))
  return hit.size
}
