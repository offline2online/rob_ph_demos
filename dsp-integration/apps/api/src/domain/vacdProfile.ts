/* Hour-of-week VAC-d (ticket L0lA4mMgRdA7YTcQpGxg, 16 Oct 2026). A display's
   assumed views are not flat across the week: 168 hourly values, Monday 00:00
   UTC first (this POC has no store time zones, like dailyCapacity). The bid
   request's impression multiplier is the sum of the hours the play window
   covers, so the same display quotes a different multiplier at 3am than at
   noon, and the window and daily figures are sums of the same hours.
   A display with no profile of its own follows its type's defaultVacd (assumed
   views per default billing unit), spread evenly: its window sums are what
   the flat figure always gave. */
import { PLATFORM_DEFAULT_BILLING_UNIT_HOURS } from '@ph-dsp/types'

const HOUR = 3_600_000
export const HOURS_PER_WEEK = 168
export type VacdProfile = readonly number[]

/* 1970-01-01 was a Thursday: shift so index 0 is Monday 00:00 UTC. */
const MONDAY_OFFSET_HOURS = 3 * 24
export const hourOfWeek = (ms: number): number => (((Math.floor(ms / HOUR) + MONDAY_OFFSET_HOURS) % HOURS_PER_WEEK) + HOURS_PER_WEEK) % HOURS_PER_WEEK

export const flatProfile = (defaultVacd: number): number[] => Array<number>(HOURS_PER_WEEK).fill(defaultVacd / PLATFORM_DEFAULT_BILLING_UNIT_HOURS)

export const isValidProfile = (v: unknown): v is number[] => Array.isArray(v) && v.length === HOURS_PER_WEEK && v.every((x) => typeof x === 'number' && Number.isFinite(x) && x >= 0)

export function parseProfile(raw: string | null | undefined): number[] | null {
  if (!raw) return null
  try {
    const v: unknown = JSON.parse(raw)
    return isValidProfile(v) ? v : null
  } catch { return null }
}

/* Assumed views over [a, b): the hours the window covers, a part-hour pro rata. */
export function vacdInWindow(profile: VacdProfile, a: number, b: number): number {
  let sum = 0
  for (let t = Math.floor(a / HOUR) * HOUR; t < b; t += HOUR) {
    sum += profile[hourOfWeek(t)] * ((Math.min(b, t + HOUR) - Math.max(a, t)) / HOUR)
  }
  return sum
}

/* A day's assumed views: the 24 hours of that UTC day. */
export const vacdInDay = (profile: VacdProfile, dayStartMs: number): number => vacdInWindow(profile, dayStartMs, dayStartMs + 24 * HOUR)

/* A starting profile shaped by trading hours: the same total over the week as
   the flat figure, with hours outside `open`..`close` carrying `quietShare` of
   an open hour. An external screen is never at zero after hours: pass the
   street / mall share (EXTERNAL_QUIET_SHARE), not 0. */
export const INTERNAL_QUIET_SHARE = 0.2
export const EXTERNAL_QUIET_SHARE = 0.6
export function shapedProfile(defaultVacd: number, hours: { open: number; close: number }, quietShare: number): number[] {
  const open = (h: number) => h >= hours.open && h < hours.close
  const weights = Array.from({ length: HOURS_PER_WEEK }, (_, i) => (open(i % 24) ? 1 : quietShare))
  const total = weights.reduce((s, w) => s + w, 0)
  const budget = defaultVacd * (HOURS_PER_WEEK / PLATFORM_DEFAULT_BILLING_UNIT_HOURS)
  return weights.map((w) => (w * budget) / total)
}
