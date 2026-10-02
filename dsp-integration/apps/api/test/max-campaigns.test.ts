/* The slot's Max campaigns is enforced where the campaign meets the slot
   (Rob, 1 Oct 2026): approval precedes booking, so submission only guards
   package size, and a bid or a reservation is refused `too_many_versions`
   when the campaign's 1 + targeted versions exceed maxCampaignsOf(slot). */
import type { Slot } from '@ph-dsp/types'
import { describe, expect, it } from 'vitest'
import { buildApp } from '../src/http/app'
import { multipart, png } from './media'
import { NOW, testContext } from './helpers'

const GOOGLE = { authorization: 'Bearer poc-token-google-dv360' }
const W1 = '2026-09-21T00:00:00.000Z'
const VERSION = (id: string) => ({ id, priority: 1, pricingType: 'localised', rules: [[{ source: 'store', variable: 'store.fixed_segments', op: 'include', values: [id] }]] })

async function setup(maxCampaigns: number | null, targetedCount: number) {
  const ctx = await testContext({ clock: () => NOW })
  const app = buildApp(ctx)
  const ext = (await ctx.displayTypes.get('portrait'))!.phExtensions!
  await ctx.displayTypes.saveExtensions('portrait', {
    ...ext,
    slots: [{ label: 'Ad', owner: 'advertiser', partnerIds: [], advertisers: [], listMode: 'rtb', buyersListId: null, storeScope: null, quota: null, zoneId: null, supportedTargeting: ['localised'], maxCampaigns, reservePrice: 150 } as Slot],
  })
  ctx.db.prepare('INSERT INTO audience_vacd (display_type_id, slot, assumed_views_per_window, counted) VALUES (?, ?, ?, 1)').run('portrait', 1, 800)
  /* Submitted with no slot (the 20-version guard only), approved, activated. */
  const targeted = Array.from({ length: targetedCount }, (_, i) => VERSION(`v${i}`))
  const created = await app.inject({ method: 'POST', url: '/api/v1/campaigns', headers: GOOGLE, payload: { advertiserId: 'swisse', name: 'Swisse — Portrait', displayTypeId: 'portrait', default: { pricingType: 'localised' }, targeted } })
  expect(created.statusCode).toBe(201)
  const cid = created.json().campaignId as string
  const m = multipart({ version: 'default' }, { name: 'portrait.png', bytes: png(1080, 1920) })
  await app.inject({ method: 'POST', url: `/api/v1/campaigns/${cid}/assets`, headers: { ...GOOGLE, ...m.headers }, payload: m.payload })
  await app.inject({ method: 'POST', url: `/api/v1/campaigns/${cid}/submit`, headers: GOOGLE })
  await app.inject({ method: 'POST', url: `/api/admin/v1/campaigns/${cid}/approve`, payload: { assetVersion: 'v1' } })
  await app.inject({ method: 'PUT', url: `/api/admin/v1/campaigns/${cid}/activation`, payload: { enabled: true } })
  const post = (type: 'bid' | 'reserve') => app.inject({ method: 'POST', url: '/api/v1/reservations', headers: GOOGLE, payload: { positionId: 'portrait.s1', windowStart: W1, campaignId: cid, advertiserId: 'swisse', type, bidCpm: 400 } })
  return { ctx, app, cid, post }
}

describe('Max campaigns at bid and reservation time', () => {
  it('refuses a 6-version campaign on a Max-5 slot, bid and reserve alike', async () => {
    const { post, ctx } = await setup(5, 5)
    for (const type of ['bid', 'reserve'] as const) {
      const res = await post(type)
      expect(res.statusCode).toBe(422)
      expect(res.json().error).toMatchObject({ code: 'too_many_versions', message: 'At most 5 campaigns (default + targeted versions) for this slot.' })
    }
    expect(await ctx.reservations.forWindow('portrait.s1', W1)).toEqual([])
  })

  it('accepts the same 6-version campaign on a Max-10 slot', async () => {
    const { post } = await setup(10, 5)
    expect((await post('bid')).statusCode).toBe(201)
  })

  it('accepts a campaign exactly at the limit', async () => {
    const { post } = await setup(5, 4)
    expect((await post('bid')).statusCode).toBe(201)
  })

  it('settles a pending bid rejected with the same reason when the slot is lowered before the auction', async () => {
    const { ctx, post, app } = await setup(10, 5)
    expect((await post('bid')).statusCode).toBe(201)
    const ext = (await ctx.displayTypes.get('portrait'))!.phExtensions!
    await ctx.displayTypes.saveExtensions('portrait', { ...ext, slots: ext.slots!.map((s) => ({ ...s, maxCampaigns: 3 })) })
    const { runAuction } = await import('../src/exchange/auction')
    await runAuction(ctx, new Date(W1))
    const rows = await ctx.reservations.forWindow('portrait.s1', W1)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ status: 'rejected', reason: 'At most 3 campaigns (default + targeted versions) for this slot.' })
    void app
  })

  it('exposes maxCampaigns on the Partner API position', async () => {
    const { app } = await setup(7, 0)
    const one = await app.inject({ url: '/api/v1/inventory/portrait.s1', headers: GOOGLE })
    expect(one.json().maxCampaigns).toBe(7)
    const list = await app.inject({ url: '/api/v1/inventory?displayTypeId=portrait', headers: GOOGLE })
    expect(list.json().items.find((p: { positionId: string }) => p.positionId === 'portrait.s1').maxCampaigns).toBe(7)
  })

  it('still accepts a submission with no slot up to the 20-version guard', async () => {
    const { app } = await setup(5, 5)
    const over = await app.inject({ method: 'POST', url: '/api/v1/campaigns', headers: GOOGLE, payload: { advertiserId: 'swisse', name: 'Too big', displayTypeId: 'portrait', default: { pricingType: 'localised' }, targeted: Array.from({ length: 21 }, (_, i) => VERSION(`x${i}`)) } })
    expect(over.statusCode).toBe(400)
  })
})
