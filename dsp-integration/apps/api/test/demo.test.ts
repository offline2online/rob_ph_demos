/* The demo estate (seed/demo.ts, Rob 22 Sep): four advertiser slots on
   Landscape, three on Portrait, a full advertiser roster, campaigns in
   every state and bookings on every position — applied on top of the base
   seed, off by default in every other test, and safe to apply twice. */
import { describe, expect, it } from 'vitest'
import { advertiserSlug } from '@ph-dsp/types'
import { buildApp } from '../src/http/app'
import { allPositions, isRealtime } from '../src/domain/positions'
import { listAdvertisers } from '../src/routes/admin/advertisers'
import { seedDemo } from '../src/seed/demo'
import { NOW, testContext } from './helpers'

describe('demo estate', () => {
  it('adds the slots, the estate and the roster on top of the base seed', async () => {
    const ctx = await testContext({ bookings: true, demo: true, clock: () => NOW })

    const positions = await allPositions(ctx)
    expect(positions.filter((p) => p.displayType.id === 'landscape').map((p) => p.def.label)).toEqual(['Hero slot', 'Supplier slot', 'Whitelist slot', 'Held for Nestlé'])
    expect(positions.filter((p) => p.displayType.id === 'portrait')).toHaveLength(3)
    expect(positions.filter((p) => p.displayType.id === 'menu_board')).toHaveLength(1)
    /* The rotation cap is the slot count, and the loop divides cleanly. */
    expect((await ctx.displayTypes.get('landscape'))!.playlistSettings).toMatchObject({ maximumCampaignsPlayedInRotation: 4 })
    expect((await ctx.displayTypes.get('portrait'))!.phExtensions?.venue?.loopLengthSec).toBe(24)
    /* Floor CPM: the hero slot carries its own, the others inherit the platform floor. */
    const landscape = (await ctx.displayTypes.get('landscape'))!.phExtensions!
    expect(landscape.slots[0].floorCpm).toBe(220)
    expect(landscape.slots[1].floorCpm).toBeUndefined()
    expect(landscape).not.toHaveProperty('reservePrice')

    expect((await ctx.displays.list()).length).toBeGreaterThanOrEqual(30)
    expect((await ctx.displays.listByDisplayType('landscape')).length).toBeGreaterThan((await ctx.displays.listByDisplayType('portrait')).length)

    const advertisers = await listAdvertisers(ctx)
    expect(advertisers.length).toBeGreaterThanOrEqual(11)
    expect(advertisers.find((a) => a.advertiserId === advertiserSlug('Monster Energy'))).toMatchObject({ approvalRequired: true })
    /* Real suppliers to a convenience retailer; the base seed's placeholders are gone. */
    const names = advertisers.map((a) => a.name)
    expect(names).toEqual(expect.arrayContaining(['Coca-Cola', 'PepsiCo', 'Red Bull', 'Monster Energy', 'Gatorade', 'Mars Wrigley', 'Mondelez International', 'The Hershey Company', 'Nestlé', 'Kellanova', 'Frito-Lay']))
    expect(names).not.toContain('Swisse')
    expect(names).not.toContain("L'Oréal")
    expect(names).not.toContain('Unilever')
    expect(names).not.toContain('Blackmores')
    expect(advertisers.filter((a) => a.direct).map((a) => a.name).sort()).toEqual(['Gatorade', 'Red Bull'])
    /* Direct advertisers hold a slot only through their Direct advertiser deals (22 Oct 2026), each with a flight and a price. */
    const portrait = (await ctx.displayTypes.get('portrait'))!.phExtensions!
    expect(portrait.slots.flatMap((s) => s.advertisers)).not.toContain('Red Bull')
    expect(portrait.slots.flatMap((s) => s.advertisers)).not.toContain('Gatorade')
    expect(portrait.slots[2]).toMatchObject({ listMode: 'deal', buyersListIds: ['bl_demo_direct_redbull', 'bl_demo_direct_gatorade'] })
    for (const [id, seatId] of [['bl_demo_direct_redbull', advertiserSlug('Red Bull')], ['bl_demo_direct_gatorade', advertiserSlug('Gatorade')]]) {
      expect(await ctx.buyersLists.get(id)).toMatchObject({ dealType: 'direct', invitedBuyers: [{ partnerId: 'direct', seatId }], floorCpm: expect.any(Number), activeFrom: expect.any(String), activeTo: expect.any(String) })
    }
    /* Every state is represented somewhere. */
    const totals = advertisers.reduce((acc, a) => ({ draft: acc.draft + a.campaigns.draft, awaiting_approval: acc.awaiting_approval + a.campaigns.awaiting_approval, approved: acc.approved + a.campaigns.approved, rejected: acc.rejected + a.campaigns.rejected }), { draft: 0, awaiting_approval: 0, approved: 0, rejected: 0 })
    expect(Object.values(totals).every((n) => n >= 2)).toBe(true)
    expect(await ctx.approvals.statusOf('c_demo_hershey_reeses')).toBe('rejected')
    expect(await ctx.approvals.statusOf('c_demo_gatorade_summer')).toBe('approved')
    expect((ctx.db.prepare('SELECT activation_enabled AS on_ FROM campaigns WHERE id = ?').get('c_demo_gatorade_summer') as { on_: number }).on_).toBe(0)
  })

  it('books every position in more than one layer, and inventory shows them all', async () => {
    const ctx = await testContext({ bookings: true, demo: true, clock: () => NOW })
    const app = buildApp(ctx)
    const res = await app.inject({ method: 'GET', url: '/api/v1/inventory', headers: { authorization: 'Bearer poc-token-google-dv360' } })
    expect(res.statusCode).toBe(200)
    const ids = res.json().items.map((p: { positionId: string }) => p.positionId)
    expect(ids).toEqual(expect.arrayContaining(['landscape.s1', 'landscape.s2', 'landscape.s4', 'portrait.s1', 'portrait.s2', 'menu_board.s2']))
    /* The whitelist slot is open to whitelisted advertisers only, and Google has some. */
    expect(ids).toContain('landscape.s3')

    const booked = (await ctx.reservations.byStatus(['won', 'reserved'], new Date(0).toISOString())).filter((r) => !r.testMode)
    const byPosition = new Set(booked.map((r) => r.positionId))
    /* Sold by window (a private auction, or held for a named advertiser) = booked; open and whitelist-only positions are real time and take no window bookings. */
    /* (The base seed's sample history on menu_board.s2 predates this and stays.) */
    for (const p of await allPositions(ctx)) expect(byPosition.has(p.positionId), `${p.positionId} ${isRealtime(p) ? 'has no window booking (real time)' : 'has a booking'}`).toBe(!isRealtime(p) || p.positionId === 'menu_board.s2')
    expect(new Set(booked.map((r) => r.pricingType))).toEqual(new Set(['localised', 'personalised']))
    expect(booked.filter((r) => r.type === 'reserve').length).toBeGreaterThan(3)

    const schedule = await app.inject({ method: 'GET', url: '/api/admin/v1/booking-schedule?from=2026-09-21&to=2026-10-31' })
    expect(schedule.statusCode).toBe(200)
    expect(schedule.json().positions.map((p: { positionId: string }) => p.positionId)).toHaveLength(8)
    const layers = new Set(schedule.json().positions.flatMap((p: { windows: { booking: { pricingType: string } | null }[] }) => p.windows.map((w) => w.booking?.pricingType)).filter(Boolean))
    expect(layers).toEqual(new Set(['localised', 'personalised']))
  })

  it('is idempotent', async () => {
    const ctx = await testContext({ bookings: true, demo: true, clock: () => NOW })
    const before = { displays: (await ctx.displays.list()).length, campaigns: (await ctx.campaigns.listCampaigns()).length, reservations: (await ctx.reservations.byStatus(['won', 'reserved'], new Date(0).toISOString())).length }
    const again = await seedDemo(ctx)
    expect(again).toEqual({ stores: 0, displays: 0, slots: 0, seats: 0, campaigns: 0, bookings: 0 })
    expect({ displays: (await ctx.displays.list()).length, campaigns: (await ctx.campaigns.listCampaigns()).length, reservations: (await ctx.reservations.byStatus(['won', 'reserved'], new Date(0).toISOString())).length }).toEqual(before)
  })

  it('leaves the base seed alone when not asked for', async () => {
    const ctx = await testContext()
    expect((await allPositions(ctx)).map((p) => p.positionId)).toEqual(['menu_board.s2'])
    expect(await ctx.partners.get('p_ttd')).toBeNull()
  })
})
