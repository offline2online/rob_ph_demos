/* Mock Amazon Ads API (DSP) plus Login with Amazon, one base path per
   region (/amazon/na, /amazon/eu, /amazon/fe), as the real API has one host
   per region. Shapes follow the real API:
   https://advertising.amazon.com/API/docs/en-us/guides/get-started/overview */
import type { FastifyPluginAsync, FastifyReply } from 'fastify'
import type { MockStore } from './state'

const REGIONS = ['na', 'eu', 'fe'] as const
const amazonError = (reply: FastifyReply, code: number, c: string, details: string) => reply.status(code).send({ code: c, details })

export const amazonRoutes = (store: MockStore): FastifyPluginAsync => async (app) => {
  const s = () => store.state.amazon_dsp
  for (const region of REGIONS) {
    /* POST https://api.amazon.{com|co.uk|co.jp}/auth/o2/token — refresh-token grant. */
    app.post<{ Body: Record<string, string> }>(`/${region}/auth/o2/token`, async (req, reply) => {
      const { grant_type, refresh_token, client_id, client_secret } = req.body ?? {}
      if (grant_type !== 'refresh_token') return reply.status(400).send({ error: 'unsupported_grant_type', error_description: 'The authorization grant type is not supported by the authorization server' })
      if (!client_id || !client_secret) return reply.status(401).send({ error: 'invalid_client', error_description: 'Client authentication failed' })
      if (!refresh_token) return reply.status(400).send({ error: 'invalid_request', error_description: 'The request is missing a required parameter : refresh_token' })
      if (!s().auth.accept) return reply.status(400).send({ error: s().auth.error || 'invalid_grant', error_description: s().auth.description || 'The request has an invalid grant parameter : refresh_token' })
      return { access_token: store.issueToken('amazon_dsp'), refresh_token, token_type: 'bearer', expires_in: 3600 }
    })

    const authed = (headers: Record<string, unknown>, reply: FastifyReply) => {
      if (!store.tokenValid('amazon_dsp', headers.authorization as string | undefined)) {
        amazonError(reply, 401, 'UNAUTHORIZED', 'Not authorized to access this advertiser')
        return false
      }
      if (!headers['amazon-advertising-api-clientid']) {
        amazonError(reply, 400, 'MISSING_CLIENT_ID', 'Amazon-Advertising-API-ClientId header is required')
        return false
      }
      return true
    }

    /* GET /v2/profiles — the profiles this login can use, in this region. */
    app.get(`/${region}/v2/profiles`, async (req, reply) => {
      if (!authed(req.headers, reply)) return reply
      if (s().region !== region) return []
      return [{
        profileId: Number(s().accountId), countryCode: 'AU', currencyCode: 'AUD', timezone: 'Australia/Sydney',
        accountInfo: { marketplaceStringId: 'A39IBJ37TRP1C6', id: s().entityId, type: 'agency', name: 'Personalisation Hub supply account', validPaymentMethod: true },
      }]
    })

    /* GET /dsp/advertisers — the DSP advertisers under the profile (Amazon-Advertising-API-Scope). */
    app.get<{ Querystring: { startIndex?: string; count?: string } }>(`/${region}/dsp/advertisers`, async (req, reply) => {
      if (!authed(req.headers, reply)) return reply
      if (s().region !== region || req.headers['amazon-advertising-api-scope'] !== s().accountId) return amazonError(reply, 403, 'FORBIDDEN', 'Invalid scope: the profile is not in this region or not available to this login')
      const start = Number(req.query.startIndex) || 0
      const count = Math.min(Math.max(Number(req.query.count) || 100, 1), 100)
      return {
        totalResults: s().advertisers.length,
        response: s().advertisers.slice(start, start + count).map((a) => ({ advertiserId: a.id, name: a.name, currency: a.currency, url: a.domain ? `https://www.${a.domain}` : '', country: 'AU', timezone: 'Australia/Sydney' })),
      }
    })
  }
}
