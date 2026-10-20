/* Programmatic guaranteed deals book whole days at a flat rate per day (Rob, 20 Oct 2026; the DOOH full-day takeover
   standard). The rate is for one 24-hour day on one slot. Its equivalent CPM is rate per day / forecast impressions per
   day x 1000, so a DSP can compare it with a CPM deal. The forecast is the slot's own (VAC-d assumed views), so the
   equivalent CPM exists only once the deal is assigned to a slot: a new deal has none until it is assigned in Available
   Inventory. It is derived on read and never stored. */
import { assignedOf } from '@ph-dsp/types'
import type { Context } from '../context'
import { floorFor } from '../exchange/enforcement'
import { allPositions, assumedViewsPerWindow, windowHoursFor, type PositionRef } from './positions'

export const HOURS_PER_DAY = 24
export const roundCpm = (n: number) => Math.round(n * 100) / 100

export interface PerDaySlot { positionId: string; forecastPerDay: number; equivalentCpm: number; floorCpm: number }

/* Forecast impressions a slot gives in one day: its window's assumed views scaled to 24 hours (the window is 24 hours by default, so the figure is the window's own). */
export const forecastPerDayOf = async (ctx: Context, p: PositionRef): Promise<number> =>
  Math.round(((await assumedViewsPerWindow(ctx, p)) * HOURS_PER_DAY) / windowHoursFor(p))

/* One entry per assigned slot that has a forecast; an unscored slot has none and is left out rather than priced at nothing. */
export async function perDaySlotsOf(ctx: Context, list: { id: string; ratePerDay?: number | null }): Promise<PerDaySlot[]> {
  if (list.ratePerDay == null) return []
  const out: PerDaySlot[] = []
  for (const p of (await allPositions(ctx)).filter((q) => assignedOf(q.def).buyersListIds.includes(list.id))) {
    const forecastPerDay = await forecastPerDayOf(ctx, p)
    if (forecastPerDay <= 0) continue
    out.push({ positionId: p.positionId, forecastPerDay, equivalentCpm: (list.ratePerDay / forecastPerDay) * 1000, floorCpm: await floorFor(ctx, null, { buyersListId: list.id, position: p }) })
  }
  return out
}

/* The range across the assigned slots, or null while there is none to forecast from. */
export const equivalentCpmRange = (slots: PerDaySlot[]): { min: number; max: number } | null =>
  slots.length ? { min: roundCpm(Math.min(...slots.map((s) => s.equivalentCpm))), max: roundCpm(Math.max(...slots.map((s) => s.equivalentCpm))) } : null

/* Reasons a per-day rate cannot be sold: the slots where its equivalent CPM is under that slot's floor. */
export const belowFloorReasons = (ratePerDay: number, slots: PerDaySlot[]): string[] =>
  slots.filter((s) => s.equivalentCpm < s.floorCpm).map((s) =>
    `${ratePerDay} USD per day is ${roundCpm(s.equivalentCpm)} CPM on ${s.positionId} (${s.forecastPerDay.toLocaleString('en-GB')} forecast impressions a day), below its floor of ${s.floorCpm} CPM. Raise the rate to at least ${Math.ceil((s.floorCpm * s.forecastPerDay) / 10) / 100} USD per day.`)
