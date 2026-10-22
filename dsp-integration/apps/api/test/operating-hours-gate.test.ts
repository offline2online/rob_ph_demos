import { describe, expect, it } from 'vitest'
import { hourGroups, openAt, openShareOfDay, operatingHoursExt, windowOpenFor } from '../src/domain/operatingGate'
import { findPosition } from '../src/domain/positions'
import { buildBidRequest } from '../src/exchange/openrtb'
import { buildApp } from '../src/http/app'
import { mockDsps, testContext } from './helpers'

const H = 3_600_000
const PLAYER = { authorization: 'Bearer poc-token-player' }

describe('operatingGate: pure helpers', () => {
  const trading = { open: 7, close: 22 }
  it('openAt: open inclusive, close exclusive', () => {
    expect(openAt(trading, new Date('2026-09-21T07:00:00Z'))).toBe(true)
    expect(openAt(trading, new Date('2026-09-21T21:59:00Z'))).toBe(true)
    expect(openAt(trading, new Date('2026-09-21T22:00:00Z'))).toBe(false)
    expect(openAt(trading, new Date('2026-09-21T03:00:00Z'))).toBe(false)
  })
  it('a window is offered only if some display has open time in it', () => {
    const aisle = [{ hours: trading, screens: 2 }]
    expect(windowOpenFor(aisle, new Date('2026-09-21T22:00:00Z'), 8 * H)).toBe(false)
    expect(windowOpenFor(aisle, new Date('2026-09-21T00:00:00Z'), 8 * H)).toBe(true)
    expect(windowOpenFor([...aisle, { hours: { open: 0, close: 24 }, screens: 1 }], new Date('2026-09-21T22:00:00Z'), 8 * H)).toBe(true)
  })
  it('groups by distinct hours and weights the open share by screens', () => {
    const stores = new Map([['a', { openHour: 8, closeHour: 20 }], ['b', { openHour: 8, closeHour: 20 }], ['c', { openHour: 0, closeHour: 24 }]])
    const ds = [{ storeId: 'a' }, { storeId: 'b' }, { storeId: 'c' }]
    expect(hourGroups('aisles', ds, stores)).toHaveLength(2)
    expect(hourGroups('exterior', ds, stores)).toEqual([{ hours: { open: 0, close: 24 }, screens: 3 }])
    expect(openShareOfDay(hourGroups('exterior', ds, stores))).toBe(1)
    expect(openShareOfDay(hourGroups('aisles', ds, stores))).toBeCloseTo((2 * 12 + 24) / 72)
  })
  it('publishes the per-screen form, grouped', () => {
    expect(operatingHoursExt('entrance', [{ hours: { open: 0, close: 24 }, screens: 4 }])).toEqual({ zone: 'entrance', mode: '24h', external: true, tz: 'UTC', screens: [{ open: '00:00', close: '24:00', days: [0, 1, 2, 3, 4, 5, 6], count: 4 }] })
  })
})

async function setup(zone: 'aisles' | 'entrance', at: string, operatingHours?: { mode: '24h' | 'store' | 'custom'; start?: string; end?: string }) {
  const mocks = mockDsps()
  const sent: string[] = []
  const fetchImpl: typeof mocks.fetchImpl = async (url, init) => { if (url.includes('/openrtb2/bid')) sent.push(url); return mocks.fetchImpl(url, init) }
  let now = new Date(at)
  const ctx = await testContext({ byWindow: true, clock: () => now, dspFetch: fetchImpl })
  const app = buildApp(ctx)
  const ext = (await ctx.displayTypes.get('menu_board'))!.phExtensions!
  await ctx.displayTypes.saveExtensions('menu_board', { ...ext, storeZone: zone, ...(operatingHours ? { operatingHours } : {}), slots: ext.slots.map((s, i) => (i === 1 ? { ...s, listMode: 'rtb' as const, buyersListId: null } : s)) })
  /* Store closed 22:00-07:00. */
  ctx.db.prepare('UPDATE stores SET open_hour = 7, close_hour = 22').run()
  const displayId = (await ctx.displays.listByDisplayType('menu_board'))[0].id
  const signal = () => app.inject({ method: 'POST', url: '/api/player/v1/impressions', headers: PLAYER, payload: { displayId, slot: 2 } })
  return { ctx, sent, signal, setNow: (d: string) => { now = new Date(d) } }
}

describe('real-time: closed hours', () => {
  it('an aisle display overnight: no bid request, house content, nothing logged unsold', async () => {
    const { ctx, sent, signal } = await setup('aisles', '2026-09-21T23:00:00Z')
    const res = await signal()
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ status: 'no_fill', reason: 'Unavailable — store closed' })
    expect(sent).toHaveLength(0)
    expect(ctx.db.prepare('SELECT COUNT(*) AS n FROM unsold_slots').get()).toEqual({ n: 0 })
  })
  it('the same aisle display in trading hours bids', async () => {
    const { sent, signal } = await setup('aisles', '2026-09-21T12:00:00Z')
    await signal()
    expect(sent.length).toBeGreaterThan(0)
  })
  it('an entrance display keeps sending bid requests overnight', async () => {
    const { sent, signal } = await setup('entrance', '2026-09-21T23:00:00Z')
    const res = await signal()
    expect(res.json().reason).not.toBe('Unavailable — store closed')
    expect(sent.length).toBeGreaterThan(0)
  })
})

describe('bid request carries the resolved hours', () => {
  it('imp[0].ext.ph.operatingHours is grouped by distinct hours', async () => {
    const { ctx } = await setup('aisles', '2026-09-21T12:00:00Z')
    const p = (await findPosition(ctx, 'menu_board.s2'))!
    const partner = (await ctx.partners.list())[0]
    const req = await buildBidRequest(ctx, p, partner, 'r1')
    const oh = req.imp[0].ext.ph.operatingHours!
    expect(oh).toMatchObject({ zone: 'aisles', external: false, tz: 'UTC' })
    expect(oh.screens.every((s) => s.open === '07:00' && s.close === '22:00')).toBe(true)
  })
})

describe('Available Inventory: plays per window follows operating hours', () => {
  const rowFor = async (zone: 'aisles' | 'entrance') => {
    const ctx = await testContext()
    const app = buildApp(ctx)
    const ext = (await ctx.displayTypes.get('menu_board'))!.phExtensions!
    await ctx.displayTypes.saveExtensions('menu_board', { ...ext, storeZone: zone })
    ctx.db.prepare('UPDATE stores SET open_hour = 8, close_hour = 20').run()
    const items = (await app.inject({ method: 'GET', url: '/api/admin/v1/available-inventory' })).json().items as { displayTypeId: string; slot: number; openHoursPerDay: number; playsPerWindow: number; billingUnitHours: number; maxPlayLengthSec: number; slotCount: number }[]
    return items.find((i) => i.displayTypeId === 'menu_board')!
  }
  it('an entrance display counts 24 hours', async () => {
    const r = await rowFor('entrance')
    expect(r.openHoursPerDay).toBe(24)
    expect(r.playsPerWindow).toBe(Math.floor((r.billingUnitHours * 3600) / (r.maxPlayLengthSec * r.slotCount)))
  })
  it('an in-aisles display counts the average store hours (8:00-20:00 = 12)', async () => {
    const r = await rowFor('aisles')
    expect(r.openHoursPerDay).toBe(12)
    expect(r.playsPerWindow).toBe(Math.floor((r.billingUnitHours * 3600 * 12) / 24 / (r.maxPlayLengthSec * r.slotCount)))
  })
})

describe('operating hours set on the display type (ticket WvnAf6fR7snXV1C0z9PV)', () => {
  const custom = { mode: 'custom' as const, start: '06:00', end: '23:00' }
  it('custom hours override the zone: an entrance display is closed outside them, no bid request, nothing unsold', async () => {
    const { ctx, sent, signal } = await setup('entrance', '2026-09-21T05:00:00Z', custom)
    const res = await signal()
    expect(res.json()).toMatchObject({ status: 'no_fill', reason: 'Unavailable — store closed' })
    expect(sent).toHaveLength(0)
    expect(ctx.db.prepare('SELECT COUNT(*) AS n FROM unsold_slots').get()).toMatchObject({ n: 0 })
  })
  it('custom hours bid inside them, whatever the store trades', async () => {
    const { sent, signal } = await setup('aisles', '2026-09-21T22:30:00Z', custom)
    await signal()
    expect(sent.length).toBeGreaterThan(0)
  })
  it('24 hours on an aisles type bids overnight', async () => {
    const { sent, signal } = await setup('aisles', '2026-09-21T23:30:00Z', { mode: '24h' })
    await signal()
    expect(sent.length).toBeGreaterThan(0)
  })
  it('the bid request carries the custom open and close', async () => {
    const { ctx } = await setup('aisles', '2026-09-21T12:00:00Z', custom)
    const p = (await findPosition(ctx, 'menu_board.s2'))!
    const oh = (await buildBidRequest(ctx, p, (await ctx.partners.list())[0], 'r1')).imp[0].ext.ph.operatingHours!
    expect(oh.mode).toBe('custom')
    expect(oh.screens.every((s) => s.open === '06:00' && s.close === '23:00')).toBe(true)
  })
  it('Available Inventory counts the 17 custom open hours', async () => {
    const ctx = await testContext()
    const app = buildApp(ctx)
    const ext = (await ctx.displayTypes.get('menu_board'))!.phExtensions!
    await ctx.displayTypes.saveExtensions('menu_board', { ...ext, storeZone: 'aisles', operatingHours: custom })
    const items = (await app.inject({ method: 'GET', url: '/api/admin/v1/available-inventory' })).json().items as { displayTypeId: string; openHoursPerDay: number }[]
    expect(items.find((i) => i.displayTypeId === 'menu_board')!.openHoursPerDay).toBe(17)
  })
  it('saving through the extensions endpoint validates, keeps and clears the setting', async () => {
    const ctx = await testContext()
    const app = buildApp(ctx)
    await ctx.displayTypes.create({
      id: 'dt_oh', name: 'Hours test', touchPoint: 'Digital Signage', description: null, displayCanvasSize: { width: 1080, height: 1920 }, backgroundColor: '#000000',
      defaultPlaylistId: 'pl_portrait', playlistSettings: { maximumCampaignsPlayedInRotation: 1 }, qrControl: {}, enabledFeatures: {}, multiZone: { enabled: false, zones: [] },
    } as never)
    const slots = [{ label: 'Ad 1', owner: 'advertiser', partnerIds: [], advertisers: [], listMode: 'rtb', buyersListId: null, storeScope: null, quota: null, zoneId: null }]
    const venue = { openOohVenueType: 'retail.grocery', orientation: 'portrait', loopLengthSec: 40 }
    const send = (extra: Record<string, unknown>) => app.inject({ method: 'PUT', url: '/api/admin/v1/display-types/dt_oh/extensions', payload: { slots, venue, ...extra } })
    const put = (operatingHours: unknown) => send({ operatingHours })
    expect((await put({ mode: 'custom', start: '23:00', end: '06:00' })).statusCode).toBe(400)
    expect((await put({ mode: 'sometimes' })).statusCode).toBe(400)
    const saved = await put({ mode: 'custom', start: '06:00', end: '23:00' })
    expect(saved.statusCode, saved.body).toBe(200)
    expect(saved.json().operatingHours).toEqual(custom)
    expect((await send({})).json().operatingHours).toEqual(custom)
    expect((await put({ mode: 'store', start: '01:00' })).json().operatingHours).toEqual({ mode: 'store' })
    expect((await put(null)).json().operatingHours).toBeUndefined()
  })
})
