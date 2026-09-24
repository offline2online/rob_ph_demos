/* sellers.json, served by the API at /sellers.json (brief); in production
   at https://[domain]/sellers.json. 404 until Exchange settings are complete,
   and while DSP integration is switched off. */
import type { FastifyPluginAsync } from 'fastify'
import type { Context } from '../../context'
import { isLive, sellersJson } from '../../domain/exchange'

export const sellersJsonRoutes = (ctx: Context): FastifyPluginAsync => async (app) => {
  app.get('/sellers.json', async (_req, reply) => {
    const e = ctx.exchange.get()
    if (!ctx.flags.dspIntegration || !isLive(e)) return reply.status(404).send()
    return sellersJson(e)
  })
}
