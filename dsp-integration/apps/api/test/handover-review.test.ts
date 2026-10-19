/* Pre-handover review (18 Oct 2026): one test per finding the review fixed.
   Each fails on the code before its fix (checked against the commit before
   the review), except the rate limiter's, which pins the answers the fix
   must NOT change. The findings, and what was deliberately left for
   engineering, are in docs/dsp-integration/api/HANDOVER-REVIEW.md. */
import { createServer, type RequestListener, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { loadConfig } from '../src/config'
import { openDb, tx } from '../src/db/db'
import { storedMediaOf } from '../src/domain/media'
import { positionHourGroups } from '../src/domain/operatingGate'
import { isPublicHttpsUrl } from '../src/domain/partnerInput'
import { httpBidder } from '../src/dsp/bidder'
import { fetchOwnedCreative } from '../src/exchange/creatives'
import type { BidRequest } from '../src/exchange/openrtb'
import { buildApp } from '../src/http/app'
import { tokenBucket } from '../src/http/rateLimit'
import type { Context } from '../src/context'
import { expectMatchesContract } from './contract'
import { testContext } from './helpers'
import { multipart, png } from './media'
import { seedsOnStart } from '../src/seed/seed'

const GOOGLE = { authorization: 'Bearer poc-token-google-dv360' }
const PLAYER = { authorization: 'Bearer poc-token-player' }

describe('admin requests are decided on the matched route, not the raw URL', () => {
  it('a percent-encoded admin path gets the same session and scope check', async () => {
    const app = buildApp(await testContext({ role: 'hq_helpdesk' }))
    for (const url of ['/api/admin/v1/display-types', '/api/%61dmin/v1/display-types', '/%61pi/admin/v1/display-types', '/api/admin/v1/%64isplay-types']) {
      const res = await app.inject({ method: 'GET', url })
      expect(res.statusCode, url).toBe(403)
      expect(res.headers['cache-control'], url).toBe('no-store')
    }
    /* The session itself still answers, so the UI can say who is asking. */
    expect((await app.inject({ method: 'GET', url: '/api/admin/v1/session' })).statusCode).toBe(200)
  })

  it('a percent-encoded audited write is recorded in the SSP audit log', async () => {
    const ctx = await testContext()
    const app = buildApp(ctx)
    const exchange = (await app.inject({ method: 'GET', url: '/api/admin/v1/exchange' })).json()
    const res = await app.inject({ method: 'PUT', url: '/api/admin/v1/%65xchange', payload: { ...exchange, organisation: 'Renamed Retail Group' } })
    expect(res.statusCode).toBe(200)
    const log = await ctx.sspAudit.query({ objectType: 'exchange' })
    expect(log.items.some((e) => e.field === 'organisation' && e.newValue === 'Renamed Retail Group')).toBe(true)
  })
})

describe('outbound requests stay where the guard put them', () => {
  const servers: Server[] = []
  afterEach(() => servers.splice(0).forEach((s) => s.close()))
  const serve = async (handler: RequestListener) => {
    const s = createServer(handler)
    servers.push(s)
    await new Promise<void>((r) => s.listen(0, '127.0.0.1', r))
    return `http://127.0.0.1:${(s.address() as AddressInfo).port}`
  }

  it('a bidder that redirects is no bid, and the bid request never reaches the redirect target', async () => {
    let reached = 0
    const target = await serve((_req, res) => { reached++; res.end('{}') })
    const bidder = await serve((_req, res) => { res.writeHead(307, { location: `${target}/internal` }); res.end() })
    const send = httpBidder((url, init) => fetch(url, init), { timeoutMs: 1000, qps: 1000 })
    expect(await send.send(`${bidder}/bid`, { id: 'r1' } as BidRequest)).toBeNull()
    expect(reached).toBe(0)
  })

  it('a bid request whose QPS turn would come after its deadline is not sent at all', async () => {
    let calls = 0
    const send = httpBidder(async () => { calls++; return new Response('{}') }, { timeoutMs: 300, qps: 1 })
    /* qps 1: the first request takes the URL's turn for the next second. */
    await send.send('http://dsp.test/bid', { id: 'a' } as BidRequest)
    expect(await send.send('http://dsp.test/bid', { id: 'b' } as BidRequest, { qps: 1, timeoutMs: 200, deadline: Date.now() + 200 })).toBeNull()
    expect(calls).toBe(1)
  })

  it('a creative fetch follows a redirect only under the DSP’s own creative host', async () => {
    let outside = 0
    const elsewhere = await serve((_req, res) => { outside++; res.end('x') })
    const base = await serve((req, res) => {
      if (req.url === '/creatives/a.png') { res.writeHead(302, { location: '/creatives/b.png' }); res.end() }
      else if (req.url === '/creatives/b.png') res.end('png-bytes')
      else { res.writeHead(302, { location: `${elsewhere}/x` }); res.end() }
    })
    const ctx = { fetch: (url: string, init?: RequestInit) => fetch(url, init) } as unknown as Context
    const owns = (u: string) => u.startsWith(`${base}/creatives/`)
    expect(await (await fetchOwnedCreative(ctx, `${base}/creatives/a.png`, owns)).text()).toBe('png-bytes')
    await expect(fetchOwnedCreative(ctx, `${base}/creatives/c.png`, owns)).rejects.toThrow(/outside/)
    expect(outside).toBe(0)
  })

  it('refuses IPv6 forms that carry a private IPv4 address', () => {
    for (const u of ['https://[64:ff9b::a00:5]/', 'https://[64:ff9b::10.0.0.5]/', 'https://[64:ff9b:1::1]/', 'https://[::ffff:0:a00:5]/', 'https://[::a00:1]/', 'https://[::169.254.169.254]/', 'https://[ff02::1]/', 'https://[2002:a00:1::]/', 'https://[2002:a9fe:a9fe::1]/', 'https://[2001:0:4136:e378:8000:63bf:f5ff:fffe]/']) {
      expect(isPublicHttpsUrl(u), u).toBe(false)
    }
    for (const u of ['https://[64:ff9b::808:808]/', 'https://[2002:808:808::1]/', 'https://[2001:4860:4860::8888]/', 'https://bidder.example.com/openrtb2/bid']) expect(isPublicHttpsUrl(u), u).toBe(true)
  })
})

describe('bounded memory', () => {
  it('the rate limiter answers exactly as before while dropping buckets that have refilled', () => {
    let t = 0
    const limiter = tokenBucket({ perSecond: 1, burst: 2 }, () => t)
    /* Thousands of one-off keys, enough to trigger several sweeps. */
    for (let i = 0; i < 5000; i++) expect(limiter.take(`once-${i}`)).toBe(0)
    expect([limiter.take('k'), limiter.take('k'), limiter.take('k')]).toEqual([0, 0, 1])
    t += 10_000
    for (let i = 0; i < 2000; i++) limiter.take(`later-${i}`)
    /* A swept key starts again from a full bucket, as a key that had refilled would. */
    expect([limiter.take('k'), limiter.take('k'), limiter.take('k')]).toEqual([0, 0, 1])
  })

  it('the Player API refuses a display id longer than any display’s', async () => {
    const app = buildApp(await testContext())
    const res = await app.inject({ method: 'POST', url: '/api/player/v1/impressions', headers: PLAYER, payload: { displayId: 'd'.repeat(201), slot: 2 } })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.details).toEqual([{ field: 'displayId', reason: '200 characters at most.' }])
  })

  it('a stored creative’s media facts are read once, not on every fill', async () => {
    let reads = 0
    const bytes = png(1920, 1080)
    const store = { read: () => { reads++; return bytes } }
    const a = await storedMediaOf(store, 'x.png')
    const b = await storedMediaOf(store, 'x.png')
    expect(a).toEqual({ media: expect.objectContaining({ kind: 'png', width: 1920, height: 1080 }), sizeBytes: bytes.length })
    expect(b).toBe(a)
    expect(reads).toBe(1)
    expect(await storedMediaOf({ read: () => null }, 'missing.png')).toBeNull()
  })
})

describe('the database connection survives a failed COMMIT', () => {
  it('rolls back, reports the error, and the next transaction works', async () => {
    const db = openDb(':memory:')
    db.exec('PRAGMA foreign_keys = ON')
    db.exec('CREATE TABLE p (id INTEGER PRIMARY KEY); CREATE TABLE c (pid INTEGER REFERENCES p(id) DEFERRABLE INITIALLY DEFERRED)')
    /* A deferred foreign key fails at COMMIT, as a full disk would. */
    await expect(tx(db, () => { db.exec('INSERT INTO c VALUES (42)') })).rejects.toThrow(/FOREIGN KEY/)
    await tx(db, () => { db.exec('INSERT INTO p VALUES (1)') })
    expect(db.prepare('SELECT (SELECT COUNT(*) FROM p) AS p, (SELECT COUNT(*) FROM c) AS c').get()).toEqual({ p: 1, c: 0 })
  })
})

describe('a production instance starts empty', () => {
  it('seeds the demo estate only outside production, or when PH_SEED_DEMO=true asks for it', () => {
    expect(seedsOnStart({})).toBe(true)
    expect(seedsOnStart({ NODE_ENV: 'test' })).toBe(true)
    expect(seedsOnStart({ NODE_ENV: 'production' })).toBe(false)
    expect(seedsOnStart({ NODE_ENV: 'production', PH_SEED_DEMO: 'false' })).toBe(false)
    expect(seedsOnStart({ NODE_ENV: 'production', PH_SEED_DEMO: 'true' })).toBe(true)
  })
})

describe('configuration that would switch a limit off', () => {
  it('a rate setting that is not a positive number falls back to the default', () => {
    for (const v of ['fifty', '0', '-5', '', ' ']) {
      expect(loadConfig({ PARTNER_RATE_PER_SECOND: v, PARTNER_RATE_BURST: v }).partnerRateLimit, v).toEqual({ perSecond: 50, burst: 100 })
    }
    expect(loadConfig({ PARTNER_RATE_PER_SECOND: '7', PARTNER_RATE_BURST: '9' }).partnerRateLimit).toEqual({ perSecond: 7, burst: 9 })
  })

  it('PARTNER_TOKENS must be an object of non-empty strings, and the error never echoes a token', () => {
    for (const v of ['"just-a-token"', '["a"]', '{"tok":42}', '{"tok":""}', '{"":"p_google"}']) {
      expect(() => loadConfig({ PARTNER_TOKENS: v }), v).toThrow(/^PARTNER_TOKENS must be a JSON object/)
    }
    expect(loadConfig({ PARTNER_TOKENS: '{"a-real-secret":"p_google"}' }).partnerTokens).toEqual({ 'a-real-secret': 'p_google' })
  })

  it('a PARTNER_TOKENS that is not JSON at all fails with the same message, quoting none of it', () => {
    const secret = 'Zk3q9XbT2mLp8RvW4sYc1NdH'
    for (const v of [secret, `{"${secret}": p_google}`, `{"${secret}":"p_google"`]) {
      let err: Error | undefined
      try { loadConfig({ PARTNER_TOKENS: v }) } catch (e) { err = e as Error }
      expect(err?.message, v).toMatch(/^PARTNER_TOKENS must be a JSON object/)
      expect(`${err?.message}\n${err?.stack}\n${String((err as { cause?: unknown })?.cause ?? '')}`, v).not.toContain(secret.slice(0, 8))
    }
  })

  it('each DSP’s creative host can be set, and stays the mock service’s when unset', () => {
    const c = loadConfig({ DSP_MOCKS_URL: 'http://mocks.test', DV360_CREATIVE_BASE: 'https://dv360.example/creatives/', AMAZON_CREATIVE_BASE: 'https://amzn.example/c/', TTD_CREATIVE_BASE: 'https://ttd.example/c/' })
    expect([c.bidders.google_dv360.creativeBase, c.bidders.amazon_dsp.creativeBase, c.bidders.the_trade_desk.creativeBase]).toEqual(['https://dv360.example/creatives/', 'https://amzn.example/c/', 'https://ttd.example/c/'])
    expect(loadConfig({ DSP_MOCKS_URL: 'http://mocks.test' }).bidders.google_dv360.creativeBase).toBe('http://mocks.test/dv360/creatives/')
  })
})

describe('slow or padded uploads', () => {
  it('a whole request must arrive within 15 minutes', async () => {
    expect(buildApp(await testContext()).server.requestTimeout).toBe(15 * 60_000)
  })

  it('an upload padded with fields is refused, and a normal one is not', async () => {
    const ctx = await testContext()
    const app = buildApp(ctx)
    const id = (await app.inject({ method: 'POST', url: '/api/v1/campaigns', headers: GOOGLE, payload: { advertiserId: 'swisse', name: 'Swisse — Sleep', displayTypeId: 'landscape', default: { pricingType: 'localised' } } })).json().campaignId
    const padding = Object.fromEntries(Array.from({ length: 11 }, (_, i) => [`x${i}`, 'y']))
    const padded = multipart({ ...padding, version: 'default' }, { name: 'a.png', bytes: png(1920, 1080) })
    const refused = await app.inject({ method: 'POST', url: `/api/v1/campaigns/${id}/assets`, headers: { ...GOOGLE, ...padded.headers }, payload: padded.payload })
    expect(refused.statusCode).toBe(413)
    const normal = multipart({ version: 'default' }, { name: 'a.png', bytes: png(1920, 1080) })
    expect((await app.inject({ method: 'POST', url: `/api/v1/campaigns/${id}/assets`, headers: { ...GOOGLE, ...normal.headers }, payload: normal.payload })).statusCode).toBe(201)
  })
})

describe('serving and reading creatives', () => {
  it('GET /assets streams the file with its length, and 404s anything else', async () => {
    const ctx = await testContext()
    const app = buildApp(ctx)
    const bytes = png(640, 360, 4096)
    const file = await ctx.assets.put(bytes, '.png')
    /* Served without reading the whole file into memory. */
    ctx.assets.read = () => { throw new Error('a download must not buffer the whole file') }
    const res = await app.inject({ method: 'GET', url: `/assets/${file}` })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toBe('image/png')
    expect(Number(res.headers['content-length'])).toBe(bytes.length)
    expect(res.rawPayload.equals(bytes)).toBe(true)
    for (const name of ['missing.png', '..%2Fpoc.sqlite', 'a.b.c']) expect((await app.inject({ method: 'GET', url: `/assets/${name}` })).statusCode, name).toBe(404)
  })
})

describe('the operating-hours groups are cached, not re-read per request', () => {
  it('answers from the cache, and a display type saved with a new zone is seen at once', async () => {
    const ctx = await testContext()
    let lists = 0
    const real = ctx.displays.listByDisplayType.bind(ctx.displays)
    ctx.displays.listByDisplayType = (id) => { lists++; return real(id) }
    const dt = (await ctx.displayTypes.get('menu_board'))!
    const first = await positionHourGroups(ctx, { displayType: dt })
    expect(await positionHourGroups(ctx, { displayType: dt })).toBe(first)
    expect(lists).toBe(1)
    const external = await positionHourGroups(ctx, { displayType: { ...dt, phExtensions: { ...dt.phExtensions!, storeZone: 'exterior' } } })
    expect(lists).toBe(2)
    expect(external).toEqual([{ hours: { open: 0, close: 24 }, screens: 3 }])
  })
})

describe('a partner learns nothing about another partner’s advertiser', () => {
  it('a dealId on someone else’s advertiser is refused only as the wrong advertiser', async () => {
    const app = buildApp(await testContext())
    const res = await app.inject({ method: 'POST', url: '/api/v1/campaigns', headers: GOOGLE, payload: { advertiserId: 'loreal', name: 'Probe', displayTypeId: 'landscape', dealId: 'PH-ANYTHING', default: { pricingType: 'localised' } } })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.details.map((d: { field: string }) => d.field)).toEqual(['advertiserId'])
  })
})

describe('the contract describes what the API serves', () => {
  it('adding a direct advertiser is POST /admin/v1/advertisers/direct, as the API and the UI have it', async () => {
    const app = buildApp(await testContext())
    const res = await app.inject({ method: 'POST', url: '/api/admin/v1/advertisers/direct', payload: { name: 'Corner Bakery' } })
    expect(res.statusCode).toBe(201)
    expectMatchesContract('POST', '/admin/v1/advertisers/direct', 201, res.json())
  })

  it('the unsold report matches its contract', async () => {
    const app = buildApp(await testContext())
    for (const by of ['store', 'display', 'display_type', 'hour', 'day']) {
      const res = await app.inject({ method: 'GET', url: `/api/admin/v1/reports/unsold?from=2026-09-20&to=2026-09-21&by=${by}` })
      expect(res.statusCode).toBe(200)
      expectMatchesContract('GET', '/admin/v1/reports/unsold', 200, res.json())
    }
    const bad = await app.inject({ method: 'GET', url: '/api/admin/v1/reports/unsold?from=2026-09-20&to=2026-09-21&by=week' })
    expectMatchesContract('GET', '/admin/v1/reports/unsold', 400, bad.json())
  })
})
