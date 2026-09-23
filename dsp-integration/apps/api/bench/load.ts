/* npm run bench -w @ph-dsp/api [-- --scale=250 --seconds=5 --concurrency=32 --bidder-ms=80]

   Load benchmark for the Partner API's read hot paths and the SSP auction.
   Not a test: it prints numbers so a reviewer can see what the build does
   under load, and so a regression shows up as a number rather than a
   feeling. Nothing here is part of the product.

   What it does:
   1. Builds a context exactly as `npm run dev:api` does, but over a
      throwaway FILE database (so SQLite's journal mode and locking are the
      real ones, not :memory:'s) and with the DSP clients / bidders routed
      into the in-process mock DSP service — no network, no real DSP.
   2. Seeds the demo estate, then (with --scale=N) adds N synthetic
      display types, each with four advertiser slots and 25 displays across
      the store estate, to model a large retailer rather than the demo's 7
      positions.
   3. Starts the real Fastify server on a random port and drives it with
      `--concurrency` parallel HTTP clients for `--seconds` per endpoint,
      reporting req/s and p50 / p95 / p99 latency.
   4. Times one full auction (every position, every connected DSP) for the
      next sellable window; --bidder-ms=N adds N ms to every bid round trip.

   Numbers are machine-dependent; compare runs on the same machine. */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { performance } from 'node:perf_hooks'
import { staticSession } from '../src/auth/session'
import { loadConfig } from '../src/config'
import { createContext } from '../src/context'
import { openDb } from '../src/db/db'
import { staticFlags } from '../src/flags/Flags'
import { aesGcmSecretsStore } from '../src/secrets/SecretsStore'
import { seed } from '../src/seed/seed'
import { buildApp } from '../src/http/app'
import { runAuction } from '../src/exchange/auction'
import { nextWindow } from '../src/domain/positions'
import { mockDsps } from '../test/helpers'

const arg = (name: string, dflt: number) => Number(process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1] ?? dflt)
const SCALE = arg('scale', 0)
const SECONDS = arg('seconds', 4)
const CONCURRENCY = arg('concurrency', 32)
/* Simulated round trip to each DSP's bidder, in ms. The mock DSPs answer
   in-process instantly, which would hide how the auction fans out; a real
   bidder takes tens to hundreds of ms (the timeout is 300). */
const BIDDER_MS = arg('bidder-ms', 0)

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

/* ---- synthetic estate: N more display types, 4 advertiser slots each ---- */
if (SCALE > 0) {
  const base = ctx.displayTypes.get('landscape')!
  const stores = ctx.stores.list()
  const insDisplay = ctx.db.prepare('INSERT INTO displays (id, name, store, store_id, display_type_id) VALUES (?, ?, ?, ?, ?)')
  const insVacd = ctx.db.prepare('INSERT INTO audience_vacd (display_type_id, slot, assumed_views_per_window, counted) VALUES (?, ?, ?, 0)')
  const advSlot = (label: string) => ({ label, owner: 'advertiser', partnerIds: [], advertisers: [], listMode: null, storeScope: null, quota: null })
  ctx.db.exec('BEGIN')
  for (let i = 0; i < SCALE; i++) {
    const id = `bench_dt_${i}`
    ctx.displayTypes.create({
      ...base, id, name: `Bench ${i}`, defaultPlaylistId: base.defaultPlaylistId,
      phExtensions: { ...base.phExtensions, slots: [advSlot('A1'), advSlot('A2'), advSlot('A3'), advSlot('A4')] },
    } as typeof base)
    for (let d = 0; d < 25; d++) {
      const s = stores[(i + d) % stores.length]
      insDisplay.run(`${id}_d${d}`, `Bench ${i} / ${d}`, s.name, s.id, id)
    }
    for (let s = 1; s <= 4; s++) insVacd.run(id, s, 400 + s)
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
async function drive(label: string, req: () => Promise<Response>) {
  const lat: number[] = []
  let errors = 0
  const until = performance.now() + SECONDS * 1000
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (performance.now() < until) {
      const t = performance.now()
      const r = await req()
      await r.arrayBuffer()
      lat.push(performance.now() - t)
      if (r.status >= 400) errors++
    }
  }))
  lat.sort((a, b) => a - b)
  console.log(
    `${label.padEnd(44)} ${String(Math.round(lat.length / SECONDS)).padStart(6)} req/s   p50 ${pct(lat, 50).toFixed(1).padStart(6)} ms   p95 ${pct(lat, 95).toFixed(1).padStart(6)} ms   p99 ${pct(lat, 99).toFixed(1).padStart(6)} ms   errors ${errors}`,
  )
}

const first = (await (await fetch(`${BASE}/v1/inventory?limit=1`, { headers: AUTH })).json()) as { items: { positionId: string }[] }
const pos = first.items[0]?.positionId
if (!pos) throw new Error('No visible position for the benchmark partner — the seed changed.')
const w = nextWindow(ctx).toISOString().slice(0, 10)
const yearOut = new Date(Date.parse(w) + 364 * 86_400_000).toISOString().slice(0, 10)
const positions = ctx.displayTypes.list().length
console.log(`\nEstate: ${positions} display types, ${ctx.displays.list().length} displays · concurrency ${CONCURRENCY} · ${SECONDS}s per endpoint\n`)

await drive('GET  /v1/inventory (page of 50)', () => fetch(`${BASE}/v1/inventory`, { headers: AUTH }))
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

/* ---------------------------------------------------------------- auction */
const t0 = performance.now()
const result = await runAuction(ctx)
const ms = performance.now() - t0
console.log(`\nAuction (bidder round trip ${BIDDER_MS} ms): ${result.positions.length} positions cleared for ${result.windowStart.slice(0, 10)} in ${ms.toFixed(0)} ms (${(ms / Math.max(1, result.positions.length)).toFixed(2)} ms/position)\n`)

await app.close()
ctx.db.close()
rmSync(dir, { recursive: true, force: true })
