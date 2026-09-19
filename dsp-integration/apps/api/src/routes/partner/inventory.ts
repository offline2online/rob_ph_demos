/* Inventory API (spec §5): read-only, derived from the slots assigned on each
   display type. Only positions the caller could buy are listed.
     GET  /v1/inventory
     GET  /v1/inventory/{positionId}
     GET  /v1/inventory/{positionId}/availability?from=&to=
     POST /v1/inventory/forecast */
import { TARGETING_VARIABLES } from '@ph-dsp/types'
import type { FastifyPluginAsync } from 'fastify'
import type { Context } from '../../context'
import { type Caller, type PositionRef, type WindowStatus, allPositions, callerOf, isVisible, nextWindow, positionView, windowMs, windowStatus, windowsBetween } from '../../domain/positions'
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
  const visible = (c: Caller) => allPositions(ctx).filter((p) => isVisible(ctx, p, c))
  const visibleOne = (c: Caller, id: string) => {
    const p = visible(c).find((x) => x.positionId === id)
    if (!p) throw notFound('Position not found.')
    return p
  }
  const windowsOf = (ctx2: Context, p: PositionRef, c: Caller, starts: Date[]) =>
    starts.map((start) => ({
      start: start.toISOString(),
      end: new Date(start.getTime() + windowMs(ctx2)).toISOString(),
      status: windowStatus(ctx2, p, c, start),
      assumedViews: ctx2.audience.forSlot(p.displayType.id, p.slot).assumedViewsPerWindow,
    }))

  app.get<{ Querystring: ListQuery }>('/inventory', async (req) => {
    const q = req.query
    const c = callerOf(req.partner, q.advertiserId)
    const next = dateOf(nextWindow(ctx))
    /* No dates: the next window that can be sold. */
    const range = windowsBetween(ctx, q.from ?? q.to ?? next, q.to ?? q.from ?? next) ?? windowsBetween(ctx, next, next)!
    const stores = list(q.storeIds)
    const items = visible(c).filter((p) => {
      if (q.displayTypeId && p.displayType.id !== q.displayTypeId) return false
      if (q.touchPoint && p.displayType.touchPoint !== q.touchPoint) return false
      if (stores.length && !ctx.displays.listByDisplayType(p.displayType.id).some((d) => stores.includes(d.store))) return false
      /* Stores carry no region yet (spec open question 35), so no position matches one (Q10). */
      if (q.region) return false
      if (q.status && STATUSES.includes(q.status as WindowStatus)) return range.some((w) => windowStatus(ctx, p, c, w) === q.status)
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
    const starts = typeof b.from === 'string' && typeof b.to === 'string' ? windowsBetween(ctx, b.from, b.to) : null
    if (!starts) invalid.push({ field: 'from', reason: 'from and to are dates (YYYY-MM-DD), from ≤ to, at most a year apart.' })
    if (b.advertiserId !== undefined && typeof b.advertiserId !== 'string') invalid.push({ field: 'advertiserId', reason: 'A string.' })
    const c = callerOf(req.partner, b.advertiserId as string | undefined)
    if (c.unknownAdvertiser) invalid.push({ field: 'advertiserId', reason: `Not an advertiser on ${req.partner.name}.` })
    const mine = visible(c)
    const positions = (ids ?? []).map((id, i) => {
      const p = mine.find((x) => x.positionId === id)
      if (!p) invalid.push({ field: `positionIds[${i}]`, reason: 'Unknown position.' })
      return p
    })
    const r = b.rules === undefined ? { invalid: [], notPermitted: [] } : validateRules(b.rules, 'rules', req.partner, ctx.company.variableAccess(), ctx.config.maxValuesPerCondition)
    throwIfRejected(r, invalid)

    const rules = b.rules as Rules | undefined
    let views = 0
    for (const p of positions as PositionRef[]) {
      const perWindow = ctx.audience.forSlot(p.displayType.id, p.slot).assumedViewsPerWindow * ctx.audience.targetedShare(p.displayType.id, rules)
      views += (starts as Date[]).filter((w) => windowStatus(ctx, p, c, w) === 'available').length * perWindow
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
