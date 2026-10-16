/* Unsold real-time slots (ticket 3BXfWxs2jkN6S7awLXhQ, 16 Oct 2026): the
   missed-revenue and empty-slot report for the retailer, mirroring the
   lost-revenue report. Valued at the resolved floor CPM x assumed views, so
   indicative only: never billed and never shown to an advertiser. Hours are
   UTC. Per currency: figures are never summed across currencies. */
import type { FastifyPluginAsync } from 'fastify'
import type { Context } from '../../context'
import type { Guards } from '../../http/app'
import { validationFailed } from '../../http/errors'
import type { UnsoldBy, UnsoldReason, UnsoldRow } from '../../repos/UnsoldSlotRepo'

const DAY = 86_400_000
const BY: UnsoldBy[] = ['store', 'display', 'display_type', 'hour', 'day']
const round2 = (n: number) => Math.round(n * 100) / 100
const isDate = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(`${s}T00:00:00Z`))

export interface UnsoldReport {
  from: string
  to: string
  by: UnsoldBy
  totals: { currency: string; impressions: number; missedViews: number; missedAmount: number; reasons: Partial<Record<UnsoldReason, number>> }[]
  rows: UnsoldRow[]
}

export async function unsoldReport(ctx: Context, q: { from: string; to: string; by: UnsoldBy; storeId?: string; displayId?: string; displayTypeId?: string }): Promise<UnsoldReport> {
  /* `to` is a date and inclusive: the day after it is the exclusive bound. */
  const rows = await ctx.unsold.report({ ...q, from: `${q.from}T00:00:00.000Z`, to: new Date(Date.parse(`${q.to}T00:00:00Z`) + DAY).toISOString() })
  const totals = new Map<string, UnsoldReport['totals'][number]>()
  for (const r of rows) {
    const t = totals.get(r.currency) ?? { currency: r.currency, impressions: 0, missedViews: 0, missedAmount: 0, reasons: {} }
    t.impressions += r.impressions; t.missedViews += r.missedViews; t.missedAmount += r.missedAmount
    for (const [k, n] of Object.entries(r.reasons)) t.reasons[k as UnsoldReason] = (t.reasons[k as UnsoldReason] ?? 0) + (n as number)
    totals.set(r.currency, t)
  }
  return {
    from: q.from, to: q.to, by: q.by,
    totals: [...totals.values()].map((t) => ({ ...t, missedViews: round2(t.missedViews), missedAmount: round2(t.missedAmount) })).sort((a, b) => a.currency.localeCompare(b.currency)),
    rows: rows.map((r) => ({ ...r, floorCpmAvg: round2(r.floorCpmAvg), missedViews: round2(r.missedViews), missedAmount: round2(r.missedAmount) })),
  }
}

export const unsoldReportRoutes = (ctx: Context, guards: Guards): FastifyPluginAsync => async (app) => {
  app.get<{ Querystring: { from?: string; to?: string; by?: string; storeId?: string; displayId?: string; displayTypeId?: string } }>('/reports/unsold', async (req) => {
    guards.flagged()
    const { from, to, by = 'store', storeId, displayId, displayTypeId } = req.query
    const errors: { field: string; reason: string }[] = []
    if (!isDate(from) || !isDate(to) || from > to || Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`) > 366 * DAY) errors.push({ field: 'from', reason: 'from and to are dates (YYYY-MM-DD), from ≤ to, at most 366 days apart.' })
    if (!BY.includes(by as UnsoldBy)) errors.push({ field: 'by', reason: 'by is store, display, display_type, hour or day.' })
    if (errors.length) throw validationFailed(errors)
    return unsoldReport(ctx, { from: from as string, to: to as string, by: by as UnsoldBy, storeId, displayId, displayTypeId })
  })
}
