/* The Trade Desk (API v3). Auth is the TTD-Auth header carrying the API
   token; the partner's advertisers are paged from /v3/advertiser/query/partner.
   The supply source ID identifies PH on TTD's side for the bidding path. */
import { type DspClient, type Fetch, type Seat, domainOf, unreachable } from './DspClient'

export interface TtdConfig { apiBaseUrl: string }

const ttdMessage = async (r: Response) => {
  const j = (await r.json().catch(() => ({}))) as { Message?: string }
  return j.Message || `HTTP ${r.status}`
}

export function theTradeDeskClient(cfg: TtdConfig, fetchImpl: Fetch = fetch): DspClient {
  return {
    async connect({ public: pub, secrets }) {
      try {
        const seats: Seat[] = []
        let start = 0
        for (;;) {
          const r = await fetchImpl(`${cfg.apiBaseUrl}/v3/advertiser/query/partner`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'TTD-Auth': secrets.apiToken },
            body: JSON.stringify({ PartnerId: pub.ttdPartnerId, PageStartIndex: start, PageSize: 100 }),
            signal: AbortSignal.timeout(10_000),
          })
          if (!r.ok) return { ok: false, reason: `${r.status === 401 ? 'API token rejected: ' : ''}${await ttdMessage(r)}` }
          const page = (await r.json()) as { Result?: { AdvertiserId: string; AdvertiserName: string; DomainAddress?: string }[]; TotalFilteredCount: number }
          for (const a of page.Result ?? []) seats.push({ id: a.AdvertiserId, name: a.AdvertiserName, ...domainOf(a.DomainAddress) })
          start += page.Result?.length ?? 0
          if (!page.Result?.length || start >= page.TotalFilteredCount) break
        }
        return { ok: true, seats }
      } catch (e) {
        return unreachable('The Trade Desk', e)
      }
    },
  }
}
