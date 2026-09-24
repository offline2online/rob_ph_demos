/* Settled bids are deleted after a retention window (scalability review,
   24 Sep 2026). Every DSP bid response and every API bid is a reservations
   row — including the rejected and outbid ones, which carry the reason the
   advertiser is told. On a large estate that is up to 70,000 rows a play
   window (2,400 positions × 3 DSPs × 10 bids), 26 million a year, and
   nothing reads a lost bid once its window is long past. So rejected,
   lost and never-cleared pending bids are deleted once their window is
   older than Config.reservationRetentionDays (default 90). Won and
   reserved windows are kept: billing and the booking schedule are built
   on them. reservations (status, window_start) is indexed (migration
   0020), so a sweep with nothing to delete costs nothing. */
import { type Db, prepared } from '../db/db'

export function sweepSettledReservations(db: Db, retentionDays: number, now: () => Date = () => new Date()): number {
  const cutoff = new Date(now().getTime() - retentionDays * 24 * 60 * 60 * 1000).toISOString()
  return Number(prepared(db, "DELETE FROM reservations WHERE status IN ('rejected', 'lost', 'pending') AND window_start < ?").run(cutoff).changes)
}
