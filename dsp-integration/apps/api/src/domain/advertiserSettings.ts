/* Advertiser settings validation (spec §4, §6): any ISO 4217 currency,
   positive floor, category entries that are real IAB
   categories, and nothing on both category lists. (The advertiser lists are
   per DSP: domain/partnerInput.ts.) */
import { canonicalIabCategory, INTERACTIVE_ENABLED, MAX_MAX_PLAY_LENGTH_SEC, MIN_MAX_PLAY_LENGTH_SEC, type AdvertiserSettingsInput } from '@ph-dsp/types'

import { MAX_GUARANTEE_BUFFER_PCT } from './guarantee'
import { bidLookaheadOk } from './bidLookahead'
import { cachedAssetRetentionOk } from './cachedAssetRetention'
import { HHMM, UNCACHED_MODES } from './uncachedRestriction'

type Detail = { field: string; reason: string }
const CURRENCIES = new Set(Intl.supportedValuesOf('currency'))
const key = (s: string) => s.trim().toLowerCase()

/* Trim, drop blanks and case-insensitive duplicates, keeping first spelling. */
export const cleanList = (xs: unknown) => {
  const seen = new Set<string>()
  return (Array.isArray(xs) ? xs : []).filter((x): x is string => typeof x === 'string').map((x) => x.trim()).filter((x) => x && !seen.has(key(x)) && seen.add(key(x)))
}

/* An entry only means something to a DSP if it is one of the IAB categories
   the bid request carries a code for, so free text is refused. Returns the
   canonical spelling (a name matched without regard to case). */
export const cleanCategoryList = (xs: unknown) => {
  const seen = new Set<string>()
  return cleanList(xs).map((x) => canonicalIabCategory(x) ?? x).filter((x) => !seen.has(x) && seen.add(x))
}

export function validateAdvertiserSettings(b: Partial<AdvertiserSettingsInput> | undefined): Detail[] {
  const out: Detail[] = []
  if (typeof b?.currency !== 'string' || !CURRENCIES.has(b.currency)) out.push({ field: 'currency', reason: 'Choose an ISO 4217 currency.' })
  const floor = b?.floorCpm
  if (typeof floor !== 'number' || !Number.isFinite(floor) || floor <= 0) out.push({ field: 'floorCpm', reason: 'Floor price (CPM) must be greater than 0.' })
  /* A fee per engagement, to the cent; 0 means engagements aren't charged for. */
  const cpe = b?.interactiveCpe
  /* Not edited while interactive campaigns are deferred (Rob, 5 Oct 2026): the stored value is kept as is. */
  if (INTERACTIVE_ENABLED && (typeof cpe !== 'number' || !Number.isFinite(cpe) || cpe < 0 || Math.round(cpe * 100) !== cpe * 100)) {
    out.push({ field: 'interactiveCpe', reason: 'Interactive cost per engagement is 0 or more, to the cent.' })
  }
  /* Optional on save (omitted keeps the stored value); when sent, a percentage from 0 to 50. */
  const buf = b?.guaranteeBufferPct
  if (buf !== undefined && (typeof buf !== 'number' || !Number.isFinite(buf) || buf < 0 || buf > MAX_GUARANTEE_BUFFER_PCT)) out.push({ field: 'guaranteeBufferPct', reason: `The guarantee buffer is a percentage from 0 to ${MAX_GUARANTEE_BUFFER_PCT}.` })
  /* Optional on save (omitted keeps the stored value, null clears it); when a number, a whole number of plays, at least 1. */
  const dcp = b?.defaultCommittedPlays
  if (dcp !== undefined && dcp !== null && (typeof dcp !== 'number' || !Number.isInteger(dcp) || dcp < 1)) out.push({ field: 'defaultCommittedPlays', reason: 'Default committed plays is a whole number of plays, at least 1, or empty.' })
  /* Optional on save (omitted keeps the stored value); when sent, whole seconds within the allowed range. */
  const mpl = b?.maxPlayLengthSec
  if (mpl !== undefined && (typeof mpl !== 'number' || !Number.isInteger(mpl) || mpl < MIN_MAX_PLAY_LENGTH_SEC || mpl > MAX_MAX_PLAY_LENGTH_SEC)) out.push({ field: 'maxPlayLengthSec', reason: `Max play length is a whole number of seconds from ${MIN_MAX_PLAY_LENGTH_SEC} to ${MAX_MAX_PLAY_LENGTH_SEC}.` })
  /* Optional on save (omitted keeps the stored value); when sent, whole seconds, at least 1. */
  if (b?.bidLookaheadSeconds !== undefined && !bidLookaheadOk(b.bidLookaheadSeconds)) out.push({ field: 'bidLookaheadSeconds', reason: 'Bid lookahead is a whole number of seconds, at least 1.' })
  /* Optional on save (omitted keeps the stored value); when sent, whole hours, at least 1. */
  if (b?.cachedAssetRetentionHours !== undefined && !cachedAssetRetentionOk(b.cachedAssetRetentionHours)) out.push({ field: 'cachedAssetRetentionHours', reason: 'Cached asset retention is a whole number of hours, at least 1.' })
  /* Optional on save (omitted keeps the stored value). */
  const mode = b?.uncachedRestriction
  if (mode !== undefined && !(UNCACHED_MODES as readonly unknown[]).includes(mode)) out.push({ field: 'uncachedRestriction', reason: `One of ${UNCACHED_MODES.join(', ')}.` })
  for (const k of ['uncachedRestrictionStart', 'uncachedRestrictionEnd'] as const) {
    const t = b?.[k]
    if (t !== undefined && (typeof t !== 'string' || !HHMM.test(t))) out.push({ field: k, reason: 'A time of day, HH:MM.' })
  }
  for (const k of ['categoryWhitelist', 'categoryBlacklist'] as const) {
    if (!Array.isArray(b?.[k])) { out.push({ field: k, reason: 'Required.' }); continue }
    for (const x of cleanList(b?.[k])) if (!canonicalIabCategory(x)) out.push({ field: k, reason: `${x} is not an IAB category. Choose from the IAB Content Taxonomy (tier 1, or tier 2 as "Tier 1 › Tier 2").` })
  }
  const both = (a: unknown, c: unknown, field: string) => {
    const black = new Set(cleanCategoryList(c).map(key))
    for (const x of cleanCategoryList(a)) if (black.has(key(x))) out.push({ field, reason: `${x} is on both the whitelist and the blacklist.` })
  }
  both(b?.categoryWhitelist, b?.categoryBlacklist, 'categoryWhitelist')
  return out
}
