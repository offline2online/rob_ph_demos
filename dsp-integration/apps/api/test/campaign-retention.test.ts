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
    const early = sweepRejectedCampaigns(ctx.db, 30, () => new Date(Date.now() + 29 * DAY))
    expect(early.deletedCampaignIds).not.toContain('c_api_swisse')
    expect(ctx.db.prepare('SELECT 1 FROM campaigns WHERE id = ?').get('c_api_swisse')).toBeTruthy()

    /* Past the window: the campaign and its assets are gone, the audit trail survives. */
    const late = sweepRejectedCampaigns(ctx.db, 30, () => new Date(Date.now() + 31 * DAY))
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
    const result = sweepRejectedCampaigns(ctx.db, 30, () => new Date(Date.now() + 365 * DAY))
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
    expect(sweepRejectedCampaigns(ctx.db, 30, () => new Date(Date.now() + 365 * DAY)).deletedCampaignIds).not.toContain('c_api_swisse')
    expect(ctx.db.prepare('SELECT 1 FROM campaigns WHERE id = ?').get('c_api_swisse')).toBeTruthy()

    /* Rejected again: the clock restarts from the new rejection. */
    await ctx.approvals.reject('c_api_swisse', v, 'hq', 'Still has a price in it')
    expect(sweepRejectedCampaigns(ctx.db, 30, () => new Date(Date.now() + 29 * DAY)).deletedCampaignIds).not.toContain('c_api_swisse')
    expect(sweepRejectedCampaigns(ctx.db, 30, () => new Date(Date.now() + 31 * DAY)).deletedCampaignIds).toContain('c_api_swisse')
  })

  it('the retention window is configurable, not hard-coded', async () => {
    const ctx = await testContext()
    const v = (await ctx.approvals.view('c_api_swisse')).assetVersion
    await ctx.approvals.reject('c_api_swisse', v, 'hq', 'Price in artwork')
    /* A 7-day window catches what a 30-day window would still be holding. */
    expect(sweepRejectedCampaigns(ctx.db, 7, () => new Date(Date.now() + 8 * DAY)).deletedCampaignIds).toContain('c_api_swisse')
  })
})
