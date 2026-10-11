/* Term versioning and re-acceptance (ticket KcqiJpzR5RXy4TWODYlG). */
import { describe, expect, it } from 'vitest'
import { buildApp } from '../src/http/app'
import { expectMatchesContract } from './contract'
import { testContext } from './helpers'

const base = { name: 'Q4 deal', description: 'FMCG', invitedBuyers: [{ partnerId: 'p_google', seatId: '5130001' }], activeFrom: null, activeTo: null, floorCpm: 120 }
const U = '/api/admin/v1/buyers-lists'

const setup = async () => {
  const app = buildApp(await testContext())
  const created = await app.inject({ method: 'POST', url: U, payload: base })
  expect(created.json()).toBeTruthy(); expect(created.statusCode, JSON.stringify(created.json())).toBe(201)
  return { app, id: created.json().id as string, created: created.json() }
}

describe('Buyers list term versions', () => {
  it('starts at version 1 with the invited buyer pending', async () => {
    const { created } = await setup()
    expect(created.termVersion).toBe(1)
    expect(created.buyerAcceptance).toEqual([{ partnerId: 'p_google', seatId: '5130001', state: 'pending', acceptedVersion: null, acceptedAt: null }])
  })

  it('records an acceptance, then a rate edit versions the deal and requires re-acceptance', async () => {
    const { app, id } = await setup()
    const acc = await app.inject({ method: 'POST', url: `${U}/${id}/acceptances`, payload: { partnerId: 'p_google', seatId: '5130001' } })
    expect(acc.statusCode).toBe(200)
    expectMatchesContract('POST', '/admin/v1/buyers-lists/{buyersListId}/acceptances', 200, acc.json())
    expect((await app.inject({ method: 'GET', url: U })).json().items[0].buyerAcceptance[0]).toMatchObject({ state: 'accepted', acceptedVersion: 1 })

    const check = await app.inject({ method: 'POST', url: `${U}/${id}/term-check`, payload: { ...base, floorCpm: 150 } })
    expect(check.statusCode).toBe(200)
    expectMatchesContract('POST', '/admin/v1/buyers-lists/{buyersListId}/term-check', 200, check.json())
    expect(check.json()).toMatchObject({ currentVersion: 1, nextVersion: 2, requiresReacceptance: true, changes: [{ field: 'floorCpm', from: 120, to: 150 }] })
    expect(check.json().affectedBuyers).toEqual([{ partnerId: 'p_google', partnerName: expect.any(String), seatId: '5130001', acceptedVersion: 1 }])
    /* The check writes nothing. */
    expect((await app.inject({ method: 'GET', url: U })).json().items[0].termVersion).toBe(1)

    const put = await app.inject({ method: 'PUT', url: `${U}/${id}`, payload: { ...base, floorCpm: 150 } })
    expect(put.statusCode).toBe(200)
    expect(put.json()).toMatchObject({ termVersion: 2, dealId: expect.any(String) })
    expect(put.json().buyerAcceptance[0]).toMatchObject({ state: 'reacceptance_required', acceptedVersion: 1 })

    await app.inject({ method: 'POST', url: `${U}/${id}/acceptances`, payload: { partnerId: 'p_google', seatId: '5130001' } })
    expect((await app.inject({ method: 'GET', url: U })).json().items[0].buyerAcceptance[0]).toMatchObject({ state: 'accepted', acceptedVersion: 2 })

    const versions = await app.inject({ method: 'GET', url: `${U}/${id}/term-versions` })
    expectMatchesContract('GET', '/admin/v1/buyers-lists/{buyersListId}/term-versions', 200, versions.json())
    expect(versions.json().items.map((v: { version: number }) => v.version)).toEqual([2, 1])
    expect(versions.json().items[0]).toMatchObject({ requiresReacceptance: true, changes: [{ field: 'floorCpm', from: 120, to: 150 }] })
  })

  it('a name or description change, or a rewritten timestamp, is not a new version and needs no warning', async () => {
    const { app, id } = await setup()
    await app.inject({ method: 'POST', url: `${U}/${id}/acceptances`, payload: { partnerId: 'p_google', seatId: '5130001' } })
    const edit = { ...base, name: 'Renamed', description: 'New words' }
    expect((await app.inject({ method: 'POST', url: `${U}/${id}/term-check`, payload: edit })).json()).toMatchObject({ requiresReacceptance: false, nextVersion: 1, changes: [], affectedBuyers: [] })
    const put = await app.inject({ method: 'PUT', url: `${U}/${id}`, payload: edit })
    expect(put.json()).toMatchObject({ termVersion: 1 })
    expect(put.json().buyerAcceptance[0].state).toBe('accepted')
  })

  it('inviting or removing a buyer versions the deal without forcing re-acceptance, and a removed buyer loses its acceptance', async () => {
    const { app, id } = await setup()
    await app.inject({ method: 'POST', url: `${U}/${id}/acceptances`, payload: { partnerId: 'p_google', seatId: '5130001' } })
    const two = { ...base, invitedBuyers: [...base.invitedBuyers, { partnerId: 'p_google', seatId: '5130002' }] }
    const put = await app.inject({ method: 'PUT', url: `${U}/${id}`, payload: two })
    expect(put.json().termVersion).toBe(2)
    expect(put.json().buyerAcceptance.map((a: { seatId: string; state: string }) => [a.seatId, a.state])).toEqual([['5130001', 'accepted'], ['5130002', 'pending']])
    expect((await app.inject({ method: 'GET', url: `${U}/${id}/term-versions` })).json().items[0].requiresReacceptance).toBe(false)
    await app.inject({ method: 'PUT', url: `${U}/${id}`, payload: { ...base, invitedBuyers: [{ partnerId: 'p_google', seatId: '5130002' }] } })
    await app.inject({ method: 'PUT', url: `${U}/${id}`, payload: two })
    expect((await app.inject({ method: 'GET', url: U })).json().items[0].buyerAcceptance[0]).toMatchObject({ seatId: '5130001', state: 'pending' })
  })

  it('refuses an acceptance from a seat that is not a named invited buyer, and 404s an unknown list', async () => {
    const { app, id } = await setup()
    const bad = await app.inject({ method: 'POST', url: `${U}/${id}/acceptances`, payload: { partnerId: 'p_google', seatId: '5130002' } })
    expect(bad.statusCode).toBe(400)
    expect((await app.inject({ method: 'POST', url: `${U}/bl_nope/acceptances`, payload: { partnerId: 'p_google', seatId: '5130001' } })).statusCode).toBe(404)
    expect((await app.inject({ method: 'POST', url: `${U}/bl_nope/term-check`, payload: base })).statusCode).toBe(404)
    expect((await app.inject({ method: 'GET', url: `${U}/bl_nope/term-versions` })).statusCode).toBe(404)
  })

  it('a deal-type change mints a new deal and is not a re-acceptance', async () => {
    const { app, id } = await setup()
    await app.inject({ method: 'POST', url: `${U}/${id}/acceptances`, payload: { partnerId: 'p_google', seatId: '5130001' } })
    const check = await app.inject({ method: 'POST', url: `${U}/${id}/term-check`, payload: { ...base, dealType: 'preferred' } })
    expect(check.json()).toMatchObject({ requiresReacceptance: false, changes: [] })
  })

  it('the SSP change history records the version and the field changes', async () => {
    const { app, id } = await setup()
    await app.inject({ method: 'PUT', url: `${U}/${id}`, payload: { ...base, floorCpm: 150 } })
    const audit = await app.inject({ method: 'GET', url: '/api/admin/v1/ssp-audit-log?objectType=buyers_list' })
    const fields = (audit.json().items ?? []).map((e: { field: string }) => e.field)
    expect(fields).toContain('floorCpm')
    expect(fields).toContain('termVersion')
  })
})
