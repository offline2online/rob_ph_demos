/* The scheduled jobs (API.md "Jobs with no API"): each play window is
   cleared once, at its auction cutoff (Advertiser settings → Auction
   schedule); windows that have ended are billed. No UI and no endpoint. */
import type { Context } from '../context'
import { sweepRejectedCampaigns } from '../domain/campaignRetention'
import { biddingClosesAt, windowMs, windowStartOf } from '../domain/positions'
import { runAuction } from './auction'
import { runBilling } from './billing'

/* One pass of the scheduled work: bill the windows that have ended, then
   clear any window whose auction cutoff passed within the last hour and
   that this process hasn't cleared yet (a restart doesn't re-auction old
   windows). `cleared` is the caller's memory of what it already cleared.
   Shared by the in-process scheduler below and the hosted API's Cloud
   Scheduler job (deploy/firebase/), which has no long-lived timer. */
export async function schedulerTick(ctx: Context, cleared: Set<string>, log: (msg: string) => void) {
  if (!ctx.flags.dspIntegration) return
  /* Windows already sold are still billed when they end, switch or not:
     they were delivered. */
  const billed = runBilling(ctx)
  if (billed.length) log(`Billed ${billed.length} ended window${billed.length === 1 ? '' : 's'}.`)
  /* Switched off (Exchange settings): nothing new is sold. */
  if (!ctx.exchange.get().enabled) return
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

export function startAuctionScheduler(ctx: Context, log: (msg: string) => void, everyMs = 60_000) {
  const cleared = new Set<string>()
  /* A large estate's auction can outlast the interval; never start a second
     tick while one is running. (Across processes, migration 0021's unique
     index is what stops two clearings selling a window twice.) */
  let running = false
  const tick = async () => {
    if (running) return
    running = true
    try {
      await schedulerTick(ctx, cleared, log)
    } finally {
      running = false
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
