/* Amazon Ads DSP (Amazon Ads API + Login with Amazon). Auth is the LWA
   refresh-token grant with the client ID and secret; the profile ID scopes
   the account and must belong to the entity. The region picks the hosts
   (one per region) and is fixed once connected. */
import { type ConnectResult, type DspClient, type Fetch, type Seat, domainOf, unreachable } from './DspClient'

export type AmazonRegion = 'na' | 'eu' | 'fe'
export interface AmazonConfig { baseUrls: Record<AmazonRegion, { tokenUrl: string; apiBaseUrl: string }> }

/* The credential form's region labels (catalog PROVIDERS). */
export const REGION_OF: Record<string, AmazonRegion> = { 'North America (NA)': 'na', 'Europe (EU)': 'eu', 'Far East (FE)': 'fe' }

const lwaMessage = async (r: Response) => {
  const j = (await r.json().catch(() => ({}))) as { error?: string; error_description?: string; code?: string; details?: string }
  return j.error_description || j.details || j.error || j.code || `HTTP ${r.status}`
}

export function amazonDspClient(cfg: AmazonConfig, fetchImpl: Fetch = fetch): DspClient {
  return {
    async connect({ public: pub, secrets }) {
      const region = REGION_OF[pub.region]
      if (!region) return { ok: false, reason: 'Region must be North America (NA), Europe (EU) or Far East (FE).' }
      const { tokenUrl, apiBaseUrl } = cfg.baseUrls[region]
      try {
        const tokenRes = await fetchImpl(tokenUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: secrets.refreshToken, client_id: pub.lwaClientId, client_secret: secrets.lwaClientSecret }).toString(),
          signal: AbortSignal.timeout(10_000),
        })
        if (!tokenRes.ok) {
          const msg = await lwaMessage(tokenRes)
          /* LWA's invalid_grant is the refresh token being rejected. */
          return { ok: false, reason: /refresh_token|invalid_grant/i.test(msg) ? `Refresh token rejected: ${msg}` : msg }
        }
        const { access_token } = (await tokenRes.json()) as { access_token: string }
        const headers = { Authorization: `Bearer ${access_token}`, 'Amazon-Advertising-API-ClientId': pub.lwaClientId }
        const profilesRes = await fetchImpl(`${apiBaseUrl}/v2/profiles`, { headers, signal: AbortSignal.timeout(10_000) })
        if (!profilesRes.ok) return { ok: false, reason: await lwaMessage(profilesRes) }
        const profiles = (await profilesRes.json()) as { profileId: number | string; accountInfo?: { id?: string } }[]
        const profile = profiles.find((p) => String(p.profileId) === pub.profileId)
        if (!profile) return { ok: false, reason: `Profile ${pub.profileId} is not available to this login in ${pub.region}.` }
        if (profile.accountInfo?.id !== pub.entityId) return { ok: false, reason: `Profile ${pub.profileId} doesn’t belong to entity ${pub.entityId}.` }
        const seats: Seat[] = []
        let start = 0
        for (;;) {
          const r = await fetchImpl(`${apiBaseUrl}/dsp/advertisers?startIndex=${start}&count=100`, { headers: { ...headers, 'Amazon-Advertising-API-Scope': pub.profileId }, signal: AbortSignal.timeout(10_000) })
          if (!r.ok) return { ok: false, reason: await lwaMessage(r) }
          const page = (await r.json()) as { totalResults: number; response?: { advertiserId: string; name: string; url?: string }[] }
          for (const a of page.response ?? []) seats.push({ id: a.advertiserId, name: a.name, ...domainOf(a.url) })
          start += page.response?.length ?? 0
          if (!page.response?.length || start >= page.totalResults) break
        }
        return { ok: true, seats }
      } catch (e) {
        return unreachable('Amazon Ads', e) as ConnectResult
      }
    },
  }
}
