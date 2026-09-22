import { describe, expect, it } from 'vitest'
import { buildApp } from '../src/http/app'
import { expectMatchesContract } from './contract'
import { testContext } from './helpers'

const GOOGLE = { authorization: 'Bearer poc-token-google-dv360' }
const AMAZON = { authorization: 'Bearer poc-token-amazon-dsp' }

describe('Shared Targeting Variables (spec §6)', () => {
  it('lists the 25 default variables with example values and DSP access', async () => {
    const res = await buildApp(await testContext()).inject({ method: 'GET', url: '/api/admin/v1/targeting-variables' })
    expectMatchesContract('GET', '/admin/v1/targeting-variables', 200, res.json())
    const items = res.json().items
    expect(items).toHaveLength(25)
    expect(items[0]).toEqual({ key: 'store.hours', label: 'Store Open / Closed', group: 'localisation', exampleValues: 'Whether the store is open or closed at the time — e.g. Open, Closed', access: 'all' })
    expect(items.find((v: { key: string }) => v.key === 'store.fixed_segments').exampleValues).toBe('e.g. Airport, Metro, Regional')
    /* Computer Vision first, then the aggregates, then the rest (Rob, 20 Sep). */
    const personalisation = items.filter((v: { group: string }) => v.group === 'personalisation')
    expect(personalisation.slice(0, 4).map((v: { label: string }) => v.label)).toEqual(['Gender (Computer Vision)', 'Estimated Age (Computer Vision)', 'Reason for Visit (Aggregate)', 'Device Type (Aggregate)'])
    expect(personalisation[0].exampleValues).toMatch(/Vision\/AI running at the edge/)
    expect(personalisation.find((v: { key: string }) => v.key === 'visitor.age').exampleValues).toMatch(/CRM, CDP or loyalty/)
    /* Reason for Visit at the individual level sits just above Device Type (Rob, 20 Sep). */
    const keys = personalisation.map((v: { key: string }) => v.key)
    expect(keys[keys.indexOf('visitor.device_type') - 1]).toBe('visitor.reason_for_visit')
    /* Not supported initially — removed from the default set (ticket, 22 Sep). */
    expect(items.find((v: { key: string }) => v.key === 'store.languages')).toBeUndefined()
    /* They all default to no DSP; the seed names Google on two of them. */
    expect(personalisation.map((v: { access: unknown }) => v.access)).toEqual([[], [], ['p_google'], [], [], [], ['p_google'], [], [], [], [], [], [], [], [], [], []])
  })

  it('saves access per variable, de-duplicating DSP ids', async () => {
    const app = buildApp(await testContext())
    const res = await app.inject({ method: 'PUT', url: '/api/admin/v1/targeting-variables', payload: { access: { 'visitor.skus': ['p_google', 'p_google', 'p_amazon'], 'store.suburb': 'all' } } })
    expect(res.statusCode).toBe(200)
    expectMatchesContract('PUT', '/admin/v1/targeting-variables', 200, res.json())
    const byKey = Object.fromEntries(res.json().items.map((v: { key: string; access: unknown }) => [v.key, v.access]))
    expect(byKey['visitor.skus']).toEqual(['p_google', 'p_amazon'])
    expect(byKey['store.suburb']).toBe('all')
  })

  it('rejects unknown variables and unknown DSPs', async () => {
    const res = await buildApp(await testContext()).inject({ method: 'PUT', url: '/api/admin/v1/targeting-variables', payload: { access: { 'visitor.weather': 'all', 'visitor.age': ['p_nope'], 'visitor.gender': 'some' } } })
    expect(res.statusCode).toBe(400)
    expectMatchesContract('PUT', '/admin/v1/targeting-variables', 400, res.json())
    expect(res.json().error.details.map((d: { field: string }) => d.field)).toEqual(['access.visitor.weather', 'access.visitor.age', 'access.visitor.gender'])
  })
})

describe('GET /v1/targeting/attributes', () => {
  it('returns only what the calling DSP may target, and never any values', async () => {
    const res = await buildApp(await testContext()).inject({ method: 'GET', url: '/api/v1/targeting/attributes', headers: GOOGLE })
    expect(res.statusCode).toBe(200)
    expectMatchesContract('GET', '/v1/targeting/attributes', 200, res.json())
    const keys = res.json().items.map((a: { key: string }) => a.key)
    expect(keys).toEqual([
      'store.hours', 'store.fixed_segments', 'store.variable_segments', 'store.display_tags', 'store.state', 'store.reason_for_visit',
      'visitor.purchase_intent',
    ])
    expect(res.json().items[0]).toEqual({ key: 'store.hours', source: 'store', label: 'Store Open / Closed', group: 'localisation', operators: ['equal', 'not_equal'] })
    expect(res.body).not.toMatch(/Airport|Metro|e\.g\./)
  })

  it('a DSP that is not connected only gets variables it is named on: a smaller list, not an error', async () => {
    const app = buildApp(await testContext())
    const before = await app.inject({ method: 'GET', url: '/api/v1/targeting/attributes', headers: AMAZON })
    expect(before.statusCode).toBe(200)
    expect(before.json().items).toEqual([])
    await app.inject({ method: 'PUT', url: '/api/admin/v1/targeting-variables', payload: { access: { 'visitor.skus': ['p_amazon'] } } })
    const after = await app.inject({ method: 'GET', url: '/api/v1/targeting/attributes', headers: AMAZON })
    expect(after.json().items.map((a: { key: string }) => a.key)).toEqual(['visitor.skus'])
  })

  it('requires a partner token (401) and is 404 with the flag off', async () => {
    const res = await buildApp(await testContext()).inject({ method: 'GET', url: '/api/v1/targeting/attributes', headers: { authorization: 'Bearer wrong' } })
    expect(res.statusCode).toBe(401)
    expectMatchesContract('GET', '/v1/targeting/attributes', 401, res.json())
    expect((await buildApp(await testContext({ flag: false })).inject({ method: 'GET', url: '/api/v1/targeting/attributes', headers: GOOGLE })).statusCode).toBe(404)
  })
})
