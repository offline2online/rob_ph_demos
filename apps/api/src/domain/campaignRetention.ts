/* Auto-delete rejected campaigns after a retention window (spec §3
   "Enforcement and audit", ticket 22 Sep). Scope: Rejected only — Draft
   (never shown to the retailer anyway), Awaiting approval and Approved are
   untouched. Deletes the campaign record and its uploaded assets so a
   rejected campaign stops cluttering retailer-facing tables/queues, but
   never touches campaign_approval_audit: the append-only record that the
   campaign was rejected (who, when, why) survives the campaign it was
   about. Un-reject (Rejected → Awaiting approval) takes a campaign out of
   this sweep's scope entirely — its current approval row is no longer
   'rejected' — so the 30-day clock only ever runs against a campaign that
   is *currently* Rejected, and restarts from a fresh `reviewed_at` if it
   is rejected again later. */
import { type Db, tx } from '../db/db'

export interface RetentionSweepResult {
  deletedCampaignIds: string[]
}

/* Each campaign's most recently created approval row (one per asset
   version) — its current status — same tie-break as approvalStore.latest(). */
const CURRENT_REJECTED_SQL = `
  SELECT ca.campaign_id AS id, ca.reviewed_at AS reviewedAt
  FROM campaign_approvals ca
  JOIN (
    SELECT campaign_id, MAX(created_at) AS created_at
    FROM campaign_approvals
    GROUP BY campaign_id
  ) latest ON latest.campaign_id = ca.campaign_id AND latest.created_at = ca.created_at
  WHERE ca.status = 'rejected' AND ca.reviewed_at IS NOT NULL
`

export function sweepRejectedCampaigns(db: Db, retentionDays: number, now: () => Date = () => new Date()): RetentionSweepResult {
  const cutoff = new Date(now().getTime() - retentionDays * 24 * 60 * 60 * 1000).toISOString()
  const rejected = db.prepare(CURRENT_REJECTED_SQL).all() as { id: string; reviewedAt: string }[]
  const due = rejected.filter((r) => r.reviewedAt < cutoff).map((r) => r.id)
  if (due.length) {
    tx(db, () => {
      for (const id of due) {
        db.prepare('DELETE FROM campaign_assets WHERE campaign_id = ?').run(id)
        db.prepare('DELETE FROM campaign_approvals WHERE campaign_id = ?').run(id)
        db.prepare('DELETE FROM campaigns WHERE id = ?').run(id)
      }
    })
  }
  return { deletedCampaignIds: due }
}
