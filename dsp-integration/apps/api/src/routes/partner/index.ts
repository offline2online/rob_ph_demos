/* Partner API (/v1): connected DSPs and tier-2 partners. Returns 404 with
   the dspIntegration flag off (decision 6). */
import type { FastifyPluginAsync } from 'fastify'
import { partnerFromRequest } from '../../auth/partnerAuth'
import type { Context } from '../../context'
import type { Guards } from '../../http/app'
import type { PartnerRecord } from '../../repos/PartnerRepo'
import multipart from '@fastify/multipart'
import { campaignRoutes } from './campaigns'
import { targetingRoutes } from './targeting'

declare module 'fastify' {
  interface FastifyRequest {
    partner: PartnerRecord
  }
}

export const partnerRoutes = (ctx: Context, guards: Guards): FastifyPluginAsync => async (app) => {
  app.decorateRequest('partner', null as unknown as PartnerRecord)
  app.addHook('onRequest', async (req) => {
    guards.flagged()
    req.partner = partnerFromRequest(ctx, req)
  })
  await app.register(multipart)
  await app.register(targetingRoutes(ctx))
  await app.register(campaignRoutes(ctx))
}
