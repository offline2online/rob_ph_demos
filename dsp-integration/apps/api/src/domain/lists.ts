/* Advertiser lists: a DSP adopts the company lists unless it has unlinked
   (spec §6). The blacklist always subtracts; matching ignores case. */
import type { CompanySettings } from '../repos/CompanySettingsRepo'
import type { PartnerRecord } from '../repos/PartnerRepo'

export interface EffectiveLists { linked: boolean; allowList: string[]; blockList: string[] }

export const effectiveLists = (p: PartnerRecord | null, company: CompanySettings): EffectiveLists =>
  !p || p.listsLinked
    ? { linked: true, allowList: company.advertiserWhitelist, blockList: company.advertiserBlacklist }
    : { linked: false, allowList: p.allowList, blockList: p.blockList }

/* Category lists follow the same link/unlink switch as the advertiser
   lists above — one "list management" toggle per DSP covers both (ticket,
   28 Sep 2026: unlinking a DSP used to reveal its own advertiser lists but
   never its own category lists, so a DSP that genuinely needed a different
   category policy from the company's had nowhere to set it). */
export const effectiveCategoryLists = (p: PartnerRecord | null, company: CompanySettings): EffectiveLists =>
  !p || p.listsLinked
    ? { linked: true, allowList: company.categoryWhitelist, blockList: company.categoryBlacklist }
    : { linked: false, allowList: p.categoryAllowList, blockList: p.categoryBlockList }

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()
export const isOn = (name: string, list: string[]) => list.some((x) => same(x, name))
export const isBlocked = (name: string, eff: EffectiveLists) => isOn(name, eff.blockList)
