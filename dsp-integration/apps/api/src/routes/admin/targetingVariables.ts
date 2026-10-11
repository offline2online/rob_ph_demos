/* Shared Targeting Variables (spec §6): which DSPs may target each variable. */
import type { FastifyPluginAsync } from 'fastify'
import type { Context } from '../../context'
import { isShared, sharedVariables, validateAccess, validateValues } from '../../domain/variables'
import type { Guards } from '../../http/app'
import { validationFailed } from '../../http/errors'
import type { Access, VariableValues } from '../../repos/CompanySettingsRepo'

export const targetingVariableRoutes = (ctx: Context, guards: Guards): FastifyPluginAsync => async (app) => {
  app.get('/targeting-variables', async (req) => {
    guards.flagged()
    guards.requireScope(req, 'admin')
    return { items: sharedVariables(await ctx.company.variableAccess(), await ctx.company.variableValues()) }
  })

  app.put<{ Body: { access?: unknown; values?: unknown } }>('/targeting-variables', async (req) => {
    guards.flagged()
    guards.requireScope(req, 'admin')
    const errors = validateAccess(req.body?.access, (await ctx.partners.list()).map((p) => p.id))
    /* Values are checked against the access as it will be after this save. */
    const effective = { ...(await ctx.company.variableAccess()), ...(req.body?.access as Record<string, Access>) }
    if (!errors.length) errors.push(...validateValues(req.body?.values, effective))
    if (errors.length) throw validationFailed(errors)
    /* De-duplicate ids; an unset key keeps its default. */
    const access = Object.fromEntries(Object.entries(req.body!.access as Record<string, Access>).map(([k, a]) => [k, a === 'all' ? a : [...new Set(a)]]))
    /* De-duplicated, trimmed values; a variable no longer shared loses its definition. */
    const values: Record<string, VariableValues> = Object.fromEntries(Object.entries((req.body!.values ?? {}) as Record<string, VariableValues>).map(([k, v]) => [k, { values: [...new Set(v.values.map((x) => x.trim()))], freeText: v.freeText }]))
    for (const k of Object.keys(access)) if (!isShared(effective[k])) values[k] = { values: [], freeText: false }
    await ctx.company.saveVariableAccess(access, values)
    return { items: sharedVariables(await ctx.company.variableAccess(), await ctx.company.variableValues()) }
  })
}
