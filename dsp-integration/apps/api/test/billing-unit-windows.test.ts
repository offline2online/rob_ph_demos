/* OQ27 (decision, Rob, 29 Sep 2026): a slot's Billing unit (billingUnitHours
   — slot override, else display type default, else the company-wide play
   window, else 24h) is the source of truth for its play-window length and
   billing granularity. Before this it was informational only: a 168-hour
   unit changed nothing (E2E T7). */
import type { Slot } from '@ph-dsp/types'
import { describe, expect, it } from 'vitest'
import { allPositions, findPosition, windowMs } from '../src/domain/positions'
import { runAuction } from '../src/exchange/auction'
import { runBilling } from '../src/exchange/billing'
import { buildBidRequest } from '../src/exchange/openrtb'
import { dueWindowStarts } from '../src/exchange/scheduler'
import { buildApp } from '../src/http/app'
import type { ReservationRecord } from '../src/repos/ReservationRepo'
import { expectMatchesContract } from './contract'
import { NOW, mockDsps, testContext } from './helpers'

const GOOGLE = { authorization: 'Bearer poc-token-google-dv360' }
const HOUR = 3_600_000
/* Mondays: the anchor every window length is laid from. NOW is Sunday 20 Sep. */
const MON_21 = new Date('2026-09-21T00:00:00.000Z')
const MON_28 = new Date('2026-09-28T00:00:00.000Z')
const MON_05 = new Date('2026-10-05T00:00:00.000Z')

const won = (over: Partial<ReservationRecord>): ReservationRecord => ({
  id: `res_t_${Math.random().toString(16).slice(2, 8)}`, partnerId: 'p_google', advertiserId: 'nestle', campaignId: 'c_dsp_nestle', positionId: 'menu_board.s2',
  windowStart: MON_21.toISOString(), type: 'bid', channel: 'api', bidCpm: 100, currency: 'AUD', status: 'won', clearingCpm: 100, reason: null,
  testMode: false, pricingType: 'localised', handedOffAt: null, ...over,
})

async function setup(clock: () => Date = () => NOW) {
  const mocks = mockDsps()
  const ctx = await testContext({ clock, dspFetch: mocks.fetchImpl })
  const app = buildApp(ctx)
  /* The second Advertiser slot is scored like the seeded one; an unscored slot isn't sold. */
  ctx.db.prepare('INSERT INTO audience_vacd (display_type_id, slot, assumed_views_per_window, counted) VALUES (?, ?, ?, 1)').run('menu_board', 3, 1236)
  /* Slot 2 (the seeded Supplier slot) gets a weekly billing unit; slot 3
     becomes a second Advertiser slot with no override of its own, so it
     keeps the company default (24 hours). */
  const setSlots = async (patch: Record<number, Partial<Slot>>) => {
    const ext = (await ctx.displayTypes.get('menu_board'))!.phExtensions!
    await ctx.displayTypes.saveExtensions('menu_board', { ...ext, slots: ext.slots.map((s, i) => (patch[i + 1] ? { ...s, ...patch[i + 1] } : s)) })
  }
  const weekly = async () => await setSlots({ 2: { billingUnitHours: 168 }, 3: { owner: 'advertiser', partnerIds: ['p_google'], listMode: 'rtb', storeScope: null } })
  const activate = (id: string) => app.inject({ method: 'PUT', url: `/api/admin/v1/campaigns/${id}/activation`, payload: { enabled: true } })
  const queued = async (name: string) => (await ctx.approvalCampaigns.listCampaigns({ sources: ['dsp'] })).find((c) => c.name === name)!.campaignId
  const get = (url: string) => app.inject({ method: 'GET', url: `/api${url}`, headers: GOOGLE })
  return { ctx, app, setSlots, weekly, activate, queued, get }
}

describe('a slot’s billing unit sets its play-window length (OQ27)', () => {
  it('gives a 168-hour slot weekly windows — availability, inventory and bid request — while a slot without an override keeps the company default', async () => {
    const { ctx, weekly, get } = await setup()
    /* The seeded Supplier slot's audience is scored per company (24h) window. */
    const scored = (await ctx.audience.forSlot('menu_board', 2)).assumedViewsPerWindow
    await weekly()
    expect(await windowMs(ctx, await findPosition(ctx, 'menu_board.s2'))).toBe(168 * HOUR)
    expect(await windowMs(ctx, await findPosition(ctx, 'menu_board.s3'))).toBe(24 * HOUR)

    const weeklyView = await get('/v1/inventory/menu_board.s2')
    expectMatchesContract('GET', '/v1/inventory/{positionId}', 200, weeklyView.json())
    expect(weeklyView.json()).toMatchObject({ billingUnitHours: 168, assumedViewsPerWindow: scored * 7 })
    expect((await get('/v1/inventory/menu_board.s3')).json()).toMatchObject({ billingUnitHours: 24 })

    /* The same week asked of both: one weekly window, seven daily ones. */
    const week = await get('/v1/inventory/menu_board.s2/availability?from=2026-09-21&to=2026-09-27')
    expectMatchesContract('GET', '/v1/inventory/{positionId}/availability', 200, week.json())
    expect(week.json().windows).toEqual([{ start: '2026-09-21T00:00:00.000Z', end: '2026-09-28T00:00:00.000Z', status: 'available', assumedViews: scored * 7 }])
    const days = (await get('/v1/inventory/menu_board.s3/availability?from=2026-09-21&to=2026-09-27')).json().windows
    expect(days).toHaveLength(7)
    expect(days[0]).toMatchObject({ start: '2026-09-21T00:00:00.000Z', end: '2026-09-22T00:00:00.000Z' })
    /* A mid-week day answers for the week it falls in, not nothing. */
    expect((await get('/v1/inventory/menu_board.s2/availability?from=2026-09-23&to=2026-09-24')).json().windows.map((w: { start: string }) => w.start))
      .toEqual(['2026-09-21T00:00:00.000Z'])

    /* The bid request says how long the window is and what it's worth. */
    const partner = (await ctx.partners.get('p_google'))!
    const req = await buildBidRequest(ctx, (await findPosition(ctx, 'menu_board.s2'))!, partner, 'x')
    expect(req.imp[0]).toMatchObject({ exp: 168 * 3600, qty: { multiplier: scored * 7 } })
    expect((await buildBidRequest(ctx, (await findPosition(ctx, 'menu_board.s3'))!, partner, 'y')).imp[0].exp).toBe(24 * 3600)
  })

  it('auctions a weekly slot only on its own window starts, which one auction shares with the daily slots', async () => {
    const { ctx, app, weekly } = await setup()
    await weekly()
    /* The scheduler looks at both grids' current and next windows, once each. */
    expect((await dueWindowStarts(ctx)).map((d) => d.toISOString())).toEqual([
      '2026-09-14T00:00:00.000Z', '2026-09-20T00:00:00.000Z', '2026-09-21T00:00:00.000Z',
    ])
    /* Monday: both slots clear together. Tuesday: only the daily one. */
    expect((await runAuction(ctx, MON_21)).positions.map((p) => p.positionId)).toEqual(['menu_board.s2', 'menu_board.s3'])
    expect((await runAuction(ctx, new Date('2026-09-22T00:00:00.000Z'))).positions.map((p) => p.positionId)).toEqual(['menu_board.s3'])

    /* POST /v1/reservations: a weekly slot's window starts on a Monday. */
    const res = await app.inject({
      method: 'POST', url: '/api/v1/reservations', headers: GOOGLE,
      payload: { positionId: 'menu_board.s2', windowStart: '2026-09-22T00:00:00.000Z', campaignId: 'c_dsp_nestle', advertiserId: 'nestle', type: 'bid', bidCpm: 200 },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.details).toContainEqual({ field: 'windowStart', reason: "The start of one of this position's 168-hour play windows (UTC)." })
  })

  it('bills a 168-hour slot one line item per week, on that week’s realised VAC-d and a week’s expected seconds', async () => {
    let now = NOW
    const { ctx, weekly } = await setup(() => now)
    /* The seeded 15 Sep window was sold daily; bill it before the slot changes. */
    expect((await runBilling(ctx)).map((i) => i.reservationId)).toEqual(['res_seed_nestle_0915'])
    const scored = (await ctx.audience.forSlot('menu_board', 2)).assumedViewsPerWindow
    await weekly()
    const p = (await findPosition(ctx, 'menu_board.s2'))!
    expect(await allPositions(ctx)).toHaveLength(2)
    const W7 = '2026-09-07T00:00:00.000Z'
    const W14 = '2026-09-14T00:00:00.000Z'
    await ctx.reservations.insert(won({ id: 'res_week_1', windowStart: W7, handedOffAt: W7 }))
    await ctx.reservations.insert(won({ id: 'res_week_2', windowStart: W14, handedOffAt: W14 }))
    /* Half the week's expected time played in week one, across its three displays. */
    const play = ctx.db.prepare("INSERT INTO plays (id, display_id, campaign_id, played_at, duration_sec) VALUES (?, ?, 'c_dsp_nestle', ?, 15)")
    const displays = ['d_1004', 'd_1005', 'd_1006']
    const expectedSec = displays.length * 168 * 3600 / 3
    const plays = expectedSec / 2 / 15 / displays.length
    for (const d of displays) for (let i = 0; i < plays; i++) play.run(`w_${d}_${i}`, d, new Date(Date.parse(W7) + i * ((168 * HOUR) / plays)).toISOString())

    /* Sunday 20 Sep: week one has ended; week two runs until Monday 21 Sep. */
    expect(await runBilling(ctx)).toMatchObject([{
      reservationId: 'res_week_1', positionId: p.positionId, windowStart: W7, windowEnd: W14,
      plays: plays * displays.length, playedSec: expectedSec / 2, expectedSec, assumedViews: scored * 7, realisedViews: Math.round(scored * 7 / 2), cpm: 100,
      amount: Math.round((Math.round(scored * 7 / 2) / 1000) * 100 * 100) / 100,
    }])
    /* Monday: week two bills on its own, on what played in it — only the
       seeded 15 Sep plays (43,200 s of the week's 604,800). */
    now = new Date('2026-09-21T00:30:00.000Z')
    const realised = Math.round(scored * 7 * (43_200 / expectedSec))
    expect(await runBilling(ctx)).toMatchObject([{ reservationId: 'res_week_2', windowStart: W14, windowEnd: '2026-09-21T00:00:00.000Z', playedSec: 43_200, expectedSec, assumedViews: scored * 7, realisedViews: realised, amount: Math.round((realised / 1000) * 100 * 100) / 100 }])
    expect(await runBilling(ctx)).toEqual([])
  })

  it('books a locked-rate term on a 168-hour slot one week at a time, each week its own reservation', async () => {
    const { ctx, setSlots, activate, queued } = await setup()
    const list = await ctx.buyersLists.insert({
      id: 'bl_weekly', name: 'Weekly term deal', description: '', invitedBuyers: [{ identifierType: 'brandEntity', value: 'Nestlé' }],
      activeFrom: null, activeTo: null, auctionCloses: '2026-09-29T00:00:00.000Z',
    })
    await setSlots({ 2: { billingUnitHours: 168, listMode: 'deal', buyersListId: list.id } })
    await runAuction(ctx, MON_21)
    await activate(await queued('Nestlé — crid-5130001'))
    /* The term's one real auction: the week of 28 Sep clears and locks the rate. */
    const locking = await runAuction(ctx, MON_28)
    expect(locking.positions[0].winner).toMatchObject({ partnerId: 'p_google', advertiserId: 'nestle' })
    const cpm = (await ctx.buyersLists.get(list.id))!.lockedWin!.cpm
    /* A Tuesday is not a window of this slot: nothing is booked. */
    expect((await runAuction(ctx, new Date('2026-09-29T00:00:00.000Z'))).positions).toEqual([])
    /* The next week books directly at the locked rate, as a week. */
    const booked = await runAuction(ctx, MON_05)
    expect(booked.positions[0]).toMatchObject({ positionId: 'menu_board.s2', bidRequests: 0, winner: { clearingCpm: cpm } })
    expect(booked.positions[0].skipped).toMatch(/locked rate/)
    const campaignId = (await ctx.reservations.get(booked.positions[0].winner!.reservationId))!.campaignId as string
    expect((await ctx.campaigns.bookings(campaignId)).map((b) => [b.windowStart, b.windowEnd])).toEqual([
      ['2026-09-28T00:00:00.000Z', '2026-10-05T00:00:00.000Z'],
      ['2026-10-05T00:00:00.000Z', '2026-10-12T00:00:00.000Z'],
    ])
  })

  it('shows a weekly booking across its week on the booking schedule, counted once', async () => {
    const { ctx, app, weekly } = await setup()
    await runBilling(ctx)
    await weekly()
    await ctx.reservations.insert(won({ id: 'res_sched', windowStart: MON_28.toISOString() }))
    const res = await app.inject({ method: 'GET', url: '/api/admin/v1/booking-schedule?from=2026-09-28&to=2026-10-04' })
    expect(res.statusCode).toBe(200)
    const row = res.json().positions.find((p: { positionId: string }) => p.positionId === 'menu_board.s2')
    expect(row.windows.map((w: { booking: { reservationId: string } | null }) => w.booking?.reservationId)).toEqual(Array(7).fill('res_sched'))
    expect(res.json().totals).toMatchObject({ bookedWindows: 1 })
  })

  it('refuses to change a slot’s billing unit while windows sold under it are still to play; the company value alone defers', async () => {
    const { ctx, app } = await setup()
    const row = (billingUnitHours: number | null, billingUnitHoursDefault: number | null = null) =>
      ({ displayTypeId: 'menu_board', slot: 2, supportedTargeting: ['localised'], assignedTo: { partnerIds: ['p_google'], advertisers: [], whitelistOnly: false }, reservePrice: null, reservePriceDefault: null, billingUnitHours, billingUnitHoursDefault })
    const save = (...items: ReturnType<typeof row>[]) => app.inject({ method: 'PUT', url: '/api/admin/v1/available-inventory', payload: { items } })
    /* Whole hours only, now that it lays out windows. */
    expect((await save(row(1.5))).statusCode).toBe(400)
    /* The seeded 15 Sep window has played but isn't billed yet: that holds it too. */
    const held = await save(row(168))
    expect(held.statusCode).toBe(400)
    expect(held.json().error.details[0]).toMatchObject({ field: 'items[0].billingUnitHours' })
    await runBilling(ctx)
    await ctx.reservations.insert(won({ id: 'res_tue', windowStart: '2026-09-22T00:00:00.000Z', status: 'pending', clearingCpm: null }))
    /* Via the display type default, too. */
    const viaDefault = await save(row(null, 168))
    expect(viaDefault.statusCode).toBe(400)
    expect(viaDefault.json().error.details[0].reason).toMatch(/24-hour billing unit \(the last ends 2026-09-23T00:00:00.000Z\)/)
    /* Test mode never holds anything; once nothing live is left, it saves. */
    await ctx.reservations.update('res_tue', { status: 'lost' })
    const ok = await save(row(168))
    expect(ok.statusCode).toBe(200)
    expect(ok.json().items[0]).toMatchObject({ billingUnitHours: 168, billingUnitHoursOverride: 168, companyPlayWindowHours: 24 })

    /* A company play-window change isn't held back by a slot with its own unit. */
    await ctx.reservations.insert(won({ id: 'res_week', windowStart: MON_28.toISOString(), status: 'pending', clearingCpm: null }))
    const company = { ...(await ctx.company.get()) }
    const settings = await app.inject({ method: 'PUT', url: '/api/admin/v1/advertiser-settings', payload: { ...company, playWindowHours: 48 } })
    expect(settings.json()).toMatchObject({ playWindowHours: 48, pendingPlayWindowHours: null })
    /* …and a slot with no unit of its own now inherits it. */
    const inherited = await save(row(null))
    expect(inherited.statusCode).toBe(400)
    await ctx.reservations.update('res_week', { status: 'lost' })
    expect((await save(row(null))).json().items[0]).toMatchObject({ billingUnitHours: 48, billingUnitHoursOverride: null })
  })
})
