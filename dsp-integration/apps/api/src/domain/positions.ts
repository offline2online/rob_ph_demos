/* Sellable positions (spec §5): every slot owned by Advertiser on a display
   type, across the stores and displays using it. HQ and Stores slots are
   never exposed. A caller sees only positions it could actually buy:
   permissioning is a smaller list, never a rejected request. */
import type { DisplayType, Slot } from '@ph-dsp/types'
import type { Context } from '../context'
import type { PartnerRecord } from '../repos/PartnerRepo'
import { prepared } from '../db/db'
import { type ReservationStatus, TAKEN } from '../repos/ReservationRepo'
import { advertiserSlug, assignedOf, billingUnitHoursOf, reservePriceOf, supportedTargetingOf, type Assigned } from '@ph-dsp/types'
import { invitedPartnerIds, isInvitedBuyer } from './buyersLists'
import { isActiveAt, lockedTermSpan } from '../billing/term'
import { effectiveLists, isBlocked, isOn } from './lists'
import { effectiveFloors } from './pricing'
import { rotationSizeOf, slotDurationSec } from './slots'

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
    if (!isSellable(ctx, p)) return false
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
const HOUR = 3_600_000
/* A position's play-window length, in hours — its billing unit (OQ27,
   decision Rob 29 Sep 2026: the per-slot Billing unit is the source of
   truth for window length and billing granularity). Override always wins:
   the slot's own billingUnitHours, else its display type's default, else
   the company-wide play window (Advertiser settings → Auction schedule;
   Q27), which is now only the default a slot inherits. The company value
   is always set (platform default 24), so the platform default is reached
   through it. Without a position: the company value, for the few callers
   that genuinely mean "the company default". */
export const windowHoursOf = (ctx: Context, p?: PositionRef | null): number =>
  p ? billingUnitHoursOf(p.displayType, p.def, ctx.company.get().playWindowHours) : ctx.company.get().playWindowHours
export const windowMs = (ctx: Context, p?: PositionRef | null) => windowHoursOf(ctx, p) * HOUR
/* Does this position follow the company-wide play window (neither the slot
   nor its display type sets a billing unit)? Only these are resized by a
   playWindowHours change, so only their windows defer one (scheduler.ts
   promotePendingPlayWindowIfDue). */
export const followsCompanyWindow = (p: PositionRef) => p.def.billingUnitHours == null && p.displayType.phExtensions?.billingUnitHours == null
/* The shortest play window any position (or the company default) has: the
   finest grid every position's windows can be read against — billing's
   "has anything ended yet" query and the booking schedule's columns. */
export const shortestWindowMs = (ctx: Context) => Math.min(windowMs(ctx), ...allPositions(ctx).map((p) => windowMs(ctx, p)))
/* The longest: how far back a window still running now can have started. */
export const longestWindowMs = (ctx: Context) => Math.max(windowMs(ctx), ...allPositions(ctx).map((p) => windowMs(ctx, p)))
/* When a reservation's window ends: its start plus its position's window
   length (the company default for a position no longer in the estate). */
export const windowEndOf = (ctx: Context, r: { positionId: string; windowStart: string }) => Date.parse(r.windowStart) + windowMs(ctx, findPosition(ctx, r.positionId))

/* Windows still bid on or booked (live, not Test mode) that a change to
   the company-wide play window would have to resize: those on positions
   that follow it (or that have since left the estate, conservatively).
   Same "active" read the deferral has always used — a window starting now
   or later (routes/admin/advertiserSettings.ts, scheduler.ts). */
export function companyWindowCommitments(ctx: Context) {
  return ctx.reservations.byStatus(['pending', 'won', 'reserved'], ctx.clock().toISOString()).filter((r) => {
    if (r.testMode) return false
    const p = findPosition(ctx, r.positionId)
    return !p || followsCompanyWindow(p)
  })
}

/* A slot's own windows still bid on or booked (live, not Test mode) that
   haven't finished playing, `len` being its current window length — what
   a change to its billing unit would resize (routes/admin/
   advertiserSettings.ts refuses the change while there are any). A window
   that has played but isn't billed yet counts too: billing reads its
   length when it bills it. */
export function slotWindowCommitments(ctx: Context, positionId: string, len: number) {
  const now = ctx.clock().getTime()
  /* A window already billed is over, whatever length it is read at now. */
  const billed = (id: string) => !!prepared(ctx.db, 'SELECT 1 FROM billing_line_items WHERE reservation_id = ?').get(id)
  const live = ctx.reservations.inRange(positionId, new Date(now - len).toISOString(), '9999')
    .filter((r) => !r.testMode && ['pending', 'won', 'reserved'].includes(r.status) && Date.parse(r.windowStart) + len > now && !billed(r.id))
  const unbilled = ctx.reservations.billable(new Date(now).toISOString()).filter((r) => r.positionId === positionId && !live.some((x) => x.id === r.id))
  return [...live, ...unbilled]
}

/* Windows start at UTC midnight and follow each other back to back from a
   fixed Monday, so a 24-hour window is a day and a 7-day window a week.
   Every length is laid from the same anchor (OQ27): a weekly slot's window
   starts on a Monday that is also a daily slot's window start, so one
   auction (keyed on its start) clears both. `len` is the window length in
   ms — windowMs(ctx, p) for a position, the company default otherwise. */
const ANCHOR = Date.UTC(1970, 0, 5)
export function windowStartOf(ctx: Context, at: Date, len = windowMs(ctx)) {
  return new Date(ANCHOR + Math.floor((at.getTime() - ANCHOR) / len) * len)
}

/* The auction for a play window (Auction schedule, Q13): bidding closes at
   the last daily cutoff (UTC) at or before the window starts, when the
   auction runs, and opens `auctionOpensHours` before that. The same for a
   window of any length: it depends only on when the window starts. */
export function biddingClosesAt(ctx: Context, start: Date) {
  const [h, m] = ctx.company.get().auctionCutoffTime.split(':').map(Number)
  const d = new Date(start)
  const cutoff = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), h, m)
  return new Date(cutoff > start.getTime() ? cutoff - 86_400_000 : cutoff)
}
export const biddingOpensAt = (ctx: Context, start: Date) => new Date(biddingClosesAt(ctx, start).getTime() - ctx.company.get().auctionOpensHours * 3_600_000)

/* The first window that can still be sold: its auction hasn't run yet. */
export function nextWindow(ctx: Context, len = windowMs(ctx)) {
  const now = ctx.clock().getTime()
  let w = windowStartOf(ctx, ctx.clock(), len)
  while (now >= biddingClosesAt(ctx, w).getTime()) w = new Date(w.getTime() + len)
  return w
}

/* Every window starting within [from, to] (dates, inclusive), laid from
   the same anchor as windowStartOf (before OQ27 this counted from the
   epoch, which only agreed with it for lengths dividing a day). */
export function windowsBetween(ctx: Context, from: string, to: string, len = windowMs(ctx)): Date[] | null {
  const a = Date.parse(`${from}T00:00:00Z`)
  const b = Date.parse(`${to}T00:00:00Z`) + DAY
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a || b - a > 366 * DAY) return null
  const out: Date[] = []
  for (let t = ANCHOR + Math.ceil((a - ANCHOR) / len) * len; t < b; t += len) out.push(new Date(t))
  return out
}

/* A position's own windows over the dates [from, to] (OQ27): every window
   `len` long that overlaps them, so a weekly slot asked about a Wednesday
   answers for the week that Wednesday falls in. For a length that divides
   a day this is exactly windowsBetween. null for the same bad ranges. */
export function windowsCovering(ctx: Context, from: string, to: string, len: number): Date[] | null {
  const starts = windowsBetween(ctx, from, to, len)
  if (!starts) return null
  const first = windowStartOf(ctx, new Date(`${from}T00:00:00Z`), len)
  return starts[0]?.getTime() === first.getTime() ? starts : [first, ...starts]
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
   estate instead of one per position (review, 24 Sep 2026). `taken` maps
   each such window to the status that took it, and `lockedTerm` is the
   delivery term of a deal this position is assigned to once its rate is
   locked, if it has one: both decide which windows read Reserved (OQ52). */
export interface WindowFacts { next: number; hasDisplays: boolean; taken?: Map<string, ReservationStatus>; lockedTerm?: { activeFrom: string | null; activeTo: string | null } | null }
const NO_WINDOWS: ReadonlyMap<string, ReservationStatus> = new Map()
export function windowFacts(ctx: Context, p: PositionRef, starts?: Date[], prefetched?: Map<string, Map<string, ReservationStatus>>): WindowFacts {
  const facts: WindowFacts = { next: nextWindow(ctx, windowMs(ctx, p)).getTime(), hasDisplays: ctx.displays.summaryByDisplayType(p.displayType.id).displays > 0, lockedTerm: lockedTermOf(ctx, p) }
  if (prefetched) facts.taken = prefetched.get(p.positionId) ?? (NO_WINDOWS as Map<string, ReservationStatus>)
  else if (starts?.length) {
    const from = starts[0].toISOString()
    const to = new Date(starts[starts.length - 1].getTime() + 1).toISOString()
    facts.taken = new Map(ctx.reservations.inRange(p.positionId, from, to).filter((r) => !r.testMode && TAKEN.includes(r.status)).map((r) => [r.windowStart, r.status]))
  }
  return facts
}

/* The delivery term of the deal this position is sold under, once that
   deal's rate is locked. Every window in it is spoken for: the exchange
   books each directly at the locked rate (billing/lockedTerm.ts bookLockedTermWindow)
   and takes no other bid for it. */
function lockedTermOf(ctx: Context, p: PositionRef) {
  if (assignmentOf(p.def) !== 'deal') return null
  const list = ctx.buyersLists.get(assignedCached(p.def).buyersListId as string)
  return list ? lockedTermSpan(list) : null
}

export function windowStatus(ctx: Context, p: PositionRef, c: Caller, start: Date, f: WindowFacts = windowFacts(ctx, p)): WindowStatus {
  const iso = start.toISOString()
  /* A Test-mode win never takes the window (spec §7: no real spend). */
  const took = f.taken ? f.taken.get(iso) : ctx.reservations.forWindow(p.positionId, iso).find((r) => !r.testMode && TAKEN.includes(r.status))?.status
  const upcoming = start.getTime() >= f.next
  /* Held at a reserve price (OQ52, Rob, 29 Sep 2026): a window a buyer
     committed to ahead of the open auction reads Reserved until it plays.
     On a position held for a named advertiser, a reservation is how every
     window is booked, so it reads Sold as it always has. */
  if (took) return took === 'reserved' && upcoming && assignmentOf(p.def) !== 'reserved' ? 'reserved' : 'sold'
  if (!upcoming) return 'unavailable'
  if (!f.hasDisplays) return 'unavailable'
  /* Inside a locked deal term: already spoken for, not open to bids. */
  if (f.lockedTerm && isActiveAt(f.lockedTerm, iso)) return 'reserved'
  /* Locked against new sales (30 Sep 2026): windows already sold read Sold
     above; every other upcoming one is closed to further sales, even to the
     advertiser it is held for. */
  if (p.def.salesLocked) return 'unavailable'
  /* Held for a named advertiser: available only to that advertiser. */
  if (assignmentOf(p.def) === 'reserved' && !c.advertiser) return 'reserved'
  return 'available'
}

/* Assumed views (VAC-d) for one of this position's windows. The audience
   source scores a slot per company play window (AudienceSource: the figure
   HQ populates is per window, and every window was the company length
   before OQ27); a slot with its own billing unit gets that figure scaled
   to its window's length — a weekly window on a daily-scored slot is seven
   days' views. A slot that follows the company window is unchanged. */
export function assumedViewsPerWindow(ctx: Context, p: PositionRef) {
  const scored = ctx.audience.forSlot(p.displayType.id, p.slot).assumedViewsPerWindow
  const ratio = windowHoursOf(ctx, p) / ctx.company.get().playWindowHours
  return ratio === 1 ? scored : Math.round(scored * ratio)
}

/* Whether a position may be sold (ticket "Flag and exclude unscored slots",
   30 Sep 2026). Assumed views come from the audience source, which answers 0
   for a slot nobody has scored; selling that would bill 0 and quote a
   forecast of nothing. There is deliberately no fallback estimate: an
   invented audience number would end up on invoices. A slot also needs a
   duration before it is exposed as Advertiser inventory: the venue loop
   length, which slotDurationSec divides by the rotation cap (slots.ts).
   Returns why not, or null when sellable. */
export function unsellableReason(ctx: Context, p: PositionRef): string | null {
  if (!ctx.audience.forSlot(p.displayType.id, p.slot).scored) return 'No audience score yet — this slot can’t be sold until it is scored.'
  if (!p.displayType.phExtensions?.venue?.loopLengthSec) return 'No slot duration yet — set the venue loop length before this slot can be sold.'
  return null
}
export const isSellable = (ctx: Context, p: PositionRef) => unsellableReason(ctx, p) === null

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
  /* The rotation this slot plays in — its zone's own on a multi-zone
     display type (ticket, 28 Sep 2026), not every zone's slots together. */
  const n = rotationSizeOf(dt, p.slot)
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
      slotDurationSec: slotDurationSec(dt, n) ?? (n ? loop / n : loop),
      loopLengthSec: loop,
      shareOfVoice: n ? Math.round((1 / n) * 1000) / 1000 : 1,
      ...(venue?.openOohVenueType ? { openOohVenueType: venue.openOohVenueType } : {}),
    },
    assignment: assignmentOf(p.def),
    /* What a campaign may use here (Rob, 20 Sep); localised only by default. */
    supportedTargeting: supportedTargetingOf(p.def),
    /* This position's own play-window length (OQ27): what one window —
       one bid, one booking, one billing line — covers. */
    billingUnitHours: windowHoursOf(ctx, p),
    assumedViewsPerWindow: assumedViewsPerWindow(ctx, p),
    /* False when the slot has no audience score: only ever seen by a
       caller who is told so, since inventory excludes such positions. */
    scored: ctx.audience.forSlot(dt.id, p.slot).scored,
    pricing: { currency: company.currency, floorCpm: company.floorCpm, effectiveFloorCpm: effectiveFloors(company, multiplier), costPerEngagement: company.interactiveCpe },
    reservePrice: reservePriceOf(dt, p.def),
  }
}
