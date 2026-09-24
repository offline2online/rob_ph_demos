/* Inventory API (spec §5): read-only, derived from the slots assigned on each
   display type. Only positions the caller could buy are listed.
     GET  /v1/inventory
     GET  /v1/inventory/{positionId}
     GET  /v1/inventory/{positionId}/availability?from=&to=
     POST /v1/inventory/forecast */
import { TARGETING_VARIABLES } from '@ph-dsp/types'
import type { FastifyPluginAsync } from 'fastify'
import type { Context } from '../../context'
import { type Caller, type PositionRef, type WindowStatus, allPositions, callerOf, findPosition, nextWindow, positionView, visibilityFor, windowFacts, windowMs, windowStatus, windowsBetween } from '../../domain/positions'
import { effectiveFloorCpm } from '../../domain/pricing'
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
  /* One visibility check per request, applied per position (positions.ts). */
  const visible = (c: Caller) => allPositions(ctx).filter(visibilityFor(ctx, c))
  /* One position: find it, then check the caller may see it — rather than
     working out visibility for every position in the estate to find one.
     A position the caller may not buy is a 404, exactly as if it didn't
     exist (visibility, not rejection). */
  const visibleOne = (c: Caller, id: string) => {
    const p = findPosition(ctx, id)
    if (!p || !visibilityFor(ctx, c)(p)) throw notFound('Position not found.')
    return p
  }
  const windowsOf = (ctx2: Context, p: PositionRef, c: Caller, starts: Date[]) => {
    /* Per-position facts and audience once, not once per window (up to 366). */
    const facts = windowFacts(ctx2, p, starts)
    const len = windowMs(ctx2)
    const assumedViews = ctx2.audience.forSlot(p.displayType.id, p.slot).assumedViewsPerWindow
    return starts.map((start) => ({
      start: start.toISOString(),
      end: new Date(start.getTime() + len).toISOString(),
      status: windowStatus(ctx2, p, c, start, facts),
      assumedViews,
    }))
  }

  app.get<{ Querystring: ListQuery }>('/inventory', async (req) => {
    const q = req.query
    const c = callerOf(req.partner, q.advertiserId)
    const next = dateOf(nextWindow(ctx))
    /* No dates: the next window that can be sold. */
    const range = windowsBetween(ctx, q.from ?? q.to ?? next, q.to ?? q.from ?? next) ?? windowsBetween(ctx, next, next)!
    const stores = list(q.storeIds)
    const byStatus = q.status && STATUSES.includes(q.status as WindowStatus) ? (q.status as WindowStatus) : null
    /* The status filter asks about every position over the whole range:
       what is taken is read once for the estate (one ranged query) and
       handed to each position, instead of one query per position — 2,400
       of them a request on a large estate (review, 24 Sep 2026). */
    const taken = byStatus ? ctx.reservations.takenInRange(range[0].toISOString(), new Date(range[range.length - 1].getTime() + 1).toISOString()) : undefined
    const items = visible(c).filter((p) => {
      if (q.displayTypeId && p.displayType.id !== q.displayTypeId) return false
      if (q.touchPoint && p.displayType.touchPoint !== q.touchPoint) return false
      /* Store IDs and regions are the platform's (StoreSource, Q10). The
         display type's stores are only read when one of those filters asks
         for them — the stores, not the displays. */
      if (stores.length || q.region) {
        const inStores = ctx.displays.storeIdsByDisplayType(p.displayType.id)
        if (stores.length && !inStores.some((id) => stores.includes(id))) return false
        if (q.region && !inStores.some((id) => ctx.stores.get(id)?.region?.toLowerCase() === q.region!.toLowerCase())) return false
      }
      if (byStatus) {
        const facts = windowFacts(ctx, p, range, taken)
        return range.some((w) => windowStatus(ctx, p, c, w, facts) === byStatus)
      }
      return true
    })
    const start = Number(q.cursor) || 0
    const limit = Math.min(Math.max(Number(q.limit) || 50, 1), 200)
    return {
      items: items.slice(start, start + limit).map((p) => positionView(ctx, p, c)),
      nextCursor: start + limit < items.length ? String(start + limit) : null,
    }
  })

  app.get<{ Params: { positionId: string }; Querystring: { advertiserId?: string } }>('/inventory/:positionId', async (req) => {
    const c = callerOf(req.partner, req.query.advertiserId)
    return positionView(ctx, visibleOne(c, req.params.positionId), c)
  })

  app.get<{ Params: { positionId: string }; Querystring: { from?: string; to?: string; advertiserId?: string } }>('/inventory/:positionId/availability', async (req) => {
    const { from, to } = req.query
    const starts = from && to ? windowsBetween(ctx, from, to) : null
    if (!starts) throw validationFailed([{ field: 'from', reason: 'from and to are dates (YYYY-MM-DD), from ≤ to, at most a year apart.' }])
    const c = callerOf(req.partner, req.query.advertiserId)
    const p = visibleOne(c, req.params.positionId)
    return { positionId: p.positionId, windows: windowsOf(ctx, p, c, starts) }
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
    const starts = typeof b.from === 'string' && typeof b.to === 'string' ? windowsBetween(ctx, b.from, b.to) : null
    if (!starts) invalid.push({ field: 'from', reason: 'from and to are dates (YYYY-MM-DD), from ≤ to, at most a year apart.' })
    if (b.advertiserId !== undefined && typeof b.advertiserId !== 'string') invalid.push({ field: 'advertiserId', reason: 'A string.' })
    const c = callerOf(req.partner, b.advertiserId as string | undefined)
    if (c.unknownAdvertiser) invalid.push({ field: 'advertiserId', reason: `Not an advertiser on ${req.partner.name}.` })
    /* The positions asked for, checked one by one — not the whole estate's
       visibility to find up to 200 of them (review, 24 Sep 2026). */
    const see = visibilityFor(ctx, c)
    const positions = (ids ?? []).map((id, i) => {
      const p = typeof id === 'string' ? findPosition(ctx, id) : null
      if (!p || !see(p)) invalid.push({ field: `positionIds[${i}]`, reason: 'Unknown position.' })
      return p
    })
    const r = b.rules === undefined ? { invalid: [], notPermitted: [] } : validateRules(b.rules, 'rules', req.partner, ctx.company.variableAccess(), ctx.config.maxValuesPerCondition, ctx.config.campaignLimits)
    throwIfRejected(r, invalid)

    const rules = b.rules as Rules | undefined
    let views = 0
    for (const p of positions as PositionRef[]) {
      const perWindow = ctx.audience.forSlot(p.displayType.id, p.slot).assumedViewsPerWindow * ctx.audience.targetedShare(p.displayType.id, rules)
      const facts = windowFacts(ctx, p, starts as Date[])
      views += (starts as Date[]).filter((w) => windowStatus(ctx, p, c, w, facts) === 'available').length * perWindow
    }
    const assumedViews = Math.round(views)
    /* Targeting on a Personalisation Variable makes it a personalised campaign (spec §4). */
    const personalised = (rules ?? []).some((g) => g.some((cond) => TARGETING_VARIABLES.find((v) => v.key === cond.variable)?.group === 'personalisation'))
    const company = ctx.company.get()
    const multiplier = c.advertiser ? ctx.company.advertiserSetting(c.advertiser.id).floorMultiplier : 1
    const cpm = effectiveFloorCpm(company, multiplier, { personalised })
    return { assumedViews, currency: company.currency, estimatedCost: Math.round((assumedViews / 1000) * cpm * 100) / 100 }
  })
}
