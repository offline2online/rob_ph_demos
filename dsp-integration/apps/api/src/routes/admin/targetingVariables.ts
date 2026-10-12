/* Shared Targeting Variables (spec §6): which DSPs may target each variable. */
import type { FastifyPluginAsync } from 'fastify'
import type { Context } from '../../context'
import { TARGETING_VARIABLES } from '@ph-dsp/types'
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
    const before = await ctx.company.variableAccess()
    /* Un-sharing a variable that was shared drops its definition rather than failing the save. */
    const bodyValues = req.body?.values
    if (bodyValues && typeof bodyValues === 'object' && !Array.isArray(bodyValues) && req.body?.access && typeof req.body.access === 'object') {
      const acc = req.body.access as Record<string, Access>
      for (const k of Object.keys(bodyValues)) if (k in acc && !isShared(acc[k]) && isShared(before[k])) (bodyValues as Record<string, unknown>)[k] = { values: [], freeText: false }
    }
    const errors = validateAccess(req.body?.access, (await ctx.partners.list()).map((p) => p.id))
    /* Values are checked against the access as it will be after this save. */
    const effective = { ...before, ...(req.body?.access as Record<string, Access>) }
    if (!errors.length) errors.push(...validateValues(req.body?.values, effective))
    if (errors.length) throw validationFailed(errors)
    /* De-duplicate ids; an unset key keeps its default. */
    const access = Object.fromEntries(Object.entries(req.body!.access as Record<string, Access>).map(([k, a]) => [k, a === 'all' ? a : [...new Set(a)]]))
    /* De-duplicated, trimmed values; a variable no longer shared loses its definition. */
    const values: Record<string, VariableValues> = Object.fromEntries(Object.entries((req.body!.values ?? {}) as Record<string, VariableValues>).map(([k, v]) => [k, { values: [...new Set(v.values.map((x) => x.trim()))], freeText: v.freeText }]))
    for (const k of Object.keys(access)) if (!isShared(effective[k])) values[k] = { values: [], freeText: false }
    /* A closed vocabulary (age brackets) is the platform's, not the retailer's to edit. */
    for (const v of TARGETING_VARIABLES) if (v.fixedValues) delete values[v.key]
    await ctx.company.saveVariableAccess(access, values)
    return { items: sharedVariables(await ctx.company.variableAccess(), await ctx.company.variableValues()) }
  })
}
