/* Shared Targeting Variables (spec §6): which DSPs may target each variable. */
import type { FastifyPluginAsync } from 'fastify'
import type { Context } from '../../context'
import { sharedVariables, validateAccess } from '../../domain/variables'
import type { Guards } from '../../http/app'
import { validationFailed } from '../../http/errors'
import type { Access } from '../../repos/CompanySettingsRepo'

export const targetingVariableRoutes = (ctx: Context, guards: Guards): FastifyPluginAsync => async (app) => {
  app.get('/targeting-variables', async () => {
    guards.flagged()
    return { items: sharedVariables(ctx.company.variableAccess()) }
  })

  app.put<{ Body: { access?: unknown } }>('/targeting-variables', async (req) => {
    guards.flagged()
    const errors = validateAccess(req.body?.access, ctx.partners.list().map((p) => p.id))
    if (errors.length) throw validationFailed(errors)
    /* De-duplicate ids; an unset key keeps its default. */
    const access = Object.fromEntries(Object.entries(req.body!.access as Record<string, Access>).map(([k, a]) => [k, a === 'all' ? a : [...new Set(a)]]))
    ctx.company.saveVariableAccess(access)
    return { items: sharedVariables(ctx.company.variableAccess()) }
  })
}
