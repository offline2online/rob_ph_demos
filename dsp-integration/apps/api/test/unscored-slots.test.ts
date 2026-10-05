/* Unscored slots are flagged and excluded (ticket, 30 Sep 2026). Assumed
   views come from the audience source, which answers 0 for a slot with no
   audience_vacd row; selling that would bill 0. There is no fallback
   estimate: the slot is not sold until someone scores it. */
import type { DisplayType, Slot } from '@ph-dsp/types'
import { describe, expect, it } from 'vitest'
import { runAuction } from '../src/exchange/auction'
import { buildApp } from '../src/http/app'
import { NOW, testContext } from './helpers'
import { expectMatchesContract } from './contract'

const GOOGLE = { authorization: 'Bearer poc-token-google-dv360' }
const W1 = '2026-09-21T00:00:00.000Z'

/* A display type made the way HQ Admin makes one: a capped rotation, two
   displays, an Advertiser slot, and no audience row. */
async function setup(loopLengthSec: number | null = 40) {
  const ctx = await testContext({ clock: () => NOW })
  const app = buildApp(ctx)
  const dt: DisplayType = {
    id: 'dt_ui', name: 'UI-made kiosk', touchPoint: 'Digital Signage', description: null, displayCanvasSize: { width: 1080, height: 1920 }, backgroundColor: '#000000',
    defaultPlaylistId: 'pl_portrait', playlistSettings: { maximumCampaignsPlayedInRotation: 2 }, qrControl: {}, enabledFeatures: {}, multiZone: { enabled: false, zones: [] },
  }
  expect((await app.inject({ method: 'POST', url: '/api/admin/v1/display-types', payload: dt })).statusCode).toBe(201)
  const slot = (label: string, owner: string) => ({ label, owner, partnerIds: [], advertisers: [], listMode: 'rtb', buyersListId: null, storeScope: null, quota: null, zoneId: null, supportedTargeting: ['localised'] }) as unknown as Slot
  await ctx.displayTypes.saveExtensions('dt_ui', { slots: [slot('Ad 1', 'advertiser'), slot('Ad 2', 'internal')], ...(loopLengthSec ? { venue: { openOohVenueType: 'retail.grocery', orientation: 'portrait', loopLengthSec } } : {}) } as never)
  const ins = ctx.db.prepare("INSERT INTO displays (id, name, store, store_id, display_type_id) VALUES (?, 'Kiosk', 'Sydney CBD', 'st_sydney_cbd', 'dt_ui')")
  ins.run('d_ui_1'); ins.run('d_ui_2')
  const get = (url: string) => app.inject({ method: 'GET', url: `/api${url}`, headers: GOOGLE })
  const score = () => ctx.db.prepare('INSERT INTO audience_vacd (display_type_id, slot, assumed_views_per_window, counted) VALUES (?, ?, ?, 0)').run('dt_ui', 1, 640)
  return { ctx, app, get, score }
}

describe('unscored slots', () => {
  it('are excluded from inventory, 404 as not sellable, and appear with views once an audience row exists', async () => {
    const { get, score } = await setup()
    const ids = async () => ((await get('/v1/inventory')).json().items as { positionId: string }[]).map((i) => i.positionId)
    expect(await ids()).not.toContain('dt_ui.s1')
    expect((await get('/v1/inventory/dt_ui.s1')).statusCode).toBe(404)
    expect((await get('/v1/inventory/dt_ui.s1/availability?from=2026-09-21&to=2026-09-21')).statusCode).toBe(404)
    score()
    expect(await ids()).toContain('dt_ui.s1')
    const one = await get('/v1/inventory/dt_ui.s1')
    expect(one.statusCode).toBe(200)
    expectMatchesContract('GET', '/v1/inventory/{positionId}', 200, one.json())
    expect(one.json()).toMatchObject({ scored: true })
    expect(one.json().assumedViewsPerWindow).toBeGreaterThan(0)
  })

  it('are left out of a forecast', async () => {
    const { app, score } = await setup()
    const forecast = () => app.inject({ method: 'POST', url: '/api/v1/inventory/forecast', headers: GOOGLE, payload: { positionIds: ['dt_ui.s1'], from: '2026-09-21', to: '2026-09-21' } })
    const before = await forecast()
    expect(before.statusCode).toBe(400)
    expect(before.json().error.details).toContainEqual({ field: 'positionIds[0]', reason: 'Unknown position.' })
    score()
    const after = await forecast()
    expect(after.statusCode).toBe(200)
    expect(after.json().assumedViews).toBeGreaterThan(0)
  })

  it('refuse a bid with the reason, and take it once scored', async () => {
    const { app, score } = await setup()
    const bid = () => app.inject({ method: 'POST', url: '/api/v1/reservations', headers: GOOGLE, payload: { positionId: 'dt_ui.s1', windowStart: W1, campaignId: 'c_dsp_nestle', advertiserId: 'nestle', type: 'bid', bidCpm: 200 } })
    const refused = await bid()
    expect(refused.statusCode).toBe(409)
    expect(refused.json().error.message).toBe('No audience score yet.')
    score()
    expect((await bid()).statusCode).not.toBe(409)
  })

  it('are skipped by the auction', async () => {
    const { ctx, score } = await setup()
    expect((await runAuction(ctx, new Date(W1))).positions.map((p) => p.positionId)).not.toContain('dt_ui.s1')
    score()
    expect((await runAuction(ctx, new Date(W1))).positions.map((p) => p.positionId)).toContain('dt_ui.s1')
  })

  it('are flagged on Available Inventory without blocking the save', async () => {
    const { app, score } = await setup()
    const row = async () => ((await app.inject({ method: 'GET', url: '/api/admin/v1/available-inventory' })).json().items as { displayTypeId: string; scored: boolean; unsellableReason: string | null }[]).find((i) => i.displayTypeId === 'dt_ui')!
    expect(await row()).toMatchObject({ scored: false, unsellableReason: 'No audience score yet.' })
    const save = await app.inject({ method: 'PUT', url: '/api/admin/v1/available-inventory', payload: { items: [{ displayTypeId: 'dt_ui', slot: 1, supportedTargeting: ['localised', 'personalised'], assignedTo: { partnerIds: [], advertisers: [], whitelistOnly: false, buyersListId: null }, reservePrice: 150, billingUnitHours: null, maxCampaigns: null }] } })
    expect(save.statusCode).toBe(200)
    expect((await row()).scored).toBe(false)
    score()
    expect(await row()).toMatchObject({ scored: true, unsellableReason: null })
  })
})

describe('slots with no duration', () => {
  it('are still sellable when scored — duration belongs to the campaign asset, not the slot', async () => {
    const { get, score } = await setup(null)
    expect((await get('/v1/inventory/dt_ui.s1')).statusCode).toBe(404)
    score()
    expect((await get('/v1/inventory/dt_ui.s1')).statusCode).toBe(200)
  })
})

describe('the seeded estates', () => {
  it('keep every advertiser slot scored and sellable, sample bookings and demo estate included', async () => {
    for (const opts of [{}, { bookings: true }, { demo: true }]) {
      const ctx = await testContext(opts)
      const { allPositions, unsellableReason, filterAsync } = await import('../src/domain/positions')
      expect((await allPositions(ctx)).length).toBeGreaterThan(0)
      expect(await filterAsync(await allPositions(ctx), async (p) => Boolean(await unsellableReason(ctx, p)))).toEqual([])
    }
  })
})
