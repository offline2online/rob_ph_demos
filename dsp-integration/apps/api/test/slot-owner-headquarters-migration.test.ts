/* Migration 0088 (Duy and Thuc, 26 Oct 2026): slot owners are headquarters and advertiser only. */
import { describe, expect, it } from 'vitest'
import { openDb } from '../src/db/db'
import { migrateDown, migrateUp } from '../src/db/migrate'

const slotsOf = (db: ReturnType<typeof openDb>, id: string) => (JSON.parse((db.prepare('SELECT ph_extensions FROM display_types WHERE id = ?').get(id) as { ph_extensions: string }).ph_extensions) as { slots: Record<string, unknown>[] }).slots
const slot = (label: string, owner: string, over: Record<string, unknown> = {}) => ({ label, owner, partnerIds: [], advertisers: [], listMode: null, storeScope: null, quota: null, zoneId: null, ...over })
const insert = (db: ReturnType<typeof openDb>, id: string, slots: unknown[]) =>
  db.prepare(`INSERT INTO display_types (id, touch_point, name, canvas_width, canvas_height, background_color, playlist_settings, qr_control, enabled_features, ph_extensions, updated_at)
              VALUES (?, 'Digital Signage', ?, 1920, 1080, '#111111', '{}', '{}', '{}', ?, 'before')`).run(id, id, JSON.stringify({ slots, venue: { loopLengthSec: 20 } }))

function seeded() {
  const db = openDb(':memory:')
  migrateUp(db, '0087')
  insert(db, 'menu_board', [slot('Priority 1', 'internal'), slot('Supplier slot', 'advertiser', { listMode: 'rtb' }), slot('Store choice', 'retail', { storeScope: 'Store staff' })])
  insert(db, 'landscape', [slot('Ad', 'advertiser', { listMode: 'rtb' })])
  return db
}

describe('0088 slot owner headquarters', () => {
  it('turns internal and retail slots into headquarters, keeping order and everything else', () => {
    const db = seeded()
    expect(migrateUp(db)).toContain('0088_slot_owner_headquarters')
    expect(slotsOf(db, 'menu_board')).toEqual([slot('Priority 1', 'headquarters'), slot('Supplier slot', 'advertiser', { listMode: 'rtb' }), slot('Store choice', 'headquarters')])
    expect(slotsOf(db, 'landscape')).toEqual([slot('Ad', 'advertiser', { listMode: 'rtb' })])
    expect((db.prepare("SELECT updated_at FROM display_types WHERE id = 'landscape'").get() as { updated_at: string }).updated_at).toBe('before')
  })

  it('down puts back internal on headquarters slots', () => {
    const db = seeded()
    /* Up to 0088 only, so it is the last applied (later-numbered migrations come from other packages). */
    migrateUp(db, '0088')
    expect(migrateDown(db)).toEqual(['0088_slot_owner_headquarters'])
    expect(slotsOf(db, 'menu_board').map((s) => s.owner)).toEqual(['internal', 'advertiser', 'internal'])
  })
})
