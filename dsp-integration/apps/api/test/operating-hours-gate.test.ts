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
    expect(operatingHoursExt('entrance', [{ hours: { open: 0, close: 24 }, screens: 4 }])).toEqual({ zone: 'entrance', external: true, tz: 'UTC', screens: [{ open: '00:00', close: '24:00', days: [0, 1, 2, 3, 4, 5, 6], count: 4 }] })
  })
})

async function setup(zone: 'aisles' | 'entrance', at: string) {
  const mocks = mockDsps()
  const sent: string[] = []
  const fetchImpl: typeof mocks.fetchImpl = async (url, init) => { if (url.includes('/openrtb2/bid')) sent.push(url); return mocks.fetchImpl(url, init) }
  let now = new Date(at)
  const ctx = await testContext({ byWindow: true, clock: () => now, dspFetch: fetchImpl })
  const app = buildApp(ctx)
  const ext = (await ctx.displayTypes.get('menu_board'))!.phExtensions!
  await ctx.displayTypes.saveExtensions('menu_board', { ...ext, storeZone: zone, slots: ext.slots.map((s, i) => (i === 1 ? { ...s, listMode: 'rtb' as const, buyersListId: null } : s)) })
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
