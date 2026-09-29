/* E2E spec v2 (board doc f34VQZCy2kkWJfBP6Iwp), Run 2 — open auction,
   non-happy paths. Same fixtures as Run 1. Every case expects a refusal, a
   fall-through or a contained failure — never a sale, a charge or a
   crashed auction. Case ids (E1…H9) are the spec's. */
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { advertiserSlug } from '@ph-dsp/types'
import { sweepRejectedCampaigns } from '../../src/domain/campaignRetention'
import { runAuction } from '../../src/exchange/auction'
import { lineItems } from '../../src/exchange/billing'
import { claimAuction, schedulerTick } from '../../src/exchange/scheduler'
import { prepared } from '../../src/db/db'
import { mp4, png } from '../media'
import { AMAZON, GOOGLE, POS, TTD, arnottsBid, day, harness, response, swisseBid } from './harness'

afterEach(() => {
  vi.unstubAllGlobals()
})

type H = Awaited<ReturnType<typeof harness>>
/* 18:00 UTC the day before is a window's auction cutoff (seed: auctionCutoffTime 18:00). */
const cutoffOf = (w: Date) => new Date(w.getTime() - 6 * 3_600_000 + 30_000)
const tick = async (h: H) => {
  const logs: string[] = []
  let error: string | null = null
  await schedulerTick(h.ctx, (m) => logs.push(m)).catch((e) => { error = (e as Error).message })
  return { logs, error }
}
const claims = (h: H) => prepared(h.ctx.db, 'SELECT * FROM auction_runs ORDER BY window_start').all() as { window_start: string; claimed_by: string; finished_at: string | null }[]
const sold = (h: H, w: Date) => h.rows(w).filter((r) => (r.status === 'won' || r.status === 'reserved') && !r.testMode)

describe('Run 2 — E. Partner API refusals', () => {
  it('E1 — DSP integration switched off: Partner API and sellers.json 404 before the token; no bid requests; no auction; sold windows still billed; nothing deleted; back on restores service', async () => {
    const h = await harness()
    const campaignId = await h.approvedCrid('crid-e1', day(0))
    await runAuction(h.ctx, day(1))
    expect(sold(h, day(1))).toHaveLength(1)
    h.playback.script(campaignId, day(1), { plays: 100, playedSec: 86_400 })
    const partners = h.ctx.partners.list().length
    const campaigns = h.ctx.campaigns.listCampaigns().length

    expect((await h.admin.exchange(false)).statusCode).toBe(200)
    const endpoints: [string, string, unknown?][] = [
      ['GET', '/api/v1/inventory'], ['GET', `/api/v1/inventory/${POS}`], ['GET', `/api/v1/inventory/${POS}/availability?from=2026-09-25&to=2026-09-25`],
      ['POST', '/api/v1/inventory/forecast', { positionIds: [POS], from: '2026-09-25', to: '2026-09-25' }],
      ['POST', '/api/v1/campaigns', { advertiserId: 'swisse', name: 'x', default: { pricingType: 'localised' } }], ['GET', `/api/v1/campaigns/${campaignId}/status`],
      ['POST', `/api/v1/campaigns/${campaignId}/submit`], ['POST', '/api/v1/reservations', { positionId: POS }], ['GET', '/api/v1/reservations/res_x'],
      ['GET', '/api/v1/targeting/attributes'],
    ]
    for (const [method, url, payload] of endpoints) {
      for (const headers of [{}, GOOGLE, { authorization: 'Bearer not-a-token' }]) {
        const res = await h.app.inject({ method: method as 'GET', url, headers, ...(payload ? { payload: payload as object } : {}) })
        expect(res.statusCode, `${method} ${url} ${JSON.stringify(headers)}`).toBe(404)
      }
    }
    expect((await h.app.inject({ method: 'GET', url: '/sellers.json' })).statusCode).toBe(404)

    const before = h.bidder.log.bidRequests.length
    await runAuction(h.ctx, day(3))
    expect(h.bidder.log.bidRequests.length).toBe(before)
    /* The scheduled tick at a cutoff: no auction claimed; the sold window (ended) is billed. */
    h.setNow(cutoffOf(day(3)))
    const t = await tick(h)
    expect(t.error).toBeNull()
    expect(claims(h)).toEqual([])
    expect(lineItems(h.ctx).map((i) => i.windowStart)).toEqual([day(1).toISOString()])
    expect(h.ctx.partners.list().length).toBe(partners)
    expect(h.ctx.campaigns.listCampaigns().length).toBe(campaigns)

    expect((await h.admin.exchange(true)).statusCode).toBe(200)
    expect((await h.app.inject({ method: 'GET', url: '/api/v1/inventory', headers: GOOGLE })).statusCode).toBe(200)
    expect((await h.app.inject({ method: 'GET', url: '/sellers.json' })).statusCode).toBe(200)
  })

  it('E2 — more than 50 req/s (burst 100) from one partner → 429 rate_limited with Retry-After; a second partner is unaffected', async () => {
    const h = await harness()
    h.addSecondDsp()
    expect(h.ctx.config.partnerRateLimit).toEqual({ perSecond: 50, burst: 100 })
    const codes: number[] = []
    let limited: Awaited<ReturnType<typeof h.app.inject>> | null = null
    for (let i = 0; i < 130; i++) {
      const res = await h.app.inject({ url: '/api/v1/targeting/attributes', headers: GOOGLE })
      codes.push(res.statusCode)
      if (res.statusCode === 429 && !limited) limited = res
    }
    expect(codes.slice(0, 100).every((c) => c === 200)).toBe(true)
    expect(limited, 'no 429 after the burst').not.toBeNull()
    expect(limited!.json().error.code).toBe('rate_limited')
    expect(Number(limited!.headers['retry-after'])).toBeGreaterThanOrEqual(1)
    expect((await h.app.inject({ url: '/api/v1/targeting/attributes', headers: TTD })).statusCode).toBe(200)
  })

  it('E3 — a third concurrent upload from one partner → 429; the fifth across all partners → 429 (PH_MAX_UPLOADS_IN_FLIGHT = 4)', async () => {
    const h = await harness()
    h.ctx.config.partnerRateLimit = { perSecond: 100_000, burst: 100_000 }
    h.addSecondDsp()
    h.ctx.partners.update('p_amazon', { status: 'connected' })
    expect(h.ctx.config.maxConcurrentUploadsPerPartner).toBe(2)
    expect(h.ctx.config.maxConcurrentUploads).toBe(4)
    const campaign = async (advertiserId: string, headers: typeof GOOGLE) =>
      (await h.partner.create({ advertiserId, name: `${advertiserId} — E3`, displayTypeId: 'e2e_signage', default: { pricingType: 'localised' } }, headers)).json().campaignId as string
    const g = await campaign('swisse', GOOGLE)
    const t = await campaign(advertiserSlug('Arnott’s'), TTD as Record<string, string> as typeof GOOGLE)
    const a = await campaign(advertiserSlug("L'Oréal"), AMAZON as typeof GOOGLE)
    const big = () => png(1920, 1080, 4_000_000)
    /* One partner, three at once. */
    const three = await Promise.all([0, 1, 2].map(() => h.partner.upload(g, 'default', big())))
    const perPartner = three.filter((r) => r.statusCode === 429)
    expect(perPartner).toHaveLength(1)
    expect(perPartner[0].json().error.message).toBe('At most 2 uploads at once; wait for one to finish.')
    /* Five across three partners (2 + 2 + 1): the fifth is over the process-wide cap. */
    const five = await Promise.all([
      h.partner.upload(g, 'default', big()), h.partner.upload(g, 'default', big()),
      h.partner.upload(t, 'default', big(), TTD), h.partner.upload(t, 'default', big(), TTD),
      h.partner.upload(a, 'default', big(), AMAZON),
    ])
    expect(five.map((r) => r.statusCode)).toEqual([201, 201, 201, 201, 429])
    expect(five[4].json().error.message).toBe('The exchange is checking as many uploads as it can at once; try again in a moment.')
    /* Slots are freed afterwards. */
    expect((await h.partner.upload(a, 'default', png(1920, 1080), AMAZON)).statusCode).toBe(201)
  })

  /* Regression for backlog vhn6HJDpq0cx7sntxrN2 (found by the E2E v2 run, 29 Sep
     2026; fixed on main since). */
  it('E4 — an asset over its size limit (image > 100 MB, video > 200 MB) fails file_size; a JSON body > 1 MB → 413', async () => {
    const h = await harness()
    const id = (await h.partner.create({ advertiserId: 'swisse', name: 'Swisse — E4', displayTypeId: 'e2e_signage', default: { pricingType: 'localised' } })).json().campaignId
    const image = await h.partner.upload(id, 'default', png(1920, 1080, 100 * 1024 * 1024 + 1))
    expect(image.statusCode).toBe(422)
    expect(image.json().error.details.map((d: { field: string }) => d.field)).toContain('file_size')
    /* At the image limit it isn't a size failure. */
    const atLimit = await h.partner.upload(id, 'default', png(1920, 1080, 100 * 1024 * 1024 - 100))
    expect(atLimit.statusCode).toBe(201)
    expect(atLimit.json().checks.find((c: { name: string }) => c.name === 'file_size')).toMatchObject({ passed: true })
    const video = await h.partner.upload(id, 'default', mp4(1920, 1080, 10, 200 * 1024 * 1024 + 1), GOOGLE, 'creative.mp4')
    expect(video.statusCode).toBe(422)
    expect(video.json().error.details.map((d: { field: string }) => d.field)).toContain('file_size')
    const body = await h.app.inject({ method: 'POST', url: '/api/v1/campaigns', headers: { ...GOOGLE, 'content-type': 'application/json' }, payload: JSON.stringify({ name: 'x'.repeat(1024 * 1024 + 10) }) })
    expect(body.statusCode).toBe(413)
  }, 60_000)

  it('E5 — content-package limits (name > 200, > 10 AND groups, > 20 conditions/group, > 100 values/condition) → validation_failed', async () => {
    const h = await harness()
    const COND = { source: 'store', variable: 'store.fixed_segments', op: 'include', values: ['Metro'] }
    const base = { advertiserId: 'swisse', name: 'Swisse — E5', displayTypeId: 'e2e_signage', default: { pricingType: 'localised' } }
    const refused = async (body: Record<string, unknown>) => {
      const res = await h.partner.create(body)
      expect(res.statusCode).toBe(400)
      expect(res.json().error.code).toBe('validation_failed')
      return res.json().error.details
    }
    const one = (rules: unknown) => ({ ...base, targeted: [{ id: 'metro', priority: 1, pricingType: 'localised', rules }] })
    expect(await refused({ ...base, name: 'x'.repeat(201) })).toEqual([{ field: 'name', reason: 'At most 200 characters.' }])
    expect(await refused(one(Array.from({ length: 11 }, () => [COND])))).toEqual([{ field: 'targeted[0].rules', reason: 'At most 10 AND groups.' }])
    expect(await refused(one([Array.from({ length: 21 }, () => COND)]))).toEqual([{ field: 'targeted[0].rules[0]', reason: 'At most 20 conditions per AND group.' }])
    const many = await refused(one([[{ ...COND, values: Array.from({ length: 101 }, (_, i) => `v${i}`) }]]))
    expect(many.map((d: { field: string }) => d.field)).toContain('targeted[0].rules[0][0].values')
    /* At the limits: accepted. */
    expect((await h.partner.create({ ...one([[{ ...COND, values: Array.from({ length: 100 }, (_, i) => `v${i}`) }]]), name: 'x'.repeat(200) })).statusCode).toBe(201)
  })

  it('E6 — targeting the slot doesn’t support (personalised on a localised-only slot) → targeting_not_supported', async () => {
    const h = await harness()
    const id = await h.readyApiCampaign('Swisse — E6', 'personalised')
    const res = await h.partner.bid(id, day(0), 300)
    expect(res.statusCode).toBe(422)
    expect(res.json().error).toMatchObject({ code: 'targeting_not_supported', message: 'This position supports localised targeting only; the campaign is personalised.' })
    /* Submitting for that slot is refused too. */
    const create = await h.partner.create({ advertiserId: 'swisse', name: 'Swisse — E6 slot', displayTypeId: 'e2e_signage', slot: 1, default: { pricingType: 'personalised' } })
    expect(create.statusCode).toBe(400)
    expect(create.json().error.details).toEqual([{ field: 'default.pricingType', reason: 'This slot supports localised targeting only; personalised is not enabled for it.' }])
  })

  it('E7 — a forecast with > 200 positions or a repeated position → validation_failed', async () => {
    const h = await harness()
    const f = (positionIds: string[]) => h.app.inject({ method: 'POST', url: '/api/v1/inventory/forecast', headers: GOOGLE, payload: { positionIds, from: '2026-09-25', to: '2026-09-26' } })
    const many = await f(Array.from({ length: 201 }, () => POS))
    expect(many.statusCode).toBe(400)
    expect(many.json().error).toMatchObject({ code: 'validation_failed' })
    expect(many.json().error.details).toContainEqual({ field: 'positionIds', reason: 'At most 200 positions per forecast.' })
    const dup = await f([POS, POS])
    expect(dup.statusCode).toBe(400)
    expect(dup.json().error.details).toContainEqual({ field: 'positionIds', reason: 'Each position once.' })
    expect((await f([POS])).statusCode).toBe(200)
  })

  it('E8 — an API bid with bidCpm > 10,000 → 400 validation_failed', async () => {
    const h = await harness()
    const id = await h.readyApiCampaign('Swisse — E8')
    const res = await h.partner.bid(id, day(0), 10_000.01)
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe('validation_failed')
    expect(res.json().error.details).toContainEqual({ field: 'bidCpm', reason: 'At most 10000 CPM.' })
    expect((await h.partner.bid(id, day(0), 10_000)).statusCode).toBe(201)
  })

  it('E9 — an invalid window-start format → 400, never 500', async () => {
    const h = await harness()
    const id = await h.readyApiCampaign('Swisse — E9')
    for (const windowStart of ['2026-13-45', 'tomorrow', '2026-09-21T01:00:00Z', '', null, 12345, '2026-09-21T00:00:00.000Zjunk', { a: 1 }]) {
      const res = await h.partner.bid(id, day(0), 200, { windowStart })
      expect(res.statusCode, JSON.stringify(windowStart)).toBe(400)
    }
    for (const q of ['from=2026-13-45&to=2026-09-25', 'from=nope&to=nope', 'from=2026-09-25', '']) {
      const res = await h.app.inject({ method: 'GET', url: `/api/v1/inventory/${POS}/availability?${q}`, headers: GOOGLE })
      expect(res.statusCode, q).toBe(400)
    }
    const f = await h.app.inject({ method: 'POST', url: '/api/v1/inventory/forecast', headers: GOOGLE, payload: { positionIds: [POS], from: 'soon', to: 'later' } })
    expect(f.statusCode).toBe(400)
  })

  it('E10 — another partner’s campaign, reservation or position → 404 (no IDOR)', async () => {
    const h = await harness()
    h.addSecondDsp()
    /* The position is Google's only. */
    h.admin.slot({ partnerIds: ['p_google'] })
    const id = await h.readyApiCampaign('Swisse — E10')
    const r = await h.partner.bid(id, day(0), 200)
    expect(r.statusCode).toBe(201)
    const rid = r.json().reservationId
    const asTtd = [
      h.app.inject({ method: 'GET', url: `/api/v1/campaigns/${id}/status`, headers: TTD }),
      h.app.inject({ method: 'POST', url: `/api/v1/campaigns/${id}/submit`, headers: TTD }),
      h.partner.upload(id, 'default', png(1920, 1080), TTD),
      h.app.inject({ method: 'GET', url: `/api/v1/reservations/${rid}`, headers: TTD }),
      h.app.inject({ method: 'GET', url: `/api/v1/inventory/${POS}`, headers: TTD }),
      h.app.inject({ method: 'GET', url: `/api/v1/inventory/${POS}/availability?from=2026-09-25&to=2026-09-25`, headers: TTD }),
    ]
    const labels = ['campaign status', 'submit', 'upload', 'reservation', 'position', 'availability']
    ;(await Promise.all(asTtd)).forEach((res, i) => expect(res.statusCode, labels[i]).toBe(404))
    /* Bidding on it with Google's campaign is refused without revealing either. */
    const bid = await h.partner.reserve({ positionId: POS, windowStart: day(1).toISOString(), campaignId: id, advertiserId: advertiserSlug('Arnott’s'), type: 'bid', bidCpm: 200 }, TTD)
    expect(bid.statusCode).toBe(400)
    expect(bid.json().error.details.map((d: { field: string; reason: string }) => `${d.field}: ${d.reason}`)).toEqual(expect.arrayContaining(['campaignId: Not one of this advertiser’s campaigns.', 'positionId: Unknown position.']))
    const listed = (await h.app.inject({ method: 'GET', url: '/api/v1/inventory', headers: TTD })).json()
    expect(JSON.stringify(listed)).not.toContain(POS)
  })

  it('E11 — writes from a DSP whose connection re-test failed (create, upload, submit, bid) → 409; reads of its own campaigns still allowed', async () => {
    const h = await harness()
    const id = await h.readyApiCampaign('Swisse — E11')
    const draft = (await h.partner.create({ advertiserId: 'swisse', name: 'Swisse — E11 draft', displayTypeId: 'e2e_signage', default: { pricingType: 'localised' } })).json().campaignId
    await h.bidder.auth({ accept: false })
    expect((await h.admin.connect()).json().status).toBe('error')
    const writes = {
      create: await h.partner.create({ advertiserId: 'swisse', name: 'x', displayTypeId: 'e2e_signage', default: { pricingType: 'localised' } }),
      upload: await h.partner.upload(draft, 'default', png(1920, 1080)),
      submit: await h.partner.submit(draft),
      bid: await h.partner.bid(id, day(0), 200),
    }
    for (const [k, res] of Object.entries(writes)) {
      expect(res.statusCode, k).toBe(409)
      expect(res.json().error.message, k).toBe('Google DSP is not connected.')
    }
    expect((await h.partner.status(id)).statusCode).toBe(200)
  })

  /* Regression for backlog KZcmgdrqJcKq0uKfVgl4 (found by the E2E v2 run, 29 Sep
     2026; fixed on main since). */
  it('E11 — writes from a DSP the retailer disconnected (create, upload, submit, bid) → 409; reads of its own campaigns still allowed', async () => {
    const h = await harness()
    const id = await h.readyApiCampaign('Swisse — E11b')
    const draft = (await h.partner.create({ advertiserId: 'swisse', name: 'Swisse — E11b draft', displayTypeId: 'e2e_signage', default: { pricingType: 'localised' } })).json().campaignId
    expect((await h.admin.disconnect()).statusCode).toBe(200)
    const writes = {
      create: await h.partner.create({ advertiserId: 'swisse', name: 'x', displayTypeId: 'e2e_signage', default: { pricingType: 'localised' } }),
      upload: await h.partner.upload(draft, 'default', png(1920, 1080)),
      submit: await h.partner.submit(draft),
      bid: await h.partner.bid(id, day(0), 200),
    }
    const got = Object.fromEntries(Object.entries(writes).map(([k, r]) => [k, `${r.statusCode} ${r.json().error?.message}`]))
    expect(got).toEqual({
      create: '409 Google DSP is not connected.', upload: '409 Google DSP is not connected.', submit: '409 Google DSP is not connected.', bid: '409 Google DSP is not connected.',
    })
    expect((await h.partner.status(id)).statusCode).toBe(200)
  })
})

describe('Run 2 — F. Bid-response hardening', () => {
  const setup = async () => {
    const h = await harness()
    await h.approvedCrid('crid-f', day(0))
    return h
  }

  it('F1 — a response whose id doesn’t echo the request is ignored', async () => {
    const h = await setup()
    h.bidder.setScript((req) => ({ body: { ...response(req, [swisseBid(req, { price: 500, crid: 'crid-f' })]), id: 'someone-elses-request' } }))
    const out = await runAuction(h.ctx, day(1))
    expect(out.positions[0]).toMatchObject({ bidRequests: 1, bids: 0, winner: null })
    expect(h.rows(day(1))).toEqual([])
  })

  it('F2 — a bid for impid ≠ 1 is rejected', async () => {
    const h = await setup()
    h.bidder.setScript((req) => ({ body: response(req, [{ ...swisseBid(req, { price: 500, crid: 'crid-f' }), impid: '2' }]) }))
    const out = await runAuction(h.ctx, day(1))
    expect(out.positions[0].winner).toBeNull()
    expect(h.rows(day(1))[0]).toMatchObject({ status: 'rejected', reason: 'Bid for impression 2; the request offered impression 1.' })
  })

  it('F3 — a missing cur is read as USD and rejected on an AUD exchange', async () => {
    const h = await setup()
    h.bidder.setScript((req) => {
      const { cur: _cur, ...body } = response(req, [swisseBid(req, { price: 500, crid: 'crid-f' })])
      return { body }
    })
    expect((await runAuction(h.ctx, day(1))).positions[0].winner).toBeNull()
    expect(h.rows(day(1))[0]).toMatchObject({ status: 'rejected', reason: 'Bid in USD; the exchange trades in AUD.' })
  })

  it('F4 — a non-finite price, or one above 10,000 CPM, is rejected', async () => {
    const h = await setup()
    let n = 1
    for (const [raw, reason] of [
      ['1e999', 'No price on the bid.'],
      ['10000.01', 'Bid of 10000.01 AUD CPM is above the exchange\'s ceiling of 10000.'],
      ['-5', 'No price on the bid.'],
      ['"150"', 'No price on the bid.'],
    ] as const) {
      const w = day(n++)
      h.bidder.setScript((req) => ({ raw: JSON.stringify(response(req, [swisseBid(req, { price: '__P__', crid: 'crid-f' })])).replace('"__P__"', raw) }))
      expect((await runAuction(h.ctx, w)).positions[0].winner, raw).toBeNull()
      expect(h.rows(w)[0], raw).toMatchObject({ status: 'rejected', reason })
    }
  })

  it('F5 — more than 10 bids: only the first 10 are read', async () => {
    const h = await setup()
    h.bidder.setScript((req) => ({ body: response(req, Array.from({ length: 14 }, (_, i) => swisseBid(req, { price: 100 + i, crid: 'crid-f', id: `b${i}` }))) }))
    const out = await runAuction(h.ctx, day(1))
    expect(out.positions[0].bids).toBe(10)
    expect(h.rows(day(1))).toHaveLength(10)
    /* The 11th–14th (higher prices) were never read: the best read bid, 109, cleared. */
    expect(out.positions[0].winner).toMatchObject({ clearingCpm: 109 })
  })

  it('F6 — a body over 64 KB is treated as no bid', async () => {
    const h = await setup()
    h.bidder.setScript((req) => ({ body: { ...response(req, [swisseBid(req, { price: 500, crid: 'crid-f' })]), ext: { pad: 'x'.repeat(65 * 1024) } } }))
    const out = await runAuction(h.ctx, day(1))
    expect(out.positions[0]).toMatchObject({ bidRequests: 1, bids: 0, winner: null })
    expect(h.rows(day(1))).toEqual([])
  })

  it('F7 — a bidder slower than 300 ms (headers or body) is aborted; the position falls through; other DSPs’ bids still count', async () => {
    const h = await harness()
    h.addSecondDsp()
    await h.approvedCrid('crid-f7-g', day(0))
    const arnotts = await h.approvedCrid('crid-f7-t', day(1), 'p_ttd')
    const fast = (req: Parameters<typeof response>[0]) => ({ body: response(req, [arnottsBid(req, { price: 140, crid: 'crid-f7-t' })], 'ttd-seat-1') })
    const google = (req: Parameters<typeof response>[0]) => response(req, [swisseBid(req, { price: 500, crid: 'crid-f7-g' })])
    /* Slow headers, then a slow body, from Google; Arnott's on The Trade Desk answers at once. */
    let n = 2
    for (const slow of [{ delayMs: 450 }, { bodyDelayMs: 450 }]) {
      const w = day(n++)
      h.bidder.setScript((req, url) => (url.includes('/dv360/') ? { body: google(req), ...slow } : fast(req)))
      const started = Date.now()
      const out = await runAuction(h.ctx, w)
      expect(Date.now() - started, JSON.stringify(slow)).toBeLessThan(440)
      expect(out.positions[0].winner, JSON.stringify(slow)).toMatchObject({ partnerId: 'p_ttd', clearingCpm: 140 })
      expect(h.rows(w).find((r) => r.partnerId === 'p_google'), JSON.stringify(slow)).toBeUndefined()
      expect(bookingsCampaign(h, w)).toEqual([arnotts])
    }
    /* Google alone and slow: the position falls through. */
    h.bidder.setScript((req, url) => (url.includes('/dv360/') ? { body: google(req), delayMs: 450 } : { status: 204 }))
    const w = day(4)
    expect((await runAuction(h.ctx, w)).positions[0].winner).toBeNull()
    expect(bookingsCampaign(h, w)).toEqual([])
  })

  it('F8 — two DSPs answering in different orders give an identical outcome (processed in DSP order)', async () => {
    const h = await harness()
    h.addSecondDsp()
    await h.approvedCrid('crid-f8-g', day(0))
    await h.approvedCrid('crid-f8-t', day(1), 'p_ttd')
    const outcome = async (w: Date, googleFirst: boolean) => {
      h.bidder.setScript((req, url) => url.includes('/dv360/')
        ? { body: response(req, [swisseBid(req, { price: 160, crid: 'crid-f8-g' })]), delayMs: googleFirst ? 0 : 120 }
        : { body: response(req, [arnottsBid(req, { price: 160, crid: 'crid-f8-t' })], 'ttd-seat-1'), delayMs: googleFirst ? 120 : 0 })
      const out = await runAuction(h.ctx, w)
      return { winner: out.positions[0].winner?.partnerId, rows: h.rows(w).map((r) => `${r.partnerId}:${r.status}:${r.bidCpm}`).sort() }
    }
    const a = await outcome(day(2), true)
    const b = await outcome(day(3), false)
    expect(a.winner).toBeDefined()
    expect(b).toEqual(a)
  })
})

const bookingsCampaign = (h: H, w: Date) => h.campaigns.handoffs.filter((b) => b.windowStart === w.toISOString()).map((b) => b.campaignId)

describe('Run 2 — G. Approval lifecycle (non-happy)', () => {
  it('G1 — the retailer rejects with asset-level reasons → Rejected; bids on it are discarded pre-auction', async () => {
    const h = await harness()
    await h.bidder.control({ crid: 'crid-g1' })
    await runAuction(h.ctx, day(0))
    const id = h.queuedCampaign('crid-g1')!
    const asset = h.ctx.campaigns.latestAssets(id)[0]
    const rej = await h.admin.reject(id, 'Creative breaches brand guidelines.', [{ assetId: asset.id, reason: 'Logo is cropped.' }])
    expect(rej.statusCode).toBe(200)
    expect(await h.ctx.approvals.view(id)).toMatchObject({ status: 'rejected', reason: 'Creative breaches brand guidelines.' })
    const review = (await h.app.inject({ method: 'GET', url: `/api/admin/v1/campaigns/${id}/approval` })).json()
    expect(JSON.stringify(review)).toContain('Logo is cropped.')
    await runAuction(h.ctx, day(1))
    expect(h.rows(day(1))[0]).toMatchObject({ status: 'rejected', reason: 'The campaign is not approved.' })
    expect(bookingsCampaign(h, day(1))).toEqual([])
  })

  /* Q38 (Rob, 29 Sep 2026; REQUIREMENTS §3 "pending edit"): changing an
     approved campaign's assets creates a pending edit. The edit is Awaiting
     approval, but the previously approved version keeps running — still
     bidding, winning and handed off with its own approved creative — until
     the edit is approved, which swaps it in from the next hand-off. */
  it('G2 — changing assets on an Approved campaign puts the edit in Awaiting approval; the approved version keeps running until the edit is approved', async () => {
    const h = await harness()
    const id = await h.readyApiCampaign('Swisse — G2')
    const pending = await h.partner.bid(id, day(0), 200)
    expect(pending.statusCode).toBe(201)
    expect((await h.partner.upload(id, 'default', png(1920, 1080, 10))).statusCode).toBe(201)
    expect((await h.partner.status(id)).json().status).toBe('awaiting_approval')
    await h.bidder.control({ mode: 'no_bid' })
    /* The approved version still wins and is handed off, with its own creative. */
    expect((await runAuction(h.ctx, day(0))).positions[0].winner).toMatchObject({ reservationId: pending.json().reservationId, clearingCpm: 200 })
    const before = h.campaigns.handoffs.filter((b) => b.campaignId === id)
    expect(before).toHaveLength(1)
    /* It may keep bidding while the edit is reviewed. */
    expect((await h.partner.bid(id, day(1), 200)).statusCode).toBe(201)
    /* The edit approved: the next hand-off plays the new version. */
    expect((await h.admin.approve(id, 'v2')).statusCode).toBe(200)
    expect((await runAuction(h.ctx, day(1))).positions[0].winner).toMatchObject({ clearingCpm: 200 })
    const after = h.campaigns.handoffs.filter((b) => b.campaignId === id)
    expect(after).toHaveLength(2)
    expect(after[1].assetVersion).toBeGreaterThan(before[0].assetVersion as number)
  })

  it('G3 — undo rejection → Awaiting approval, never auto-approved (even once the advertiser no longer requires approval)', async () => {
    const h = await harness()
    const { id } = await h.submitApiCampaign('Swisse — G3')
    expect((await h.admin.reject(id, 'Wrong pack shot.')).statusCode).toBe(200)
    /* The advertiser is switched to "approval not required" after the rejection. */
    h.ctx.company.saveAdvertiserSettings({ ...Object.fromEntries(['nestle', "l-oreal"].map((k) => [k, h.ctx.company.advertiserSetting(k)])), swisse: { approvalRequired: false, floorMultiplier: 1 } })
    expect(h.ctx.company.advertiserSetting('swisse').approvalRequired).toBe(false)
    expect((await h.admin.unreject(id)).statusCode).toBe(200)
    expect(await h.ctx.approvals.view(id)).toMatchObject({ status: 'awaiting_approval' })
    expect((await h.partner.bid(id, day(0), 200)).json().error.code).toBe('not_approved')
  })

  it('G4 — a Rejected campaign past rejectedCampaignRetentionDays (30) is deleted; its audit trail is kept', async () => {
    const h = await harness()
    expect(h.ctx.config.rejectedCampaignRetentionDays).toBe(30)
    const { id } = await h.submitApiCampaign('Swisse — G4')
    await h.admin.reject(id, 'Not suitable.')
    const now = Date.now()
    sweepRejectedCampaigns(h.ctx.db, 30, () => new Date(now + 29 * 86_400_000))
    expect(h.ctx.campaigns.getCampaign(id)).not.toBeNull()
    sweepRejectedCampaigns(h.ctx.db, 30, () => new Date(now + 31 * 86_400_000))
    expect(h.ctx.campaigns.getCampaign(id)).toBeNull()
    expect(h.ctx.campaigns.latestAssets(id)).toEqual([])
    const audit = h.ctx.db.prepare('SELECT action FROM campaign_approval_audit WHERE campaign_id = ?').all(id) as { action: string }[]
    expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(['submitted', 'rejected']))
  })

  /* Regression for backlog JN6puz0horqHgaTk3HRC (found by the E2E v2 run, 29 Sep
     2026; fixed on main since). */
  it('G5 — approval not required: an unknown creative is auto-approved and competes in a later window, not the current one', async () => {
    const h = await harness()
    expect(h.ctx.company.advertiserSetting('nestle')).toMatchObject({ approvalRequired: false })
    /* Nestlé (5130001) bids with a new creative. */
    await h.bidder.control({ mode: 'bid', priceCpm: 150, advertiserId: '5130001', crid: 'crid-g5' })
    const now = await runAuction(h.ctx, day(0))
    expect(now.positions[0].winner).toBeNull()
    expect(h.rows(day(0))[0]).toMatchObject({ status: 'rejected', reason: 'New creative crid-g5: approved automatically; it can compete from the next window.' })
    expect(await h.ctx.approvals.view(h.queuedCampaign('crid-g5')!)).toMatchObject({ status: 'approved', mode: 'auto' })
    /* The next window, with nothing else done: it competes (and, alone above the floor, wins). */
    const next = await runAuction(h.ctx, day(1))
    expect(h.rows(day(1))[0].reason, 'the auto-approved creative did not compete in the next window').not.toBe('The campaign is approved but not activated.')
    expect(next.positions[0].winner).toMatchObject({ advertiserId: 'nestle', clearingCpm: 150 })
  })

  it('G6 — a Draft campaign never appears retailer-facing', async () => {
    const h = await harness()
    const draft = (await h.partner.create({ advertiserId: 'swisse', name: 'Swisse — G6 draft', displayTypeId: 'e2e_signage', default: { pricingType: 'localised' } })).json().campaignId
    const { id: submitted } = await h.submitApiCampaign('Swisse — G6 submitted')
    /* The retailer's Campaign Status table is built from the approvals list: it
       carries a Draft labelled as such, and the page drops those rows and their
       count (CampaignStatusPage.tsx). Every retailer status filter excludes it. */
    const approvals = (await h.app.inject({ method: 'GET', url: '/api/admin/v1/approvals?limit=200' })).json()
    expect(approvals.items.find((a: { campaignId: string }) => a.campaignId === draft)).toMatchObject({ status: 'draft' })
    expect(approvals.items.find((a: { campaignId: string }) => a.campaignId === submitted)).toMatchObject({ status: 'awaiting_approval' })
    for (const status of ['awaiting_approval', 'approved', 'rejected']) {
      const byStatus = (await h.app.inject({ method: 'GET', url: `/api/admin/v1/approvals?status=${status}&limit=200` })).json()
      expect(byStatus.items.map((a: { campaignId: string }) => a.campaignId), status).not.toContain(draft)
    }
    const page = readFileSync(new URL('../../../admin/src/features/campaign-status/CampaignStatusPage.tsx', import.meta.url), 'utf8')
    expect(page).toMatch(/const all = useMemo\(\(\) => nonHq\.filter\(\(c\) => approvals\[c\.campaignId\]\?\.status !== 'draft'\)/)
    expect(page).toMatch(/for \(const row of all\)/)
  })
})

describe('Run 2 — H. Scheduling, concurrency & billing faults', () => {
  it('H1 — an API bid placed while the bidders are being awaited is in this auction; nothing is left pending', async () => {
    const h = await harness()
    const id = await h.readyApiCampaign('Swisse — H1')
    h.bidder.setScript((req) => ({ body: response(req, []), delayMs: 150 }))
    const auction = runAuction(h.ctx, day(0))
    await new Promise((r) => setTimeout(r, 40))
    expect((await h.partner.bid(id, day(0), 200)).statusCode).toBe(201)
    const out = await auction
    expect(out.positions[0].winner).toMatchObject({ clearingCpm: 200 })
    expect(h.rows(day(0)).filter((r) => r.status === 'pending')).toEqual([])
  })

  it('H2 — a bid for a window already claimed in auction_runs → 409 "closed"', async () => {
    const h = await harness()
    const id = await h.readyApiCampaign('Swisse — H2')
    expect(claimAuction(h.ctx, day(0).toISOString())).toBe(true)
    const res = await h.partner.bid(id, day(0), 200)
    expect(res.statusCode).toBe(409)
    expect(res.json().error.message).toMatch(/^Bidding for that window closed at .*, when its auction ran\.$/)
    expect((await h.partner.bid(id, day(1), 200)).statusCode).toBe(201)
  })

  it('H3 — the same advertiser bidding twice for one window on two processes → one 201, one refusal', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'ph-e2e-h3-')), 'poc.sqlite')
    const a = await harness({ dbFile: file })
    const b = await harness({ dbFile: file })
    for (const x of [a, b]) x.ctx.config.partnerRateLimit = { perSecond: 100_000, burst: 100_000 }
    const id = await a.readyApiCampaign('Swisse — H3')
    const results = await Promise.all([a.partner.bid(id, day(0), 200), b.partner.bid(id, day(0), 210), a.partner.bid(id, day(0), 220), b.partner.bid(id, day(0), 230)])
    const codes = results.map((r) => r.statusCode).sort()
    expect(codes).toEqual([201, 409, 409, 409])
    expect(a.rows(day(0)).filter((r) => r.channel === 'api' && r.status === 'pending')).toHaveLength(1)
    a.ctx.db.close()
    b.ctx.db.close()
  })

  it('H4 — two ticks (scheduler + CLI) and a second process at one cutoff → exactly one auction and one round of bid requests', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'ph-e2e-h4-')), 'poc.sqlite')
    const a = await harness({ dbFile: file })
    const b = await harness({ dbFile: file })
    await a.approvedCrid('crid-h4', day(0))
    for (const x of [a, b]) {
      x.setNow(cutoffOf(day(1)))
      x.bidder.setScript((req) => ({ body: response(req, [swisseBid(req, { price: 150, crid: 'crid-h4' })]), delayMs: 60 }))
    }
    const before = a.bidder.log.bidRequests.length + b.bidder.log.bidRequests.length
    const results = await Promise.all([tick(a), tick(a), tick(b)])
    const cleared = results.flatMap((r) => r.logs).filter((l) => l.startsWith(`Auction cleared ${day(1).toISOString()}`))
    expect(cleared).toHaveLength(1)
    /* One position, one DSP: one round of bid requests is one request. */
    expect(a.bidder.log.bidRequests.length + b.bidder.log.bidRequests.length - before).toBe(1)
    expect(sold(a, day(1))).toHaveLength(1)
    a.ctx.db.close()
    b.ctx.db.close()
  })

  it('H5 — a claim left unfinished for 15 minutes is taken over; a fresher claim is left alone', async () => {
    const h = await harness()
    h.setNow(cutoffOf(day(0)))
    const claim = (ageMin: number) => prepared(h.ctx.db, "INSERT OR REPLACE INTO auction_runs (window_start, claimed_at, claimed_by, finished_at) VALUES (?, ?, 'other-host:1', NULL)")
      .run(day(0).toISOString(), new Date(cutoffOf(day(0)).getTime() - ageMin * 60_000).toISOString())
    claim(14)
    expect((await tick(h)).logs.filter((l) => l.startsWith('Auction cleared'))).toHaveLength(0)
    expect(claims(h)[0].claimed_by).toBe('other-host:1')
    claim(16)
    expect((await tick(h)).logs.filter((l) => l.startsWith('Auction cleared'))).toHaveLength(1)
    expect(claims(h)[0]).toMatchObject({ claimed_by: expect.not.stringMatching(/^other-host/), finished_at: expect.any(String) })
  })

  it('H6 — cutoff missed by > 1 hour: auctioned late if the window hasn’t started; once started, pending bids are settled lost', async () => {
    const h = await harness()
    const id = await h.readyApiCampaign('Swisse — H6')
    await h.bidder.control({ mode: 'no_bid' })
    expect((await h.partner.bid(id, day(0), 200)).statusCode).toBe(201)
    expect((await h.partner.bid(id, day(1), 200)).statusCode).toBe(201)
    /* 5½ hours past day(0)'s cutoff, before it starts. */
    h.setNow(new Date('2026-09-20T23:30:00.000Z'))
    expect((await tick(h)).logs.some((l) => l.startsWith(`Auction cleared ${day(0).toISOString()}`))).toBe(true)
    expect(sold(h, day(0))).toHaveLength(1)
    /* day(1)'s cutoff and start both missed (process down). */
    h.setNow(new Date('2026-09-22T03:00:00.000Z'))
    const t = await tick(h)
    expect(t.logs.some((l) => l.startsWith(`Auction cleared ${day(1).toISOString()}`))).toBe(false)
    expect(h.rows(day(1)).find((r) => r.channel === 'api')).toMatchObject({ status: 'lost', reason: 'The window started with no auction clearing this bid; nothing was sold.' })
  })

  it('H7 — the playback source throws during billing: the auction due that minute still runs; billing retried next tick; no double line item', async () => {
    const h = await harness()
    const campaignId = await h.approvedCrid('crid-h7', day(0))
    await runAuction(h.ctx, day(1))
    h.playback.script(campaignId, day(1), { plays: 100, playedSec: 86_400 })
    h.playback.fail('playback store down')
    h.setNow(cutoffOf(day(3)))
    const first = await tick(h)
    expect(first.logs).toContain('Billing failed: playback store down')
    expect(first.logs.some((l) => l.startsWith(`Auction cleared ${day(3).toISOString()}`))).toBe(true)
    expect(lineItems(h.ctx)).toEqual([])
    h.playback.fail(null)
    h.setNow(new Date(cutoffOf(day(3)).getTime() + 60_000))
    const second = await tick(h)
    expect(second.error).toBeNull()
    expect(lineItems(h.ctx).map((i) => i.windowStart)).toEqual([day(1).toISOString()])
    await tick(h)
    expect(lineItems(h.ctx)).toHaveLength(1)
  })

  it('H8 — a position removed from the estate after a bid: the bid is settled lost with a reason', async () => {
    const h = await harness()
    const id = await h.readyApiCampaign('Swisse — H8')
    expect((await h.partner.bid(id, day(0), 200)).statusCode).toBe(201)
    h.admin.slot({ owner: 'internal', partnerIds: [], listMode: null })
    h.setNow(cutoffOf(day(0)))
    await tick(h)
    h.setNow(new Date(day(0).getTime() + 60_000))
    await tick(h)
    const r = h.rows(day(0))[0]
    expect(r.status).toBe('lost')
    expect(r.reason).toBeTruthy()
    expect(h.campaigns.handoffs.filter((b) => b.windowStart === day(0).toISOString())).toEqual([])
  })

  it('H9 — DSP disconnected between bid and clearing (failed re-test): the pending bid is rejected "Google DSP is not connected."', async () => {
    const h = await harness()
    const id = await h.readyApiCampaign('Swisse — H9')
    const bid = await h.partner.bid(id, day(0), 200)
    await h.bidder.auth({ accept: false })
    expect((await h.admin.connect()).json().status).toBe('error')
    expect((await runAuction(h.ctx, day(0))).positions[0].winner).toBeNull()
    expect(h.ctx.reservations.get(bid.json().reservationId)).toMatchObject({ status: 'rejected', reason: 'Google DSP is not connected.' })
  })

  /* Regression for backlog 7XWcEXzPCl88KOh78sAa (found by the E2E v2 run, 29 Sep
     2026; fixed on main since). */
  it('H9 — DSP disconnected between bid and clearing (retailer disconnect): the pending bid is rejected "Google DSP is not connected."', async () => {
    const h = await harness()
    const id = await h.readyApiCampaign('Swisse — H9b')
    const bid = await h.partner.bid(id, day(0), 200)
    expect((await h.admin.disconnect()).statusCode).toBe(200)
    expect((await runAuction(h.ctx, day(0))).positions[0].winner).toBeNull()
    expect(h.ctx.reservations.get(bid.json().reservationId)).toMatchObject({ status: 'rejected', reason: 'Google DSP is not connected.' })
  })
})
