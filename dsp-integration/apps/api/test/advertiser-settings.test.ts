import { describe, expect, it } from 'vitest'
import type { DisplayType } from '@ph-dsp/types'
import { buildApp } from '../src/http/app'
import { expectMatchesContract } from './contract'
import { NOW, testContext } from './helpers'
import { biddingClosesAt, biddingOpensAt, nextWindow, windowMs, windowStartOf } from '../src/domain/positions'
import { promotePendingPlayWindowIfDue } from '../src/exchange/scheduler'

const input = {
  currency: 'NZD', floorCpm: 120, interactiveCpe: 1.25,
  auctionOpensHours: 72, playWindowHours: 168, auctionCutoffTime: '20:30',
  categoryWhitelist: ['Food & Drink'], categoryBlacklist: ['Finance'],
}

/* The seeded slot's own assignment, when a test is only changing targeting. */
const KEEP = { partnerIds: ['p_google'], advertisers: [], whitelistOnly: false }

describe('Advertiser settings (spec §4, §6)', () => {
  it('saves pricing and category lists, trimming and de-duplicating entries', async () => {
    const app = buildApp(await testContext())
    const res = await app.inject({ method: 'PUT', url: '/api/admin/v1/advertiser-settings', payload: input })
    expect(res.statusCode).toBe(200)
    expectMatchesContract('PUT', '/admin/v1/advertiser-settings', 200, res.json())
    expect(res.json()).toMatchObject({ currency: 'NZD', floorCpm: 120, categoryWhitelist: ['Food & Drink'], categoryBlacklist: ['Finance'] })
    /* No advertiser lists at company level: they belong to each DSP. */
    expect(res.json()).not.toHaveProperty('advertiserWhitelist')
    expect(res.json()).not.toHaveProperty('advertiserBlacklist')
  })

  it('refuses a category that is not in the IAB taxonomy, and stores the canonical spelling', async () => {
    const app = buildApp(await testContext())
    const bad = await app.inject({ method: 'PUT', url: '/api/admin/v1/advertiser-settings', payload: { ...input, categoryWhitelist: ['Food & Drink', 'Gadgets'], categoryBlacklist: ['finance', 'Red Bull'] } })
    expect(bad.statusCode).toBe(400)
    expect(bad.json().error.details).toEqual([
      { field: 'categoryWhitelist', reason: expect.stringContaining('Gadgets is not an IAB category') },
      { field: 'categoryBlacklist', reason: expect.stringContaining('Red Bull is not an IAB category') },
    ])
    const ok = await app.inject({ method: 'PUT', url: '/api/admin/v1/advertiser-settings', payload: { ...input, categoryWhitelist: ['food & drink'], categoryBlacklist: ['FINANCE'] } })
    expect(ok.statusCode).toBe(200)
    expect(ok.json()).toMatchObject({ categoryWhitelist: ['Food & Drink'], categoryBlacklist: ['Finance'] })
  })

  it('rejects an entry on both category lists (case-insensitive), a non-ISO currency and a non-positive floor', async () => {
    const app = buildApp(await testContext())
    const res = await app.inject({ method: 'PUT', url: '/api/admin/v1/advertiser-settings', payload: { ...input, currency: 'XYZ1', floorCpm: 0, categoryBlacklist: ['food & drink'] } })
    expect(res.statusCode).toBe(400)
    expectMatchesContract('PUT', '/admin/v1/advertiser-settings', 400, res.json())
    expect(res.json().error.details.map((d: { field: string }) => d.field)).toEqual(['currency', 'floorCpm', 'categoryWhitelist'])
  })

  it('saves the auction schedule, and validates it', async () => {
    const app = buildApp(await testContext())
    const ok = await app.inject({ method: 'PUT', url: '/api/admin/v1/advertiser-settings', payload: input })
    expect(ok.json()).toMatchObject({ auctionOpensHours: 72, playWindowHours: 168, auctionCutoffTime: '20:30' })
    const bad = await app.inject({ method: 'PUT', url: '/api/admin/v1/advertiser-settings', payload: { ...input, auctionOpensHours: 0, playWindowHours: 1.5, auctionCutoffTime: '24:00' } })
    expect(bad.json().error.details.map((d: { field: string }) => d.field)).toEqual(['auctionOpensHours', 'playWindowHours', 'auctionCutoffTime'])
  })

  /* Rob's board ticket, 26 Sep 2026: a length change while windows are still
     active no longer errors out — it's accepted and deferred, with the
     admin told exactly when it takes effect. */
  it('defers a play-window length change while a window is still bid on or booked, and says when it takes effect', async () => {
    const ctx = await testContext({ clock: () => NOW })
    await ctx.reservations.insert({
      id: 'r1', partnerId: 'p_google', advertiserId: 'nestle', campaignId: 'c_dsp_nestle', positionId: 'menu_board.s2', windowStart: '2026-09-22T00:00:00.000Z',
      type: 'bid', channel: 'api', bidCpm: 120, currency: 'AUD', status: 'pending', clearingCpm: null, reason: null, testMode: false, pricingType: 'localised', handedOffAt: null,
    })
    const res = await buildApp(ctx).inject({ method: 'PUT', url: '/api/admin/v1/advertiser-settings', payload: input })
    expect(res.statusCode).toBe(200)
    expectMatchesContract('PUT', '/admin/v1/advertiser-settings', 200, res.json())
    /* Untouched — the seeded 24-hour length — until r1's window (starting
       2026-09-22, so ending 2026-09-23) has played. */
    expect(res.json()).toMatchObject({ playWindowHours: 24, pendingPlayWindowHours: 168, pendingPlayWindowEffectiveFrom: '2026-09-23T00:00:00.000Z' })

    /* A Test-mode bid never blocks or defers anything (spec §7: no real spend). */
    await ctx.reservations.update('r1', { status: 'lost' })
    await ctx.reservations.insert({
      id: 'r2', partnerId: 'p_google', advertiserId: 'nestle', campaignId: 'c_dsp_nestle', positionId: 'menu_board.s2', windowStart: '2026-09-24T00:00:00.000Z',
      type: 'bid', channel: 'api', bidCpm: 120, currency: 'AUD', status: 'won', clearingCpm: 120, reason: null, testMode: true, pricingType: 'localised', handedOffAt: null,
    })
    const immediate = await buildApp(ctx).inject({ method: 'PUT', url: '/api/admin/v1/advertiser-settings', payload: { ...input, playWindowHours: 48 } })
    expect(immediate.json()).toMatchObject({ playWindowHours: 48, pendingPlayWindowHours: null, pendingPlayWindowEffectiveFrom: null })
  })

  it('promotes a deferred play-window length change once every active window has played — waiting longer if a booking made since runs later', async () => {
    let now = NOW
    const ctx = await testContext({ clock: () => now })
    await ctx.reservations.insert({
      id: 'r1', partnerId: 'p_google', advertiserId: 'nestle', campaignId: 'c_dsp_nestle', positionId: 'menu_board.s2', windowStart: '2026-09-22T00:00:00.000Z',
      type: 'bid', channel: 'api', bidCpm: 120, currency: 'AUD', status: 'pending', clearingCpm: null, reason: null, testMode: false, pricingType: 'localised', handedOffAt: null,
    })
    const saved = await buildApp(ctx).inject({ method: 'PUT', url: '/api/admin/v1/advertiser-settings', payload: input })
    expect(saved.json()).toMatchObject({ playWindowHours: 24, pendingPlayWindowHours: 168, pendingPlayWindowEffectiveFrom: '2026-09-23T00:00:00.000Z' })

    /* Before the effective date: nothing happens. */
    expect(await promotePendingPlayWindowIfDue(ctx)).toBeNull()
    expect((await ctx.company.get()).playWindowHours).toBe(24)

    /* r1's window has played by the effective date, but a booking made since
       (still under the old, unpromoted length) runs later — the change waits
       for that one too, and the effective date moves out to cover it. */
    await ctx.reservations.insert({
      id: 'r2', partnerId: 'p_google', advertiserId: 'nestle', campaignId: 'c_dsp_nestle', positionId: 'menu_board.s2', windowStart: '2026-09-25T00:00:00.000Z',
      type: 'reserve', channel: 'api', bidCpm: 120, currency: 'AUD', status: 'won', clearingCpm: 120, reason: null, testMode: false, pricingType: 'localised', handedOffAt: null,
    })
    now = new Date('2026-09-23T00:00:00.000Z')
    expect(await promotePendingPlayWindowIfDue(ctx)).toBeNull()
    expect((await ctx.company.get()).playWindowHours).toBe(24)
    expect((await ctx.company.get()).pendingPlayWindowEffectiveFrom).toBe('2026-09-26T00:00:00.000Z')

    /* r2 has played too, by its own (pushed-out) effective date: the change lands. */
    now = new Date('2026-09-26T00:00:00.000Z')
    expect(await promotePendingPlayWindowIfDue(ctx)).toBe(168)
    expect(await ctx.company.get()).toMatchObject({ playWindowHours: 168, pendingPlayWindowHours: null, pendingPlayWindowEffectiveFrom: null })
  })

  it('drives the play windows: length, the daily cutoff when the auction runs, and when bidding opens', async () => {
    const ctx = await testContext({ clock: () => NOW })
    /* Defaults: 24-hour windows, cutoff 18:00 UTC, bidding opens 7 days before the cutoff. */
    const w = new Date('2026-09-22T00:00:00.000Z')
    expect((await biddingClosesAt(ctx, w)).toISOString()).toBe('2026-09-21T18:00:00.000Z')
    expect((await biddingOpensAt(ctx, w)).toISOString()).toBe('2026-09-14T18:00:00.000Z')
    expect((await nextWindow(ctx)).toISOString()).toBe('2026-09-21T00:00:00.000Z')
    /* A midnight cutoff: the auction runs as the window starts. */
    await ctx.company.save({ ...(await ctx.company.get()), auctionCutoffTime: '00:00' })
    expect((await biddingClosesAt(ctx, w)).toISOString()).toBe('2026-09-22T00:00:00.000Z')
    /* 7-day windows run Monday to Monday. */
    await ctx.company.save({ ...(await ctx.company.get()), playWindowHours: 168, auctionCutoffTime: '18:00' })
    expect(windowStartOf(NOW, await windowMs(ctx)).toISOString()).toBe('2026-09-14T00:00:00.000Z')
    expect((await nextWindow(ctx)).toISOString()).toBe('2026-09-21T00:00:00.000Z')
  })

  it('Available Inventory lists every advertiser-owned slot, with no advertisers column', async () => {
    const res = await buildApp(await testContext()).inject({ method: 'GET', url: '/api/admin/v1/available-inventory' })
    expectMatchesContract('GET', '/admin/v1/available-inventory', 200, res.json())
    expect(res.json().items).toEqual([{
      displayTypeId: 'menu_board', displayTypeName: 'Menu Board — Long Format', touchPoint: 'Digital Signage', playlistName: 'Menu Board — Long Format / Zone 1', playlistId: 'pl_zone_menu_board_1', unassigned: false, scored: true, unsellableReason: null, salesLocked: false, salesLockedUntil: null, slot: 2, zoneSlot: 2, position: 'Supplier slot',
      assignedTo: { partnerIds: ['p_google'], partnerNames: ['Google DSP'], advertisers: [], whitelistOnly: false, buyersListId: null, buyersListName: null }, qrControl: true, visionAi: true, supportedTargeting: ['localised'],
      reservePrice: null, reservePriceOverride: null, displayTypeReservePrice: null, interactiveReservePrice: null, interactiveReservePriceOverride: null,
      billingUnitHours: 24, billingUnitHoursOverride: null, displayTypeBillingUnitHours: null, companyPlayWindowHours: 24,
      maxCampaigns: 5, maxCampaignsOverride: null, displayTypeMaxCampaigns: null,
    }])
    /* The picker behind Assigned to: every DSP and the advertisers it brings. */
    expect(res.json().dsps[0]).toMatchObject({ partnerId: 'p_google', name: 'Google DSP', advertisers: [{ advertiserId: 'nestle', name: 'Nestlé' }, { advertiserId: 'swisse', name: 'Swisse' }] })
  })

  /* Ticket, 28 Sep 2026 — Rob's end-to-end check: a Menu Board with three
     zones and two Advertiser slots a zone is six positions on Available
     Inventory, each under its zone's own playlist; take a zone away and its
     positions go with it; put it back and they're back. Each zone runs its
     own playlist, so each has its own rotation and its own slots (one
     segment per zone in the display type's slot list) — not one shared
     rotation the zones were "tagged" onto. */
  it('lists one position per advertiser slot per zone, and follows a zone being removed and added back', async () => {
    const ctx = await testContext()
    const app = buildApp(ctx)
    const record = async () => (await ctx.displayTypes.get('menu_board')) as DisplayType
    const zonesOf = (dt: DisplayType) => (dt.multiZone as { zones: { id: string; name: string; playlistId: string; maximumCampaignsPlayedInRotation?: number | null }[] }).zones
    const saveZones = async (zones: unknown[]) => app.inject({ method: 'PUT', url: '/api/admin/v1/display-types/menu_board/record', payload: { ...(await record()), multiZone: { enabled: true, zones } } })
    const saveSlots = (zoneIds: string[]) => app.inject({
      method: 'PUT', url: '/api/admin/v1/display-types/menu_board/extensions',
      payload: { slots: zoneIds.flatMap((zoneId) => [{ label: 'Slot 1', owner: 'advertiser', zoneId }, { label: 'Slot 2', owner: 'advertiser', zoneId }]) },
    })
    const rows = async () => {
      const res = await app.inject({ method: 'GET', url: '/api/admin/v1/available-inventory' })
      expectMatchesContract('GET', '/admin/v1/available-inventory', 200, res.json())
      return (res.json().items as { slot: number; zoneSlot: number; playlistId: string; position: string }[]).map((r) => [r.slot, r.zoneSlot, r.playlistId, r.position])
    }
    const three = zonesOf(await record()).map((z) => ({ ...z, maximumCampaignsPlayedInRotation: 2 }))

    expect((await saveZones(three)).statusCode).toBe(200)
    expect((await saveSlots(['z1', 'z2', 'z3'])).statusCode).toBe(200)
    /* Scored, so the positions are sellable (an unscored slot is not exposed). */
    for (let s = 1; s <= 6; s++) ctx.db.prepare('INSERT INTO audience_vacd (display_type_id, slot, assumed_views_per_window, counted) VALUES (?, ?, ?, 0) ON CONFLICT DO NOTHING').run('menu_board', s, 500)
    /* slot is the flat position across all three zones (1-6); zoneSlot
       resets to 1 at the start of each zone's own segment — this is what
       Available Inventory's Slot column actually displays (ticket, 28 Sep
       2026), since each zone runs its own separate playlist/rotation and a
       flat "slot 4" means nothing on Zone 2's own two-slot rotation. */
    expect(await rows()).toEqual([
      [1, 1, 'pl_zone_menu_board_1', 'Slot 1'], [2, 2, 'pl_zone_menu_board_1', 'Slot 2'],
      [3, 1, 'pl_zone_menu_board_2', 'Slot 1'], [4, 2, 'pl_zone_menu_board_2', 'Slot 2'],
      [5, 1, 'pl_zone_menu_board_3', 'Slot 1'], [6, 2, 'pl_zone_menu_board_3', 'Slot 2'],
    ])
    /* Each position's share of voice is of its own zone's two-slot rotation, not of all six. */
    const partner = await buildApp(ctx).inject({ method: 'GET', url: '/api/v1/inventory/menu_board.s5', headers: { authorization: 'Bearer poc-token-google-dv360' } })
    expect(partner.statusCode).toBe(200)
    expect(partner.json().screen.shareOfVoice).toBe(0.5)

    /* Zone 3 removed: its two positions go with it. */
    expect((await saveZones(three.slice(0, 2))).statusCode).toBe(200)
    expect((await saveSlots(['z1', 'z2'])).statusCode).toBe(200)
    expect((await rows()).map((r) => r[2])).toEqual(['pl_zone_menu_board_1', 'pl_zone_menu_board_1', 'pl_zone_menu_board_2', 'pl_zone_menu_board_2'])

    /* Added back: six again. */
    expect((await saveZones(three)).statusCode).toBe(200)
    expect((await saveSlots(['z1', 'z2', 'z3'])).statusCode).toBe(200)
    expect((await rows()).map((r) => r[2])).toEqual(['pl_zone_menu_board_1', 'pl_zone_menu_board_1', 'pl_zone_menu_board_2', 'pl_zone_menu_board_2', 'pl_zone_menu_board_3', 'pl_zone_menu_board_3'])
  })

  /* "Unassigned": the display type has advertiser slots but no physical
     display is using it yet, so nothing is actually playing them — same
     "no displays" signal windowStatus (positions.ts) already uses to mark a
     position unavailable on the Partner API, surfaced here for the retailer. */
  it('flags Available Inventory rows as unassigned when their display type has no physical display', async () => {
    const ctx = await testContext()
    const app = buildApp(ctx)
    /* Displays are read-only here (Displays & Devices owns them for real —
       PH-CORE-BOUNDARIES.md, DisplaySource); removing one for the test is a
       direct DB write, the same way delete-display-type.test.ts does. */
    ctx.db.prepare("DELETE FROM displays WHERE display_type_id = 'menu_board'").run()
    const res = await app.inject({ method: 'GET', url: '/api/admin/v1/available-inventory' })
    expect(res.json().items.find((i: { slot: number }) => i.slot === 2)).toMatchObject({ unassigned: true })
  })

  /* Reserve price: real inheritance (Rob, 22 Sep; spec §1 configuration
     inheritance), replacing an earlier "copy to every slot" design that
     failed testing for not actually running the inheritance. A display
     type's own default reaches every slot that has no override of its
     own; an override always wins. */
  it('inherits a reserve price from its display type, lets a slot override it, and publishes the resolved value', async () => {
    const ctx = await testContext()
    const app = buildApp(ctx)
    /* A second Advertiser slot on the same display type, so the default
       has more than one slot to reach. */
    const ext = (await ctx.displayTypes.get('menu_board'))!.phExtensions!
    await ctx.displayTypes.saveExtensions('menu_board', { ...ext, slots: [...ext.slots, { label: 'Supplier slot 2', owner: 'advertiser' as const, partnerIds: ['p_google'], advertisers: [], listMode: 'rtb' as const }] })
    const row = (slot: number, reservePrice: number | null, reservePriceDefault: number | null) =>
      ({ displayTypeId: 'menu_board', slot, supportedTargeting: ['localised'], assignedTo: KEEP, reservePrice, reservePriceDefault })
    const save = (items: ReturnType<typeof row>[]) => app.inject({ method: 'PUT', url: '/api/admin/v1/available-inventory', payload: { items } })
    const at = (json: { items: { slot: number }[] }, slot: number) => json.items.find((i) => i.slot === slot)

    /* Neither slot overrides: setting the default on both rows reaches both. */
    const set = await save([row(2, null, 5), row(4, null, 5)])
    expect(set.statusCode).toBe(200)
    expectMatchesContract('PUT', '/admin/v1/available-inventory', 200, set.json())
    expect(at(set.json(), 2)).toMatchObject({ reservePrice: 5, reservePriceOverride: null, displayTypeReservePrice: 5 })
    expect(at(set.json(), 4)).toMatchObject({ reservePrice: 5, reservePriceOverride: null, displayTypeReservePrice: 5 })
    expect((await ctx.displayTypes.get('menu_board'))!.phExtensions!.reservePrice).toBe(5)

    /* Override slot 2 only: it wins there; slot 4 keeps following the default. */
    const overridden = await save([row(2, 8, 5), row(4, null, 5)])
    expect(at(overridden.json(), 2)).toMatchObject({ reservePrice: 8, reservePriceOverride: 8, displayTypeReservePrice: 5 })
    expect(at(overridden.json(), 4)).toMatchObject({ reservePrice: 5, reservePriceOverride: null, displayTypeReservePrice: 5 })

    /* Published on the position — the resolved value, not the raw override. */
    const positions = await app.inject({ method: 'GET', url: '/api/v1/inventory', headers: { authorization: 'Bearer poc-token-google-dv360' } })
    expect(positions.json().items.find((p: { positionId: string }) => p.positionId === 'menu_board.s2').reservePrice).toBe(8)

    /* Clearing the override returns the slot to following the default. */
    const cleared = await save([row(2, null, 5), row(4, null, 5)])
    expect(at(cleared.json(), 2)).toMatchObject({ reservePrice: 5, reservePriceOverride: null })

    /* Rejected: a negative value, and rows for one display type disagreeing on its default. */
    const bad = await save([row(2, -1, 5), row(4, null, 6)])
    expect(bad.statusCode).toBe(400)
    expect(bad.json().error.details).toEqual([
      { field: 'items[0].reservePrice', reason: 'A CPM of 0 or more, or null for no reserve.' },
      { field: 'items[1].reservePriceDefault', reason: 'All slots on a display type must submit the same reserve price default.' },
    ])
  })

  /* Interactive reserve price (ticket 5eLDRBqEGhNyJSHSIFFG): a slot-only
     price for interactive campaigns, falling back to the ordinary reserve
     price, and only kept while the slot supports interactive targeting. */
  it('saves an interactive reserve price per slot, falling back to the reserve price and dropping it with interactive', async () => {
    const ctx = await testContext()
    const app = buildApp(ctx)
    const row = (supportedTargeting: string[], interactiveReservePrice?: number | null) =>
      ({ displayTypeId: 'menu_board', slot: 2, supportedTargeting, assignedTo: KEEP, reservePrice: 5, reservePriceDefault: null, ...(interactiveReservePrice === undefined ? {} : { interactiveReservePrice }) })
    const save = (item: ReturnType<typeof row>) => app.inject({ method: 'PUT', url: '/api/admin/v1/available-inventory', payload: { items: [item] } })
    const at = (json: { items: { slot: number }[] }) => json.items.find((i) => i.slot === 2)
    const modes = ['localised', 'interactive']
    const set = await save(row(modes, 9))
    expect(set.statusCode).toBe(200)
    expectMatchesContract('PUT', '/admin/v1/available-inventory', 200, set.json())
    expect(at(set.json())).toMatchObject({ reservePrice: 5, interactiveReservePrice: 9, interactiveReservePriceOverride: 9 })
    /* Omitted keeps it; null falls back to the ordinary reserve price. */
    expect(at((await save(row(modes))).json())).toMatchObject({ interactiveReservePriceOverride: 9 })
    expect(at((await save(row(modes, null))).json())).toMatchObject({ interactiveReservePrice: 5, interactiveReservePriceOverride: null })
    /* Dropped when the slot stops supporting interactive. */
    await save(row(modes, 9))
    expect(at((await save(row(['localised'], 9))).json())).toMatchObject({ interactiveReservePriceOverride: null })
    expect((await save(row(modes, -1))).statusCode).toBe(400)
  })

  /* Max campaigns (ticket "Available Inventory: Max campaigns column + slot
     playlist statement"): same override-always-wins inheritance as reserve
     price above, but always resolves to a real integer (the platform
     default of 5), bounded 1-10. Purely a submission cap — proved directly
     against POST /v1/campaigns in campaigns.test.ts. */
  it('inherits a max campaigns cap from its display type, lets a slot override it, and bounds it 1-10', async () => {
    const ctx = await testContext()
    const app = buildApp(ctx)
    const row = (slot: number, maxCampaigns: number | null, maxCampaignsDefault: number | null) =>
      ({ displayTypeId: 'menu_board', slot, supportedTargeting: ['localised'], assignedTo: KEEP, maxCampaigns, maxCampaignsDefault })
    const save = (items: ReturnType<typeof row>[]) => app.inject({ method: 'PUT', url: '/api/admin/v1/available-inventory', payload: { items } })
    const at = (json: { items: { slot: number }[] }, slot: number) => json.items.find((i) => i.slot === slot)

    /* Nothing set: the platform default of 5 applies. */
    const untouched = await app.inject({ method: 'GET', url: '/api/admin/v1/available-inventory' })
    expect(at(untouched.json(), 2)).toMatchObject({ maxCampaigns: 5, maxCampaignsOverride: null, displayTypeMaxCampaigns: null })

    /* Setting the default on the one Advertiser slot on menu_board reaches it. */
    const set = await save([row(2, null, 8)])
    expect(set.statusCode).toBe(200)
    expectMatchesContract('PUT', '/admin/v1/available-inventory', 200, set.json())
    expect(at(set.json(), 2)).toMatchObject({ maxCampaigns: 8, maxCampaignsOverride: null, displayTypeMaxCampaigns: 8 })
    expect((await ctx.displayTypes.get('menu_board'))!.phExtensions!.maxCampaigns).toBe(8)

    /* Overriding the slot wins over the default. */
    const overridden = await save([row(2, 3, 8)])
    expect(at(overridden.json(), 2)).toMatchObject({ maxCampaigns: 3, maxCampaignsOverride: 3, displayTypeMaxCampaigns: 8 })

    /* Rejected: out of the 1-10 range, and a non-integer. */
    const bad = await save([row(2, 11, 8)])
    expect(bad.statusCode).toBe(400)
    expect(bad.json().error.details).toEqual([{ field: 'items[0].maxCampaigns', reason: 'An integer from 1 to 10, or null to inherit.' }])
    const bad2 = await app.inject({ method: 'PUT', url: '/api/admin/v1/available-inventory', payload: { items: [{ ...row(2, 0.5, 8) }] } })
    expect(bad2.json().error.details).toEqual([{ field: 'items[0].maxCampaigns', reason: 'An integer from 1 to 10, or null to inherit.' }])
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
    expect((await ctx.displayTypes.get('menu_board'))!.phExtensions!.slots[1].supportedTargeting).toEqual(['localised', 'interactive'])

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
      .toEqual({ partnerIds: [], partnerNames: [], advertisers: [], whitelistOnly: false, buyersListId: null, buyersListName: null })
    expect((await ctx.displayTypes.get('menu_board'))!.phExtensions!.slots[1].listMode).toBe('rtb')

    /* Several DSPs at once. */
    expect(assigned(await save({ partnerIds: ['p_google', 'p_amazon'], advertisers: [], whitelistOnly: false })))
      .toMatchObject({ partnerIds: ['p_google', 'p_amazon'], partnerNames: ['Google DSP', 'Amazon Ads DSP'] })

    /* Named advertisers: held for them, and their DSP comes along. */
    const named = await save({ partnerIds: [], advertisers: ['Nestlé', 'Swisse'], whitelistOnly: false })
    expect(assigned(named)).toMatchObject({ advertisers: ['Nestlé', 'Swisse'], partnerIds: ['p_google'], whitelistOnly: false })
    expect((await ctx.displayTypes.get('menu_board'))!.phExtensions!.slots[1].listMode).toBe(null)
    expect((await buildApp(ctx).inject({ method: 'GET', url: '/api/v1/inventory/menu_board.s2', headers: { authorization: 'Bearer poc-token-google-dv360' } })).statusCode).toBe(200)

    /* The whitelist instead. */
    await ctx.partners.update('p_google', { allowList: ['5130001'] })
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
    await ctx.partners.update('p_google', { allowList: [] })
    await ctx.partners.update('p_amazon', { allowList: [] })
    expect(await fields({ partnerIds: [], advertisers: [], whitelistOnly: true })).toEqual(['items[0].assignedTo.whitelistOnly'])

    /* A blocked advertiser can't be added, but one already held stays. */
    expect((await save({ partnerIds: [], advertisers: ['Nestlé'], whitelistOnly: false })).statusCode).toBe(200)
    await ctx.partners.update('p_google', { blockList: ['5130001'] })
    expect((await save({ partnerIds: [], advertisers: ['Nestlé'], whitelistOnly: false })).statusCode).toBe(200)
    /* Once the position is held for someone else, Nestlé can't come back. */
    expect((await save({ partnerIds: [], advertisers: ['Swisse'], whitelistOnly: false })).statusCode).toBe(200)
    expect(await fields({ partnerIds: [], advertisers: ['Nestlé', 'Swisse'], whitelistOnly: false })).toEqual(['items[0].assignedTo.advertisers'])
  })

  /* Interactive needs something for the visitor to scan (Rob, 20 Sep). */
  it('only supports interactive targeting where QR Control is enabled', async () => {
    const ctx = await testContext()
    const app = buildApp(ctx)
    const save = () => app.inject({ method: 'PUT', url: '/api/admin/v1/available-inventory', payload: { items: [{ displayTypeId: 'menu_board', slot: 2, supportedTargeting: ['localised', 'interactive'], assignedTo: KEEP }] } })
    expect((await save()).statusCode).toBe(200)

    const dt = (await ctx.displayTypes.get('menu_board'))!
    await ctx.displayTypes.saveRecord('menu_board', { ...dt, qrControl: { ...(dt.qrControl as object), enabled: false } })
    const res = await save()
    expect(res.statusCode).toBe(400)
    expect(res.json().error.details).toEqual([{ field: 'items[0].supportedTargeting', reason: 'QR Control is required to support an interactive engagement.' }])
    /* And the table says which display types have it, so the UI can grey the option. */
    const rows = (await app.inject({ method: 'GET', url: '/api/admin/v1/available-inventory' })).json()
    expect(rows.items.find((r: { displayTypeId: string }) => r.displayTypeId === 'menu_board').qrControl).toBe(false)
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
