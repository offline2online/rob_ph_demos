/* How a deal's slot reads to a person (ticket c5S06G5mN6F3GJTI8bxD, 14 Oct 2026): the display type with its description, the zone
   on a multi-zone display type, and the slot's number within that zone. Used by Finalise, the deal sheet and its copied text. */
import { storeZoneLabel, type StoreZone } from '@ph-dsp/types'

export interface SlotLike { displayTypeName?: string; label: string; description?: string | null; zoneName?: string | null; zoneSlot?: number; storeZone?: StoreZone | null }

export const slotLine = (s: SlotLike): string =>
  s.displayTypeName == null || s.zoneSlot == null
    ? s.label
    : `${s.displayTypeName}${s.description ? ` (${s.description})` : ''}${s.zoneName ? `, ${s.zoneName}` : ''}, slot ${s.zoneSlot}${s.storeZone ? `, IAB zone: ${storeZoneLabel(s.storeZone)}` : ''}`

/* One zone/slot naming convention for the Available Inventory Position cell and its hover (ticket yqvzPj3o7hYTWLxF9P8A):
   "Zone N" only on a multi-zone display type, the slot's name only when one was given, the slot number exactly once, joined
   with " · ". A slot with no name carries the default label "Slot N", which is the number itself. */
export interface PlaceLike { position: string; zoneName?: string | null; zoneSlot?: number }
const isDefaultSlotLabel = (label: string): boolean => /^slot\s*\d+$/i.test(label.trim())
const zonePart = (r: PlaceLike): string | null => {
  if (!r.zoneName) return null
  const n = /(\d+)\s*$/.exec(r.zoneName)?.[1]
  return n ? `Zone ${n}` : r.zoneName
}
export const slotName = (r: PlaceLike): string | null => (r.position && !isDefaultSlotLabel(r.position) ? r.position : null)
export const positionText = (r: PlaceLike): string =>
  [zonePart(r), slotName(r) ?? `Slot ${r.zoneSlot ?? ''}`.trim()].filter(Boolean).join(' · ')
/* Hover line 2: the slot number, only when line 1 is led by a name rather than the number. */
export const positionSlotNumber = (r: PlaceLike): string | null => (slotName(r) && r.zoneSlot != null ? `Slot ${r.zoneSlot}` : null)
/* Available Inventory's single Slot column (ticket IkQ23uiIpN8dd6Wh9L27): the slot, with the slot's name in brackets when one was given. */
export const slotColumnText = (r: PlaceLike): string => {
  const slot = [zonePart(r), `Slot ${r.zoneSlot ?? ''}`.trim()].filter(Boolean).join(' · ')
  const name = slotName(r)
  return name ? `${slot} (${name})` : slot
}
