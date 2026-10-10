import { describe, expect, it } from 'vitest'
import { buildApp } from '../src/http/app'
import { expectMatchesContract } from './contract'
import { testContext } from './helpers'

const API = '/api/admin/v1'

describe('Platform users (Company Settings → Users)', () => {
  it('adds a direct advertiser, then an Advertiser user bound to it, and both persist in the lists', async () => {
    const app = buildApp(await testContext())
    expect((await app.inject({ method: 'POST', url: `${API}/advertisers/direct`, payload: { name: 'Fresh Fields Dairy' } })).statusCode).toBe(201)
    const add = await app.inject({ method: 'POST', url: `${API}/users`, payload: { firstName: 'Luca', lastName: 'Bianchi', email: 'Luca@FreshFields.example', role: 'Advertiser', advertiserId: 'fresh-fields-dairy', invite: true } })
    expect(add.statusCode).toBe(201)
    expectMatchesContract('POST', '/admin/v1/users', 201, add.json())
    expect(add.json()).toMatchObject({ email: 'luca@freshfields.example', advertiserId: 'fresh-fields-dairy', advertiserName: 'Fresh Fields Dairy', advertiserDirect: true, invited: true })
    const list = await app.inject({ method: 'GET', url: `${API}/users` })
    expectMatchesContract('GET', '/admin/v1/users', 200, list.json())
    expect(list.json().items).toHaveLength(1)
    /* The same advertiser is on the Advertisers list the drop-down reads. */
    const advs = (await app.inject({ method: 'GET', url: `${API}/advertisers` })).json().items as { advertiserId: string; direct: boolean }[]
    expect(advs.find((a) => a.advertiserId === 'fresh-fields-dairy')?.direct).toBe(true)
  })

  it('refuses an Advertiser user with an unknown advertiser, a bad email, a duplicate', async () => {
    const app = buildApp(await testContext())
    const bad = await app.inject({ method: 'POST', url: `${API}/users`, payload: { firstName: '', email: 'nope', role: 'Advertiser', advertiserId: 'nobody' } })
    expect(bad.statusCode).toBe(400)
    expectMatchesContract('POST', '/admin/v1/users', 400, bad.json())
    expect(bad.json().error.details.map((d: { field: string }) => d.field)).toEqual(['firstName', 'email', 'advertiserId'])
    const ok = { firstName: 'Priya', email: 'priya@retailer.example', role: 'Admin' }
    expect((await app.inject({ method: 'POST', url: `${API}/users`, payload: ok })).statusCode).toBe(201)
    expect((await app.inject({ method: 'POST', url: `${API}/users`, payload: ok })).statusCode).toBe(409)
  })

  it('edits (email fixed) and removes a user', async () => {
    const app = buildApp(await testContext())
    await app.inject({ method: 'POST', url: `${API}/users`, payload: { firstName: 'Tom', email: 'tom@retailer.example', role: 'Marketing' } })
    const put = await app.inject({ method: 'PUT', url: `${API}/users/tom@retailer.example`, payload: { firstName: 'Tom', lastName: 'Reyes', email: 'other@x.example', role: 'Help Desk' } })
    expect(put.statusCode).toBe(200)
    expectMatchesContract('PUT', '/admin/v1/users/{email}', 200, put.json())
    expect(put.json()).toMatchObject({ email: 'tom@retailer.example', lastName: 'Reyes', role: 'Help Desk' })
    expect((await app.inject({ method: 'DELETE', url: `${API}/users/tom@retailer.example` })).statusCode).toBe(204)
    expect((await app.inject({ method: 'DELETE', url: `${API}/users/tom@retailer.example` })).statusCode).toBe(404)
  })

  it('scope: an Advertiser user sees only their advertiser’s campaigns', async () => {
    const app = buildApp(await testContext())
    await app.inject({ method: 'POST', url: `${API}/users`, payload: { firstName: 'Sw', email: 'sw@swisse.example', role: 'Advertiser', advertiserId: 'swisse' } })
    const res = await app.inject({ method: 'GET', url: `${API}/users/sw@swisse.example/scope` })
    expect(res.statusCode).toBe(200)
    expectMatchesContract('GET', '/admin/v1/users/{email}/scope', 200, res.json())
    expect(res.json().advertiser.advertiserId).toBe('swisse')
    expect(res.json().campaigns.length).toBeGreaterThan(0)
    expect((await app.inject({ method: 'GET', url: `${API}/users/nobody@x.example/scope` })).statusCode).toBe(404)
  })

  it('non-admin sessions get 403', async () => {
    const res = await buildApp(await testContext({ role: 'hq_marketing' })).inject({ method: 'GET', url: `${API}/users` })
    expect(res.statusCode).toBe(403)
  })
})
