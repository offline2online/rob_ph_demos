/* DSP creative labels (dsp_creatives): which PH creative (campaign, whose id
   derives from the content hash — exchange/creatives.ts) a DSP's crid last
   resolved to, the hash and URL it was verified at, and the short lease one
   auction takes on a crid while it fetches and hashes the creative. The crid
   is a reference label, never the identity: (partner_id, crid) is only the
   key of the label, so exactly one concurrent auction verifies a given crid. */
import { type Db, prepared, type Awaitable } from '../db/db'

export interface CreativeLabel { campaignId: string; contentHash: string | null; iurl: string | null; verifiedAt: string | null }

export interface DspCreativeRepo {
  /* What this partner's crid last resolved to; null if never verified (or only claimed so far). */
  label(partnerId: string, crid: string): Awaitable<CreativeLabel | null>
  /* The campaign this partner's crid resolved to, if it has been verified. */
  campaignFor(partnerId: string, crid: string): Awaitable<string | null>
  /* Takes the verification lease on the crid. False when another auction holds
     it (a lease older than `staleBefore` is taken over). */
  claim(partnerId: string, crid: string, at: string, staleBefore: string): Awaitable<boolean>
  /* Releases a lease whose fetch or checks failed: a never-verified crid
     forgets it entirely, a previously verified one keeps its label. */
  release(partnerId: string, crid: string): Awaitable<void>
  /* Records the verified resolution of the crid and ends the lease. */
  record(partnerId: string, crid: string, campaignId: string, contentHash: string, iurl: string | null, at: string): Awaitable<void>
  /* Every label on the campaign — they go with a deleted campaign
     (domain/campaignRetention.ts), or a later bid with that crid would
     resolve to a creative that no longer exists. */
  deleteForCampaign(campaignId: string): Awaitable<void>
  /* Block by content hash (Rob, 7 Oct 2026): the campaign whose creative has this exact content and whose latest review decision is a rejection, or null. A rejection blocks the bytes for every crid, DSP and advertiser; un-rejecting it lifts the block. */
  blockedBy(contentHash: string): Awaitable<string | null>
}

interface Row { campaign_id: string; content_hash: string | null; iurl: string | null; verified_at: string | null }

export function sqliteDspCreativeRepo(db: Db): DspCreativeRepo {
  const label = (partnerId: string, crid: string): CreativeLabel | null => {
    const r = prepared(db, "SELECT campaign_id, content_hash, iurl, verified_at FROM dsp_creatives WHERE partner_id = ? AND crid = ? AND campaign_id <> ''").get(partnerId, crid) as Row | undefined
    return r ? { campaignId: r.campaign_id, contentHash: r.content_hash, iurl: r.iurl, verifiedAt: r.verified_at } : null
  }
  return {
    label,
    campaignFor: (partnerId, crid) => label(partnerId, crid)?.campaignId ?? null,
    claim: (partnerId, crid, at, staleBefore) =>
      prepared(db, `INSERT INTO dsp_creatives (partner_id, crid, campaign_id, created_at, claimed_at) VALUES (?, ?, '', ?, ?)
        ON CONFLICT (partner_id, crid) DO UPDATE SET claimed_at = excluded.claimed_at
        WHERE dsp_creatives.claimed_at IS NULL OR dsp_creatives.claimed_at < ?`)
        .run(partnerId, crid, at, at, staleBefore).changes > 0,
    release(partnerId, crid) {
      prepared(db, "DELETE FROM dsp_creatives WHERE partner_id = ? AND crid = ? AND campaign_id = ''").run(partnerId, crid)
      prepared(db, 'UPDATE dsp_creatives SET claimed_at = NULL WHERE partner_id = ? AND crid = ?').run(partnerId, crid)
    },
    record(partnerId, crid, campaignId, contentHash, iurl, at) {
      prepared(db, 'UPDATE dsp_creatives SET campaign_id = ?, content_hash = ?, iurl = ?, verified_at = ?, claimed_at = NULL WHERE partner_id = ? AND crid = ?')
        .run(campaignId, contentHash, iurl, at, partnerId, crid)
    },
    blockedBy(contentHash) {
      const r = prepared(db, `SELECT a.campaign_id AS id FROM campaign_assets a WHERE a.content_hash = ? AND a.discarded_at IS NULL
        AND (SELECT status FROM campaign_approvals q WHERE q.campaign_id = a.campaign_id ORDER BY q.created_at DESC, q.seq DESC LIMIT 1) = 'rejected' LIMIT 1`).get(contentHash) as { id: string } | undefined
      return r?.id ?? null
    },
    deleteForCampaign(campaignId) {
      prepared(db, 'DELETE FROM dsp_creatives WHERE campaign_id = ?').run(campaignId)
    },
  }
}
