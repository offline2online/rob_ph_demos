// @vitest-environment node
/* Safe reuse of previously approved assets (spec §3, ticket 22 Sep):
   narrower than Amazon's — an asset skips re-review on resubmission only
   when it is BOTH unchanged (byte-identical, i.e. same contentHash) AND
   previously cleared by a HUMAN review, never by automated checks alone. */
import { DatabaseSync } from 'node:sqlite'
import { migrateAll } from './migrateAll'
import { describe, expect, it } from 'vitest'
import type { CampaignRef, CampaignSource } from '../src/adapter/CampaignSource'
import { createApprovalService } from '../src/server/service'

function setup(creative: CampaignRef['creative'], requiresApproval = true, assets?: CampaignRef['assets']) {
  const db = new DatabaseSync(':memory:')
  migrateAll(db)
  let ref: CampaignRef = {
    campaignId: 'c1', name: 'Swisse spring', source: 'api', advertiserId: 'swisse', advertiserName: 'Swisse',
    partnerId: 'p1', partnerName: 'Google DSP', activation: { enabled: false }, assetVersion: 'v1',
    targetingSummary: 'Baseline only', creative, canvas: { width: 1920, height: 1080 }, ...(assets ? { assets } : {}),
  }
  const source: CampaignSource = {
    getCampaign: () => ref,
    listCampaigns: () => [ref],
    setActivation: (id, enabled) => { ref = { ...ref, activation: { enabled } }; return ref },
    onCampaignChanged: () => () => {},
    discardEditsAfter: (_id, assetVersion) => { ref = { ...ref, assetVersion } },
  }
  const service = createApprovalService({ db, campaigns: source, requiresApproval: () => requiresApproval })
  /* A new version of the campaign: its assets and/or targeting replaced. */
  const edit = (over: Partial<CampaignRef>) => { ref = { ...ref, assetVersion: `v${Number(ref.assetVersion.slice(1)) + 1}`, ...over } }
  return Object.assign(service, { edit })
}

const hash1 = { assetUrl: '/a.png', mimeType: 'image/png', width: 1920, height: 1080, contentHash: 'hash-1' }

describe('safe reuse of previously approved assets (spec §3)', () => {
  it('a human approval clears the asset at its content hash', async () => {
    const service = setup(hash1)
    expect(await service.wasAssetHumanCleared('c1', 'default', 'hash-1')).toBe(false)
    await service.submit('c1', [], 'advertiser')
    await service.approve('c1', 'v1', 'hq-admin')
    expect(await service.wasAssetHumanCleared('c1', 'default', 'hash-1')).toBe(true)
  })

  it('a changed asset (a different content hash) never qualifies, even after a human cleared the old one', async () => {
    const service = setup(hash1)
    await service.submit('c1', [], 'advertiser')
    await service.approve('c1', 'v1', 'hq-admin')
    expect(await service.wasAssetHumanCleared('c1', 'default', 'hash-1')).toBe(true)
    expect(await service.wasAssetHumanCleared('c1', 'default', 'hash-2')).toBe(false)
  })

  it('automated-pass alone never clears an asset — only a genuine human approve does', async () => {
    /* The advertiser doesn't require approval, so submit auto-approves — never a human decision. */
    const service = setup(hash1, false)
    const submitted = await service.submit('c1', [], 'advertiser')
    expect(submitted).toMatchObject({ status: 'approved', mode: 'auto' })
    expect(await service.wasAssetHumanCleared('c1', 'default', 'hash-1')).toBe(false)
  })

  it('no contentHash on the creative (the adapter cannot supply one) never clears — safe by default', async () => {
    const service = setup({ assetUrl: '/a.png', mimeType: 'image/png', width: 1920, height: 1080 })
    await service.submit('c1', [], 'advertiser')
    await service.approve('c1', 'v1', 'hq-admin')
    /* Nothing to compare against, so nothing is ever reported cleared. */
    expect(await service.wasAssetHumanCleared('c1', 'default', 'hash-1')).toBe(false)
  })

  /* Wired into submit/change (Q40, 29 Sep 2026): a version whose every
     asset — and targeting — a human already cleared at the same content is
     approved without re-review; anything else still goes to the reviewer,
     who is told which assets are unchanged. */
  const assets = [{ assetId: 'default', contentHash: 'hash-1' }, { assetId: 'metro', contentHash: 'hash-m' }]

  it('an identical resubmission (same hashes, same targeting) skips re-review, recorded as such', async () => {
    const service = setup(hash1, true, assets)
    await service.submit('c1', [], 'advertiser')
    await service.approve('c1', 'v1', 'hq-admin')
    expect(await service.wasAssetHumanCleared('c1', 'metro', 'hash-m')).toBe(true)
    service.edit({})
    const again = await service.changed('c1', 'advertiser')
    expect(again).toMatchObject({ status: 'approved', mode: 'auto', assetVersion: 'v2', liveAssetVersion: 'v2', pendingEdit: false })
    const audit = (await service.view('c1')).audit!
    expect(audit.map((a) => [a.action, a.by])).toEqual([['submitted', 'advertiser'], ['approved', 'hq-admin'], ['returned_for_review', 'advertiser'], ['reused_clearance', null]])
  })

  it('one changed asset still goes to the reviewer, who is told which assets are unchanged', async () => {
    const service = setup(hash1, true, assets)
    await service.submit('c1', [], 'advertiser')
    await service.approve('c1', 'v1', 'hq-admin')
    service.edit({ assets: [{ assetId: 'default', contentHash: 'hash-2' }, { assetId: 'metro', contentHash: 'hash-m' }] })
    const edit = await service.changed('c1', 'advertiser')
    expect(edit).toMatchObject({ status: 'awaiting_approval', pendingEdit: true, liveAssetVersion: 'v1' })
    expect(edit.checks.filter((c) => c.name === 'previously_cleared')).toEqual([expect.objectContaining({ assetId: 'metro', passed: true, advisory: true })])
  })

  it('identical files under changed targeting rules still go to the reviewer', async () => {
    const service = setup(hash1, true, assets)
    await service.submit('c1', [], 'advertiser')
    await service.approve('c1', 'v1', 'hq-admin')
    service.edit({ targetingSummary: 'Metro stores only' })
    expect((await service.changed('c1', 'advertiser')).status).toBe('awaiting_approval')
  })

  it('an adapter that lists no assets never gets a reuse', async () => {
    const service = setup(hash1)
    await service.submit('c1', [], 'advertiser')
    await service.approve('c1', 'v1', 'hq-admin')
    service.edit({})
    expect((await service.changed('c1', 'advertiser')).status).toBe('awaiting_approval')
  })
})
