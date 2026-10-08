import { createHash } from 'node:crypto'
/* Q38 and Q40 (decisions, Rob, 29 Sep 2026).

   Q38: the previously approved version keeps running throughout re-review.
   An edit to an approved campaign is a pending edit, Awaiting approval,
   while the approved version stays live — it still bids, wins and hands off
   its approved creative. Approving the edit swaps to it in one step (no
   dark window, no double run); rejecting it discards it and the approved
   version carries on.

   Q40: a DSP's own creative audit is an advisory input, never a
   replacement for the retailer's approval; and a creative a human already
   cleared — same DSP creative ID, byte-identical content — is not
   re-audited. */
import { describe, expect, it } from 'vitest'
import { runAuction } from '../src/exchange/auction'
import { campaignForCrid, creativeCampaignId, queueCreative, verifiedCampaign } from '../src/exchange/creatives'
import { checkCampaign } from '../src/exchange/enforcement'
import { handOff } from '../src/exchange/handoff'
import { findPosition } from '../src/domain/positions'
import { buildApp } from '../src/http/app'
import type { ReservationRecord } from '../src/repos/ReservationRepo'
import { expectMatchesContract } from './contract'
import type { Fetch } from '../src/dsp/DspClient'
import { NOW, mockDsps, testContext } from './helpers'
import { multipart, png } from './media'

const G = { authorization: 'Bearer poc-token-google-dv360' }
const W1 = new Date('2026-09-21T00:00:00.000Z')
const day = (n: number) => new Date(W1.getTime() + n * 86_400_000).toISOString()
/* Two different, equally valid Menu Board creatives. */
const A = png(5760, 1080, 1)
const B = png(5760, 1080, 2)

async function setup(dspFetch?: Fetch) {
  const mocks = mockDsps()
  const ctx = await testContext({ byWindow: true, clock: () => NOW, dspFetch: dspFetch ?? mocks.fetchImpl })
  const app = buildApp(ctx)
  const upload = async (id: string, bytes: Buffer, version = 'default') => {
    const m = multipart({ version }, { name: 'menu.png', bytes })
    return app.inject({ method: 'POST', url: `/api/v1/campaigns/${id}/assets`, headers: { ...G, ...m.headers }, payload: m.payload })
  }
  const status = async (id: string) => {
    const res = await app.inject({ method: 'GET', url: `/api/v1/campaigns/${id}/status`, headers: G })
    expectMatchesContract('GET', '/v1/campaigns/{campaignId}/status', 200, res.json())
    return res.json()
  }
  const approve = (id: string, assetVersion: string) => app.inject({ method: 'POST', url: `/api/admin/v1/campaigns/${id}/approve`, payload: { assetVersion } })
  const reject = (id: string, assetVersion: string, reason: string) => app.inject({ method: 'POST', url: `/api/admin/v1/campaigns/${id}/reject`, payload: { assetVersion, reason } })
  const activate = (id: string) => app.inject({ method: 'PUT', url: `/api/admin/v1/campaigns/${id}/activation`, payload: { enabled: true } })
  /* A Swisse (approval required) Menu Board campaign, approved at v1 with A and switched on. */
  const running = async () => {
    const id = (await app.inject({ method: 'POST', url: '/api/v1/campaigns', headers: G, payload: { advertiserId: 'swisse', name: 'Swisse — Menu', displayTypeId: 'menu_board', default: { pricingType: 'localised' } } })).json().campaignId as string
    await upload(id, A)
    await app.inject({ method: 'POST', url: `/api/v1/campaigns/${id}/submit`, headers: G })
    expect((await approve(id, 'v1')).statusCode).toBe(200)
    expect((await activate(id)).statusCode).toBe(200)
    return id
  }
  const won = async (campaignId: string, windowStart: string): Promise<ReservationRecord> => ctx.reservations.insert({
    id: `res_t_${Math.random().toString(16).slice(2, 8)}`, partnerId: 'p_google', advertiserId: 'swisse', campaignId, positionId: 'menu_board.s2',
    windowStart, type: 'bid', channel: 'api', bidCpm: 150, currency: 'AUD', status: 'won', clearingCpm: 150, reason: null,
    testMode: false, pricingType: 'localised', handedOffAt: null,
  })
  /* Which campaign_assets version was handed off for a window. */
  /* The booking carries the approval string it was handed (eeBT1Qp3). */
  const handedOff = async (id: string, windowStart: string) => (await ctx.campaigns.bookings(id)).find((b) => b.windowStart === windowStart)?.assetVersion
  return { ctx, app, mocks, upload, status, approve, reject, activate, running, won, handedOff }
}

describe('re-approval: the approved version keeps running (Q38)', () => {
  it('(a) during re-review the approved version still bids, wins the auction and hands off its approved creative', async () => {
    const { ctx, app, upload, status, running, handedOff } = await setup()
    const id = await running()
    expect((await upload(id, B)).statusCode).toBe(201)
    expect(await status(id)).toMatchObject({ status: 'awaiting_approval', assetVersion: 'v2', liveAssetVersion: 'v1', pendingEdit: true })
    /* Still switched on, still eligible: nothing stops it. */
    expect((await ctx.campaigns.getCampaign(id))!.activation.enabled).toBe(true)
    expect(await checkCampaign(ctx, id)).toBeNull()
    const bid = await app.inject({ method: 'POST', url: '/api/v1/reservations', headers: G, payload: { positionId: 'menu_board.s2', windowStart: W1.toISOString(), campaignId: id, advertiserId: 'swisse', type: 'bid', bidCpm: 150 } })
    expect(bid.statusCode).toBe(201)
    const result = await runAuction(ctx, W1)
    expect(result.positions.find((p) => p.positionId === 'menu_board.s2')!.winner).toMatchObject({ reservationId: bid.json().reservationId, clearingCpm: 150 })
    /* The approved creative (v1, A) is what the campaign system plays — not the edit under review. */
    expect(await handedOff(id, W1.toISOString())).toBe('v1')
  })

  it('(b) approving the edit swaps atomically: the new creative hands off from then on, the old one never again', async () => {
    const { ctx, upload, approve, running, won, handedOff } = await setup()
    const id = await running()
    await upload(id, B)
    await handOff(ctx, await won(id, day(2)))
    expect(await handedOff(id, day(2))).toBe('v1')
    expect((await approve(id, 'v2')).json()).toMatchObject({ status: 'approved', assetVersion: 'v2', liveAssetVersion: 'v2', pendingEdit: false })
    /* No dark window: eligible straight through the swap, and still switched on. */
    expect(await checkCampaign(ctx, id)).toBeNull()
    for (const n of [3, 4]) {
      await handOff(ctx, await won(id, day(n)))
      expect(await handedOff(id, day(n))).toBe('v2')
    }
    /* Never both: one booking per window, each naming exactly one version. */
    expect((await ctx.campaigns.bookings(id)).map((b) => [b.windowStart, b.assetVersion])).toEqual([[day(2), 'v1'], [day(3), 'v2'], [day(4), 'v2']])
    expect((await ctx.campaigns.latestAssets(id, 'v1')).map((a) => a.contentHash)).not.toEqual((await ctx.campaigns.latestAssets(id, 'v2')).map((a) => a.contentHash))
  })

  it('(c) rejecting the edit discards it; the approved version carries on unaffected, and the audit trail keeps it', async () => {
    const { ctx, app, upload, status, reject, running, won, handedOff } = await setup()
    const id = await running()
    await upload(id, B)
    const res = await reject(id, 'v2', 'Price in the artwork.')
    expect(res.statusCode).toBe(200)
    expectMatchesContract('POST', '/admin/v1/campaigns/{campaignId}/reject', 200, res.json())
    expect(await status(id)).toMatchObject({ status: 'approved', assetVersion: 'v1', liveAssetVersion: 'v1', pendingEdit: false, reason: null, rejectedEdit: { assetVersion: 'v2', reason: 'Price in the artwork.' } })
    expect((await ctx.campaigns.getCampaign(id))!.activation.enabled).toBe(true)
    await handOff(ctx, await won(id, day(2)))
    expect(await handedOff(id, day(2))).toBe('v1')
    const audit = (await app.inject({ method: 'GET', url: `/api/admin/v1/campaigns/${id}/approval` })).json().audit.map((a: { action: string; assetVersion: string; reason: string | null }) => [a.action, a.assetVersion, a.reason])
    expect(audit).toEqual([['submitted', 'v1', null], ['approved', 'v1', null], ['returned_for_review', 'v2', null], ['rejected', 'v2', 'Price in the artwork.'], ['edit_discarded', 'v2', null]])
    /* A rejected Draft is swept after 30 days; a running campaign whose edit was rejected is not Rejected at all. */
    expect((await app.inject({ method: 'GET', url: '/api/admin/v1/approvals?status=rejected' })).json().items.map((a: { campaignId: string }) => a.campaignId)).not.toContain(id)
    /* The next edit builds on v1 again, under a version number never used before. */
    await upload(id, B)
    expect(await status(id)).toMatchObject({ status: 'awaiting_approval', assetVersion: 'v3', liveAssetVersion: 'v1', pendingEdit: true })
    expect((await status(id)).rejectedEdit).toBeUndefined()
  })

  it('a first submission is unchanged: nothing runs until it is approved, and a rejection is a plain rejection', async () => {
    const { ctx, app, upload, status, reject } = await setup()
    const id = (await app.inject({ method: 'POST', url: '/api/v1/campaigns', headers: G, payload: { advertiserId: 'swisse', name: 'Swisse — Menu', displayTypeId: 'menu_board', default: { pricingType: 'localised' } } })).json().campaignId
    await upload(id, A)
    await app.inject({ method: 'POST', url: `/api/v1/campaigns/${id}/submit`, headers: G })
    expect(await status(id)).toMatchObject({ status: 'awaiting_approval', liveAssetVersion: null, pendingEdit: false })
    expect(await checkCampaign(ctx, id)).toMatchObject({ code: 'not_approved' })
    await reject(id, 'v1', 'Price in the artwork.')
    expect(await status(id)).toMatchObject({ status: 'rejected', reason: 'Price in the artwork.', liveAssetVersion: null })
  })
})

describe('safe reuse wired into upload/submit (Q40, content-hash identity)', () => {
  it('re-uploading byte-identical files a reviewer approved is not re-reviewed', async () => {
    const { app, upload, status, running } = await setup()
    const id = await running()
    await upload(id, A)
    expect(await status(id)).toMatchObject({ status: 'approved', mode: 'auto', assetVersion: 'v2', liveAssetVersion: 'v2', pendingEdit: false })
    const audit = (await app.inject({ method: 'GET', url: `/api/admin/v1/campaigns/${id}/approval` })).json()
    expect(audit.audit.map((a: { action: string }) => a.action)).toEqual(['submitted', 'approved', 'returned_for_review', 'reused_clearance'])
    expect(audit.checks).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'previously_cleared', assetId: 'default', advisory: true })]))
  })

  it('changed bytes still go to a reviewer, even after an identical file was reused', async () => {
    const { upload, status, running } = await setup()
    const id = await running()
    await upload(id, A)
    await upload(id, B)
    expect(await status(id)).toMatchObject({ status: 'awaiting_approval', pendingEdit: true })
  })

  it('an auto-approved version (advertiser without approval) clears nothing for later reuse', async () => {
    const { app, ctx, upload } = await setup()
    const id = (await app.inject({ method: 'POST', url: '/api/v1/campaigns', headers: G, payload: { advertiserId: 'nestle', name: 'Nestlé — Menu', displayTypeId: 'menu_board', default: { pricingType: 'localised' } } })).json().campaignId
    await upload(id, A)
    await app.inject({ method: 'POST', url: `/api/v1/campaigns/${id}/submit`, headers: G })
    expect(await ctx.approvals.wasAssetHumanCleared(id, 'default', (await ctx.campaigns.latestAssets(id))[0].contentHash!)).toBe(false)
  })
})

describe('DSP creative audits: advisory input, pre-approval by creative ID + content hash (Q40, content-hash identity)', () => {
  /* The DSP's creative host serves whatever bytes the test says, per crid. */
  const served = new Map<string, Buffer>()
  const dspFetch = async (url: string) => {
    const bytes = served.get(new URL(url).pathname.split('/').pop()!)
    return bytes ? new Response(new Uint8Array(bytes), { status: 200, headers: { 'content-type': 'image/png' } }) : new Response('', { status: 404 })
  }
  const iurl = (crid: string) => `http://mocks.test/dv360/creatives/${crid}`
  const DV360_APPROVED = { reviewStatus: { approvalStatus: 'APPROVAL_STATUS_APPROVED_SERVABLE', exchangeReviewStatuses: [{ exchange: 'EXCHANGE_PH', status: 'REVIEW_STATUS_APPROVED' }] } }

  it('(a) a creative the DSP itself approved still waits for the retailer, its audit recorded as advisory', async () => {
    const { ctx } = await setup(dspFetch)
    served.set('crid-a', A)
    const p = (await findPosition(ctx, 'menu_board.s2'))!
    const why = await queueCreative(ctx, (await ctx.partners.get('p_google'))!, { crid: 'crid-a', iurl: iurl('crid-a'), ext: { creativeAudit: DV360_APPROVED } }, { id: 'swisse', name: 'Swisse' }, p)
    expect(why).toBe('New creative crid-a: queued for approval.')
    const id = (await campaignForCrid(ctx, 'p_google', 'crid-a'))!
    expect(id).toBe(creativeCampaignId('swisse', createHash('sha256').update(A).digest('hex')))
    const view = await ctx.approvals.view(id)
    expect(view.status).toBe('awaiting_approval')
    expect(view.checks.find((c) => c.name === 'dsp_audit')).toMatchObject({ passed: true, advisory: true, detail: expect.stringMatching(/^Display & Video 360’s own creative audit: approved\. Advisory/) })
    expect(await checkCampaign(ctx, id)).toMatchObject({ code: 'not_approved' })
  })

  it('a DSP rejection neither blocks nor decides: the retailer’s setting and review still do', async () => {
    const { ctx } = await setup(dspFetch)
    served.set('crid-r', A)
    const p = (await findPosition(ctx, 'menu_board.s2'))!
    /* Amazon's asset-level moderation said no; Swisse requires approval, so it goes to the reviewer with that note. */
    await queueCreative(ctx, (await ctx.partners.get('p_amazon'))!, { crid: 'crid-r', iurl: 'http://mocks.test/amazon/creatives/crid-r', ext: { creativeAudit: { moderationStatus: 'REJECTED', policyViolations: [{ reason: 'Alcohol' }] } } }, { id: 'swisse', name: 'Swisse' }, p)
    const view = await ctx.approvals.view((await campaignForCrid(ctx, 'p_amazon', 'crid-r'))!)
    expect(view.status).toBe('awaiting_approval')
    expect(view.checks.find((c) => c.name === 'dsp_audit')).toMatchObject({ passed: false, advisory: true, detail: expect.stringContaining('rejected (Alcohol)') })
  })

  it('(b) identity is the content hash: a rotated crid on identical bytes is not re-audited; a reused crid on different bytes is', async () => {
    const { ctx, approve } = await setup(dspFetch)
    served.set('crid-b', A)
    const p = (await findPosition(ctx, 'menu_board.s2'))!
    const google = (await ctx.partners.get('p_google'))!
    const retrieve = (crid: string) => queueCreative(ctx, google, { crid, iurl: iurl(crid) }, { id: 'swisse', name: 'Swisse' }, p)
    await retrieve('crid-b')
    const id = (await campaignForCrid(ctx, 'p_google', 'crid-b'))!
    expect((await approve(id, 'v1')).json()).toMatchObject({ status: 'approved', mode: 'manual' })
    /* The DSP rotates the crid onto the same bytes: one creative, already approved, nothing new to review. */
    served.set('crid-b2', A)
    expect(await retrieve('crid-b2')).toBe(`Creative crid-b2 is identical to creative ${id}, already approved; it can compete from the next window.`)
    expect(await campaignForCrid(ctx, 'p_google', 'crid-b2')).toBe(id)
    expect(await ctx.approvals.view(id)).toMatchObject({ status: 'approved', liveAssetVersion: 'v1', pendingEdit: false })
    /* The old crid is reused for different bytes: a different creative, queued for its own review. */
    served.set('crid-b', B)
    expect(await retrieve('crid-b')).toBe('New creative crid-b: queued for approval.')
    const other = (await campaignForCrid(ctx, 'p_google', 'crid-b'))!
    expect(other).not.toBe(id)
    expect(await ctx.approvals.view(other)).toMatchObject({ status: 'awaiting_approval' })
    expect(await ctx.approvals.view(id)).toMatchObject({ status: 'approved' })
  })

  it('the same bytes through two DSPs resolve to one creative, approved once', async () => {
    const { ctx, approve } = await setup(dspFetch)
    served.set('dv-1', A)
    served.set('ttd-9', A)
    const p = (await findPosition(ctx, 'menu_board.s2'))!
    const adv = { id: 'swisse', name: 'Swisse' }
    await queueCreative(ctx, (await ctx.partners.get('p_google'))!, { crid: 'dv-1', iurl: iurl('dv-1') }, adv, p)
    const id = (await campaignForCrid(ctx, 'p_google', 'dv-1'))!
    expect((await approve(id, 'v1')).json()).toMatchObject({ status: 'approved' })
    const ttd = (await ctx.partners.get('p_amazon'))!
    await queueCreative(ctx, ttd, { crid: 'ttd-9', iurl: 'http://mocks.test/amazon/creatives/ttd-9' }, adv, p)
    expect(await campaignForCrid(ctx, 'p_amazon', 'ttd-9')).toBe(id)
  })

  it('a crid is trusted only while its fetch-and-hash is fresh and its URL unchanged', async () => {
    const { ctx } = await setup(dspFetch)
    served.set('crid-f', A)
    const p = (await findPosition(ctx, 'menu_board.s2'))!
    await queueCreative(ctx, (await ctx.partners.get('p_google'))!, { crid: 'crid-f', iurl: iurl('crid-f') }, { id: 'swisse', name: 'Swisse' }, p)
    const id = (await campaignForCrid(ctx, 'p_google', 'crid-f'))!
    expect(await verifiedCampaign(ctx, 'p_google', 'crid-f', iurl('crid-f'))).toBe(id)
    expect(await verifiedCampaign(ctx, 'p_google', 'crid-f', 'http://mocks.test/dv360/creatives/crid-f-v2')).toBeNull()
    ctx.db.prepare("UPDATE dsp_creatives SET verified_at = '2020-01-01T00:00:00.000Z' WHERE crid = 'crid-f'").run()
    expect(await verifiedCampaign(ctx, 'p_google', 'crid-f', iurl('crid-f'))).toBeNull()
  })
})
