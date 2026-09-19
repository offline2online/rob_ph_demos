import { describe, expect, it } from 'vitest'
import type { Slot } from '@ph-dsp/types'
import { buildApp } from '../src/http/app'
import { expectMatchesContract } from './contract'
import { NOW, testContext } from './helpers'

const GOOGLE = { authorization: 'Bearer poc-token-google-dv360' }
const AMAZON = { authorization: 'Bearer poc-token-amazon-dsp' }

const setup = async () => {
  const ctx = await testContext({ clock: () => NOW })
  const app = buildApp(ctx)
  const get = (url: string, headers = GOOGLE) => app.inject({ method: 'GET', url: `/api/v1${url}`, headers })
  /* Change the Menu Board's advertiser slot (slot 2). */
  const setSlot = (patch: Partial<Slot>) => {
    const ext = ctx.displayTypes.get('menu_board')!.phExtensions!
    ctx.displayTypes.saveExtensions('menu_board', { ...ext, slots: ext.slots.map((s, i) => (i === 1 ? { ...s, ...patch } : s)) })
  }
  return { ctx, app, get, setSlot }
}

describe('GET /v1/inventory', () => {
  it('lists only advertiser-owned slots, with screen, loop, audience and pricing', async () => {
    const { get } = await setup()
    const res = await get('/inventory')
    expect(res.statusCode).toBe(200)
    expectMatchesContract('GET', '/v1/inventory', 200, res.json())
    expect(res.json()).toEqual({
      items: [{
        positionId: 'menu_board.s2', displayTypeId: 'menu_board', displayTypeName: 'Menu Board — Long Format', slot: 2, slotLabel: 'Supplier slot', zone: null,
        storeCount: 3, displayCount: 3,
        screen: { width: 5760, height: 1080, orientation: 'landscape', slotDurationSec: 15, loopLengthSec: 45, shareOfVoice: 0.333, openOohVenueType: 'retail.grocery' },
        assignment: 'rtb', assumedViewsPerWindow: 1236,
        pricing: { currency: 'AUD', floorCpm: 100, effectiveFloorCpm: { localised: 100, personalised: 150, interactive: 300, personalisedInteractive: 450 } },
      }],
      nextCursor: null,
    })
  })

  it('prices for the requesting advertiser (floor multiplier)', async () => {
    const { get } = await setup()
    const item = (await get('/inventory?advertiserId=nestle')).json().items[0]
    expect(item.pricing.effectiveFloorCpm).toEqual({ localised: 80, personalised: 120, interactive: 240, personalisedInteractive: 360 })
  })

  it('shows a DSP that is not connected nothing, rather than an error', async () => {
    const { get } = await setup()
    const res = await get('/inventory', AMAZON)
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ items: [], nextCursor: null })
  })

  it('hides what the caller can’t buy: blacklisted, not whitelisted, reserved to another, another DSP’s', async () => {
    const { ctx, get, setSlot } = await setup()
    const ids = async (q = '') => (await get(`/inventory${q}`)).json().items.map((i: { positionId: string }) => i.positionId)
    expect(await ids('?advertiserId=loreal')).toEqual([])

    ctx.company.save({ ...ctx.company.get(), advertiserBlacklist: ['Nestlé'], advertiserWhitelist: ['Swisse'] })
    expect(await ids('?advertiserId=nestle')).toEqual([])
    expect(await ids('?advertiserId=swisse')).toEqual(['menu_board.s2'])
    expect(await ids()).toEqual(['menu_board.s2'])

    setSlot({ listMode: 'whitelist_only' })
    ctx.company.save({ ...ctx.company.get(), advertiserBlacklist: [], advertiserWhitelist: ['Nestlé'] })
    expect(await ids('?advertiserId=swisse')).toEqual([])
    expect(await ids('?advertiserId=nestle')).toEqual(['menu_board.s2'])

    setSlot({ listMode: null, advertiser: 'Swisse' })
    expect(await ids('?advertiserId=nestle')).toEqual([])
    const reserved = (await get('/inventory?advertiserId=swisse')).json().items[0]
    expect(reserved.assignment).toBe('reserved')

    setSlot({ advertiser: null, listMode: 'rtb', partnerId: 'p_amazon' })
    expect(await ids()).toEqual([])
  })

  it('filters by display type, touch point, stores, region and window status', async () => {
    const { ctx, get } = await setup()
    const n = async (q: string) => (await get(`/inventory?${q}`)).json().items.length
    expect(await n('displayTypeId=landscape')).toBe(0)
    expect(await n('displayTypeId=menu_board&touchPoint=Digital%20Signage')).toBe(1)
    expect(await n('touchPoint=Kiosk')).toBe(0)
    /* Platform store IDs and regions (StoreSource). */
    expect(await n('storeIds=st_chatswood,st_parramatta')).toBe(1)
    expect(await n('storeIds=st_parramatta')).toBe(0)
    expect(await n('storeIds=Chatswood')).toBe(0)
    expect(await n('region=North%20Shore')).toBe(1)
    expect(await n('region=Western%20Sydney')).toBe(0)
    expect(await n('status=available&from=2026-09-21&to=2026-09-22')).toBe(1)
    expect(await n('status=sold&from=2026-09-21&to=2026-09-22')).toBe(0)
    ctx.reservations.insert({
      id: 'r1', partnerId: 'p_google', advertiserId: 'nestle', campaignId: 'c_dsp_nestle', positionId: 'menu_board.s2', windowStart: '2026-09-22T00:00:00.000Z',
      type: 'bid', channel: 'api', bidCpm: 120, currency: 'AUD', status: 'won', clearingCpm: 120, reason: null, testMode: false, pricingType: 'localised', handedOffAt: null,
    })
    expect(await n('status=sold&from=2026-09-21&to=2026-09-22')).toBe(1)
  })
})

describe('GET /v1/inventory/{positionId} and …/availability', () => {
  it('returns one position, or 404 when the caller can’t see it', async () => {
    const { get } = await setup()
    const res = await get('/inventory/menu_board.s2')
    expectMatchesContract('GET', '/v1/inventory/{positionId}', 200, res.json())
    expect(res.json().positionId).toBe('menu_board.s2')
    for (const url of ['/inventory/menu_board.s1', '/inventory/menu_board.s3', '/inventory/nope']) {
      const r = await get(url)
      expect(r.statusCode).toBe(404)
      expectMatchesContract('GET', '/v1/inventory/{positionId}', 404, r.json())
    }
    expect((await get('/inventory/menu_board.s2', AMAZON)).statusCode).toBe(404)
  })

  it('gives a status per play window: past and current windows are unavailable, won ones sold', async () => {
    const { ctx, get, setSlot } = await setup()
    ctx.reservations.insert({
      id: 'r1', partnerId: 'p_google', advertiserId: 'nestle', campaignId: 'c_dsp_nestle', positionId: 'menu_board.s2', windowStart: '2026-09-22T00:00:00.000Z',
      type: 'bid', channel: 'api', bidCpm: 120, currency: 'AUD', status: 'won', clearingCpm: 120, reason: null, testMode: false, pricingType: 'localised', handedOffAt: null,
    })
    const res = await get('/inventory/menu_board.s2/availability?from=2026-09-20&to=2026-09-22')
    expect(res.statusCode).toBe(200)
    expectMatchesContract('GET', '/v1/inventory/{positionId}/availability', 200, res.json())
    expect(res.json()).toEqual({
      positionId: 'menu_board.s2',
      windows: [
        { start: '2026-09-20T00:00:00.000Z', end: '2026-09-21T00:00:00.000Z', status: 'unavailable', assumedViews: 1236 },
        { start: '2026-09-21T00:00:00.000Z', end: '2026-09-22T00:00:00.000Z', status: 'available', assumedViews: 1236 },
        { start: '2026-09-22T00:00:00.000Z', end: '2026-09-23T00:00:00.000Z', status: 'sold', assumedViews: 1236 },
      ],
    })
    /* Reserved to a named advertiser: "reserved" to its DSP, "available" to that advertiser. */
    setSlot({ listMode: null, advertiser: 'Swisse' })
    const statuses = async (q: string) => (await get(`/inventory/menu_board.s2/availability?from=2026-09-21&to=2026-09-21${q}`)).json().windows.map((w: { status: string }) => w.status)
    expect(await statuses('')).toEqual(['reserved'])
    expect(await statuses('&advertiserId=swisse')).toEqual(['available'])
  })

  it('needs a valid date range', async () => {
    const { get } = await setup()
    for (const q of ['', '?from=2026-09-21', '?from=2026-09-23&to=2026-09-21', '?from=tomorrow&to=2026-09-21']) {
      const res = await get(`/inventory/menu_board.s2/availability${q}`)
      expect(res.statusCode).toBe(400)
      expectMatchesContract('GET', '/v1/inventory/{positionId}/availability', 400, res.json())
    }
  })
})

describe('POST /v1/inventory/forecast', () => {
  const forecast = async (body: Record<string, unknown>) => {
    const { app } = await setup()
    return app.inject({ method: 'POST', url: '/api/v1/inventory/forecast', headers: GOOGLE, payload: body })
  }
  const TWO_DAYS = { positionIds: ['menu_board.s2'], from: '2026-09-21', to: '2026-09-22' }

  it('projects assumed views and cost at the effective floor', async () => {
    const res = await forecast(TWO_DAYS)
    expect(res.statusCode).toBe(200)
    expectMatchesContract('POST', '/v1/inventory/forecast', 200, res.json())
    expect(res.json()).toEqual({ assumedViews: 2472, currency: 'AUD', estimatedCost: 247.2 })
    expect((await forecast({ ...TWO_DAYS, advertiserId: 'nestle' })).json().estimatedCost).toBe(197.76)
    /* Only windows the caller could still buy count. */
    expect((await forecast({ ...TWO_DAYS, from: '2026-09-19' })).json().assumedViews).toBe(2472)
  })

  it('rejects unknown positions and bad dates', async () => {
    const res = await forecast({ positionIds: ['menu_board.s1'], from: '2026-09-22', to: '2026-09-21', advertiserId: 'loreal' })
    expect(res.statusCode).toBe(400)
    expectMatchesContract('POST', '/v1/inventory/forecast', 400, res.json())
    expect(res.json().error.details.map((d: { field: string }) => d.field)).toEqual(['from', 'advertiserId', 'positionIds[0]'])
  })
})
