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

/* The seeded slot's own assignment, when a test is only changing targeting. */
const KEEP = { partnerIds: ['p_google'], advertisers: [], whitelistOnly: false }

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
    expect(res.json().items).toEqual([{
      displayTypeId: 'menu_board', displayTypeName: 'Menu Board — Long Format', touchPoint: 'Digital Signage', playlistName: 'Menu Board Playlist', slot: 2, position: 'Supplier slot',
      assignedTo: { partnerIds: ['p_google'], partnerNames: ['Google DSP'], advertisers: [], whitelistOnly: false }, supportedTargeting: ['localised'],
    }])
    /* The picker behind Assigned to: every DSP and the advertisers it brings. */
    expect(res.json().dsps[0]).toMatchObject({ partnerId: 'p_google', name: 'Google DSP', advertisers: [{ advertiserId: 'nestle', name: 'Nestlé' }, { advertiserId: 'swisse', name: 'Swisse' }] })
  })

  /* What a slot supports is set here; localised only until someone changes it (Rob, 20 Sep). */
  it('saves what targeting a slot supports, and validates it', async () => {
    const ctx = await testContext()
    const app = buildApp(ctx)
    const res = await app.inject({ method: 'PUT', url: '/api/admin/v1/available-inventory', payload: { items: [{ displayTypeId: 'menu_board', slot: 2, supportedTargeting: ['interactive', 'localised'], assignedTo: KEEP }] } })
    expect(res.statusCode).toBe(200)
    expectMatchesContract('PUT', '/admin/v1/available-inventory', 200, res.json())
    /* Kept in the catalogue's order, and on the slot itself. */
    expect(res.json().items[0].supportedTargeting).toEqual(['localised', 'interactive'])
    expect(ctx.displayTypes.get('menu_board')!.phExtensions!.slots[1].supportedTargeting).toEqual(['localised', 'interactive'])

    const bad = await app.inject({ method: 'PUT', url: '/api/admin/v1/available-inventory', payload: { items: [
      { displayTypeId: 'menu_board', slot: 2, supportedTargeting: [], assignedTo: KEEP },
      { displayTypeId: 'menu_board', slot: 1, supportedTargeting: ['localised'], assignedTo: KEEP },
      { displayTypeId: 'nope', slot: 1, supportedTargeting: ['sideways'], assignedTo: KEEP },
    ] } })
    expect(bad.statusCode).toBe(400)
    expect(bad.json().error.details).toEqual([
      { field: 'items[0].supportedTargeting', reason: 'Choose at least one type of targeting.' },
      { field: 'items[1].slot', reason: 'Only an Advertiser slot is sellable inventory.' },
      { field: 'items[2].displayTypeId', reason: 'Unknown display type.' },
      { field: 'items[2].supportedTargeting', reason: 'One of: localised, personalised, interactive.' },
    ])
  })

  /* Who may buy a position, set here now that the display type's slot editor
     only sets the label and owner (Rob, 20 Sep). */
  it('assigns a position to DSPs, to named advertisers, or to the whitelist', async () => {
    const ctx = await testContext()
    const app = buildApp(ctx)
    const save = (assignedTo: Record<string, unknown>, supportedTargeting = ['localised']) =>
      app.inject({ method: 'PUT', url: '/api/admin/v1/available-inventory', payload: { items: [{ displayTypeId: 'menu_board', slot: 2, supportedTargeting, assignedTo }] } })
    const assigned = (res: { json: () => { items: { assignedTo: unknown }[] } }) => res.json().items[0].assignedTo

    /* Nothing chosen: any connected DSP, RTB. */
    expect(assigned(await save({ partnerIds: [], advertisers: [], whitelistOnly: false })))
      .toEqual({ partnerIds: [], partnerNames: [], advertisers: [], whitelistOnly: false })
    expect(ctx.displayTypes.get('menu_board')!.phExtensions!.slots[1].listMode).toBe('rtb')

    /* Several DSPs at once. */
    expect(assigned(await save({ partnerIds: ['p_google', 'p_amazon'], advertisers: [], whitelistOnly: false })))
      .toMatchObject({ partnerIds: ['p_google', 'p_amazon'], partnerNames: ['Google DSP', 'Amazon Ads DSP'] })

    /* Named advertisers: held for them, and their DSP comes along. */
    const named = await save({ partnerIds: [], advertisers: ['Nestlé', 'Swisse'], whitelistOnly: false })
    expect(assigned(named)).toMatchObject({ advertisers: ['Nestlé', 'Swisse'], partnerIds: ['p_google'], whitelistOnly: false })
    expect(ctx.displayTypes.get('menu_board')!.phExtensions!.slots[1].listMode).toBe(null)
    expect((await buildApp(ctx).inject({ method: 'GET', url: '/api/v1/inventory/menu_board.s2', headers: { authorization: 'Bearer poc-token-google-dv360' } })).statusCode).toBe(200)

    /* The whitelist instead. */
    ctx.company.save({ ...ctx.company.get(), advertiserWhitelist: ['Nestlé'] })
    expect(assigned(await save({ partnerIds: ['p_google'], advertisers: [], whitelistOnly: true }))).toMatchObject({ whitelistOnly: true })
  })

  it('rejects an assignment a position could not honour', async () => {
    const ctx = await testContext()
    const app = buildApp(ctx)
    const save = (assignedTo: Record<string, unknown>) =>
      app.inject({ method: 'PUT', url: '/api/admin/v1/available-inventory', payload: { items: [{ displayTypeId: 'menu_board', slot: 2, supportedTargeting: ['localised'], assignedTo }] } })
    const fields = async (assignedTo: Record<string, unknown>) => {
      const res = await save(assignedTo)
      expect(res.statusCode).toBe(400)
      expectMatchesContract('PUT', '/admin/v1/available-inventory', 400, res.json())
      return res.json().error.details.map((d: { field: string }) => d.field)
    }
    expect(await fields({ partnerIds: ['p_nope'], advertisers: [], whitelistOnly: false })).toEqual(['items[0].assignedTo.partnerIds'])
    /* L'Oréal is an Amazon advertiser, not a Google one. */
    expect(await fields({ partnerIds: ['p_google'], advertisers: ["L'Oréal"], whitelistOnly: false })).toEqual(['items[0].assignedTo.advertisers'])
    expect(await fields({ partnerIds: [], advertisers: ['Nestlé'], whitelistOnly: true })).toEqual(['items[0].assignedTo.whitelistOnly'])
    ctx.company.save({ ...ctx.company.get(), advertiserWhitelist: [] })
    expect(await fields({ partnerIds: [], advertisers: [], whitelistOnly: true })).toEqual(['items[0].assignedTo.whitelistOnly'])

    /* A blocked advertiser can't be added, but one already held stays. */
    expect((await save({ partnerIds: [], advertisers: ['Nestlé'], whitelistOnly: false })).statusCode).toBe(200)
    ctx.company.save({ ...ctx.company.get(), advertiserBlacklist: ['Nestlé'] })
    expect((await save({ partnerIds: [], advertisers: ['Nestlé'], whitelistOnly: false })).statusCode).toBe(200)
    /* Once the position is held for someone else, Nestlé can't come back. */
    expect((await save({ partnerIds: [], advertisers: ['Swisse'], whitelistOnly: false })).statusCode).toBe(200)
    expect(await fields({ partnerIds: [], advertisers: ['Nestlé', 'Swisse'], whitelistOnly: false })).toEqual(['items[0].assignedTo.advertisers'])
  })

  it('lets a marketing user read the inventory but not change what it supports', async () => {
    const app = buildApp(await testContext({ role: 'hq_marketing' }))
    expect((await app.inject({ method: 'GET', url: '/api/admin/v1/available-inventory' })).statusCode).toBe(200)
    expect((await app.inject({ method: 'PUT', url: '/api/admin/v1/available-inventory', payload: { items: [{ displayTypeId: 'menu_board', slot: 2, supportedTargeting: ['personalised'], assignedTo: KEEP }] } })).statusCode).toBe(403)
  })

  it.each([['PUT', '/advertiser-settings'], ['GET', '/available-inventory']] as const)('%s %s returns 404 with the flag off', async (method, path) => {
    expect((await buildApp(await testContext({ flag: false })).inject({ method, url: `/api/admin/v1${path}`, payload: input })).statusCode).toBe(404)
  })
})
