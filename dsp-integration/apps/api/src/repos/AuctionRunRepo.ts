/* Auction claims (migration 0024): which process clears a play window's
   auction is settled here, in the database, not in memory — several API
   replicas, a CronJob tick and the CLI can all see a cutoff pass, and
   exactly one of them runs the auction (exchange/scheduler.ts). */
import { type Db, prepared, type Awaitable } from '../db/db'

export interface AuctionRunRepo {
  /* Claims the window for `by`: a new row, or taking over a claim made
     before `staleBefore` that never finished (a process that died
     mid-auction). False when another process holds it. */
  claim(windowStart: string, by: string, at: string, staleBefore: string): Awaitable<boolean>
  /* Marks this claimant's auction for the window finished. */
  finish(windowStart: string, by: string, at: string): Awaitable<void>
  /* Drops this claimant's unfinished claim, so the next tick retries at once. */
  release(windowStart: string, by: string): Awaitable<void>
  /* True while any process holds (or has finished) the window's auction. */
  isClaimed(windowStart: string): Awaitable<boolean>
  /* Deletes finished claims for windows starting before `cutoff`; how many went. */
  deleteFinishedBefore(cutoff: string): Awaitable<number>
}

export function sqliteAuctionRunRepo(db: Db): AuctionRunRepo {
  return {
    claim: (windowStart, by, at, staleBefore) => prepared(db,
      `INSERT INTO auction_runs (window_start, claimed_at, claimed_by, finished_at) VALUES (?, ?, ?, NULL)
         ON CONFLICT (window_start) DO UPDATE SET claimed_at = excluded.claimed_at, claimed_by = excluded.claimed_by
         WHERE auction_runs.finished_at IS NULL AND auction_runs.claimed_at < ?`,
    ).run(windowStart, at, by, staleBefore).changes > 0,
    finish(windowStart, by, at) {
      prepared(db, 'UPDATE auction_runs SET finished_at = ? WHERE window_start = ? AND claimed_by = ?').run(at, windowStart, by)
    },
    release(windowStart, by) {
      prepared(db, 'DELETE FROM auction_runs WHERE window_start = ? AND claimed_by = ? AND finished_at IS NULL').run(windowStart, by)
    },
    isClaimed: (windowStart) => !!prepared(db, 'SELECT 1 FROM auction_runs WHERE window_start = ?').get(windowStart),
    deleteFinishedBefore: (cutoff) => Number(prepared(db, 'DELETE FROM auction_runs WHERE finished_at IS NOT NULL AND window_start < ?').run(cutoff).changes),
  }
}
