/* The POC's CampaignSource, backed by this repo's stand-in campaign store
   (the `campaigns` and `campaign_assets` tables). On integration it is
   replaced by an adapter over the real campaign service. */
import type { SqlDb } from '../db'
import type { Canvas, Creative } from '../types'
import type { CampaignRef, CampaignSource } from './CampaignSource'

/* Lookups the host supplies (names, canvas, asset URLs, targeting summary). */
type Awaitable<T> = T | Promise<T>
/* Each may answer with a promise: the host's own reads may be awaitable. */
export interface PocLookups {
  advertiserName(advertiserId: string): Awaitable<string | null>
  partnerName(partnerId: string): Awaitable<string | null>
  canvas(displayTypeId: string): Awaitable<Canvas | null>
  assetUrl(file: string): Awaitable<string>
  targetingSummary(targeting: unknown): Awaitable<string>
}

interface Row { id: string; name: string; source: CampaignRef['source']; advertiser_id: string | null; partner_id: string | null; display_type_id: string | null; activation_enabled: number; targeting: string | null }
interface AssetRow { version: number; role: string; file: string; mime_type: string; width: number; height: number; content_hash: string | null }

/* This adapter's assetVersion is `v<n>`, n the highest campaign_assets
   version in it; the host resolves a version to its assets with this. */
export const assetVersionNumber = (assetVersion: string) => Number(assetVersion.replace(/^v/, '')) || 0

export function pocCampaignSource(db: SqlDb, lookups: PocLookups): CampaignSource {
  const listeners = new Set<(id: string) => void>()
  /* The campaign's own rows, read in one synchronous step; the host's
     lookups (which may await) are filled in afterwards by toRef. */
  const assetsOf = (id: string) => db.prepare('SELECT version, role, file, mime_type, width, height, content_hash FROM campaign_assets WHERE campaign_id = ? AND discarded_at IS NULL ORDER BY version').all(id) as unknown as AssetRow[]
  const toRef = async (r: Row, rows: AssetRow[]): Promise<CampaignRef> => {
    /* The default layer's creative for the reviewer — mandatory on every
       submission (decision, 22 Sep) — or, for an older record predating
       the requirement, whichever targeted version's was uploaded most
       recently, so the panel is never blank just because there was none. */
    /* One read of the current version's assets (an edit a reviewer rejected
       is discarded, so never part of it — Q38): the latest per role. */
    const byRole = [...new Map(rows.map((a) => [a.role, a])).values()]
    const latest = byRole.find((a) => a.role === 'default') ?? [...byRole].sort((a, b) => b.version - a.version)[0]
    const version = rows.length ? rows[rows.length - 1].version : 0
    const creative: Creative | null = latest ? { assetUrl: await lookups.assetUrl(latest.file), mimeType: latest.mime_type, width: latest.width, height: latest.height, ...(latest.content_hash ? { contentHash: latest.content_hash } : {}) } : null
    return {
      campaignId: r.id, name: r.name, source: r.source,
      advertiserId: r.advertiser_id, advertiserName: r.advertiser_id ? await lookups.advertiserName(r.advertiser_id) : null,
      partnerId: r.partner_id, partnerName: r.partner_id ? await lookups.partnerName(r.partner_id) : null,
      activation: { enabled: !!r.activation_enabled },
      assetVersion: `v${version}`,
      targetingSummary: await lookups.targetingSummary(r.targeting ? JSON.parse(r.targeting) : null),
      creative,
      assets: byRole.map((a) => ({ assetId: a.role, ...(a.content_hash ? { contentHash: a.content_hash } : {}) })),
      canvas: r.display_type_id ? await lookups.canvas(r.display_type_id) : null,
    }
  }
  const get = (id: string) => {
    const r = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(id) as Row | undefined
    return r ? toRef(r, assetsOf(r.id)) : null
  }
  return {
    getCampaign: get,
    async listCampaigns(filter = {}) {
      const rows = (db.prepare('SELECT * FROM campaigns ORDER BY created_at, id').all() as Row[])
        .filter((r) => (!filter.sources || filter.sources.includes(r.source)) && (!filter.ids || filter.ids.includes(r.id)))
        .map((r) => [r, assetsOf(r.id)] as const)
      const out: CampaignRef[] = []
      for (const [r, assets] of rows) out.push(await toRef(r, assets))
      return out
    },
    setActivation(id, enabled) {
      db.prepare('UPDATE campaigns SET activation_enabled = ? WHERE id = ?').run(enabled ? 1 : 0, id)
      listeners.forEach((l) => l(id))
      return get(id)
    },
    discardEditsAfter(id, assetVersion) {
      db.prepare('UPDATE campaign_assets SET discarded_at = ? WHERE campaign_id = ? AND version > ? AND discarded_at IS NULL').run(new Date().toISOString(), id, assetVersionNumber(assetVersion))
      listeners.forEach((l) => l(id))
    },
    onCampaignChanged(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}
