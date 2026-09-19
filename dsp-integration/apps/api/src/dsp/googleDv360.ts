/* Google DSP (Display & Video 360 API v4). Auth is Google's service-account
   JWT-bearer grant: sign a JWT with the key file's private key, exchange it
   at the token endpoint, then call the API with the access token. */
import { createSign } from 'node:crypto'
import { type ConnectResult, type DspClient, type Fetch, unreachable } from './DspClient'

export interface Dv360Config { tokenUrl: string; apiBaseUrl: string }
const SCOPE = 'https://www.googleapis.com/auth/display-video'
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')

export function signServiceAccountJwt(keyFile: { client_email: string; private_key: string }, tokenUrl: string, now = Math.floor(Date.now() / 1000)) {
  const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({ iss: keyFile.client_email, scope: SCOPE, aud: tokenUrl, iat: now, exp: now + 3600 })}`
  const sig = createSign('RSA-SHA256').update(unsigned).sign(keyFile.private_key).toString('base64url')
  return `${unsigned}.${sig}`
}

const googleMessage = async (r: Response) => {
  const j = (await r.json().catch(() => ({}))) as { error?: { message?: string } | string; error_description?: string }
  return (typeof j.error === 'object' ? j.error.message : j.error_description || j.error) || `HTTP ${r.status}`
}

export function googleDv360Client(cfg: Dv360Config, fetchImpl: Fetch = fetch): DspClient {
  return {
    async connect({ public: pub, secrets }): Promise<ConnectResult> {
      let keyFile: { client_email?: string; private_key?: string }
      try {
        keyFile = JSON.parse(secrets.privateKeyJson ?? '')
      } catch {
        return { ok: false, reason: 'Private key (JSON) is not a service account key file.' }
      }
      if (!keyFile.private_key || !keyFile.client_email) return { ok: false, reason: 'Private key (JSON) is not a service account key file.' }
      if (pub.serviceAccountEmail && keyFile.client_email !== pub.serviceAccountEmail) return { ok: false, reason: 'The service account email does not match the key file.' }
      let assertion: string
      try {
        assertion = signServiceAccountJwt({ client_email: keyFile.client_email, private_key: keyFile.private_key }, cfg.tokenUrl)
      } catch {
        return { ok: false, reason: 'The private key in the key file could not be read.' }
      }
      try {
        const tokenRes = await fetchImpl(cfg.tokenUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }).toString(),
          signal: AbortSignal.timeout(10_000),
        })
        if (!tokenRes.ok) return { ok: false, reason: await googleMessage(tokenRes) }
        const { access_token } = (await tokenRes.json()) as { access_token: string }
        const auth = { Authorization: `Bearer ${access_token}` }
        const partnerRes = await fetchImpl(`${cfg.apiBaseUrl}/v4/partners/${encodeURIComponent(pub.partnerId)}`, { headers: auth, signal: AbortSignal.timeout(10_000) })
        if (!partnerRes.ok) return { ok: false, reason: `Partner ${pub.partnerId}: ${await googleMessage(partnerRes)}` }
        const seats: { id: string; name: string }[] = []
        let pageToken: string | undefined
        do {
          const q = new URLSearchParams({ partnerId: pub.partnerId, pageSize: '200', ...(pageToken ? { pageToken } : {}) })
          const r = await fetchImpl(`${cfg.apiBaseUrl}/v4/advertisers?${q}`, { headers: auth, signal: AbortSignal.timeout(10_000) })
          if (!r.ok) return { ok: false, reason: await googleMessage(r) }
          const page = (await r.json()) as { advertisers?: { advertiserId: string; displayName: string }[]; nextPageToken?: string }
          for (const a of page.advertisers ?? []) seats.push({ id: a.advertiserId, name: a.displayName })
          pageToken = page.nextPageToken
        } while (pageToken)
        return { ok: true, seats }
      } catch (e) {
        return unreachable('Display & Video 360', e)
      }
    },
  }
}
