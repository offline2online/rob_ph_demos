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
import { migrateDown, migrateUp } from '../src/db/migrate'
import { defaultVacd } from '../src/platform/AudienceSource'
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

  it('approval rows and the audit trail, with every timestamp equal', () => {
    const db = fresh()
    const store = approvalStore(db)
    for (const v of ARRIVAL) {
      store.upsert({ campaignId: 'c1', assetVersion: v, status: 'approved', mode: null, submittedAt: null, reviewedBy: null, reviewedAt: null, reason: null, assetReasons: [], checks: [] }, SAME_MS)
      store.audit('c1', v, 'submitted', null, null, SAME_MS)
    }
    expect(store.rows('c1').map((r) => r.assetVersion)).toEqual(ARRIVAL)
    expect(store.latest('c1')?.assetVersion).toBe('a_third')
    expect(store.liveVersion('c1')).toBe('a_third')
    expect(store.auditTrail('c1').map((a) => a.assetVersion)).toEqual(ARRIVAL)
    /* Re-saving a row (an upsert that updates) keeps its place. */
    store.upsert({ campaignId: 'c1', assetVersion: 'z_first', status: 'approved', mode: null, submittedAt: null, reviewedBy: null, reviewedAt: null, reason: 'again', assetReasons: [], checks: [] }, SAME_MS)
    expect(store.rows('c1').map((r) => r.assetVersion)).toEqual(ARRIVAL)
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
    migrateDown(db, 3) /* 0102, 0101, 0100 sort after 0037 */
    migrateDown(db, 1)
    const cols = (db.prepare('PRAGMA table_info(displays)').all() as { name: string }[]).map((c) => c.name)
    expect(cols).not.toContain('seq')
  })
})

describe('portable statements', () => {
  it('the default VAC-d is read from the parsed record, and follows an edit', () => {
    const db = fresh()
    db.prepare(`INSERT INTO display_types (id, touch_point, name, canvas_width, canvas_height, background_color, playlist_settings, qr_control, enabled_features, ph_extensions)
                VALUES ('dt', 'Digital Signage', 'DT', 1920, 1080, '#000000', '{}', '{}', '{}', ?)`).run(JSON.stringify({ defaultVacd: 12.5 }))
    expect(defaultVacd(db, 'dt')).toBe(12.5)
    db.prepare('UPDATE display_types SET ph_extensions = ? WHERE id = ?').run(JSON.stringify({ slots: [] }), 'dt')
    expect(defaultVacd(db, 'dt')).toBeNull()
    expect(defaultVacd(db, 'missing')).toBeNull()
  })

  it('personalised plays are counted with CASE, not a boolean SUM', async () => {
    const db = fresh()
    db.prepare("INSERT INTO displays (id, name, store, display_type_id) VALUES ('d1', 'd1', 'S', 'dt')").run()
    const play = db.prepare('INSERT INTO plays (id, display_id, campaign_id, played_at, duration_sec, tier) VALUES (?, ?, ?, ?, ?, ?)')
    play.run('p1', 'd1', 'c1', '2026-10-01T01:00:00.000Z', 10, 'personalised')
    play.run('p2', 'd1', 'c1', '2026-10-01T02:00:00.000Z', 10, null)
    play.run('p3', 'd1', 'c1', '2026-10-01T03:00:00.000Z', 5, 'personalised')
    const t = await sqlitePlaybackSource(db).totals({ campaignId: 'c1', displayTypeId: 'dt', from: '2026-10-01T00:00:00.000Z', to: '2026-10-02T00:00:00.000Z' })
    expect(t).toEqual({ plays: 3, playedSec: 25, personalised: { plays: 2, playedSec: 15 } })
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
