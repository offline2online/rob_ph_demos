/* The scheduled jobs (API.md "Jobs with no API"): every play window is
   cleared once, ahead of time, when its start is within `auctionLeadHours`
   (Q13); windows that have ended are billed. No UI and no endpoint. */
import type { Context } from '../context'
import { nextWindow } from '../domain/positions'
import { runAuction } from './auction'
import { runBilling } from './billing'

export function startAuctionScheduler(ctx: Context, log: (msg: string) => void, everyMs = 60_000) {
  const cleared = new Set<string>()
  const tick = async () => {
    if (!ctx.flags.dspIntegration) return
    const billed = runBilling(ctx)
    if (billed.length) log(`Billed ${billed.length} ended window${billed.length === 1 ? '' : 's'}.`)
    const next = nextWindow(ctx)
    if (cleared.has(next.toISOString())) return
    if (next.getTime() - ctx.clock().getTime() > ctx.config.auctionLeadHours * 3_600_000) return
    cleared.add(next.toISOString())
    const res = await runAuction(ctx, next)
    log(`Auction cleared ${res.windowStart}: ${res.positions.filter((p) => p.winner).length} of ${res.positions.length} positions won.`)
  }
  const timer = setInterval(() => void tick().catch((e) => log(`Auction failed: ${e instanceof Error ? e.message : String(e)}`)), everyMs)
  return () => clearInterval(timer)
}
