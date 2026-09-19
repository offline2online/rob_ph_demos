/* sellers.json, served by the API at /sellers.json (brief); in production
   at https://[domain]/sellers.json. 404 until Exchange settings are complete. */
import type { FastifyPluginAsync } from 'fastify'
import type { Context } from '../../context'
import { isComplete, sellersJson } from '../../domain/exchange'

export const sellersJsonRoutes = (ctx: Context): FastifyPluginAsync => async (app) => {
  app.get('/sellers.json', async (_req, reply) => {
    const e = ctx.exchange.get()
    if (!ctx.flags.dspIntegration || !isComplete(e)) return reply.status(404).send()
    return sellersJson(e)
  })
}
