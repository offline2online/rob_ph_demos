/* A reference in-memory adapter, used to prove the contract suites
   themselves. Not shipped. */
import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { CampaignRef, CampaignSource } from '../src/adapter/CampaignSource'
import type { Fixture } from './contract'

export function memorySetup() {
  const campaigns = new Map<string, CampaignRef>()
  const base = { advertiserName: 'Swisse', partnerId: 'p1', partnerName: 'Google DSP', targetingSummary: 'Baseline only', creative: null, canvas: { width: 1920, height: 1080 } }
  campaigns.set('c_adv', { ...base, campaignId: 'c_adv', name: 'Swisse spring', source: 'api', advertiserId: 'swisse', activation: { enabled: false }, assetVersion: 'v1' })
  campaigns.set('c_hq', { ...base, campaignId: 'c_hq', name: 'HQ hero', source: 'hq', advertiserId: null, advertiserName: null, activation: { enabled: true }, assetVersion: 'v1' })
  const listeners = new Set<(id: string) => void>()
  const source: CampaignSource = {
    getCampaign: (id) => campaigns.get(id) ?? null,
    listCampaigns: (f = {}) => [...campaigns.values()].filter((c) => (!f.sources || f.sources.includes(c.source)) && (!f.ids || f.ids.includes(c.campaignId))),
    setActivation: (id, enabled) => {
      const c = campaigns.get(id)
      if (!c) return null
      campaigns.set(id, { ...c, activation: { enabled } })
      listeners.forEach((l) => l(id))
      return campaigns.get(id)!
    },
    onCampaignChanged: (l) => (listeners.add(l), () => listeners.delete(l)),
  }
  const fixture: Fixture = {
    advertiserCampaignId: 'c_adv',
    hqCampaignId: 'c_hq',
    changeCreative: (id) => {
      const c = campaigns.get(id)!
      campaigns.set(id, { ...c, assetVersion: `v${Number(c.assetVersion.slice(1)) + 1}` })
    },
  }
  const db = new DatabaseSync(':memory:')
  db.exec(readFileSync(fileURLToPath(new URL('../migrations/0100_campaign_approvals.up.sql', import.meta.url)), 'utf8'))
  return { source, fixture, db, requiresApproval: () => true }
}
