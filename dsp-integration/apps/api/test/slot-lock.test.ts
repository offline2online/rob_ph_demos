/* Ticket "Lock playlist slot against new sales when slots are sold" (30 Sep
   2026): a sold slot keeps its advertiser (hard block), can be locked against
   new sales, and the lock releases by itself once nothing is booked on it. */
import { describe, expect, it } from 'vitest'
import { buildApp } from '../src/http/app'
import { schedulerTick } from '../src/exchange/scheduler'
import { expectMatchesContract } from './contract'
import { NOW, testContext } from './helpers'

const INV = '/api/admin/v1/available-inventory'

const book = async (ctx: Awaited<ReturnType<typeof testContext>>, windowStart: string, extra: Record<string, unknown> = {}) =>
  await ctx.reservations.insert({
    id: `r_${windowStart}`, partnerId: 'p_google', advertiserId: 'nestle', campaignId: 'c_dsp_nestle', positionId: 'portrait.s1', windowStart,
    type: 'reserve', channel: 'api', bidCpm: null, currency: 'AUD', status: 'reserved', clearingCpm: 120, reason: null, testMode: false, pricingType: 'localised', handedOffAt: null,
    ...extra,
  })

async function setup() {
  const ctx = await testContext({ byWindow: true, clock: () => NOW })
  await ctx.displayTypes.saveExtensions('portrait', { slots: [{ label: 'Ad', owner: 'advertiser', partnerIds: [], advertisers: [], listMode: 'deal', buyersListId: 'bl_test_open', storeScope: null, quota: null, zoneId: null }] } as never)
  return { ctx, app: buildApp(ctx) }
}

/* The row Save changes would send, with the advertiser list replaced. */
const rowWith = async (app: ReturnType<typeof buildApp>, advertisers: string[]) => {
  const row = (await app.inject({ method: 'GET', url: INV })).json().items.find((r: { displayTypeId: string }) => r.displayTypeId === 'portrait')
  return {
    displayTypeId: 'portrait', slot: 1, reservePrice: row.reservePriceOverride, reservePriceDefault: row.displayTypeReservePrice,
    billingUnitHours: row.billingUnitHoursOverride, billingUnitHoursDefault: row.displayTypeBillingUnitHours, maxCampaigns: row.maxCampaignsOverride, maxCampaignsDefault: row.displayTypeMaxCampaigns,
    assignedTo: { partnerIds: [], advertisers, whitelistOnly: false, buyersListId: null },
  }
}

describe('slot lock', () => {
  it('refuses removing an advertiser from a slot with a live booking, then locks and releases', async () => {
    const { ctx, app } = await setup()
    const seat = (await ctx.partners.list()).flatMap((p) => p.seats.map((s) => s.name))[0]
    expect((await app.inject({ method: 'PUT', url: INV, payload: { items: [await rowWith(app, [seat])] } })).statusCode).toBe(200)
    await book(ctx, '2026-09-22T00:00:00.000Z')

    /* Hard block: the advertiser stays, the booking stays. */
    const blocked = await app.inject({ method: 'PUT', url: INV, payload: { items: [await rowWith(app, [])] } })
    expect(blocked.statusCode).toBe(409)
    expect(blocked.json().error.code).toBe('has_dependents')
    expect(blocked.json().error.details[0].field).toBe('items[0].assignedTo.advertisers')
    expect(blocked.json().error.details[0].reason).toContain('slots are sold')
    expectMatchesContract('PUT', '/admin/v1/available-inventory', 409, blocked.json())
    expect((await ctx.displayTypes.get('portrait'))!.phExtensions!.slots[0].advertisers).toEqual([seat])
    expect(await ctx.reservations.forWindow('portrait.s1', '2026-09-22T00:00:00.000Z')).toHaveLength(1)

    /* Lock: no new sale on any other window, the sold one is untouched. */
    const locked = await app.inject({ method: 'PUT', url: `${INV}/lock`, payload: { displayTypeId: 'portrait', slot: 1 } })
    expect(locked.statusCode).toBe(200)
    expectMatchesContract('PUT', '/admin/v1/available-inventory/lock', 200, locked.json())
    const row = locked.json().items.find((r: { displayTypeId: string }) => r.displayTypeId === 'portrait')
    expect(row.salesLocked).toBe(true)
    expect(row.salesLockedUntil).not.toBeNull()
    expect((await app.inject({ method: 'PUT', url: `${INV}/lock`, payload: { displayTypeId: 'portrait', slot: 1 } })).statusCode).toBe(200)

    /* Still blocked while locked and booked. */
    expect((await app.inject({ method: 'PUT', url: INV, payload: { items: [await rowWith(app, [])] } })).statusCode).toBe(409)

    /* Bookings end -> the scheduler releases the lock -> removal goes through. */
    ctx.db.prepare("UPDATE reservations SET window_start = '2026-09-10T00:00:00.000Z'").run()
    await schedulerTick(ctx, () => {})
    expect((await ctx.displayTypes.get('portrait'))!.phExtensions!.slots[0].salesLocked).toBeFalsy()
    expect((await app.inject({ method: 'PUT', url: INV, payload: { items: [await rowWith(app, [])] } })).statusCode).toBe(200)
  })

  it('has nothing to lock on an unsold slot, and a Test-mode booking does not count', async () => {
    const { ctx, app } = await setup()
    expect((await app.inject({ method: 'PUT', url: `${INV}/lock`, payload: { displayTypeId: 'portrait', slot: 1 } })).statusCode).toBe(409)
    await book(ctx, '2026-09-22T00:00:00.000Z', { testMode: true })
    expect((await app.inject({ method: 'PUT', url: `${INV}/lock`, payload: { displayTypeId: 'portrait', slot: 1 } })).statusCode).toBe(409)
  })

  it('releases on read when nothing is booked, and never on playback: the booking alone decides', async () => {
    const { ctx, app } = await setup()
    await book(ctx, '2026-09-22T00:00:00.000Z')
    await app.inject({ method: 'PUT', url: `${INV}/lock`, payload: { displayTypeId: 'portrait', slot: 1 } })
    ctx.db.prepare('DELETE FROM reservations').run()
    const row = (await app.inject({ method: 'GET', url: INV })).json().items.find((r: { displayTypeId: string }) => r.displayTypeId === 'portrait')
    expect(row.salesLocked).toBe(false)
  })

  it('refuses switching a sold Advertiser slot to another owner', async () => {
    const { ctx, app } = await setup()
    const dt = (await ctx.displayTypes.get('portrait'))!
    await ctx.displayTypes.saveRecord('portrait', { ...dt, playlistSettings: { ...dt.playlistSettings, maximumCampaignsPlayedInRotation: 1 } } as never)
    await book(ctx, '2026-09-22T00:00:00.000Z')
    const res = await app.inject({ method: 'PUT', url: '/api/admin/v1/display-types/portrait/extensions', payload: { slots: (await ctx.displayTypes.get('portrait'))!.phExtensions!.slots.map((x) => ({ ...x, owner: 'internal' })) } })
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe('has_dependents')
  })
})
