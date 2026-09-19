import { describe, expect, it } from 'vitest'
import { buildMocks } from '../src/app'

describe('mock DSP control API', () => {
  it('adds and removes seats and advertisers, and resets to the seed', async () => {
    const { app } = buildMocks()
    expect((await app.inject({ method: 'POST', url: '/_control/the_trade_desk/seats', payload: { seatId: 'ttd-2', name: 'Second seat' } })).statusCode).toBe(201)
    const add = await app.inject({ method: 'POST', url: '/_control/the_trade_desk/advertisers', payload: { name: 'Coca-Cola', seatId: 'ttd-2', domain: 'coca-cola.com', categories: ['Food & Drink'] } })
    expect(add.statusCode).toBe(201)
    expect((await app.inject({ method: 'DELETE', url: '/_control/the_trade_desk/seats/ttd-2' })).statusCode).toBe(409)
    expect((await app.inject({ method: 'POST', url: '/_control/the_trade_desk/advertisers', payload: { name: 'X', seatId: 'nope' } })).statusCode).toBe(400)
    await app.inject({ method: 'DELETE', url: `/_control/the_trade_desk/advertisers/${add.json().id}` })
    expect((await app.inject({ method: 'DELETE', url: '/_control/the_trade_desk/seats/ttd-2' })).statusCode).toBe(200)
    await app.inject({ method: 'POST', url: '/_control/google_dv360/seats', payload: { seatId: 'x' } })
    await app.inject({ method: 'POST', url: '/_control/reset' })
    expect((await app.inject({ method: 'GET', url: '/_control/google_dv360' })).json().seats).toHaveLength(2)
  })

  it('serves the test page', async () => {
    const res = await buildMocks().app.inject({ method: 'GET', url: '/' })
    expect(res.headers['content-type']).toMatch(/text\/html/)
    expect(res.body).toContain('Mock DSPs')
  })
})

describe('mock DV360 API', () => {
  it('requires an OAuth token and the JWT-bearer grant', async () => {
    const { app } = buildMocks()
    const noAuth = await app.inject({ method: 'GET', url: '/dv360/v4/advertisers?partnerId=884512' })
    expect(noAuth.statusCode).toBe(401)
    expect(noAuth.json().error.status).toBe('UNAUTHENTICATED')
    const badGrant = await app.inject({ method: 'POST', url: '/dv360/token', payload: 'grant_type=client_credentials', headers: { 'content-type': 'application/x-www-form-urlencoded' } })
    expect(badGrant.json().error).toBe('unsupported_grant_type')
  })
})
