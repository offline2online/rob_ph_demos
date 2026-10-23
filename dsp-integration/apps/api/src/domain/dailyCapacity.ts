/* Plays per day (ticket "Booking schedule: plays per day, booked vs available
   by segment", decision Rob 9 Oct 2026). The window is the clearing unit; the
   day is only a roll-up of it. A position's plays in a day are the plays of
   every billing-unit window running in that day's operating period, never a
   flat 24h / billing unit: a 24/7 display on an 8h unit has three windows a
   day, an in-store display open 8h has one, and a window the store is only
   partly open for counts the plays that fit in the open part.

   Everything is per display and summed over displays, because stores differ
   in trading hours and (for the segment cuts) in which segments they carry.
   Day boundaries are UTC and store hours are hours of that day: this POC has
   no store time zones. */
import { windowStartOf } from './positions'

const HOUR = 3_600_000
const DAY = 24 * HOUR

/* Trading hours as whole hours of the day: open inclusive, close exclusive. */
export interface Hours { open: number; close: number }
export const ALWAYS_OPEN: Hours = { open: 0, close: 24 }

/* Operating hours (ticket 24VWhzDd4yv7CswOPrGX, Rob 16 Oct 2026; made editable
   by ticket WvnAf6fR7snXV1C0z9PV, Rob 22 Oct 2026). A display's operating
   hours come from its DISPLAY TYPE, never from a per-display setting: 24 hours,
   the store's trading hours, or a custom start and end (platform time zone,
   the same every day). The IAB store zone only sets the initial value: the
   external zones (Exterior, Entrance & out of category — window screens are
   Entrance) still have passing traffic when the store is shut, so they start
   at 24 hours; the internal zones (In aisles, Checkout, Other & connected
   store) and a type with no zone start at Store hours. A display type that was
   never edited has no saved setting and reads as its zone's value. */
export type OperatingMode = '24h' | 'store' | 'custom'
export interface OperatingSetting { mode: OperatingMode; start?: string | null; end?: string | null }
/* What operating hours are resolved from: a display type's extensions, or (as before) just a store zone. */
export type OperatingSource = string | null | undefined | { storeZone?: string | null; operatingHours?: OperatingSetting | null }

export const EXTERNAL_ZONES: readonly string[] = ['exterior', 'entrance']
export const isExternalZone = (zone: string | null | undefined): boolean => !!zone && EXTERNAL_ZONES.includes(zone)
export const zoneDefaultMode = (zone: string | null | undefined): OperatingMode => (isExternalZone(zone) ? '24h' : 'store')
const zoneOf = (src: OperatingSource): string | null | undefined => (typeof src === 'object' && src ? src.storeZone : (src as string | null | undefined))
/* The setting in force: the saved one, else the zone's value. */
export function settingOf(src: OperatingSource): OperatingSetting {
  const saved = typeof src === 'object' && src ? src.operatingHours : null
  if (saved && (saved.mode === '24h' || saved.mode === 'store' || (saved.mode === 'custom' && customHours(saved)))) return saved
  return { mode: zoneDefaultMode(zoneOf(src)) }
}
/* "HH:MM" as hours of the day (06:30 is 6.5). */
export const hoursOfTime = (t: string | null | undefined): number | null => {
  const m = /^(\d{1,2}):([0-5]\d)$/.exec(t ?? '')
  const h = m ? Number(m[1]) + Number(m[2]) / 60 : NaN
  return h >= 0 && h <= 24 ? h : null
}
/* A custom setting's hours, or null when its start and end are not a valid same-day range. */
export function customHours(s: OperatingSetting): Hours | null {
  const open = hoursOfTime(s.start)
  const close = hoursOfTime(s.end)
  return open !== null && close !== null && open < close ? { open, close } : null
}
/* True when the resolved hours need no store (24 hours, or a fixed custom range). */
export const isStoreIndependent = (src: OperatingSource): boolean => settingOf(src).mode !== 'store'
/* A key that is the same for the same resolved setting, for caches. */
export const settingKey = (src: OperatingSource): string => { const s = settingOf(src); return s.mode === 'custom' ? `custom:${s.start}-${s.end}` : s.mode }
export function operatingHours(src: OperatingSource, store: { openHour: number; closeHour: number } | null | undefined): Hours {
  const s = settingOf(src)
  if (s.mode === '24h') return ALWAYS_OPEN
  if (s.mode === 'custom') return customHours(s)!
  return { open: store?.openHour ?? 0, close: store?.closeHour ?? 24 }
}

/* The display type's playback window as people read it on its Operating hours: '24 hours', 'Store hours' or 'HH:MM–HH:MM'. */
export function playbackWindowLabel(src: OperatingSource): string {
  const s = settingOf(src)
  return s.mode === '24h' ? '24 hours' : s.mode === 'store' ? 'Store hours' : `${s.start}–${s.end}`
}

/* Milliseconds of [a, b) the store is open. */
export function openMsIn(a: number, b: number, h: Hours): number {
  let ms = 0
  for (let day = Math.floor(a / DAY) * DAY; day < b; day += DAY) {
    const from = Math.max(a, day + h.open * HOUR)
    const to = Math.min(b, day + h.close * HOUR)
    if (to > from) ms += to - from
  }
  return ms
}

/* Plays one slot gets on ONE display over [a, b): per billing-unit window the
   window overlaps, the open time inside both the window and the period, divided
   by the loop (max play length x slots in rotation), floored. A period that is
   one whole day gives that day's plays per display. */
export function playsInPeriod(a: number, b: number, windowMs: number, loopSec: number, h: Hours): number {
  if (!(loopSec > 0) || !(windowMs > 0) || b <= a || h.close <= h.open) return 0
  let plays = 0
  for (let ws = windowStartOf(new Date(a), windowMs).getTime(); ws < b; ws += windowMs) {
    const ms = openMsIn(Math.max(a, ws), Math.min(b, ws + windowMs), h)
    plays += Math.floor(ms / 1000 / loopSec)
  }
  return plays
}

/* A group of displays sharing trading hours: `screens` of them. */
export interface ScreenGroup { hours: Hours; screens: number }

export const playsForGroups = (groups: readonly ScreenGroup[], a: number, b: number, windowMs: number, loopSec: number): number =>
  groups.reduce((n, g) => n + g.screens * playsInPeriod(a, b, windowMs, loopSec, g.hours), 0)

export const screensOf = (groups: readonly ScreenGroup[]): number => groups.reduce((n, g) => n + g.screens, 0)

/* The localized segments a campaign's targeting names (fixed and variable store segments). */
export const SEGMENT_VARIABLES = ['store.fixed_segments', 'store.variable_segments'] as const
export function segmentsTargeted(targeting: unknown): string[] {
  const targeted = (targeting as { targeted?: { rules?: { variable: string; op: string; values?: string[] }[][] }[] } | null)?.targeted ?? []
  const out = new Set<string>()
  for (const v of targeted) {
    for (const c of (v.rules ?? []).flat()) {
      if ((SEGMENT_VARIABLES as readonly string[]).includes(c.variable) && (c.op === 'include' || c.op === 'match_exactly')) {
        for (const s of c.values ?? []) out.add(s)
      }
    }
  }
  return [...out]
}
