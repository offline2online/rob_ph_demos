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
import { type Db, fromJson, prepared, toJson } from '../db/db'

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
}
/* A campaign booked into a display type's slot for a play window: the
   existing campaign system's side of the hand-off (spec §6). */
export interface SlotBooking {
  id: string; campaignId: string; displayTypeId: string; slot: number; windowStart: string; windowEnd: string
  /* The campaign_assets version handed off (Q38): the approved version,
     which the campaign system plays even while a later edit awaits review. */
  assetVersion?: number | null
}
/* One uploaded creative file. `version` increases with every upload to the campaign. */
export interface CampaignAsset {
  id: string; campaignId: string; version: number; role: string; file: string; mimeType: string
  width: number | null; height: number | null; durationSec: number | null; bitrateKbps: number | null; sizeBytes: number
  /* sha256 of the file (spec §3 safe reuse, Q40); null on a seeded record. */
  contentHash: string | null
}

export interface CampaignSource {
  getCampaign(id: string): CampaignRecord | null
  /* Ordered by creation, then id — the same order as the approval adapter's list. */
  listCampaigns(filter?: CampaignListFilter): CampaignRecord[]
  setActivation(id: string, enabled: boolean): CampaignRecord | null
  /* Campaigns submitted through the Partner API (package 12), stored in the existing structure. */
  createCampaign(c: NewCampaign): CampaignRecord
  addAsset(a: Omit<CampaignAsset, 'version' | 'contentHash'> & { contentHash?: string | null }): CampaignAsset
  /* The latest asset for each version role ("default" or a targeted version
     id) — as of `atVersion` when given: the approval adapter's opaque
     `assetVersion` string, exactly as `liveAssetVersion` returned it (the
     approved version, Q38). Any string that changes with the creative is
     legal there, so resolving it to assets is this seam's job, never the
     caller's. A discarded (rejected) edit's assets are never included. */
  latestAssets(campaignId: string, atVersion?: string): CampaignAsset[]
  /* Hand-off (package 16): book a campaign into a slot for a window. */
  bookSlot(b: SlotBooking): SlotBooking
  bookings(campaignId?: string): SlotBooking[]
}

interface Row {
  id: string; name: string; targeting: string | null; source: Campaign['source']; advertiser_id: string | null
  partner_id: string | null; display_type_id: string | null; pricing_type: Campaign['pricingType']; activation_enabled: number; brief: string | null
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
})

export function sqliteCampaignSource(db: Db): CampaignSource {
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
      return get(id)
    },
    createCampaign(c) {
      prepared(db,
        `INSERT INTO campaigns (id, name, targeting, created_at, source, advertiser_id, partner_id, display_type_id, pricing_type, activation_enabled)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      ).run(c.id, c.name, toJson(c.targeting), new Date().toISOString(), c.source, c.advertiserId, c.partnerId, c.displayTypeId, c.pricingType)
      if (c.brief) prepared(db, 'UPDATE campaigns SET brief = ? WHERE id = ?').run(toJson(c.brief), c.id)
      return get(c.id) as CampaignRecord
    },
    addAsset(a) {
      const version = ((prepared(db, 'SELECT MAX(version) AS v FROM campaign_assets WHERE campaign_id = ?').get(a.campaignId) as { v: number | null }).v ?? 0) + 1
      prepared(db,
        `INSERT INTO campaign_assets (id, campaign_id, version, role, file, mime_type, width, height, duration_sec, bitrate_kbps, size_bytes, content_hash, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(a.id, a.campaignId, version, a.role, a.file, a.mimeType, a.width, a.height, a.durationSec, a.bitrateKbps, a.sizeBytes, a.contentHash ?? null, new Date().toISOString())
      return { ...a, version, contentHash: a.contentHash ?? null }
    },
    bookSlot(b) {
      prepared(db, 'INSERT INTO campaign_slot_bookings (id, campaign_id, display_type_id, slot, window_start, window_end, asset_version, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(b.id, b.campaignId, b.displayTypeId, b.slot, b.windowStart, b.windowEnd, b.assetVersion ?? null, new Date().toISOString())
      return b
    },
    bookings(campaignId) {
      const rows = (campaignId
        ? prepared(db, 'SELECT * FROM campaign_slot_bookings WHERE campaign_id = ? ORDER BY window_start').all(campaignId)
        : prepared(db, 'SELECT * FROM campaign_slot_bookings ORDER BY window_start').all()) as { id: string; campaign_id: string; display_type_id: string; slot: number; window_start: string; window_end: string; asset_version: number | null }[]
      return rows.map((r) => ({ id: r.id, campaignId: r.campaign_id, displayTypeId: r.display_type_id, slot: r.slot, windowStart: r.window_start, windowEnd: r.window_end, assetVersion: r.asset_version }))
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
