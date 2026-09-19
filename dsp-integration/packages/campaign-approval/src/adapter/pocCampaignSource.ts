/* The POC's CampaignSource, backed by this repo's stand-in campaign store
   (the `campaigns` and `campaign_assets` tables). On integration it is
   replaced by an adapter over the real campaign service. */
import type { SqlDb } from '../db'
import type { Canvas, Creative } from '../types'
import type { CampaignRef, CampaignSource } from './CampaignSource'

/* Lookups the host supplies (names, canvas, asset URLs, targeting summary). */
export interface PocLookups {
  advertiserName(advertiserId: string): string | null
  partnerName(partnerId: string): string | null
  canvas(displayTypeId: string): Canvas | null
  assetUrl(file: string): string
  targetingSummary(targeting: unknown): string
}

interface Row { id: string; name: string; source: CampaignRef['source']; advertiser_id: string | null; partner_id: string | null; display_type_id: string | null; activation_enabled: number; targeting: string | null }
interface AssetRow { version: number; file: string; mime_type: string; width: number; height: number }

export function pocCampaignSource(db: SqlDb, lookups: PocLookups): CampaignSource {
  const listeners = new Set<(id: string) => void>()
  const toRef = (r: Row): CampaignRef => {
    const latest = db.prepare("SELECT version, file, mime_type, width, height FROM campaign_assets WHERE campaign_id = ? AND role = 'baseline' ORDER BY version DESC LIMIT 1").get(r.id) as AssetRow | undefined
    const version = (db.prepare('SELECT MAX(version) AS v FROM campaign_assets WHERE campaign_id = ?').get(r.id) as { v: number | null } | undefined)?.v ?? 0
    const creative: Creative | null = latest ? { assetUrl: lookups.assetUrl(latest.file), mimeType: latest.mime_type, width: latest.width, height: latest.height } : null
    return {
      campaignId: r.id, name: r.name, source: r.source,
      advertiserId: r.advertiser_id, advertiserName: r.advertiser_id ? lookups.advertiserName(r.advertiser_id) : null,
      partnerId: r.partner_id, partnerName: r.partner_id ? lookups.partnerName(r.partner_id) : null,
      activation: { enabled: !!r.activation_enabled },
      assetVersion: `v${version}`,
      targetingSummary: lookups.targetingSummary(r.targeting ? JSON.parse(r.targeting) : null),
      creative,
      canvas: r.display_type_id ? lookups.canvas(r.display_type_id) : null,
    }
  }
  const get = (id: string) => {
    const r = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(id) as Row | undefined
    return r ? toRef(r) : null
  }
  return {
    getCampaign: get,
    listCampaigns(filter = {}) {
      return (db.prepare('SELECT * FROM campaigns ORDER BY created_at, id').all() as Row[])
        .filter((r) => (!filter.sources || filter.sources.includes(r.source)) && (!filter.ids || filter.ids.includes(r.id)))
        .map(toRef)
    },
    setActivation(id, enabled) {
      db.prepare('UPDATE campaigns SET activation_enabled = ? WHERE id = ?').run(enabled ? 1 : 0, id)
      listeners.forEach((l) => l(id))
      return get(id)
    },
    onCampaignChanged(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}
