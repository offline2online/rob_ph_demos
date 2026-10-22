/* Migration 0086 (ticket QdMaGvVhMZgcdcmIAalT): no buyer of any kind is named on a slot; slots are sold through deals. */
import { describe, expect, it } from 'vitest'
import { openDb } from '../src/db/db'
import { migrateUp } from '../src/db/migrate'
import { releaseSettledSlotLocks } from '../src/domain/slotLock'
import { sqliteSspAuditRepo } from '../src/repos/SspAuditRepo'
import { NOW, testContext } from './helpers'

const slotsOf = (db: ReturnType<typeof openDb>, id: string) => (JSON.parse((db.prepare('SELECT ph_extensions FROM display_types WHERE id = ?').get(id) as { ph_extensions: string }).ph_extensions) as { slots: Record<string, unknown>[] }).slots
const slot = (label: string, over: Record<string, unknown> = {}) => ({ label, owner: 'advertiser', partnerIds: [], advertisers: [], listMode: 'rtb', buyersListId: null, buyersListIds: [], openAuction: false, storeScope: null, quota: null, zoneId: null, ...over })

function seeded() {
  const db = openDb(':memory:')
  migrateUp(db, '0085')
  const slots = [
    slot('DSP advertiser', { partnerIds: ['p_google'], advertisers: ['Nestlé'], listMode: null }),
    slot('Several', { advertisers: ['Red Bull', 'Nestlé'], listMode: null }),
    slot('Sold', { advertisers: ['Nestlé'], listMode: null }),
    slot('Sold and already locked', { advertisers: ['Nestlé'], listMode: null, salesLocked: true }),
    slot('Plain'),
  ]
  db.prepare(`INSERT INTO display_types (id, touch_point, name, canvas_width, canvas_height, background_color, playlist_settings, qr_control, enabled_features, ph_extensions)
              VALUES ('landscape', 'Digital Signage', 'Landscape', 1920, 1080, '#111111', '{}', '{}', '{}', ?)`).run(JSON.stringify({ slots, venue: { loopLengthSec: 20 } }))
  const future = new Date(Date.now() + 86_400_000).toISOString()
  for (const n of [3, 4]) db.prepare("INSERT INTO reservations (id, partner_id, advertiser_id, campaign_id, position_id, window_start, type, currency, status, test_mode, created_at, updated_at) VALUES (?, 'p_google', 'nestle', NULL, ?, ?, 'reserve', 'AUD', 'reserved', 0, 'x', 'x')").run(`r${n}`, `landscape.s${n}`, future)
  return db
}

describe('0086 clear named slot assignments', () => {
  it('removes every named advertiser, locks a sold slot and records it in the change history', () => {
    const db = seeded()
    expect(migrateUp(db)).toContain('0086_clear_named_slot_assignments')
    const s = slotsOf(db, 'landscape')
    expect(s[0]).toMatchObject({ advertisers: [], listMode: 'rtb', buyersListId: null, buyersListIds: [], openAuction: false })
    expect(s[1]).toMatchObject({ advertisers: [], listMode: 'rtb' })
    expect(s[2]).toMatchObject({ advertisers: ['Nestlé'], salesLocked: true })
    expect(s[3]).toMatchObject({ advertisers: ['Nestlé'], salesLocked: true })
    expect(s[4]).toEqual(slot('Plain'))
    expect(s).toHaveLength(5)
    const audit = db.prepare("SELECT field, old_value, new_value, actor_type FROM ssp_audit_log WHERE actor_id = 'migration-0086' ORDER BY field").all() as { field: string; old_value: string | null; new_value: string | null; actor_type: string }[]
    expect(audit.map((a) => a.field)).toEqual(['slots[1].advertisers', 'slots[1].listMode', 'slots[2].advertisers', 'slots[2].listMode', 'slots[3].salesLocked'])
    expect(audit[0]).toMatchObject({ old_value: '["Nestlé"]', new_value: '[]', actor_type: 'agent' })
    expect(audit[2]).toMatchObject({ old_value: '["Red Bull","Nestlé"]', new_value: '[]' })
    /* The change history reads every row back (JSON text, never a bare string). */
    const read = (sqliteSspAuditRepo(db).query({}) as { items: { field: string; oldValue: unknown; newValue: unknown }[] }).items.filter((e) => e.field.startsWith('slots['))
    expect(read).toHaveLength(5)
    expect(read.find((e) => e.field === 'slots[1].listMode')).toMatchObject({ oldValue: null, newValue: 'rtb' })
    expect(read.find((e) => e.field === 'slots[2].advertisers')).toMatchObject({ oldValue: ['Red Bull', 'Nestlé'], newValue: [] })
    expect(read.find((e) => e.field === 'slots[3].salesLocked')).toMatchObject({ oldValue: null, newValue: true })
    /* Re-running finds nothing new to clear: the locked slots are logged once. */
    db.prepare("DELETE FROM schema_migrations WHERE version = '0086'").run()
    migrateUp(db)
    expect(slotsOf(db, 'landscape')[2]).toMatchObject({ advertisers: ['Nestlé'], salesLocked: true })
    expect((db.prepare("SELECT count(*) AS n FROM ssp_audit_log WHERE actor_id = 'migration-0086'").get() as { n: number }).n).toBe(5)
  })

  it('does nothing on a database with no named advertisers', () => {
    const db = openDb(':memory:')
    migrateUp(db)
    expect((db.prepare("SELECT count(*) AS n FROM ssp_audit_log WHERE actor_id = 'migration-0086'").get() as { n: number }).n).toBe(0)
  })

  it('a locked slot loses its named advertiser when its bookings have played', async () => {
    const ctx = await testContext({ clock: () => NOW })
    const ext = (await ctx.displayTypes.get('portrait'))!.phExtensions!
    await ctx.displayTypes.saveExtensions('portrait', { ...ext, slots: [slot('Ad', { advertisers: ['Nestlé'], listMode: null, salesLocked: true }) as never] })
    expect(await releaseSettledSlotLocks(ctx)).toBe(1)
    expect((await ctx.displayTypes.get('portrait'))!.phExtensions!.slots[0]).toMatchObject({ advertisers: [], listMode: 'rtb' })
    expect((await ctx.displayTypes.get('portrait'))!.phExtensions!.slots[0].salesLocked).toBeUndefined()
  })
})
