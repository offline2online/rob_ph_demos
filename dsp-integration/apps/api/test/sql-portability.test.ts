/* SQL that runs unchanged on Postgres (Scope & Seam Reconciliation Review,
   1 Oct 2026, finding #19; ticket gAi2mkcm43uW6hrchOjh). Lists that must come
   back in the order rows were written used SQLite's hidden rowid; they now
   order by an explicit seq (migrations 0037 and 0102). Each list below gets
   rows whose ids sort the OTHER way from the order they were written, so
   ordering by id — the tempting replacement — would fail. */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { approvalStore } from '../../../packages/campaign-approval/src/server/approvalStore'
import { isUniqueViolation, openDb } from '../src/db/db'
import { appliedVersions, migrateDown, migrateUp } from '../src/db/migrate'
import { sqliteAudienceSource } from '../src/platform/AudienceSource'
import { sqliteDisplaySource } from '../src/platform/DisplaySource'
import { sqliteDisplayTypeSource } from '../src/platform/DisplayTypeSource'
import { sqlitePlaybackSource } from '../src/platform/PlaybackSource'
import { sqlitePlaylistSource } from '../src/platform/PlaylistSource'
import { sqliteBuyersListRepo } from '../src/repos/BuyersListRepo'
import { sqlitePartnerRepo } from '../src/repos/PartnerRepo'
import { sqliteReservationRepo } from '../src/repos/ReservationRepo'
import { aesGcmSecretsStore } from '../src/secrets/SecretsStore'
import { TEST_KEY } from './helpers'

const fresh = () => {
  const db = openDb(':memory:')
  migrateUp(db)
  return db
}
/* Written in this order; ids sort the other way. */
const ARRIVAL = ['z_first', 'm_second', 'a_third']
const SAME_MS = '2026-10-01T00:00:00.000Z'

describe('arrival order without rowid', () => {
  it('displays and displays by type', async () => {
    const db = fresh()
    for (const id of ARRIVAL) db.prepare("INSERT INTO displays (id, name, store, display_type_id) VALUES (?, ?, 'S', 'dt')").run(id, id)
    const src = sqliteDisplaySource(db)
    expect((await src.list()).map((d) => d.id)).toEqual(ARRIVAL)
    expect((await src.listByDisplayType('dt')).map((d) => d.id)).toEqual(ARRIVAL)
  })

  it('playlists', async () => {
    const db = fresh()
    const src = sqlitePlaylistSource(db)
    for (const id of ARRIVAL) await src.create({ id, name: id, autoCreatedFor: null })
    expect((await src.list()).map((p) => p.id)).toEqual(ARRIVAL)
  })

  it('display types', async () => {
    const db = fresh()
    for (const id of ARRIVAL) {
      db.prepare(`INSERT INTO display_types (id, touch_point, name, canvas_width, canvas_height, background_color, playlist_settings, qr_control, enabled_features)
                  VALUES (?, 'Digital Signage', ?, 1920, 1080, '#000000', '{}', '{}', '{}')`).run(id, id)
    }
    expect((await sqliteDisplayTypeSource(db).list()).map((d) => d.id)).toEqual(ARRIVAL)
  })

  it('partners', async () => {
    const db = fresh()
    const repo = sqlitePartnerRepo(db, aesGcmSecretsStore(TEST_KEY))
    for (const id of ARRIVAL) {
      await repo.insert({ id, provider: `prov_${id}`, name: id, status: 'draft', lastSync: null, mode: 'test', credsPublic: {}, bidder: {}, seats: [], listsLinked: true,
        allowList: [], blockList: [], categoryAllowList: [], categoryBlockList: [] })
    }
    expect((await repo.list()).map((p) => p.id)).toEqual(ARRIVAL)
  })

  it('buyers lists', async () => {
    const db = fresh()
    const repo = sqliteBuyersListRepo(db)
    for (const id of ARRIVAL) await repo.insert({ id, name: id, description: '', invitedBuyers: [], activeFrom: null, activeTo: null, auctionCloses: null })
    expect((await repo.list()).map((l) => l.id)).toEqual(ARRIVAL)
  })

  it('reservations written in the same millisecond keep the order they arrived in (the earlier bid wins a tie)', async () => {
    const db = fresh()
    const repo = sqliteReservationRepo(db)
    for (const id of ARRIVAL) {
      await repo.insert({ id, partnerId: 'p', advertiserId: null, campaignId: null, positionId: 'pos', windowStart: SAME_MS, type: 'bid', channel: 'api', bidCpm: 10,
        currency: 'AUD', status: 'pending', clearingCpm: null, reason: null, testMode: false, pricingType: null, handedOffAt: null })
    }
    db.prepare('UPDATE reservations SET created_at = ?').run(SAME_MS)
    expect((await repo.forWindow('pos', SAME_MS)).map((r) => r.id)).toEqual(ARRIVAL)
  })

  it('approval rows and the audit trail, with every timestamp equal', async () => {
    const db = fresh()
    const store = approvalStore(db)
    for (const v of ARRIVAL) {
      await store.upsert({ campaignId: 'c1', assetVersion: v, status: 'approved', mode: null, submittedAt: null, reviewedBy: null, reviewedAt: null, reason: null, assetReasons: [], checks: [] }, SAME_MS)
      await store.audit('c1', v, 'submitted', null, null, SAME_MS)
    }
    expect((await store.rows('c1')).map((r) => r.assetVersion)).toEqual(ARRIVAL)
    expect((await store.latest('c1'))?.assetVersion).toBe('a_third')
    expect(await store.liveVersion('c1')).toBe('a_third')
    expect((await store.auditTrail('c1')).map((a) => a.assetVersion)).toEqual(ARRIVAL)
    /* Re-saving a row (an upsert that updates) keeps its place. */
    await store.upsert({ campaignId: 'c1', assetVersion: 'z_first', status: 'approved', mode: null, submittedAt: null, reviewedBy: null, reviewedAt: null, reason: 'again', assetReasons: [], checks: [] }, SAME_MS)
    expect((await store.rows('c1')).map((r) => r.assetVersion)).toEqual(ARRIVAL)
  })

  it('the approval store works over an SqlDb whose statements answer with promises', async () => {
    const db = fresh()
    /* A stand-in for an async (Postgres) adapter: every statement answers a promise. */
    const later = <T>(v: T) => new Promise<T>((r) => setTimeout(() => r(v), 1))
    const asyncDb = {
      exec: (sql: string) => later(db.exec(sql)),
      prepare: (sql: string) => {
        const st = db.prepare(sql)
        return { run: (...a: unknown[]) => later(st.run(...(a as []))), get: (...a: unknown[]) => later(st.get(...(a as []))), all: (...a: unknown[]) => later(st.all(...(a as []))) }
      },
    }
    const store = approvalStore(asyncDb)
    for (const v of ARRIVAL) {
      await store.upsert({ campaignId: 'c1', assetVersion: v, status: 'approved', mode: null, submittedAt: null, reviewedBy: null, reviewedAt: null, reason: null, assetReasons: [], checks: [] }, SAME_MS)
      await store.audit('c1', v, 'submitted', null, null, SAME_MS)
    }
    expect((await store.rows('c1')).map((r) => r.assetVersion)).toEqual(ARRIVAL)
    expect((await store.latest('c1'))?.assetVersion).toBe('a_third')
    expect(await store.liveVersion('c1')).toBe('a_third')
    expect((await store.get('c1', 'm_second'))?.status).toBe('approved')
    expect((await store.auditTrail('c1')).map((a) => a.assetVersion)).toEqual(ARRIVAL)
    await store.recordHumanClearance('c1', 'default', 'h1', 'hq', SAME_MS)
    expect(await store.isHumanCleared('c1', 'default', 'h1')).toBe(true)
    expect(await store.isHumanCleared('c1', 'default', 'h2')).toBe(false)
    await store.remove('c1', 'm_second')
    expect((await store.rows('c1')).map((r) => r.assetVersion)).toEqual(['z_first', 'a_third'])
  })

  it('rows written before migration 0037 keep their order, and new rows follow them', async () => {
    const db = openDb(':memory:')
    migrateUp(db, '0036')
    for (const id of ARRIVAL) db.prepare("INSERT INTO displays (id, name, store, display_type_id) VALUES (?, ?, 'S', 'dt')").run(id, id)
    migrateUp(db)
    db.prepare("INSERT INTO displays (id, name, store, display_type_id) VALUES ('b_fourth', 'b_fourth', 'S', 'dt')").run()
    expect((await sqliteDisplaySource(db).list()).map((d) => d.id)).toEqual([...ARRIVAL, 'b_fourth'])
  })

  it('0037 reverts cleanly', () => {
    const db = fresh()
    /* Everything applied after 0037 (later app migrations, then the approval module's 0100–0102) first. */
    migrateDown(db, appliedVersions(db).filter((v) => v >= '0037').length)
    const cols = (db.prepare('PRAGMA table_info(displays)').all() as { name: string }[]).map((c) => c.name)
    expect(cols).not.toContain('seq')
  })
})

describe('portable statements', () => {
  it('the audience stand-in never reads display_types: the default VAC-d is passed in (DDOjJoYjraKROu4Ainj5)', () => {
    const db = fresh()
    /* No display_types row at all: the score comes only from what the exchange hands over. */
    db.prepare("INSERT INTO displays (id, name, store, display_type_id) VALUES ('d1', 'd1', 'S', 'dt'), ('d2', 'd2', 'S', 'dt')").run()
    const audience = sqliteAudienceSource(db)
    expect(audience.forSlot('dt', 1, 12)).toEqual({ assumedViewsPerWindow: 24, counted: false, scored: true })
    expect(audience.forSlot('dt', 1, null)).toEqual({ assumedViewsPerWindow: 0, counted: false, scored: false })
  })

  it('plays per version: one scan when a window played one version, the same answer as GROUP BY', async () => {
    const db = fresh()
    db.prepare("INSERT INTO displays (id, name, store, display_type_id) VALUES ('d1', 'd1', 'S', 'dt')").run()
    const play = db.prepare('INSERT INTO plays (id, display_id, campaign_id, played_at, duration_sec, version_id, tier) VALUES (?, ?, ?, ?, ?, ?, ?)')
    const q = { campaignId: 'c1', displayTypeId: 'dt', from: '2026-10-01T00:00:00.000Z', to: '2026-10-02T00:00:00.000Z' }
    play.run('p1', 'd1', 'c1', '2026-10-01T01:00:00.000Z', 10, 'v7', 'default')
    play.run('p2', 'd1', 'c1', '2026-10-01T02:00:00.000Z', 10, 'v7', 'personalised')
    expect((await sqlitePlaybackSource(db).totals(q)).byVersion).toEqual([{ versionId: 'v7', plays: 2 }])
    play.run('p3', 'd1', 'c1', '2026-10-01T03:00:00.000Z', 10, null, 'default')
    expect((await sqlitePlaybackSource(db).totals(q)).byVersion).toEqual([{ versionId: null, plays: 1 }, { versionId: 'v7', plays: 2 }])
    play.run('p4', 'd1', 'c1', '2026-10-01T04:00:00.000Z', 10, 'v8', 'default')
    expect((await sqlitePlaybackSource(db).totals(q)).byVersion).toEqual([{ versionId: null, plays: 1 }, { versionId: 'v7', plays: 2 }, { versionId: 'v8', plays: 1 }])
    expect((await sqlitePlaybackSource(db).totals({ ...q, campaignId: 'none' })).byVersion).toEqual([])
  })

  it('totals count every play whatever its tier', async () => {
    const db = fresh()
    db.prepare("INSERT INTO displays (id, name, store, display_type_id) VALUES ('d1', 'd1', 'S', 'dt')").run()
    const play = db.prepare('INSERT INTO plays (id, display_id, campaign_id, played_at, duration_sec, tier) VALUES (?, ?, ?, ?, ?, ?)')
    play.run('p1', 'd1', 'c1', '2026-10-01T01:00:00.000Z', 10, 'personalised')
    play.run('p2', 'd1', 'c1', '2026-10-01T02:00:00.000Z', 10, null)
    play.run('p3', 'd1', 'c1', '2026-10-01T03:00:00.000Z', 5, 'personalised')
    const t = await sqlitePlaybackSource(db).totals({ campaignId: 'c1', displayTypeId: 'dt', from: '2026-10-01T00:00:00.000Z', to: '2026-10-02T00:00:00.000Z' })
    expect(t).toEqual({ plays: 3, playedSec: 25, byVersion: [{ versionId: null, plays: 3 }] })
  })

  it('isUniqueViolation recognises SQLite and Postgres, and nothing else', () => {
    const db = fresh()
    db.prepare("INSERT INTO displays (id, name, store, display_type_id) VALUES ('d1', 'd1', 'S', 'dt')").run()
    let sqlite: unknown
    try { db.prepare("INSERT INTO displays (id, name, store, display_type_id) VALUES ('d1', 'd1', 'S', 'dt')").run() } catch (e) { sqlite = e }
    expect(isUniqueViolation(sqlite)).toBe(true)
    const pg = Object.assign(new Error('duplicate key value violates unique constraint "reservations_one_winner"'), { code: '23505' })
    expect(isUniqueViolation(pg)).toBe(true)
    expect(isUniqueViolation(Object.assign(new Error('something'), { code: '23505' }))).toBe(true)
    expect(isUniqueViolation(Object.assign(new Error('null value in column "id"'), { code: '23502' }))).toBe(false)
    expect(isUniqueViolation(new Error('FOREIGN KEY constraint failed'))).toBe(false)
    expect(isUniqueViolation('UNIQUE constraint failed')).toBe(false)
  })
})

/* A guard, so SQLite-only SQL doesn't creep back into the code that would
   have to run on Postgres. Migrations are the SQLite adapter's own files
   and are not scanned. */
describe('no SQLite-only SQL in the exchange source', () => {
  const roots = ['../src', '../../../packages/campaign-approval/src'].map((p) => fileURLToPath(new URL(p, import.meta.url)))
  const files = (dir: string): string[] => readdirSync(dir).flatMap((n) => {
    const p = join(dir, n)
    if (statSync(p).isDirectory()) return n === 'migrations' ? [] : files(p)
    return /\.tsx?$/.test(n) ? [p] : []
  })
  const BANNED: [string, RegExp][] = [
    ['rowid', /\browid\b/i],
    ['json_extract', /\bjson_extract\s*\(/i],
    ['INSERT OR IGNORE / REPLACE', /\bINSERT\s+OR\s+(IGNORE|REPLACE)\b/i],
    ['boolean SUM', /\bSUM\s*\(\s*\w+\s*(=|<>|!=)\s*'[^']*'\s*\)/i],
  ]
  it.each(BANNED)('%s', (_name, re) => {
    const hits = roots.flatMap(files).flatMap((f) => readFileSync(f, 'utf8').split('\n').map((line, i) => ({ f, i, line })))
      .filter(({ line }) => re.test(line) && !/^\s*(\/\/|\/\*|\*)/.test(line) && !/SQLite's json_extract/.test(line))
      .map(({ f, i, line }) => `${f}:${i + 1}: ${line.trim()}`)
    expect(hits).toEqual([])
  })
})

/* A guard, so raw SQL stays where a Postgres adapter would replace it
   (ticket v2iKDJQA0wmisXhp7ebV): statements on the database — db.prepare,
   the prepared() cache, db.exec — appear only in src/platform/ (PH Core's
   stand-ins), src/repos/ (this build's own tables) and src/db/ (the
   connection, the transaction lock and the migrations). Everything else
   goes through a seam or a repository on the Context, which context.ts
   puts behind gate(), so a call made while another call chain's
   transaction is open still waits for it (db.ts). */
describe('no raw SQL outside platform/, repos/ and db/', () => {
  const SRC = fileURLToPath(new URL('../src', import.meta.url))
  const ALLOWED_DIRS = ['platform', 'repos', 'db'].map((d) => join(SRC, d))
  /* Explicit exceptions, each with its reason. Keep this list short. */
  const ALLOWLIST: Record<string, string> = {
    /* Sample-data loaders for the SQLite stand-ins (npm run db:seed /
       db:demo / db:bookings / db:screens, and the empty-database seed at
       start-up): they fill PH Core's stand-in tables (stores, displays,
       campaigns, plays, audience VAC-d) that a real deployment reads from
       PH Core, so they are deleted with the stand-ins rather than ported. */
    [join(SRC, 'seed')]: 'stand-in sample data, deleted on integration',
  }
  const RAW: [string, RegExp][] = [
    ['db.prepare(', /\.prepare\s*\(/],
    ['prepared(', /\bprepared\s*\(/],
    /* .exec( on the database — not RegExp.prototype.exec (`/…/.exec(s)`, `re.exec(s)`). */
    ['db.exec(', /\b\w*[dD]b\s*\.\s*exec\s*\(/],
  ]
  const files = (dir: string): string[] => readdirSync(dir).flatMap((n) => {
    const p = join(dir, n)
    if (statSync(p).isDirectory()) return ALLOWED_DIRS.includes(p) || p in ALLOWLIST ? [] : files(p)
    return /\.tsx?$/.test(n) ? [p] : []
  })
  const scanned = files(SRC)

  it('scans the source (sanity: the scan is not empty, and every allowlisted path exists)', () => {
    expect(scanned.length).toBeGreaterThan(20)
    for (const p of [...ALLOWED_DIRS, ...Object.keys(ALLOWLIST)]) expect(statSync(p).isDirectory()).toBe(true)
  })

  it.each(RAW)('%s', (_name, re) => {
    const hits = scanned.flatMap((f) => readFileSync(f, 'utf8').split('\n').map((line, i) => ({ f, i, line })))
      .filter(({ line }) => re.test(line) && !/^\s*(\/\/|\/\*|\*)/.test(line))
      .map(({ f, i, line }) => `${f}:${i + 1}: ${line.trim()}`)
    expect(hits).toEqual([])
  })

  it('the patterns catch what they are meant to, and not a RegExp exec', () => {
    const [, prepare] = RAW[0]
    const [, cache] = RAW[1]
    const [, exec] = RAW[2]
    expect(prepare.test("ctx.db.prepare('SELECT 1')")).toBe(true)
    expect(cache.test("prepared(ctx.db, 'SELECT 1')")).toBe(true)
    expect(exec.test("ctx.db.exec('BEGIN')")).toBe(true)
    expect(exec.test('db.exec(sql)')).toBe(true)
    expect(exec.test("/^Bearer\\s+(.+)$/i.exec(h)")).toBe(false)
    expect(exec.test('re.exec(s)')).toBe(false)
  })
})

describe('PlaybackSource.lastPlayed', () => {
  it('returns each campaign\'s latest play, and omits campaigns that never played', async () => {
    const db = fresh()
    db.prepare("INSERT INTO displays (id, name, store, display_type_id) VALUES ('d1', 'd1', 'S', 'dt')").run()
    const play = db.prepare('INSERT INTO plays (id, display_id, campaign_id, played_at, duration_sec) VALUES (?, ?, ?, ?, ?)')
    play.run('p1', 'd1', 'c1', '2026-10-01T01:00:00.000Z', 10)
    play.run('p2', 'd1', 'c1', '2026-10-03T01:00:00.000Z', 10)
    play.run('p3', 'd1', 'c2', '2026-10-02T01:00:00.000Z', 10)
    const m = await sqlitePlaybackSource(db).lastPlayed()
    expect(Object.fromEntries(m)).toEqual({ c1: '2026-10-03T01:00:00.000Z', c2: '2026-10-02T01:00:00.000Z' })
  })
})
