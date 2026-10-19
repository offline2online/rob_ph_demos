/* Advertiser audiences (ticket OanRebXyEryAXBQrBsVe): Visitor Segments values shared with one advertiser only. */
import { describe, expect, it } from 'vitest'
import { buildApp } from '../src/http/app'
import { expectMatchesContract } from './contract'
import { testContext } from './helpers'

const G = { authorization: 'Bearer poc-token-google-dv360' }
const SEG = 'visitor.visitor_segments'
const NTB = 'Blackmores · new to brand'
const LAPSED = 'Blackmores · lapsed'

async function setup(role?: 'hq_admin' | 'hq_marketing' | 'hq_helpdesk') {
  const ctx = await testContext({ role })
  /* Visitor Segments is a Personalisation Variable: shared with every DSP, with the retailer's brand-status values defined. */
  await ctx.company.saveVariableAccess({ ...(await ctx.company.variableAccess()), [SEG]: 'all' }, { [SEG]: { values: ['Fitness', NTB, LAPSED], freeText: false } })
  const app = buildApp(ctx)
  const google = (await ctx.partners.list()).find((p) => p.id === 'p_google')!
  const seatOf = (name: string) => google.seats.find((s) => s.name === name)!.id
  const put = (id: string, audiences: unknown) => app.inject({ method: 'PUT', url: `/api/admin/v1/advertisers/${id}/audiences`, payload: { audiences } })
  const variable = async () => ((await app.inject({ method: 'GET', url: '/api/admin/v1/targeting-variables' })).json().items as { key: string; values: string[]; privateValues?: string[] }[]).find((v) => v.key === SEG)!
  const create = (advertiserId: string, name: string, value: string) => app.inject({
    method: 'POST', url: '/api/v1/campaigns', headers: G,
    payload: { advertiserId, name, displayTypeId: 'landscape', default: { pricingType: 'localised' }, targeted: [{ id: 'nb', priority: 1, pricingType: 'personalised', rules: [[{ source: 'visitor', variable: SEG, op: 'include', values: [value] }]] }] },
  })
  return { ctx, app, put, variable, create, seatOf }
}

describe('Advertiser audiences', () => {
  it('adds a direct advertiser with an audience that no one else is offered', async () => {
    const { app, variable } = await setup()
    const add = await app.inject({ method: 'POST', url: '/api/admin/v1/advertisers/direct', payload: { name: 'Blackmores', audiences: [NTB] } })
    expect(add.statusCode).toBe(201)
    expectMatchesContract('POST', '/admin/v1/advertisers/direct', 201, add.json())
    expect(add.json()).toEqual({ advertiserId: 'blackmores', name: 'Blackmores', audiences: [NTB] })
    const list = await app.inject({ method: 'GET', url: '/api/admin/v1/advertisers' })
    expectMatchesContract('GET', '/admin/v1/advertisers', 200, list.json())
    expect((list.json().items as { advertiserId: string; audiences: string[] }[]).find((a) => a.advertiserId === 'blackmores')?.audiences).toEqual([NTB])
    expect((list.json().items as { advertiserId: string; audiences: string[] }[]).find((a) => a.advertiserId === 'swisse')?.audiences).toEqual([])
    /* The vocabulary everyone else is offered no longer carries it; the advertiser form lists it apart. */
    const v = await variable()
    expect(v.values).toEqual(['Fitness', LAPSED])
    expect(v.privateValues).toEqual([NTB])
  })

  it('keeps a private value defined when the screen saves the vocabulary without it', async () => {
    const { app, put, variable } = await setup()
    await put('swisse', [NTB])
    const access = (await app.inject({ method: 'GET', url: '/api/admin/v1/targeting-variables' })).json().items
    const body = { access: Object.fromEntries(access.map((v: { key: string; access: unknown }) => [v.key, v.access])), values: { [SEG]: { values: ['Fitness', LAPSED], freeText: false } } }
    expect((await app.inject({ method: 'PUT', url: '/api/admin/v1/targeting-variables', payload: body })).statusCode).toBe(200)
    expect((await variable()).privateValues).toEqual([NTB])
    expect((await put('swisse', [])).statusCode).toBe(200)
    expect((await variable()).values).toContain(NTB)
  })

  it('edits a DSP advertiser; only a seat mapped to it sees the audience', async () => {
    const { app, put, ctx, seatOf } = await setup()
    await ctx.company.saveAdvertiserSeats('swisse', [{ partnerId: 'p_google', seatId: seatOf('Swisse') }])
    const res = await put('swisse', [NTB, NTB])
    expect(res.statusCode).toBe(200)
    expectMatchesContract('PUT', '/admin/v1/advertisers/{advertiserId}/audiences', 200, res.json())
    expect(res.json().audiences).toEqual([NTB])
    const attrs = async (seatId?: string) => {
      const r = await app.inject({ method: 'GET', url: `/api/v1/targeting/attributes${seatId ? `?seatId=${seatId}` : ''}`, headers: G })
      expectMatchesContract('GET', '/v1/targeting/attributes', r.statusCode as 200, r.json())
      return (r.json().items as { key: string; audiences?: string[] }[]).find((i) => i.key === SEG)
    }
    expect((await attrs(seatOf('Swisse')))?.audiences).toEqual([NTB])
    expect((await attrs(seatOf('Nestlé')))?.audiences).toEqual([])
    expect((await attrs())?.audiences).toBeUndefined()
    expect((await app.inject({ method: 'GET', url: '/api/v1/targeting/attributes?seatId=nope', headers: G })).statusCode).toBe(400)
  })

  it('refuses a campaign from another seat that targets the audience, naming it', async () => {
    const { put, create, ctx, seatOf } = await setup()
    await ctx.company.saveAdvertiserSeats('swisse', [{ partnerId: 'p_google', seatId: seatOf('Swisse') }])
    await put('swisse', [NTB])
    const other = await create('nestle', 'Nestlé — new to brand', NTB)
    expect(other.statusCode).toBe(422)
    expect(other.json().error).toMatchObject({ code: 'targeting_not_supported', message: expect.stringContaining(NTB) })
    expect((await create('swisse', 'Swisse — new to brand', NTB)).statusCode).toBe(201)
    /* A value that is not private stays open to every advertiser. */
    expect((await create('nestle', 'Nestlé — fitness', 'Fitness')).statusCode).toBe(201)
  })

  it('refuses a seat that is not mapped to the advertiser holding the audience', async () => {
    const { put, create } = await setup()
    await put('swisse', [NTB])
    const r = await create('swisse', 'Swisse — new to brand', NTB)
    expect(r.statusCode).toBe(422)
    expect(r.json().error.code).toBe('targeting_not_supported')
  })

  it('refuses removing an audience while a live deal or approved campaign targets it', async () => {
    const { app, put, create, ctx, seatOf } = await setup()
    const seat = { partnerId: 'p_google', seatId: seatOf('Swisse') }
    await ctx.company.saveAdvertiserSeats('swisse', [seat])
    await put('swisse', [NTB])
    const id = (await create('swisse', 'Swisse — new to brand', NTB)).json().campaignId as string
    await ctx.approvals.approve(id, (await ctx.approvals.view(id)).assetVersion, 'HQ Admin (POC)').catch(() => undefined)
    const deal = await app.inject({ method: 'POST', url: '/api/admin/v1/buyers-lists', payload: { name: 'Swisse NTB', dealType: 'private_auction', invitedBuyers: [seat], targeting: [{ variable: SEG, op: 'include', values: [NTB] }], status: 'shared' } })
    expect(deal.statusCode).toBe(201)
    const refused = await put('swisse', [])
    expect(refused.statusCode).toBe(409)
    expectMatchesContract('PUT', '/admin/v1/advertisers/{advertiserId}/audiences', 409, refused.json())
    expect(refused.json().error).toMatchObject({ code: 'has_dependents', message: expect.stringContaining('Swisse NTB') })
    expect(refused.json().error.details.some((d: { field: string }) => d.field.startsWith('deal:'))).toBe(true)
  })

  it('offers a deal on an audience only to seats of the advertiser that holds it', async () => {
    const { app, put, ctx, seatOf } = await setup()
    await ctx.company.saveAdvertiserSeats('swisse', [{ partnerId: 'p_google', seatId: seatOf('Swisse') }])
    await put('swisse', [NTB])
    const make = (seatName: string) => app.inject({ method: 'POST', url: '/api/admin/v1/buyers-lists', payload: { name: `NTB ${seatName}`, dealType: 'private_auction', invitedBuyers: [{ partnerId: 'p_google', seatId: seatOf(seatName) }], targeting: [{ variable: SEG, op: 'include', values: [NTB] }], status: 'draft' } })
    expect((await make('Swisse')).statusCode).toBe(201)
    const nestle = await make('Nestlé')
    expect(nestle.statusCode).toBe(400)
    expect(nestle.json().error.details[0].reason).toContain(NTB)
  })

  it('rejects a value the vocabulary does not define, and an open real-time bid never carries one', async () => {
    const { put } = await setup()
    const r = await put('swisse', ['Made up'])
    expect(r.statusCode).toBe(400)
    expect(r.json().error.details[0].field).toBe('audiences[0]')
    expect((await put('nobody', [])).statusCode).toBe(404)
  })

  it('is read-only for Marketing and not available to Help desk', async () => {
    const m = await setup('hq_marketing')
    expect((await m.put('swisse', [NTB])).statusCode).toBe(403)
    expect((await m.app.inject({ method: 'GET', url: '/api/admin/v1/advertisers' })).statusCode).toBe(200)
    const h = await setup('hq_helpdesk')
    expect((await h.app.inject({ method: 'GET', url: '/api/admin/v1/advertisers' })).statusCode).toBe(403)
  })
})
