import { describe, expect, it } from 'vitest'
import { creativeMisfit, creativeRequirementsFor } from '../src/domain/dealCreative'
import { buildApp } from '../src/http/app'
import { expectMatchesContract } from './contract'
import { testContext } from './helpers'

const GOOGLE = { authorization: 'Bearer poc-token-google-dv360' }
const base = { description: '', activeFrom: null, activeTo: null, auctionCloses: null }

async function setup() {
  const ctx = await testContext()
  await ctx.buyersLists.insert({ id: 'bl_a', name: 'Multi-format', ...base, invitedBuyers: [{ partnerId: 'p_google', seatId: '5130001' }] })
  const dt = (await ctx.displayTypes.get('menu_board'))!
  const slot = dt.phExtensions!.slots.find((s) => s.owner === 'advertiser')!
  return { ctx, dt, slot }
}
const attach = async (ctx: Awaited<ReturnType<typeof testContext>>, id: string, slots: unknown[]) => {
  const dt = (await ctx.displayTypes.get(id))!
  await ctx.displayTypes.saveExtensions(id, { ...dt.phExtensions!, slots: slots as never })
}

describe('deal creative requirements (derived from attached positions)', () => {
  it('is empty while the list is attached to no slot', async () => {
    const { ctx } = await setup()
    expect(await creativeRequirementsFor(ctx, 'bl_a')).toEqual([])
  })

  it('returns one entry per distinct canvas + max play length, across display types', async () => {
    const { ctx, dt, slot } = await setup()
    const attached = { ...slot, listMode: 'deal', buyersListId: 'bl_a', buyersListIds: ['bl_a'] }
    /* Two slots of the landscape menu board: one at 10s, one at 20s; a second, portrait display type with one more. */
    await attach(ctx, 'menu_board', [...dt.phExtensions!.slots.filter((s) => s !== slot), { ...attached, maxPlayLengthSec: 10 }, { ...attached, label: 'Long', maxPlayLengthSec: 20 }, { ...attached, label: 'Long 2', maxPlayLengthSec: 20 }])
    const set = await creativeRequirementsFor(ctx, 'bl_a')
    expect(set).toHaveLength(2)
    expect(set.map((r) => r.maxPlayLengthSec)).toEqual([10, 20])
    expect(set[1].positionIds).toHaveLength(2)
    expect(set.every((r) => r.canvas.width === dt.displayCanvasSize.width && r.formats.join() === 'image,video')).toBe(true)
  })

  it('serves the deal to HQ and to an invited DSP (and only the invited one), matching the contract', async () => {
    const { ctx, dt, slot } = await setup()
    await attach(ctx, 'menu_board', [...dt.phExtensions!.slots.filter((s) => s !== slot), { ...slot, listMode: 'deal', buyersListId: 'bl_a', buyersListIds: ['bl_a'] }])
    const app = buildApp(ctx)
    const hq = await app.inject({ method: 'GET', url: '/api/admin/v1/buyers-lists/bl_a/deal' })
    expect(hq.statusCode).toBe(200)
    expectMatchesContract('GET', '/admin/v1/buyers-lists/{buyersListId}/deal', 200, hq.json())
    expect(hq.json().creativeRequirements).toHaveLength(1)
    expect((await app.inject({ method: 'GET', url: '/api/admin/v1/buyers-lists/nope/deal' })).statusCode).toBe(404)

    const dsp = await app.inject({ method: 'GET', url: '/api/v1/deals', headers: GOOGLE })
    expect(dsp.statusCode).toBe(200)
    expectMatchesContract('GET', '/v1/deals', 200, dsp.json())
    expect(dsp.json().items.map((d: { buyersListId: string }) => d.buyersListId)).toEqual(['bl_a'])
    const amazon = await app.inject({ method: 'GET', url: '/api/v1/deals', headers: { authorization: 'Bearer poc-token-amazon-dsp' } })
    expect(amazon.json().items).toEqual([])
  })

  it('validates a creative against the same set', async () => {
    const set = [
      { canvas: { width: 1920, height: 1080 }, orientation: 'landscape' as const, maxPlayLengthSec: 15, formats: ['image' as const, 'video' as const], positionIds: ['x.s1'] },
      { canvas: { width: 1080, height: 1920 }, orientation: 'portrait' as const, maxPlayLengthSec: 10, formats: ['image' as const], positionIds: ['y.s1'] },
    ]
    expect(creativeMisfit(set, { width: 1920, height: 1080, type: 'video', durationSec: 15 })).toBeNull()
    expect(creativeMisfit(set, { width: 1080, height: 1920, type: 'image' })).toBeNull()
    expect(creativeMisfit(set, { width: 800, height: 600, type: 'image' })).toMatch(/1920x1080 or 1080x1920/)
    expect(creativeMisfit(set, { width: 1080, height: 1920, type: 'video' })).toMatch(/do not play video/)
    expect(creativeMisfit(set, { width: 1920, height: 1080, type: 'video', durationSec: 16 })).toMatch(/15s/)
    expect(creativeMisfit([], { width: 1, height: 1, type: 'image' })).toBeNull()
  })
})
