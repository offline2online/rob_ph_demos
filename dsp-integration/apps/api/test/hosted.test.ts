/* The hosted API (deploy/firebase/functions/src/host.ts): the POC app run
   inside one Cloud Function, persisting to a bucket. Tested here against an
   in-memory bucket, the way it runs — minus Firebase. */
import { randomBytes } from 'node:crypto'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { type BlobStore, type DocStore, chunkedStore, createHost } from '../../../deploy/firebase/functions/src/host'

/* Firestore's shape, in memory: what the production DocStore adapter does. */
const memoryDocs = () => {
  const docs = new Map<string, Record<string, unknown>>()
  const store: DocStore = {
    get: async (id) => docs.get(id) ?? null,
    setMany: async (entries) => entries.forEach(([id, d]) => docs.set(id, { ...d })),
    set: async (id, d) => void docs.set(id, { ...d }),
    deleteMany: async (ids) => ids.forEach((id) => docs.delete(id)),
    namesWithPrefix: async (p) => [...docs.values()].map((d) => d.name as string | undefined).filter((n): n is string => !!n && n.startsWith(p)),
  }
  return { store, docs }
}
/* The host over the same chunked store production uses; `blobs` lists the
   blob names it holds. */
const memoryStore = () => {
  const { store: docs, docs: raw } = memoryDocs()
  const store = chunkedStore(docs)
  const blobs = { keys: () => [...raw.values()].map((d) => d.name as string | undefined).filter((n): n is string => !!n), get: (n: string) => store.get(n) }
  return { store, blobs }
}
const MIGRATIONS = [fileURLToPath(new URL('../src/db/migrations/', import.meta.url)), fileURLToPath(new URL('../../../packages/campaign-approval/migrations/', import.meta.url))]
const ORIGIN = 'https://offline2online.github.io'

/* host.ts configures the app through process.env, as a fresh instance would. */
const saved = { ...process.env }
afterEach(() => {
  for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k]
  Object.assign(process.env, saved)
})
const newHost = (store: BlobStore) =>
  createHost({ store, dataDir: mkdtempSync(join(tmpdir(), 'dsp-host-')), migrationsDirs: MIGRATIONS, publicUrl: 'https://api.example' })
const get = (h: ReturnType<typeof newHost>, url: string, headers: Record<string, string> = {}) => h.handle({ method: 'GET', url, headers, ip: '1.1.1.1' })
const body = (r: { body: Buffer }) => JSON.parse(r.body.toString('utf8'))

describe('chunked, compressed blob storage', () => {
  it('round-trips a blob larger than a chunk, swaps versions whole, and leaves no stale chunks', async () => {
    const { store: docs, docs: raw } = memoryDocs()
    const blobs: BlobStore = chunkedStore(docs, 1024)
    /* Random, so gzip can't shrink it under one chunk. */
    const big = randomBytes(50_000)
    await blobs.put('assets/a.png', big)
    expect((await blobs.get('assets/a.png'))!.equals(big)).toBe(true)
    const chunksV1 = [...raw.keys()].filter((k) => k.includes('~v'))
    expect(chunksV1.length).toBeGreaterThan(1)
    await blobs.put('assets/a.png', Buffer.from('small now'))
    expect((await blobs.get('assets/a.png'))!.toString()).toBe('small now')
    expect([...raw.keys()].filter((k) => chunksV1.includes(k))).toEqual([])
    await blobs.put('poc.sqlite', Buffer.from('db'))
    expect(await blobs.list('assets/')).toEqual(['assets/a.png'])
    expect(await blobs.get('missing')).toBeNull()
  })
})

describe('hosted API', () => {
  it('saves survive a cold start: the database and creatives are restored from the bucket', async () => {
    const { store, blobs } = memoryStore()
    const first = newHost(store)
    const rec = body(await get(first, '/api/admin/v1/display-types/landscape/record'))
    const { phExtensions: _ext, ...record } = rec
    const put = await first.handle({ method: 'PUT', url: '/api/admin/v1/display-types/landscape/record', headers: { 'content-type': 'application/json' }, rawBody: Buffer.from(JSON.stringify({ ...record, name: 'Saved on the host' })), ip: '1.1.1.1' })
    expect(put.status).toBe(200)
    expect(blobs.keys()).toEqual(expect.arrayContaining(['instance.json', 'poc.sqlite']))
    expect(blobs.keys().some((k) => k.startsWith('assets/'))).toBe(true)

    /* A new instance over the same bucket: the save is there, not a reseed. */
    const second = newHost(store)
    expect(body(await get(second, '/api/admin/v1/display-types/landscape/record')).name).toBe('Saved on the host')
  }, 60_000)

  it('answers CORS for the hosted prototype’s origins only, and builds creative URLs on its own origin', async () => {
    const h = newHost(memoryStore().store)
    const pre = await h.handle({ method: 'OPTIONS', url: '/api/admin/v1/session', headers: { origin: ORIGIN }, ip: '1.1.1.1' })
    expect(pre.status).toBe(204)
    expect(pre.headers['Access-Control-Allow-Origin']).toBe(ORIGIN)
    expect((await get(h, '/api/admin/v1/session', { origin: 'https://evil.example' })).headers['Access-Control-Allow-Origin']).toBeUndefined()
    const approval = await get(h, '/api/admin/v1/campaigns/c_demo_arnotts_shapes/approval')
    expect(approval.body.toString()).toMatch(/"https:\/\/api\.example\/assets\//)
  }, 60_000)

  it('uses its own partner tokens, never the public POC ones, and guards the scheduler hook', async () => {
    const { store, blobs } = memoryStore()
    const h = newHost(store)
    expect((await get(h, '/api/v1/targeting/attributes', { authorization: 'Bearer poc-token-google-dv360' })).status).toBe(401)
    const instance = JSON.parse((await blobs.get('instance.json'))!.toString())
    const googleToken = Object.keys(instance.partnerTokens).find((t) => instance.partnerTokens[t] === 'p_google')
    expect((await get(h, '/api/v1/targeting/attributes', { authorization: `Bearer ${googleToken}` })).status).toBe(200)
    expect((await h.handle({ method: 'POST', url: '/_tasks/tick', headers: { 'x-tick-token': 'wrong' }, ip: '1.1.1.1' })).status).toBe(404)
    expect((await h.handle({ method: 'POST', url: '/_tasks/tick', headers: { 'x-tick-token': instance.tickToken }, ip: '1.1.1.1' })).status).toBe(200)
  }, 60_000)

  it('rate-limits one visitor without affecting another', async () => {
    const h = newHost(memoryStore().store)
    const codes: number[] = []
    for (let i = 0; i < 65; i++) codes.push((await get(h, '/api/admin/v1/session')).status)
    expect(codes.filter((c) => c === 429).length).toBeGreaterThan(0)
    expect((await h.handle({ method: 'GET', url: '/api/admin/v1/session', headers: {}, ip: '2.2.2.2' })).status).toBe(200)
  }, 60_000)
})
