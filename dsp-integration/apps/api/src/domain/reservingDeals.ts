/* Reserving deals never compete (decision Rob, 22 Oct 2026). Programmatic guaranteed and Direct advertiser deals both sell a
   slot outright for their flight, so a slot cannot hold two of them (in any combination) with overlapping flight dates.
   Non-overlapping terms on one slot are fine (PG in November, Direct in December). The check is made when a deal is
   assigned to a slot (Available Inventory, PUT /admin/v1/available-inventory) and when a deal's flight dates are edited;
   the UI asks the same question before saving (POST /admin/v1/reserving-conflicts) so the warning shows first. */
import { DIRECT_PARTNER_ID, assignedOf, isGuaranteedLike, type BuyersList, type DisplayType, type ReservingConflict } from '@ph-dsp/types'
import type { Context } from '../context'
import { positionIdOf } from './positions'

export type Flight = Pick<BuyersList, 'dealType' | 'activeFrom' | 'activeTo'>

export const isReserving = (l: Pick<BuyersList, 'dealType'>) => isGuaranteedLike(l.dealType)

/* The span two flights share, on the real start and end instants to the millisecond (22 Oct 2026). An end is the moment the flight stops, so one that ends where another starts does not overlap; a missing bound is open-ended. Null when they do not meet. `from` / `to` are the days, `fromAt` / `toAt` the exact moments. */
export function flightOverlap(a: Pick<Flight, 'activeFrom' | 'activeTo'>, b: Pick<Flight, 'activeFrom' | 'activeTo'>): { from: string | null; to: string | null; fromAt: string | null; toAt: string | null } | null {
  const lo = (x: string | null) => (x ? Date.parse(x) : -Infinity)
  const hi = (x: string | null) => (x ? Date.parse(x) : Infinity)
  const from = Math.max(lo(a.activeFrom), lo(b.activeFrom))
  const to = Math.min(hi(a.activeTo), hi(b.activeTo))
  if (from >= to) return null
  const at = (n: number) => (Number.isFinite(n) ? new Date(n).toISOString() : null)
  return { from: at(from)?.slice(0, 10) ?? null, to: at(to)?.slice(0, 10) ?? null, fromAt: at(from), toAt: at(to) }
}

/* The advertiser a deal is sold to: its one named buyer, by name where it can be resolved. */
export async function advertiserNameOf(ctx: Context, list: Pick<BuyersList, 'invitedBuyers'>): Promise<string> {
  const b = list.invitedBuyers[0]
  if (!b) return 'no advertiser yet'
  if (b.partnerId === DIRECT_PARTNER_ID) return (await ctx.company.directAdvertisers()).find((d) => d.advertiserId === b.seatId)?.name ?? b.seatId
  return (await ctx.partners.get(b.partnerId))?.seats.find((s) => s.id === b.seatId)?.name ?? b.seatId
}

/* A moment as the warning shows it: just the day at a day's start or end (so a whole-day deal reads as before), the day and minute otherwise. Read as saved, not converted to the browser's zone. */
const momentText = (iso: string | null, open: string) => (iso == null ? open : iso.endsWith('T00:00:00.000Z') || iso.endsWith('T23:59:59.999Z') ? iso.slice(0, 10) : `${iso.slice(0, 10)} ${iso.slice(11, 16)}`)
export const rangeText = (from: string | null, to: string | null, fromAt: string | null = from, toAt: string | null = to) => {
  const a = momentText(fromAt, 'the start'), z = momentText(toAt, 'no end date')
  return from && to && from === to && a.length === 10 && z.length === 10 ? from : `${a} to ${z}`
}

/* Every other reserving deal on the slot that `deal` (with this flight) overlaps. `others` are the deal IDs already on the slot. */
export async function slotConflicts(ctx: Context, deal: { id: string } & Flight, dt: DisplayType, slot: number, others: readonly string[]): Promise<ReservingConflict[]> {
  if (!isReserving(deal)) return []
  const out: ReservingConflict[] = []
  for (const id of new Set(others)) {
    if (id === deal.id) continue
    const other = await ctx.buyersLists.get(id)
    if (!other || !isReserving(other)) continue
    const over = flightOverlap(deal, other)
    if (!over) continue
    const advertiser = await advertiserNameOf(ctx, other)
    const label = dt.phExtensions?.slots?.[slot - 1]?.label?.trim()
    out.push({
      dealId: other.id, dealName: other.name, dealCode: other.dealId, advertiser,
      displayTypeId: dt.id, playlist: dt.name, slot, slotLabel: label || null, positionId: positionIdOf(dt.id, slot),
      overlapFrom: over.from, overlapTo: over.to, overlapFromAt: over.fromAt, overlapToAt: over.toAt,
      message: `${other.name} (${advertiser}) already holds ${dt.name}, slot ${slot}${label ? ` (${label})` : ''}: this slot is already sold for ${rangeText(over.from, over.to, over.fromAt, over.toAt)}. Change the dates or the slot.`,
    })
  }
  return out
}

/* Where a deal sits now: every slot it is assigned to, with the other deals on each. */
export async function dealSlots(ctx: Context, listId: string): Promise<{ dt: DisplayType; slot: number; others: string[] }[]> {
  return (await ctx.displayTypes.list()).flatMap((dt) =>
    (dt.phExtensions?.slots ?? []).flatMap((s, i) => {
      const ids = assignedOf(s).buyersListIds
      return ids.includes(listId) ? [{ dt, slot: i + 1, others: ids.filter((x) => x !== listId) }] : []
    }),
  )
}

/* The deal's conflicts across all of its current slots, for a flight edit. */
export async function flightConflicts(ctx: Context, deal: { id: string } & Flight): Promise<ReservingConflict[]> {
  const out: ReservingConflict[] = []
  for (const s of await dealSlots(ctx, deal.id)) out.push(...(await slotConflicts(ctx, deal, s.dt, s.slot, s.others)))
  return out
}
