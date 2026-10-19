/* What the deal sheet tells a buyer about WHAT they are buying (ticket DbSVEGXNIWlYW68UQnY3). The DSP never sees PH's
   targeting rules (the deal ID is only a key; PH applies targeting seller-side), so the sheet is the only place the buyer
   learns what a deal targets and covers. Three derivations, all read-only:
     - targeting: the list's criteria in DV360's TargetingType groups, plus plain language for every condition;
     - inventory scope: the attached positions' venue, geography, store and display counts, narrowed by LOCALISATION
       criteria only (a personalised criterion is matched against the live visitor, so it never changes the screen list);
     - estimated volume: plays per window x screens, VAC-d assumed views, x the targeted share. An estimate, labelled so. */
import { OPERATOR_LABELS, TARGETING_VARIABLES, type BuyersList, type Operator } from '@ph-dsp/types'
import type { Context } from '../context'
import { guaranteedImpressions } from './guarantee'
import { assumedViewsPerWindow, maxPlayLengthSecFor, windowMsFor, type PositionRef } from './positions'
import { playsPerWindowOf, playsPerWindowOpenOf } from './plays'
import { rotationSizeOf } from './slots'
import { hourGroups, openHoursPerDayOf, openShareOfDay } from './operatingGate'
import type { Rules } from './targetingValidation'

/* DV360 Seller API TargetingType names (Product.targetingCriteria). */
export type Dv360TargetingType = 'GEO' | 'AUDIENCE' | 'DEVICE' | 'VENUE'
const DV360_TYPE: Record<string, Dv360TargetingType> = {
  'store.state': 'GEO', 'store.suburb': 'GEO', 'store.postcode': 'GEO', 'store.country': 'GEO',
  'store.cv_age': 'AUDIENCE', 'visitor.age': 'AUDIENCE', 'store.cv_gender': 'AUDIENCE', 'visitor.gender': 'AUDIENCE', 'visitor.visitor_segments': 'AUDIENCE',
  'store.device_type_aggregate': 'DEVICE', 'visitor.device_type': 'DEVICE',
  'store.fixed_segments': 'VENUE', 'store.display_tags': 'VENUE',
}

export interface DealSheetCondition {
  variable: string
  /** Shared Targeting Variable display name. */
  name: string
  group: 'localisation' | 'personalisation'
  operator: string
  values: string[]
  /** The condition in words, e.g. "Estimated Age (Computer Vision) includes selected 25–34". */
  text: string
}
export interface DealSheetTargeting {
  /** Criteria that map to a DV360 targeting type, grouped by that type. */
  targetingCriteria: { targetingType: Dv360TargetingType; conditions: DealSheetCondition[] }[]
  /** PH criteria with no DV360 targeting type: still listed, flagged. */
  sellerSideOnly: DealSheetCondition[]
  /** Every condition in words, joined by AND. */
  plainLanguage: string
}

const variableOf = (key: string) => TARGETING_VARIABLES.find((v) => v.key === key)
const conditionOf = (c: BuyersList['targeting'][number]): DealSheetCondition => {
  const def = variableOf(c.variable)
  const name = def?.label ?? c.variable
  const operator = OPERATOR_LABELS[c.op as Operator] ?? c.op
  return { variable: c.variable, name, group: def?.group === 'personalisation' ? 'personalisation' : 'localisation', operator, values: c.values, text: `${name} ${operator} ${c.values.join(' or ')}` }
}

export const NO_TARGETING = 'No additional targeting (all attached positions)'

export function targetingOf(list: BuyersList): DealSheetTargeting {
  const conditions = list.targeting.map(conditionOf)
  const mapped = new Map<Dv360TargetingType, DealSheetCondition[]>()
  const sellerSideOnly: DealSheetCondition[] = []
  for (const c of conditions) {
    const t = DV360_TYPE[c.variable]
    if (t) mapped.set(t, [...(mapped.get(t) ?? []), c])
    else sellerSideOnly.push(c)
  }
  return {
    targetingCriteria: [...mapped].map(([targetingType, cs]) => ({ targetingType, conditions: cs })),
    sellerSideOnly,
    plainLanguage: conditions.length ? conditions.map((c) => c.text).join(' AND ') : NO_TARGETING,
  }
}

/* Does a store pass a localisation condition? Only what the platform's store record carries can be checked: the fixed
   store segments. null = not evaluable here (suburb, postcode, hours, ...): PH Core applies it at bid time and the
   counts do not reflect it. */
type StoreFacts = { segments: string[] }
function storePasses(c: BuyersList['targeting'][number], s: StoreFacts): boolean | null {
  if (c.variable !== 'store.fixed_segments') return null
  const has = (v: string) => s.segments.some((x) => x.toLowerCase() === v.toLowerCase())
  switch (c.op) {
    case 'match_exactly': return c.values.every(has)
    case 'exclude_or': return !c.values.some(has)
    case 'exclude_and': return !c.values.every(has)
    default: return c.values.some(has)
  }
}

export interface DealSheetInventoryScope {
  venueTypes: string[]
  /** Store regions the in-scope displays are in (the platform's geography). */
  geography: string[]
  stores: number
  displays: number
  /** Stores and displays on the attached positions before localisation criteria narrow them. */
  storesBeforeTargeting: number
  displaysBeforeTargeting: number
  screenFormats: { width: number; height: number; orientation: string }[]
  /** Localisation criteria that narrowed the counts. */
  narrowedBy: string[]
  /** Localisation criteria PH applies at bid time but the counts do not reflect. */
  notReflectedInCounts: string[]
  summary: string
}
export interface DealSheetVolume {
  label: 'Estimate'
  /** Per play window on the attached positions. */
  playsPerWindow: number
  assumedViewsPerWindow: number
  /** Share of the audience the personalised criteria can reach, 0 to 1 (1 when there are none). */
  targetedShare: number
  /** Whole-term totals when the flight has both dates; null otherwise. */
  windows: number | null
  playsInTerm: number | null
  assumedViewsInTerm: number | null
  /** Programmatic guaranteed only: forecast x (1 - buffer%). */
  guaranteedImpressionsPerWindow: number | null
  bufferPct: number | null
  /** Assumed views per play, used to express committed plays as impressions. */
  assumedViewsPerPlay: number | null
}
export interface ScopeAndVolume { inventoryScope: DealSheetInventoryScope; estimatedVolume: DealSheetVolume }

/* The deal sheet's inventory scope and estimated volume for a buyers list
   over the positions assigned to it. Per position: the displays its
   localised targeting keeps (each store tested against every condition; a
   condition the store record can't answer keeps it), the stores, regions,
   venue types and formats they reach, and the plays and assumed views they
   give in their open hours, scaled by the share the personalised targeting
   reaches. Then rolled up over the list's delivery term, with the guarantee
   (forecast less the retailer's buffer) for a programmatic guaranteed deal.
   Reads each type's displays itself (not the cached hour groups) because it
   filters them store by store. */
export async function scopeAndVolumeOf(ctx: Context, list: BuyersList, positions: PositionRef[]): Promise<ScopeAndVolume> {
  const localised = list.targeting.filter((c) => (variableOf(c.variable)?.group ?? 'localisation') !== 'personalisation')
  const personalised: Rules = list.targeting.filter((c) => variableOf(c.variable)?.group === 'personalisation').map((c) => [c])
  const company = await ctx.company.get()
  const stores = new Map((await ctx.stores.list()).map((s) => [s.id, s]))
  const reached = new Set<string>(), reachedBefore = new Set<string>(), regions = new Set<string>(), venues = new Set<string>()
  const formats = new Map<string, { width: number; height: number; orientation: string }>()
  let displays = 0, displaysBefore = 0, plays = 0, views = 0, shareWeighted = 0, playsAll = 0, viewsAll = 0, windowMs = 0
  const narrowedBy = new Set<string>(), notReflected = new Set<string>()
  for (const p of positions) {
    const dt = p.displayType
    const venue = dt.phExtensions?.venue
    if (venue?.openOohVenueType) venues.add(venue.openOohVenueType)
    const { width, height } = dt.displayCanvasSize
    formats.set(`${width}x${height}`, { width, height, orientation: venue?.orientation ?? (width === height ? 'square' : width > height ? 'landscape' : 'portrait') })
    const all = await ctx.displays.listByDisplayType(dt.id)
    const kept = all.filter((d) => {
      const s = d.storeId ? stores.get(d.storeId) : undefined
      return localised.every((c) => {
        const ok = s ? storePasses(c, s) : null
        if (ok === null) notReflected.add(conditionOf(c).text)
        else narrowedBy.add(conditionOf(c).text)
        return ok ?? true
      })
    })
    for (const d of all) if (d.storeId) reachedBefore.add(d.storeId)
    for (const d of kept) {
      if (d.storeId) { reached.add(d.storeId); const r = stores.get(d.storeId)?.region; if (r) regions.add(r) }
    }
    displays += kept.length
    displaysBefore += all.length
    /* Zone-based operating hours: each display counts only its open share of the day (external zones 24h, internal the store's trading hours). */
    const keptGroups = hourGroups(dt.phExtensions?.storeZone, kept, stores)
    const openShare = openShareOfDay(keptGroups)
    const perDisplay = playsPerWindowOpenOf(windowMsFor(p), maxPlayLengthSecFor(company.maxPlayLengthSec, p), rotationSizeOf(dt, p.slot), openHoursPerDayOf(keptGroups))
    const slotViews = await assumedViewsPerWindow(ctx, p)
    const keep = all.length ? kept.length / all.length : 0
    const pShare = personalised.length ? await ctx.audience.targetedShare(dt.id, personalised) : 1
    plays += perDisplay * kept.length
    views += slotViews * keep * pShare * openShare
    shareWeighted += slotViews * keep * openShare
    playsAll += playsPerWindowOf(windowMsFor(p), maxPlayLengthSecFor(company.maxPlayLengthSec, p), rotationSizeOf(dt, p.slot)) * all.length
    viewsAll += slotViews
    windowMs = Math.max(windowMs, windowMsFor(p))
  }
  const targetedShare = shareWeighted > 0 ? views / shareWeighted : personalised.length ? 0 : 1
  const from = list.activeFrom ? Date.parse(list.activeFrom) : NaN
  const to = list.activeTo ? Date.parse(list.activeTo) : NaN
  const windows = Number.isFinite(from) && Number.isFinite(to) && to > from && windowMs > 0 ? Math.floor((to - from) / windowMs) : null
  const guaranteed = list.dealType === 'guaranteed'
  const viewsPerWindow = Math.round(views)
  const geography = [...regions].sort()
  const venueTypes = [...venues].sort()
  const scope: DealSheetInventoryScope = {
    venueTypes, geography, stores: reached.size, displays, storesBeforeTargeting: reachedBefore.size, displaysBeforeTargeting: displaysBefore,
    screenFormats: [...formats.values()], narrowedBy: [...narrowedBy], notReflectedInCounts: [...notReflected],
    summary: positions.length
      ? `${venueTypes.join(', ') || 'Venue type not set'}; ${reached.size} store${reached.size === 1 ? '' : 's'}, ${displays} display${displays === 1 ? '' : 's'}${geography.length ? ` in ${geography.join(', ')}` : ''}`
      : 'None yet: the deal is not attached to a slot',
  }
  const volume: DealSheetVolume = {
    label: 'Estimate',
    playsPerWindow: plays,
    assumedViewsPerWindow: viewsPerWindow,
    targetedShare: Math.round(targetedShare * 1000) / 1000,
    windows,
    playsInTerm: windows === null ? null : plays * windows,
    assumedViewsInTerm: windows === null ? null : viewsPerWindow * windows,
    guaranteedImpressionsPerWindow: guaranteed ? guaranteedImpressions(viewsPerWindow, company.guaranteeBufferPct) : null,
    bufferPct: guaranteed ? company.guaranteeBufferPct : null,
    assumedViewsPerPlay: playsAll > 0 ? Math.round((viewsAll / playsAll) * 100) / 100 : null,
  }
  return { inventoryScope: scope, estimatedVolume: volume }
}
