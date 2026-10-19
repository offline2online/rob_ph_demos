/* Fastify app. Every path in the contract is served under /api
   (servers: https://{instance}/api); sellers.json is served at the root. */
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify'
import type { Session } from '@ph-dsp/types'
import { hasScope, type Scope } from '../auth/session'
import type { Context } from '../context'
import { HttpError, forbidden, notFound } from './errors'
import { adminRoutes } from '../routes/admin'
import { playerRoutes } from '../routes/player'
import { partnerRoutes } from '../routes/partner'
import { sellersJsonRoutes } from '../routes/public/sellersJson'
import { mimeOf } from '../platform/AssetStore'
import { onFree } from '../db/db'
import { appliedVersions, loadMigrations } from '../db/migrate'
import { auditActorOf, diffSnapshots, isAuditedWrite, takeSnapshot, type Snapshot } from '../domain/sspAudit'
import type { AuditActor } from '../repos/SspAuditRepo'

declare module 'fastify' {
  interface FastifyRequest {
    session: Session
    /* Set while an audited SSP-settings write is in flight (domain/sspAudit.ts). */
    sspAudit?: { actor: AuditActor; reason: string | null; before: Snapshot; release: () => void }
  }
}

export interface Guards {
  /* New behaviour behind the dspIntegration flag: 404 when it is off. */
  flagged: () => void
  requireScope: (req: FastifyRequest, scope: Scope) => void
}

/* The path a request is decided on: the route the router matched (pre-handover
   review, 18 Oct 2026). The router decodes percent-escapes before it matches,
   so the raw URL is the wrong thing to test — `/api/%61dmin/v1/display-types`
   reaches the admin route while `req.url.startsWith('/api/admin/')` is false,
   which skipped the session and scope check and the SSP audit log. The matched
   pattern (`/api/admin/v1/display-types/:id`) cannot be spelled two ways. A
   request no route matched is a 404 whatever it says; its path is decoded so
   the hooks still see what it was aimed at. */
export function routePathOf(req: Pick<FastifyRequest, 'url' | 'routeOptions'>): string {
  const matched = req.routeOptions?.url
  if (matched) return matched
  const raw = req.url.split('?')[0]
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}

const REQUEST_TIMEOUT_MS = 15 * 60_000

export function buildApp(ctx: Context, opts: { logger?: boolean } = {}): FastifyInstance {
  const app = Fastify({
    logger: opts.logger ? { redact: ['req.headers.authorization', 'req.body.credentials'] } : false,
    /* How long a client may take to send a whole request. Fastify's default is
       no limit, so a partner trickling an upload body a byte at a time held one
       of the process's few upload slots (PH_MAX_UPLOADS_IN_FLIGHT) for ever —
       the ALB's idle timer restarts on every byte (pre-handover review, 18 Oct
       2026). Fifteen minutes is a 200 MB creative at under 2 Mbit/s. Sending a
       response is not limited by it. */
    requestTimeout: REQUEST_TIMEOUT_MS,
    ajv: { customOptions: { removeAdditional: false, coerceTypes: false } },
  })
  app.decorateRequest('session', null as unknown as Session)
  app.addHook('onRequest', async (req) => {
    /* Stand-in HQ Admin session for every admin request (POC_ROLE). Help
       desk users see none of this build (spec, "Who sees each section"). */
    const path = routePathOf(req)
    if (path.startsWith('/api/admin/')) {
      req.session = await ctx.session.current()
      /* Everything but the session itself, which tells the UI who is asking. */
      if (!path.startsWith('/api/admin/v1/session') && !hasScope(req.session, 'sections')) throw forbidden()
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
    if (routePathOf(req).startsWith('/api/')) reply.header('Cache-Control', 'no-store')
    return payload
  })


  /* SSP settings audit log: an admin write that can change a retailer-side
     setting runs alone (so the before and after snapshots hold only its own
     change), and every field it changed is recorded before the response
     leaves — a client that reads the history right after its save sees it. */
  let auditTail: Promise<void> = Promise.resolve()
  app.decorateRequest('sspAudit', undefined)
  app.addHook('preHandler', async (req) => {
    if (!isAuditedWrite(req.method, routePathOf(req))) return
    const { actor, reason } = auditActorOf(req)
    let release!: () => void
    const turn = auditTail
    auditTail = new Promise<void>((r) => (release = r))
    await turn
    try {
      req.sspAudit = { actor, reason, before: await takeSnapshot(ctx), release }
    } catch (e) {
      release()
      throw e
    }
  })
  app.addHook('onSend', async (req, reply, payload) => {
    const a = req.sspAudit
    if (!a) return payload
    req.sspAudit = undefined
    try {
      if (reply.statusCode < 300) {
        const drafts = diffSnapshots(a.before, await takeSnapshot(ctx))
        await ctx.sspAudit.record({ actor: a.actor, request: `${req.method} ${req.url.split('?')[0]}`, reason: a.reason, at: new Date().toISOString() }, drafts)
      }
    } finally {
      a.release()
    }
    return payload
  })
  app.addHook('onRequestAbort', async (req) => req.sspAudit?.release())

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
      const applied = new Set(await onFree(ctx.db, () => appliedVersions(ctx.db)))
      const missing = migrations.filter((v) => !applied.has(v)).length
      if (missing) return reply.status(503).send({ ok: false, reason: `${missing} migration${missing === 1 ? '' : 's'} not applied.` })
      return { ok: true }
    } catch {
      return reply.status(503).send({ ok: false, reason: 'The database is not available.' })
    }
  })

  app.register(adminRoutes(ctx, guards), { prefix: '/api/admin/v1' })
  app.register(partnerRoutes(ctx, guards), { prefix: '/api/v1' })
  app.register(playerRoutes(ctx, guards), { prefix: '/api/player/v1' })
  app.register(sellersJsonRoutes(ctx))
  /* AssetStore files (stand-in for the platform's asset hosting). */
  app.get<{ Params: { file: string } }>('/assets/:file', async (req, reply) => {
    /* Streamed from the store when it can, so a download never holds the
       whole file in memory (AssetStore.open). */
    const opened = ctx.assets.open ? await ctx.assets.open(req.params.file) : undefined
    if (opened) return reply.type(mimeOf(req.params.file)).header('Content-Length', opened.sizeBytes).send(opened.stream)
    if (opened === null) return reply.status(404).send(notFound().body())
    const bytes = await ctx.assets.read(req.params.file)
    if (!bytes) return reply.status(404).send(notFound().body())
    return reply.type(mimeOf(req.params.file)).send(bytes)
  })
  return app
}
