/* Player API (/api/player/v1), 7 Oct 2026: what PH Core's PWA player calls
   for real-time bidding (exchange/realtime.ts) — the impression-available
   signal and the proof of play. Not for partners: its own credential
   (PH_PLAYER_TOKEN), its own prefix. 404 with the dspIntegration flag off or
   DSP integration switched off, like the Partner API. */
import { createHash, timingSafeEqual } from 'node:crypto'
import type { FastifyPluginAsync } from 'fastify'
import type { Context } from '../../context'
import { confirmPlayed, signalImpression } from '../../exchange/realtime'
import type { Guards } from '../../http/app'
import { HttpError, conflict, notFound, validationFailed } from '../../http/errors'
import { tokenBucket } from '../../http/rateLimit'
import type { ImpressionRecord } from '../../repos/RealtimeImpressionRepo'

const digest = (t: string) => createHash('sha256').update(t, 'utf8').digest()

const body = (r: ImpressionRecord, creative?: unknown) => ({
  impressionId: r.id, status: r.status, ...(r.reason ? { reason: r.reason } : {}),
  ...(r.expiresAt ? { expiresAt: r.expiresAt } : {}), ...(r.clearingCpm != null && r.status !== 'no_fill' ? { clearingCpm: r.clearingCpm } : {}),
  ...(creative ? { creative } : {}),
  ...(r.creativeSource ? { creativeSource: r.creativeSource } : {}), ...(r.reviewNote ? { reviewNote: r.reviewNote } : {}),
})

export const playerRoutes = (ctx: Context, guards: Guards): FastifyPluginAsync => async (app) => {
  /* One bucket per display: a display signals once per impression, never in a burst. */
  const limiter = tokenBucket(ctx.config.partnerRateLimit)
  app.addHook('onRequest', async (req) => {
    guards.flagged()
    const token = ctx.config.playerToken
    const m = /^Bearer\s+(.+)$/i.exec(req.headers.authorization ?? '')
    if (!token || !m || !timingSafeEqual(digest(token), digest(m[1].trim()))) throw new HttpError(401, 'unauthorised', 'A valid player bearer token is required.')
    if (!(await ctx.exchange.get()).enabled) throw notFound('DSP integration is switched off.')
  })

  app.post<{ Body: { displayId?: unknown; slot?: unknown; cachedCrids?: unknown; storeOpen?: unknown; slotStartsAt?: unknown } }>('/impressions', async (req, reply) => {
    const b = req.body ?? {}
    const invalid = []
    if (typeof b.displayId !== 'string' || !b.displayId) invalid.push({ field: 'displayId', reason: 'Required.' })
    if (!(typeof b.slot === 'number' && Number.isInteger(b.slot) && b.slot >= 1)) invalid.push({ field: 'slot', reason: 'A slot number, 1 or more.' })
    if (b.cachedCrids !== undefined && !(Array.isArray(b.cachedCrids) && b.cachedCrids.length <= 500 && b.cachedCrids.every((c) => typeof c === 'string'))) invalid.push({ field: 'cachedCrids', reason: 'A list of creative ids, 500 at most.' })
    if (b.storeOpen !== undefined && typeof b.storeOpen !== 'boolean') invalid.push({ field: 'storeOpen', reason: 'true or false.' })
    if (b.slotStartsAt !== undefined && (typeof b.slotStartsAt !== 'string' || Number.isNaN(Date.parse(b.slotStartsAt)))) invalid.push({ field: 'slotStartsAt', reason: 'An ISO 8601 date-time.' })
    if (invalid.length) throw validationFailed(invalid)
    const wait = limiter.take(b.displayId as string)
    if (wait) {
      reply.header('Retry-After', String(wait))
      throw new HttpError(429, 'rate_limited', `Too many impression signals from ${b.displayId}; retry in ${wait}s.`)
    }
    const { impression, creative } = await signalImpression(ctx, { displayId: b.displayId as string, slot: b.slot as number, cachedCrids: b.cachedCrids as string[] | undefined, storeOpen: b.storeOpen as boolean | undefined, slotStartsAt: b.slotStartsAt ? new Date(b.slotStartsAt as string) : undefined })
    return body(impression, creative)
  })

  app.post<{ Params: { id: string }; Body: { playedAt?: unknown; durationSec?: unknown } | undefined }>('/impressions/:id/played', async (req) => {
    const b = req.body ?? {}
    const invalid = []
    if (b.playedAt !== undefined && (typeof b.playedAt !== 'string' || Number.isNaN(Date.parse(b.playedAt)))) invalid.push({ field: 'playedAt', reason: 'An ISO 8601 date-time.' })
    if (b.durationSec !== undefined && !(typeof b.durationSec === 'number' && b.durationSec > 0 && b.durationSec < 3600)) invalid.push({ field: 'durationSec', reason: 'Seconds, more than 0 and under an hour.' })
    if (invalid.length) throw validationFailed(invalid)
    const rec = await confirmPlayed(ctx, req.params.id, { playedAt: b.playedAt ? new Date(b.playedAt as string).toISOString() : undefined, durationSec: b.durationSec as number | undefined })
    if (!rec) throw conflict('That impression was not filled, was already played, or its fill has expired.')
    return body(rec)
  })
}
