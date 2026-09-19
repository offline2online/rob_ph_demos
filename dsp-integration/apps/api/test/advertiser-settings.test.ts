import { describe, expect, it } from 'vitest'
import { buildApp } from '../src/http/app'
import { expectMatchesContract } from './contract'
import { NOW, testContext } from './helpers'
import { biddingClosesAt, biddingOpensAt, nextWindow, windowStartOf } from '../src/domain/positions'

const input = {
  currency: 'NZD', floorCpm: 120, personalisedMultiplier: 1.6, interactiveMultiplier: 2.5,
  auctionOpensHours: 72, playWindowHours: 168, auctionCutoffTime: '20:30',
  advertiserWhitelist: ['Nestlé', ' Swisse '], advertiserBlacklist: ['Red Bull', 'red bull'], categoryWhitelist: ['Food & Drink'], categoryBlacklist: ['Finance'],
}

describe('Advertiser settings (spec §4, §6)', () => {
  it('saves pricing and lists, trimming and de-duplicating entries', async () => {
    const app = buildApp(await testContext())
    const res = await app.inject({ method: 'PUT', url: '/api/admin/v1/advertiser-settings', payload: input })
    expect(res.statusCode).toBe(200)
    expectMatchesContract('PUT', '/admin/v1/advertiser-settings', 200, res.json())
    expect(res.json()).toMatchObject({ currency: 'NZD', floorCpm: 120, advertiserWhitelist: ['Nestlé', 'Swisse'], advertiserBlacklist: ['Red Bull'] })
  })

  it('rejects an entry on both lists (case-insensitive), a non-ISO currency and a non-positive floor', async () => {
    const app = buildApp(await testContext())
    const res = await app.inject({ method: 'PUT', url: '/api/admin/v1/advertiser-settings', payload: { ...input, currency: 'XYZ1', floorCpm: 0, advertiserBlacklist: ['NESTLÉ'], categoryBlacklist: ['food & drink'] } })
    expect(res.statusCode).toBe(400)
    expectMatchesContract('PUT', '/admin/v1/advertiser-settings', 400, res.json())
    expect(res.json().error.details.map((d: { field: string }) => d.field)).toEqual(['currency', 'floorCpm', 'advertiserWhitelist', 'categoryWhitelist'])
  })

  it('saves the auction schedule, and validates it', async () => {
    const app = buildApp(await testContext())
    const ok = await app.inject({ method: 'PUT', url: '/api/admin/v1/advertiser-settings', payload: input })
    expect(ok.json()).toMatchObject({ auctionOpensHours: 72, playWindowHours: 168, auctionCutoffTime: '20:30' })
    const bad = await app.inject({ method: 'PUT', url: '/api/admin/v1/advertiser-settings', payload: { ...input, auctionOpensHours: 0, playWindowHours: 1.5, auctionCutoffTime: '24:00' } })
    expect(bad.json().error.details.map((d: { field: string }) => d.field)).toEqual(['auctionOpensHours', 'playWindowHours', 'auctionCutoffTime'])
  })

  it('won’t change the play-window length while future windows are bid on or booked', async () => {
    const ctx = await testContext({ clock: () => NOW })
    ctx.reservations.insert({
      id: 'r1', partnerId: 'p_google', advertiserId: 'nestle', campaignId: 'c_dsp_nestle', positionId: 'menu_board.s2', windowStart: '2026-09-22T00:00:00.000Z',
      type: 'bid', channel: 'api', bidCpm: 120, currency: 'AUD', status: 'pending', clearingCpm: null, reason: null, testMode: false, pricingType: 'localised', handedOffAt: null,
    })
    const res = await buildApp(ctx).inject({ method: 'PUT', url: '/api/admin/v1/advertiser-settings', payload: input })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.details).toEqual([{ field: 'playWindowHours', reason: 'Future play windows are already bid on or booked; the length can change once they have played.' }])
  })

  it('drives the play windows: length, the daily cutoff when the auction runs, and when bidding opens', async () => {
    const ctx = await testContext({ clock: () => NOW })
    /* Defaults: 24-hour windows, cutoff 18:00 UTC, bidding opens 7 days before the cutoff. */
    const w = new Date('2026-09-22T00:00:00.000Z')
    expect(biddingClosesAt(ctx, w).toISOString()).toBe('2026-09-21T18:00:00.000Z')
    expect(biddingOpensAt(ctx, w).toISOString()).toBe('2026-09-14T18:00:00.000Z')
    expect(nextWindow(ctx).toISOString()).toBe('2026-09-21T00:00:00.000Z')
    /* A midnight cutoff: the auction runs as the window starts. */
    ctx.company.save({ ...ctx.company.get(), auctionCutoffTime: '00:00' })
    expect(biddingClosesAt(ctx, w).toISOString()).toBe('2026-09-22T00:00:00.000Z')
    /* 7-day windows run Monday to Monday. */
    ctx.company.save({ ...ctx.company.get(), playWindowHours: 168, auctionCutoffTime: '18:00' })
    expect(windowStartOf(ctx, NOW).toISOString()).toBe('2026-09-14T00:00:00.000Z')
    expect(nextWindow(ctx).toISOString()).toBe('2026-09-21T00:00:00.000Z')
  })

  it('Available Inventory lists every advertiser-owned slot, with no advertisers column', async () => {
    const res = await buildApp(await testContext()).inject({ method: 'GET', url: '/api/admin/v1/available-inventory' })
    expectMatchesContract('GET', '/admin/v1/available-inventory', 200, res.json())
    expect(res.json().items).toEqual([{ displayTypeId: 'menu_board', displayTypeName: 'Menu Board — Long Format', touchPoint: 'Digital Signage', playlistName: 'Menu Board Playlist', slot: 2, position: 'Supplier slot', partnerName: 'Google DSP' }])
  })

  it.each([['PUT', '/advertiser-settings'], ['GET', '/available-inventory']] as const)('%s %s returns 404 with the flag off', async (method, path) => {
    expect((await buildApp(await testContext({ flag: false })).inject({ method, url: `/api/admin/v1${path}`, payload: input })).statusCode).toBe(404)
  })
})
