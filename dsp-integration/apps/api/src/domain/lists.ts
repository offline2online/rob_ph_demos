/* Advertiser lists: a DSP adopts the company lists unless it has unlinked
   (spec §6). The blacklist always subtracts; matching ignores case. */
import type { CompanySettings } from '../repos/CompanySettingsRepo'
import type { PartnerRecord } from '../repos/PartnerRepo'

export interface EffectiveLists { linked: boolean; allowList: string[]; blockList: string[] }

export const effectiveLists = (p: PartnerRecord | null, company: CompanySettings): EffectiveLists =>
  !p || p.listsLinked
    ? { linked: true, allowList: company.advertiserWhitelist, blockList: company.advertiserBlacklist }
    : { linked: false, allowList: p.allowList, blockList: p.blockList }

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()
export const isOn = (name: string, list: string[]) => list.some((x) => same(x, name))
export const isBlocked = (name: string, eff: EffectiveLists) => isOn(name, eff.blockList)
