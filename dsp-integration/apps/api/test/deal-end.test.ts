/* Ticket bCcJ2e00CRLxtd98Utlr (22 Oct 2026): a shared deal whose flight has ended and whose last window is billed
   releases itself from its slots and is archived by 'system'; an unbilled window inside the flight holds it. */
import { describe, expect, it } from 'vitest'
import { assignedOf } from '@ph-dsp/types'
import { buildApp } from '../src/http/app'
import { archiveEndedDeals } from '../src/domain/dealEnd'
import { schedulerTick } from '../src/exchange/scheduler'
import { NOW, testContext } from './helpers'

const FLIGHT_END = '2026-09-10T23:59:59.000Z'

async function setup(activeTo: string | null = FLIGHT_END) {
  const ctx = await testContext({ byWindow: true, clock: () => NOW })
  const deal = await ctx.buyersLists.insert({ id: 'bl_end', name: 'Autumn PG', description: '', dealType: 'guaranteed', invitedBuyers: [{ partnerId: 'p_google', seatId: '5130001' }], activeFrom: '2026-09-01T00:00:00.000Z', activeTo, auctionCloses: null, floorCpm: 100 })
  await ctx.displayTypes.saveExtensions('portrait', { slots: [{ label: 'Ad', owner: 'advertiser', partnerIds: [], advertisers: [], listMode: 'deal', buyersListId: deal.id, buyersListIds: [deal.id], storeScope: null, quota: null, zoneId: null }] } as never)
  return { ctx, app: buildApp(ctx), deal }
}
const book = (ctx: Awaited<ReturnType<typeof testContext>>, windowStart: string) =>
  ctx.reservations.insert({
    id: `r_${windowStart}`, partnerId: 'p_google', advertiserId: 'nestle', campaignId: 'c_dsp_nestle', positionId: 'portrait.s1', windowStart,
    type: 'reserve', channel: 'api', bidCpm: null, currency: 'AUD', status: 'reserved', clearingCpm: 120, reason: null, testMode: false, pricingType: 'localised', handedOffAt: '2026-09-01T00:00:00.000Z',
  })
const billed = (ctx: Awaited<ReturnType<typeof testContext>>, reservationId: string, windowStart: string) =>
  ctx.billing.insert({ id: `b_${reservationId}`, reservationId, partnerId: 'p_google', advertiserId: 'nestle', campaignId: 'c_dsp_nestle', positionId: 'portrait.s1', windowStart, windowEnd: windowStart, plays: 1, playedSec: 1, expectedSec: 1, assumedViews: 1, realisedViews: 1, cpm: 120, currency: 'AUD', amount: 1, playsByVersion: [], personalisedPlays: 0, personalisedViews: 0 } as never, NOW.toISOString())

describe('deal end of flight', () => {
  it('releases and archives a deal whose flight ended and whose last window is billed, by system, in the change history', async () => {
    const { ctx, deal } = await setup()
    const r = await book(ctx, '2026-09-10T00:00:00.000Z')
    await billed(ctx, r.id, r.windowStart)
    await schedulerTick(ctx, () => {})
    const after = (await ctx.buyersLists.get(deal.id))!
    expect(after).toMatchObject({ status: 'archived', archivedBy: 'system', dealId: deal.dealId })
    /* Stamped with the scheduler's clock, not the wall clock (E2E 22 Oct 2026). */
    expect(after.archivedAt).toBe(ctx.clock().toISOString())
    /* The slots are released, but the archived deal still says which it was in (ticket VHuSQiHQoGCPPvreusgK). */
    expect(after.assignedSlots).toEqual([expect.objectContaining({ positionId: 'portrait.s1', displayTypeName: expect.any(String) })])
    expect(assignedOf((await ctx.displayTypes.get('portrait'))!.phExtensions!.slots[0]).buyersListIds).toEqual([])
    const trail = (await ctx.sspAudit.query({ objectType: 'buyers_list', objectId: deal.id })).items
    expect(trail.find((e) => e.field === 'archivedBy')).toMatchObject({ newValue: 'system', actor: { type: 'agent', id: 'system' } })
    const slotTrail = (await ctx.sspAudit.query({ objectType: 'display_type', objectId: 'portrait' })).items
    expect(slotTrail.some((e) => e.field.startsWith('slots[1]') && e.actor.id === 'system')).toBe(true)
  })

  it('keeps an ended deal assigned while a window inside its flight is unbilled', async () => {
    const { ctx, deal } = await setup()
    await book(ctx, '2026-09-10T00:00:00.000Z')
    /* Billing has not run yet (the tick would bill it first, then archive in the same pass). */
    expect(await archiveEndedDeals(ctx)).toEqual([])
    expect((await ctx.buyersLists.get(deal.id))!.status).toBe('shared')
    expect(assignedOf((await ctx.displayTypes.get('portrait'))!.phExtensions!.slots[0]).buyersListIds).toEqual([deal.id])
  })

  it('leaves a deal still in flight, and one with no end date, alone', async () => {
    const live = await setup('2026-12-31T00:00:00.000Z')
    await schedulerTick(live.ctx, () => {})
    expect((await live.ctx.buyersLists.get(live.deal.id))!.status).toBe('shared')
    const open = await setup(null)
    await schedulerTick(open.ctx, () => {})
    expect((await open.ctx.buyersLists.get(open.deal.id))!.status).toBe('shared')
  })

  it('does not offer an archived deal to DSPs', async () => {
    const { ctx, app, deal } = await setup()
    await ctx.buyersLists.archive(deal.id, 'test')
    expect((await ctx.buyersLists.list()).map((l) => l.id)).not.toContain(deal.id)
    expect((await app.inject({ method: 'GET', url: '/api/admin/v1/buyers-lists?archived=true' })).json().items.map((l: { id: string }) => l.id)).toContain(deal.id)
  })
})
