/* The slots a deal is assigned to, as the Details hover counts them, read from Available Inventory's rows as saved (ticket
   CXmiVdLcDzkcojpSnJic, 27 Oct 2026). The Booking schedule has no unsaved edits, so this is the same "override, else the display
   type's default, else the platform's" read as AdvertisersPage's effective* helpers with no draft; keep the two in step. */
import { PLATFORM_DEFAULT_BILLING_UNIT_HOURS, type AvailableInventoryRow, type BuyersList } from '@ph-dsp/types'
import type { DealSlot } from './DealDetailsTip'

const playsPerWindow = (r: AvailableInventoryRow): { plays: number; hours: number } => {
  const hours = r.billingUnitHoursOverride ?? r.displayTypeBillingUnitHours ?? PLATFORM_DEFAULT_BILLING_UNIT_HOURS
  const playSec = r.maxPlayLengthSecOverride ?? r.displayTypeMaxPlayLengthSec ?? r.companyMaxPlayLengthSec
  const loopSec = playSec * Math.max(1, r.slotCount)
  const openShare = Math.min(24, Math.max(0, r.openHoursPerDay ?? 24)) / 24
  return { plays: loopSec > 0 ? Math.floor((hours * 3600 * openShare) / loopSec) : 0, hours }
}

/* Every inventory row as a deal slot, by position id (`displayTypeId.sN`). */
export const dealSlotsByPosition = (rows: AvailableInventoryRow[]): Map<string, DealSlot> =>
  new Map(rows.map((r) => {
    const { plays, hours } = playsPerWindow(r)
    return [`${r.displayTypeId}.s${r.slot}`, { displayType: r.displayTypeName, description: r.displayTypeDescription ?? null, storeZone: r.displayTypeStoreZone ?? null, orientation: r.displayTypeOrientation ?? null, zoneName: r.zoneName ?? null, playlist: r.playlistName, position: r.position, slot: r.zoneSlot, playsPerWindow: plays, displayCount: typeof r.displayCount === 'number' ? r.displayCount : null, windowHours: hours, vacdPerPlay: r.vacdPerPlay ?? null }] as const
  }))

/* A deal's slots, in the order the API lists them. */
export const slotsOfDeal = (l: BuyersList, byPosition: Map<string, DealSlot>): DealSlot[] =>
  (l.assignedSlots ?? []).map((s) => byPosition.get(s.positionId)).filter((s): s is DealSlot => !!s)
