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

/* Milliseconds of [a, b) the store is open. */
function openMs(a: number, b: number, h: Hours): number {
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
    const ms = openMs(Math.max(a, ws), Math.min(b, ws + windowMs), h)
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
