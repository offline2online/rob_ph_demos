/* GET /v1/targeting/attributes — the variables the calling DSP may target.
   Never values: PH evaluates conditions and answers matched / not matched. */
import type { TargetingAttribute } from '@ph-dsp/types'
import type { FastifyPluginAsync } from 'fastify'
import type { Context } from '../../context'
import { permittedFor } from '../../domain/variables'

export const targetingRoutes = (ctx: Context): FastifyPluginAsync => async (app) => {
  app.get('/targeting/attributes', async (req): Promise<{ items: TargetingAttribute[] }> => ({
    items: permittedFor(req.partner, ctx.company.variableAccess()).map((v) => ({ key: v.key, source: v.source, label: v.label, group: v.group, operators: v.operators })),
  }))
}
