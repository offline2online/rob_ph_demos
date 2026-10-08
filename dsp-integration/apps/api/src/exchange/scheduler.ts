/* The scheduled jobs (API.md "Jobs with no API"): private-auction (deal)
   windows are cleared one window ahead, and a deal with an auctionCloses
   runs its one deciding auction when that deadline passes; windows that
   have ended are billed; settled bids past their retention are deleted.
   Nothing else is auctioned on a schedule: every other position is sold in
   real time, per impression (Rob, 8 Oct 2026). No UI and no endpoint. */
import { hostname } from 'node:os'
import type { Context } from '../context'
import { tx } from '../db/db'
import { sweepRejectedCampaigns } from '../domain/campaignRetention'
import { assignedOf, type BuyersList } from '@ph-dsp/types'
import { isActiveAt, isTermLocked } from '../billing/term'
import { type PositionRef, allPositions, assignmentOf, nextWindowFor, windowMsFor, windowStartOf } from '../domain/positions'
import { releaseSettledSlotLocks } from '../domain/slotLock'
import { sweepSettledReservations } from '../domain/reservationRetention'
import { runAuction } from './auction'
import { recordLatePlays, runBilling } from './billing'

/* Who this process is, on the claims it makes. */
const INSTANCE = `${hostname()}:${process.pid}`
/* A claim this old with no finish is a process that died mid-auction; the
   next tick takes the window over. */
const STALE_CLAIM_MS = 15 * 60_000

/* Claims an auction for this process (`windowStart` is the claim key: a
   window start, or `<window start>#<position>` / `decide:...` for the
   scheduler's per-position claims). Which process clears a window
   is settled in the database (auction_runs, migration 0024), not in
   memory: several API replicas, a CronJob tick and the CLI can all see a
   cutoff pass, and exactly one of them runs the auction. (Migration 0021
   would stop two clearings selling a window twice anyway, but DSPs would
   still be sent two rounds of bid requests.) Returns false when another
   process has it. */
export async function claimAuction(ctx: Context, windowStart: string): Promise<boolean> {
  const now = ctx.clock().toISOString()
  const stale = new Date(ctx.clock().getTime() - STALE_CLAIM_MS).toISOString()
  return ctx.auctionRuns.claim(windowStart, INSTANCE, now, stale)
}
const finishAuction = (ctx: Context, windowStart: string) => ctx.auctionRuns.finish(windowStart, INSTANCE, ctx.clock().toISOString())
/* An auction that threw releases its claim so the next tick retries at once. */
const releaseAuction = (ctx: Context, windowStart: string) => ctx.auctionRuns.release(windowStart, INSTANCE)

/* One pass of the scheduled work: bill the windows that have ended, sweep
   settled bids, then clear the deal windows that are due (dueDealAuctions)
   and that no process has cleared yet. Shared by the
   in-process scheduler below, the scheduler:tick CLI (a Kubernetes
   CronJob) and the hosted API's request-driven tick (deploy/firebase/). */
export async function schedulerTick(ctx: Context, log: (msg: string) => void) {
  if (!ctx.flags.dspIntegration) return
  /* Each job is isolated from the others (stability review, 24 Sep 2026):
     a fault in billing — a playback store that doesn't answer — is logged
     and must not stop the auction that is due in the same minute, and the
     reverse. A job that throws is retried by the next tick as before. */
  const errors: string[] = []
  const job = async (name: string, fn: () => void | Promise<void>) => {
    try {
      await fn()
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      log(`${name} failed: ${message}`)
      errors.push(`${name}: ${message}`)
    }
  }
  /* Windows already sold are still billed when they end, switch or not:
     they were delivered. */
  await job('Billing', async () => {
    const billed = await runBilling(ctx)
    if (billed.length) log(`Billed ${billed.length} ended window${billed.length === 1 ? '' : 's'}.`)
  })
  /* Playback that arrived after its window was invoiced is never billed; it is
     recorded as lost revenue from downtime (settlement is final, billing/late.ts). */
  await job('Late playback', async () => {
    const late = await recordLatePlays(ctx)
    if (late) log(`Recorded ${late} late play${late === 1 ? '' : 's'} received after settlement as lost revenue from downtime.`)
  })
  /* A slot locked against new sales is released once the booking schedule
     has no live booking left on it (bookings only, never playback). */
  await job('Slot locks', async () => {
    const released = await releaseSettledSlotLocks(ctx)
    if (released) log(`Released the sales lock on ${released} slot${released === 1 ? '' : 's'}: nothing is booked on ${released === 1 ? 'it' : 'them'} any more.`)
  })
  await job('Retention', async () => {
    const swept = await sweepSettledReservations(ctx, ctx.config.reservationRetentionDays, ctx.clock)
    if (swept) log(`Deleted ${swept} settled bid${swept === 1 ? '' : 's'} older than ${ctx.config.reservationRetentionDays} days.`)
    await sweepAuctionRuns(ctx)
  })
  /* A bid still pending for a window that has started will never clear:
     its deal auction never ran (the process was down), or the
     position was removed from the estate after the bid was placed. It is
     settled as lost rather than left pending for ever. */
  await job('Settling', async () => {
    const settled = await tx(ctx.db, async () => {
      const stale = await ctx.reservations.stalePending(ctx.clock().toISOString())
      for (const r of stale) await ctx.reservations.update(r.id, { status: 'lost', reason: 'The window started with no auction clearing this bid; nothing was sold.' })
      return stale.length
    })
    if (settled) log(`Settled ${settled} bid${settled === 1 ? '' : 's'} for windows that started without an auction.`)
  })
  /* Switched off (Exchange settings): nothing new is sold. */
  if ((await ctx.exchange.get()).enabled) {
    /* Deal windows, grouped by the window they clear so each group is one
       auction (bidders are read once, positions clear in parallel). Each
       position's claim is its own key: which process clears it is settled in
       the database, as before. */
    const due = await dueDealAuctions(ctx)
    const groups = new Map<string, DueDealAuction[]>()
    for (const d of due) {
      const g = `${d.windowStart.toISOString()}|${d.deciding.length ? 'decide' : 'window'}`
      groups.set(g, [...(groups.get(g) ?? []), d])
    }
    for (const group of groups.values()) {
      const claimed: DueDealAuction[] = []
      for (const d of group) if (await claimAuction(ctx, d.key)) claimed.push(d)
      if (!claimed.length) continue
      await job('Auction', async () => {
        try {
          const res = await runAuction(ctx, claimed[0].windowStart, { positions: claimed.map((d) => d.position), deciding: new Set(claimed.flatMap((d) => d.deciding)) })
          for (const d of claimed) await finishAuction(ctx, d.key)
          const failed = res.positions.filter((p) => p.skipped?.startsWith('Failed:')).length
          log(`Auction cleared ${res.windowStart}: ${res.positions.filter((p) => p.winner).length} of ${res.positions.length} positions won${failed ? `, ${failed} failed` : ''}.`)
        } catch (e) {
          for (const d of claimed) await releaseAuction(ctx, d.key)
          throw e
        }
      })
    }
  }
  if (errors.length) throw new Error(`Scheduler tick: ${errors.join('; ')}`)
}

/* A deal window or deciding auction the scheduler owes: the position, the
   window it clears, the claim key, and the buyers lists whose one
   term-deciding auction this is (empty for an ordinary window). */
export interface DueDealAuction { position: PositionRef; windowStart: Date; key: string; deciding: string[] }

/* The first window of a position, of length `len`, that starts at or after `at`. */
const windowAtOrAfter = (at: Date, len: number) => { const w = windowStartOf(at, len); return w.getTime() >= at.getTime() ? w : new Date(w.getTime() + len) }

/* What the scheduler owes now (Rob, 8 Oct 2026): only deals are cleared by
   a schedule. For each position assigned to buyers lists:
   - its next window (the one after the window now running, each slot's own
     billing unit long) is cleared once, when some list is in its delivery
     term there (activeFrom/activeTo) and either has no auctionCloses (a
     buyers list clears a fresh auction every play window), or has locked
     its rate (the window is booked at it), or its deadline has passed (the
     window is then told it is not sold under the deal);
   - a list with an auctionCloses that has passed and that has not locked
     runs ONE deciding auction, on the first window of its term not yet
     started. A clear locks the winning CPM for the rest of the term
     (billing/lockedTerm.ts); the claim, kept for good, is what makes it
     once. Before auctionCloses nothing clears: bids wait for the deadline. */
export async function dueDealAuctions(ctx: Context): Promise<DueDealAuction[]> {
  const now = ctx.clock()
  const out: DueDealAuction[] = []
  for (const p of await allPositions(ctx)) {
    if (assignmentOf(p.def) !== 'deal') continue
    const lists = (await Promise.all(assignedOf(p.def).buyersListIds.map((id) => ctx.buyersLists.get(id)))).filter((l): l is BuyersList => !!l)
    const len = windowMsFor(p)
    const next = nextWindowFor(now, len)
    const nextIso = next.toISOString()
    const closed = (l: BuyersList) => !!l.auctionCloses && now.getTime() > Date.parse(l.auctionCloses)
    if (lists.some((l) => isActiveAt(l, nextIso) && (!l.auctionCloses || isTermLocked(l) || closed(l)))) {
      out.push({ position: p, windowStart: next, key: `${nextIso}#${p.positionId}`, deciding: [] })
    }
    for (const l of lists) {
      if (!l.auctionCloses || isTermLocked(l) || !closed(l)) continue
      const first = l.activeFrom ? windowAtOrAfter(new Date(l.activeFrom), len) : next
      const w = first.getTime() > next.getTime() ? first : next
      if (l.activeTo && w.getTime() > Date.parse(l.activeTo)) continue
      out.push({ position: p, windowStart: w, key: `decide:${l.id}:${p.positionId}`, deciding: [l.id] })
    }
  }
  return out.sort((a, b) => a.windowStart.getTime() - b.windowStart.getTime())
}

/* Finished auction claims older than the reservation retention are deleted
   with the bids they cleared: one row per window, nothing reads an old one. */
function sweepAuctionRuns(ctx: Context) {
  const cutoff = new Date(ctx.clock().getTime() - ctx.config.reservationRetentionDays * 86_400_000).toISOString()
  return ctx.auctionRuns.deleteFinishedBefore(cutoff)
}

/* True while a process holds (or has finished) this position's auction for
   the window: bidding for it is over even if the deadline hasn't quite
   passed by this process's clock. POST /v1/reservations refuses a bid then,
   so no bid can slip in between the auction reading its candidates and
   clearing. */
export async function auctionClaimed(ctx: Context, windowStart: string, positionId: string): Promise<boolean> {
  return ctx.auctionRuns.isClaimed(`${windowStart}#${positionId}`)
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
  const tick = async () => {
    const { deletedCampaignIds } = await sweepRejectedCampaigns(ctx, ctx.config.rejectedCampaignRetentionDays, ctx.clock)
    if (deletedCampaignIds.length) log(`Deleted ${deletedCampaignIds.length} campaign${deletedCampaignIds.length === 1 ? '' : 's'} rejected over ${ctx.config.rejectedCampaignRetentionDays} days ago.`)
  }
  const timer = setInterval(() => {
    tick().catch((e) => log(`Rejected-campaign retention sweep failed: ${e instanceof Error ? e.message : String(e)}`))
  }, everyMs)
  return () => clearInterval(timer)
}
