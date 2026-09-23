/* Sellable positions (spec §5): every slot owned by Advertiser on a display
   type, across the stores and displays using it. HQ and Stores slots are
   never exposed. A caller sees only positions it could actually buy:
   permissioning is a smaller list, never a rejected request. */
import type { DisplayType, Slot } from '@ph-dsp/types'
import type { Context } from '../context'
import type { PartnerRecord } from '../repos/PartnerRepo'
import { TAKEN } from '../repos/ReservationRepo'
import { advertiserSlug, assignedOf, reservePriceOf, supportedTargetingOf } from '@ph-dsp/types'
import { invitedPartnerIds, isActiveAt, isInvitedBuyer } from './buyersLists'
import { effectiveLists, isBlocked, isOn } from './lists'
import { effectiveFloors } from './pricing'
import { slotCountOf, slotDurationSec } from './slots'

export interface PositionRef {
  positionId: string
  displayType: DisplayType
  /* 1-based, as shown on the display type. */
  slot: number
  def: Slot
}

export const positionIdOf = (displayTypeId: string, slot: number) => `${displayTypeId}.s${slot}`

export function allPositions(ctx: Context): PositionRef[] {
  return ctx.displayTypes.list().flatMap((dt) =>
    (dt.phExtensions?.slots ?? []).flatMap((def, i) => (def.owner === 'advertiser' ? [{ positionId: positionIdOf(dt.id, i + 1), displayType: dt, slot: i + 1, def }] : [])),
  )
}
export const findPosition = (ctx: Context, id: string) => allPositions(ctx).find((p) => p.positionId === id) ?? null

export type Assignment = 'rtb' | 'whitelist_only' | 'deal' | 'reserved'
export const assignmentOf = (def: Slot): Assignment => {
  const a = assignedOf(def)
  return a.advertisers.length ? 'reserved' : a.buyersListId ? 'deal' : a.whitelistOnly ? 'whitelist_only' : 'rtb'
}
/* Held for one of these advertisers (case-insensitively). */
export const heldFor = (def: Slot, name: string) => assignedOf(def).advertisers.some((a) => a.trim().toLowerCase() === name.trim().toLowerCase())

/* Who is asking: the partner, and optionally one of its advertisers (seats). */
export interface Caller {
  partner: PartnerRecord
  /* The advertiser's seat name when advertiserId was given and is one of the partner's. */
  advertiser: { id: string; name: string } | null
  /* advertiserId was given but isn't one of the partner's advertisers. */
  unknownAdvertiser: boolean
}

export function callerOf(partner: PartnerRecord, advertiserId: string | undefined): Caller {
  if (!advertiserId) return { partner, advertiser: null, unknownAdvertiser: false }
  const seat = partner.seats.find((s) => advertiserSlug(s.name) === advertiserId)
  return { partner, advertiser: seat ? { id: advertiserId, name: seat.name } : null, unknownAdvertiser: !seat }
}

/* The DSPs a position's bid requests actually go to. null means
   unrestricted (any connected DSP) — the raw partnerIds choice when it's
   empty. A non-null array always means "exactly these, possibly none": the
   raw partnerIds choice when it's non-empty, or — for a private auction
   (deal) — whichever DSPs currently have a seat among the buyers list's
   invited buyers, resolved live so an edit to the list takes effect on
   every slot it's attached to without having to re-save each one. Unlike
   rtb/whitelist_only, a deal is never "unrestricted": one whose buyers list
   was deleted, or whose invited buyers currently match no connected DSP,
   resolves to an empty (not null) array, correctly admitting nobody rather
   than accidentally opening the position to every DSP. */
export function effectivePartnerIds(ctx: Context, def: Slot): string[] | null {
  const a = assignedOf(def)
  if (a.buyersListId) {
    const list = ctx.buyersLists.get(a.buyersListId)
    return list ? invitedPartnerIds(list, ctx.partners.list()) : []
  }
  return a.partnerIds.length ? a.partnerIds : null
}

/* May this advertiser (by name, and — for a deal — its DSP seat ID) buy this
   position through this partner? */
export function advertiserMayBuy(ctx: Context, p: PositionRef, partner: PartnerRecord, name: string, seatId?: string | null) {
  const eff = effectiveLists(partner, ctx.company.get())
  if (isBlocked(name, eff)) return false
  const a = assignmentOf(p.def)
  if (a === 'reserved') return heldFor(p.def, name)
  if (a === 'deal') {
    const list = ctx.buyersLists.get(assignedOf(p.def).buyersListId as string)
    return !!list && isActiveAt(list, ctx.clock().toISOString()) && isInvitedBuyer(list, name, seatId)
  }
  if (a === 'whitelist_only') return isOn(name, eff.allowList)
  return true
}

export function isVisible(ctx: Context, p: PositionRef, c: Caller) {
  if (c.partner.status !== 'connected' || c.unknownAdvertiser) return false
  const allowed = effectivePartnerIds(ctx, p.def)
  if (allowed !== null && !allowed.includes(c.partner.id)) return false
  const seats = c.advertiser ? c.partner.seats.filter((s) => s.name === c.advertiser!.name) : c.partner.seats
  return seats.some((s) => advertiserMayBuy(ctx, p, c.partner, s.name, s.id))
}

/* ------------------------------------------------------------ play windows */

const DAY = 86_400_000
/* The play-window length (Advertiser settings → Auction schedule; Q27). */
export const windowMs = (ctx: Context) => ctx.company.get().playWindowHours * 3_600_000

/* Windows start at UTC midnight and follow each other back to back from a
   fixed Monday, so a 24-hour window is a day and a 7-day window a week. */
const ANCHOR = Date.UTC(1970, 0, 5)
export function windowStartOf(ctx: Context, at: Date) {
  const len = windowMs(ctx)
  return new Date(ANCHOR + Math.floor((at.getTime() - ANCHOR) / len) * len)
}

/* The auction for a play window (Auction schedule, Q13): bidding closes at
   the last daily cutoff (UTC) at or before the window starts, when the
   auction runs, and opens `auctionOpensHours` before that. */
export function biddingClosesAt(ctx: Context, start: Date) {
  const [h, m] = ctx.company.get().auctionCutoffTime.split(':').map(Number)
  const d = new Date(start)
  const cutoff = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), h, m)
  return new Date(cutoff > start.getTime() ? cutoff - 86_400_000 : cutoff)
}
export const biddingOpensAt = (ctx: Context, start: Date) => new Date(biddingClosesAt(ctx, start).getTime() - ctx.company.get().auctionOpensHours * 3_600_000)

/* The first window that can still be sold: its auction hasn't run yet. */
export function nextWindow(ctx: Context) {
  const now = ctx.clock().getTime()
  let w = windowStartOf(ctx, ctx.clock())
  while (now >= biddingClosesAt(ctx, w).getTime()) w = new Date(w.getTime() + windowMs(ctx))
  return w
}

/* Every window starting within [from, to] (dates, inclusive). */
export function windowsBetween(ctx: Context, from: string, to: string): Date[] | null {
  const a = Date.parse(`${from}T00:00:00Z`)
  const b = Date.parse(`${to}T00:00:00Z`) + DAY
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a || b - a > 366 * DAY) return null
  const len = windowMs(ctx)
  const out: Date[] = []
  for (let t = Math.ceil(a / len) * len; t < b; t += len) out.push(new Date(t))
  return out
}

export type WindowStatus = 'available' | 'reserved' | 'sold' | 'unavailable'

export function windowStatus(ctx: Context, p: PositionRef, c: Caller, start: Date): WindowStatus {
  /* A Test-mode win never takes the window (spec §7: no real spend). */
  if (ctx.reservations.forWindow(p.positionId, start.toISOString()).some((r) => !r.testMode && TAKEN.includes(r.status))) return 'sold'
  if (start.getTime() < nextWindow(ctx).getTime()) return 'unavailable'
  if (!ctx.displays.listByDisplayType(p.displayType.id).length) return 'unavailable'
  /* Held for a named advertiser: available only to that advertiser. */
  if (assignmentOf(p.def) === 'reserved' && !c.advertiser) return 'reserved'
  return 'available'
}

/* -------------------------------------------------------------- the view */

export function loopLengthSec(ctx: Context, dt: DisplayType) {
  const venue = dt.phExtensions?.venue?.loopLengthSec
  if (venue) return venue
  const pl = dt.defaultPlaylistId ? ctx.playlists.get(dt.defaultPlaylistId) : null
  return ((pl?.items ?? []) as { enabled?: boolean; playbackDuration?: number }[]).filter((i) => i.enabled !== false).reduce((n, i) => n + (i.playbackDuration ?? 0), 0)
}

export function positionView(ctx: Context, p: PositionRef, c: Caller) {
  const dt = p.displayType
  const displays = ctx.displays.listByDisplayType(dt.id)
  const n = slotCountOf(dt)
  const loop = loopLengthSec(ctx, dt)
  const company = ctx.company.get()
  const multiplier = c.advertiser ? ctx.company.advertiserSetting(c.advertiser.id).floorMultiplier : 1
  const venue = dt.phExtensions?.venue
  return {
    positionId: p.positionId,
    displayTypeId: dt.id,
    displayTypeName: dt.name,
    slot: p.slot,
    slotLabel: p.def.label,
    zone: null,
    storeCount: new Set(displays.map((d) => d.storeId)).size,
    displayCount: displays.length,
    screen: {
      width: dt.displayCanvasSize.width,
      height: dt.displayCanvasSize.height,
      orientation: venue?.orientation ?? (dt.displayCanvasSize.width >= dt.displayCanvasSize.height ? 'landscape' : 'portrait'),
      slotDurationSec: slotDurationSec(dt) ?? (n ? loop / n : loop),
      loopLengthSec: loop,
      shareOfVoice: n ? Math.round((1 / n) * 1000) / 1000 : 1,
      ...(venue?.openOohVenueType ? { openOohVenueType: venue.openOohVenueType } : {}),
    },
    assignment: assignmentOf(p.def),
    /* What a campaign may use here (Rob, 20 Sep); localised only by default. */
    supportedTargeting: supportedTargetingOf(p.def),
    assumedViewsPerWindow: ctx.audience.forSlot(dt.id, p.slot).assumedViewsPerWindow,
    pricing: { currency: company.currency, floorCpm: company.floorCpm, effectiveFloorCpm: effectiveFloors(company, multiplier), costPerEngagement: company.interactiveCpe },
    reservePrice: reservePriceOf(dt, p.def),
  }
}
