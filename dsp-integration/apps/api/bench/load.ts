/* npm run bench -w @ph-dsp/api [-- --scale=250 --displays-per-type=25 --slots=4 --stores=0
                                    --seconds=5 --concurrency=32 --bidder-ms=80
                                    --plays-per-display=0 --history=0]

   Load benchmark for the Partner API's hot paths, the SSP auction and
   billing. Not a test: it prints numbers so a reviewer can see what the
   build does under load, and so a regression shows up as a number rather
   than a feeling. Nothing here is part of the product.

   What it does:
   1. Builds a context exactly as `npm run dev:api` does, but over a
      throwaway FILE database (so SQLite's journal mode and locking are the
      real ones, not :memory:'s) and with the DSP clients / bidders routed
      into the in-process mock DSP service — no network, no real DSP.
   2. Seeds the demo estate, then (with --scale=N) adds N synthetic display
      types, each with --slots advertiser slots and --displays-per-type
      displays, spread over --stores synthetic stores (or the seeded ones
      when 0). The shape matters as much as the size: 15,000 displays is
      600 types × 25 displays (2,400 positions) for a retailer with many
      formats, or 15 types × 1,000 displays (60 positions) for a chain with
      a few formats in every store — the review of 24 Sep 2026 runs both.
   3. Starts the real Fastify server on a random port and drives it with
      `--concurrency` parallel HTTP clients for `--seconds` per endpoint,
      reporting req/s and p50 / p95 / p99 latency. The writes are real too:
      POST /v1/reservations places a distinct bid (advertiser × position ×
      window) on every request, the way tier-2 advertisers bid.
   4. Times one full auction (every position, every connected DSP) for the
      next sellable window; --bidder-ms=N adds N ms to every bid round trip.
   5. With --plays-per-display=N, books one ended window on a position and
      gives every display of its type N plays in that window (a 46 s loop
      plays a slot about 1,900 times a day), then times billing it. With
      --history=N, N already-billed windows are in the database first, as
      they would be after months of operation, and an idle billing tick is
      timed too.

   Numbers are machine-dependent; compare runs on the same machine. */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomBytes, randomUUID } from 'node:crypto'
import { performance } from 'node:perf_hooks'
import { advertiserSlug } from '@ph-dsp/types'
import { staticSession } from '../src/auth/session'
import { loadConfig } from '../src/config'
import { createContext } from '../src/context'
import { openDb } from '../src/db/db'
import { staticFlags } from '../src/flags/Flags'
import { aesGcmSecretsStore } from '../src/secrets/SecretsStore'
import { seed } from '../src/seed/seed'
import { campaignFor } from '../src/seed/bookings'
import { buildApp } from '../src/http/app'
import { runAuction } from '../src/exchange/auction'
import { runBilling } from '../src/exchange/billing'
import { allPositions, biddingOpensAt, nextWindow, windowMs, windowStartOf } from '../src/domain/positions'
import { mockDsps } from '../test/helpers'

const arg = (name: string, dflt: number) => Number(process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1] ?? dflt)
const SCALE = arg('scale', 0)
const DISPLAYS_PER_TYPE = arg('displays-per-type', 25)
const SLOTS = arg('slots', 4)
const STORES = arg('stores', 0)
const SECONDS = arg('seconds', 4)
const CONCURRENCY = arg('concurrency', 32)
/* Simulated round trip to each DSP's bidder, in ms. The mock DSPs answer
   in-process instantly, which would hide how the auction fans out; a real
   bidder takes tens to hundreds of ms (the timeout is 300). */
const BIDDER_MS = arg('bidder-ms', 0)
const PLAYS_PER_DISPLAY = arg('plays-per-display', 0)
const HISTORY = arg('history', 0)

const dir = mkdtempSync(join(tmpdir(), 'ph-bench-'))
const mocks = mockDsps()
const ctx = createContext({
  /* The per-partner rate limit (50/s by default) is lifted here so the
     numbers measure the server's capacity, not the limiter; the limiter
     itself is covered by test/partner-api-hardening.test.ts. */
  config: { ...loadConfig({ DSP_MOCKS_URL: 'http://mocks.test' }), dbFile: join(dir, 'bench.sqlite'), assetsDir: join(dir, 'assets'), partnerRateLimit: { perSecond: 1e9, burst: 1e9 } },
  db: openDb(join(dir, 'bench.sqlite')),
  flags: staticFlags(true),
  session: staticSession('hq_admin'),
  secrets: aesGcmSecretsStore(randomBytes(32).toString('base64')),
  dspFetch: async (url, init) => {
    if (BIDDER_MS && url.includes('/openrtb2/bid')) await new Promise((r) => setTimeout(r, BIDDER_MS))
    return mocks.fetchImpl(url, init)
  },
})
await seed(ctx, { bookings: true, demo: true })

/* ---- synthetic estate: N more display types, SLOTS advertiser slots each ---- */
if (SCALE > 0) {
  const base = ctx.displayTypes.get('landscape')!
  const insStore = ctx.db.prepare('INSERT INTO stores (id, name, region) VALUES (?, ?, ?)')
  const insDisplay = ctx.db.prepare('INSERT INTO displays (id, name, store, store_id, display_type_id) VALUES (?, ?, ?, ?, ?)')
  const insVacd = ctx.db.prepare('INSERT INTO audience_vacd (display_type_id, slot, assumed_views_per_window, counted) VALUES (?, ?, ?, 0)')
  const advSlot = (label: string) => ({ label, owner: 'advertiser', partnerIds: [], advertisers: [], listMode: null, storeScope: null, quota: null })
  ctx.db.exec('BEGIN')
  for (let s = 0; s < STORES; s++) insStore.run(`bench_st_${s}`, `Bench store ${s}`, `Region ${s % 8}`)
  const stores = ctx.stores.list()
  for (let i = 0; i < SCALE; i++) {
    const id = `bench_dt_${i}`
    ctx.displayTypes.create({
      ...base, id, name: `Bench ${i}`, defaultPlaylistId: base.defaultPlaylistId,
      phExtensions: { ...base.phExtensions, slots: Array.from({ length: SLOTS }, (_, s) => advSlot(`A${s + 1}`)) },
    } as typeof base)
    for (let d = 0; d < DISPLAYS_PER_TYPE; d++) {
      const s = stores[(i * DISPLAYS_PER_TYPE + d) % stores.length]
      insDisplay.run(`${id}_d${d}`, `Bench ${i} / ${d}`, s.name, s.id, id)
    }
    for (let s = 1; s <= SLOTS; s++) insVacd.run(id, s, 400 + s)
  }
  ctx.db.exec('COMMIT')
}

/* ---- history: windows billed long ago, as a database has after months ---- */
if (HISTORY > 0) {
  const first = allPositions(ctx)[0]
  const len = windowMs(ctx)
  const insRes = ctx.db.prepare(
    `INSERT INTO reservations (id, partner_id, advertiser_id, campaign_id, position_id, window_start, type, channel, bid_cpm, currency, status, clearing_cpm, reason, test_mode, pricing_type, handed_off_at, created_at, updated_at)
     VALUES (?, 'p_google', 'nestle', 'c_seed_nestle', ?, ?, 'bid', 'openrtb', 150, 'AUD', 'won', 150, NULL, 0, 'localised', ?, ?, ?)`,
  )
  const insBill = ctx.db.prepare(
    `INSERT INTO billing_line_items (id, reservation_id, partner_id, advertiser_id, campaign_id, position_id, window_start, window_end, plays, played_sec, expected_sec, assumed_views, realised_views, cpm, currency, amount, computed_at)
     VALUES (?, ?, 'p_google', 'nestle', 'c_seed_nestle', ?, ?, ?, 100, 1000, 1000, 400, 400, 150, 'AUD', 60, ?)`,
  )
  const t = new Date().toISOString()
  const positions = allPositions(ctx)
  const current = windowStartOf(ctx, new Date()).getTime()
  ctx.db.exec('BEGIN')
  for (let i = 0; i < HISTORY; i++) {
    /* Spread over the positions and back over past windows, starting years
       before anything the demo estate books: unique per (position, window). */
    const p = positions[i % positions.length]
    const start = new Date(current - (Math.floor(i / positions.length) + 2000) * len).toISOString()
    const id = `res_hist_${i}`
    insRes.run(id, p.positionId, start, t, t, t)
    insBill.run(`bl_hist_${i}`, id, p.positionId, start, new Date(Date.parse(start) + len).toISOString(), t)
  }
  ctx.db.exec('COMMIT')
}

const app = buildApp(ctx)
await app.listen({ port: 0, host: '127.0.0.1' })
const addr = app.server.address()
const BASE = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}/api`
const AUTH = { authorization: 'Bearer poc-token-google-dv360' }

/* ---------------------------------------------------------------- driver */
const pct = (xs: number[], p: number) => xs[Math.min(xs.length - 1, Math.floor((p / 100) * xs.length))]
/* `ok` says which statuses count as success; anything else is an error. A
   driver may return null to say it has nothing more to send. */
async function drive(label: string, req: () => Promise<Response | null>, ok: (status: number) => boolean = (s) => s < 400) {
  const lat: number[] = []
  let errors = 0
  /* The first few unexpected answers, so an error count is never a mystery. */
  const samples: string[] = []
  const until = performance.now() + SECONDS * 1000
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (performance.now() < until) {
      const t = performance.now()
      const r = await req()
      if (!r) return
      const body = await r.text()
      lat.push(performance.now() - t)
      if (!ok(r.status)) {
        errors++
        if (samples.length < 3) samples.push(`${r.status} ${body.slice(0, 160)}`)
      }
    }
  }))
  lat.sort((a, b) => a - b)
  console.log(
    `${label.padEnd(46)} ${String(Math.round(lat.length / SECONDS)).padStart(6)} req/s   p50 ${pct(lat, 50).toFixed(1).padStart(6)} ms   p95 ${pct(lat, 95).toFixed(1).padStart(6)} ms   p99 ${pct(lat, 99).toFixed(1).padStart(6)} ms   errors ${errors}`,
  )
  for (const s of samples) console.log(`${''.padEnd(46)}   e.g. ${s}`)
}

/* Every position the benchmark partner may buy, page by page. */
async function visiblePositions() {
  const ids: string[] = []
  let cursor: string | null = null
  do {
    const page = (await (await fetch(`${BASE}/v1/inventory?limit=200${cursor ? `&cursor=${cursor}` : ''}`, { headers: AUTH })).json()) as { items: { positionId: string }[]; nextCursor: string | null }
    ids.push(...page.items.map((i) => i.positionId))
    cursor = page.nextCursor
  } while (cursor)
  return ids
}

const visible = await visiblePositions()
const pos = visible[0]
if (!pos) throw new Error('No visible position for the benchmark partner — the seed changed.')
const w = nextWindow(ctx).toISOString().slice(0, 10)
const yearOut = new Date(Date.parse(w) + 364 * 86_400_000).toISOString().slice(0, 10)
const types = ctx.displayTypes.list().length
const displays = ctx.displays.list().length
console.log(`\nEstate: ${types} display types, ${allPositions(ctx).length} advertiser positions (${visible.length} visible to the partner), ${displays} displays, ${ctx.stores.list().length} stores · concurrency ${CONCURRENCY} · ${SECONDS}s per endpoint\n`)

await drive('GET  /v1/inventory (page of 50)', () => fetch(`${BASE}/v1/inventory`, { headers: AUTH }))
await drive('GET  /v1/inventory?status=available (1 yr)', () => fetch(`${BASE}/v1/inventory?status=available&from=${w}&to=${yearOut}`, { headers: AUTH }))
await drive('GET  /v1/inventory/{id}', () => fetch(`${BASE}/v1/inventory/${pos}`, { headers: AUTH }))
await drive('GET  /v1/inventory/{id}/availability (7 d)', () => fetch(`${BASE}/v1/inventory/${pos}/availability?from=${w}&to=${new Date(Date.parse(w) + 6 * 86_400_000).toISOString().slice(0, 10)}`, { headers: AUTH }))
await drive('GET  /v1/inventory/{id}/availability (1 yr)', () => fetch(`${BASE}/v1/inventory/${pos}/availability?from=${w}&to=${yearOut}`, { headers: AUTH }))
await drive('POST /v1/inventory/forecast (30 d)', () =>
  fetch(`${BASE}/v1/inventory/forecast`, {
    method: 'POST', headers: { ...AUTH, 'content-type': 'application/json' },
    body: JSON.stringify({ positionIds: [pos], from: w, to: new Date(Date.parse(w) + 29 * 86_400_000).toISOString().slice(0, 10) }),
  }))
await drive('GET  /v1/targeting/attributes', () => fetch(`${BASE}/v1/targeting/attributes`, { headers: AUTH }))
await drive('GET  /v1/inventory (bad token → 401)', () => fetch(`${BASE}/v1/inventory`, { headers: { authorization: 'Bearer nope' } }).then((r) => new Response(null, { status: r.status === 401 ? 200 : 500 })))

/* ---- advertisers bidding: one distinct (advertiser, position, window) per request ---- */
{
  const google = ctx.partners.get('p_google')!
  const seats = google.seats.map((s) => advertiserSlug(s.name)).filter((id) => ctx.campaigns.getCampaign(`c_seed_${id}`))
  const windows: string[] = []
  for (let win = nextWindow(ctx); Date.now() >= biddingOpensAt(ctx, win).getTime(); win = new Date(win.getTime() + windowMs(ctx))) windows.push(win.toISOString())
  const total = seats.length * visible.length * windows.length
  let next = 0
  let placed = 0
  let notOpen = 0
  const bid = (i: number) => ({
    positionId: visible[Math.floor(i / windows.length) % visible.length], windowStart: windows[i % windows.length],
    advertiserId: seats[Math.floor(i / (windows.length * visible.length)) % seats.length], campaignId: `c_seed_${seats[Math.floor(i / (windows.length * visible.length)) % seats.length]}`,
    type: 'bid', bidCpm: 200,
  })
  await drive(`POST /v1/reservations (bid; ${seats.length} advertisers × ${windows.length} windows)`, async () => {
    const i = next++
    if (i >= total) return null
    const r = await fetch(`${BASE}/v1/reservations`, { method: 'POST', headers: { ...AUTH, 'content-type': 'application/json' }, body: JSON.stringify(bid(i)) })
    /* The demo estate holds some positions for one advertiser, keeps one
       whitelist-only and has sold some windows: a bid another advertiser
       places there is refused (400 Unknown position, 409, 422
       not_on_whitelist). Expected, and counted apart; on the synthetic
       positions every bid is open. */
    if (r.status === 201) placed++
    else if (r.status === 400 || r.status === 409 || r.status === 422) notOpen++
    return r
  }, (s) => s === 201 || s === 400 || s === 409 || s === 422)
  console.log(`${''.padEnd(46)} ${String(Math.min(next, total)).padStart(6)} bids sent: ${placed} placed${notOpen ? `, ${notOpen} refused as expected (position not open to that advertiser, or window already sold)` : ''}`)
}

/* ---------------------------------------------------------------- auction */
{
  const t0 = performance.now()
  const result = await runAuction(ctx)
  const ms = performance.now() - t0
  const bids = result.positions.reduce((n, p) => n + p.bids, 0)
  console.log(`\nAuction (bidder round trip ${BIDDER_MS} ms): ${result.positions.length} positions cleared for ${result.windowStart.slice(0, 10)} in ${ms.toFixed(0)} ms (${(ms / Math.max(1, result.positions.length)).toFixed(2)} ms/position; ${result.positions.reduce((n, p) => n + p.bidRequests, 0)} bid requests, ${bids} bids)`)
}

/* ---------------------------------------------------------------- billing */
if (HISTORY > 0) {
  const t0 = performance.now()
  const items = runBilling(ctx)
  console.log(`Billing tick with ${HISTORY} windows already billed and nothing new: ${(performance.now() - t0).toFixed(0)} ms (${items.length} line items)`)
}
if (PLAYS_PER_DISPLAY > 0) {
  /* One ended window, won by Nestlé's campaign, on the most populous display type. */
  const p = allPositions(ctx).reduce((best, x) => (ctx.displays.listByDisplayType(x.displayType.id).length > ctx.displays.listByDisplayType(best.displayType.id).length ? x : best))
  const dt = p.displayType
  const campaignId = await campaignFor(ctx, { advertiserId: 'nestle', name: 'Nestlé', partnerId: 'p_google', displayTypeId: dt.id }, '#1b5e20', dt.displayCanvasSize.width, dt.displayCanvasSize.height)
  const len = windowMs(ctx)
  const start = new Date(windowStartOf(ctx, new Date()).getTime() - len)
  const t = new Date().toISOString()
  ctx.reservations.insert({
    id: `res_bench_billing`, partnerId: 'p_google', advertiserId: 'nestle', campaignId, positionId: p.positionId, windowStart: start.toISOString(),
    type: 'bid', channel: 'openrtb', bidCpm: 150, currency: 'AUD', status: 'won', clearingCpm: 150, reason: null, testMode: false, pricingType: 'localised', handedOffAt: t,
  })
  const insPlay = ctx.db.prepare('INSERT INTO plays (id, display_id, campaign_id, played_at, duration_sec) VALUES (?, ?, ?, ?, ?)')
  const ids = ctx.displays.listByDisplayType(dt.id).map((d) => d.id)
  const t1 = performance.now()
  ctx.db.exec('BEGIN')
  for (const d of ids) {
    for (let k = 0; k < PLAYS_PER_DISPLAY; k++) insPlay.run(randomUUID(), d, campaignId, new Date(start.getTime() + Math.floor((k / PLAYS_PER_DISPLAY) * len)).toISOString(), 10)
  }
  ctx.db.exec('COMMIT')
  const inserted = ids.length * PLAYS_PER_DISPLAY
  console.log(`Inserted ${inserted} plays (${ids.length} displays × ${PLAYS_PER_DISPLAY}) in ${(performance.now() - t1).toFixed(0)} ms`)
  const t2 = performance.now()
  const items = runBilling(ctx)
  const mine = items.find((i) => i.reservationId === 'res_bench_billing')
  console.log(`Billing one window of ${inserted} plays: ${(performance.now() - t2).toFixed(0)} ms (${mine ? `${mine.plays} plays counted, ${mine.realisedViews} realised views, ${mine.amount} ${mine.currency}` : 'NOT billed'})`)
}
console.log()

await app.close()
ctx.db.close()
rmSync(dir, { recursive: true, force: true })
