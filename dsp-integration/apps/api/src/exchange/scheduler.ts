/* The scheduled jobs (API.md "Jobs with no API"): each play window is
   cleared once, at its auction cutoff (Advertiser settings → Auction
   schedule); windows that have ended are billed; settled bids past their
   retention are deleted. No UI and no endpoint. */
import { hostname } from 'node:os'
import type { Context } from '../context'
import { prepared } from '../db/db'
import { sweepRejectedCampaigns } from '../domain/campaignRetention'
import { biddingClosesAt, windowMs, windowStartOf } from '../domain/positions'
import { sweepSettledReservations } from '../domain/reservationRetention'
import { runAuction } from './auction'
import { runBilling } from './billing'

/* Who this process is, on the claims it makes. */
const INSTANCE = `${hostname()}:${process.pid}`
/* A claim this old with no finish is a process that died mid-auction; the
   next tick takes the window over. */
const STALE_CLAIM_MS = 15 * 60_000

/* Claims a window's auction for this process. Which process clears a window
   is settled in the database (auction_runs, migration 0024), not in
   memory: several API replicas, a CronJob tick and the CLI can all see a
   cutoff pass, and exactly one of them runs the auction. (Migration 0021
   would stop two clearings selling a window twice anyway, but DSPs would
   still be sent two rounds of bid requests.) Returns false when another
   process has it. */
export function claimAuction(ctx: Context, windowStart: string): boolean {
  const now = ctx.clock().toISOString()
  const stale = new Date(ctx.clock().getTime() - STALE_CLAIM_MS).toISOString()
  return prepared(ctx.db,
    `INSERT INTO auction_runs (window_start, claimed_at, claimed_by, finished_at) VALUES (?, ?, ?, NULL)
       ON CONFLICT (window_start) DO UPDATE SET claimed_at = excluded.claimed_at, claimed_by = excluded.claimed_by
       WHERE auction_runs.finished_at IS NULL AND auction_runs.claimed_at < ?`,
  ).run(windowStart, now, INSTANCE, stale).changes > 0
}
const finishAuction = (ctx: Context, windowStart: string) =>
  prepared(ctx.db, 'UPDATE auction_runs SET finished_at = ? WHERE window_start = ? AND claimed_by = ?').run(ctx.clock().toISOString(), windowStart, INSTANCE)
/* An auction that threw releases its claim so the next tick retries at once. */
const releaseAuction = (ctx: Context, windowStart: string) =>
  prepared(ctx.db, 'DELETE FROM auction_runs WHERE window_start = ? AND claimed_by = ? AND finished_at IS NULL').run(windowStart, INSTANCE)

/* One pass of the scheduled work: bill the windows that have ended, sweep
   settled bids, then clear any window whose auction cutoff passed within
   the last hour and that no process has cleared yet. Shared by the
   in-process scheduler below, the scheduler:tick CLI (a Kubernetes
   CronJob) and the hosted API's request-driven tick (deploy/firebase/). */
export async function schedulerTick(ctx: Context, log: (msg: string) => void) {
  if (!ctx.flags.dspIntegration) return
  /* Windows already sold are still billed when they end, switch or not:
     they were delivered. */
  const billed = runBilling(ctx)
  if (billed.length) log(`Billed ${billed.length} ended window${billed.length === 1 ? '' : 's'}.`)
  const swept = sweepSettledReservations(ctx.db, ctx.config.reservationRetentionDays, ctx.clock)
  if (swept) log(`Deleted ${swept} settled bid${swept === 1 ? '' : 's'} older than ${ctx.config.reservationRetentionDays} days.`)
  /* Switched off (Exchange settings): nothing new is sold. */
  if (!ctx.exchange.get().enabled) return
  const now = ctx.clock().getTime()
  const current = windowStartOf(ctx, ctx.clock())
  for (const w of [current, new Date(current.getTime() + windowMs(ctx))]) {
    const cutoff = biddingClosesAt(ctx, w).getTime()
    if (now < cutoff || now - cutoff > 3_600_000) continue
    const start = w.toISOString()
    if (!claimAuction(ctx, start)) continue
    try {
      const res = await runAuction(ctx, w)
      finishAuction(ctx, start)
      log(`Auction cleared ${res.windowStart}: ${res.positions.filter((p) => p.winner).length} of ${res.positions.length} positions won.`)
    } catch (e) {
      releaseAuction(ctx, start)
      throw e
    }
  }
}

export function startAuctionScheduler(ctx: Context, log: (msg: string) => void, everyMs = 60_000) {
  /* A large estate's auction can outlast the interval; never start a second
     tick while one is running. (Across processes, auction_runs is what
     stops two of them clearing the same window.) */
  let running = false
  const tick = async () => {
    if (running) return
    running = true
    try {
      await schedulerTick(ctx, log)
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
