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
   is rejected again later.

   The campaign record and its assets are PH Core's (the campaign system),
   so they go through the seam: CampaignSource.deleteCampaign, and PH Core
   decides what deleting a rejected campaign means — hard delete, archive or
   refuse (Rob, 2 Oct 2026, VzKX05Ulo9wGMuLMvISi). This build's own records
   (its approval rows and DSP-creative claims) are removed here either way. */
import { type Db, tx } from '../db/db'
import type { CampaignSource } from '../platform/CampaignSource'
import type { CampaignRetentionRepo } from '../repos/CampaignRetentionRepo'
import type { DspCreativeRepo } from '../repos/DspCreativeRepo'

export interface RetentionSweepResult {
  deletedCampaignIds: string[]
  /* Campaigns PH Core declined to delete: this build's own rows went, the campaign stays PH Core's. */
  keptByPhCore: string[]
}

/* Which campaigns are currently Rejected — each one's newest approval row,
   tie-broken on created_at then seq (0102) — is CampaignRetentionRepo
   .currentRejected. */

/* The read and the deletes are one transaction, so an un-reject or a new
   version saved in between can't be swept on a stale "Rejected". */
export async function sweepRejectedCampaigns(ctx: { db: Db; campaigns: CampaignSource; campaignRetention: CampaignRetentionRepo; dspCreatives: DspCreativeRepo }, retentionDays: number, now: () => Date = () => new Date()): Promise<RetentionSweepResult> {
  const { db } = ctx
  const cutoff = new Date(now().getTime() - retentionDays * 24 * 60 * 60 * 1000).toISOString()
  return tx(db, async () => {
    const rejected = await ctx.campaignRetention.currentRejected()
    const due = rejected.filter((r) => r.reviewedAt < cutoff).map((r) => r.id)
    const keptByPhCore: string[] = []
    for (const id of due) {
      /* A DSP-retrieved creative's claim on its crid goes with the campaign, or a later bid with that crid is discarded as "already being retrieved" and never reviewed again. */
      await ctx.dspCreatives.deleteForCampaign(id)
      await ctx.campaignRetention.deleteApprovalRows(id)
      if (!(await ctx.campaigns.deleteCampaign(id))) keptByPhCore.push(id)
    }
    return { deletedCampaignIds: due, keptByPhCore }
  })
}
