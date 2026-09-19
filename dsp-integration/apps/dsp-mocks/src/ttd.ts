/* Mock The Trade Desk API v3. Auth is the TTD-Auth header carrying the API
   token. Shapes follow the real API: https://partner.thetradedesk.com/v3/doc */
import type { FastifyPluginAsync } from 'fastify'
import type { MockStore } from './state'

export const ttdRoutes = (store: MockStore): FastifyPluginAsync => async (app) => {
  const s = () => store.state.the_trade_desk

  /* POST /v3/advertiser/query/partner — a partner's advertisers, paged. */
  app.post<{ Body: { PartnerId?: string; PageStartIndex?: number; PageSize?: number } }>('/v3/advertiser/query/partner', async (req, reply) => {
    const token = req.headers['ttd-auth']
    if (!token) return reply.status(401).send({ Message: 'Authentication failed: the TTD-Auth header is required.' })
    if (!s().auth.accept) return reply.status(401).send({ Message: s().auth.description || 'Authentication failed: the TTD-Auth token is invalid or has expired.', ErrorDetails: [{ Reasons: [s().auth.error || 'invalid_token'] }] })
    const b = req.body ?? {}
    if (!b.PartnerId || typeof b.PageSize !== 'number') return reply.status(400).send({ Message: 'The request is invalid.', ErrorDetails: [{ Property: 'PartnerId', Reasons: ['PartnerId and PageSize are required.'] }] })
    if (b.PartnerId !== s().accountId) return reply.status(403).send({ Message: `You do not have access to partner ${b.PartnerId}.` })
    const start = b.PageStartIndex ?? 0
    const all = s().advertisers
    return {
      Result: all.slice(start, start + b.PageSize).map((a) => ({ AdvertiserId: a.id, AdvertiserName: a.name, PartnerId: s().accountId, CurrencyCode: a.currency, DomainAddress: a.domain ? `https://${a.domain}` : '' })),
      ResultCount: Math.max(0, Math.min(b.PageSize, all.length - start)),
      TotalFilteredCount: all.length,
      TotalUnfilteredCount: all.length,
    }
  })
}
