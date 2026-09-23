/* Per-key rate limiting for the Partner API (security review, 23 Sep 2026).

   A token bucket per key (the partner id): it holds up to `burst` tokens,
   refills at `perSecond`, and each request takes one. An empty bucket is a
   429 with Retry-After, so one partner polling hard can't take capacity
   from the others, or from the auction running in the same process.

   In-process on purpose: the POC is one process. Behind the platform's API
   gateway (several instances) this moves to the gateway or a shared store
   such as Redis — see PH-CORE-BOUNDARIES.md, "Edge and gateway". The
   interface stays the same: take(key) → wait in seconds, or 0. */
export interface RateLimiter {
  /* 0 when the request may proceed; otherwise the seconds until it may. */
  take(key: string): number
}

export function tokenBucket(opts: { perSecond: number; burst: number }, now: () => number = Date.now): RateLimiter {
  const buckets = new Map<string, { tokens: number; at: number }>()
  return {
    take(key) {
      const t = now()
      const b = buckets.get(key) ?? { tokens: opts.burst, at: t }
      /* Refill for the time since this key was last seen, up to the burst. */
      b.tokens = Math.min(opts.burst, b.tokens + ((t - b.at) / 1000) * opts.perSecond)
      b.at = t
      buckets.set(key, b)
      if (b.tokens >= 1) {
        b.tokens -= 1
        return 0
      }
      return Math.max(1, Math.ceil((1 - b.tokens) / opts.perSecond))
    },
  }
}
