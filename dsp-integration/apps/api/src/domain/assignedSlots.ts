/* The slots a deal is assigned to, as a person reads them. Live deals read these from the display types' saved slots;
   an archived deal keeps the list it held when it was archived (the end-of-flight job releases the slots first), so the
   Archived Deals page can still say which slots each deal was in. */
import { assignedOf, billingUnitHoursOf, maxPlayLengthSecOf } from '@ph-dsp/types'
import type { Context } from '../context'
import { positionIdOf } from './positions'
import { playsPerWindowOpenOf, vacdPerPlayFor } from './plays'
import { audienceOf, slotDetailOf, zonesOf, type SlotDetail } from './displayTypes'
import { openHoursPerDayOf, positionHourGroups } from './operatingGate'
import { rotationSizeOf } from './slots'

/* What the Slots and Details hovers read of a slot, kept with the slot (ticket TeKdyE4cSeb9EQ9LIJeX, 27 Oct 2026): once an archived
   deal is released its slots no longer resolve to Available Inventory rows, so the hovers would lose all of this. */
export interface SlotHoverDetail { position: string; playlistName: string; orientation: 'landscape' | 'portrait'; displayCount: number; playsPerWindow: number; windowHours: number; vacdPerPlay: number | null }
export type AssignedSlot = SlotDetail & Partial<SlotHoverDetail> & { positionId: string; label: string; displayTypeName: string }

/* Every slot assigned to each list, saved assignments only: what Finalise confirms and what a deal needs at least one of before it can be shared. */
export const assignedSlotsByList = async (ctx: Context) => {
  const out = new Map<string, AssignedSlot[]>()
  const maxPlay = (await ctx.company.get()).maxPlayLengthSec
  for (const t of await ctx.displayTypes.list()) {
    const slots = t.phExtensions?.slots ?? []
    if (!slots.some((s) => assignedOf(s).buyersListIds.length)) continue
    const zones = zonesOf(t)
    const displayCount = (await ctx.displays.summaryByDisplayType(t.id)).displays
    const openHours = openHoursPerDayOf(await positionHourGroups(ctx, { displayType: t }))
    for (const [i, s] of slots.entries()) {
      const ids = new Set(assignedOf(s).buyersListIds)
      if (!ids.size) continue
      const zone = zones.length ? zones.find((z) => z.id === (s as { zoneId?: string | null }).zoneId) ?? zones[0] : null
      const playlistId = zones.length ? zone?.playlistId || null : t.defaultPlaylistId || null
      const windowHours = billingUnitHoursOf(t, s)
      const playsPerWindow = playsPerWindowOpenOf(windowHours * 3_600_000, maxPlayLengthSecOf(t, s, maxPlay), Math.max(1, rotationSizeOf(t, i + 1)), openHours)
      const hover: SlotHoverDetail = {
        position: s.label, playlistName: (playlistId && (await ctx.playlists.get(playlistId))?.name) || '—',
        orientation: t.displayCanvasSize.width >= t.displayCanvasSize.height ? 'landscape' : 'portrait', displayCount, windowHours,
        playsPerWindow, vacdPerPlay: vacdPerPlayFor((await audienceOf(ctx.audience, t, i + 1)).assumedViewsPerWindow, windowHours, playsPerWindow * displayCount),
      }
      for (const id of ids) out.set(id, [...(out.get(id) ?? []), { positionId: positionIdOf(t.id, i + 1), label: `${t.name} — ${s.label || `slot ${i + 1}`}`, displayTypeName: t.name, ...slotDetailOf(t, i + 1), ...hover }])
    }
  }
  return out
}

