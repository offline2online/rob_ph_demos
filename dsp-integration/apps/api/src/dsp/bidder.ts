/* Sends OpenRTB bid requests to a DSP's bidder, within the platform's
   default timeout and QPS ceiling (Q46: 300 ms, 500 QPS). No bid, a timeout
   or an unreadable answer all count as no bid. */
import type { BidRequest, BidResponse } from '../exchange/openrtb'
import type { Fetch } from './DspClient'

export interface Bidder {
  send(url: string, req: BidRequest): Promise<BidResponse | null>
}

export function httpBidder(fetchImpl: Fetch, opts: { timeoutMs: number; qps: number }): Bidder {
  /* Requests to one URL are spaced at least 1000 / qps ms apart. */
  const next = new Map<string, number>()
  const gap = 1000 / opts.qps
  return {
    async send(url, req) {
      const now = Date.now()
      const at = Math.max(now, next.get(url) ?? 0)
      next.set(url, at + gap)
      if (at > now) await new Promise((r) => setTimeout(r, at - now))
      try {
        const res = await fetchImpl(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-openrtb-version': '2.6' },
          body: JSON.stringify(req),
          signal: AbortSignal.timeout(opts.timeoutMs),
        })
        if (res.status !== 200) return null
        return (await res.json()) as BidResponse
      } catch {
        return null
      }
    },
  }
}
