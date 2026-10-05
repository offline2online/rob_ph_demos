/* Lost revenue from display downtime (Rob, 4 Oct 2026, settlement is final;
   spec §4 "Billing"): what the plays received AFTER their window was
   invoiced would have been worth at the window's cleared CPM (no personalised uplift),
   by store, by display or over time.
   An operational report for the retailer: it is never shown on, or charged
   to, an advertiser's invoice, and no line item ever changes because of it.
   Plays are placed by when they played, so a night of downtime shows on the
   night it happened, however late the backfill arrives. */
import type { FastifyPluginAsync } from 'fastify'
import type { Context } from '../../context'
import type { Guards } from '../../http/app'
import { validationFailed } from '../../http/errors'
import type { LostRevenueBy, LostRevenueRow } from '../../repos/LateLedgerRepo'

const DAY = 86_400_000
const BY: LostRevenueBy[] = ['store', 'display', 'day']
const round2 = (n: number) => Math.round(n * 100) / 100
const isDate = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(`${s}T00:00:00Z`))

export interface LostRevenueReport {
  from: string
  to: string
  by: LostRevenueBy
  /* Per currency: the figures are never summed across currencies. */
  totals: { currency: string; plays: number; lostSec: number; lostViews: number; lostAmount: number }[]
  rows: (LostRevenueRow & { lostAmount: number })[]
}

export async function lostRevenueReport(ctx: Context, q: { from: string; to: string; by: LostRevenueBy; storeId?: string; displayId?: string }): Promise<LostRevenueReport> {
  /* `to` is a date and inclusive: the day after it is the exclusive bound. */
  const end = new Date(Date.parse(`${q.to}T00:00:00Z`) + DAY).toISOString()
  const rows = await ctx.lateLedger.report({ from: `${q.from}T00:00:00.000Z`, to: end, by: q.by, storeId: q.storeId, displayId: q.displayId })
  const totals = new Map<string, LostRevenueReport['totals'][number]>()
  for (const r of rows) {
    const t = totals.get(r.currency) ?? { currency: r.currency, plays: 0, lostSec: 0, lostViews: 0, lostAmount: 0 }
    t.plays += r.plays; t.lostSec += r.lostSec; t.lostViews += r.lostViews; t.lostAmount += r.lostAmount
    totals.set(r.currency, t)
  }
  return {
    from: q.from, to: q.to, by: q.by,
    totals: [...totals.values()].map((t) => ({ ...t, lostViews: round2(t.lostViews), lostAmount: round2(t.lostAmount) })).sort((a, b) => a.currency.localeCompare(b.currency)),
    rows: rows.map((r) => ({ ...r, lostViews: round2(r.lostViews), lostAmount: round2(r.lostAmount) })),
  }
}

export const lostRevenueRoutes = (ctx: Context, guards: Guards): FastifyPluginAsync => async (app) => {
  app.get<{ Querystring: { from?: string; to?: string; by?: string; storeId?: string; displayId?: string } }>('/reports/lost-revenue', async (req) => {
    guards.flagged()
    const { from, to, by = 'store', storeId, displayId } = req.query
    const errors: { field: string; reason: string }[] = []
    if (!isDate(from) || !isDate(to) || from > to || Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`) > 366 * DAY) errors.push({ field: 'from', reason: 'from and to are dates (YYYY-MM-DD), from ≤ to, at most 366 days apart.' })
    if (!BY.includes(by as LostRevenueBy)) errors.push({ field: 'by', reason: 'by is store, display or day.' })
    if (errors.length) throw validationFailed(errors)
    return lostRevenueReport(ctx, { from: from as string, to: to as string, by: by as LostRevenueBy, storeId, displayId })
  })
}
