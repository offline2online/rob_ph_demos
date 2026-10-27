import { describe, expect, it } from 'vitest'
import { runBilling } from '../src/exchange/billing'
import { buildApp } from '../src/http/app'
import type { ReservationRecord } from '../src/repos/ReservationRepo'
import { approvalOf } from '../src/routes/admin/bookingSchedule'
import { defaultVacdOf } from '../src/domain/displayTypes'
import { HOURS_PER_WEEK } from '../src/domain/vacdProfile'
import { expectMatchesContract } from './contract'
import { NOW, sellByWindow, testContext } from './helpers'

const booking = (over: Partial<ReservationRecord>): ReservationRecord => ({
  id: 'r_x', partnerId: 'p_google', advertiserId: 'swisse', campaignId: 'c_api_swisse', positionId: 'menu_board.s2', windowStart: '2026-09-22T00:00:00.000Z',
  type: 'reserve', channel: 'api', bidCpm: 175, currency: 'AUD', status: 'reserved', clearingCpm: 175, reason: null, testMode: false, pricingType: 'localised', handedOffAt: null, ...over,
})

const setup = async (flag = true) => {
  const ctx = await testContext({ clock: () => NOW, flag })
  const app = buildApp(ctx)
  return { ctx, get: (q = '') => app.inject({ method: 'GET', url: `/api/admin/v1/booking-schedule${q}` }) }
}

describe('GET /admin/v1/booking-schedule', () => {
  it('shows every advertiser slot across the current window and the next 13', async () => {
    const { get } = await setup()
    const res = await get()
    expect(res.statusCode).toBe(200)
    expectMatchesContract('GET', '/admin/v1/booking-schedule', 200, res.json())
    const body = res.json()
    expect(body.windows).toHaveLength(14)
    /* Booked amounts are USD whatever the instance reports in (spec section 4). */
    expect(body.currency).toBe('USD')
    expect(body.windows[0]).toEqual({ start: '2026-09-20T00:00:00.000Z', end: '2026-09-21T00:00:00.000Z' })
    expect(body.positions.map((p: { positionId: string }) => p.positionId)).toEqual(['menu_board.s2'])
    expect(body.positions[0]).toMatchObject({ displayTypeName: 'Menu Board — Long Format', slot: 2, slotLabel: 'Supplier slot', partnerNames: ['Google DSP'], assignment: 'rtb' })
    /* Ticket vhRFN1K3N4Giw1Z0OEI6: an open position is sold per impression, so no window reads "available". */
    expect(body.positions[0]).toMatchObject({ realTime: true, recentPlays: 0 })
    expect(body.positions[0].windows.every((w: { status: string }) => w.status === 'unavailable')).toBe(true)
    /* Ticket 1n6upwMWSLGxszhg5u7k: an open (real-time) position is never pre-booked, so its windows are not "sellable" and % sold is a dash, not 0%. */
    expect(body.totals).toEqual({ bookedWindows: 0, sellableWindows: 0, bookedRevenue: 0, billedRevenue: 0, realtimeOpportunities: 0, realtimeFilled: 0, totalViews: 0, bookedViews: 0, availableViews: 0, availableWindows: 0, availableValue: 0 })
    expect(body.revenue[0]).toMatchObject({ displayTypeId: 'menu_board', bookedWindows: 0, sellableWindows: 0 })
  })

  /* Ticket vhRFN1K3N4Giw1Z0OEI6 (8 Oct 2026): an open position has no forward grid; it reports recent live plays instead. */
  it('flags an open position real-time with its last-7-day plays and no forward windows, and a deal position not', async () => {
    const { ctx, get } = await setup()
    const open = (await get()).json().positions[0]
    expect(open).toMatchObject({ assignment: 'rtb', realTime: true, recentPlays: 0 })
    expect(open.windows.every((w: { status: string; booking: unknown }) => w.status === 'unavailable' && w.booking === null)).toBe(true)
    const imp = (id: string, over: Record<string, unknown>) => ctx.impressions.insert({
      id, positionId: 'menu_board.s2', displayId: 'd1', windowStart: '2026-09-20T00:00:00.000Z', requestedAt: NOW.toISOString(), status: 'played', reason: null,
      partnerId: null, advertiserId: null, campaignId: null, crid: null, clearingCpm: 5, currency: 'AUD', testMode: false, assetVersion: null, expiresAt: null,
      playedAt: NOW.toISOString(), bidRequests: 1, elapsedMs: 1, creativeUrl: null, creativeSource: null, contentHash: null, reviewNote: null, ...over,
    })
    await imp('i1', {})
    await imp('i2', {})
    await imp('i3', { testMode: true })
    await imp('i4', { playedAt: new Date(NOW.getTime() - 8 * 86_400_000).toISOString() })
    await imp('i5', { status: 'filled', playedAt: null })
    expect((await get()).json().positions[0].recentPlays).toBe(2)
    await sellByWindow(ctx, 'menu_board', 2)
    expect((await get()).json().positions[0]).toMatchObject({ assignment: 'deal', realTime: false, recentPlays: null })
  })

  /* Ticket bhiyhqKpLPBDlySEfGNB: a display type with only real-time positions shows an expected fill from the last 7 days instead of only a dash. */
  it('reports the last 7 days\' fill for real-time inventory as an expected fill, narrowed by the advertiser filter', async () => {
    const { ctx, get } = await setup()
    const imp = (id: string, over: Record<string, unknown>) => ctx.impressions.insert({
      id, positionId: 'menu_board.s2', displayId: 'd1', windowStart: '2026-09-20T00:00:00.000Z', requestedAt: NOW.toISOString(), status: 'played', reason: null,
      partnerId: 'p_google', advertiserId: 'nestle', campaignId: null, crid: null, clearingCpm: 5, currency: 'AUD', testMode: false, assetVersion: null, expiresAt: null,
      playedAt: NOW.toISOString(), bidRequests: 1, elapsedMs: 1, creativeUrl: null, creativeSource: null, contentHash: null, reviewNote: null, ...over,
    })
    await imp('f1', {})
    await imp('f2', { status: 'filled', playedAt: null, advertiserId: 'swisse' })
    await imp('f3', { status: 'no_fill', playedAt: null, partnerId: null, advertiserId: null })
    await imp('f4', { status: 'no_fill', playedAt: null, partnerId: null, advertiserId: null })
    await imp('f5', { testMode: true })
    await imp('f6', { requestedAt: new Date(NOW.getTime() - 8 * 86_400_000).toISOString() })
    const body = (await get()).json()
    expectMatchesContract('GET', '/admin/v1/booking-schedule', 200, body)
    /* 2 of 4 live opportunities filled; % sold stays a dash (no sellable windows). */
    expect(body.revenue[0]).toMatchObject({ sellableWindows: 0, bookedWindows: 0, realtimeOpportunities: 4, realtimeFilled: 2 })
    expect(body.totals).toMatchObject({ realtimeOpportunities: 4, realtimeFilled: 2 })
    /* One advertiser: its fills over the same opportunities. */
    expect((await get('?advertiserId=nestle')).json().revenue[0]).toMatchObject({ realtimeOpportunities: 4, realtimeFilled: 1 })
    expect((await get('?partnerId=p_google')).json().revenue[0]).toMatchObject({ realtimeOpportunities: 4, realtimeFilled: 2 })
    /* A deal position is booked ahead: no expected fill. */
    await sellByWindow(ctx, 'menu_board', 2)
    expect((await get()).json().revenue[0]).toMatchObject({ realtimeOpportunities: 0, realtimeFilled: 0 })
  })

  it('counts sellable windows only over booked-ahead (deal) positions', async () => {
    const { ctx, get } = await setup()
    await sellByWindow(ctx, 'menu_board', 2)
    const body = (await get()).json()
    expect(body.positions[0]).toMatchObject({ assignment: 'deal' })
    expect(body.totals).toEqual({ bookedWindows: 0, sellableWindows: 13, bookedRevenue: 0, billedRevenue: 0, realtimeOpportunities: 0, realtimeFilled: 0, totalViews: 16068, bookedViews: 0, availableViews: 16068, availableWindows: 13, availableValue: 1606.8 })
  })

  /* A0GyTNsA (1 Oct 2026): a multi-zone display type's slot is numbered
     within its zone, as Available Inventory numbers it; positionId keeps
     the flat index. */
  it('numbers a multi-zone slot within its zone', async () => {
    const { ctx, get } = await setup()
    const first = (await get()).json().positions[0]
    expect(first).toMatchObject({ positionId: 'menu_board.s2', slot: 2, zoneName: 'Zone 1', zoneSlot: 2 })
    /* Move the advertiser slot into Zone 2: it is Zone 2's first slot, still position s2. */
    const ext = (await ctx.displayTypes.get('menu_board'))!.phExtensions!
    await ctx.displayTypes.saveExtensions('menu_board', { ...ext, slots: ext.slots!.map((s, i) => (i === 1 ? { ...s, zoneId: 'z2' } : s)) })
    const moved = await get()
    expectMatchesContract('GET', '/admin/v1/booking-schedule', 200, moved.json())
    expect(moved.json().positions[0]).toMatchObject({ positionId: 'menu_board.s2', slot: 2, zoneName: 'Zone 2', zoneSlot: 1 })
  })

  it('shows each booking at the price it was booked at, with booked and billed revenue per display type', async () => {
    const { ctx, get } = await setup()
    await sellByWindow(ctx, 'menu_board', 2)
    await ctx.reservations.insert(booking({}))
    await ctx.reservations.insert(booking({ id: 'r_test', windowStart: '2026-09-23T00:00:00.000Z', testMode: true, status: 'won', type: 'bid' }))
    await runBilling(ctx)
    const res = await get('?from=2026-09-15&to=2026-09-23')
    expectMatchesContract('GET', '/admin/v1/booking-schedule', 200, res.json())
    const [pos] = res.json().positions
    const at = (d: string) => pos.windows.find((w: { start: string }) => w.start.startsWith(d))
    /* The seeded 15 Sep window: won at 120 CPM, 1,236 assumed views; billed on
       what played. c_dsp_nestle carries a default layer plus a localised
       metro-open upsell, so its tile stacks two layers. */
    expect(at('2026-09-15')).toMatchObject({ start: '2026-09-15T00:00:00.000Z', status: 'booked', booking: { reservationId: 'res_seed_nestle_0915', campaignId: 'c_dsp_nestle', advertiserId: 'nestle', partnerId: 'p_google', pricingType: 'localised', type: 'bid', advertiserName: 'Nestlé', partnerName: 'Google DSP', cpm: 120, assumedViews: 1236, bookedRevenue: 148.32, billedRevenue: 74.16, layers: { default: true, localised: true, personalised: false }, personalisedTriggers: null } })
    /* Reserved at the price agreed through the DSP. */
    expect(at('2026-09-22')).toMatchObject({ status: 'booked', booking: { type: 'reserve', advertiserName: 'Swisse', cpm: 175, bookedRevenue: 216.3, billedRevenue: null } })
    /* A Test-mode win is not a booking. */
    expect(at('2026-09-23')).toMatchObject({ status: 'available', booking: null })
    expect(at('2026-09-16').status).toBe('unavailable')
    expect(res.json().revenue).toEqual([{ displayTypeId: 'menu_board', displayTypeName: 'Menu Board — Long Format', bookedWindows: 2, sellableWindows: 3, bookedRevenue: 364.62, billedRevenue: 74.16, realtimeOpportunities: 0, realtimeFilled: 0, totalViews: 4944, bookedViews: 2472, availableViews: 2472, availableWindows: 2, availableValue: 247.2 }])
    expect(res.json().totals).toEqual({ bookedWindows: 2, sellableWindows: 3, bookedRevenue: 364.62, billedRevenue: 74.16, realtimeOpportunities: 0, realtimeFilled: 0, totalViews: 4944, bookedViews: 2472, availableViews: 2472, availableWindows: 2, availableValue: 247.2 })
    /* Both bookings are localised campaigns (Rob, 20 Sep: show what type is selling). */
    expect(res.json().byPricingType).toEqual([{ pricingType: 'localised', bookedWindows: 2, bookedRevenue: 364.62 }])
  })

  /* Ticket eNlz3fJab4Ehqg9hbf4C (26 Oct 2026): assumed views (VAC-d) per cell and per display type. */
  it('reports assumed views per day and per display type: booked + available = total, and a display profile moves its day', async () => {
    const { ctx, get } = await setup()
    await sellByWindow(ctx, 'menu_board', 2)
    await ctx.reservations.insert(booking({}))
    const q = '?from=2026-09-21&to=2026-09-24'
    const before = (await get(q)).json()
    expectMatchesContract('GET', '/admin/v1/booking-schedule', 200, before)
    const cells = (b: typeof before) => b.positions[0].windows as { start: string; status: string; assumedViews: number | null }[]
    const day = (b: typeof before, d: string) => cells(b).find((w) => w.start.startsWith(d))!
    expect(day(before, '2026-09-21')).toMatchObject({ status: 'available', assumedViews: 1236 })
    expect(day(before, '2026-09-22')).toMatchObject({ status: 'booked', assumedViews: 1236 })
    const [row] = before.revenue
    expect(row.bookedViews + row.availableViews).toBe(row.totalViews)
    /* Available (ticket Ltlu40NbXod3d8NwFF6Z): floor CPM x assumed views / 1000 for every unbooked window, and booked + available = sellable. */
    expect(row.availableWindows + row.bookedWindows).toBe(row.sellableWindows)
    expect(row.availableValue).toBe(Math.round((row.availableViews / 1000) * 100 * 100) / 100)
    expect(row.bookedViews).toBe(1236)
    expect(before.totals).toMatchObject({ totalViews: row.totalViews, bookedViews: row.bookedViews, availableViews: row.availableViews })
    /* A display with an hour-of-week profile: its day is the sum of that day's 24 hours. */
    expect(day(before, '2026-09-21').assumedViews).toBe(1236)
    /* The seeded slot has a score of its own, which stays flat; without it the slot follows its displays. */
    ctx.db.prepare("DELETE FROM audience_vacd WHERE display_type_id = 'menu_board' AND slot = 2").run()
    await ctx.displayTypes.saveExtensions('menu_board', { ...(await ctx.displayTypes.get('menu_board'))!.phExtensions!, defaultVacd: 240 })
    const dflt = defaultVacdOf((await ctx.displayTypes.get('menu_board'))!)!
    expect(dflt).toBe(240)
    const displays = ctx.db.prepare("SELECT id, vacd_override AS o FROM displays WHERE display_type_id = 'menu_board'").all() as { id: string; o: number | null }[]
    const derived = displays.reduce((n, x) => n + (x.o ?? dflt), 0)
    expect(day((await get(q)).json(), '2026-09-21').assumedViews).toBe(Math.round(derived))
    ctx.db.prepare('UPDATE displays SET vacd_profile = ? WHERE id = ?').run(JSON.stringify(Array<number>(HOURS_PER_WEEK).fill(5)), displays[0].id)
    const after = (await get(q)).json()
    expect(day(after, '2026-09-21').assumedViews).toBe(Math.round(derived - (displays[0].o ?? dflt) + 24 * 5))
    expect(after.revenue[0].bookedViews + after.revenue[0].availableViews).toBe(after.revenue[0].totalViews)
    /* A day that can no longer be sold has none. */
    expect(day((await get('?from=2026-09-15&to=2026-09-17')).json(), '2026-09-16')).toMatchObject({ status: 'unavailable', assumedViews: null })
  })

  /* Ticket S5PZyZ3MFr45LTM0zfAK (22 Oct 2026): the tile's approval state. */
  it('colours the default by approval and flight start, and counts approved of submitted campaigns per layer', async () => {
    expect(approvalOf(true, 1, { approved: 0, submitted: 0 }, { approved: 0, submitted: 0 }).defaultRisk).toBe('secured')
    expect(approvalOf(false, 2, { approved: 0, submitted: 0 }, { approved: 0, submitted: 0 }).defaultRisk).toBe('at_risk')
    expect(approvalOf(false, 3, { approved: 0, submitted: 0 }, { approved: 0, submitted: 0 }).defaultRisk).toBe('at_risk')
    expect(approvalOf(false, -1, { approved: 0, submitted: 0 }, { approved: 0, submitted: 0 }).defaultRisk).toBe('at_risk')
    expect(approvalOf(false, 5, { approved: 0, submitted: 0 }, { approved: 0, submitted: 0 }).defaultRisk).toBe('warning')
    const { ctx, get } = await setup()
    await ctx.campaigns.createCampaign({ id: 'c_pers', name: 'Swisse — Personalised', targeting: null, source: 'api', advertiserId: 'swisse', partnerId: 'p_google', displayTypeId: 'menu_board', pricingType: 'personalised' })
    await ctx.reservations.insert(booking({ id: 'r_local', campaignId: 'c_api_swisse', pricingType: 'localised' }))
    await ctx.reservations.insert(booking({ id: 'r_personal', windowStart: '2026-09-23T00:00:00.000Z', campaignId: 'c_pers', pricingType: 'personalised' }))
    const res = await get('?from=2026-09-15&to=2026-09-23')
    expectMatchesContract('GET', '/admin/v1/booking-schedule', 200, res.json())
    const at = (d: string) => res.json().positions[0].windows.find((w: { start: string }) => w.start.startsWith(d)).booking
    const approved = async (id: string) => (await ctx.approvals.statusOf(id)) === 'approved'
    const loc = at('2026-09-22').approval
    const pers = at('2026-09-23').approval
    expect(loc.defaultApproved).toBe(await approved('c_api_swisse'))
    expect(pers.defaultApproved).toBe(await approved('c_pers'))
    /* Both tiles belong to one advertiser on one position, so they share the counters, split by the campaign's own type. */
    /* The split is by each campaign's own type: c_api_swisse is localised, c_pers personalised. */
    expect(loc.localised).toEqual({ approved: (await approved('c_api_swisse')) ? 1 : 0, submitted: 1 })
    expect(loc.personalised).toEqual({ approved: (await approved('c_pers')) ? 1 : 0, submitted: 1 })
    expect(pers.localised).toEqual(loc.localised)
    /* The tile's own window against now (20 Sep): 22 Sep is 2 days out, 23 Sep 3. */
    expect(loc.startsInDays).toBeLessThan(pers.startsInDays)
  })

  /* Ticket x2yp5hewCO44TYMbZ8Cf: reverting or giving an approval changes the tile at once. */
  it('turns the tile red or orange when its approval is reverted, and green when approved again', async () => {
    const { ctx, get } = await setup()
    await ctx.reservations.insert(booking({ id: 'r_local', campaignId: 'c_api_swisse', pricingType: 'localised' }))
    const tile = async () => (await get('?from=2026-09-15&to=2026-09-23')).json().positions[0].windows.find((w: { start: string }) => w.start.startsWith('2026-09-22')).booking.approval
    const app = buildApp(ctx)
    const act = (what: string) => app.inject({ method: 'POST', url: `/api/admin/v1/campaigns/c_api_swisse/${what}`, payload: { assetVersion: 'v1' } })
    if ((await ctx.approvals.statusOf('c_api_swisse')) !== 'approved') expect((await act('approve')).statusCode).toBe(200)
    expect(await tile()).toMatchObject({ defaultApproved: true, defaultRisk: 'secured' })
    expect((await act('revert-approval')).statusCode).toBe(200)
    expect(await tile()).toMatchObject({ defaultApproved: false, defaultRisk: 'at_risk' })
    expect((await act('approve')).statusCode).toBe(200)
    expect(await tile()).toMatchObject({ defaultApproved: true, defaultRisk: 'secured' })
  })

  /* The reach-count API left this build's scope on 30 Sep: a booking has no
     reach, and a position's displayCount is plain sizing. */
  it('carries no reach on any booking, and displayCount on every position', async () => {
    const { ctx, get } = await setup()
    await ctx.reservations.insert(booking({ id: 'r_local', campaignId: 'c_api_swisse', pricingType: 'localised' }))
    await ctx.reservations.insert(booking({ id: 'r_personal', positionId: 'menu_board.s2', windowStart: '2026-09-23T00:00:00.000Z', campaignId: 'c_api_swisse_kids', pricingType: 'personalised' }))
    const res = await get('?from=2026-09-15&to=2026-09-23')
    expectMatchesContract('GET', '/admin/v1/booking-schedule', 200, res.json())
    const [pos] = res.json().positions
    expect(pos.displayCount).toBe(3)
    const at = (d: string) => pos.windows.find((w: { start: string }) => w.start.startsWith(d))
    expect(at('2026-09-22').booking).not.toHaveProperty('reach')
    expect(at('2026-09-23').booking).toMatchObject({ pricingType: 'personalised' })
    expect(at('2026-09-23').booking).not.toHaveProperty('reach')
  })

  it('narrows to one campaign, over whatever range its bookings fall in', async () => {
    const { ctx, get } = await setup()
    await sellByWindow(ctx, 'menu_board', 2)
    await ctx.reservations.insert(booking({ windowStart: '2026-11-02T00:00:00.000Z' }))
    const res = await get('?campaignId=c_api_swisse')
    expectMatchesContract('GET', '/admin/v1/booking-schedule', 200, res.json())
    const booked = res.json().positions[0].windows.filter((w: { status: string }) => w.status === 'booked')
    expect(booked.map((w: { start: string }) => w.start)).toEqual(['2026-11-02T00:00:00.000Z'])
    expect(res.json().totals).toEqual({ bookedWindows: 1, sellableWindows: 43, bookedRevenue: 216.3, billedRevenue: 0, realtimeOpportunities: 0, realtimeFilled: 0, totalViews: 53148, bookedViews: 1236, availableViews: 51912, availableWindows: 42, availableValue: 5191.2 })
    /* The seeded Nestlé booking belongs to another campaign, so it isn't counted. */
    expect(res.json().windows[0].start).toBe('2026-09-20T00:00:00.000Z')
  })

  it('narrows to one advertiser or one DSP', async () => {
    const { ctx, get } = await setup()
    await sellByWindow(ctx, 'menu_board', 2)
    await ctx.reservations.insert(booking({}))
    const swisse = await get('?advertiserId=swisse&from=2026-09-15&to=2026-09-23')
    expect(swisse.json().totals.bookedWindows).toBe(1)
    /* Another advertiser's booking stays on the grid, named, but is in none of the totals (ticket zebMTdEEJFkVG5AVGiET). */
    const other = swisse.json().positions[0].windows.find((w: { start: string }) => w.start.startsWith('2026-09-15'))
    expect(other).toMatchObject({ status: 'booked', booking: { advertiserId: 'nestle', advertiserName: 'Nestlé' } })
    const amazon = await get('?partnerId=p_amazon&from=2026-09-15&to=2026-09-23')
    expect(amazon.json().totals).toEqual({ bookedWindows: 0, sellableWindows: 3, bookedRevenue: 0, billedRevenue: 0, realtimeOpportunities: 0, realtimeFilled: 0, totalViews: 3708, bookedViews: 0, availableViews: 3708, availableWindows: 3, availableValue: 370.8 })
  })

  /* The filter is there to find a booking, so it only offers advertisers
     that have one, and shows only the positions they hold (Rob, 20 Sep). */
  it('offers only advertisers with something booked in the range, and their positions alone', async () => {
    const { ctx, get } = await setup()
    await ctx.reservations.insert(booking({}))
    const all = await get('?from=2026-09-15&to=2026-09-23')
    expect(all.json().dsps.find((d: { partnerId: string }) => d.partnerId === 'p_google').advertisers.map((a: { advertiserId: string }) => a.advertiserId))
      .toEqual(['nestle', 'swisse'])
    /* Arnott's is a seat on The Trade Desk but has never booked. */
    expect(all.json().dsps.flatMap((d: { advertisers: { name: string }[] }) => d.advertisers.map((a) => a.name))).not.toContain('Arnott’s')
    /* A range with no bookings offers nobody. */
    const empty = await get('?from=2026-10-01&to=2026-10-05')
    expect(empty.json().dsps.every((d: { advertisers: unknown[] }) => d.advertisers.length === 0)).toBe(true)

    const swisse = await get('?advertiserId=swisse&from=2026-09-15&to=2026-09-23')
    expect(swisse.json().positions.map((p: { positionId: string }) => p.positionId)).toEqual(['menu_board.s2'])
  })

  /* The sample bookings a fresh database gets, so the schedule and the
     revenue tables aren't empty when someone first opens them (Rob, 21 Sep). */
  it('seeds a booking for every brand a connected DSP brings', async () => {
    const ctx = await testContext({ clock: () => NOW, bookings: true })
    const res = await buildApp(ctx).inject({ method: 'GET', url: '/api/admin/v1/booking-schedule' })
    expect(res.statusCode).toBe(200)
    expectMatchesContract('GET', '/admin/v1/booking-schedule', 200, res.json())
    const bookings = res.json().positions.flatMap((p: { windows: { booking: { advertiserName: string; type: string } | null }[] }) => p.windows.flatMap((w) => (w.booking ? [w.booking] : [])))
    /* Both seats Google brings, each with three windows. */
    expect(new Set(bookings.map((b: { advertiserName: string }) => b.advertiserName))).toEqual(new Set(['Nestlé', 'Swisse']))
    expect(bookings).toHaveLength(6)
    /* A mix of reserved and won, and revenue to show for it. */
    expect(new Set(bookings.map((b: { type: string }) => b.type))).toEqual(new Set(['reserve', 'bid']))
    expect(res.json().totals.bookedRevenue).toBeGreaterThan(0)
    /* Every booked campaign is approved and switched on, as a real one would be. */
    const campaigns = (await buildApp(ctx).inject({ method: 'GET', url: '/api/admin/v1/campaigns' })).json().items
    for (const b of bookings as { campaignId: string }[]) {
      expect(campaigns.find((c: { campaignId: string }) => c.campaignId === b.campaignId).activation.enabled).toBe(true)
    }
  })

  /* Ticket Hh87Dja2TgYrug606Uq0 (26 Oct 2026): view=monthly rolls the grid up per calendar month on the server. */
  describe('view=monthly', () => {
    const seed = async () => {
      const s = await setup()
      await sellByWindow(s.ctx, 'menu_board', 2)
      await s.ctx.reservations.insert(booking({}))
      await s.ctx.reservations.insert(booking({ id: 'r_oct', windowStart: '2026-10-05T00:00:00.000Z', advertiserId: 'nestle', clearingCpm: 90 }))
      await s.ctx.reservations.insert(booking({ id: 'r_dec', windowStart: '2026-12-02T00:00:00.000Z', clearingCpm: 60 }))
      return s
    }

    it('gives one column per calendar month and one rollup cell per position and month, with the same revenue, % sold and views as the per-window path', async () => {
      const { get } = await seed()
      const per = (await get('?from=2026-09-20&to=2026-12-18')).json()
      const res = await get('?from=2026-09-20&to=2026-12-18&view=monthly')
      expect(res.statusCode).toBe(200)
      expectMatchesContract('GET', '/admin/v1/booking-schedule', 200, res.json())
      const body = res.json()
      expect(body.windows.map((w: { start: string }) => w.start)).toEqual(['2026-09-20T00:00:00.000Z', '2026-10-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z', '2026-12-01T00:00:00.000Z'])
      expect(body.windows[3].end).toBe('2027-01-01T00:00:00.000Z')
      expect(body.positions[0].windows).toHaveLength(4)
      expect(body.positions[0].windows.every((w: { booking: unknown; rollup: unknown }) => w.booking === null && w.rollup)).toBe(true)
      expect(body.revenue).toEqual(per.revenue)
      expect(body.totals).toEqual(per.totals)
      expect(body.byPricingType).toEqual(per.byPricingType)
      expect(body.dsps).toEqual(per.dsps)
      /* The cells add up to the same booked windows, and a month names who booked and what it earned. */
      const cells = body.positions[0].windows
      expect(cells.reduce((n: number, c: { rollup: { booked: number } }) => n + c.rollup.booked, 0)).toBe(per.totals.bookedWindows)
      expect(cells.find((c: { start: string }) => c.start.startsWith('2026-10')).rollup).toMatchObject({ booked: 1, advertisers: ['Nestlé'] })
      expect(cells.reduce((n: number, c: { rollup: { bookedRevenue: number } }) => n + c.rollup.bookedRevenue, 0)).toBeCloseTo(per.totals.bookedRevenue, 2)
      expect(cells[0]).toMatchObject({ status: 'booked' })
    })

    it('narrows to one advertiser: only its windows count in the cells and the revenue table', async () => {
      const { get } = await seed()
      const per = (await get('?from=2026-09-20&to=2026-12-18&advertiserId=nestle')).json()
      const body = (await get('?from=2026-09-20&to=2026-12-18&view=monthly&advertiserId=nestle')).json()
      expect(body.totals).toEqual(per.totals)
      expect(body.totals.bookedWindows).toBe(1)
      expect(body.positions[0].windows.map((w: { rollup: { booked: number } }) => w.rollup.booked)).toEqual([0, 1, 0, 0])
    })

    it('allows up to 365 days, where Daily and Weekly stop at 92', async () => {
      const { get } = await seed()
      const year = await get('?from=2026-09-20&to=2027-09-20&view=monthly')
      expect(year.statusCode).toBe(200)
      expect(year.json().windows).toHaveLength(13)
      expect((await get('?from=2026-09-20&to=2027-09-21&view=monthly')).statusCode).toBe(400)
      for (const q of ['&view=daily', '&view=weekly', '']) expect((await get(`?from=2026-09-20&to=2027-09-20${q}`)).statusCode).toBe(400)
      expect((await get('?from=2026-09-20&to=2026-10-20&view=yearly')).statusCode).toBe(400)
    })
  })

  it('needs a valid range of at most 92 days, and is behind the flag', async () => {
    const { get } = await setup()
    for (const q of ['?from=2026-09-20', '?from=2026-09-20&to=2026-12-31', '?from=2026-09-22&to=2026-09-21']) {
      const res = await get(q)
      expect(res.statusCode).toBe(400)
      expectMatchesContract('GET', '/admin/v1/booking-schedule', 400, res.json())
    }
    expect((await (await setup(false)).get()).statusCode).toBe(404)
  })
})
