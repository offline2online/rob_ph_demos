/* Advertiser lists belong to one DSP (spec §6, ticket 7ZrBqNdkV9UXbRa8o2fo,
   4 Oct 2026): a seat or advertiser ID only means something to the DSP that
   issued it, so each list holds that DSP's own synced seat IDs, never names
   and never a company-wide list. The blacklist always subtracts; matching
   ignores case. */
import type { CompanySettings } from '../repos/CompanySettingsRepo'
import type { PartnerRecord } from '../repos/PartnerRepo'

export interface EffectiveLists { allowList: string[]; blockList: string[] }

export const effectiveLists = (p: PartnerRecord): EffectiveLists => ({ allowList: p.allowList, blockList: p.blockList })

/* Category lists still follow the link/unlink switch (IAB categories stay
   a separate ticket); the advertiser lists above no longer do. */
export const effectiveCategoryLists = (p: PartnerRecord | null, company: CompanySettings): EffectiveLists =>
  !p || p.listsLinked
    ? { allowList: company.categoryWhitelist, blockList: company.categoryBlacklist }
    : { allowList: p.categoryAllowList, blockList: p.categoryBlockList }

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()
export const isOn = (name: string, list: string[]) => list.some((x) => same(x, name))
export const isBlocked = (seatId: string, eff: EffectiveLists) => isOn(seatId, eff.blockList)
