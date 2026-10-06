/* Advertiser lists belong to one DSP (spec §6, ticket 7ZrBqNdkV9UXbRa8o2fo,
   4 Oct 2026): a seat or advertiser ID only means something to the DSP that
   issued it, so each list holds that DSP's own synced seat IDs, never names
   and never a company-wide list. The blacklist always subtracts; matching
   ignores case. */
import type { CompanySettings } from '../repos/CompanySettingsRepo'
import type { PartnerRecord } from '../repos/PartnerRepo'

export interface EffectiveLists { allowList: string[]; blockList: string[] }

export const effectiveLists = (p: PartnerRecord): EffectiveLists => ({ allowList: p.allowList, blockList: p.blockList })

/* IAB categories are one taxonomy every DSP speaks, so the category lists are
   the company's alone (spec §6, ticket vjykcgGWkfUjPB2xulel, 4 Oct 2026):
   one whitelist and blacklist, applied to every DSP, no per-DSP override. */
export const effectiveCategoryLists = (company: CompanySettings): EffectiveLists =>
  ({ allowList: company.categoryWhitelist, blockList: company.categoryBlacklist })

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()
export const isOn = (name: string, list: string[]) => list.some((x) => same(x, name))
export const isBlocked = (seatId: string, eff: EffectiveLists) => isOn(seatId, eff.blockList)

/* The domains a DSP told us for these seats (seats pulled on connect): what
   badv, and TTD's ext.domainperms, carry for a seat-ID list. */
export function seatDomains(partner: PartnerRecord, ids: string[]) {
  const out = new Set<string>()
  for (const entry of ids) {
    const seat = partner.seats.find((s) => same(s.id, entry))
    if (seat?.domain) out.add(seat.domain.toLowerCase())
  }
  return [...out]
}
