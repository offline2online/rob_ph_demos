/* What the rejected-campaign sweep (domain/campaignRetention.ts) reads and
   deletes of the approval module's rows: each campaign's current approval
   row when it is Rejected, and the campaign's approval rows once it goes.
   campaign_approval_audit is never touched — the record that a campaign
   was rejected outlives the campaign. */
import { type Db, prepared, type Awaitable } from '../db/db'

/* Each campaign's most recently created approval row (one per asset
   version) — its current status — with approvalStore.latest()'s tie-break:
   created_at, then seq (0102). Matching on MAX(created_at) alone let two
   rows written in the same millisecond both count as current, so a
   campaign whose newest row was not rejected could be swept. */
const CURRENT_REJECTED_SQL = `
  SELECT ca.campaign_id AS id, ca.reviewed_at AS reviewedAt
  FROM campaign_approvals ca
  WHERE ca.status = 'rejected' AND ca.reviewed_at IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM campaign_approvals n
      WHERE n.campaign_id = ca.campaign_id
        AND (n.created_at > ca.created_at OR (n.created_at = ca.created_at AND n.seq > ca.seq))
    )
`

export interface CampaignRetentionRepo {
  /* Every campaign whose current approval row is Rejected, with when it was reviewed. */
  currentRejected(): Awaitable<{ id: string; reviewedAt: string }[]>
  /* The campaign's approval rows (every asset version). */
  deleteApprovalRows(campaignId: string): Awaitable<void>
}

export function sqliteCampaignRetentionRepo(db: Db): CampaignRetentionRepo {
  return {
    currentRejected: () => prepared(db, CURRENT_REJECTED_SQL).all() as { id: string; reviewedAt: string }[],
    deleteApprovalRows(campaignId) {
      prepared(db, 'DELETE FROM campaign_approvals WHERE campaign_id = ?').run(campaignId)
    },
  }
}
