/* The scheduled jobs (API.md "Jobs with no API"): each play window is
   cleared once, at its auction cutoff (Advertiser settings → Auction
   schedule); windows that have ended are billed. No UI and no endpoint. */
import type { Context } from '../context'
import { sweepRejectedCampaigns } from '../domain/campaignRetention'
import { biddingClosesAt, windowMs, windowStartOf } from '../domain/positions'
import { runAuction } from './auction'
import { runBilling } from './billing'

export function startAuctionScheduler(ctx: Context, log: (msg: string) => void, everyMs = 60_000) {
  const cleared = new Set<string>()
  const tick = async () => {
    if (!ctx.flags.dspIntegration) return
    const billed = runBilling(ctx)
    if (billed.length) log(`Billed ${billed.length} ended window${billed.length === 1 ? '' : 's'}.`)
    /* The current and the next window: whichever reached its cutoff within the
       last hour and isn't cleared yet (a restart doesn't re-auction old windows). */
    const now = ctx.clock().getTime()
    const current = windowStartOf(ctx, ctx.clock())
    for (const w of [current, new Date(current.getTime() + windowMs(ctx))]) {
      const cutoff = biddingClosesAt(ctx, w).getTime()
      if (cleared.has(w.toISOString()) || now < cutoff || now - cutoff > 3_600_000) continue
      cleared.add(w.toISOString())
      const res = await runAuction(ctx, w)
      log(`Auction cleared ${res.windowStart}: ${res.positions.filter((p) => p.winner).length} of ${res.positions.length} positions won.`)
    }
  }
  const timer = setInterval(() => void tick().catch((e) => log(`Auction failed: ${e instanceof Error ? e.message : String(e)}`)), everyMs)
  return () => clearInterval(timer)
}

/* Spec §3 "Enforcement and audit": auto-delete a Rejected campaign (and its
   assets, never its audit trail) once it has been Rejected for longer than
   Config.rejectedCampaignRetentionDays (default 30). Runs once a day by
   default — a rejection is only ever a few hours old the first few times
   this fires, so there is no benefit to running it more often. */
export function startCampaignRetentionScheduler(ctx: Context, log: (msg: string) => void, everyMs = 24 * 60 * 60 * 1000) {
  const tick = () => {
    const { deletedCampaignIds } = sweepRejectedCampaigns(ctx.db, ctx.config.rejectedCampaignRetentionDays, ctx.clock)
    if (deletedCampaignIds.length) log(`Deleted ${deletedCampaignIds.length} campaign${deletedCampaignIds.length === 1 ? '' : 's'} rejected over ${ctx.config.rejectedCampaignRetentionDays} days ago.`)
  }
  const timer = setInterval(() => {
    try { tick() } catch (e) { log(`Rejected-campaign retention sweep failed: ${e instanceof Error ? e.message : String(e)}`) }
  }, everyMs)
  return () => clearInterval(timer)
}
