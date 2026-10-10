/* Run 8 — the AWS demo (10 Dec 2026): the two ways demand reaches a
   retailer, end to end, against the per-campaign approval and creative ID
   spec (REQUIREMENTS.md §3 "Creative IDs"; tickets IDGsyELBJsjlAYjizSqT,
   XnN1Kwl39F8C8DrOkwQn, ZHPV0Lj5N883RKGfYThw). Walkthrough for a person:
   docs/dsp-integration/AWS-DEMO-TEST-FLOW.md — each case here is a step in
   it. Nothing reaches the network (harness.ts). */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { runAuction } from '../../src/exchange/auction'
import { png } from '../media'
import { day, harness } from './harness'

afterEach(() => {
  vi.unstubAllGlobals()
})

type H = Awaited<ReturnType<typeof harness>>

const approveAssign = async (h: H, ids: string[], creativeId?: string | null) =>
  h.app.inject({
    method: 'POST', url: '/api/admin/v1/approvals/approve-assign',
    payload: {
      items: await Promise.all(ids.map(async (id) => ({ campaignId: id, assetVersion: (await h.ctx.approvals.view(id)).assetVersion }))),
      ...(creativeId !== undefined ? { creativeId } : {}),
    },
  })
const creativeIds = async (h: H, advertiserId: string) =>
  (await h.app.inject({ method: 'GET', url: `/api/admin/v1/creative-ids?advertiserId=${advertiserId}` })).json().items as { creativeId: string; campaigns: { campaignId: string; touchPoints: string[] }[] }[]

describe('Run 8 — direct advertiser flow (Partner API → retailer approval → creative ID)', () => {
  it('D1 — two submissions wait with no creative ID; the retailer approves them into one new creative ID', async () => {
    const h = await harness()
    const a = await h.submitApiCampaign('Swisse — R8 D1 a')
    const b = await h.submitApiCampaign('Swisse — R8 D1 b')
    for (const { id } of [a, b]) expect((await h.partner.status(id)).json()).toMatchObject({ status: 'awaiting_approval', creativeId: null })

    const res = await approveAssign(h, [a.id, b.id])
    expect(res.statusCode).toBe(200)
    const { creativeId } = res.json()
    expect(creativeId).toMatch(/^CR-[0-9A-F]{8}$/)
    for (const { id } of [a, b]) expect((await h.partner.status(id)).json()).toMatchObject({ status: 'approved', creativeId })
    const [group] = await creativeIds(h, 'swisse')
    expect(group.campaigns.map((c) => c.campaignId).sort()).toEqual([a.id, b.id].sort())
  })

  it('D2 — a selection spanning two advertisers is refused whole; nothing is approved', async () => {
    const h = await harness()
    const swisse = await h.submitApiCampaign('Swisse — R8 D2')
    const other = await h.submitApiCampaign('Nestlé — R8 D2', 'localised', 'nestle', { authorization: 'Bearer e2e-token-amazon' }).catch(() => null)
    /* Without a second advertiser on the fixture the seeded L'Oréal campaign stands in. */
    const second = other?.id ?? 'c_dsp_loreal'
    if (second === 'c_dsp_loreal') await h.ctx.approvals.unreject('c_dsp_loreal', 'v1', 'HQ Admin (POC)')
    const res = await approveAssign(h, [swisse.id, second])
    expect(res.statusCode).toBe(400)
    expect(res.json().error.message).toMatch(/one advertiser/)
    expect((await h.partner.status(swisse.id)).json().status).toBe('awaiting_approval')
  })

  it('D3 — a rejection carries the reason back to the advertiser; the fixed creative is resubmitted and joins an existing creative ID', async () => {
    const h = await harness()
    const a = await h.submitApiCampaign('Swisse — R8 D3 a')
    const b = await h.submitApiCampaign('Swisse — R8 D3 b')
    const { creativeId } = (await approveAssign(h, [a.id])).json()

    expect((await h.admin.reject(b.id, 'Price shown in the artwork.')).statusCode).toBe(200)
    expect((await h.partner.status(b.id)).json()).toMatchObject({ status: 'rejected', reason: 'Price shown in the artwork.', creativeId: null })

    /* The advertiser fixes it: a new version, then submit again. */
    expect((await h.partner.upload(b.id, 'default', png(1920, 1080))).statusCode).toBeLessThan(300)
    expect((await h.partner.submit(b.id)).json().status).toBe('awaiting_approval')
    expect((await approveAssign(h, [b.id], creativeId)).json().creativeId).toBe(creativeId)
    expect((await h.partner.status(b.id)).json()).toMatchObject({ status: 'approved', creativeId })
    const [group] = await creativeIds(h, 'swisse')
    expect(group.campaigns).toHaveLength(2)
  })

  it('D4 — updating an approved creative is a pending edit that keeps its creative ID; the approved version keeps running', async () => {
    const h = await harness()
    const { id } = await h.submitApiCampaign('Swisse — R8 D4')
    const { creativeId } = (await approveAssign(h, [id])).json()
    await h.admin.activate(id)

    /* Different bytes: an identical re-upload is safe reuse and is approved without review (Q40). */
    expect((await h.partner.upload(id, 'default', png(1920, 1080, 7))).statusCode).toBeLessThan(300)
    expect((await h.partner.status(id)).json()).toMatchObject({ status: 'awaiting_approval', pendingEdit: true, creativeId })
    expect(await h.ctx.approvals.view(id)).toMatchObject({ pendingEdit: true, creativeId })

    expect((await approveAssign(h, [id], creativeId)).json().creativeId).toBe(creativeId)
    expect((await h.partner.status(id)).json()).toMatchObject({ status: 'approved', pendingEdit: false, creativeId })
  })

  it('D5 — an advertiser that does not require approval is approved on submission and groups its own campaigns', async () => {
    const h = await harness()
    const kept: [string, Awaited<ReturnType<typeof h.ctx.company.advertiserSetting>>][] = []
    for (const k of ['nestle', 'l-oreal']) kept.push([k, await h.ctx.company.advertiserSetting(k)])
    await h.ctx.company.saveAdvertiserSettings({ ...Object.fromEntries(kept), swisse: { approvalRequired: false, floorMultiplier: 1 } })
    const a = await h.submitApiCampaign('Swisse — R8 D5 a')
    const b = await h.submitApiCampaign('Swisse — R8 D5 b')
    expect(a.submitted.json().status).toBe('approved')

    /* The retailer's approval path does not apply to it … */
    expect((await approveAssign(h, [a.id])).statusCode).toBe(409)
    /* … the advertiser's own table assigns the ID. */
    const assign = (ids: string[], creativeId?: string) =>
      h.app.inject({ method: 'POST', url: '/api/admin/v1/approvals/assign-creative-id', payload: { campaignIds: ids, ...(creativeId ? { creativeId } : {}) } })
    const minted = await assign([a.id])
    expect(minted.statusCode).toBe(200)
    const { creativeId } = minted.json()
    expect((await assign([b.id], creativeId)).json().creativeId).toBe(creativeId)
    expect((await h.partner.status(b.id)).json()).toMatchObject({ status: 'approved', creativeId })
  })

  it('D6 — an approved, activated campaign bids and is booked for the window', async () => {
    const h = await harness()
    const { id } = await h.submitApiCampaign('Swisse — R8 D6')
    expect((await h.partner.bid(id, day(1), 200)).json().error.code).toBe('not_approved')
    await approveAssign(h, [id])
    await h.admin.activate(id)
    expect((await h.partner.bid(id, day(1), 200)).statusCode).toBeLessThan(300)
  })
})

describe('Run 8 — DSP flow (bid with a new creative → queued → approved into a creative ID → wins)', () => {
  it('S1 — a new creative on a bid is queued, discarded for that window, approved into a creative ID, then wins the next', async () => {
    const h = await harness()
    await h.bidder.control({ mode: 'bid', priceCpm: 150, advertiserId: '5130002', crid: 'crid-r8-s1' })
    expect((await runAuction(h.ctx, day(0))).positions[0].winner).toBeNull()
    const id = (await h.queuedCampaign('crid-r8-s1'))!
    expect(await h.ctx.approvals.view(id)).toMatchObject({ status: 'awaiting_approval' })

    const res = await approveAssign(h, [id])
    expect(res.statusCode).toBe(200)
    const { creativeId } = res.json()
    await h.admin.activate(id)
    expect(await h.ctx.approvals.view(id)).toMatchObject({ status: 'approved', creativeId })

    await runAuction(h.ctx, day(1))
    expect(await h.rows(day(1))).toMatchObject([{ campaignId: id, status: 'won' }])
  })

  it('S2 — a second creative from the same advertiser joins the first one’s creative ID', async () => {
    const h = await harness()
    const queue = async (crid: string, w: Date) => {
      await h.bidder.control({ mode: 'bid', priceCpm: 150, advertiserId: '5130002', crid })
      await runAuction(h.ctx, w)
      return (await h.queuedCampaign(crid))!
    }
    const first = await queue('crid-r8-s2a', day(0))
    const { creativeId } = (await approveAssign(h, [first])).json()
    const second = await queue('crid-r8-s2b', day(1))
    const joined = await approveAssign(h, [second], creativeId)
    expect(joined.statusCode).toBe(200)
    expect(joined.json().creativeId).toBe(creativeId)
    const groups = await creativeIds(h, 'swisse')
    expect(groups).toHaveLength(1)
    expect(groups[0].campaigns.map((c) => c.campaignId).sort()).toEqual([first, second].sort())
  })

  it('S3 — a DSP creative the retailer rejects stays out of the auction, with the reason', async () => {
    const h = await harness()
    await h.bidder.control({ mode: 'bid', priceCpm: 150, advertiserId: '5130002', crid: 'crid-r8-s3' })
    await runAuction(h.ctx, day(0))
    const id = (await h.queuedCampaign('crid-r8-s3'))!
    expect((await h.admin.reject(id, 'Brand mismatch.')).statusCode).toBe(200)
    expect(await h.ctx.approvals.view(id)).toMatchObject({ status: 'rejected', reason: 'Brand mismatch.' })
    await runAuction(h.ctx, day(1))
    expect((await h.rows(day(1)))[0]).not.toMatchObject({ status: 'won' })
  })
})
