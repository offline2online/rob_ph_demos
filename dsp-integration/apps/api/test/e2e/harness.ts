/* End-to-end harness for "End-to-End Test Spec — Open Auction Floor-Price
   Path (v1)" (board doc f34VQZCy2kkWJfBP6Iwp, Display Types & DSP
   Integration). Everything outside this build is stubbed at the API layer,
   through the same seams PH-CORE-BOUNDARIES.md names and context.ts wires:

     1. DSP bidder        — apps/dsp-mocks, served in-process, plus a
                            per-case script for responses the mock can't
                            produce (malformed, oversized, several bids).
     2. Playback source   — scripted realised play totals per window.
     3. Asset store       — in memory, files named by content hash.
     4. Campaign source   — the PH Core stand-in, wrapped to record every
                            hand-off and refuse a second booking of a slot
                            and window.
     5. Identity          — a static admin session; one bearer token per
                            partner.

   Nothing here reaches the network: a fetch to any host but the in-process
   mocks throws, and the global fetch is replaced for the run. */
import { createHash, randomBytes } from 'node:crypto'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { extname, join } from 'node:path'
import { vi } from 'vitest'
import { staticSession } from '../../src/auth/session'
import { loadConfig } from '../../src/config'
import { type Context, createContext } from '../../src/context'
import { openDb } from '../../src/db/db'
import type { Fetch } from '../../src/dsp/DspClient'
import type { BidRequest } from '../../src/exchange/openrtb'
import { staticFlags } from '../../src/flags/Flags'
import { buildApp } from '../../src/http/app'
import type { AssetStore } from '../../src/platform/AssetStore'
import type { CampaignSource, SlotBooking } from '../../src/platform/CampaignSource'
import type { PlaybackSource, PlayTotals } from '../../src/platform/PlaybackSource'
import { aesGcmSecretsStore } from '../../src/secrets/SecretsStore'
import { SEED_DISPLAY_TYPES, seed } from '../../src/seed/seed'
import { buildMocks } from '../../../dsp-mocks/src/app'
import { png, multipart } from '../media'

const MOCKS = 'http://mocks.test'
/* Stub 5: one token per partner. */
export const TOKENS = { 'e2e-token-google': 'p_google', 'e2e-token-amazon': 'p_amazon', 'e2e-token-ttd': 'p_ttd' }
export const GOOGLE = { authorization: 'Bearer e2e-token-google' }
export const TTD = { authorization: 'Bearer e2e-token-ttd' }
export const AMAZON = { authorization: 'Bearer e2e-token-amazon' }

/* Sunday 20 Sep 2026, 10:00 UTC; play windows are whole UTC days from 21 Sep. */
export const NOW = new Date('2026-09-20T10:00:00.000Z')
/* One secrets key for every harness in a run: two "processes" on one database share it, as real ones share PH_SECRETS_KEY. */
const SECRETS_KEY = randomBytes(32).toString('base64')
export const day = (n: number) => new Date(Date.UTC(2026, 8, 21 + n))

/* The fixture's position: one Digital Signage display type, single zone, one Advertiser slot. */
export const DT = 'e2e_signage'
export const POS = `${DT}.s1`
export const DT_B = 'e2e_signage_b'
export const POS_B = `${DT_B}.s1`
export const ASSUMED_VIEWS = 800
export const SWISSE_SEAT = '884513'
export const TTD_SEAT = 'ttd-seat-1'

/* ---- Stub 1: DSP bidder --------------------------------------------- */
/* delayMs holds the response headers back; bodyDelayMs holds the body back
   after the headers. Both honour the request's abort signal the way a real
   fetch does, so the bidder's timeout is exercised, not bypassed. */
export type Scripted = { status?: number; body?: unknown; raw?: string; delayMs?: number; bodyDelayMs?: number } | 'passthrough'
const abortable = (ms: number, signal?: AbortSignal | null) => new Promise<void>((resolve, reject) => {
  if (signal?.aborted) return reject(signal.reason)
  const t = setTimeout(resolve, ms)
  signal?.addEventListener('abort', () => { clearTimeout(t); reject(signal.reason) }, { once: true })
})
export function stubDspBidder() {
  const mocks = buildMocks()
  const log = { bidRequests: [] as { url: string; body: BidRequest }[], creativeFetches: [] as string[], refused: [] as string[] }
  let script: ((req: BidRequest, url: string) => Scripted) | null = null
  const inject = async (url: string, init?: RequestInit) => {
    const u = new URL(url)
    const res = await mocks.app.inject({
      method: (init?.method ?? 'GET') as 'GET', url: u.pathname + u.search,
      headers: { host: u.host, ...(init?.headers as Record<string, string> | undefined) }, payload: init?.body as string | undefined,
    })
    return new Response(new Uint8Array(res.rawPayload), { status: res.statusCode, headers: { 'content-type': String(res.headers['content-type'] ?? 'application/json') } })
  }
  const fetchImpl: Fetch = async (url, init) => {
    const u = new URL(url)
    if (u.origin !== MOCKS) {
      log.refused.push(url)
      throw new Error(`E2E harness: refused a call outside the stubs (${url}).`)
    }
    if (u.pathname.endsWith('/openrtb2/bid')) {
      const body = JSON.parse(String(init?.body)) as BidRequest
      log.bidRequests.push({ url, body })
      const out = script ? script(body, url) : 'passthrough'
      if (out !== 'passthrough') {
        const text = out.raw ?? (out.body === undefined ? '' : JSON.stringify(out.body))
        if (out.delayMs) await abortable(out.delayMs, init?.signal)
        if (out.bodyDelayMs) {
          const signal = init?.signal
          const stream = new ReadableStream<Uint8Array>({
            async start(c) {
              try {
                await abortable(out.bodyDelayMs!, signal)
                c.enqueue(new TextEncoder().encode(text))
                c.close()
              } catch (e) {
                c.error(e)
              }
            },
          })
          return new Response(stream, { status: out.status ?? 200, headers: { 'content-type': 'application/json' } })
        }
        return new Response(out.status === 204 ? null : text, { status: out.status ?? 200, headers: { 'content-type': 'application/json' } })
      }
    }
    if (u.pathname.includes('/creatives/')) log.creativeFetches.push(url)
    return inject(url, init)
  }
  /* The mock's own control API: seat, advertiser, price and mode. */
  const control = (b: Record<string, unknown>, dsp = 'google_dv360') => mocks.app.inject({ method: 'PUT', url: `/_control/${dsp}/bidder`, payload: b })
  /* Stub 2 (DSP management API): the mock's auth outcome for connect / re-test. */
  const auth = (b: Record<string, unknown>, dsp = 'google_dv360') => mocks.app.inject({ method: 'PUT', url: `/_control/${dsp}/auth`, payload: b })
  return { mocks, fetchImpl, log, control, auth, setScript: (s: typeof script) => (script = s) }
}

/* A well-formed OpenRTB 2.6 bid from Swisse's seat, for a scripted response. */
export function swisseBid(req: BidRequest, b: { price: unknown; crid: string; iurl?: string; id?: string }) {
  const imp = req.imp?.[0] as { banner?: { w?: number; h?: number } } | undefined
  const w = imp?.banner?.w ?? 1920
  const h = imp?.banner?.h ?? 1080
  return {
    id: b.id ?? `${req.id}-${b.crid}`, impid: '1', price: b.price, crid: b.crid, adomain: ['swisse.com'], cat: ['IAB7'],
    iurl: b.iurl ?? `${MOCKS}/dv360/creatives/${encodeURIComponent(b.crid)}.png?w=${w}&h=${h}`, w, h,
  }
}
export const response = (req: BidRequest, bids: unknown[], seat = SWISSE_SEAT) => ({ id: req.id, cur: 'AUD', seatbid: [{ seat, bid: bids }] })
/* A well-formed bid from Arnott's on The Trade Desk's seat. */
export function arnottsBid(req: BidRequest, b: { price: unknown; crid: string }) {
  return { ...swisseBid(req, b), adomain: ['arnotts.com'], cat: ['IAB8'], iurl: `${MOCKS}/ttd/creatives/${encodeURIComponent(b.crid)}.png?w=1920&h=1080` }
}

/* ---- Stub 2: playback source ----------------------------------------- */
export function stubPlayback() {
  const scripted = new Map<string, PlayTotals>()
  const calls: { campaignId: string; displayTypeId: string; from: string; to: string }[] = []
  let down: string | null = null
  const source: PlaybackSource = {
    listPlays: () => [],
    totals(q) {
      calls.push(q)
      if (down) throw new Error(down)
      return scripted.get(`${q.campaignId}|${q.from}`) ?? { plays: 0, playedSec: 0 }
    },
  }
  return {
    source, calls,
    script: (campaignId: string, windowStart: Date, t: PlayTotals) => scripted.set(`${campaignId}|${windowStart.toISOString()}`, t),
    /* The playback store down (a message) or back (null). */
    fail: (message: string | null) => (down = message),
  }
}

/* ---- Stub 3: asset store --------------------------------------------- */
export function stubAssetStore() {
  const files = new Map<string, Buffer>()
  const reads: string[] = []
  const store: AssetStore = {
    put(bytes, ext) {
      const file = `${createHash('sha256').update(bytes).digest('hex').slice(0, 32)}${ext.startsWith('.') ? ext : `.${ext}`}`.toLowerCase()
      files.set(file, Buffer.from(bytes))
      return file
    },
    read(file) {
      reads.push(file)
      return files.get(file) ?? null
    },
    url: (file) => `/assets/${file}`,
  }
  return { store, files, reads, hashOf: (file: string) => file.slice(0, file.length - extname(file).length) }
}

/* ---- Stub 4: campaign source (PH Core) -------------------------------- */
export function stubCampaignSource(inner: CampaignSource) {
  const handoffs: SlotBooking[] = []
  const refusedBookings: SlotBooking[] = []
  const held = new Set<string>()
  const source: CampaignSource = {
    ...inner,
    bookSlot(b) {
      const key = `${b.displayTypeId}|${b.slot}|${b.windowStart}`
      /* The contract: at most one booking per slot and window. Same error shape as the database's. */
      if (held.has(key)) {
        refusedBookings.push(b)
        throw new Error('UNIQUE constraint failed: PH Core stub — one booking per slot and window')
      }
      const out = inner.bookSlot(b)
      held.add(key)
      handoffs.push(b)
      return out
    },
  }
  return { source, handoffs, refusedBookings }
}

/* ---- The whole harness ------------------------------------------------ */
/* dbFile: a shared database file, so two harnesses stand in for two API
   processes on one database (the second finds it seeded). */
export async function harness(opts: { dbFile?: string } = {}) {
  vi.stubGlobal('fetch', async (url: unknown) => {
    throw new Error(`E2E harness: global fetch is disabled (${String(url)}).`)
  })
  let now = NOW
  const clock = () => now
  const bidder = stubDspBidder()
  const playback = stubPlayback()
  const assets = stubAssetStore()
  const ctx: Context = createContext({
    config: { ...loadConfig({ DSP_MOCKS_URL: MOCKS }), dbFile: opts.dbFile ?? ':memory:', assetsDir: mkdtempSync(join(tmpdir(), 'ph-e2e-')), partnerTokens: TOKENS },
    db: openDb(opts.dbFile ?? ':memory:'),
    flags: staticFlags(true),
    session: staticSession('hq_admin'),
    secrets: aesGcmSecretsStore(SECRETS_KEY),
    dspFetch: bidder.fetchImpl,
    clock,
  })
  ctx.assets = assets.store
  ctx.playback = playback.source
  const campaigns = stubCampaignSource(ctx.campaigns)
  ctx.campaigns = campaigns.source
  await seed(ctx, { bookings: false, demo: false })
  fixture(ctx)
  /* Swisse (approval required, floor multiplier 1.0) is the bidder. */
  await bidder.control({ mode: 'bid', priceCpm: 150, advertiserId: '5130002' })
  const app = buildApp(ctx)
  const h0 = { exchange: () => { const { enabled: _e, ...rest } = ctx.exchange.get(); return rest } }

  const admin = {
    approve: (id: string, assetVersion = 'v1') => app.inject({ method: 'POST', url: `/api/admin/v1/campaigns/${id}/approve`, payload: { assetVersion } }),
    activate: (id: string, enabled = true) => app.inject({ method: 'PUT', url: `/api/admin/v1/campaigns/${id}/activation`, payload: { enabled } }),
    supportTargeting: (supportedTargeting: string[], displayTypeId = DT) =>
      app.inject({ method: 'PUT', url: '/api/admin/v1/available-inventory', payload: { items: [{ displayTypeId, slot: 1, supportedTargeting }] } }),
    disconnect: (id = 'p_google') => app.inject({ method: 'POST', url: `/api/admin/v1/partners/${id}/disconnect` }),
    connect: (id = 'p_google') => app.inject({ method: 'POST', url: `/api/admin/v1/partners/${id}/connect` }),
    reject: (id: string, reason: string, assetReasons?: { assetId: string; reason: string }[], assetVersion = 'v1') =>
      app.inject({ method: 'POST', url: `/api/admin/v1/campaigns/${id}/reject`, payload: { assetVersion, reason, ...(assetReasons ? { assetReasons } : {}) } }),
    unreject: (id: string, assetVersion = 'v1') => app.inject({ method: 'POST', url: `/api/admin/v1/campaigns/${id}/unreject`, payload: { assetVersion } }),
    exchange: (enabled: boolean) => app.inject({ method: 'PUT', url: '/api/admin/v1/exchange', payload: { ...h0.exchange(), enabled } }),
    slot: (patch: Record<string, unknown>, displayTypeId = DT) => {
      const ext = ctx.displayTypes.get(displayTypeId)!.phExtensions!
      ctx.displayTypes.saveExtensions(displayTypeId, { ...ext, slots: ext.slots.map((s, i) => (i === 0 ? { ...s, ...patch } : s)) } as never)
    },
  }
  const partner = {
    create: (body: Record<string, unknown>, headers = GOOGLE) => app.inject({ method: 'POST', url: '/api/v1/campaigns', headers, payload: body }),
    upload: (id: string, version: string, bytes: Buffer, headers = GOOGLE, name = 'creative.png') => {
      const m = multipart({ version }, { name, bytes })
      return app.inject({ method: 'POST', url: `/api/v1/campaigns/${id}/assets`, headers: { ...headers, ...m.headers }, payload: m.payload })
    },
    submit: (id: string, headers = GOOGLE) => app.inject({ method: 'POST', url: `/api/v1/campaigns/${id}/submit`, headers }),
    status: (id: string, headers = GOOGLE) => app.inject({ method: 'GET', url: `/api/v1/campaigns/${id}/status`, headers }),
    reserve: (body: Record<string, unknown>, headers = GOOGLE) => app.inject({ method: 'POST', url: '/api/v1/reservations', headers, payload: body }),
    bid: (campaignId: string, w: Date, bidCpm: number, extra: Record<string, unknown> = {}, headers = GOOGLE) =>
      app.inject({ method: 'POST', url: '/api/v1/reservations', headers, payload: { positionId: POS, windowStart: w.toISOString(), campaignId, advertiserId: 'swisse', type: 'bid', bidCpm, ...extra } }),
  }

  /* A Swisse campaign through the Partner API, fitting the fixture's canvas: create → upload default → submit. */
  const submitApiCampaign = async (name: string, pricingType = 'localised', advertiserId = 'swisse', headers = GOOGLE) => {
    const created = await partner.create({ advertiserId, name, displayTypeId: DT, default: { pricingType } }, headers)
    const id = created.json().campaignId as string
    await partner.upload(id, 'default', png(1920, 1080), headers)
    const submitted = await partner.submit(id, headers)
    return { id, created, submitted }
  }
  /* Submitted, approved and activated: ready to bid through the API. */
  const readyApiCampaign = async (name: string, pricingType = 'localised', advertiserId = 'swisse', headers = GOOGLE) => {
    const { id } = await submitApiCampaign(name, pricingType, advertiserId, headers)
    if ((await ctx.approvals.view(id)).status !== 'approved') await admin.approve(id)
    await admin.activate(id)
    return id
  }
  /* The second DSP: The Trade Desk, connected and Live, Arnott's on its
     seat, allowed to bid on the fixture's slot(s). */
  const addSecondDsp = () => {
    if (!ctx.partners.get('p_ttd')) {
      ctx.partners.insert({
        id: 'p_ttd', provider: 'the_trade_desk', name: 'The Trade Desk', status: 'connected', mode: 'live', lastSync: null,
        credsPublic: { supplySourceId: 'ss-e2e', ttdPartnerId: 'phub-retail', region: 'APAC' }, secrets: { apiToken: 'e2e-placeholder' },
        bidder: { bidderEndpoint: 'https://bid.adsrvr.org/openrtb2/bid', seatIds: [TTD_SEAT] },
        seats: [{ id: 'ttd-adv-1', name: 'Arnott’s', domain: 'arnotts.com' }], listsLinked: true, allowList: [], blockList: [], categoryAllowList: [], categoryBlockList: [],
      } as never)
    }
    for (const dt of [DT, DT_B]) {
      const t = ctx.displayTypes.get(dt)
      if (t) ctx.displayTypes.saveExtensions(dt, { ...t.phExtensions!, slots: t.phExtensions!.slots.map((s) => ({ ...s, partnerIds: [...new Set([...(s.partnerIds ?? []), 'p_ttd'])] })) } as never)
    }
  }
  /* Anchor sequence, DSP side: the creative arrives on a bid, is queued, then approved and activated. */
  const approvedCrid = async (crid: string, queueWindow: Date, partnerId = 'p_google') => {
    const { runAuction } = await import('../../src/exchange/auction')
    if (partnerId === 'p_google') await bidder.control({ mode: 'bid', priceCpm: 150, advertiserId: '5130002', crid })
    else await bidder.control({ mode: 'bid', priceCpm: 150, crid }, 'the_trade_desk')
    await runAuction(ctx, queueWindow)
    const id = queuedCampaign(crid, partnerId)
    if (!id) throw new Error(`E2E harness: creative ${crid} was not queued.`)
    await admin.approve(id)
    await admin.activate(id)
    return id
  }
  const queuedCampaign = (crid: string, partnerId = 'p_google') =>
    (ctx.db.prepare('SELECT campaign_id FROM dsp_creatives WHERE partner_id = ? AND crid = ?').get(partnerId, crid) as { campaign_id: string } | undefined)?.campaign_id ?? null
  const rows = (w: Date, positionId = POS) => ctx.reservations.forWindow(positionId, w.toISOString())

  return {
    ctx, app, bidder, playback, assets, campaigns, admin, partner, submitApiCampaign, readyApiCampaign, approvedCrid, queuedCampaign, rows, addSecondDsp,
    setNow: (d: Date) => (now = d),
  }
}
export type Harness = Awaited<ReturnType<typeof harness>>

/* Preconditions / fixtures (spec): exchange complete and on, one Live DSP
   with endpoint and seat, one single-zone Digital Signage display type with
   one Advertiser slot on physical displays, floor CPM 100 AUD, and the
   slot's targeting left at its default (localised). The seeded Menu Board's
   Advertiser slot is taken out so the fixture's position is the estate's
   only one. */
export function fixture(ctx: Context, opts: { second?: boolean } = {}) {
  const addSignage = (id: string, name: string) => {
    ctx.playlists.create({ id: `pl_${id}`, name: `${name} Playlist`, autoCreatedFor: id, items: [{ id: `pi_${id}`, campaignId: 'c_notice', priority: 1, playbackDuration: 30, campaignType: ['LOCALISED', 'ON_ROTATION'], enabled: true }] })
    const base = SEED_DISPLAY_TYPES[0]
    ctx.displayTypes.create({
      ...base, id, name, touchPoint: 'Digital Signage', displayCanvasSize: { width: 1920, height: 1080 }, defaultPlaylistId: `pl_${id}`,
      playlistSettings: { ...base.playlistSettings, maximumCampaignsPlayedInRotation: 1 },
      multiZone: { enabled: false, zones: [] },
      phExtensions: {
        slots: [{ label: 'Advertiser slot', owner: 'advertiser', partnerIds: ['p_google'], advertisers: [], listMode: 'rtb', storeScope: null, quota: null }],
        venue: { openOohVenueType: 'retail.grocery', orientation: 'landscape' as const, loopLengthSec: 30 },
      },
    } as never)
    const ins = ctx.db.prepare('INSERT INTO displays (id, name, store, store_id, display_type_id) VALUES (?, ?, ?, ?, ?)')
    ins.run(`d_${id}_1`, `${name} 1`, 'Sydney CBD', 'st_sydney_cbd', id)
    ins.run(`d_${id}_2`, `${name} 2`, 'Chatswood', 'st_chatswood', id)
    ctx.db.prepare('INSERT INTO audience_vacd (display_type_id, slot, assumed_views_per_window, counted) VALUES (?, ?, ?, ?)').run(id, 1, ASSUMED_VIEWS, 1)
  }
  if (!ctx.displayTypes.get(DT)) {
    const mb = ctx.displayTypes.get('menu_board')!.phExtensions!
    ctx.displayTypes.saveExtensions('menu_board', { ...mb, slots: mb.slots.map((s) => (s.owner === 'advertiser' ? { ...s, owner: 'internal', partnerIds: [], listMode: null } : s)) })
    addSignage(DT, 'E2E Signage')
  }
  if (opts.second && !ctx.displayTypes.get(DT_B)) addSignage(DT_B, 'E2E Signage B')
}
