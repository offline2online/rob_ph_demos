/* Sellable positions (spec §5): every slot owned by Advertiser on a display
   type, across the stores and displays using it. HQ and Stores slots are
   never exposed. A caller sees only positions it could actually buy:
   permissioning is a smaller list, never a rejected request. */
import type { DisplayType, Slot } from '@ph-dsp/types'
import type { Context } from '../context'
import type { PartnerRecord } from '../repos/PartnerRepo'
import { TAKEN } from '../repos/ReservationRepo'
import { advertiserSlug } from '@ph-dsp/types'
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

export type Assignment = 'rtb' | 'whitelist_only' | 'reserved'
export const assignmentOf = (def: Slot): Assignment => (def.advertiser ? 'reserved' : def.listMode === 'whitelist_only' ? 'whitelist_only' : 'rtb')

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

/* May this advertiser (by name) buy this position through this partner? */
export function advertiserMayBuy(ctx: Context, p: PositionRef, partner: PartnerRecord, name: string) {
  const eff = effectiveLists(partner, ctx.company.get())
  if (isBlocked(name, eff)) return false
  const a = assignmentOf(p.def)
  if (a === 'reserved') return (p.def.advertiser as string).trim().toLowerCase() === name.trim().toLowerCase()
  if (a === 'whitelist_only') return isOn(name, eff.allowList)
  return true
}

export function isVisible(ctx: Context, p: PositionRef, c: Caller) {
  if (c.partner.status !== 'connected' || c.unknownAdvertiser) return false
  if (p.def.partnerId && p.def.partnerId !== c.partner.id) return false
  const names = c.advertiser ? [c.advertiser.name] : c.partner.seats.map((s) => s.name)
  return names.some((n) => advertiserMayBuy(ctx, p, c.partner, n))
}

/* ------------------------------------------------------------ play windows */

const DAY = 86_400_000
export const windowMs = (ctx: Context) => ctx.config.playWindowHours * 3_600_000

/* Windows are aligned to UTC midnight (Q27: 24 hours). */
export function windowStartOf(ctx: Context, at: Date) {
  const len = windowMs(ctx)
  return new Date(Math.floor(at.getTime() / len) * len)
}
/* The first window that can still be sold: the one after the current one. */
export const nextWindow = (ctx: Context) => new Date(windowStartOf(ctx, ctx.clock()).getTime() + windowMs(ctx))

/* The auction's bidding window for a play window (Q13): it opens
   `auctionOpensHours` before the play window starts and closes
   `auctionLeadHours` before, when the scheduled auction clears it. */
export const biddingOpensAt = (ctx: Context, start: Date) => new Date(start.getTime() - ctx.config.auctionOpensHours * 3_600_000)
export const biddingClosesAt = (ctx: Context, start: Date) => new Date(start.getTime() - ctx.config.auctionLeadHours * 3_600_000)

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
  if (start.getTime() < nextWindow(ctx).getTime()) return 'unavailable'
  if (!ctx.displays.listByDisplayType(p.displayType.id).length) return 'unavailable'
  /* A Test-mode win never takes the window (spec §7: no real spend). */
  if (ctx.reservations.forWindow(p.positionId, start.toISOString()).some((r) => !r.testMode && TAKEN.includes(r.status))) return 'sold'
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
    storeCount: new Set(displays.map((d) => d.store)).size,
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
    assumedViewsPerWindow: ctx.audience.forSlot(dt.id, p.slot).assumedViewsPerWindow,
    pricing: { currency: company.currency, floorCpm: company.floorCpm, effectiveFloorCpm: effectiveFloors(company, multiplier) },
  }
}
