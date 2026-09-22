// @vitest-environment node
/* Safe reuse of previously approved assets (spec §3, ticket 22 Sep):
   narrower than Amazon's — an asset skips re-review on resubmission only
   when it is BOTH unchanged (byte-identical, i.e. same contentHash) AND
   previously cleared by a HUMAN review, never by automated checks alone. */
import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { CampaignRef, CampaignSource } from '../src/adapter/CampaignSource'
import { createApprovalService } from '../src/server/service'

function setup(creative: CampaignRef['creative'], requiresApproval = true) {
  const db = new DatabaseSync(':memory:')
  db.exec(readFileSync(fileURLToPath(new URL('../migrations/0100_campaign_approvals.up.sql', import.meta.url)), 'utf8'))
  db.exec(readFileSync(fileURLToPath(new URL('../migrations/0101_asset_level_rejection.up.sql', import.meta.url)), 'utf8'))
  let ref: CampaignRef = {
    campaignId: 'c1', name: 'Swisse spring', source: 'api', advertiserId: 'swisse', advertiserName: 'Swisse',
    partnerId: 'p1', partnerName: 'Google DSP', activation: { enabled: false }, assetVersion: 'v1',
    targetingSummary: 'Baseline only', creative, canvas: { width: 1920, height: 1080 },
  }
  const source: CampaignSource = {
    getCampaign: () => ref,
    listCampaigns: () => [ref],
    setActivation: (id, enabled) => { ref = { ...ref, activation: { enabled } }; return ref },
    onCampaignChanged: () => () => {},
  }
  return createApprovalService({ db, campaigns: source, requiresApproval: () => requiresApproval })
}

const hash1 = { assetUrl: '/a.png', mimeType: 'image/png', width: 1920, height: 1080, contentHash: 'hash-1' }

describe('safe reuse of previously approved assets (spec §3)', () => {
  it('a human approval clears the asset at its content hash', async () => {
    const service = setup(hash1)
    expect(service.wasAssetHumanCleared('c1', 'default', 'hash-1')).toBe(false)
    await service.submit('c1', [], 'advertiser')
    await service.approve('c1', 'v1', 'hq-admin')
    expect(service.wasAssetHumanCleared('c1', 'default', 'hash-1')).toBe(true)
  })

  it('a changed asset (a different content hash) never qualifies, even after a human cleared the old one', async () => {
    const service = setup(hash1)
    await service.submit('c1', [], 'advertiser')
    await service.approve('c1', 'v1', 'hq-admin')
    expect(service.wasAssetHumanCleared('c1', 'default', 'hash-1')).toBe(true)
    expect(service.wasAssetHumanCleared('c1', 'default', 'hash-2')).toBe(false)
  })

  it('automated-pass alone never clears an asset — only a genuine human approve does', async () => {
    /* The advertiser doesn't require approval, so submit auto-approves — never a human decision. */
    const service = setup(hash1, false)
    const submitted = await service.submit('c1', [], 'advertiser')
    expect(submitted).toMatchObject({ status: 'approved', mode: 'auto' })
    expect(service.wasAssetHumanCleared('c1', 'default', 'hash-1')).toBe(false)
  })

  it('no contentHash on the creative (the adapter cannot supply one) never clears — safe by default', async () => {
    const service = setup({ assetUrl: '/a.png', mimeType: 'image/png', width: 1920, height: 1080 })
    await service.submit('c1', [], 'advertiser')
    await service.approve('c1', 'v1', 'hq-admin')
    /* Nothing to compare against, so nothing is ever reported cleared. */
    expect(service.wasAssetHumanCleared('c1', 'default', 'hash-1')).toBe(false)
  })
})
