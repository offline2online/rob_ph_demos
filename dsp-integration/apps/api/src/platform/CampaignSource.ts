/* Stand-in for the existing campaign service (the seam package 11's
   approval module plugs into). Stores targeting in the existing structure:
   AND groups of OR conditions. Evaluation stays with the existing platform.

   There are two CampaignSource interfaces on purpose: this one (the host's
   read/write view, with bookSlot and createCampaign) and the approval
   module's (packages/campaign-approval/src/adapter/CampaignSource.ts: five
   methods, a CampaignRef view, string asset versions) that must NOT be
   handed bookSlot or createCampaign. On integration both are built from one
   real campaign source in context.ts: one object, two facets. */
import type { Campaign, CampaignBrief } from '@ph-dsp/types'
import { type Db, fromJson, prepared, toJson, type Awaitable } from '../db/db'

/* The stored campaign. `schedule` isn't stored: the admin list derives it
   from the windows the campaign holds. Same for the playlist summary
   fields (`campaignCount` and the two variable/rule-line pairs) — the
   admin list derives them from `targeting` (ticket "Campaign Status:
   Playlist name column..."). */
export interface CampaignRecord extends Omit<Campaign, 'schedule' | 'campaignCount' | 'localisedVariables' | 'localisedRuleLines' | 'personalisedVariables' | 'personalisedRuleLines'> {
  targeting: unknown
}

/* Named apart from the approval module's CampaignFilter (different shape). */
export interface CampaignListFilter { source?: Campaign['source']; advertiserId?: string }

export interface NewCampaign {
  id: string; name: string; targeting: unknown; source: Campaign['source']; advertiserId: string
  partnerId: string; displayTypeId: string | null; pricingType: NonNullable<Campaign['pricingType']>
  /* The advertiser's campaign brief (Rob, 20 Sep); absent when it sent none. */
  brief?: CampaignBrief
  /* The private-auction deal this campaign belongs to (Partner API dealId); absent for a direct campaign. */
  dealId?: string
}
/* A campaign booked into a display type's slot for a play window: the
   existing campaign system's side of the hand-off (spec §6). */
export interface SlotBooking {
  id: string; campaignId: string; displayTypeId: string; slot: number; windowStart: string; windowEnd: string
  /* The version handed off (Q38): the approved version, which the campaign
     system plays even while a later edit awaits review — the approval
     module's own opaque string, the value latestAssets resolves
     (eeBT1Qp33GdsPcxG2As3, 2 Oct 2026). */
  assetVersion?: string | null
  /* True for a window held by a reserve booking (Rob, 5 Oct 2026) or by a
     deal with a personalised campaign (8 Oct 2026). A window on an open
     real-time position plays default and localised only. */
  personalisedEligible?: boolean
}
/* One uploaded creative file. `version` increases with every upload to the campaign. */
export interface CampaignAsset {
  id: string; campaignId: string; version: number; role: string; file: string; mimeType: string
  width: number | null; height: number | null; durationSec: number | null; bitrateKbps: number | null; sizeBytes: number
  /* sha256 of the file (spec §3 safe reuse, Q40); null on a seeded record. */
  contentHash: string | null
}

export interface CampaignSource {
  getCampaign(id: string): Awaitable<CampaignRecord | null>
  /* Ordered by creation, then id — the same order as the approval adapter's list. */
  listCampaigns(filter?: CampaignListFilter): Awaitable<CampaignRecord[]>
  setActivation(id: string, enabled: boolean): Awaitable<CampaignRecord | null>
  /* Campaigns submitted through the Partner API (package 12), stored in the existing structure. */
  createCampaign(c: NewCampaign): Awaitable<CampaignRecord>
  addAsset(a: Omit<CampaignAsset, 'version' | 'contentHash'> & { contentHash?: string | null }): Awaitable<CampaignAsset>
  /* The latest asset for each version role ("default" or a targeted version
     id) — as of `atVersion` when given: the approval adapter's opaque
     `assetVersion` string, exactly as `liveAssetVersion` returned it (the
     approved version, Q38). Any string that changes with the creative is
     legal there, so resolving it to assets is this seam's job, never the
     caller's. A discarded (rejected) edit's assets are never included. */
  latestAssets(campaignId: string, atVersion?: string): Awaitable<CampaignAsset[]>
  /* Hand-off (package 16): book a campaign into a slot for a window. */
  bookSlot(b: SlotBooking): Awaitable<SlotBooking>
  bookings(campaignId?: string): Awaitable<SlotBooking[]>
  /* The retention sweep's request to remove a rejected campaign and its
     assets (Rob, 2 Oct 2026). What that means is the campaign system's
     call — hard delete, archive or refuse; false when it kept the
     campaign. The stand-in deletes the record and its assets. */
  deleteCampaign(id: string): Awaitable<boolean>
}

interface Row {
  id: string; name: string; targeting: string | null; source: Campaign['source']; advertiser_id: string | null
  partner_id: string | null; display_type_id: string | null; pricing_type: Campaign['pricingType']; activation_enabled: number; brief: string | null; deal_id: string | null
}
interface AssetRow {
  id: string; campaign_id: string; version: number; role: string; file: string; mime_type: string
  width: number | null; height: number | null; duration_sec: number | null; bitrate_kbps: number | null; size_bytes: number; content_hash: string | null
}
const toAsset = (r: AssetRow): CampaignAsset => ({
  id: r.id, campaignId: r.campaign_id, version: r.version, role: r.role, file: r.file, mimeType: r.mime_type,
  width: r.width, height: r.height, durationSec: r.duration_sec, bitrateKbps: r.bitrate_kbps, sizeBytes: r.size_bytes, contentHash: r.content_hash,
})
const toRecord = (r: Row): CampaignRecord => ({
  campaignId: r.id, name: r.name, source: r.source, advertiserId: r.advertiser_id, advertiserName: null,
  partnerId: r.partner_id, partnerName: null, displayTypeId: r.display_type_id, pricingType: r.pricing_type,
  activation: { enabled: !!r.activation_enabled }, targeting: fromJson(r.targeting, null),
  ...(r.brief ? { brief: fromJson<CampaignBrief>(r.brief, {}) } : {}),
  ...(r.deal_id ? { dealId: r.deal_id } : {}),
})

/* opts.onChange: called with a campaign's id after this facet changes it
   (activation, a new asset, deletion), so the approval facet over the same
   records hears it (context.ts wires both to one listener set). */
export function sqliteCampaignSource(db: Db, opts: { onChange?: (id: string) => void } = {}): CampaignSource {
  const changed = (id: string) => opts.onChange?.(id)
  const get = (id: string) => {
    const r = prepared(db, 'SELECT * FROM campaigns WHERE id = ?').get(id) as Row | undefined
    return r ? toRecord(r) : null
  }
  return {
    getCampaign: get,
    listCampaigns(filter = {}) {
      return (prepared(db, 'SELECT * FROM campaigns ORDER BY created_at, id').all() as unknown as Row[])
        .map(toRecord)
        .filter((c) => (!filter.source || c.source === filter.source) && (!filter.advertiserId || c.advertiserId === filter.advertiserId))
    },
    setActivation(id, enabled) {
      if (!prepared(db, 'UPDATE campaigns SET activation_enabled = ? WHERE id = ?').run(enabled ? 1 : 0, id).changes) return null
      changed(id)
      return get(id)
    },
    createCampaign(c) {
      prepared(db,
        `INSERT INTO campaigns (id, name, targeting, created_at, source, advertiser_id, partner_id, display_type_id, pricing_type, activation_enabled)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      ).run(c.id, c.name, toJson(c.targeting), new Date().toISOString(), c.source, c.advertiserId, c.partnerId, c.displayTypeId, c.pricingType)
      if (c.brief) prepared(db, 'UPDATE campaigns SET brief = ? WHERE id = ?').run(toJson(c.brief), c.id)
      if (c.dealId) prepared(db, 'UPDATE campaigns SET deal_id = ? WHERE id = ?').run(c.dealId, c.id)
      return get(c.id) as CampaignRecord
    },
    addAsset(a) {
      const version = ((prepared(db, 'SELECT MAX(version) AS v FROM campaign_assets WHERE campaign_id = ?').get(a.campaignId) as { v: number | null }).v ?? 0) + 1
      prepared(db,
        `INSERT INTO campaign_assets (id, campaign_id, version, role, file, mime_type, width, height, duration_sec, bitrate_kbps, size_bytes, content_hash, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(a.id, a.campaignId, version, a.role, a.file, a.mimeType, a.width, a.height, a.durationSec, a.bitrateKbps, a.sizeBytes, a.contentHash ?? null, new Date().toISOString())
      changed(a.campaignId)
      return { ...a, version, contentHash: a.contentHash ?? null }
    },
    bookSlot(b) {
      prepared(db, 'INSERT INTO campaign_slot_bookings (id, campaign_id, display_type_id, slot, window_start, window_end, asset_version, personalised_eligible, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(b.id, b.campaignId, b.displayTypeId, b.slot, b.windowStart, b.windowEnd, b.assetVersion ?? null, b.personalisedEligible ? 1 : 0, new Date().toISOString())
      return b
    },
    deleteCampaign(id) {
      prepared(db, 'DELETE FROM campaign_assets WHERE campaign_id = ?').run(id)
      const gone = Number(prepared(db, 'DELETE FROM campaigns WHERE id = ?').run(id).changes) > 0
      if (gone) changed(id)
      return gone
    },
    bookings(campaignId) {
      const rows = (campaignId
        ? prepared(db, 'SELECT * FROM campaign_slot_bookings WHERE campaign_id = ? ORDER BY window_start').all(campaignId)
        : prepared(db, 'SELECT * FROM campaign_slot_bookings ORDER BY window_start').all()) as { id: string; campaign_id: string; display_type_id: string; slot: number; window_start: string; window_end: string; asset_version: string | null; personalised_eligible: number }[]
      return rows.map((r) => ({ id: r.id, campaignId: r.campaign_id, displayTypeId: r.display_type_id, slot: r.slot, windowStart: r.window_start, windowEnd: r.window_end, assetVersion: r.asset_version, personalisedEligible: !!r.personalised_eligible }))
    },
    latestAssets(campaignId, atVersion) {
      /* This stand-in's approval adapter labels a version `v<n>`, n the highest
         campaign_assets version at that point; a string it can't read resolves
         to no version at all, never to the newest. */
      const upTo = atVersion === undefined ? Number.MAX_SAFE_INTEGER : Number(atVersion.replace(/^v/, '')) || 0
      const rows = (prepared(db, 'SELECT * FROM campaign_assets WHERE campaign_id = ? AND discarded_at IS NULL AND version <= ? ORDER BY version').all(campaignId, upTo) as unknown as AssetRow[]).map(toAsset)
      return [...new Map(rows.map((r) => [r.role, r])).values()]
    },
  }
}
