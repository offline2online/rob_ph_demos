/* Delete checks (spec "Deleting", §1, §2). Server-side: the dialog's
   "Delete is disabled" is enforced here too. */
import type { DeleteCheck } from '@ph-dsp/types'
import type { Context } from '../context'
import { TAKEN } from '../repos/ReservationRepo'
import { longestWindowMs, positionIdOf, windowEndOf } from './positions'
import { zonesOf } from './displayTypes'

/* A display type can't be deleted while any display is assigned to it, or
   while any of its positions is reserved or sold for a window that hasn't
   played yet (Q47). */
export function displayTypeDeleteCheck(ctx: Context, id: string): DeleteCheck {
  const dependents = [
    ...ctx.displays.listByDisplayType(id).map((d) => ({ kind: 'display' as const, name: d.name, detail: d.store })),
    ...liveCommitments(ctx, id),
  ]
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

/* How many of its advertiser positions are sold or reserved (live
   wins/reservations, Test-mode excluded — same definition as a "sold" window elsewhere, e.g.
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

/* Q47 (decision, Rob, 29 Sep 2026): a display type can't be deleted, and a
   playlist assigned to it can't be changed, while any of its advertiser
   positions is reserved or sold for a current or future (not yet played)
   window. Hard block, has_dependents; each blocking window is named so the
   refusal says what to wait for. Live bookings only (Test mode excluded),
   the same definition of "sold" as soldOrReservedPositions. */
export function liveCommitments(ctx: Context, displayTypeId: string): DeleteCheck['dependents'] {
  const dt = ctx.displayTypes.get(displayTypeId)
  if (!dt) return []
  const positionIds = new Set((dt.phExtensions?.slots ?? []).flatMap((s, i) => (s.owner === 'advertiser' ? [positionIdOf(displayTypeId, i + 1)] : [])))
  if (!positionIds.size) return []
  /* Not yet played: the window — its slot's own billing unit long (OQ27) — has not ended. */
  const from = new Date(ctx.clock().getTime() - longestWindowMs(ctx)).toISOString()
  return ctx.reservations.byStatus(TAKEN, from)
    .filter((r) => !r.testMode && positionIds.has(r.positionId) && windowEndOf(ctx, r) > ctx.clock().getTime())
    .map((r) => ({ kind: 'reservation' as const, name: r.positionId, detail: `window ${r.windowStart.slice(0, 10)} · ${r.status === 'won' ? 'sold' : 'reserved'}` }))
}

/* The display types a playlist is assigned to, as their default or a zone's. */
export const displayTypesUsingPlaylist = (ctx: Context, playlistId: string) =>
  ctx.displayTypes.list().filter((t) => t.defaultPlaylistId === playlistId || zonesOf(t).some((z) => z.playlistId === playlistId))
