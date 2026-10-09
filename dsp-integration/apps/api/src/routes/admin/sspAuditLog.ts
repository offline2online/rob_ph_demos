/* The SSP settings change history (domain/sspAudit.ts). One read endpoint
   for both audiences: the Change history page and an agent tracing when, and
   by whom, a setting moved. Admin only; never writable through the API. */
import type { FastifyPluginAsync } from 'fastify'
import type { Context } from '../../context'
import type { Guards } from '../../http/app'
import { validationFailed } from '../../http/errors'
import { DEFAULT_PAGE, MAX_PAGE, type AuditQuery } from '../../repos/SspAuditRepo'

type Q = Record<string, string | undefined>
const OBJECT_TYPES = ['exchange', 'pricing_settings', 'advertiser_setting', 'targeting_variable_access', 'buyers_list', 'display_type', 'dsp_partner']

export const sspAuditLogRoutes = (ctx: Context, guards: Guards): FastifyPluginAsync => async (app) => {
  app.get<{ Querystring: Q }>('/ssp-audit-log', async (req) => {
    guards.flagged()
    guards.requireScope(req, 'admin')
    const q = req.query
    const errors: { field: string; reason: string }[] = []
    const date = (k: 'from' | 'to') => {
      const v = q[k]
      if (v === undefined || v === '') return undefined
      const t = Date.parse(v)
      if (Number.isNaN(t)) return void errors.push({ field: k, reason: 'An ISO 8601 date-time.' })
      return new Date(t).toISOString()
    }
    const query: AuditQuery = {}
    if (q.objectType) { if (OBJECT_TYPES.includes(q.objectType)) query.objectType = q.objectType; else errors.push({ field: 'objectType', reason: `One of ${OBJECT_TYPES.join(', ')}.` }) }
    if (q.objectId) query.objectId = q.objectId
    if (q.field) query.field = q.field
    if (q.fieldPrefix) query.fieldPrefix = q.fieldPrefix
    if (q.actorType) { if (q.actorType === 'human' || q.actorType === 'agent') query.actorType = q.actorType; else errors.push({ field: 'actorType', reason: 'human or agent.' }) }
    if (q.actorId) query.actorId = q.actorId
    if (q.changeId) query.changeId = q.changeId
    query.from = date('from')
    query.to = date('to')
    if (query.from && query.to && query.from > query.to) errors.push({ field: 'to', reason: 'Must be on or after from.' })
    if (q.order) { if (q.order === 'asc' || q.order === 'desc') query.order = q.order; else errors.push({ field: 'order', reason: 'asc or desc (default desc, newest first).' }) }
    if (q.limit) {
      const n = Number(q.limit)
      if (!Number.isInteger(n) || n < 1 || n > MAX_PAGE) errors.push({ field: 'limit', reason: `A whole number from 1 to ${MAX_PAGE} (default ${DEFAULT_PAGE}).` })
      else query.limit = n
    }
    if (q.cursor) {
      const n = Number(q.cursor)
      if (!Number.isInteger(n) || n < 1) errors.push({ field: 'cursor', reason: 'The next value of the previous page.' })
      else query.before = n
    }
    if (errors.length) throw validationFailed(errors)
    return ctx.sspAudit.query(query)
  })
}
