/* Contract tests, written against the CampaignSource adapter — not the POC
   store — so engineering runs the SAME suites against the real campaign
   service after plugging the module in (CAMPAIGN-APPROVAL-INTEGRATION.md §6).

   Usage, from any vitest file:
     runCampaignSourceContract('real adapter', () => ({ source, fixture }))
     runApprovalContract('real adapter', () => ({ source, db, fixture, requiresApproval })) */
import { describe, expect, it } from 'vitest'
import type { CampaignSource } from '../src/adapter/CampaignSource'
import type { SqlDb } from '../src/db'
import { createApprovalService } from '../src/server/service'

export interface Fixture {
  /* An existing advertiser campaign (source api or dsp), currently not activated. */
  advertiserCampaignId: string
  /* An existing HQ-authored campaign. */
  hqCampaignId: string
  /* Change the campaign's creative so its assetVersion changes. */
  changeCreative: (campaignId: string) => void | Promise<void>
}

export function runCampaignSourceContract(name: string, make: () => { source: CampaignSource; fixture: Fixture } | Promise<{ source: CampaignSource; fixture: Fixture }>) {
  describe(`CampaignSource contract — ${name}`, () => {
    it('returns null for an unknown campaign', async () => {
      const { source } = await make()
      expect(await source.getCampaign('does-not-exist')).toBeNull()
    })

    it('describes a campaign with every field the module reads', async () => {
      const { source, fixture } = await make()
      const c = await source.getCampaign(fixture.advertiserCampaignId)
      expect(c).toMatchObject({ campaignId: fixture.advertiserCampaignId, activation: { enabled: expect.any(Boolean) } })
      expect(['api', 'dsp']).toContain(c!.source)
      expect(typeof c!.name).toBe('string')
      expect(typeof c!.assetVersion).toBe('string')
      expect(typeof c!.targetingSummary).toBe('string')
      expect(c).toHaveProperty('creative')
      expect(c).toHaveProperty('canvas')
      expect((await source.getCampaign(fixture.hqCampaignId))!.source).toBe('hq')
    })

    it('filters by source and by id', async () => {
      const { source, fixture } = await make()
      const adv = await source.listCampaigns({ sources: ['api', 'dsp'] })
      expect(adv.some((c) => c.campaignId === fixture.advertiserCampaignId)).toBe(true)
      expect(adv.some((c) => c.source === 'hq')).toBe(false)
      expect((await source.listCampaigns({ ids: [fixture.hqCampaignId] })).map((c) => c.campaignId)).toEqual([fixture.hqCampaignId])
    })

    it('switches activation and notifies listeners until unsubscribed', async () => {
      const { source, fixture } = await make()
      const seen: string[] = []
      const off = source.onCampaignChanged((id) => seen.push(id))
      expect((await source.setActivation(fixture.advertiserCampaignId, true))!.activation.enabled).toBe(true)
      expect((await source.setActivation(fixture.advertiserCampaignId, false))!.activation.enabled).toBe(false)
      off()
      await source.setActivation(fixture.advertiserCampaignId, true)
      expect(seen).toEqual([fixture.advertiserCampaignId, fixture.advertiserCampaignId])
    })

    it('changes assetVersion when the creative changes', async () => {
      const { source, fixture } = await make()
      const before = (await source.getCampaign(fixture.advertiserCampaignId))!.assetVersion
      await fixture.changeCreative(fixture.advertiserCampaignId)
      expect((await source.getCampaign(fixture.advertiserCampaignId))!.assetVersion).not.toBe(before)
    })
  })
}

export function runApprovalContract(name: string, make: () => { source: CampaignSource; db: SqlDb; fixture: Fixture; requiresApproval: (advertiserId: string | null) => boolean } | Promise<{ source: CampaignSource; db: SqlDb; fixture: Fixture; requiresApproval: (advertiserId: string | null) => boolean }>) {
  describe(`Approval over CampaignSource — ${name}`, () => {
    const setup = async (over: { requiresApproval?: boolean } = {}) => {
      const m = await make()
      const service = createApprovalService({ db: m.db, campaigns: m.source, requiresApproval: over.requiresApproval === undefined ? m.requiresApproval : () => over.requiresApproval! })
      return { ...m, service, id: m.fixture.advertiserCampaignId }
    }

    it('Draft → Awaiting approval → Approved, recorded with who and when; only then activatable and eligible', async () => {
      const { service, id } = await setup({ requiresApproval: true })
      expect((await service.view(id)).status).toBe('draft')
      await expect(service.setActivation(id, true)).rejects.toMatchObject({ code: 'not_approved' })
      expect((await service.submit(id, [], 'advertiser')).status).toBe('awaiting_approval')
      expect(await service.isCampaignEligible(id)).toBe(false)
      const v = (await service.view(id)).assetVersion
      const approved = await service.approve(id, v, 'hq-admin@retailer')
      expect(approved).toMatchObject({ status: 'approved', mode: 'manual', reviewedBy: 'hq-admin@retailer' })
      expect(approved.audit!.map((a) => a.action)).toEqual(['submitted', 'approved'])
      expect(await service.isCampaignEligible(id)).toBe(true)
      expect((await service.setActivation(id, true))!.activation.enabled).toBe(true)
    })

    it('Reject needs a reason and blocks activation', async () => {
      const { service, id } = await setup({ requiresApproval: true })
      await service.submit(id, [], 'advertiser')
      const v = (await service.view(id)).assetVersion
      await expect(service.reject(id, v, 'hq', ' ')).rejects.toMatchObject({ code: 'validation_failed' })
      expect(await service.reject(id, v, 'hq', 'Price in artwork')).toMatchObject({ status: 'rejected', reason: 'Price in artwork' })
      expect(await service.isCampaignEligible(id)).toBe(false)
    })

    it('auto-approves when the advertiser does not require approval, recorded as such', async () => {
      const { service, id } = await setup({ requiresApproval: false })
      const s = await service.submit(id, [], 'advertiser')
      expect(s).toMatchObject({ status: 'approved', mode: 'auto' })
      expect((await service.view(id)).audit!.map((a) => a.action)).toEqual(['submitted', 'auto_approved'])
    })

    it('a creative change on an approved campaign returns it to Awaiting approval and stops it (Q38 default)', async () => {
      const { service, id, fixture, source } = await setup({ requiresApproval: true })
      await service.submit(id, [], 'advertiser')
      await service.approve(id, (await service.view(id)).assetVersion, 'hq')
      await service.setActivation(id, true)
      await fixture.changeCreative(id)
      const after = await service.changed(id, 'advertiser')
      expect(after.status).toBe('awaiting_approval')
      expect(await service.isCampaignEligible(id)).toBe(false)
      expect((await source.getCampaign(id))!.activation.enabled).toBe(false)
      expect((await service.view(id)).audit!.map((a) => a.action)).toEqual(['submitted', 'approved', 'returned_for_review'])
    })

    it('approving a version that has since changed is a conflict', async () => {
      const { service, id, fixture } = await setup({ requiresApproval: true })
      await service.submit(id, [], 'advertiser')
      const old = (await service.view(id)).assetVersion
      await fixture.changeCreative(id)
      await expect(service.approve(id, old, 'hq')).rejects.toMatchObject({ code: 'conflict' })
    })

    it('HQ-authored campaigns skip approval', async () => {
      const { service, fixture } = await setup()
      expect(await service.isCampaignEligible(fixture.hqCampaignId)).toBe(true)
      expect((await service.list()).items.some((a) => a.campaignId === fixture.hqCampaignId)).toBe(false)
    })
  })
}
