/* Sample/config bidder endpoints (ticket lMgCV0wS9p1fXWKVqCmu): no sample
   DSP points at a placeholder or a real production bidder, and the bid
   request → bid response round trip runs against the saved endpoint. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { runAuction } from '../../src/exchange/auction'
import { isPublicHttpsUrl } from '../../src/domain/partnerInput'
import { day, harness, POS } from './harness'

afterEach(() => {
  vi.unstubAllGlobals()
})

const SANDBOX = ['/dv360/openrtb2/bid', '/amazon/openrtb2/bid', '/ttd/openrtb2/bid']

describe('sample bidder endpoints', () => {
  it('every seeded endpoint is a sandbox URL, never a placeholder or a live production host', async () => {
    const h = await harness()
    await h.addSecondDsp()
    const endpoints = (await h.ctx.partners.list()).map((p) => p.bidder.bidderEndpoint).filter(Boolean) as string[]
    expect(endpoints.length).toBeGreaterThanOrEqual(2)
    for (const e of endpoints) {
      expect(e, e).not.toMatch(/doubleclick\.net|adsrvr\.org|\.example\b/)
      expect(SANDBOX.some((s) => e.endsWith(s)), e).toBe(true)
    }
  })

  it('a seeded sandbox endpoint saves back unchanged, a private one is still refused', async () => {
    const h = await harness()
    const url = (await h.ctx.partners.get('p_google'))!.bidder.bidderEndpoint!
    expect(isPublicHttpsUrl(url)).toBe(false)
    const ok = await h.app.inject({ method: 'PUT', url: '/api/admin/v1/partners/p_google', payload: { bidder: { bidderEndpoint: url, seatIds: ['884512'] } } })
    expect(ok.statusCode).toBe(200)
    const bad = await h.app.inject({ method: 'PUT', url: '/api/admin/v1/partners/p_google', payload: { bidder: { bidderEndpoint: 'http://10.0.0.5/bid' } } })
    expect(bad.statusCode).toBe(400)
  })

  it('round trip: the request goes to the endpoint saved on the DSP and its bid response is processed', async () => {
    const h = await harness()
    h.ctx.config.bidEndpointSource = 'partner'
    const saved = (await h.ctx.partners.get('p_google'))!.bidder.bidderEndpoint!
    const campaignId = await h.approvedCrid('crid-endpoint', day(0))
    h.bidder.log.bidRequests.length = 0
    const out = await runAuction(h.ctx, day(1))
    expect(h.bidder.log.bidRequests.map((r) => r.url)).toEqual([saved])
    expect(out.positions[0].winner).toMatchObject({ advertiserId: 'swisse', clearingCpm: 150 })
    expect(await h.rows(day(1), POS)).toEqual([expect.objectContaining({ campaignId, status: 'won' })])
  })

  it('in partner mode a DSP with no saved endpoint is sent nothing', async () => {
    const h = await harness()
    h.ctx.config.bidEndpointSource = 'partner'
    await h.ctx.partners.update('p_google', { bidder: { seatIds: ['884512'] } } as never)
    h.bidder.log.bidRequests.length = 0
    await runAuction(h.ctx, day(1))
    expect(h.bidder.log.bidRequests).toEqual([])
  })
})
