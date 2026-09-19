/* Stand-in for the existing campaign service (the seam package 11's
   approval module plugs into). Stores targeting in the existing structure:
   AND groups of OR conditions. Evaluation stays with the existing platform. */
import type { Campaign } from '@ph-dsp/types'
import { type Db, fromJson } from '../db/db'

export interface CampaignRecord extends Campaign {
  targeting: unknown
}

export interface CampaignFilter { source?: Campaign['source']; advertiserId?: string }

export interface CampaignSource {
  getCampaign(id: string): CampaignRecord | null
  listCampaigns(filter?: CampaignFilter): CampaignRecord[]
  setActivation(id: string, enabled: boolean): CampaignRecord | null
  onCampaignChanged(listener: (id: string) => void): () => void
}

interface Row {
  id: string; name: string; targeting: string | null; source: Campaign['source']; advertiser_id: string | null
  partner_id: string | null; display_type_id: string | null; pricing_type: Campaign['pricingType']; activation_enabled: number
}
const toRecord = (r: Row): CampaignRecord => ({
  campaignId: r.id, name: r.name, source: r.source, advertiserId: r.advertiser_id, advertiserName: null,
  partnerId: r.partner_id, partnerName: null, displayTypeId: r.display_type_id, pricingType: r.pricing_type,
  activation: { enabled: !!r.activation_enabled }, targeting: fromJson(r.targeting, null),
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
  }
}
