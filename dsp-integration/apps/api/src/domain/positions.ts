/* Sellable positions (spec §5): every slot owned by Advertiser on a display
   type, across the stores and displays using it. HQ and Stores slots are
   never exposed. A caller sees only positions it could actually buy:
   permissioning is a smaller list, never a rejected request. */
import type { DisplayType, Slot } from '@ph-dsp/types'
import type { Context } from '../context'
import type { PartnerRecord } from '../repos/PartnerRepo'
import { TAKEN } from '../repos/ReservationRepo'
import { advertiserSlug, assignedOf, reservePriceOf, supportedTargetingOf, type Assigned } from '@ph-dsp/types'
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

/* The estate's positions, derived from the display types once per
   display-type snapshot rather than on every call (scalability review,
   24 Sep 2026): every Partner API request started by rebuilding all of
   them, and findPosition then walked the 2,400 positions of a large estate
   to find one. The index is keyed on the snapshot's own records (frozen and
   shared, so identity is exact: a change to any display type gives a new
   snapshot with new records), and lasts exactly as long as the snapshot. A
   display type source that hands out fresh records on every call simply
   never hits it — the same cost as before, never a stale answer. */
interface PositionIndex { count: number; all: readonly PositionRef[]; byId: Map<string, PositionRef> }
const indexes = new WeakMap<DisplayType, PositionIndex>()
function positionIndex(ctx: Context): PositionIndex {
  const list = ctx.displayTypes.list()
  const key = list[0]
  const cached = key ? indexes.get(key) : undefined
  if (cached && cached.count === list.length) return cached
  const all = list.flatMap((dt) =>
    (dt.phExtensions?.slots ?? []).flatMap((def, i) => (def.owner === 'advertiser' ? [{ positionId: positionIdOf(dt.id, i + 1), displayType: dt, slot: i + 1, def }] : [])),
  )
  const index: PositionIndex = { count: list.length, all, byId: new Map(all.map((p) => [p.positionId, p])) }
  if (key) indexes.set(key, index)
  return index
}
/* A copy: callers filter and sort it. */
export const allPositions = (ctx: Context): PositionRef[] => [...positionIndex(ctx).all]
export const findPosition = (ctx: Context, id: string) => positionIndex(ctx).byId.get(id) ?? null

/* assignedOf builds a fresh object each call; a frozen slot (every slot on a
   cached display type) gets its answer once. */
const assigned = new WeakMap<Slot, Assigned>()
function assignedCached(def: Slot): Assigned {
  if (!Object.isFrozen(def)) return assignedOf(def)
  let a = assigned.get(def)
  if (!a) assigned.set(def, (a = Object.freeze(assignedOf(def))))
  return a
}

export type Assignment = 'rtb' | 'whitelist_only' | 'deal' | 'reserved'
export const assignmentOf = (def: Slot): Assignment => {
  const a = assignedCached(def)
  return a.advertisers.length ? 'reserved' : a.buyersListId ? 'deal' : a.whitelistOnly ? 'whitelist_only' : 'rtb'
}
/* Held for one of these advertisers (case-insensitively). */
export const heldFor = (def: Slot, name: string) => assignedCached(def).advertisers.some((a) => a.trim().toLowerCase() === name.trim().toLowerCase())

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
   than accidentally opening the position to every DSP.
   `partners` lets a caller that asks for many positions read the partner
   list once instead of once per deal. */
export function effectivePartnerIds(ctx: Context, def: Slot, partners?: PartnerRecord[]): string[] | null {
  const a = assignedCached(def)
  if (a.buyersListId) {
    const list = ctx.buyersLists.get(a.buyersListId)
    return list ? invitedPartnerIds(list, partners ?? ctx.partners.list()) : []
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
    const list = ctx.buyersLists.get(assignedCached(p.def).buyersListId as string)
    return !!list && isActiveAt(list, ctx.clock().toISOString()) && isInvitedBuyer(list, name, seatId)
  }
  if (a === 'whitelist_only') return isOn(name, eff.allowList)
  return true
}

/* Whether a caller may see each position, with everything that is the
   same for every position — its lists, which of its seats are blocked or
   whitelisted, the partner records a deal resolves against — worked out
   once per request rather than once per position (scalability review,
   24 Sep 2026: the inventory list did it 2,400 times a request on a large
   estate). Same answer as advertiserMayBuy, seat by seat. */
export function visibilityFor(ctx: Context, c: Caller): (p: PositionRef) => boolean {
  if (c.partner.status !== 'connected' || c.unknownAdvertiser) return () => false
  const eff = effectiveLists(c.partner, ctx.company.get())
  const seats = (c.advertiser ? c.partner.seats.filter((s) => s.name === c.advertiser!.name) : c.partner.seats).filter((s) => !isBlocked(s.name, eff))
  const whitelisted = seats.some((s) => isOn(s.name, eff.allowList))
  const me = c.partner.id
  let partners: PartnerRecord[] | undefined
  return (p) => {
    const allowed = effectivePartnerIds(ctx, p.def, (partners ??= ctx.partners.list()))
    if (allowed !== null && !allowed.includes(me)) return false
    const a = assignmentOf(p.def)
    if (a === 'rtb') return seats.length > 0
    if (a === 'whitelist_only') return whitelisted
    if (a === 'reserved') return seats.some((s) => heldFor(p.def, s.name))
    const list = ctx.buyersLists.get(assignedCached(p.def).buyersListId as string)
    if (!list || !isActiveAt(list, ctx.clock().toISOString())) return false
    return seats.some((s) => isInvitedBuyer(list, s.name, s.id))
  }
}

export const isVisible = (ctx: Context, p: PositionRef, c: Caller) => visibilityFor(ctx, c)(p)

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

/* What windowStatus needs that doesn't change from one window to the next.
   Availability over a year asks about 366 windows of the same position;
   working these out once per request instead of once per window is what
   keeps that endpoint (and the forecast) flat as the range grows. `taken`
   is the set of window starts already won or reserved (Test-mode wins
   excluded), read with ONE ranged query instead of one per window — or,
   for a request that asks about every position (the inventory list's
   status filter), taken from `prefetched`: one ranged query for the whole
   estate instead of one per position (review, 24 Sep 2026). */
export interface WindowFacts { next: number; hasDisplays: boolean; taken?: Set<string> }
const NO_WINDOWS: ReadonlySet<string> = new Set()
export function windowFacts(ctx: Context, p: PositionRef, starts?: Date[], prefetched?: Map<string, Set<string>>): WindowFacts {
  const facts: WindowFacts = { next: nextWindow(ctx).getTime(), hasDisplays: ctx.displays.summaryByDisplayType(p.displayType.id).displays > 0 }
  if (prefetched) facts.taken = prefetched.get(p.positionId) ?? (NO_WINDOWS as Set<string>)
  else if (starts?.length) {
    const from = starts[0].toISOString()
    const to = new Date(starts[starts.length - 1].getTime() + 1).toISOString()
    facts.taken = new Set(ctx.reservations.inRange(p.positionId, from, to).filter((r) => !r.testMode && TAKEN.includes(r.status)).map((r) => r.windowStart))
  }
  return facts
}

export function windowStatus(ctx: Context, p: PositionRef, c: Caller, start: Date, f: WindowFacts = windowFacts(ctx, p)): WindowStatus {
  const iso = start.toISOString()
  /* A Test-mode win never takes the window (spec §7: no real spend). */
  const sold = f.taken ? f.taken.has(iso) : ctx.reservations.forWindow(p.positionId, iso).some((r) => !r.testMode && TAKEN.includes(r.status))
  if (sold) return 'sold'
  if (start.getTime() < f.next) return 'unavailable'
  if (!f.hasDisplays) return 'unavailable'
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
  /* Counts, never the display rows (review, 24 Sep 2026). */
  const displays = ctx.displays.summaryByDisplayType(dt.id)
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
    storeCount: displays.stores,
    displayCount: displays.displays,
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
