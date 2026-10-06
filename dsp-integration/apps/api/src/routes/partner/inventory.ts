/* Inventory API (spec §5): read-only, derived from the slots assigned on each
   display type. Only positions the caller could buy are listed.
     GET  /v1/inventory
     GET  /v1/inventory/{positionId}
     GET  /v1/inventory/{positionId}/availability?from=&to=
     POST /v1/inventory/forecast */
import type { FastifyPluginAsync } from 'fastify'
import type { Context } from '../../context'
import { TRANSACTING_CURRENCY } from '../../domain/currency'
import { type Caller, type PositionRef, type WindowStatus, allPositions, assumedViewsPerWindow, callerOf, findPosition, longestWindowMs, nextWindow, positionView, visibilityFor, windowFacts, windowMs, windowStatus, windowsBetween, windowsCovering } from '../../domain/positions'
import { effectiveFloorCpm } from '../../domain/pricing'
import { andThen } from '../../db/db'
import { type Rules, throwIfRejected, validateRules } from '../../domain/targetingValidation'
import { notFound, validationFailed } from '../../http/errors'

const STATUSES: WindowStatus[] = ['available', 'reserved', 'sold', 'unavailable']
const dateOf = (d: Date) => d.toISOString().slice(0, 10)
const list = (v: unknown) => (Array.isArray(v) ? v : typeof v === 'string' ? v.split(',') : []).map((x) => String(x).trim()).filter(Boolean)

interface ListQuery {
  advertiserId?: string; displayTypeId?: string; touchPoint?: string; storeIds?: string | string[]; region?: string
  from?: string; to?: string; status?: string; cursor?: string; limit?: string
}

export const inventoryRoutes = (ctx: Context): FastifyPluginAsync => async (app) => {
  /* One position: find it, then check the caller may see it — rather than
     working out visibility for every position in the estate to find one.
     A position the caller may not buy is a 404, exactly as if it didn't
     exist (visibility, not rejection). */
  const visibleOne = async (c: Caller, id: string) => {
    const p = await findPosition(ctx, id)
    if (!p || !(await (await visibilityFor(ctx, c))(p))) throw notFound('Position not found.')
    return p
  }
  /* A position's own windows over a date range: each position's window is
     its billing unit long (OQ27, Rob 29 Sep 2026), so over the same dates a
     daily slot lists every day and a weekly one each week they touch. */
  const startsOf = async (p: PositionRef, from: string, to: string) => windowsCovering(from, to, await windowMs(ctx, p))
  const windowsOf = async (ctx2: Context, p: PositionRef, c: Caller, starts: Date[]) => {
    /* Per-position facts and audience once, not once per window (up to 366). */
    const facts = await windowFacts(ctx2, p, starts)
    const len = await windowMs(ctx2, p)
    const assumedViews = await assumedViewsPerWindow(ctx2, p)
    return starts.map((start) => ({
      start: start.toISOString(),
      end: new Date(start.getTime() + len).toISOString(),
      status: windowStatus(p, c, start, facts),
      assumedViews,
    }))
  }

  app.get<{ Querystring: ListQuery }>('/inventory', async (req) => {
    const q = req.query
    const c = callerOf(req.partner, q.advertiserId)
    const companyLen = await windowMs(ctx)
    const nextStart = await nextWindow(ctx)
    const next = dateOf(nextStart)
    /* No dates: the next window that can be sold. */
    const [from, to] = [q.from ?? q.to ?? next, q.to ?? q.from ?? next]
    const asked = windowsBetween(from, to, companyLen)
    const range = asked ?? windowsBetween(next, next, companyLen)!
    /* Each position's own windows over the range (OQ27); no dates: its own
       next window that can still be sold. */
    const windowsFor = async (p: PositionRef) => ((q.from || q.to) && asked ? (await startsOf(p, from, to))! : [await nextWindow(ctx, await windowMs(ctx, p))])
    const stores = list(q.storeIds)
    const byStatus = q.status && STATUSES.includes(q.status as WindowStatus) ? (q.status as WindowStatus) : null
    /* The status filter asks about every position over the whole range:
       what is taken is read once for the estate (one ranged query) and
       handed to each position, instead of one query per position — 2,400
       of them a request on a large estate (review, 24 Sep 2026). */
    const longest = byStatus ? await longestWindowMs(ctx) : 0
    const taken = byStatus ? await ctx.reservations.takenInRange(new Date(range[0].getTime() - longest).toISOString(), new Date(Math.max(range[range.length - 1].getTime(), nextStart.getTime() + longest) + 1).toISOString()) : undefined
    /* Only as many positions as this page needs, plus one to know whether
       there is another page — not the whole estate's visibility and filters
       every request. Visibility reads each position's audience score (an
       unscored slot is hidden, 30 Sep 2026), and doing that for all 2,408
       positions of a 15,000-display estate to return 50 took an inventory
       page from 475 to 112 req/s (bench, 1 Oct 2026). Order is unchanged. */
    const start = Number(q.cursor) || 0
    const limit = Math.min(Math.max(Number(q.limit) || 50, 1), 200)
    const see = await visibilityFor(ctx, c)
    const items: PositionRef[] = []
    /* Sync-first (db.ts andThen): a page with no filters only asks each
       position whether the caller may see it. */
    const filtered = !!(q.displayTypeId || q.touchPoint || stores.length || q.region || byStatus)
    const matches = (p: PositionRef) => andThen(see(p), (visible) => visible && (!filtered || filters(p)))
    const filters = async (p: PositionRef) => {
      if (q.displayTypeId && p.displayType.id !== q.displayTypeId) return false
      if (q.touchPoint && p.displayType.touchPoint !== q.touchPoint) return false
      /* Store IDs and regions are the platform's (StoreSource, Q10). The
         display type's stores are only read when one of those filters asks
         for them — the stores, not the displays. */
      if (stores.length || q.region) {
        const inStores = await ctx.displays.storeIdsByDisplayType(p.displayType.id)
        if (stores.length && !inStores.some((id) => stores.includes(id))) return false
        if (q.region) {
          let inRegion = false
          for (const id of inStores) if ((await ctx.stores.get(id))?.region?.toLowerCase() === q.region.toLowerCase()) { inRegion = true; break }
          if (!inRegion) return false
        }
      }
      if (byStatus) {
        const windows = await windowsFor(p)
        const facts = await windowFacts(ctx, p, windows, taken)
        return windows.some((w) => windowStatus(p, c, w, facts) === byStatus)
      }
      return true
    }
    for (const p of await allPositions(ctx)) {
      if (!(await matches(p))) continue
      items.push(p)
      if (items.length > start + limit) break
    }
    const views = []
    for (const p of items.slice(start, start + limit)) views.push(await positionView(ctx, p, c))
    return {
      items: views,
      nextCursor: items.length > start + limit ? String(start + limit) : null,
    }
  })

  app.get<{ Params: { positionId: string }; Querystring: { advertiserId?: string } }>('/inventory/:positionId', async (req) => {
    const c = callerOf(req.partner, req.query.advertiserId)
    return positionView(ctx, await visibleOne(c, req.params.positionId), c)
  })

  app.get<{ Params: { positionId: string }; Querystring: { from?: string; to?: string; advertiserId?: string } }>('/inventory/:positionId/availability', async (req) => {
    const { from, to } = req.query
    const range = from && to ? windowsBetween(from, to, await windowMs(ctx)) : null
    if (!range) throw validationFailed([{ field: 'from', reason: 'from and to are dates (YYYY-MM-DD), from ≤ to, at most a year apart.' }])
    const c = callerOf(req.partner, req.query.advertiserId)
    const p = await visibleOne(c, req.params.positionId)
    return { positionId: p.positionId, windows: await windowsOf(ctx, p, c, (await startsOf(p, from!, to!))!) }
  })

  app.post<{ Body: { positionIds?: unknown; from?: unknown; to?: unknown; advertiserId?: unknown; rules?: unknown } }>('/inventory/forecast', async (req) => {
    const b = req.body ?? {}
    const invalid: { field: string; reason: string }[] = []
    const ids = Array.isArray(b.positionIds) ? b.positionIds : null
    if (!ids?.length) invalid.push({ field: 'positionIds', reason: 'At least one position.' })
    /* Bounded like a page of inventory, and each position once: the work is
       positions × windows (up to 366), and a repeated id used to be counted
       again — 60,000 copies of one id held the event loop for 15 s. */
    const max = ctx.config.maxForecastPositions
    if (ids && ids.length > max) throw validationFailed([{ field: 'positionIds', reason: `At most ${max} positions per forecast.` }])
    if (ids && new Set(ids).size !== ids.length) invalid.push({ field: 'positionIds', reason: 'Each position once.' })
    const starts = typeof b.from === 'string' && typeof b.to === 'string' ? windowsBetween(b.from, b.to, await windowMs(ctx)) : null
    if (!starts) invalid.push({ field: 'from', reason: 'from and to are dates (YYYY-MM-DD), from ≤ to, at most a year apart.' })
    if (b.advertiserId !== undefined && typeof b.advertiserId !== 'string') invalid.push({ field: 'advertiserId', reason: 'A string.' })
    const c = callerOf(req.partner, b.advertiserId as string | undefined)
    if (c.unknownAdvertiser) invalid.push({ field: 'advertiserId', reason: `Not an advertiser on ${req.partner.name}.` })
    /* The positions asked for, checked one by one — not the whole estate's
       visibility to find up to 200 of them (review, 24 Sep 2026). */
    const see = await visibilityFor(ctx, c)
    const positions: (PositionRef | null)[] = []
    for (const [i, id] of (ids ?? []).entries()) {
      const p = typeof id === 'string' ? await findPosition(ctx, id) : null
      if (!p || !(await see(p))) invalid.push({ field: `positionIds[${i}]`, reason: 'Unknown position.' })
      positions.push(p)
    }
    const r = b.rules === undefined ? { invalid: [], notPermitted: [] } : validateRules(b.rules, 'rules', req.partner, await ctx.company.variableAccess(), ctx.config.maxValuesPerCondition, ctx.config.campaignLimits)
    throwIfRejected(r, invalid)

    const rules = b.rules as Rules | undefined
    let views = 0
    for (const p of positions as PositionRef[]) {
      /* Each position over its own windows (OQ27): a weekly slot's week of views, per Monday in the range. */
      const own = (await startsOf(p, b.from as string, b.to as string)) as Date[]
      const perWindow = (await assumedViewsPerWindow(ctx, p)) * (await ctx.audience.targetedShare(p.displayType.id, rules))
      const facts = await windowFacts(ctx, p, own)
      views += own.filter((w) => windowStatus(p, c, w, facts) === 'available').length * perWindow
    }
    const assumedViews = Math.round(views)
    const company = await ctx.company.get()
    const multiplier = c.advertiser ? (await ctx.company.advertiserSetting(c.advertiser.id)).floorMultiplier : 1
    const cpm = effectiveFloorCpm(company, multiplier)
    return { assumedViews, currency: TRANSACTING_CURRENCY, estimatedCost: Math.round((assumedViews / 1000) * cpm * 100) / 100 }
  })
}
