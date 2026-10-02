/* Q46 (decision, Rob, 29 Sep 2026): per-DSP QPS ceiling and bidder timeout
   overrides on the DSP's connection settings; an override wins over the
   platform default (500 QPS, 300 ms). */
import { describe, expect, it } from 'vitest'
import { bidderTuning } from '../src/domain/partnerInput'
import { httpBidder } from '../src/dsp/bidder'
import { buildBidRequest, type BidRequest } from '../src/exchange/openrtb'
import { allPositions } from '../src/domain/positions'
import { buildApp } from '../src/http/app'
import { expectMatchesContract } from './contract'
import { testContext } from './helpers'

const put = (app: ReturnType<typeof buildApp>, bidder: object) => app.inject({ method: 'PUT', url: '/api/admin/v1/partners/p_google', payload: { bidder } })

describe('per-DSP bidder tuning (Q46)', () => {
  it('saves, returns and clears the overrides; defaults apply when unset', async () => {
    const ctx = await testContext()
    const app = buildApp(ctx)
    expect(bidderTuning((await ctx.partners.get('p_google'))!.bidder, ctx.config)).toEqual({ qps: 500, timeoutMs: 300 })

    const saved = await put(app, { qps: 50, timeoutMs: 800 })
    expect(saved.statusCode).toBe(200)
    expectMatchesContract('PUT', '/admin/v1/partners/{partnerId}', 200, saved.json())
    expect(saved.json().bidder).toMatchObject({ qps: 50, timeoutMs: 800 })
    expect(bidderTuning((await ctx.partners.get('p_google'))!.bidder, ctx.config)).toEqual({ qps: 50, timeoutMs: 800 })
    /* Only the DSP that set it: others keep the platform default. */
    expect(bidderTuning((await ctx.partners.get('p_amazon'))?.bidder ?? {}, ctx.config)).toEqual({ qps: 500, timeoutMs: 300 })

    const cleared = await put(app, { timeoutMs: null })
    expect(cleared.json().bidder.timeoutMs).toBeUndefined()
    expect(bidderTuning((await ctx.partners.get('p_google'))!.bidder, ctx.config)).toEqual({ qps: 50, timeoutMs: 300 })
  })

  it('refuses values outside the allowed range with validation_failed', async () => {
    const app = buildApp(await testContext())
    for (const bidder of [{ qps: 0 }, { qps: 1.5 }, { timeoutMs: 10 }, { timeoutMs: 5000 }, { qps: '100' }]) {
      const res = await put(app, bidder)
      expect(res.statusCode).toBe(400)
      expect(res.json().error.code).toBe('validation_failed')
    }
  })

  it('sends the DSP’s own timeout as tmax', async () => {
    const ctx = await testContext()
    const p = (await allPositions(ctx))[0]
    expect((await buildBidRequest(ctx, p, (await ctx.partners.get('p_google'))!, 'r1')).tmax).toBe(300)
    await put(buildApp(ctx), { timeoutMs: 900 })
    expect((await buildBidRequest(ctx, p, (await ctx.partners.get('p_google'))!, 'r1')).tmax).toBe(900)
  })

  it('the bidder aborts at the per-call timeout, not the default', async () => {
    /* A DSP that answers after 150 ms, and gives up when the exchange aborts. */
    const slow = httpBidder((_url, init) => new Promise((resolve, reject) => {
      const t = setTimeout(() => resolve(new Response('{"id":"r","seatbid":[]}', { status: 200 })), 150)
      init?.signal?.addEventListener('abort', () => { clearTimeout(t); reject(new Error('aborted')) })
    }), { timeoutMs: 1000, qps: 1000 })
    expect(await slow.send('http://dsp.test/bid', {} as BidRequest, { qps: 1000, timeoutMs: 50 })).toBeNull()
    expect(await slow.send('http://dsp.test/bid2', {} as BidRequest)).not.toBeNull()
  })
})
