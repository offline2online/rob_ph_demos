/* Enforcing zone-based operating hours (ticket 6a8L1QcfFUq5alWFgwnb, decision
   Rob 16 Oct 2026; the resolver is operatingHours() in dailyCapacity.ts).
   Outside a display's resolved hours nothing is offered for it: no real-time
   bid request, no private-auction bid request, no window booking, and the
   screen plays house content. Those moments are not unsold opportunities and
   carry no missed revenue. 'Unavailable — store closed' is only ever the
   reason for an INTERNAL zone; an external display has no closed time.

   Hours are whole UTC hours (this POC has no store time zones), as in
   dailyCapacity.ts. Pure functions: groups of displays sharing hours are
   built by the callers that already hold the displays and stores. */
import { type Hours, type ScreenGroup, ALWAYS_OPEN, isExternalZone, openMsIn, operatingHours } from './dailyCapacity'
import type { Context } from '../context'
import type { Awaitable } from '../db/db'
import type { DisplayRecord } from '../platform/DisplaySource'
import type { StoreRecord } from '../platform/StoreSource'


/* Is a display with these hours open at this instant? */
export function openAt(h: Hours, at: Date): boolean {
  const hour = at.getUTCHours() + at.getUTCMinutes() / 60
  return hour >= h.open && hour < h.close
}

/* Does any display of the group have open time in [start, start + len)? */
export const windowOpenFor = (groups: readonly ScreenGroup[], start: Date, len: number): boolean =>
  groups.some((g) => g.screens > 0 && openMsIn(start.getTime(), start.getTime() + len, g.hours) > 0)

/* Displays of a display type grouped by resolved hours (one group per distinct hours, not one per display). */
export function hourGroups(zone: string | null | undefined, displays: readonly Pick<DisplayRecord, 'storeId'>[], stores: ReadonlyMap<string, Pick<StoreRecord, 'openHour' | 'closeHour'>>): ScreenGroup[] {
  if (isExternalZone(zone)) return displays.length ? [{ hours: ALWAYS_OPEN, screens: displays.length }] : []
  const by = new Map<string, ScreenGroup>()
  for (const d of displays) {
    const hours = operatingHours(zone, d.storeId ? stores.get(d.storeId) : undefined)
    const key = `${hours.open}-${hours.close}`
    const g = by.get(key) ?? { hours, screens: 0 }
    g.screens++
    by.set(key, g)
  }
  return [...by.values()]
}

/* The share of a day the displays are open, by screens (1 for an external zone): scales Estimated volume and guaranteed impressions. */
export function openShareOfDay(groups: readonly ScreenGroup[]): number {
  const screens = groups.reduce((n, g) => n + g.screens, 0)
  if (!screens) return 0
  return groups.reduce((n, g) => n + g.screens * Math.max(0, g.hours.close - g.hours.open), 0) / (screens * 24)
}

/* Open hours per day a display type counts for plays (24 for an external zone; the average trading hours across its displays' stores otherwise, 24 when it has no displays to average). */
export const openHoursPerDayOf = (groups: readonly ScreenGroup[]): number => (groups.some((g) => g.screens > 0) ? openShareOfDay(groups) * 24 : 24)

/* imp.ext.ph.operatingHours: the standard per-screen form, grouped by distinct hours so a 15,000-display estate stays one short list. */
export interface OperatingHoursExt {
  zone: string | null
  external: boolean
  tz: 'UTC'
  screens: { open: string; close: string; days: number[]; count: number }[]
}
const hh = (h: number) => `${String(h).padStart(2, '0')}:00`
export function operatingHoursExt(zone: string | null | undefined, groups: readonly ScreenGroup[]): OperatingHoursExt {
  return {
    zone: zone ?? null,
    external: isExternalZone(zone),
    tz: 'UTC',
    screens: groups.map((g) => ({ open: hh(g.hours.open), close: hh(g.hours.close), days: [0, 1, 2, 3, 4, 5, 6], count: g.screens })),
  }
}

/* A position's displays grouped by resolved hours. Sync-first like the other per-position reads. */
export function positionHourGroups(ctx: Context, p: { displayType: { id: string; phExtensions?: { storeZone?: string | null } | null } }): Awaitable<ScreenGroup[]> {
  const zone = p.displayType.phExtensions?.storeZone
  const displays = ctx.displays.listByDisplayType(p.displayType.id)
  const build = (ds: DisplayRecord[]) => {
    if (isExternalZone(zone)) return hourGroups(zone, ds, new Map())
    const stores = ctx.stores.list()
    return stores instanceof Promise ? stores.then((l) => hourGroups(zone, ds, new Map(l.map((s) => [s.id, s])))) : hourGroups(zone, ds, new Map(stores.map((s) => [s.id, s])))
  }
  return displays instanceof Promise ? displays.then(build) : build(displays)
}

/* May this display receive offers at this instant? A display with no store record follows the zone's default (open all day). */
export async function displayOpenAt(ctx: Context, d: { storeId: string | null }, zone: string | null | undefined, at: Date): Promise<boolean> {
  if (isExternalZone(zone)) return true
  const store = d.storeId ? await ctx.stores.get(d.storeId) : null
  return openAt(operatingHours(zone, store), at)
}
