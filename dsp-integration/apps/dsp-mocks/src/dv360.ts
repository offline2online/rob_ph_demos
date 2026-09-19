/* Mock Google Display & Video 360 API v4 plus Google's OAuth 2.0 token
   endpoint (service-account JWT-bearer grant). Shapes follow the real API:
   https://developers.google.com/display-video/api/reference/rest/v4 */
import type { FastifyPluginAsync, FastifyReply } from 'fastify'
import type { MockStore } from './state'

const JWT_BEARER = 'urn:ietf:params:oauth:grant-type:jwt-bearer'
const SCOPE = 'https://www.googleapis.com/auth/display-video'
const googleError = (reply: FastifyReply, code: number, status: string, message: string) => reply.status(code).send({ error: { code, message, status } })
const decode = (part: string) => JSON.parse(Buffer.from(part, 'base64url').toString('utf8'))

export const dv360Routes = (store: MockStore): FastifyPluginAsync => async (app) => {
  const s = () => store.state.google_dv360

  /* POST https://oauth2.googleapis.com/token */
  app.post<{ Body: Record<string, string> }>('/token', async (req, reply) => {
    const { grant_type, assertion } = req.body ?? {}
    if (grant_type !== JWT_BEARER || !assertion) return reply.status(400).send({ error: 'unsupported_grant_type', error_description: 'Invalid grant_type: ' + (grant_type ?? '') })
    let header: { alg?: string }, claims: { iss?: string; scope?: string; aud?: string; exp?: number }
    try {
      const [h, c, sig] = assertion.split('.')
      if (!sig) throw new Error('no signature')
      header = decode(h)
      claims = decode(c)
    } catch {
      return reply.status(400).send({ error: 'invalid_grant', error_description: 'Invalid JWT: Token must be a short-lived token (60 minutes) and in a reasonable timeframe.' })
    }
    if (header.alg !== 'RS256' || !claims.iss || !String(claims.aud ?? '').endsWith('/token') || !claims.exp || claims.exp * 1000 < Date.now()) {
      return reply.status(400).send({ error: 'invalid_grant', error_description: 'Invalid JWT Signature.' })
    }
    if (!String(claims.scope ?? '').split(' ').includes(SCOPE)) return reply.status(400).send({ error: 'invalid_scope', error_description: 'Invalid OAuth scope or ID token audience provided.' })
    if (!s().auth.accept) return reply.status(400).send({ error: s().auth.error || 'invalid_grant', error_description: s().auth.description || 'Invalid JWT Signature.' })
    return { access_token: store.issueToken('google_dv360'), expires_in: 3599, token_type: 'Bearer' }
  })

  const authed = (auth: string | undefined, reply: FastifyReply) => {
    if (store.tokenValid('google_dv360', auth)) return true
    googleError(reply, 401, 'UNAUTHENTICATED', 'Request had invalid authentication credentials. Expected OAuth 2 access token, login cookie or other valid authentication credential.')
    return false
  }

  /* GET https://displayvideo.googleapis.com/v4/partners/{partnerId} */
  app.get<{ Params: { partnerId: string } }>('/v4/partners/:partnerId', async (req, reply) => {
    if (!authed(req.headers.authorization, reply)) return reply
    if (req.params.partnerId !== s().accountId) return googleError(reply, 403, 'PERMISSION_DENIED', 'The caller does not have permission')
    return { name: `partners/${s().accountId}`, partnerId: s().accountId, displayName: 'Personalisation Hub supply partner', entityStatus: 'ENTITY_STATUS_ACTIVE' }
  })

  /* GET https://displayvideo.googleapis.com/v4/advertisers?partnerId=&pageSize=&pageToken= */
  app.get<{ Querystring: { partnerId?: string; pageSize?: string; pageToken?: string } }>('/v4/advertisers', async (req, reply) => {
    if (!authed(req.headers.authorization, reply)) return reply
    if (!req.query.partnerId) return googleError(reply, 400, 'INVALID_ARGUMENT', 'Request contains an invalid argument.')
    if (req.query.partnerId !== s().accountId) return googleError(reply, 403, 'PERMISSION_DENIED', 'The caller does not have permission')
    const size = Math.min(Math.max(Number(req.query.pageSize) || 100, 1), 200)
    const start = Number(req.query.pageToken) || 0
    const page = s().advertisers.slice(start, start + size)
    const next = start + size < s().advertisers.length ? String(start + size) : undefined
    return {
      advertisers: page.map((a) => ({ name: `advertisers/${a.id}`, advertiserId: a.id, partnerId: s().accountId, displayName: a.name, entityStatus: 'ENTITY_STATUS_ACTIVE', generalConfig: { domainUrl: a.domain ? `https://${a.domain}` : '', currencyCode: a.currency } })),
      ...(next ? { nextPageToken: next } : {}),
    }
  })
}
