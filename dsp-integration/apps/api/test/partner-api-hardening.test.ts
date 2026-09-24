/* Partner API hardening (security review, 23 Sep 2026): who may write,
   how tokens are checked, how much one partner may ask for, and what every
   response carries. One test per defect the review reproduced. */
import { randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { partnerIdForToken } from '../src/auth/partnerAuth'
import { loadConfig } from '../src/config'
import { buildApp } from '../src/http/app'
import { tokenBucket } from '../src/http/rateLimit'
import { aesGcmSecretsStore } from '../src/secrets/SecretsStore'
import { testContext } from './helpers'
import { multipart, png } from './media'

const GOOGLE = { authorization: 'Bearer poc-token-google-dv360' }
const SWISSE = { advertiserId: 'swisse', name: 'Swisse — Sleep', displayTypeId: 'landscape', default: { pricingType: 'localised' } }
const COND = { source: 'store', variable: 'store.fixed_segments', op: 'include', values: ['Metro'] }

async function setup(tweak: (c: Awaited<ReturnType<typeof testContext>>['config']) => void = () => {}) {
  const ctx = await testContext()
  tweak(ctx.config)
  const app = buildApp(ctx)
  const create = (body: Record<string, unknown>) => app.inject({ method: 'POST', url: '/api/v1/campaigns', headers: GOOGLE, payload: body })
  return { ctx, app, create }
}

describe('only a connected DSP can create anything', () => {
  it('refuses campaign writes from a partner that is not connected, but still lets it read its own', async () => {
    const { ctx, app, create } = await setup()
    const id = (await create(SWISSE)).json().campaignId
    ctx.partners.update('p_google', { status: 'error' })
    const res = await create(SWISSE)
    expect(res.statusCode).toBe(409)
    expect(res.json().error).toMatchObject({ code: 'conflict', message: 'Google DSP is not connected.' })
    expect((await app.inject({ method: 'POST', url: `/api/v1/campaigns/${id}/submit`, headers: GOOGLE })).statusCode).toBe(409)
    expect((await app.inject({ method: 'GET', url: `/api/v1/campaigns/${id}/status`, headers: GOOGLE })).statusCode).toBe(200)
  })
})

describe('partner tokens', () => {
  it('resolve by digest, and object-key tokens resolve to nothing', () => {
    const tokens = { 'tok-a': 'p_a', 'tok-b': 'p_b' }
    expect(partnerIdForToken(tokens, 'tok-b')).toBe('p_b')
    for (const t of ['tok-', 'tok-bb', '__proto__', 'constructor', 'toString', '']) expect(partnerIdForToken(tokens, t)).toBeNull()
  })

  it('refuse to start in production on the public POC tokens', () => {
    expect(() => loadConfig({ NODE_ENV: 'production' })).toThrow(/PARTNER_TOKENS must be set/)
    expect(() => loadConfig({ NODE_ENV: 'production', PARTNER_TOKENS: '{"poc-token-google-dv360":"p_google"}' })).toThrow(/must not reuse/)
    expect(loadConfig({ NODE_ENV: 'production', PARTNER_TOKENS: '{"a-real-secret":"p_google"}' }).partnerTokens).toEqual({ 'a-real-secret': 'p_google' })
  })
})

describe('rate limiting', () => {
  it('a token bucket allows the burst, then refills at the rate', () => {
    let t = 0
    const b = tokenBucket({ perSecond: 2, burst: 3 }, () => t)
    expect([b.take('x'), b.take('x'), b.take('x')]).toEqual([0, 0, 0])
    expect(b.take('x')).toBe(1)
    expect(b.take('y')).toBe(0)
    t = 500
    expect(b.take('x')).toBe(0)
    expect(b.take('x')).toBe(1)
  })

  it('answers 429 rate_limited with Retry-After once a partner spends its allowance', async () => {
    const { app } = await setup((c) => { c.partnerRateLimit = { perSecond: 1, burst: 3 } })
    const codes: number[] = []
    for (let i = 0; i < 4; i++) codes.push((await app.inject({ url: '/api/v1/targeting/attributes', headers: GOOGLE })).statusCode)
    expect(codes).toEqual([200, 200, 200, 429])
    const res = await app.inject({ url: '/api/v1/targeting/attributes', headers: GOOGLE })
    expect(res.headers['retry-after']).toBe('1')
    expect(res.json().error.code).toBe('rate_limited')
    /* Per partner: another DSP still gets through. */
    expect((await app.inject({ url: '/api/v1/targeting/attributes', headers: { authorization: 'Bearer poc-token-amazon-dsp' } })).statusCode).not.toBe(429)
  })

  it('caps asset uploads in flight per partner', async () => {
    const { app, create } = await setup((c) => { c.maxConcurrentUploadsPerPartner = 1 })
    const id = (await create(SWISSE)).json().campaignId
    const send = () => {
      const m = multipart({ version: 'default' }, { name: 'a.png', bytes: png(1920, 1080, 2_000_000) })
      return app.inject({ method: 'POST', url: `/api/v1/campaigns/${id}/assets`, headers: { ...GOOGLE, ...m.headers }, payload: m.payload })
    }
    const codes = (await Promise.all([send(), send(), send()])).map((r) => r.statusCode).sort()
    expect(codes).toContain(201)
    expect(codes).toContain(429)
    /* The slot is released afterwards. */
    expect((await send()).statusCode).toBe(201)
  })
})

describe('request size limits', () => {
  it('caps a forecast at 200 positions, each once', async () => {
    const { app } = await setup()
    const f = (positionIds: string[]) => app.inject({ method: 'POST', url: '/api/v1/inventory/forecast', headers: GOOGLE, payload: { positionIds, from: '2026-10-01', to: '2026-10-02' } })
    const many = await f(Array.from({ length: 201 }, () => 'menu_board.s2'))
    expect(many.statusCode).toBe(400)
    expect(many.json().error.details).toEqual([{ field: 'positionIds', reason: 'At most 200 positions per forecast.' }])
    const dup = await f(['menu_board.s2', 'menu_board.s2'])
    expect(dup.json().error.details).toContainEqual({ field: 'positionIds', reason: 'Each position once.' })
  })

  it('bounds a content package: name, versions, groups, conditions and value length', async () => {
    const { create } = await setup()
    const detail = async (body: Record<string, unknown>) => (await create(body)).json().error.details
    expect(await detail({ ...SWISSE, name: 'x'.repeat(201) })).toEqual([{ field: 'name', reason: 'At most 200 characters.' }])
    const versions = Array.from({ length: 21 }, (_, i) => ({ id: `v${i}`, priority: i, pricingType: 'localised', rules: [[COND]] }))
    expect(await detail({ ...SWISSE, targeted: versions })).toEqual([{ field: 'targeted', reason: 'At most 20 targeted versions.' }])
    const one = (rules: unknown) => detail({ ...SWISSE, targeted: [{ id: 'metro', priority: 1, pricingType: 'localised', rules }] })
    expect(await one(Array.from({ length: 11 }, () => [COND]))).toEqual([{ field: 'targeted[0].rules', reason: 'At most 10 AND groups.' }])
    expect(await one([Array.from({ length: 21 }, () => COND)])).toEqual([{ field: 'targeted[0].rules[0]', reason: 'At most 20 conditions per AND group.' }])
    expect(await one([[{ ...COND, values: ['x'.repeat(201)] }]])).toEqual([{ field: 'targeted[0].rules[0][0].values', reason: 'Each value at most 200 characters.' }])
    /* At the limits it is accepted. */
    expect((await create({ ...SWISSE, name: 'x'.repeat(200), targeted: versions.slice(0, 20) })).statusCode).toBe(201)
  })
})

describe('errors and headers', () => {
  it('reports an oversized body as 413, not a 500', async () => {
    const { app } = await setup()
    const res = await app.inject({ method: 'POST', url: '/api/v1/campaigns', headers: { ...GOOGLE, 'content-type': 'application/json' }, payload: JSON.stringify({ name: 'x'.repeat(3_000_000) }) })
    expect(res.statusCode).toBe(413)
    expect(res.json().error.code).toBe('validation_failed')
  })

  it('sends nosniff, a locked-down CSP and no-store on every API response, errors included', async () => {
    const { app } = await setup()
    for (const res of [await app.inject({ url: '/api/v1/targeting/attributes', headers: GOOGLE }), await app.inject({ url: '/api/v1/inventory' })]) {
      expect(res.headers['x-content-type-options']).toBe('nosniff')
      expect(res.headers['content-security-policy']).toContain("default-src 'none'")
      expect(res.headers['cache-control']).toBe('no-store')
    }
  })
})

describe('secrets', () => {
  it('rejects a truncated GCM tag', () => {
    const s = aesGcmSecretsStore(randomBytes(32).toString('base64'))
    const [v, iv, tag, body] = s.encrypt('secret').split(':')
    expect(s.decrypt([v, iv, tag, body].join(':'))).toBe('secret')
    const short = Buffer.from(tag, 'base64').subarray(0, 4).toString('base64')
    expect(() => s.decrypt([v, iv, short, body].join(':'))).toThrow()
  })

  it('reports which secret fields are set, and follows a change to them', async () => {
    const { ctx } = await setup()
    const before = ctx.partners.get('p_google')!.secretsSet
    expect(before.length).toBeGreaterThan(0)
    ctx.partners.update('p_google', {}, {})
    expect(ctx.partners.get('p_google')!.secretsSet).toEqual([])
  })
})
