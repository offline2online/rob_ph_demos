/* Sends OpenRTB bid requests to a DSP's bidder, within its timeout and QPS
   ceiling: the DSP's own override where set, else the platform default
   (Q46: 300 ms, 500 QPS). No bid, a timeout or an unreadable answer all
   count as no bid. */
import type { BidRequest, BidResponse } from '../exchange/openrtb'
import type { Fetch } from './DspClient'

export interface Bidder {
  /* tuning: this DSP's resolved settings; omitted, the bidder's defaults.
     deadline (epoch ms, the real-time path): the answer is worthless after it,
     so a request whose QPS turn comes after it is not sent at all. */
  send(url: string, req: BidRequest, tuning?: { qps: number; timeoutMs: number; deadline?: number }): Promise<BidResponse | null>
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
  return {
    async send(url, req, tuning) {
      const gap = 1000 / (tuning?.qps ?? opts.qps)
      const now = Date.now()
      const at = Math.max(now, next.get(url) ?? 0)
      /* Past the caller's deadline before it could even be sent: no bid, and
         no turn taken. Real-time impressions arriving faster than a DSP's QPS
         used to queue without bound, each sent seconds after its impression
         had closed — 495 late requests in a 5-second burst, a backlog
         growing linearly (pre-handover review, 18 Oct 2026). The impression's
         outcome is the same either way: its race had already given up. */
      const deadline = tuning?.deadline
      if (deadline !== undefined && at >= deadline) return null
      next.set(url, at + gap)
      if (at > now) await new Promise((r) => setTimeout(r, at - now))
      const timeoutMs = Math.max(1, Math.min(tuning?.timeoutMs ?? opts.timeoutMs, deadline !== undefined ? deadline - at : Infinity))
      try {
        const res = await fetchImpl(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-openrtb-version': '2.6' },
          body: JSON.stringify(req),
          signal: AbortSignal.timeout(timeoutMs),
          /* A bidder answers; it never redirects. Following one would carry
             the bid request (a POST, with its body) to wherever the Location
             says — past the private-address check the endpoint passed when it
             was saved (pre-handover review, 18 Oct 2026). A redirect is no bid. */
          redirect: 'error',
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
