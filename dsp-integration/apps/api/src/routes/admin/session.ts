/* POC stand-in: GET /admin/v1/session. */
import type { FastifyPluginAsync } from 'fastify'
import type { Context } from '../../context'
import type { Guards } from '../../http/app'

export const sessionRoutes = (_ctx: Context, _guards: Guards): FastifyPluginAsync => async (app) => {
  app.get('/session', async (req) => req.session)
}
