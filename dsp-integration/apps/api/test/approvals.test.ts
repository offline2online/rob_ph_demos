import { randomUUID } from 'node:crypto'
import { runApprovalContract, runCampaignSourceContract } from '@ph-dsp/campaign-approval/contract'
import { describe, expect, it } from 'vitest'
import { buildApp } from '../src/http/app'
import { expectMatchesContract } from './contract'
import { testContext } from './helpers'

/* The module's contract suites, run against the POC adapter. */
const poc = async () => {
  const ctx = await testContext()
  return {
    source: ctx.approvalCampaigns,
    db: ctx.db,
    requiresApproval: () => true,
    fixture: {
      advertiserCampaignId: 'c_api_swisse_kids',
      hqCampaignId: 'c_zinger',
      changeCreative: (id: string) => {
        const v = (ctx.db.prepare('SELECT COALESCE(MAX(version), 0) AS v FROM campaign_assets WHERE campaign_id = ?').get(id) as { v: number }).v
        ctx.db.prepare("INSERT INTO campaign_assets (id, campaign_id, version, role, file, mime_type, width, height, size_bytes, created_at) VALUES (?, ?, ?, 'default', 'x.png', 'image/png', 1920, 1080, 1, ?)")
          .run(randomUUID(), id, v + 1, new Date().toISOString())
      },
    },
  }
}
runCampaignSourceContract('POC adapter', poc)
runApprovalContract('POC adapter', poc)

describe('Campaign approval API (contract: Admin — Campaign approval)', () => {
  it('lists campaigns by approval status with counts for all four', async () => {
    const app = buildApp(await testContext())
    const res = await app.inject({ method: 'GET', url: '/api/admin/v1/approvals' })
    expectMatchesContract('GET', '/admin/v1/approvals', 200, res.json())
    expect(res.json().counts).toEqual({ draft: 1, awaiting_approval: 1, approved: 1, rejected: 1 })
    const awaiting = await app.inject({ method: 'GET', url: '/api/admin/v1/approvals?status=awaiting_approval' })
    expect(awaiting.json().items.map((a: { campaignId: string }) => a.campaignId)).toEqual(['c_api_swisse'])
    expect((await app.inject({ method: 'GET', url: '/api/admin/v1/approvals?status=nope' })).statusCode).toBe(400)
  })

  it('the review view has the creative, canvas, targeting summary, checks and audit trail', async () => {
    const res = await buildApp(await testContext()).inject({ method: 'GET', url: '/api/admin/v1/campaigns/c_dsp_nestle/approval' })
    expectMatchesContract('GET', '/admin/v1/campaigns/{campaignId}/approval', 200, res.json())
    const a = res.json()
    expect(a).toMatchObject({ status: 'approved', mode: 'auto', advertiserName: 'Nestlé', partnerName: 'Google DSP', canvas: { width: 1920, height: 1080 }, creative: { mimeType: 'image/svg+xml', width: 1920, height: 1080 } })
    expect(a.targetingSummary).toBe('Default (localised)\nmetro-open (priority 10, localised): Fixed Store Segments includes selected Metro AND Store Open / Closed equal Open')
    expect(a.audit.map((x: { action: string }) => x.action)).toEqual(['submitted', 'auto_approved'])
  })

  it('serves the creative for the review panel', async () => {
    const app = buildApp(await testContext())
    const url = (await app.inject({ method: 'GET', url: '/api/admin/v1/campaigns/c_api_swisse/approval' })).json().creative.assetUrl
    const img = await app.inject({ method: 'GET', url })
    expect(img.statusCode).toBe(200)
    expect(img.headers['content-type']).toBe('image/svg+xml')
    expect((await app.inject({ method: 'GET', url: '/assets/../etc-passwd' })).statusCode).toBe(404)
  })

  it('HQ Admin approves the reviewed version; the activation toggle then works', async () => {
    const app = buildApp(await testContext())
    const blocked = await app.inject({ method: 'PUT', url: '/api/admin/v1/campaigns/c_api_swisse/activation', payload: { enabled: true } })
    expect(blocked.statusCode).toBe(422)
    expectMatchesContract('PUT', '/admin/v1/campaigns/{campaignId}/activation', 422, blocked.json())
    expect(blocked.json().error.code).toBe('not_approved')
    const stale = await app.inject({ method: 'POST', url: '/api/admin/v1/campaigns/c_api_swisse/approve', payload: { assetVersion: 'v0' } })
    expect(stale.statusCode).toBe(409)
    const ok = await app.inject({ method: 'POST', url: '/api/admin/v1/campaigns/c_api_swisse/approve', payload: { assetVersion: 'v1' } })
    expect(ok.statusCode).toBe(200)
    expectMatchesContract('POST', '/admin/v1/campaigns/{campaignId}/approve', 200, ok.json())
    expect(ok.json()).toMatchObject({ status: 'approved', mode: 'manual', reviewedBy: 'HQ Admin (POC)' })
    const on = await app.inject({ method: 'PUT', url: '/api/admin/v1/campaigns/c_api_swisse/activation', payload: { enabled: true } })
    expect(on.statusCode).toBe(200)
    expectMatchesContract('PUT', '/admin/v1/campaigns/{campaignId}/activation', 200, on.json())
    expect(on.json().activation.enabled).toBe(true)
  })

  it('reject needs a reason; non-approvers get 403', async () => {
    const app = buildApp(await testContext())
    const noReason = await app.inject({ method: 'POST', url: '/api/admin/v1/campaigns/c_api_swisse/reject', payload: { assetVersion: 'v1', reason: ' ' } })
    expect(noReason.statusCode).toBe(400)
    expectMatchesContract('POST', '/admin/v1/campaigns/{campaignId}/reject', 400, noReason.json())
    const user = buildApp(await testContext({ role: 'hq_marketing' }))
    const forbidden = await user.inject({ method: 'POST', url: '/api/admin/v1/campaigns/c_api_swisse/approve', payload: { assetVersion: 'v1' } })
    expect(forbidden.statusCode).toBe(403)
    expectMatchesContract('POST', '/admin/v1/campaigns/{campaignId}/approve', 403, forbidden.json())
  })

  it('the stand-in campaign list carries approval-free fields only', async () => {
    const res = await buildApp(await testContext()).inject({ method: 'GET', url: '/api/admin/v1/campaigns' })
    expectMatchesContract('GET', '/admin/v1/campaigns', 200, res.json())
    expect(res.json().items.find((c: { campaignId: string }) => c.campaignId === 'c_dsp_loreal')).toMatchObject({ source: 'dsp', advertiserName: "L'Oréal", partnerName: 'Amazon Ads DSP', activation: { enabled: false } })
  })

  it('approval endpoints return 404 with the flag off', async () => {
    const res = await buildApp(await testContext({ flag: false })).inject({ method: 'GET', url: '/api/admin/v1/approvals' })
    expect(res.statusCode).toBe(404)
  })
})
