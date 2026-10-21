/* Direct advertiser deals (ticket krIPF8rPnMwVOmynHNRh, 22 Oct 2026): a deal type with exactly the Programmatic
   guaranteed fields and rules, whose one buyer is a direct advertiser. No DSP seats, no IAB categories, no DSP
   deal entries, no acceptance; Finalise (share) makes it live internally. */
import { describe, expect, it } from 'vitest'
import { buildApp } from '../src/http/app'
import { testContext } from './helpers'

const URL = '/api/admin/v1/buyers-lists'
const setup = async () => {
  const ctx = await testContext()
  const app = buildApp(ctx)
  await app.inject({ method: 'POST', url: '/api/admin/v1/advertisers/direct', payload: { name: 'Acme Foods' } })
  const deal = (extra: Record<string, unknown> = {}) => ({ name: 'Acme direct', dealType: 'direct', invitedBuyers: [{ partnerId: 'direct', seatId: 'acme-foods' }], activeFrom: '2026-11-01T00:00:00.000Z', activeTo: '2026-11-30T00:00:00.000Z', status: 'draft', ...extra })
  return { ctx, app, deal }
}

describe('Direct advertiser deals', () => {
  it('saves as a draft with a PH deal ID and no DSP deal entries', async () => {
    const { app, deal } = await setup()
    const res = await app.inject({ method: 'POST', url: URL, payload: deal({ floorCpm: 150 }) })
    expect(res.statusCode).toBe(201)
    const body = res.json()
    expect(body.dealType).toBe('direct')
    expect(body.dealId).toMatch(/^PH-[A-Z0-9]{10}$/)
    expect(body.deals).toEqual([])
    expect(body.status).toBe('draft')
    expect(body.invitedBuyers).toEqual([{ partnerId: 'direct', seatId: 'acme-foods' }])
    expect(body.committedPlays).toBeNull()
  })

  it('takes one direct advertiser only: no DSP seats, no categories, no second buyer, no unknown advertiser', async () => {
    const { app, deal } = await setup()
    const post = (extra: Record<string, unknown>) => app.inject({ method: 'POST', url: URL, payload: deal({ floorCpm: 150, ...extra }) })
    expect((await post({ invitedBuyers: [{ partnerId: 'google_dv360', seatId: 'nestle' }] })).statusCode).toBe(400)
    expect((await post({ invitedBuyers: [{ partnerId: 'direct', seatId: 'nobody' }] })).statusCode).toBe(400)
    expect((await post({ invitedCategories: ['Food & Drink'] })).statusCode).toBe(400)
    await app.inject({ method: 'POST', url: '/api/admin/v1/advertisers/direct', payload: { name: 'Beta Co' } })
    expect((await post({ invitedBuyers: [{ partnerId: 'direct', seatId: 'acme-foods' }, { partnerId: 'direct', seatId: 'beta-co' }] })).statusCode).toBe(400)
    /* A direct advertiser is not a DSP buyer on any other deal type. */
    expect((await post({ dealType: 'guaranteed' })).statusCode).toBe(400)
  })

  it('is priced as a fixed CPM or a total for the term, never both; committed plays cannot be typed', async () => {
    const { app, deal } = await setup()
    const post = (extra: Record<string, unknown>) => app.inject({ method: 'POST', url: URL, payload: deal(extra) })
    expect((await post({ floorCpm: 150, termTotal: 5000 })).statusCode).toBe(400)
    expect((await post({ termTotal: 5000 })).statusCode).toBe(201)
    expect((await post({ floorCpm: 150, committedPlays: 100 })).statusCode).toBe(400)
  })

  it('finalises (shares) internally once it has a slot, with no DSP entries or acceptance', async () => {
    const { ctx, app, deal } = await setup()
    const created = (await app.inject({ method: 'POST', url: URL, payload: deal({ floorCpm: 150 }) })).json()
    /* No slot yet. */
    expect((await app.inject({ method: 'POST', url: `${URL}/${created.id}/share` })).statusCode).toBe(400)
    const ext = (await ctx.displayTypes.get('portrait'))!.phExtensions!
    await ctx.displayTypes.saveExtensions('portrait', { ...ext, slots: [{ label: 'Ad', owner: 'advertiser', partnerIds: [], advertisers: [], listMode: 'deal', buyersListId: created.id, buyersListIds: [created.id], storeScope: null, quota: null, zoneId: null } as never] })
    const live = await app.inject({ method: 'POST', url: `${URL}/${created.id}/share` })
    expect(live.statusCode).toBe(200)
    expect(live.json().status).toBe('shared')
    expect(live.json().deals).toEqual([])
    expect(live.json().committedPlays).not.toBeUndefined()
    const sheet = await app.inject({ url: `${URL}/${created.id}/deal-sheet` })
    expect(sheet.json().entries).toEqual([])
    expect((await app.inject({ method: 'POST', url: `${URL}/${created.id}/acceptances`, payload: { partnerId: 'direct', seatId: 'acme-foods' } })).statusCode).toBe(400)
  })
})

/* Campaign authoring: a direct advertiser picks its own live Direct deal (ticket knqu0B2PGTF9PG1EUWYD). */
describe('Direct advertiser deals in campaign authoring', () => {
  const mk = async () => {
    const { ctx, app, deal } = await setup()
    await app.inject({ method: 'POST', url: '/api/admin/v1/advertisers/direct', payload: { name: 'Beta Co' } })
    const make = async (extra: Record<string, unknown>) => (await app.inject({ method: 'POST', url: URL, payload: deal({ floorCpm: 150, ...extra }) })).json()
    const live = async (id: string) => {
      const ext = (await ctx.displayTypes.get('portrait'))!.phExtensions!
      await ctx.displayTypes.saveExtensions('portrait', { ...ext, slots: [{ label: 'Ad', owner: 'advertiser', partnerIds: [], advertisers: [], listMode: 'deal', buyersListId: id, buyersListIds: [id], storeScope: null, quota: null, zoneId: null } as never] })
      return app.inject({ method: 'POST', url: `${URL}/${id}/share` })
    }
    return { ctx, app, make, live }
  }
  const deals = async (app: Awaited<ReturnType<typeof mk>>['app'], id: string, at = '2026-11-10T00:00:00.000Z') =>
    (await app.inject({ url: `/api/admin/v1/advertisers/${id}/deals?at=${at}` })).json().items as { dealId: string; dealType: string }[]

  it('lists only its own finalised deal whose term covers the date', async () => {
    const { app, make, live } = await mk()
    const draft = await make({})
    expect(await deals(app, 'acme-foods')).toEqual([])
    expect((await live(draft.id)).statusCode).toBe(200)
    const items = await deals(app, 'acme-foods')
    expect(items.map((i) => i.dealId)).toEqual([draft.dealId])
    expect(items[0].dealType).toBe('direct')
    expect(await deals(app, 'acme-foods', '2026-12-15T00:00:00.000Z')).toEqual([])
    expect(await deals(app, 'beta-co')).toEqual([])
  })

  it('a campaign takes its own advertiser’s deal ID and refuses another advertiser’s', async () => {
    const { ctx, app, make, live } = await mk()
    const acme = await make({})
    await live(acme.id)
    const { assertInvitedDeals } = await import('../src/domain/advertiserDeals')
    const at = '2026-11-10T00:00:00.000Z'
    await expect(assertInvitedDeals(ctx, 'acme-foods', 'dealId', [acme.dealId], [], at)).resolves.toBeUndefined()
    await expect(assertInvitedDeals(ctx, 'beta-co', 'dealId', [acme.dealId], [], at)).rejects.toMatchObject({ status: 400 })
    await expect(assertInvitedDeals(ctx, 'acme-foods', 'dealId', ['PH-NOPE000000'], [], at)).rejects.toMatchObject({ status: 400 })
    void app
  })
})
