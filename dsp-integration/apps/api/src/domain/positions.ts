/* Sellable positions (spec §5): every slot owned by Advertiser on a display
   type, across the stores and displays using it. HQ and Stores slots are
   never exposed. A caller sees only positions it could actually buy:
   permissioning is a smaller list, never a rejected request. */
import type { DisplayType, Slot } from '@ph-dsp/types'
import type { Context } from '../context'
import { TRANSACTING_CURRENCY } from './currency'
import type { PartnerRecord } from '../repos/PartnerRepo'
import { type Awaitable, allOf, andThen } from '../db/db'
import { type ReservationStatus, TAKEN } from '../repos/ReservationRepo'
import { INTERACTIVE_ENABLED, PLATFORM_DEFAULT_BILLING_UNIT_HOURS, advertiserSlug, assignedOf, billingUnitHoursOf, interactiveReservePriceOf, maxCampaignsOf, maxPlayLengthSecOf, openRtbInventoryOf, reservePriceOf, type Assigned } from '@ph-dsp/types'
import { invitedPartnerIds, isInvitedBuyer } from './buyersLists'
import { isActiveAt, lockedTermSpan } from '../billing/term'
import { effectiveLists, isBlocked, isOn } from './lists'
import { effectiveFloorCpm } from './pricing'
import { rotationSizeOf, slotDurationSec } from './slots'
import { audienceOf } from './displayTypes'
import { playsPerWindowOf } from './plays'

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
async function positionIndex(ctx: Context): Promise<PositionIndex> {
  const list = await ctx.displayTypes.list()
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
export const allPositions = async (ctx: Context): Promise<PositionRef[]> => [...(await positionIndex(ctx)).all]
export const findPosition = async (ctx: Context, id: string): Promise<PositionRef | null> => (await positionIndex(ctx)).byId.get(id) ?? null

/* assignedOf builds a fresh object each call; a frozen slot (every slot on a
   cached display type) gets its answer once. */
const assigned = new WeakMap<Slot, Assigned>()
function assignedCached(def: Slot): Assigned {
  if (!Object.isFrozen(def)) return assignedOf(def)
  let a = assigned.get(def)
  if (!a) assigned.set(def, (a = Object.freeze(assignedOf(def))))
  return a
}

/* How a position is sold (8 Oct 2026): per impression as the player signals
   it (real time, exchange/realtime.ts) unless it is held for named
   advertisers or assigned to a private auction. Those two are the only
   positions sold by play window ahead of time; an open (rtb) or
   whitelist-only position is always real time, with no window bidding,
   no window reservation and no scheduled clearing. There is no per-slot
   setting for it. */
export const isRealtime = (p: PositionRef) => {
  const a = assignmentOf(p.def)
  return a === 'rtb' || a === 'whitelist_only'
}

export type Assignment = 'rtb' | 'whitelist_only' | 'deal' | 'reserved'
export const assignmentOf = (def: Slot): Assignment => {
  const a = assignedCached(def)
  return a.advertisers.length ? 'reserved' : a.buyersListIds.length ? 'deal' : a.whitelistOnly ? 'whitelist_only' : 'rtb'
}
/* The global deal (8 Oct 2026): one deal ID for all open, exchange-eligible
   inventory. The slot's own flag defaults ON (absent = in) but is SUPPRESSED
   whenever the slot is held for a named advertiser, whitelist-only or on a
   buyers list, so the default never exposes inventory the retailer meant to
   restrict. Being open and being in the global deal are not the same thing. */
export const globalDealSuppressedBy = (def: Slot): Exclude<Assignment, 'rtb'> | null => {
  const a = assignmentOf(def)
  return a === 'rtb' ? null : a
}
export const slotInGlobalDeal = (def: Slot) => def.inGlobalDeal !== false
/* Nothing assigned and no global-deal membership: the slot is held back, not open to every DSP. */
export const isUnassigned = (def: Slot) => assignmentOf(def) === 'rtb' && assignedCached(def).partnerIds.length === 0 && !assignedCached(def).openAuction && !slotInGlobalDeal(def)
/* Is this position carried on the global deal, given the instance master switch? */
export const inGlobalDeal = (def: Slot, masterOn: boolean) => masterOn && slotInGlobalDeal(def) && globalDealSuppressedBy(def) === null
/* One tier of a position's buyers-list waterfall (7 Oct 2026): the position
   as if only this list were assigned to it, so every per-deal check (invited
   buyers, deal ID, floor, term) reads that list. */
export const tierOf = (p: PositionRef, buyersListId: string): PositionRef => ({ ...p, def: { ...p.def, listMode: 'deal', buyersListId, buyersListIds: [buyersListId] } })
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
   list once instead of once per deal. Sync-first (db.ts andThen): it runs
   once per position on every inventory read. */
export function effectivePartnerIds(ctx: Context, def: Slot, partners?: Awaitable<PartnerRecord[]>): Awaitable<string[] | null> {
  const a = assignedCached(def)
  if (a.buyersListIds.length) {
    /* A waterfall: any tier's invited DSPs may see the position; each tier's own bid request goes only to its own (auction.ts). */
    return andThen(allOf(a.buyersListIds.map((id) => ctx.buyersLists.get(id))), (lists) =>
      andThen(partners ?? ctx.partners.list(), (all) => [...new Set(lists.flatMap((l) => (l ? invitedPartnerIds(l, all) : [])))]))
  }
  return a.partnerIds.length ? a.partnerIds : null
}

/* May this advertiser (by its DSP seat ID against the DSP's lists; by name for a held position or a deal) buy this
   position through this partner? */
export async function advertiserMayBuy(ctx: Context, p: PositionRef, partner: PartnerRecord, name: string, seatId?: string | null) {
  const eff = effectiveLists(partner)
  if (seatId && isBlocked(seatId, eff)) return false
  const a = assignmentOf(p.def)
  if (a === 'reserved') return heldFor(p.def, name)
  if (a === 'deal') {
    const lists = await Promise.all(assignedCached(p.def).buyersListIds.map((id) => ctx.buyersLists.get(id)))
    return lists.some((list) => !!list && isActiveAt(list, ctx.clock().toISOString()) && isInvitedBuyer(list, partner, seatId))
  }
  if (a === 'whitelist_only') return !!seatId && isOn(seatId, eff.allowList)
  return true
}

/* Whether a caller may see each position, with everything that is the
   same for every position — its lists, which of its seats are blocked or
   whitelisted, the partner records a deal resolves against — worked out
   once per request rather than once per position (scalability review,
   24 Sep 2026: the inventory list did it 2,400 times a request on a large
   estate). Same answer as advertiserMayBuy, seat by seat. */
export async function visibilityFor(ctx: Context, c: Caller): Promise<(p: PositionRef) => Awaitable<boolean>> {
  if (c.partner.status !== 'connected' || c.unknownAdvertiser) return () => false
  const eff = effectiveLists(c.partner)
  const seats = (c.advertiser ? c.partner.seats.filter((s) => s.name === c.advertiser!.name) : c.partner.seats).filter((s) => !isBlocked(s.id, eff))
  const whitelisted = seats.some((s) => isOn(s.id, eff.allowList))
  const me = c.partner.id
  /* Read once, and only if a deal asks for it. */
  let partners: Awaitable<PartnerRecord[]> | undefined
  const allows = (p: PositionRef, allowed: string[] | null): Awaitable<boolean> => {
    if (allowed !== null && !allowed.includes(me)) return false
    const a = assignmentOf(p.def)
    if (a === 'rtb') return seats.length > 0
    if (a === 'whitelist_only') return whitelisted
    if (a === 'reserved') return seats.some((s) => heldFor(p.def, s.name))
    return andThen(allOf(assignedCached(p.def).buyersListIds.map((id) => ctx.buyersLists.get(id))), (lists) =>
      lists.some((list) => !!list && isActiveAt(list, ctx.clock().toISOString()) && seats.some((s) => isInvitedBuyer(list, c.partner, s.id))))
  }
  /* Sync-first (db.ts andThen): once per position on every inventory read. */
  return (p) =>
    andThen(isSellable(ctx, p), (sellable) =>
      sellable && andThen(effectivePartnerIds(ctx, p.def, assignedCached(p.def).buyersListIds.length ? (partners ??= ctx.partners.list()) : undefined), (allowed) => allows(p, allowed)))
}

export const isVisible = async (ctx: Context, p: PositionRef, c: Caller) => (await visibilityFor(ctx, c))(p)

/* Keeps the items the (possibly async) predicate accepts, in order. One at a
   time on purpose: a list of thousands of positions must not become
   thousands of concurrent reads. */
export async function filterAsync<T>(items: readonly T[], keep: (item: T) => Awaitable<boolean>): Promise<T[]> {
  const out: T[] = []
  for (const item of items) if (await keep(item)) out.push(item)
  return out
}

/* ------------------------------------------------------------ play windows */

const DAY = 86_400_000
const HOUR = 3_600_000
/* A position's play-window length, in hours — its billing unit (OQ27,
   decision Rob 29 Sep 2026: the per-slot Billing unit is the source of
   truth for window length and billing granularity). Override always wins:
   the slot's own billingUnitHours, else its display type's default, else
   the platform default (PLATFORM_DEFAULT_BILLING_UNIT_HOURS, a named
   constant, not a company setting: the company-wide play window was
   removed on 8 Oct 2026). Without a position: the platform default. */
export const windowHoursFor = (p?: PositionRef | null): number => (p ? billingUnitHoursOf(p.displayType, p.def) : PLATFORM_DEFAULT_BILLING_UNIT_HOURS)
export const windowMsFor = (p?: PositionRef | null) => windowHoursFor(p) * HOUR
export const windowHoursOf = (_ctx: Context, p?: PositionRef | null): number => windowHoursFor(p)
export const windowMs = (_ctx: Context, p?: PositionRef | null): number => windowMsFor(p)
/* A position's max play length, in seconds (max play length ticket, 7 Oct
   2026): the slot's own, else its display type's, else the company-wide
   default. The fixed per-play duration plays per window is counted against
   and the longest creative the slot accepts. Given the company default
   already read, like windowMsFor. */
export const maxPlayLengthSecFor = (companySec: number, p: PositionRef): number => maxPlayLengthSecOf(p.displayType, p.def, companySec)
/* The longest play length any advertiser slot of a display type resolves to: a campaign is uploaded for the display type, not yet a slot, so its creative may be as long as the most generous slot allows (it is checked again against the exact slot at hand-off / bid). */
export const longestPlayLengthSecFor = (companySec: number, dt: DisplayType): number => {
  const sold = (dt.phExtensions?.slots ?? []).filter((s) => s.owner === 'advertiser')
  return Math.max(...(sold.length ? sold : [{}]).map((s) => maxPlayLengthSecOf(dt, s, companySec)))
}
/* The shortest play window any position (or the platform default) has: the
   finest grid every position's windows can be read against — billing's
   "has anything ended yet" query and the booking schedule's columns. */
export const shortestWindowMs = async (ctx: Context) => Math.min(windowMsFor(), ...(await allPositions(ctx)).map((p) => windowMsFor(p)))
/* The longest: how far back a window still running now can have started. */
export const longestWindowMs = async (ctx: Context) => Math.max(windowMsFor(), ...(await allPositions(ctx)).map((p) => windowMsFor(p)))
/* When a reservation's window ends: its start plus its position's window
   length (the platform default for a position no longer in the estate). */
export const windowEndOf = async (ctx: Context, r: { positionId: string; windowStart: string }) => (await windowEnds(ctx))(r)
/* windowEndOf for many reservations: reads the position index once, then answers each one synchronously. */
export async function windowEnds(ctx: Context): Promise<(r: { positionId: string; windowStart: string }) => number> {
  const index = await positionIndex(ctx)
  return (r) => Date.parse(r.windowStart) + windowMsFor(index.byId.get(r.positionId) ?? null)
}

/* A slot's own windows still bid on or booked (live, not Test mode) that
   haven't finished playing, `len` being its current window length — what
   a change to its billing unit would resize (routes/admin/
   advertiserSettings.ts refuses the change while there are any). A window
   that has played but isn't billed yet counts too: billing reads its
   length when it bills it. */
export async function slotWindowCommitments(ctx: Context, positionId: string, len: number) {
  const now = ctx.clock().getTime()
  const inRange = await ctx.reservations.inRange(positionId, new Date(now - len).toISOString(), '9999')
  /* A window already billed is over, whatever length it is read at now. */
  const billedIds = await ctx.billing.billedAmong(inRange.map((r) => r.id))
  const live = inRange.filter((r) => !r.testMode && ['pending', 'won', 'reserved'].includes(r.status) && Date.parse(r.windowStart) + len > now && !billedIds.has(r.id))
  const unbilled = (await ctx.reservations.billable(new Date(now).toISOString())).filter((r) => r.positionId === positionId && !live.some((x) => x.id === r.id))
  return [...live, ...unbilled]
}

/* Windows start at UTC midnight and follow each other back to back from a
   fixed Monday, so a 24-hour window is a day and a 7-day window a week.
   Every length is laid from the same anchor (OQ27): a weekly slot's window
   starts on a Monday that is also a daily slot's window start, so one
   auction (keyed on its start) clears both. `len` is the window length in
   ms — windowMs(ctx, p) for a position, the platform default otherwise. */
const ANCHOR = Date.UTC(1970, 0, 5)
export function windowStartOf(at: Date, len: number) {
  return new Date(ANCHOR + Math.floor((at.getTime() - ANCHOR) / len) * len)
}

/* The first window that can still be booked or auctioned: the one after the
   window `at` falls in. Deal windows are cleared one window ahead
   (exchange/scheduler.ts), so a window that has started is never sold. */
export function nextWindow(ctx: Context, len?: number): Date {
  return nextWindowFor(ctx.clock(), len ?? windowMsFor())
}
export function nextWindowFor(at: Date, len: number) {
  return new Date(windowStartOf(at, len).getTime() + len)
}

/* Every window starting within [from, to] (dates, inclusive), laid from
   the same anchor as windowStartOf (before OQ27 this counted from the
   epoch, which only agreed with it for lengths dividing a day). */
export function windowsBetween(from: string, to: string, len: number): Date[] | null {
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
export function windowsCovering(from: string, to: string, len: number): Date[] | null {
  const starts = windowsBetween(from, to, len)
  if (!starts) return null
  const first = windowStartOf(new Date(`${from}T00:00:00Z`), len)
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
export interface WindowFacts { next: number; hasDisplays: boolean; taken: Map<string, ReservationStatus>; lockedTerm?: { activeFrom: string | null; activeTo: string | null } | null }
const NO_WINDOWS: ReadonlyMap<string, ReservationStatus> = new Map()
/* Sync-first (db.ts andThen): the status filter asks it for every position. */
export function windowFacts(ctx: Context, p: PositionRef, starts?: Date[], prefetched?: Map<string, Map<string, ReservationStatus>>): Awaitable<WindowFacts> {
  const none = NO_WINDOWS as Map<string, ReservationStatus>
  const taken: Awaitable<Map<string, ReservationStatus>> = prefetched
    ? (prefetched.get(p.positionId) ?? none)
    : starts?.length
      ? andThen(ctx.reservations.inRange(p.positionId, starts[0].toISOString(), new Date(starts[starts.length - 1].getTime() + 1).toISOString()), (rows) =>
          new Map(rows.filter((r) => !r.testMode && TAKEN.includes(r.status)).map((r) => [r.windowStart, r.status])))
      : none
  return andThen(allOf([ctx.displays.summaryByDisplayType(p.displayType.id), lockedTermOf(ctx, p), taken] as const), ([displays, lockedTerm, t]) => ({
    next: nextWindowFor(ctx.clock(), windowMsFor(p)).getTime(),
    hasDisplays: displays.displays > 0,
    lockedTerm,
    taken: t,
  }))
}

/* The delivery term of the deal this position is sold under, once that
   deal's rate is locked. Every window in it is spoken for: the exchange
   books each directly at the locked rate (billing/lockedTerm.ts bookLockedTermWindow)
   and takes no other bid for it. */
function lockedTermOf(ctx: Context, p: PositionRef): Awaitable<ReturnType<typeof lockedTermSpan> | null> {
  if (assignmentOf(p.def) !== 'deal') return null
  /* Any tier whose rate is locked books the position's windows (first, highest tier, wins). */
  return andThen(allOf(assignedCached(p.def).buyersListIds.map((id) => ctx.buyersLists.get(id))), (lists) => {
    for (const list of lists) { const span = list ? lockedTermSpan(list) : null; if (span) return span }
    return null
  })
}

/* Synchronous on purpose: availability over a year asks it 366 times per
   position. Everything it needs is in the facts, read beforehand
   (windowFacts with the window starts, or windowStatusAt for one window). */
export function windowStatus(p: PositionRef, c: Caller, start: Date, f: WindowFacts): WindowStatus {
  const iso = start.toISOString()
  /* A Test-mode win never takes the window (spec §7: no real spend). */
  const took = f.taken.get(iso)
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
  /* A real-time position sells per impression, never a window: nothing to book or bid on. */
  if (isRealtime(p)) return 'unavailable'
  /* Held for a named advertiser: available only to that advertiser. */
  if (assignmentOf(p.def) === 'reserved' && !c.advertiser) return 'reserved'
  return 'available'
}
/* One window's status, reading what it needs. */
export async function windowStatusAt(ctx: Context, p: PositionRef, c: Caller, start: Date): Promise<WindowStatus> {
  const f = await windowFacts(ctx, p, [start])
  return windowStatus(p, c, start, f)
}

/* Assumed views (VAC-d) for one of this position's windows. The audience
   source scores a slot per platform-default window
   (PLATFORM_DEFAULT_BILLING_UNIT_HOURS; AudienceSource: the figure HQ
   populates is per window); a slot with another billing unit gets that
   figure scaled to its window's length — a weekly window on a daily-scored
   slot is seven days' views. */
export function assumedViewsPerWindow(ctx: Context, p: PositionRef): Awaitable<number> {
  return andThen(audienceOf(ctx.audience, p.displayType, p.slot), (audience) => assumedViewsFor(audience.assumedViewsPerWindow, p))
}
/* The same, given the slot's scored figure already read. */
export function assumedViewsFor(scored: number, p: PositionRef) {
  const ratio = windowHoursFor(p) / PLATFORM_DEFAULT_BILLING_UNIT_HOURS
  return ratio === 1 ? scored : Math.round(scored * ratio)
}

/* Whether a position may be sold (ticket "Flag and exclude unscored slots",
   30 Sep 2026). Assumed views come from the audience source, which answers 0
   for a slot nobody has scored; selling that would bill 0 and quote a
   forecast of nothing. There is deliberately no fallback estimate: an
   invented audience number would end up on invoices. A slot needs no
   duration to be sold (ticket fBQUNQCX4oXCkl5NoAFi, 4 Oct 2026): duration
   belongs to the campaign asset, set when the advertiser uploads the
   creative, and billing keys off that. Loop length is screen context only.
   Returns why not, or null when sellable. */
export function unsellableReason(ctx: Context, p: PositionRef, known?: { scored: boolean }): Awaitable<string | null> {
  /* Unassigned (9 Oct 2026): no DSP, advertiser, whitelist or buyers list, and
     not in the global deal. A valid state, for holding a slot for own use: it
     does not sell. */
  if (isUnassigned(p.def)) return 'Unassigned: not offered to any buyer.'
  /* A website or mobile app has no camera audience to score, so it is never
     held back for lack of one (ticket 0jviesctpWGyOYtK20tg). */
  if (openRtbInventoryOf(p.displayType.touchPoint) !== 'dooh') return null
  /* A caller that already has the slot's audience (Available Inventory
     reads it for `scored`) passes it, saving a second audience read per
     slot. */
  return andThen(known ?? audienceOf(ctx.audience, p.displayType, p.slot), (audience) => {
    if (!audience.scored) return 'No audience score yet.'
    return null
  })
}
export const isSellable = (ctx: Context, p: PositionRef): Awaitable<boolean> => andThen(unsellableReason(ctx, p), (reason) => reason === null)

/* -------------------------------------------------------------- the view */

export function loopLengthSec(ctx: Context, dt: DisplayType): Awaitable<number> {
  const venue = dt.phExtensions?.venue?.loopLengthSec
  if (venue) return venue
  return andThen(dt.defaultPlaylistId ? ctx.playlists.get(dt.defaultPlaylistId) : null, (pl) =>
    ((pl?.items ?? []) as { enabled?: boolean; playbackDuration?: number }[]).filter((i) => i.enabled !== false).reduce((n, i) => n + (i.playbackDuration ?? 0), 0))
}

/* Sync-first (db.ts andThen): a page of inventory builds up to 200. */
export function positionView(ctx: Context, p: PositionRef, c: Caller) {
  const dt = p.displayType
  return andThen(
    allOf([
      /* Counts, never the display rows (review, 24 Sep 2026). */
      ctx.displays.summaryByDisplayType(dt.id),
      loopLengthSec(ctx, dt),
      ctx.company.get(),
      c.advertiser ? ctx.company.advertiserSetting(c.advertiser.id) : null,
      audienceOf(ctx.audience, dt, p.slot),
    ] as const),
    ([displays, loop, company, setting, audience]) => viewOf(p, displays, loop, company, setting ? setting.floorMultiplier : 1, audience),
  )
}
function viewOf(
  p: PositionRef,
  displays: { stores: number; displays: number },
  loop: number,
  company: Awaited<ReturnType<Context['company']['get']>>,
  multiplier: number,
  audience: Awaited<ReturnType<Context['audience']['forSlot']>>,
) {
  const dt = p.displayType
  /* The rotation this slot plays in — its zone's own on a multi-zone
     display type (ticket, 28 Sep 2026), not every zone's slots together. */
  const n = rotationSizeOf(dt, p.slot)
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
      /* Informational: the slot's share of the loop. What a play lasts, and what plays are counted against, is maxPlayLengthSec. */
      slotDurationSec: slotDurationSec(dt, n) ?? (n ? loop / n : loop),
      loopLengthSec: loop,
      maxPlayLengthSec: maxPlayLengthSecFor(company.maxPlayLengthSec, p),
      shareOfVoice: n ? Math.round((1 / n) * 1000) / 1000 : 1,
      ...(venue?.openOohVenueType ? { openOohVenueType: venue.openOohVenueType } : {}),
    },
    assignment: assignmentOf(p.def),
    /* This position's own play-window length (OQ27): what one window —
       one bid, one booking, one billing line — covers. */
    billingUnitHours: windowHoursFor(p),
    /* The same window as a play count — the transacting unit (plays on ONE display; VAC-d converts plays to views for billing only). */
    playsPerWindow: playsPerWindowOf(windowMsFor(p), maxPlayLengthSecFor(company.maxPlayLengthSec, p), n),
    /* The loop positions the maths counts: every slot of the rotation, HQ's included. */
    slotCount: Math.max(1, n),
    assumedViewsPerWindow: assumedViewsFor(audience.assumedViewsPerWindow, p),
    /* False when the slot has no audience score: only ever seen by a
       caller who is told so, since inventory excludes such positions. */
    scored: audience.scored,
    /* One floor for every campaign type; no personalised price (Rob, 5 Oct 2026). */
    pricing: { currency: TRANSACTING_CURRENCY, floorCpm: company.floorCpm, effectiveFloorCpm: { localised: effectiveFloorCpm(company, multiplier) } },
    /* The most campaigns (default + targeted versions) a bid or reservation here may carry. */
    maxCampaigns: maxCampaignsOf(dt, p.def),
    reservePrice: reservePriceOf(dt, p.def),
    ...(INTERACTIVE_ENABLED ? { interactiveReservePrice: interactiveReservePriceOf(dt, p.def) } : {}),
  }
}
