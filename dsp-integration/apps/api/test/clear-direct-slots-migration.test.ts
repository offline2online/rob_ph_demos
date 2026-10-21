/* Migration 0082 (ticket mpbRDjAPS4uIagi2IVsz): no slot holds a direct advertiser outside a deal. */
import { describe, expect, it } from 'vitest'
import { openDb } from '../src/db/db'
import { migrateUp } from '../src/db/migrate'
import { releaseSettledSlotLocks } from '../src/domain/slotLock'
import { NOW, testContext } from './helpers'

const slotsOf = (db: ReturnType<typeof openDb>, id: string) => (JSON.parse((db.prepare('SELECT ph_extensions FROM display_types WHERE id = ?').get(id) as { ph_extensions: string }).ph_extensions) as { slots: Record<string, unknown>[] }).slots
const slot = (label: string, over: Record<string, unknown> = {}) => ({ label, owner: 'advertiser', partnerIds: [], advertisers: [], listMode: 'rtb', buyersListId: null, buyersListIds: [], openAuction: false, storeScope: null, quota: null, zoneId: null, ...over })

function seeded() {
  const db = openDb(':memory:')
  migrateUp(db, '0081')
  db.prepare("INSERT INTO direct_advertisers (advertiser_id, name, created_at) VALUES ('red-bull', 'Red Bull', 'x'), ('gatorade', 'Gatorade', 'x'), ('nestle-direct', 'Nestlé', 'x')").run()
  /* Nestlé is also a DSP seat, so it is a DSP advertiser and stays assignable. */
  db.prepare("INSERT INTO partners (id, provider, name, seats, created_at, updated_at) VALUES ('p_x', 'google_dv360', 'X', '[{\"id\":\"s1\",\"name\":\"Nestlé\"}]', 'x', 'x')").run()
  const slots = [
    slot('Only direct', { advertisers: ['Red Bull', 'Gatorade'], listMode: null }),
    slot('Mixed', { advertisers: ['Red Bull', 'Nestlé'], listMode: null }),
    slot('Sold', { advertisers: ['Gatorade'], listMode: null }),
    slot('Plain'),
  ]
  db.prepare(`INSERT INTO display_types (id, touch_point, name, canvas_width, canvas_height, background_color, playlist_settings, qr_control, enabled_features, ph_extensions)
              VALUES ('portrait', 'Digital Signage', 'Portrait', 1080, 1920, '#111111', '{}', '{}', '{}', ?)`).run(JSON.stringify({ slots, venue: { loopLengthSec: 20 } }))
  db.prepare("INSERT INTO reservations (id, partner_id, advertiser_id, campaign_id, position_id, window_start, type, currency, status, test_mode, created_at, updated_at) VALUES ('r1', 'direct', 'gatorade', NULL, 'portrait.s3', ?, 'reserve', 'AUD', 'reserved', 0, 'x', 'x')").run(new Date(Date.now() + 86_400_000).toISOString())
  return db
}

describe('0082 clear direct slot assignments', () => {
  it('removes direct advertisers, keeps DSP advertisers, locks a sold slot and records it in the change history', () => {
    const db = seeded()
    expect(migrateUp(db)).toContain('0082_clear_direct_slot_assignments')
    const s = slotsOf(db, 'portrait')
    expect(s[0]).toMatchObject({ advertisers: [], listMode: 'rtb', buyersListId: null, buyersListIds: [], openAuction: false })
    expect(s[1]).toMatchObject({ advertisers: ['Nestlé'], listMode: null })
    expect(s[2]).toMatchObject({ advertisers: ['Gatorade'], salesLocked: true })
    expect(s[3]).toEqual(slot('Plain'))
    expect(slotsOf(db, 'portrait')).toHaveLength(4)
    const audit = db.prepare("SELECT field, old_value, new_value, actor_type FROM ssp_audit_log WHERE actor_id = 'migration-0082' ORDER BY field").all() as { field: string; old_value: string | null; new_value: string | null; actor_type: string }[]
    expect(audit.map((a) => a.field)).toEqual(['slots[1].advertisers', 'slots[1].listMode', 'slots[2].advertisers', 'slots[3].salesLocked'])
    expect(audit[0]).toMatchObject({ old_value: '["Red Bull","Gatorade"]', new_value: '[]', actor_type: 'agent' })
    expect(audit[2]).toMatchObject({ old_value: '["Red Bull","Nestlé"]', new_value: '["Nestlé"]' })
    /* Re-running finds nothing left to clear. */
    db.prepare("DELETE FROM schema_migrations WHERE version = '0082'").run()
    const before = (db.prepare('SELECT count(*) AS n FROM ssp_audit_log').get() as { n: number }).n
    migrateUp(db)
    expect(slotsOf(db, 'portrait')[2]).toMatchObject({ advertisers: ['Gatorade'], salesLocked: true })
    expect((db.prepare('SELECT count(*) AS n FROM ssp_audit_log').get() as { n: number }).n).toBe(before + 1)
  })

  it('does nothing on a database with no direct assignments', () => {
    const db = openDb(':memory:')
    migrateUp(db)
    expect((db.prepare("SELECT count(*) AS n FROM ssp_audit_log WHERE actor_id = 'migration-0082'").get() as { n: number }).n).toBe(0)
  })

  it('a locked slot loses its direct advertiser when its bookings have played', async () => {
    const ctx = await testContext({ clock: () => NOW })
    await ctx.company.addDirectAdvertiser('red-bull', 'Red Bull')
    const ext = (await ctx.displayTypes.get('portrait'))!.phExtensions!
    await ctx.displayTypes.saveExtensions('portrait', { ...ext, slots: [slot('Ad', { advertisers: ['Red Bull'], listMode: null, salesLocked: true }) as never] })
    expect(await releaseSettledSlotLocks(ctx)).toBe(1)
    expect((await ctx.displayTypes.get('portrait'))!.phExtensions!.slots[0]).toMatchObject({ advertisers: [], listMode: 'rtb' })
    expect((await ctx.displayTypes.get('portrait'))!.phExtensions!.slots[0].salesLocked).toBeUndefined()
  })
})
