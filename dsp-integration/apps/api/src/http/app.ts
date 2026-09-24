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
import { mimeOf } from '../platform/AssetStore'
import { appliedVersions, loadMigrations } from '../db/migrate'

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
    /* Stand-in HQ Admin session for every admin request (POC_ROLE). Help
       desk users see none of this build (spec, "Who sees each section"). */
    if (req.url.startsWith('/api/admin/')) {
      req.session = ctx.session.current()
      /* Everything but the session itself, which tells the UI who is asking. */
      if (!req.url.startsWith('/api/admin/v1/session') && !hasScope(req.session, 'sections')) throw forbidden()
    }
  })

  const guards: Guards = {
    flagged: () => {
      if (!ctx.flags.dspIntegration) throw notFound()
    },
    requireScope: (req, scope) => {
      if (!hasScope(req.session, scope)) throw forbidden()
    },
  }

  /* Security headers on every response (review, 23 Sep 2026). Everything
     this server returns is data — JSON, or a creative file under /assets —
     never a page, so it can be locked right down:
     - nosniff: a browser must not reinterpret an uploaded creative as HTML
       or script;
     - a CSP of default-src 'none' (with inline style only, for SVG
       creatives): even if a creative is opened directly it can't run script
       or load anything;
     - frame-ancestors 'none': nothing here is meant to be framed (the admin
       UI that HQ Admin iframes is served separately, not by this API);
     - no-store on the APIs: pricing, bids and settings must not be cached by
       a proxy or the browser. Creatives may be cached.
     HSTS belongs on the platform's TLS edge, not here (PH-CORE-BOUNDARIES.md). */
  app.addHook('onSend', async (req, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff')
    reply.header('Referrer-Policy', 'no-referrer')
    reply.header('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'")
    reply.header('Cross-Origin-Resource-Policy', req.url.startsWith('/assets/') ? 'cross-origin' : 'same-origin')
    if (req.url.startsWith('/api/')) reply.header('Cache-Control', 'no-store')
    return payload
  })

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof HttpError) return reply.status(err.status).send(err.body())
    const e = err as { validation?: { instancePath?: string; message?: string }[]; statusCode?: number; message: string }
    if (e.validation) {
      return reply.status(400).send({
        error: { code: 'validation_failed', message: 'Some fields are invalid.', details: e.validation.map((v) => ({ field: v.instancePath || '/', reason: v.message ?? 'invalid' })) },
      })
    }
    /* Fastify's own client errors keep their status: a body over the limit is
       413, a second file in an upload 413, and so on. They used to become 500 "Unexpected error", which told the caller
       nothing and logged every oversized request as a server fault. */
    /* A wrong content type stays 400 validation_failed, as the contract has
       always answered it. */
    if (e.statusCode === 415) return reply.status(400).send({ error: { code: 'validation_failed', message: e.message } })
    if (e.statusCode && e.statusCode >= 400 && e.statusCode < 500) {
      return reply.status(e.statusCode).send({ error: { code: e.statusCode === 429 ? 'rate_limited' : 'validation_failed', message: e.message } })
    }
    /* A real server fault: logged in full, reported without internals. */
    app.log.error(err)
    return reply.status(500).send({ error: { code: 'internal_error', message: 'Unexpected error.' } })
  })
  app.setNotFoundHandler((_req, reply) => reply.status(404).send(notFound().body()))

  /* For whatever supervises the process — Kubernetes probes, a load
     balancer's health check (deploy/kubernetes/) — at the root like
     sellers.json, and in openapi.yaml under Operations. /healthz: the
     process answers. /readyz: the database answers and every migration is
     applied, so requests can be served; 503 until then, which keeps a pod
     out of the load balancer while it restores or migrates. Neither reads
     partner or admin data. */
  const migrations = loadMigrations().map((m) => m.version)
  app.get('/healthz', async () => ({ ok: true }))
  app.get('/readyz', async (_req, reply) => {
    try {
      const applied = new Set(appliedVersions(ctx.db))
      const missing = migrations.filter((v) => !applied.has(v)).length
      if (missing) return reply.status(503).send({ ok: false, reason: `${missing} migration${missing === 1 ? '' : 's'} not applied.` })
      return { ok: true }
    } catch {
      return reply.status(503).send({ ok: false, reason: 'The database is not available.' })
    }
  })

  app.register(adminRoutes(ctx, guards), { prefix: '/api/admin/v1' })
  app.register(partnerRoutes(ctx, guards), { prefix: '/api/v1' })
  app.register(sellersJsonRoutes(ctx))
  /* AssetStore files (stand-in for the platform's asset hosting). */
  app.get<{ Params: { file: string } }>('/assets/:file', async (req, reply) => {
    const bytes = ctx.assets.read(req.params.file)
    if (!bytes) return reply.status(404).send(notFound().body())
    return reply.type(mimeOf(req.params.file)).send(bytes)
  })
  return app
}
