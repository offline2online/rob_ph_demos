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

/* The hour groups, per display type and zone, kept for HOUR_GROUPS_TTL_MS
   (pre-handover review, 18 Oct 2026). Building them reads every display of
   the type and every store, and since the operating-hours gate (16 Oct 2026)
   they are asked for on every availability check, bid request, bid placed,
   auction position and real-time impression: on a 15,000-display estate that
   read was most of the request (bids 928 → 288 req/s, a real-time impression
   2.1 → 10.2 ms, 13% of impressions missing tmax). Displays and stores change
   only through the platform, never through this API, so the same one-second
   snapshot the display counts use (platform/DisplaySource.ts) answers exactly
   what a fresh read would, a second later at most. The zone is part of the
   key, so a display type saved with a new zone is seen at once. Keyed on the
   context's DisplaySource, so each context (and each test) has its own. On
   integration the platform's Displays & Devices and Stores services can
   answer the grouped hours themselves and this becomes their cache.

   The stores are read once per snapshot, shared by every display type, and
   each type's groups expire on their own clock: a request that walks every
   type (Available Inventory, 600 types on a large estate) used to re-read
   all the stores per type and outlive its own one-second cache, which made
   it slower than reading everything afresh (pre-merge review, 19 Oct 2026). */
export const HOUR_GROUPS_TTL_MS = 1_000
interface HourGroupsCache {
  byKey: Map<string, { at: number; groups: Awaitable<ScreenGroup[]> }>
  stores: { at: number; byId: Awaitable<ReadonlyMap<string, StoreRecord>> } | null
}
const hourGroupsCache = new WeakMap<object, HourGroupsCache>()

/* Every store by id, from the cache's one-second snapshot. */
function storesById(ctx: Context, cache: HourGroupsCache, now: number): Awaitable<ReadonlyMap<string, StoreRecord>> {
  if (cache.stores && now - cache.stores.at <= HOUR_GROUPS_TTL_MS) return cache.stores.byId
  /* A new snapshot: drop the groups that have expired since the last one, so
     the map holds no more than the display types asked for in the last second. */
  for (const [key, e] of cache.byKey) if (now - e.at > HOUR_GROUPS_TTL_MS) cache.byKey.delete(key)
  const list = ctx.stores.list()
  const toMap = (l: StoreRecord[]): ReadonlyMap<string, StoreRecord> => new Map(l.map((s) => [s.id, s]))
  const byId = list instanceof Promise ? list.then(toMap) : toMap(list)
  const snapshot = { at: now, byId }
  cache.stores = snapshot
  /* A failed read is never served from the cache: the next call reads again. */
  if (byId instanceof Promise) byId.catch(() => { if (cache.stores === snapshot) cache.stores = null })
  return byId
}

/* A position's displays grouped by resolved hours. Sync-first like the other per-position reads. */
export function positionHourGroups(ctx: Context, p: { displayType: { id: string; phExtensions?: { storeZone?: string | null } | null } }): Awaitable<ScreenGroup[]> {
  const zone = p.displayType.phExtensions?.storeZone
  let cache = hourGroupsCache.get(ctx.displays)
  if (!cache) hourGroupsCache.set(ctx.displays, (cache = { byKey: new Map(), stores: null }))
  const c = cache
  const now = Date.now()
  const key = `${p.displayType.id}\u0000${zone ?? ''}`
  const hit = c.byKey.get(key)
  if (hit && now - hit.at <= HOUR_GROUPS_TTL_MS) return hit.groups
  const displays = ctx.displays.listByDisplayType(p.displayType.id)
  const build = (ds: DisplayRecord[]) => {
    if (isExternalZone(zone)) return hourGroups(zone, ds, new Map())
    const stores = storesById(ctx, c, now)
    return stores instanceof Promise ? stores.then((byId) => hourGroups(zone, ds, byId)) : hourGroups(zone, ds, stores)
  }
  const groups = displays instanceof Promise ? displays.then(build) : build(displays)
  const entry = { at: now, groups }
  c.byKey.set(key, entry)
  /* A failed read is never served from the cache: the next call reads again. */
  if (groups instanceof Promise) groups.catch(() => { if (c.byKey.get(key) === entry) c.byKey.delete(key) })
  return groups
}

/* May this display receive offers at this instant? A display with no store record follows the zone's default (open all day). */
export async function displayOpenAt(ctx: Context, d: { storeId: string | null }, zone: string | null | undefined, at: Date): Promise<boolean> {
  if (isExternalZone(zone)) return true
  const store = d.storeId ? await ctx.stores.get(d.storeId) : null
  return openAt(operatingHours(zone, store), at)
}
