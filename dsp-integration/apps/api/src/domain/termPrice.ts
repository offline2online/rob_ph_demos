/* A programmatic guaranteed deal covers a whole delivery term (activeFrom to activeTo; Rob, 21 Oct 2026, replacing the
   flat rate per day of 20 Oct): one deal per flight, a single day being a one-day term. Two figures follow from the
   slots the deal is assigned to, both derived on read or on a slot/term change and never typed in:
     - committed plays = floor( sum over the assigned slots of forecast plays per day x days in the term x (1 - buffer%) );
     - the price, a fixed CPM (floorCpm) or a total for the term (termTotal, USD), whose equivalent CPM is
       termTotal / forecast impressions over the term x 1000, so a DSP can compare it with a CPM deal.
   The forecast is the slot's own: plays from its loop and window over the display type's displays and open hours, impressions
   from its assumed views (VAC-d). Nothing is invented for an unscored slot: it has no impressions forecast and is left out of the CPM. */
import { assignedOf } from '@ph-dsp/types'
import type { Context } from '../context'
import { floorFor } from '../exchange/enforcement'
import { allPositions, assumedViewsPerWindow, maxPlayLengthSecFor, windowHoursFor, windowMsFor, type PositionRef } from './positions'
import { hourGroups, openHoursPerDayOf } from './operatingGate'
import { playsPerWindowOpenOf } from './plays'
import { rotationSizeOf } from './slots'

export const HOURS_PER_DAY = 24
export const roundCpm = (n: number) => Math.round(n * 100) / 100

/* Calendar days in the term, both ends included (UTC dates, so 1 to 30 Nov is 30 and one day is 1). Null while either end is open: an open term has no volume to commit. */
export const termDaysOf = (activeFrom: string | null | undefined, activeTo: string | null | undefined): number | null => {
  if (!activeFrom || !activeTo) return null
  const from = Date.parse(activeFrom.slice(0, 10)), to = Date.parse(activeTo.slice(0, 10))
  if (Number.isNaN(from) || Number.isNaN(to) || to < from) return null
  return Math.round((to - from) / 86_400_000) + 1
}

/* Forecast impressions a slot gives in one day: its window's assumed views scaled to 24 hours. */
export const forecastPerDayOf = async (ctx: Context, p: PositionRef): Promise<number> =>
  Math.round(((await assumedViewsPerWindow(ctx, p)) * HOURS_PER_DAY) / windowHoursFor(p))

/* Forecast plays a slot gives in one day across the display type's displays: plays per window (loop length, open hours) x displays x windows a day. */
export async function forecastPlaysPerDayOf(ctx: Context, p: PositionRef): Promise<number> {
  const company = await ctx.company.get()
  const displays = await ctx.displays.listByDisplayType(p.displayType.id)
  const stores = new Map((await ctx.stores.list()).map((s) => [s.id, s]))
  const openHours = openHoursPerDayOf(hourGroups(p.displayType.phExtensions?.storeZone, displays, stores))
  const perWindow = playsPerWindowOpenOf(windowMsFor(p), maxPlayLengthSecFor(company.maxPlayLengthSec, p), rotationSizeOf(p.displayType, p.slot), openHours) * displays.length
  return Math.round((perWindow * HOURS_PER_DAY) / windowHoursFor(p))
}

export interface TermSlot { positionId: string; playsPerDay: number; impressionsPerDay: number; floorCpm: number }

/* One entry per slot the deal is assigned to. */
export async function termSlotsOf(ctx: Context, listId: string): Promise<TermSlot[]> {
  const out: TermSlot[] = []
  for (const p of (await allPositions(ctx)).filter((q) => assignedOf(q.def).buyersListIds.includes(listId))) {
    out.push({ positionId: p.positionId, playsPerDay: await forecastPlaysPerDayOf(ctx, p), impressionsPerDay: await forecastPerDayOf(ctx, p), floorCpm: await floorFor(ctx, null, { buyersListId: listId, position: p }) })
  }
  return out
}

/* floor( total forecast plays of every assigned slot over the whole term x (1 - buffer%) ), or null while there is no slot, no closed term or nothing to commit. */
export const committedPlaysOf = (slots: readonly TermSlot[], days: number | null, bufferPct: number): number | null => {
  if (!slots.length || !days) return null
  const total = slots.reduce((n, s) => n + s.playsPerDay, 0) * days
  const committed = Math.floor(total * (1 - bufferPct / 100) + 1e-9)
  return committed >= 1 ? committed : null
}

/* The slots that have an impressions forecast; an unscored one is left out rather than priced at nothing. */
const scored = (slots: readonly TermSlot[]) => slots.filter((s) => s.impressionsPerDay > 0)
const impressionsOver = (slots: readonly TermSlot[], days: number) => scored(slots).reduce((n, s) => n + s.impressionsPerDay, 0) * days

/* The total for the term as a CPM across the assigned slots, or null with no forecast or term to price against. */
export const equivalentCpmOf = (termTotal: number, slots: readonly TermSlot[], days: number | null): number | null => {
  if (!days) return null
  const imps = impressionsOver(slots, days)
  return imps > 0 ? roundCpm((termTotal / imps) * 1000) : null
}

/* The range shape the API reports; one blended figure, so min and max are the same. */
export const equivalentCpmRange = (cpm: number | null): { min: number; max: number } | null => (cpm == null ? null : { min: cpm, max: cpm })

/* Reasons a total for the term cannot be sold: below what the term's forecast impressions are worth at each slot's own floor. */
export const belowFloorReasons = (termTotal: number, slots: readonly TermSlot[], days: number | null): string[] => {
  if (!days) return []
  const need = scored(slots).reduce((n, s) => n + (s.impressionsPerDay * days * s.floorCpm) / 1000, 0)
  if (!need || termTotal >= need) return []
  const cpm = equivalentCpmOf(termTotal, slots, days)
  return [`${termTotal} USD for the term is ${cpm} CPM across its assigned slots (${impressionsOver(slots, days).toLocaleString('en-GB')} forecast impressions over ${days} day${days === 1 ? '' : 's'}), below their floors. Raise the total to at least ${Math.ceil(need * 100) / 100} USD.`]
}
