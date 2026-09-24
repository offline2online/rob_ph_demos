/* The hosted POC API: the same Fastify app `npm run dev:api` serves, run
   inside a Cloud Function so the hosted prototype on GitHub Pages can save.
   This file knows nothing about Firebase — index.ts adapts it — so it can
   be exercised locally (deploy/firebase/test-host.mts) exactly as it runs.

   What differs from the POC on a laptop, and why:
   - Storage. A Cloud Function's disk is an in-memory /tmp that vanishes
     when the instance stops. The SQLite database and uploaded creatives
     live there while it runs, and after every successful write they are
     copied to durable storage (`BlobStore` — in production a private
     Firestore collection, via `chunkedStore`); a cold start restores them.
     The function runs as ONE instance (index.ts, maxInstances: 1), so there
     is one writer and nothing to merge.
   - The mock DSPs run in-process: their Fastify app is called directly
     (`inject`) instead of over HTTP, so connecting a DSP and the auction
     work with no second service. Their state starts fresh on each cold
     start, as the mock service's does on a restart.
   - Secrets are generated on first boot and kept in the bucket: the key
     that encrypts DSP credentials at rest (they are mock credentials), the
     Partner API bearer tokens (never the public POC ones), and the token
     the scheduler job presents.
   - Scheduled work (billing, the auction, retention) runs on the back of
     requests, at most every five minutes — there is no Cloud Scheduler.
   - The browser calls this from another origin (GitHub Pages, githack),
     so CORS is answered here for a fixed list of origins.

   It is still the POC: every visitor is the stand-in HQ admin
   (auth/session.ts). A per-IP rate limit bounds what one visitor can do,
   and a reset (deploy workflow input) restores the demo data. See
   deploy/firebase/README.md. */
import { randomBytes } from 'node:crypto'
import { gunzipSync, gzipSync } from 'node:zlib'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { loadConfig } from '../../../../apps/api/src/config'
import { type Context, createContext } from '../../../../apps/api/src/context'
import { buildApp } from '../../../../apps/api/src/http/app'
import { tokenBucket } from '../../../../apps/api/src/http/rateLimit'
import { seed } from '../../../../apps/api/src/seed/seed'
import { schedulerTick } from '../../../../apps/api/src/exchange/scheduler'
import { sweepRejectedCampaigns } from '../../../../apps/api/src/domain/campaignRetention'
import type { Fetch } from '../../../../apps/api/src/dsp/DspClient'
import { buildMocks } from '../../../../apps/dsp-mocks/src/app'

/* Where the data outlives the instance. Names are relative to a private
   prefix (index.ts: `dsp-api/` in the project's default bucket). */
export interface BlobStore {
  get(name: string): Promise<Buffer | null>
  put(name: string, bytes: Buffer): Promise<void>
  list(prefix: string): Promise<string[]>
}

/* A plain document store (Firestore in production, a Map in the tests):
   documents are small JSON-ish records with binary fields. */
export interface DocStore {
  get(id: string): Promise<Record<string, unknown> | null>
  /* Written together; used only for documents no reader can see yet. */
  setMany(docs: [id: string, data: Record<string, unknown>][]): Promise<void>
  set(id: string, data: Record<string, unknown>): Promise<void>
  deleteMany(ids: string[]): Promise<void>
  /* The `name` field of every head document whose name starts with prefix. */
  namesWithPrefix(prefix: string): Promise<string[]>
}

/* A BlobStore over documents: each blob is gzip-compressed (the SQLite file
   shrinks several times over) and split into chunks under a document-size
   limit. Chunks are written under a fresh version first and the head
   document, which names the version, last — so a reader sees the old blob
   or the new one, never half of each, even if the instance stops mid-save.
   The previous version's chunks are deleted afterwards. */
export function chunkedStore(docs: DocStore, chunkBytes = 900 * 1024): BlobStore {
  const headId = (name: string) => `blob~${name.replace(/\//g, '~')}`
  const chunkId = (name: string, version: string, i: number) => `${headId(name)}~v${version}~${i}`
  return {
    async get(name) {
      const head = await docs.get(headId(name))
      if (!head) return null
      const parts: Buffer[] = []
      for (let i = 0; i < (head.parts as number); i++) {
        const chunk = await docs.get(chunkId(name, head.version as string, i))
        if (!chunk) throw new Error(`Missing chunk ${i} of ${name}`)
        parts.push(Buffer.from(chunk.data as Uint8Array))
      }
      return gunzipSync(Buffer.concat(parts))
    },
    async put(name, bytes) {
      const packed = gzipSync(bytes)
      const version = `${Date.now().toString(36)}${randomBytes(3).toString('hex')}`
      const parts = Math.max(1, Math.ceil(packed.length / chunkBytes))
      const previous = await docs.get(headId(name))
      for (let i = 0; i < parts; i += 4) {
        await docs.setMany(Array.from({ length: Math.min(4, parts - i) }, (_, k) => [chunkId(name, version, i + k), { data: packed.subarray((i + k) * chunkBytes, (i + k + 1) * chunkBytes) }] as [string, Record<string, unknown>]))
      }
      await docs.set(headId(name), { name, version, parts, size: bytes.length, updatedAt: new Date().toISOString() })
      if (previous) await docs.deleteMany(Array.from({ length: previous.parts as number }, (_, i) => chunkId(name, previous.version as string, i)))
    },
    list: (prefix) => docs.namesWithPrefix(prefix),
  }
}

export interface HostRequest { method: string; url: string; headers: Record<string, string | string[] | undefined>; rawBody?: Buffer; ip?: string }
export interface HostResponse { status: number; headers: Record<string, string>; body: Buffer }

interface Instance { secretsKey: string; partnerTokens: Record<string, string>; tickToken: string }

/* Origins the hosted admin UI is served from. */
export const ALLOWED_ORIGINS = [/^https:\/\/offline2online\.github\.io$/, /^https:\/\/raw(cdn)?\.githack\.com$/, /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/]

const TICK_EVERY_MS = 5 * 60_000
const WRITE = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])
const HOP_BY_HOP = new Set(['connection', 'keep-alive', 'transfer-encoding', 'content-length'])

/* The mock DSP service, called in-process: a URL on the mock's host becomes
   an inject() into its Fastify app (the same bridge the API tests use). */
function inProcessFetch(mocks: FastifyInstance): Fetch {
  return async (url, init) => {
    const u = new URL(url)
    const res = await mocks.inject({
      method: (init?.method ?? 'GET') as 'GET', url: u.pathname + u.search,
      headers: { host: u.host, ...(init?.headers as Record<string, string> | undefined) }, payload: init?.body as string | undefined,
    })
    return new Response(new Uint8Array(res.rawPayload), { status: res.statusCode, headers: { 'content-type': String(res.headers['content-type'] ?? 'application/json') } })
  }
}

export function createHost(opts: { store: BlobStore; dataDir: string; migrationsDirs: string[]; publicUrl: string; log?: (m: string) => void }) {
  const log = opts.log ?? (() => {})
  const dbFile = join(opts.dataDir, 'poc.sqlite')
  const assetsDir = join(opts.dataDir, 'assets')
  /* One visitor can't monopolise the one instance: 20 requests/s, bursts of 60. */
  const perIp = tokenBucket({ perSecond: 20, burst: 60 })
  let booted: Promise<{ ctx: Context; app: FastifyInstance; instance: Instance }> | null = null
  const uploaded = new Set<string>()
  const cleared = new Set<string>()
  /* Persist one change at a time, in order. */
  let chain: Promise<void> = Promise.resolve()
  /* The scheduled work (billing, the auction at its cutoff, retention) runs
     on the back of ordinary requests, at most every TICK_EVERY_MS: Cloud
     Scheduler isn't enabled on the project (the deploy's service account
     may not enable it), so there is no timer. On a demo that means an
     auction whose hour passes with no visitor at all isn't cleared by
     itself — a known, accepted gap; /_tasks/tick is there for a scheduler
     once a project owner enables one (README). */
  let lastTick = 0
  /* SQLite's running count of rows changed on this connection. */
  const changes = (ctx: Context) => Number((ctx.db.prepare('SELECT total_changes() AS n').get() as { n: number }).n)
  const runTick = async (ctx: Context) => {
    const before = changes(ctx)
    await schedulerTick(ctx, cleared, log)
    sweepRejectedCampaigns(ctx.db, ctx.config.rejectedCampaignRetentionDays, ctx.clock)
    /* Most ticks bill nothing and clear no auction: only upload the database
       (a few MB, gzipped and chunked into Firestore) when something changed
       (page-load review, 24 Sep 2026). */
    if (changes(ctx) !== before) await persist(ctx)
  }

  const boot = () =>
    (booted ??= (async () => {
      mkdirSync(assetsDir, { recursive: true })
      let instance = JSON.parse((await opts.store.get('instance.json'))?.toString('utf8') ?? 'null') as Instance | null
      if (!instance) {
        const token = () => randomBytes(24).toString('base64url')
        instance = { secretsKey: randomBytes(32).toString('base64'), partnerTokens: { [token()]: 'p_google', [token()]: 'p_amazon' }, tickToken: token() }
        await opts.store.put('instance.json', Buffer.from(JSON.stringify(instance)))
        log('Generated this instance’s keys and tokens.')
      }
      const saved = await opts.store.get('poc.sqlite')
      /* A journal left by an earlier process in the same data folder (a
         restart without a fresh /tmp, or the local stand-in) would be
         replayed over the restored file and corrupt it: every later read
         then failed with "database disk image is malformed" (page-load
         review, 24 Sep 2026). The saved copy is complete on its own. */
      if (saved) {
        for (const suffix of ['-wal', '-shm', '-journal']) rmSync(dbFile + suffix, { force: true })
        writeFileSync(dbFile, saved)
      }
      for (const name of await opts.store.list('assets/')) {
        const file = name.slice('assets/'.length)
        if (!file || existsSync(join(assetsDir, file))) continue
        const bytes = await opts.store.get(name)
        if (bytes) writeFileSync(join(assetsDir, file), bytes)
        uploaded.add(file)
      }
      Object.assign(process.env, {
        PH_DB_FILE: dbFile, PH_ASSETS_DIR: assetsDir, PH_SECRETS_KEY: instance.secretsKey, PH_PUBLIC_URL: opts.publicUrl,
        PH_MIGRATIONS_DIRS: opts.migrationsDirs.join(':'), PARTNER_TOKENS: JSON.stringify(instance.partnerTokens),
        DSP_INTEGRATION_ENABLED: 'true', POC_ROLE: 'hq_admin',
      })
      const mocks = buildMocks()
      const ctx = createContext({ config: loadConfig({ ...process.env, DSP_MOCKS_URL: 'http://mocks.internal' }), dspFetch: inProcessFetch(mocks.app) })
      if (await seed(ctx)) log('Seeded a fresh database with the demo estate.')
      const app = buildApp(ctx)
      await app.ready()
      if (!saved) await persist(ctx)
      log(saved ? 'Restored the saved database.' : 'Started from fresh demo data.')
      return { ctx, app, instance }
    })().catch((e) => {
      booted = null
      throw e
    }))

  /* A consistent copy of the database (VACUUM INTO works mid-flight), then
     any creative not yet copied. */
  const persist = (ctx: Context) =>
    (chain = chain.then(async () => {
      const snap = `${dbFile}.snapshot`
      rmSync(snap, { force: true })
      ctx.db.exec(`VACUUM INTO '${snap.replace(/'/g, "''")}'`)
      await opts.store.put('poc.sqlite', readFileSync(snap))
      rmSync(snap, { force: true })
      for (const file of readdirSync(assetsDir)) {
        if (uploaded.has(file)) continue
        await opts.store.put(`assets/${file}`, readFileSync(join(assetsDir, file)))
        uploaded.add(file)
      }
    }))

  function cors(origin: string | undefined): Record<string, string> {
    if (!origin || !ALLOWED_ORIGINS.some((re) => re.test(origin))) return { Vary: 'Origin' }
    return {
      'Access-Control-Allow-Origin': origin, Vary: 'Origin', 'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'content-type, authorization', 'Access-Control-Max-Age': '600',
    }
  }
  const json = (status: number, body: unknown, headers: Record<string, string>): HostResponse => ({
    status, headers: { ...headers, 'content-type': 'application/json' }, body: Buffer.from(JSON.stringify(body)),
  })

  async function handle(req: HostRequest): Promise<HostResponse> {
    const origin = typeof req.headers.origin === 'string' ? req.headers.origin : undefined
    const corsHeaders = cors(origin)
    if (req.method === 'OPTIONS') return { status: 204, headers: corsHeaders, body: Buffer.alloc(0) }
    const wait = perIp.take(req.ip ?? 'unknown')
    if (wait) return json(429, { error: { code: 'rate_limited', message: `Too many requests; retry in ${wait}s.` } }, { ...corsHeaders, 'Retry-After': String(wait) })

    const { ctx, app, instance } = await boot()
    /* The Cloud Scheduler job (index.ts): billing, the auction at its cutoff,
       and the rejected-campaign retention sweep. */
    if (req.url.split('?')[0] === '/_tasks/tick') {
      if (req.method !== 'POST' || req.headers['x-tick-token'] !== instance.tickToken) return json(404, { error: { code: 'not_found', message: 'Not found.' } }, corsHeaders)
      lastTick = Date.now()
      await runTick(ctx)
      return json(200, { ok: true }, corsHeaders)
    }
    if (Date.now() - lastTick > TICK_EVERY_MS) {
      lastTick = Date.now()
      /* Alongside the visitor's request, not in front of it: it used to be
         awaited here, so one click every five minutes waited for billing,
         the auction and a database upload (page-load review, 24 Sep 2026).
         A failed tick is logged, never turned into the visitor's error. A
         save made meanwhile still persists after it: `persist` is one
         ordered chain. */
      void runTick(ctx).catch((e) => log(`Scheduled work failed: ${e instanceof Error ? e.message : String(e)}`))
    }

    const res = await app.inject({
      method: req.method as 'GET', url: req.url,
      headers: Object.fromEntries(Object.entries(req.headers).filter(([, v]) => v !== undefined)) as Record<string, string>,
      payload: req.rawBody && req.rawBody.length ? req.rawBody : undefined,
    })
    /* Saved before the caller hears it worked: a change is only reported
       once it would survive the instance stopping. */
    if (WRITE.has(req.method) && res.statusCode < 400) await persist(ctx)
    const headers: Record<string, string> = { ...corsHeaders }
    for (const [k, v] of Object.entries(res.headers)) if (v !== undefined && !HOP_BY_HOP.has(k.toLowerCase())) headers[k] = Array.isArray(v) ? v.join(', ') : String(v)
    return { status: res.statusCode, headers, body: res.rawPayload }
  }

  return { handle, boot }
}
