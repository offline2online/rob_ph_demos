/* Direct advertiser deal revenue is recorded and reported exactly as DSP-sold inventory is (ticket EipHu2GUdlbZMpPGCTjF, 5/7,
   22 Oct 2026). Billing decision (Rob): the platform records and reports the revenue but does not invoice it; direct
   advertisers are billed outside the platform, as DSPs bill their own deals. */
import { describe, expect, it } from 'vitest'
import { buildApp } from '../src/http/app'
import { runAuction } from '../src/exchange/auction'
import { lineItems, runBilling } from '../src/exchange/billing'
import { multipart, png } from './media'
import { testContext } from './helpers'
import { equivalentCpmOf, termDaysOf, termSlotsOf } from '../src/domain/termPrice'

/* Well after the November windows, so they have ended and can be billed. */
const AFTER = new Date('2026-11-10T00:00:00.000Z')
const URL = '/api/admin/v1/buyers-lists'
const setup = async () => {
  const ctx = await testContext({ clock: () => AFTER })
  const app = buildApp(ctx)
  await app.inject({ method: 'POST', url: '/api/admin/v1/advertisers/direct', payload: { name: 'Acme Foods' } })
  const deal = (extra: Record<string, unknown> = {}) => ({ name: 'Acme direct', dealType: 'direct', invitedBuyers: [{ partnerId: 'direct', seatId: 'acme-foods' }], activeFrom: '2026-11-01T00:00:00.000Z', activeTo: '2026-11-30T00:00:00.000Z', status: 'draft', ...extra })
  return { ctx, app, deal }
}

const GOOGLE = { authorization: 'Bearer poc-token-google-dv360' }
const INV = '/api/admin/v1/available-inventory'
const W = '2026-11-03T00:00:00.000Z'

async function sellSetup() {
  const { ctx, app, deal } = await setup()
  const direct = (await app.inject({ method: 'POST', url: URL, payload: deal({ floorCpm: 150 }) })).json()
  const ext = (await ctx.displayTypes.get('portrait'))!.phExtensions!
  const slot = { label: 'Ad', owner: 'advertiser', partnerIds: [], advertisers: [], storeScope: null, quota: null, zoneId: null }
  await ctx.displayTypes.saveExtensions('portrait', { ...ext, slots: [{ ...slot, listMode: 'deal', buyersListId: direct.id, buyersListIds: [direct.id] } as never] })
  ctx.db.prepare('INSERT INTO audience_vacd (display_type_id, slot, assumed_views_per_window, counted) VALUES (?, ?, ?, 1)').run('portrait', 1, 800)
  const assign = (ids: string[]) => app.inject({ method: 'PUT', url: INV, payload: { items: [{ displayTypeId: 'portrait', slot: 1, assignedTo: { buyersListIds: ids }, floorCpm: null }] } })
  /* A second reserving deal: Programmatic guaranteed needs a DSP seat, so a second Direct advertiser stands in. */
  await app.inject({ method: 'POST', url: '/api/admin/v1/advertisers/direct', payload: { name: 'Beta Co' } })
  const other = async (from: string, to: string) => (await app.inject({ method: 'POST', url: URL, payload: deal({ name: 'Beta direct', invitedBuyers: [{ partnerId: 'direct', seatId: 'beta-co' }], floorCpm: 150, activeFrom: from, activeTo: to }) })).json()
  return { ctx, app, direct, assign, other, slot }
}


async function liveDirectDeal(termTotal?: number) {
  const s = await sellSetup()
  if (termTotal !== undefined) s.ctx.db.prepare('UPDATE buyers_lists SET floor_cpm = NULL, term_total = ? WHERE id = ?').run(termTotal, s.direct.id)
  expect((await s.app.inject({ method: 'POST', url: `${URL}/${s.direct.id}/share` })).statusCode).toBe(200)
  const cid = (await s.app.inject({ method: 'POST', url: '/api/v1/campaigns', headers: GOOGLE, payload: { advertiserId: 'swisse', name: 'Acme — Portrait', displayTypeId: 'portrait', default: { pricingType: 'localised' } } })).json().campaignId
  const m = multipart({ version: 'default' }, { name: 'portrait.png', bytes: png(1080, 1920) })
  await s.app.inject({ method: 'POST', url: `/api/v1/campaigns/${cid}/assets`, headers: { ...GOOGLE, ...m.headers }, payload: m.payload })
  await s.app.inject({ method: 'POST', url: `/api/v1/campaigns/${cid}/submit`, headers: GOOGLE })
  await s.app.inject({ method: 'POST', url: `/api/admin/v1/campaigns/${cid}/approve`, payload: { assetVersion: 'v1' } })
  await s.app.inject({ method: 'PUT', url: `/api/admin/v1/campaigns/${cid}/activation`, payload: { enabled: true } })
  s.ctx.db.prepare("UPDATE campaigns SET advertiser_id = 'acme-foods' WHERE id = ?").run(cid)
  await runAuction(s.ctx, new Date(W))
  return { ...s, cid }
}

const play = (ctx: Awaited<ReturnType<typeof testContext>>, cid: string, n: number) => {
  const insert = ctx.db.prepare("INSERT INTO plays (id, display_id, campaign_id, played_at, duration_sec) VALUES (?, 'd_1003', ?, ?, 15)")
  for (let i = 0; i < n; i++) insert.run(`p_direct_${i}`, cid, new Date(Date.parse(W) + i * 40_000).toISOString())
}

describe('Direct advertiser deal revenue', () => {
  it('records a line item per window at the deal rate on realised delivery, labelled direct, and issues no invoice', async () => {
    const { ctx, app, cid } = await liveDirectDeal()
    play(ctx, cid, 1000)
    const billed = (await runBilling(ctx)).filter((i) => i.partnerId === 'direct')
    expect(billed).toHaveLength(1)
    const [item] = billed
    expect(item).toMatchObject({ advertiserId: 'acme-foods', campaignId: cid, positionId: 'portrait.s1', windowStart: W, cpm: 150, plays: 1000 })
    expect(item.realisedViews).toBeGreaterThan(0)
    expect(item.realisedViews).toBeLessThanOrEqual(800)
    expect(item.amount).toBe(Math.round((item.realisedViews / 1000) * 150 * 100) / 100)
    expect(await runBilling(ctx)).toEqual([])
    expect((await lineItems(ctx)).filter((i) => i.partnerId === 'direct')).toHaveLength(1)
    /* Recorded and reported, never invoiced: there is no invoice, billing or payment route. */
    for (const url of ['/api/admin/v1/invoices', '/api/admin/v1/billing', `/api/admin/v1/billing/${item.id}`]) expect((await app.inject({ url })).statusCode).toBe(404)
  })

  it('records a zero line item for a window with no plays, as for a DSP: nothing played, nothing earned', async () => {
    const { ctx } = await liveDirectDeal()
    expect((await runBilling(ctx)).filter((i) => i.partnerId === 'direct')).toMatchObject([{ plays: 0, realisedViews: 0, amount: 0, cpm: 150 }])
  })

  it('a total-for-the-term deal is recorded at the CPM equivalent to its total, per window', async () => {
    const { ctx, direct } = await liveDirectDeal(4500)
    const list = (await ctx.buyersLists.get(direct.id))!
    const equivalent = equivalentCpmOf(4500, await termSlotsOf(ctx, direct.id), termDaysOf(list.activeFrom, list.activeTo)) as number
    expect(equivalent).toBeGreaterThan(0)
    const [r] = await ctx.reservations.forWindow('portrait.s1', W)
    expect(r).toMatchObject({ partnerId: 'direct', clearingCpm: equivalent })
  })

  it('shows on the Booking schedule: Name (Direct), estimated revenue, then billed revenue once played', async () => {
    const { ctx, app, cid } = await liveDirectDeal()
    const get = async () => (await app.inject({ method: 'GET', url: '/api/admin/v1/booking-schedule?from=2026-11-02&to=2026-11-05' })).json()
    const before = await get()
    const tile = before.positions.flatMap((p: { windows: { booking: Record<string, unknown> | null }[] }) => p.windows.flatMap((w) => (w.booking ? [w.booking] : [])))
    expect(tile).toHaveLength(1)
    expect(tile[0]).toMatchObject({ advertiserId: 'acme-foods', advertiserName: 'Acme Foods (Direct)', partnerName: 'Direct', type: 'reserve', cpm: 150, assumedViews: 800, bookedRevenue: 120, billedRevenue: null })
    expect(before.totals).toMatchObject({ bookedWindows: 1, bookedRevenue: 120, billedRevenue: 0 })
    play(ctx, cid, 1000)
    const item = (await runBilling(ctx)).find((i) => i.partnerId === 'direct')!
    const after = await get()
    expect(after.totals.billedRevenue).toBe(item.amount)
    expect(after.revenue.find((r: { displayTypeId: string }) => r.displayTypeId === 'portrait')).toMatchObject({ bookedWindows: 1, bookedRevenue: 120, billedRevenue: item.amount })
    /* Filtering to the direct advertiser keeps its revenue; filtering to a DSP drops it. */
    const mine = (await app.inject({ method: 'GET', url: '/api/admin/v1/booking-schedule?from=2026-11-02&to=2026-11-05&advertiserId=acme-foods' })).json()
    expect(mine.totals.bookedRevenue).toBe(120)
    const dsp = (await app.inject({ method: 'GET', url: '/api/admin/v1/booking-schedule?from=2026-11-02&to=2026-11-05&partnerId=p_google' })).json()
    expect(dsp.totals.bookedRevenue).toBe(0)
    /* The same DSP-free filter: partnerId=direct selects direct revenue only. */
    const direct = (await app.inject({ method: 'GET', url: '/api/admin/v1/booking-schedule?from=2026-11-02&to=2026-11-05&partnerId=direct' })).json()
    expect(direct.totals.bookedRevenue).toBe(120)
  })

  it('reads Reserved, not Available, for an unbooked window inside the live flight (E2E 21 Oct 2026)', async () => {
    const { app } = await liveDirectDeal()
    const statusOn = async (from: string, to: string) => ((await app.inject({ method: 'GET', url: `/api/admin/v1/booking-schedule?from=${from}&to=${to}` })).json().positions as { positionId: string; windows: { status: string }[] }[])
      .find((p) => p.positionId === 'portrait.s1')!.windows.map((w) => w.status)
    expect(new Set(await statusOn('2026-11-12', '2026-11-15'))).toEqual(new Set(['reserved']))
    expect(await statusOn('2026-12-02', '2026-12-03')).not.toContain('reserved')
  })
})
