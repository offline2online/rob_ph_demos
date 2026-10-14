/* How a deal's slot reads to a person (ticket c5S06G5mN6F3GJTI8bxD, 14 Oct 2026): the display type with its description, the zone
   on a multi-zone display type, and the slot's number within that zone. Used by Finalise, the deal sheet and its copied text. */
export interface SlotLike { displayTypeName?: string; label: string; description?: string | null; zoneName?: string | null; zoneSlot?: number }

export const slotLine = (s: SlotLike): string =>
  s.displayTypeName == null || s.zoneSlot == null
    ? s.label
    : `${s.displayTypeName}${s.description ? ` (${s.description})` : ''}${s.zoneName ? `, ${s.zoneName}` : ''}, slot ${s.zoneSlot}`
