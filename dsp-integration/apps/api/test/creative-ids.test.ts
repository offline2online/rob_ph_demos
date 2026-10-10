/* Creative IDs (ticket IDGsyELBJsjlAYjizSqT): campaigns are approved one at a
   time and grouped under a creative ID — the grouping a DSP bids on. */
import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { buildApp } from '../src/http/app'
import { expectMatchesContract } from './contract'
import { NOW, testContext } from './helpers'

const G = { authorization: 'Bearer poc-token-google-dv360' }

/* Seeded: c_api_swisse is Awaiting approval, c_api_swisse_kids is a Draft
   (Swisse), c_dsp_loreal was Rejected (L'Oréal), c_dsp_nestle is Approved. */
async function setup(role?: 'hq_admin' | 'hq_marketing') {
  const ctx = await testContext({ clock: () => NOW, role })
  const app = buildApp(ctx)
  await ctx.approvals.submit('c_api_swisse_kids', [], 'Swisse')
  await ctx.approvals.unreject('c_dsp_loreal', 'v1', 'HQ Admin (POC)')
  const version = async (id: string) => (await ctx.approvals.view(id)).assetVersion
  const approve = async (ids: string[], creativeId?: string | null, versions: Record<string, string> = {}) =>
    app.inject({
      method: 'POST', url: '/api/admin/v1/approvals/approve-assign',
      payload: { items: await Promise.all(ids.map(async (id) => ({ campaignId: id, assetVersion: versions[id] ?? (await version(id)) }))), ...(creativeId !== undefined ? { creativeId } : {}) },
    })
  const view = async (id: string) => (await app.inject({ method: 'GET', url: `/api/admin/v1/campaigns/${id}/approval` })).json()
  const creativeIds = async (q = '') => {
    const res = await app.inject({ method: 'GET', url: `/api/admin/v1/creative-ids${q}` })
    expectMatchesContract('GET', '/admin/v1/creative-ids', 200, res.json())
    return res.json().items as { creativeId: string; advertiserId: string; campaigns: { campaignId: string; name: string; touchPoints: string[] }[] }[]
  }
  return { ctx, app, version, approve, view, creativeIds }
}

describe('Approve + assign to a creative ID', () => {
  it('mints one new ID across the ticked campaigns of one advertiser and approves them all', async () => {
    const { app, approve, view } = await setup()
    const res = await approve(['c_api_swisse', 'c_api_swisse_kids'])
    expect(res.statusCode).toBe(200)
    expectMatchesContract('POST', '/admin/v1/approvals/approve-assign', 200, res.json())
    const { creativeId, approvals } = res.json()
    expect(creativeId).toMatch(/^CR-[0-9A-F]{8}$/)
    expect(approvals.map((a: { status: string; creativeId: string; reviewedBy: string }) => [a.status, a.creativeId, a.reviewedBy])).toEqual([
      ['approved', creativeId, 'HQ Admin (POC)'], ['approved', creativeId, 'HQ Admin (POC)'],
    ])
    expect((await view('c_api_swisse')).creativeId).toBe(creativeId)
    /* Listed with its members, so the reviewer matches by sibling campaigns. */
    const list = (await app.inject({ method: 'GET', url: '/api/admin/v1/creative-ids?advertiserId=swisse' })).json().items
    expect(list).toHaveLength(1)
    expect(list[0].campaigns.map((c: { campaignId: string }) => c.campaignId).sort()).toEqual(['c_api_swisse', 'c_api_swisse_kids'])
    expect(list[0].campaigns[0]).toMatchObject({ name: expect.any(String), touchPoints: expect.any(Array) })
  })

  it('refuses a selection that spans advertisers, approving none of it', async () => {
    const { approve, view } = await setup()
    const res = await approve(['c_api_swisse', 'c_dsp_loreal'])
    expect(res.statusCode).toBe(400)
    expectMatchesContract('POST', '/admin/v1/approvals/approve-assign', 400, res.json())
    expect(res.json().error.message).toMatch(/one advertiser/)
    expect((await view('c_api_swisse')).status).toBe('awaiting_approval')
    expect((await view('c_dsp_loreal')).status).toBe('awaiting_approval')
  })

  it('joins an existing ID of the same advertiser, and only that advertiser', async () => {
    const { approve, view, creativeIds } = await setup()
    const first = (await approve(['c_api_swisse'])).json().creativeId as string
    const kids = await approve(['c_api_swisse_kids'], first)
    expect(kids.statusCode).toBe(200)
    expect(kids.json().creativeId).toBe(first)
    expect((await view('c_api_swisse_kids')).creativeId).toBe(first)
    expect((await creativeIds()).map((g) => g.campaigns.length)).toEqual([2])
    /* A creative ID never spans advertisers. */
    expect((await approve(['c_dsp_loreal'], first)).statusCode).toBe(400)
    expect((await view('c_dsp_loreal')).status).toBe('awaiting_approval')
    expect((await approve(['c_dsp_loreal'], 'CR-NOPE')).statusCode).toBe(404)
  })

  it('is all or nothing: a stale version or a campaign not awaiting approval approves none', async () => {
    const { approve, view } = await setup()
    const stale = await approve(['c_api_swisse', 'c_api_swisse_kids'], undefined, { c_api_swisse_kids: 'v99' })
    expect(stale.statusCode).toBe(409)
    expect((await view('c_api_swisse')).status).toBe('awaiting_approval')
    expect((await view('c_api_swisse')).creativeId ?? null).toBeNull()
    /* c_dsp_nestle is already approved. */
    expect((await approve(['c_dsp_nestle'])).statusCode).toBe(409)
    /* An HQ campaign has no creative ID. */
    expect((await approve(['c_zinger'])).statusCode).toBe(400)
    expect((await approve([])).statusCode).toBe(400)
  })

  it('is for HQ Admin only', async () => {
    const { approve, view } = await setup('hq_marketing')
    expect((await approve(['c_api_swisse'])).statusCode).toBe(403)
    expect((await view('c_api_swisse')).status).toBe('awaiting_approval')
  })

  it('tells the advertiser the creative ID on the campaign status, and nothing before then', async () => {
    const { app, approve } = await setup()
    const status = async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/campaigns/c_api_swisse/status', headers: G })
      expectMatchesContract('GET', '/v1/campaigns/{campaignId}/status', 200, res.json())
      return res.json()
    }
    expect(await status()).toMatchObject({ status: 'awaiting_approval', creativeId: null })
    const { creativeId } = (await approve(['c_api_swisse'])).json()
    expect(await status()).toMatchObject({ status: 'approved', creativeId })
  })

  it('keeps the creative ID when an approved creative is updated and resubmitted', async () => {
    const { ctx, approve, view } = await setup()
    const { creativeId } = (await approve(['c_api_swisse'])).json()
    ctx.db.prepare("INSERT INTO campaign_assets (id, campaign_id, version, role, file, mime_type, width, height, size_bytes, created_at) VALUES (?, 'c_api_swisse', 2, 'default', 'x.png', 'image/png', 1080, 1920, 1, ?)")
      .run(randomUUID(), NOW.toISOString())
    await ctx.approvals.changed('c_api_swisse', 'Swisse')
    const resubmitted = await view('c_api_swisse')
    expect(resubmitted).toMatchObject({ status: 'awaiting_approval', pendingEdit: true, creativeId })
    /* Approving into the same ID is the resubmission case: no new ID is made. */
    const again = await approve(['c_api_swisse'], creativeId)
    expect(again.json().creativeId).toBe(creativeId)
    expect(await view('c_api_swisse')).toMatchObject({ status: 'approved', creativeId, pendingEdit: false })
  })
})

/* Auto-approved advertisers (ticket XnN1Kwl39F8C8DrOkwQn): submission is the
   approval, so the advertiser groups its own approved campaigns. Seeded:
   Nestlé does not require approval (c_dsp_nestle is Approved), Swisse does. */
describe('Assign a creative ID for an auto-approved advertiser', () => {
  const assign = (app: Awaited<ReturnType<typeof setup>>['app'], campaignIds: string[], creativeId?: string | null) =>
    app.inject({ method: 'POST', url: '/api/admin/v1/approvals/assign-creative-id', payload: { campaignIds, ...(creativeId !== undefined ? { creativeId } : {}) } })

  it('mints a new ID, then a second campaign joins it from the existing-ID list', async () => {
    const { app, view, creativeIds } = await setup()
    const res = await assign(app, ['c_dsp_nestle'])
    expect(res.statusCode).toBe(200)
    expectMatchesContract('POST', '/admin/v1/approvals/assign-creative-id', 200, res.json())
    const { creativeId } = res.json()
    expect(creativeId).toMatch(/^CR-[0-9A-F]{8}$/)
    expect(await view('c_dsp_nestle')).toMatchObject({ status: 'approved', mode: 'auto', creativeId })
    expect((await creativeIds('?advertiserId=nestle'))[0]).toMatchObject({ creativeId, campaigns: [{ campaignId: 'c_dsp_nestle' }] })
    const again = await assign(app, ['c_dsp_nestle'], creativeId)
    expect(again.json().creativeId).toBe(creativeId)
  })

  it('refuses an advertiser whose campaigns the retailer approves, a campaign not yet approved, and an unknown or foreign ID', async () => {
    const { app, approve } = await setup()
    await approve(['c_api_swisse'])
    const swisse = await assign(app, ['c_api_swisse'])
    expect(swisse.statusCode).toBe(400)
    expectMatchesContract('POST', '/admin/v1/approvals/assign-creative-id', 400, swisse.json())
    expect(swisse.json().error.message).toMatch(/retailer/)
    expect((await assign(app, ['c_dsp_nestle'], 'CR-NOPE0000')).statusCode).toBe(404)
    const { creativeId } = (await approve(['c_api_swisse_kids'])).json()
    const foreign = await assign(app, ['c_dsp_nestle'], creativeId)
    expect(foreign.statusCode).toBe(400)
    expect(foreign.json().error.message).toMatch(/different advertiser/)
    expect((await assign(app, [])).statusCode).toBe(400)
  })
})

/* The private-auction (deal ID) flow — REQUIREMENTS §3 "The two approval
   flows", cases B1–B9. They need `dealId` on the campaign, which lands with
   ticket DLhjuhbTqJS2uAvhh0I8; whichever ticket adds the field turns each
   into an assertion. Named here so the suite lists them. */
describe('Private auction (deal ID) flow', () => {
  it.todo('B1 carries the advertiser-set deal ID through submission onto the campaign status')
  it.todo('B2 approves a subset of a deal into a new creative ID, leaving the rest awaiting approval')
  it.todo('B3 a later round adds a second creative ID (new or existing) to the same deal')
  it.todo('B4 refuses a selection that mixes deals, or deal and non-deal campaigns, approving none')
  it.todo('B5 lists only the same deal\'s creative IDs for a deal campaign')
  it.todo('B6 rejects one campaign with a reason and approves the rest of the deal')
  it.todo('B7 re-attaches a rejected-then-fixed campaign to the SAME creative ID, minting none')
  it.todo('B8 pre-highlights nothing when the deal has several IDs and the anchor is ambiguous')
  it.todo('B9 keeps its own creative ID when an approved deal campaign is edited and resubmitted')
})

/* Direct flow A5: a rejected campaign carries the reason and, never having
   been approved, has no creative ID; HQ then approves the fixed one afresh. */
describe('Direct flow: reject then fix', () => {
  it('a rejected campaign has no creative ID and can be approved after resubmission', async () => {
    const { ctx, app, approve, view, version } = await setup()
    await ctx.approvals.reject('c_api_swisse', await version('c_api_swisse'), 'HQ Admin (POC)', 'Price in artwork')
    const rejected = await app.inject({ method: 'GET', url: '/api/v1/campaigns/c_api_swisse/status', headers: G })
    expect(rejected.json()).toMatchObject({ status: 'rejected', reason: 'Price in artwork', creativeId: null })
    await ctx.approvals.unreject('c_api_swisse', 'v1', 'HQ Admin (POC)')
    const res = await approve(['c_api_swisse'])
    expect(res.statusCode).toBe(200)
    expect((await view('c_api_swisse')).creativeId).toBe(res.json().creativeId)
  })
})
