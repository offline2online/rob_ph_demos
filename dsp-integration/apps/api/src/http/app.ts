/* Fastify app. Every path in the contract is served under /api
   (servers: https://{instance}/api); sellers.json is served at the root. */
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify'
import type { Session } from '@ph-dsp/types'
import { hasScope, type Scope } from '../auth/session'
import type { Context } from '../context'
import { HttpError, forbidden, notFound } from './errors'
import { adminRoutes } from '../routes/admin'
import { partnerRoutes } from '../routes/partner'
import { sellersJsonRoutes } from '../routes/public/sellersJson'

declare module 'fastify' {
  interface FastifyRequest {
    session: Session
  }
}

export interface Guards {
  /* New behaviour behind the dspIntegration flag: 404 when it is off. */
  flagged: () => void
  requireScope: (req: FastifyRequest, scope: Scope) => void
}

export function buildApp(ctx: Context, opts: { logger?: boolean } = {}): FastifyInstance {
  const app = Fastify({
    logger: opts.logger ? { redact: ['req.headers.authorization', 'req.body.credentials'] } : false,
    ajv: { customOptions: { removeAdditional: false, coerceTypes: false } },
  })
  app.decorateRequest('session', null as unknown as Session)
  app.addHook('onRequest', async (req) => {
    /* Stand-in HQ Admin session for every admin request (POC_ROLE). */
    if (req.url.startsWith('/api/admin/')) req.session = ctx.session.current()
  })

  const guards: Guards = {
    flagged: () => {
      if (!ctx.flags.dspIntegration) throw notFound()
    },
    requireScope: (req, scope) => {
      if (!hasScope(req.session, scope)) throw forbidden()
    },
  }

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof HttpError) return reply.status(err.status).send(err.body())
    const e = err as { validation?: { instancePath?: string; message?: string }[]; statusCode?: number; message: string }
    if (e.validation) {
      return reply.status(400).send({
        error: { code: 'validation_failed', message: 'Some fields are invalid.', details: e.validation.map((v) => ({ field: v.instancePath || '/', reason: v.message ?? 'invalid' })) },
      })
    }
    if (e.statusCode === 415 || e.statusCode === 400) return reply.status(400).send({ error: { code: 'validation_failed', message: e.message } })
    app.log.error(err)
    return reply.status(500).send({ error: { code: 'validation_failed', message: 'Unexpected error.' } })
  })
  app.setNotFoundHandler((_req, reply) => reply.status(404).send(notFound().body()))

  app.register(adminRoutes(ctx, guards), { prefix: '/api/admin/v1' })
  app.register(partnerRoutes(ctx, guards), { prefix: '/api/v1' })
  app.register(sellersJsonRoutes(ctx))
  return app
}
