/* The Trade Desk (API v3) — everything TTD-specific, as one DspProvider
   (DspProvider.ts). Auth is the TTD-Auth header carrying the API token; the
   partner's advertisers are paged from /v3/advertiser/query/partner. The
   supply source ID identifies PH on TTD's side for the bidding path. */
import { type AuditVerdict, auditCheckFrom } from '../domain/dspAudit'
import { type DspClient, type Fetch, type Seat, domainOf, unreachable } from './DspClient'
import { type EffectiveLists, seatDomains } from '../domain/lists'
import type { PartnerRecord } from '../repos/PartnerRepo'
import { type BidderEndpoints, type BuyerBlocking, type DspProvider, bidderSide } from './DspProvider'

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

/* Pre-approval hook: TTD's audit is approvedBy — null while awaiting (or not
   approved), a username once approved, as it reads for its DOOH supply
   approver. */
export function ttdAuditVerdict(raw: Record<string, unknown>): AuditVerdict | null {
  if (!('approvedBy' in raw)) return null
  return typeof raw.approvedBy === 'string' && raw.approvedBy ? { verdict: 'approved', why: `by ${raw.approvedBy}` } : { verdict: 'pending' }
}

/* The Trade Desk does not read wseat/badv: it takes the retailer's per-DSP
   lists in ext.seatperms / ext.advperms (its own seat and advertiser IDs —
   for TTD a synced seat is an advertiser, so the same list feeds both) and
   ext.domainperms (the domains of those seats, as for badv). Assumed
   encoding: {allow, block} arrays, an empty allow meaning "no allow-list".
   Confirm the exact TTD semantics at integration (ticket zhHpMXphZs0r0CK3mn8X). */
export function ttdPermissions(partner: PartnerRecord, lists: EffectiveLists): BuyerBlocking {
  return {
    ext: {
      seatperms: { allow: [...lists.allowList], block: [...lists.blockList] },
      advperms: { allow: [...lists.allowList], block: [...lists.blockList] },
      domainperms: { allow: seatDomains(partner, lists.allowList), block: seatDomains(partner, lists.blockList) },
    },
  }
}

export function theTradeDeskProvider(cfg: TtdConfig, bidder: BidderEndpoints | undefined, fetchImpl?: Fetch): DspProvider {
  return {
    key: 'the_trade_desk',
    ...theTradeDeskClient(cfg, fetchImpl),
    ...bidderSide(bidder),
    auditCheck: (raw) => auditCheckFrom('The Trade Desk', raw, ttdAuditVerdict),
    buyerBlocking: ttdPermissions,
  }
}
