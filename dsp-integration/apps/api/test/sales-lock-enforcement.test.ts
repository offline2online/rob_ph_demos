/* What a sales lock does once it is on (ZlxFSBGN, 30 Sep 2026; review
   2 Oct 2026, rec5vaJCQaid5jXHCQK5). slot-lock.test.ts covers taking and
   releasing the lock; this covers its effect: the Partner API refuses a new
   bid or reservation (409), the auction skips the position and settles a bid
   placed before the lock as lost, and the window reads `unavailable`. Plus
   the DisplayTypeSource promise that the records it hands out are frozen. */
import type { Slot } from '@ph-dsp/types'
import { describe, expect, it } from 'vitest'
import { buildApp } from '../src/http/app'
import { runAuction } from '../src/exchange/auction'
import { multipart, png } from './media'
import { NOW, testContext } from './helpers'

const GOOGLE = { authorization: 'Bearer poc-token-google-dv360' }
const W1 = '2026-09-21T00:00:00.000Z'
const LOCKED = 'This position is locked against new sales: its existing bookings continue, but no further window can be bid on or reserved.'

async function setup() {
  const ctx = await testContext({ clock: () => NOW })
  const app = buildApp(ctx)
  const ext = (await ctx.displayTypes.get('portrait'))!.phExtensions!
  await ctx.displayTypes.saveExtensions('portrait', {
    ...ext,
    slots: [{ label: 'Ad', owner: 'advertiser', partnerIds: [], advertisers: [], listMode: 'rtb', buyersListId: null, storeScope: null, quota: null, zoneId: null, supportedTargeting: ['localised'], reservePrice: 150 } as Slot],
  })
  ctx.db.prepare('INSERT INTO audience_vacd (display_type_id, slot, assumed_views_per_window, counted) VALUES (?, ?, ?, 1)').run('portrait', 1, 800)
  const created = await app.inject({ method: 'POST', url: '/api/v1/campaigns', headers: GOOGLE, payload: { advertiserId: 'swisse', name: 'Swisse — Portrait', displayTypeId: 'portrait', default: { pricingType: 'localised' } } })
  const cid = created.json().campaignId as string
  const m = multipart({ version: 'default' }, { name: 'portrait.png', bytes: png(1080, 1920) })
  await app.inject({ method: 'POST', url: `/api/v1/campaigns/${cid}/assets`, headers: { ...GOOGLE, ...m.headers }, payload: m.payload })
  await app.inject({ method: 'POST', url: `/api/v1/campaigns/${cid}/submit`, headers: GOOGLE })
  await app.inject({ method: 'POST', url: `/api/admin/v1/campaigns/${cid}/approve`, payload: { assetVersion: 'v1' } })
  await app.inject({ method: 'PUT', url: `/api/admin/v1/campaigns/${cid}/activation`, payload: { enabled: true } })
  const post = (type: 'bid' | 'reserve') => app.inject({ method: 'POST', url: '/api/v1/reservations', headers: GOOGLE, payload: { positionId: 'portrait.s1', windowStart: W1, campaignId: cid, advertiserId: 'swisse', type, bidCpm: 400 } })
  /* The lock as the lock endpoint writes it (the endpoint itself needs a live booking first — slot-lock.test.ts). */
  const lock = async () => {
    const cur = (await ctx.displayTypes.get('portrait'))!.phExtensions!
    await ctx.displayTypes.saveExtensions('portrait', { ...cur, slots: cur.slots!.map((s) => ({ ...s, salesLocked: true })) })
  }
  const windowStatus = async () =>
    (await app.inject({ url: `/api/v1/inventory/portrait.s1/availability?from=${W1.slice(0, 10)}&to=${W1.slice(0, 10)}`, headers: GOOGLE })).json().windows[0].status
  return { ctx, app, post, lock, windowStatus }
}

describe('a sales-locked position', () => {
  it('refuses a new bid and a new reservation with 409, and stores nothing', async () => {
    const { ctx, post, lock } = await setup()
    await lock()
    for (const type of ['bid', 'reserve'] as const) {
      const res = await post(type)
      expect(res.statusCode).toBe(409)
      expect(res.json().error.message).toBe(LOCKED)
    }
    expect(await ctx.reservations.forWindow('portrait.s1', W1)).toEqual([])
  })

  it('is skipped by the auction, which settles a bid placed before the lock as lost', async () => {
    const { ctx, post, lock } = await setup()
    expect((await post('bid')).statusCode).toBe(201)
    await lock()
    const out = await runAuction(ctx, new Date(W1))
    expect(JSON.stringify(out)).toContain('Locked against new sales.')
    const rows = await ctx.reservations.forWindow('portrait.s1', W1)
    expect(rows).toHaveLength(1)
    expect(rows[0].status).not.toBe('won')
    expect(rows[0].reason).toBe('This position is locked against new sales; nothing was sold.')
  })

  it('reads unavailable on the Partner API once locked', async () => {
    const { lock, windowStatus } = await setup()
    expect(await windowStatus()).toBe('available')
    await lock()
    expect(await windowStatus()).toBe('unavailable')
  })
})

describe('DisplayTypeSource', () => {
  it('hands out deep-frozen records, so no caller can change what others read', async () => {
    const { ctx } = await setup()
    const dt = (await ctx.displayTypes.get('portrait'))!
    expect(() => { (dt as { name: string }).name = 'x' }).toThrow()
    expect(() => { (dt.phExtensions!.slots![0] as { label: string }).label = 'x' }).toThrow()
    const listed = (await ctx.displayTypes.list()).find((d) => d.id === 'portrait')!
    expect(Object.isFrozen(listed.phExtensions!.slots![0])).toBe(true)
  })
})
