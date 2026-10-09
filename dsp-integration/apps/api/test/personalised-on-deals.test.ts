import type { Slot } from '@ph-dsp/types'
import { describe, expect, it } from 'vitest'
import { buildApp } from '../src/http/app'
import { checkTargeting } from '../src/exchange/enforcement'
import { findPosition, isRealtime, type PositionRef } from '../src/domain/positions'
import { multipart, png } from './media'
import { NOW, testContext } from './helpers'

/* Personalised targeting is sold on deals and reserve bookings, never in the
   open real-time auction (Rob, 8 Oct 2026, replacing the 5 Oct reserve-only rule). */
const GOOGLE = { authorization: 'Bearer poc-token-google-dv360' }
const W1 = '2026-09-21T00:00:00.000Z'
const GENDER = [[{ source: 'store', variable: 'store.cv_gender', op: 'match_exactly', values: ['Female'] }]]

async function setup(dealType: 'private_auction' | 'preferred' | 'guaranteed' | 'open') {
  const ctx = await testContext({ byWindow: true, clock: () => NOW })
  const open = (await ctx.buyersLists.get('bl_test_open'))!
  if (dealType !== 'open') await ctx.buyersLists.update(open.id, { name: open.name, description: '', dealType, invitedBuyers: open.invitedBuyers, activeFrom: null, activeTo: null, auctionCloses: null })
  const access = await ctx.company.variableAccess()
  await ctx.company.saveVariableAccess({ ...access, 'store.cv_gender': 'all' })
  const app = buildApp(ctx)
  const ext = (await ctx.displayTypes.get('portrait'))!.phExtensions!
  const deal = dealType !== 'open'
  await ctx.displayTypes.saveExtensions('portrait', {
    ...ext,
    slots: [{ label: 'Ad', owner: 'advertiser', partnerIds: [], advertisers: [], listMode: deal ? 'deal' : 'open', buyersListId: deal ? 'bl_test_open' : undefined, storeScope: null, quota: null, zoneId: null, reservePrice: 150 } as unknown as Slot],
  })
  ctx.db.prepare('INSERT INTO audience_vacd (display_type_id, slot, assumed_views_per_window, counted) VALUES (?, ?, ?, 1)').run('portrait', 1, 800)
  const created = await app.inject({ method: 'POST', url: '/api/v1/campaigns', headers: GOOGLE, payload: { advertiserId: 'swisse', name: 'Swisse — personalised', displayTypeId: 'portrait', default: { pricingType: 'personalised' }, targeted: [{ id: 'women', priority: 1, pricingType: 'personalised', rules: GENDER }] } })
  if (created.statusCode !== 201) throw new Error(created.body)
  expect(created.statusCode).toBe(201)
  const cid = created.json().campaignId
  const m = multipart({ version: 'default' }, { name: 'portrait.png', bytes: png(1080, 1920) })
  await app.inject({ method: 'POST', url: `/api/v1/campaigns/${cid}/assets`, headers: { ...GOOGLE, ...m.headers }, payload: m.payload })
  await app.inject({ method: 'POST', url: `/api/v1/campaigns/${cid}/submit`, headers: GOOGLE })
  await app.inject({ method: 'POST', url: `/api/admin/v1/campaigns/${cid}/approve`, payload: { assetVersion: 'v1' } })
  await app.inject({ method: 'PUT', url: `/api/admin/v1/campaigns/${cid}/activation`, payload: { enabled: true } })
  const place = (type: 'bid' | 'reserve', bidCpm: number, extra: Record<string, unknown> = {}) =>
    app.inject({ method: 'POST', url: '/api/v1/reservations', headers: GOOGLE, payload: { positionId: 'portrait.s1', windowStart: W1, campaignId: cid, advertiserId: 'swisse', type, bidCpm, ...extra } })
  return { ctx, place }
}

describe('personalised targeting on deals', () => {
  it('checkTargeting allows personalised on a deal position or reserve, refuses it on an open one', () => {
    const pos = (def: object) => ({ def }) as unknown as PositionRef
    expect(checkTargeting(pos({}), 'personalised')).toMatchObject({ code: 'targeting_not_supported' })
    expect(checkTargeting(pos({}), 'personalised', true)).toBeNull()
    expect(checkTargeting(pos({ listMode: 'deal', buyersListId: 'bl_test_open', buyersListIds: ['bl_test_open'] }), 'personalised')).toBeNull()
  })

  it('a personalised bid on a private auction clears the targeting check', async () => {
    const { place } = await setup('private_auction')
    const res = await place('bid', 300)
    expect(res.statusCode).toBe(201)
    expect(res.json().status).toBe('pending')
  })

  it('a personalised reservation on a preferred deal is booked ', async () => {
    const { place } = await setup('preferred')
    const res = await place('reserve', 150)
    expect(res.statusCode).toBe(201)
    expect(res.json()).toMatchObject({ status: 'reserved', dealType: 'preferred' })
  })

  it('a guaranteed personalised deal commits from the targeted assumed views, not the whole VAC-d', async () => {
    const { place } = await setup('guaranteed')
    const res = await place('reserve', 150, { dealType: 'guaranteed' })
    expect(res.statusCode).toBe(201)
    /* 800 assumed views x 0.5 for the one AND group = 400 targeted; less the 10% buffer = 360 (not 720). */
    expect(res.json()).toMatchObject({ dealType: 'guaranteed', forecastImpressions: 400, guaranteedImpressions: 360 })
  })

  it('the same personalised bid on an open real-time position is still refused', async () => {
    const { ctx } = await setup('open')
    const p = (await findPosition(ctx, 'portrait.s1'))!
    expect(isRealtime(p)).toBe(true)
    /* The per-impression path (a bid carrying a personalised creative) is vetted by this same check. */
    expect(checkTargeting(p, 'personalised')).toMatchObject({ code: 'targeting_not_supported', reason: expect.stringContaining('real-time') })
    expect(checkTargeting(p, 'localised')).toBeNull()
  })
})
