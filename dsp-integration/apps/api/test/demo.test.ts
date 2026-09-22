/* The demo estate (seed/demo.ts, Rob 22 Sep): four advertiser slots on
   Landscape, three on Portrait, a full advertiser roster, campaigns in
   every state and bookings on every position — applied on top of the base
   seed, off by default in every other test, and safe to apply twice. */
import { describe, expect, it } from 'vitest'
import { advertiserSlug } from '@ph-dsp/types'
import { buildApp } from '../src/http/app'
import { allPositions } from '../src/domain/positions'
import { listAdvertisers } from '../src/routes/admin/advertisers'
import { seedDemo } from '../src/seed/demo'
import { NOW, testContext } from './helpers'

describe('demo estate', () => {
  it('adds the slots, the estate and the roster on top of the base seed', async () => {
    const ctx = await testContext({ bookings: true, demo: true, clock: () => NOW })

    const positions = allPositions(ctx)
    expect(positions.filter((p) => p.displayType.id === 'landscape').map((p) => p.def.label)).toEqual(['Hero slot', 'Supplier slot', 'Whitelist slot', 'Held for Nestlé'])
    expect(positions.filter((p) => p.displayType.id === 'portrait')).toHaveLength(3)
    expect(positions.filter((p) => p.displayType.id === 'menu_board')).toHaveLength(1)
    /* The rotation cap is the slot count, and the loop divides cleanly. */
    expect(ctx.displayTypes.get('landscape')!.playlistSettings).toMatchObject({ maximumCampaignsPlayedInRotation: 4 })
    expect(ctx.displayTypes.get('portrait')!.phExtensions?.venue?.loopLengthSec).toBe(24)
    /* Reserve price: the hero slot overrides, the others inherit. */
    const landscape = ctx.displayTypes.get('landscape')!.phExtensions!
    expect(landscape.reservePrice).toBe(150)
    expect(landscape.slots[0].reservePrice).toBe(220)
    expect(landscape.slots[1].reservePrice).toBeNull()

    expect(ctx.displays.list().length).toBeGreaterThanOrEqual(30)
    expect(ctx.displays.listByDisplayType('landscape').length).toBeGreaterThan(ctx.displays.listByDisplayType('portrait').length)

    const advertisers = await listAdvertisers(ctx)
    expect(advertisers.length).toBeGreaterThanOrEqual(12)
    expect(advertisers.find((a) => a.advertiserId === advertiserSlug('Unilever'))!.via.sort()).toEqual(['Google DSP', 'The Trade Desk'])
    expect(advertisers.find((a) => a.advertiserId === advertiserSlug('Lion'))).toMatchObject({ approvalRequired: true, floorMultiplier: 1.3 })
    /* Every state is represented somewhere. */
    const totals = advertisers.reduce((acc, a) => ({ draft: acc.draft + a.campaigns.draft, awaiting_approval: acc.awaiting_approval + a.campaigns.awaiting_approval, approved: acc.approved + a.campaigns.approved, rejected: acc.rejected + a.campaigns.rejected }), { draft: 0, awaiting_approval: 0, approved: 0, rejected: 0 })
    expect(Object.values(totals).every((n) => n >= 2)).toBe(true)
    expect(await ctx.approvals.statusOf('c_demo_bega_peanut')).toBe('rejected')
    expect(await ctx.approvals.statusOf('c_demo_arnotts_shapes')).toBe('approved')
    expect((ctx.db.prepare('SELECT activation_enabled AS on_ FROM campaigns WHERE id = ?').get('c_demo_arnotts_shapes') as { on_: number }).on_).toBe(0)
  })

  it('books every position in more than one layer, and inventory shows them all', async () => {
    const ctx = await testContext({ bookings: true, demo: true, clock: () => NOW })
    const app = buildApp(ctx)
    const res = await app.inject({ method: 'GET', url: '/api/v1/inventory', headers: { authorization: 'Bearer poc-token-google-dv360' } })
    expect(res.statusCode).toBe(200)
    const ids = res.json().items.map((p: { positionId: string }) => p.positionId)
    expect(ids).toEqual(expect.arrayContaining(['landscape.s1', 'landscape.s2', 'landscape.s4', 'portrait.s1', 'portrait.s2', 'portrait.s3', 'menu_board.s2']))
    /* The whitelist slot is open to whitelisted advertisers only, and Google has some. */
    expect(ids).toContain('landscape.s3')

    const booked = ctx.reservations.byStatus(['won', 'reserved'], new Date(0).toISOString()).filter((r) => !r.testMode)
    const byPosition = new Set(booked.map((r) => r.positionId))
    for (const p of allPositions(ctx)) expect(byPosition.has(p.positionId), `${p.positionId} has a booking`).toBe(true)
    expect(new Set(booked.map((r) => r.pricingType))).toEqual(new Set(['localised', 'personalised', 'interactive']))
    expect(booked.filter((r) => r.type === 'reserve').length).toBeGreaterThan(3)

    const schedule = await app.inject({ method: 'GET', url: '/api/admin/v1/booking-schedule?from=2026-09-21&to=2026-10-31' })
    expect(schedule.statusCode).toBe(200)
    expect(schedule.json().positions.map((p: { positionId: string }) => p.positionId)).toHaveLength(8)
    const layers = new Set(schedule.json().positions.flatMap((p: { windows: { booking: { pricingType: string } | null }[] }) => p.windows.map((w) => w.booking?.pricingType)).filter(Boolean))
    expect(layers).toEqual(new Set(['localised', 'personalised', 'interactive']))
  })

  it('is idempotent', async () => {
    const ctx = await testContext({ bookings: true, demo: true, clock: () => NOW })
    const before = { displays: ctx.displays.list().length, campaigns: ctx.campaigns.listCampaigns().length, reservations: ctx.reservations.byStatus(['won', 'reserved'], new Date(0).toISOString()).length }
    const again = await seedDemo(ctx)
    expect(again).toEqual({ stores: 0, displays: 0, slots: 0, seats: 0, campaigns: 0, bookings: 0 })
    expect({ displays: ctx.displays.list().length, campaigns: ctx.campaigns.listCampaigns().length, reservations: ctx.reservations.byStatus(['won', 'reserved'], new Date(0).toISOString()).length }).toEqual(before)
  })

  it('leaves the base seed alone when not asked for', async () => {
    const ctx = await testContext()
    expect(allPositions(ctx).map((p) => p.positionId)).toEqual(['menu_board.s2'])
    expect(ctx.partners.get('p_ttd')).toBeNull()
  })
})
