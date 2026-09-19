import type { FastifyPluginAsync } from 'fastify'
import type { Context } from '../../context'
import type { Guards } from '../../http/app'
import { sessionRoutes } from './session'

export const adminRoutes = (ctx: Context, guards: Guards): FastifyPluginAsync => async (app) => {
  await app.register(sessionRoutes(ctx, guards))
}
