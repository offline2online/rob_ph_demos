/* Advertiser settings validation (spec §4, §6): any ISO 4217 currency,
   positive floor and multipliers, and nothing on both lists. */
import type { AdvertiserSettingsInput } from '@ph-dsp/types'

type Detail = { field: string; reason: string }
const CURRENCIES = new Set(Intl.supportedValuesOf('currency'))
const key = (s: string) => s.trim().toLowerCase()

/* Trim, drop blanks and case-insensitive duplicates, keeping first spelling. */
export const cleanList = (xs: unknown) => {
  const seen = new Set<string>()
  return (Array.isArray(xs) ? xs : []).filter((x): x is string => typeof x === 'string').map((x) => x.trim()).filter((x) => x && !seen.has(key(x)) && seen.add(key(x)))
}

export function validateAdvertiserSettings(b: Partial<AdvertiserSettingsInput> | undefined): Detail[] {
  const out: Detail[] = []
  if (typeof b?.currency !== 'string' || !CURRENCIES.has(b.currency)) out.push({ field: 'currency', reason: 'Choose an ISO 4217 currency.' })
  for (const [k, label] of [['floorCpm', 'Floor price (CPM)'], ['personalisedMultiplier', 'Personalised multiplier'], ['interactiveMultiplier', 'Interactive multiplier']] as const) {
    const v = b?.[k]
    if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) out.push({ field: k, reason: `${label} must be greater than 0.` })
  }
  for (const k of ['advertiserWhitelist', 'advertiserBlacklist', 'categoryWhitelist', 'categoryBlacklist'] as const) {
    if (!Array.isArray(b?.[k])) out.push({ field: k, reason: 'Required.' })
  }
  const both = (a: unknown, c: unknown, field: string) => {
    const black = new Set(cleanList(c).map(key))
    for (const x of cleanList(a)) if (black.has(key(x))) out.push({ field, reason: `${x} is on both the whitelist and the blacklist.` })
  }
  both(b?.advertiserWhitelist, b?.advertiserBlacklist, 'advertiserWhitelist')
  both(b?.categoryWhitelist, b?.categoryBlacklist, 'categoryWhitelist')
  return out
}
