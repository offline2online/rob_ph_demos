/* Sends OpenRTB bid requests to a DSP's bidder, within the platform's
   default timeout and QPS ceiling (Q46: 300 ms, 500 QPS). No bid, a timeout
   or an unreadable answer all count as no bid. */
import type { BidRequest, BidResponse } from '../exchange/openrtb'
import type { Fetch } from './DspClient'

export interface Bidder {
  send(url: string, req: BidRequest): Promise<BidResponse | null>
}

/* Reads a response body, giving up past maxBytes (null). The timeout alone
   bounds how long a DSP can hold a request, not how much it can send in that
   time; this bounds the memory one response can take. */
export async function readCapped(res: Response, maxBytes: number): Promise<Buffer | null> {
  const declared = Number(res.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > maxBytes) return null
  if (!res.body) return Buffer.alloc(0)
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > maxBytes) {
      await reader.cancel().catch(() => {})
      return null
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks)
}

export function httpBidder(fetchImpl: Fetch, opts: { timeoutMs: number; qps: number; maxResponseBytes?: number }): Bidder {
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
        const body = await readCapped(res, opts.maxResponseBytes ?? 64 * 1024)
        return body ? (JSON.parse(body.toString('utf8')) as BidResponse) : null
      } catch {
        return null
      }
    },
  }
}
