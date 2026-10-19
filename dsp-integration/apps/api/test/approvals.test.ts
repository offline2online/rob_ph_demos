import { randomUUID } from 'node:crypto'
import { runApprovalContract, runCampaignSourceContract } from '@ph-dsp/campaign-approval/contract'
import { describe, expect, it } from 'vitest'
import { buildApp } from '../src/http/app'
import { expectMatchesContract } from './contract'
import { NOW, testContext } from './helpers'

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

  it('un-reject reverses a mistaken rejection back to Awaiting approval', async () => {
    const app = buildApp(await testContext())
    const rejected = await app.inject({ method: 'POST', url: '/api/admin/v1/campaigns/c_api_swisse/reject', payload: { assetVersion: 'v1', reason: 'Price in artwork', reasonCode: 'price_or_offer_in_artwork' } })
    expect(rejected.statusCode).toBe(200)
    expectMatchesContract('POST', '/admin/v1/campaigns/{campaignId}/reject', 200, rejected.json())
    const stale = await app.inject({ method: 'POST', url: '/api/admin/v1/campaigns/c_api_swisse/unreject', payload: { assetVersion: 'v0' } })
    expect(stale.statusCode).toBe(409)
    const back = await app.inject({ method: 'POST', url: '/api/admin/v1/campaigns/c_api_swisse/unreject', payload: { assetVersion: 'v1', reason: 'Fat-fingered it' } })
    expect(back.statusCode).toBe(200)
    expectMatchesContract('POST', '/admin/v1/campaigns/{campaignId}/unreject', 200, back.json())
    expect(back.json()).toMatchObject({ status: 'awaiting_approval', reviewedBy: null, reason: null })
    expect(back.json().audit.map((a: { action: string }) => a.action)).toEqual(['submitted', 'rejected', 'unrejected'])
    /* Already back in Awaiting approval: un-reject again is a conflict, not a no-op. */
    const notRejected = await app.inject({ method: 'POST', url: '/api/admin/v1/campaigns/c_api_swisse/unreject', payload: { assetVersion: 'v1' } })
    expect(notRejected.statusCode).toBe(409)
    const user = buildApp(await testContext({ role: 'hq_marketing' }))
    const forbidden = await user.inject({ method: 'POST', url: '/api/admin/v1/campaigns/c_api_swisse/unreject', payload: { assetVersion: 'v1' } })
    expect(forbidden.statusCode).toBe(403)
  })

  it('the stand-in campaign list carries approval-free fields only', async () => {
    const res = await buildApp(await testContext()).inject({ method: 'GET', url: '/api/admin/v1/campaigns' })
    expectMatchesContract('GET', '/admin/v1/campaigns', 200, res.json())
    expect(res.json().items.find((c: { campaignId: string }) => c.campaignId === 'c_dsp_loreal')).toMatchObject({ source: 'dsp', advertiserName: "L'Oréal", partnerName: 'Amazon Ads DSP', activation: { enabled: false } })
  })

  it('reject needs a coded reason from the pick-list as well as the text', async () => {
    const app = buildApp(await testContext())
    const send = (payload: object) => app.inject({ method: 'POST', url: '/api/admin/v1/campaigns/c_api_swisse/reject', payload: { assetVersion: 'v1', reason: 'Price in artwork', ...payload } })
    for (const bad of [{}, { reasonCode: 'nope' }, { reasonCode: 'poor_quality', assetReasons: [{ assetId: 'default', reason: 'x', code: 'nope' }] }]) {
      const res = await send(bad)
      expect(res.statusCode).toBe(400)
      expectMatchesContract('POST', '/admin/v1/campaigns/{campaignId}/reject', 400, res.json())
    }
    const ok = await send({ reasonCode: 'poor_quality', assetReasons: [{ assetId: 'default', reason: 'Blurry', code: 'poor_quality' }] })
    expect(ok.statusCode).toBe(200)
    expectMatchesContract('POST', '/admin/v1/campaigns/{campaignId}/reject', 200, ok.json())
    expect(ok.json()).toMatchObject({ status: 'rejected', reasonCode: 'poor_quality' })
    const view = await app.inject({ method: 'GET', url: '/api/admin/v1/campaigns/c_api_swisse/approval' })
    expect(view.json().audit.at(-1)).toMatchObject({ action: 'rejected', reasonCode: 'poor_quality', assetReasons: [{ assetId: 'default', reason: 'Blurry', code: 'poor_quality' }] })
  })

  describe('approval summary (GET /admin/v1/approvals/summary)', () => {
    const HOUR = 3_600_000
    const setup = async (role?: 'hq_marketing' | 'hq_helpdesk') => {
      const ctx = await testContext({ role, clock: () => NOW })
      const app = buildApp(ctx)
      /* The seeded campaigns' own decisions are out of the way, so the figures are the test's alone. */
      ctx.db.prepare("DELETE FROM campaign_approval_audit WHERE action IN ('approved', 'rejected')").run()
      const insert = ctx.db.prepare('INSERT INTO campaign_approval_audit (id, campaign_id, asset_version, action, actor, reason, reason_code, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      /* Decisions on made-up campaigns, as many minutes after a submission at 10:00 on 20 Sep 2026 (the test clock). */
      const decide = (id: string, action: string, minutes: number, code: string | null = null) => {
        insert.run(randomUUID(), id, 'v1', 'submitted', null, null, null, new Date(NOW.getTime() - 5 * HOUR).toISOString())
        insert.run(randomUUID(), id, 'v1', action, action === 'auto_approved' ? null : 'HQ', null, code, new Date(NOW.getTime() - 5 * HOUR + minutes * 60_000).toISOString())
      }
      const summary = async () => (await app.inject({ method: 'GET', url: '/api/admin/v1/approvals/summary' }))
      return { ctx, app, decide, summary }
    }

    it('is empty with no decisions, and names the oldest campaign awaiting approval', async () => {
      const { summary } = await setup()
      const res = await summary()
      expect(res.statusCode).toBe(200)
      expectMatchesContract('GET', '/admin/v1/approvals/summary', 200, res.json())
      expect(res.json()).toMatchObject({ days: 30, decided: 0, rejected: 0, medianSecondsToDecision: null, rejectionRate: null, topRejectionReasons: [], oldestWaiting: { campaignId: 'c_api_swisse', campaignName: expect.any(String) } })
    })

    it('median is over manual decisions only: 1 h and 3 h make 2 h, and an automatic approval changes nothing', async () => {
      const { decide, summary } = await setup()
      decide('x1', 'approved', 60)
      decide('x2', 'approved', 180)
      expect((await summary()).json()).toMatchObject({ decided: 2, medianSecondsToDecision: 7200, rejectionRate: 0 })
      decide('x3', 'auto_approved', 0)
      decide('x3b', 'reused_clearance', 0)
      expect((await summary()).json()).toMatchObject({ decided: 2, medianSecondsToDecision: 7200 })
    })

    it('counts rejections by coded reason (old ones as Other) and gives the rate; only the top three', async () => {
      const { decide, summary } = await setup()
      decide('a', 'approved', 60)
      decide('b', 'approved', 180)
      decide('c', 'rejected', 20, 'poor_quality')
      decide('d', 'rejected', 20, 'poor_quality')
      decide('e', 'rejected', 20, null)
      decide('f', 'rejected', 20, 'price_or_offer_in_artwork')
      decide('g', 'rejected', 20, 'duration_too_long')
      const s = (await summary()).json()
      expect(s).toMatchObject({ decided: 7, rejected: 5, medianSecondsToDecision: 1200 })
      expect(s.rejectionRate).toBeCloseTo(5 / 7)
      expect(s.topRejectionReasons).toEqual([
        { code: 'poor_quality', label: 'Poor quality', count: 2 },
        { code: 'price_or_offer_in_artwork', label: 'Price or offer in artwork', count: 1 },
        { code: 'duration_too_long', label: 'Duration too long', count: 1 },
      ])
    })

    it('only looks back `days` days, and refuses a bad value', async () => {
      const { ctx, app, decide } = await setup()
      decide('old', 'rejected', 20, 'poor_quality')
      ctx.db.prepare("UPDATE campaign_approval_audit SET at = ? WHERE campaign_id = 'old'").run(new Date(NOW.getTime() - 40 * 24 * HOUR).toISOString())
      expect((await app.inject({ method: 'GET', url: '/api/admin/v1/approvals/summary' })).json().decided).toBe(0)
      expect((await app.inject({ method: 'GET', url: '/api/admin/v1/approvals/summary?days=60' })).json().decided).toBe(1)
      for (const days of ['0', 'x', '999']) expect((await app.inject({ method: 'GET', url: `/api/admin/v1/approvals/summary?days=${days}` })).statusCode).toBe(400)
    })

    it('Marketing (read-only) can read it; Help desk cannot', async () => {
      expect((await (await setup('hq_marketing')).summary()).statusCode).toBe(200)
      expect((await (await setup('hq_helpdesk')).summary()).statusCode).toBe(403)
    })
  })

  it('approval endpoints return 404 with the flag off', async () => {
    const res = await buildApp(await testContext({ flag: false })).inject({ method: 'GET', url: '/api/admin/v1/approvals' })
    expect(res.statusCode).toBe(404)
  })
})
