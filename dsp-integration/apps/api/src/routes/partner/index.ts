/* Partner API (/v1): connected DSPs and tier-2 partners. Returns 404 with
   the dspIntegration flag off (decision 6), and the same while the retailer
   has DSP integration switched off (Exchange settings): to a DSP the
   integration simply isn't there. Nothing it created is deleted. */
import type { FastifyPluginAsync } from 'fastify'
import { partnerFromRequest } from '../../auth/partnerAuth'
import type { Context } from '../../context'
import type { Guards } from '../../http/app'
import type { PartnerRecord } from '../../repos/PartnerRepo'
import multipart from '@fastify/multipart'
import { campaignRoutes } from './campaigns'
import { inventoryRoutes } from './inventory'
import { reservationRoutes } from './reservations'
import { targetingRoutes } from './targeting'
import { tokenBucket } from '../../http/rateLimit'
import { HttpError, notFound } from '../../http/errors'

declare module 'fastify' {
  interface FastifyRequest {
    partner: PartnerRecord
  }
}

export const partnerRoutes = (ctx: Context, guards: Guards): FastifyPluginAsync => async (app) => {
  app.decorateRequest('partner', null as unknown as PartnerRecord)
  /* One bucket per partner, not per token or per IP: a partner's whole
     integration shares its allowance (config.partnerRateLimit). */
  const limiter = tokenBucket(ctx.config.partnerRateLimit)
  app.addHook('onRequest', async (req, reply) => {
    guards.flagged()
    if (!ctx.exchange.get().enabled) throw notFound('DSP integration is switched off.')
    req.partner = partnerFromRequest(ctx, req)
    const wait = limiter.take(req.partner.id)
    if (wait) {
      reply.header('Retry-After', String(wait))
      throw new HttpError(429, 'rate_limited', `Too many requests from ${req.partner.name}; retry in ${wait}s.`)
    }
  })
  await app.register(multipart)
  await app.register(targetingRoutes(ctx))
  await app.register(campaignRoutes(ctx))
  await app.register(inventoryRoutes(ctx))
  await app.register(reservationRoutes(ctx))
}
