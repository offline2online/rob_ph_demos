import { describe, expect, it } from 'vitest'
import { sweepRejectedCampaigns } from '../src/domain/campaignRetention'
import { testContext } from './helpers'

const DAY = 24 * 60 * 60 * 1000

describe('sweepRejectedCampaigns (spec §3 "Enforcement and audit")', () => {
  it('deletes a campaign and its assets once Rejected for longer than the retention window, keeping the audit trail', async () => {
    const ctx = await testContext()
    const v = (await ctx.approvals.view('c_api_swisse')).assetVersion
    await ctx.approvals.reject('c_api_swisse', v, 'hq', 'Price in artwork')

    /* Still within the window: nothing deleted. */
    const early = await sweepRejectedCampaigns(ctx, 30, () => new Date(Date.now() + 29 * DAY))
    expect(early.deletedCampaignIds).not.toContain('c_api_swisse')
    expect(ctx.db.prepare('SELECT 1 FROM campaigns WHERE id = ?').get('c_api_swisse')).toBeTruthy()

    /* Past the window: the campaign and its assets are gone, the audit trail survives. */
    const late = await sweepRejectedCampaigns(ctx, 30, () => new Date(Date.now() + 31 * DAY))
    expect(late.deletedCampaignIds).toContain('c_api_swisse')
    expect(ctx.db.prepare('SELECT 1 FROM campaigns WHERE id = ?').get('c_api_swisse')).toBeUndefined()
    expect(ctx.db.prepare('SELECT COUNT(*) AS n FROM campaign_assets WHERE campaign_id = ?').get('c_api_swisse')).toEqual({ n: 0 })
    expect(ctx.db.prepare('SELECT COUNT(*) AS n FROM campaign_approvals WHERE campaign_id = ?').get('c_api_swisse')).toEqual({ n: 0 })
    const audit = ctx.db.prepare('SELECT action, reason FROM campaign_approval_audit WHERE campaign_id = ? ORDER BY at').all('c_api_swisse')
    expect(audit).toEqual(expect.arrayContaining([{ action: 'rejected', reason: 'Price in artwork' }]))
  })

  it('is scoped to Rejected only — Draft, Awaiting approval and Approved are never swept, however old', async () => {
    const ctx = await testContext()
    /* c_api_swisse starts Awaiting approval; c_dsp_nestle starts auto-approved. Neither is ever Rejected. */
    const result = await sweepRejectedCampaigns(ctx, 30, () => new Date(Date.now() + 365 * DAY))
    expect(result.deletedCampaignIds).not.toContain('c_api_swisse')
    expect(result.deletedCampaignIds).not.toContain('c_dsp_nestle')
    expect(ctx.db.prepare('SELECT 1 FROM campaigns WHERE id = ?').get('c_api_swisse')).toBeTruthy()
    expect(ctx.db.prepare('SELECT 1 FROM campaigns WHERE id = ?').get('c_dsp_nestle')).toBeTruthy()
  })

  it('un-reject takes a campaign out of scope: the clock stops, and it only restarts if rejected again', async () => {
    const ctx = await testContext()
    const v = (await ctx.approvals.view('c_api_swisse')).assetVersion
    await ctx.approvals.reject('c_api_swisse', v, 'hq', 'Price in artwork')
    await ctx.approvals.unreject('c_api_swisse', v, 'hq-admin')

    /* No longer Rejected: never swept, however old the (undone) rejection was. */
    expect((await sweepRejectedCampaigns(ctx, 30, () => new Date(Date.now() + 365 * DAY))).deletedCampaignIds).not.toContain('c_api_swisse')
    expect(ctx.db.prepare('SELECT 1 FROM campaigns WHERE id = ?').get('c_api_swisse')).toBeTruthy()

    /* Rejected again: the clock restarts from the new rejection. */
    await ctx.approvals.reject('c_api_swisse', v, 'hq', 'Still has a price in it')
    expect((await sweepRejectedCampaigns(ctx, 30, () => new Date(Date.now() + 29 * DAY))).deletedCampaignIds).not.toContain('c_api_swisse')
    expect((await sweepRejectedCampaigns(ctx, 30, () => new Date(Date.now() + 31 * DAY))).deletedCampaignIds).toContain('c_api_swisse')
  })

  it('the retention window is configurable, not hard-coded', async () => {
    const ctx = await testContext()
    const v = (await ctx.approvals.view('c_api_swisse')).assetVersion
    await ctx.approvals.reject('c_api_swisse', v, 'hq', 'Price in artwork')
    /* A 7-day window catches what a 30-day window would still be holding. */
    expect((await sweepRejectedCampaigns(ctx, 7, () => new Date(Date.now() + 8 * DAY))).deletedCampaignIds).toContain('c_api_swisse')
  })
})

/* VzKX05Ulo9wGMuLMvISi (2 Oct 2026): the campaign's current approval row is
   picked by created_at, then seq, as approvalStore.latest() does — two rows
   in the same millisecond no longer both count as current — and the
   campaign record goes through CampaignSource.deleteCampaign, PH Core's
   call to make. */
describe('sweepRejectedCampaigns — current row and the PH Core seam', () => {
  it('does not sweep a campaign whose newest row, written in the same millisecond as a rejected one, is not rejected', async () => {
    const ctx = await testContext()
    const at = new Date(Date.now() - 60 * DAY).toISOString()
    const ins = ctx.db.prepare("INSERT INTO campaign_approvals (campaign_id, asset_version, status, mode, submitted_at, reviewed_by, reviewed_at, reason, asset_reasons, checks, created_at) VALUES ('c_api_swisse', ?, ?, 'manual', ?, 'hq', ?, NULL, NULL, '[]', ?)")
    ctx.db.prepare("DELETE FROM campaign_approvals WHERE campaign_id = 'c_api_swisse'").run()
    ins.run('v1', 'rejected', at, at, at)
    ins.run('v2', 'awaiting_approval', at, null, at)
    const result = await sweepRejectedCampaigns(ctx, 30)
    expect(result.deletedCampaignIds).not.toContain('c_api_swisse')
    expect(ctx.db.prepare('SELECT 1 FROM campaigns WHERE id = ?').get('c_api_swisse')).toBeTruthy()
  })

  it('removes the exchange’s own rows even when PH Core keeps the campaign', async () => {
    const ctx = await testContext()
    const v = (await ctx.approvals.view('c_api_swisse')).assetVersion
    await ctx.approvals.reject('c_api_swisse', v, 'hq', 'Price in artwork')
    const asked: string[] = []
    const campaigns = Object.assign(Object.create(ctx.campaigns), { deleteCampaign: (id: string) => (asked.push(id), false) })
    const result = await sweepRejectedCampaigns({ ...ctx, campaigns }, 30, () => new Date(Date.now() + 31 * DAY))
    expect(asked).toContain('c_api_swisse')
    expect(result.deletedCampaignIds).toContain('c_api_swisse')
    expect(result.keptByPhCore).toContain('c_api_swisse')
    expect(ctx.db.prepare('SELECT 1 FROM campaigns WHERE id = ?').get('c_api_swisse')).toBeTruthy()
    expect(ctx.db.prepare('SELECT COUNT(*) AS n FROM campaign_approvals WHERE campaign_id = ?').get('c_api_swisse')).toEqual({ n: 0 })
  })
})
