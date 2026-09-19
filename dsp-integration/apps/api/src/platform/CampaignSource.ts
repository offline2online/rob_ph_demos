/* Stand-in for the existing campaign service (the seam package 11's
   approval module plugs into). Stores targeting in the existing structure:
   AND groups of OR conditions. Evaluation stays with the existing platform. */
import type { Campaign, CampaignBrief } from '@ph-dsp/types'
import { type Db, fromJson, toJson } from '../db/db'

/* The stored campaign. `schedule` isn't stored: the admin list derives it
   from the windows the campaign holds. */
export interface CampaignRecord extends Omit<Campaign, 'schedule'> {
  targeting: unknown
}

export interface CampaignFilter { source?: Campaign['source']; advertiserId?: string }

export interface NewCampaign {
  id: string; name: string; targeting: unknown; source: Campaign['source']; advertiserId: string
  partnerId: string; displayTypeId: string | null; pricingType: NonNullable<Campaign['pricingType']>
  /* The advertiser's campaign brief (Rob, 20 Sep); absent when it sent none. */
  brief?: CampaignBrief
}
/* A campaign booked into a display type's slot for a play window: the
   existing campaign system's side of the hand-off (spec §6). */
export interface SlotBooking { id: string; campaignId: string; displayTypeId: string; slot: number; windowStart: string; windowEnd: string }
/* One uploaded creative file. `version` increases with every upload to the campaign. */
export interface CampaignAsset {
  id: string; campaignId: string; version: number; role: string; file: string; mimeType: string
  width: number | null; height: number | null; durationSec: number | null; bitrateKbps: number | null; sizeBytes: number
}

export interface CampaignSource {
  getCampaign(id: string): CampaignRecord | null
  listCampaigns(filter?: CampaignFilter): CampaignRecord[]
  setActivation(id: string, enabled: boolean): CampaignRecord | null
  onCampaignChanged(listener: (id: string) => void): () => void
  /* Campaigns submitted through the Partner API (package 12), stored in the existing structure. */
  createCampaign(c: NewCampaign): CampaignRecord
  addAsset(a: Omit<CampaignAsset, 'version'>): CampaignAsset
  /* The latest asset for each version role ("baseline" or a targeted version id). */
  latestAssets(campaignId: string): CampaignAsset[]
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
  width: number | null; height: number | null; duration_sec: number | null; bitrate_kbps: number | null; size_bytes: number
}
const toAsset = (r: AssetRow): CampaignAsset => ({
  id: r.id, campaignId: r.campaign_id, version: r.version, role: r.role, file: r.file, mimeType: r.mime_type,
  width: r.width, height: r.height, durationSec: r.duration_sec, bitrateKbps: r.bitrate_kbps, sizeBytes: r.size_bytes,
})
const toRecord = (r: Row): CampaignRecord => ({
  campaignId: r.id, name: r.name, source: r.source, advertiserId: r.advertiser_id, advertiserName: null,
  partnerId: r.partner_id, partnerName: null, displayTypeId: r.display_type_id, pricingType: r.pricing_type,
  activation: { enabled: !!r.activation_enabled }, targeting: fromJson(r.targeting, null),
  ...(r.brief ? { brief: fromJson<CampaignBrief>(r.brief, {}) } : {}),
})

export function sqliteCampaignSource(db: Db): CampaignSource {
  const listeners = new Set<(id: string) => void>()
  const get = (id: string) => {
    const r = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(id) as Row | undefined
    return r ? toRecord(r) : null
  }
  return {
    getCampaign: get,
    listCampaigns(filter = {}) {
      return (db.prepare('SELECT * FROM campaigns ORDER BY rowid').all() as unknown as Row[])
        .map(toRecord)
        .filter((c) => (!filter.source || c.source === filter.source) && (!filter.advertiserId || c.advertiserId === filter.advertiserId))
    },
    setActivation(id, enabled) {
      if (!db.prepare('UPDATE campaigns SET activation_enabled = ? WHERE id = ?').run(enabled ? 1 : 0, id).changes) return null
      listeners.forEach((l) => l(id))
      return get(id)
    },
    onCampaignChanged(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    createCampaign(c) {
      db.prepare(
        `INSERT INTO campaigns (id, name, targeting, created_at, source, advertiser_id, partner_id, display_type_id, pricing_type, activation_enabled)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      ).run(c.id, c.name, toJson(c.targeting), new Date().toISOString(), c.source, c.advertiserId, c.partnerId, c.displayTypeId, c.pricingType)
      if (c.brief) db.prepare('UPDATE campaigns SET brief = ? WHERE id = ?').run(toJson(c.brief), c.id)
      return get(c.id) as CampaignRecord
    },
    addAsset(a) {
      const version = ((db.prepare('SELECT MAX(version) AS v FROM campaign_assets WHERE campaign_id = ?').get(a.campaignId) as { v: number | null }).v ?? 0) + 1
      db.prepare(
        `INSERT INTO campaign_assets (id, campaign_id, version, role, file, mime_type, width, height, duration_sec, bitrate_kbps, size_bytes, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(a.id, a.campaignId, version, a.role, a.file, a.mimeType, a.width, a.height, a.durationSec, a.bitrateKbps, a.sizeBytes, new Date().toISOString())
      listeners.forEach((l) => l(a.campaignId))
      return { ...a, version }
    },
    bookSlot(b) {
      db.prepare('INSERT INTO campaign_slot_bookings (id, campaign_id, display_type_id, slot, window_start, window_end, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(b.id, b.campaignId, b.displayTypeId, b.slot, b.windowStart, b.windowEnd, new Date().toISOString())
      listeners.forEach((l) => l(b.campaignId))
      return b
    },
    bookings(campaignId) {
      const rows = (campaignId
        ? db.prepare('SELECT * FROM campaign_slot_bookings WHERE campaign_id = ? ORDER BY window_start').all(campaignId)
        : db.prepare('SELECT * FROM campaign_slot_bookings ORDER BY window_start').all()) as { id: string; campaign_id: string; display_type_id: string; slot: number; window_start: string; window_end: string }[]
      return rows.map((r) => ({ id: r.id, campaignId: r.campaign_id, displayTypeId: r.display_type_id, slot: r.slot, windowStart: r.window_start, windowEnd: r.window_end }))
    },
    latestAssets(campaignId) {
      const rows = (db.prepare('SELECT * FROM campaign_assets WHERE campaign_id = ? ORDER BY version').all(campaignId) as unknown as AssetRow[]).map(toAsset)
      return [...new Map(rows.map((r) => [r.role, r])).values()]
    },
  }
}
