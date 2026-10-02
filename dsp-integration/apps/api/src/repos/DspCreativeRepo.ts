/* DSP creative claims (dsp_creatives): which campaign a DSP's creative ID
   (crid) became, and the claim one auction takes on a crid while it
   retrieves the creative for review (exchange/creatives.ts). The
   (partner_id, crid) primary key lets exactly one concurrent auction
   retrieve a given creative. */
import { type Db, prepared, type Awaitable } from '../db/db'

export interface DspCreativeRepo {
  /* The campaign this partner's crid became, if it has been retrieved. */
  campaignFor(partnerId: string, crid: string): Awaitable<string | null>
  /* Claims the crid for retrieval as `campaignId`. False when it is
     already claimed (another auction is retrieving it, or did). */
  claim(partnerId: string, crid: string, campaignId: string, at: string): Awaitable<boolean>
  /* Releases a claim whose retrieval or checks failed, so a later window can try again. */
  release(partnerId: string, crid: string, campaignId: string): Awaitable<void>
  /* Every claim on the campaign — it goes with a deleted campaign
     (domain/campaignRetention.ts), or a later bid with that crid would be
     discarded as "already being retrieved" and never reviewed again. */
  deleteForCampaign(campaignId: string): Awaitable<void>
}

export function sqliteDspCreativeRepo(db: Db): DspCreativeRepo {
  return {
    campaignFor: (partnerId, crid) =>
      (prepared(db, 'SELECT campaign_id FROM dsp_creatives WHERE partner_id = ? AND crid = ?').get(partnerId, crid) as { campaign_id: string } | undefined)?.campaign_id ?? null,
    claim: (partnerId, crid, campaignId, at) =>
      prepared(db, 'INSERT INTO dsp_creatives (partner_id, crid, campaign_id, created_at) VALUES (?, ?, ?, ?) ON CONFLICT (partner_id, crid) DO NOTHING')
        .run(partnerId, crid, campaignId, at).changes > 0,
    release(partnerId, crid, campaignId) {
      prepared(db, 'DELETE FROM dsp_creatives WHERE partner_id = ? AND crid = ? AND campaign_id = ?').run(partnerId, crid, campaignId)
    },
    deleteForCampaign(campaignId) {
      prepared(db, 'DELETE FROM dsp_creatives WHERE campaign_id = ?').run(campaignId)
    },
  }
}
