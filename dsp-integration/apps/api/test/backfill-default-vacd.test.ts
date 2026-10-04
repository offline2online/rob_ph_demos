import { describe, expect, it } from 'vitest'
import { openDb } from '../src/db/db'
import { loadMigrations, migrateUp } from '../src/db/migrate'

/* Zones live on the type's playlist and carry no VAC-d: the slots' zoneId is all the type row holds. */
const mk = (db: ReturnType<typeof openDb>, id: string, touchPoint: string, ext: unknown) =>
  db.prepare("INSERT INTO display_types (id, touch_point, name, canvas_width, canvas_height, background_color, playlist_settings, qr_control, enabled_features, ph_extensions) VALUES (?, ?, ?, 1, 1, '#000', '{}', '{}', '{}', ?)")
    .run(id, touchPoint, id, ext === null ? null : JSON.stringify(ext))

describe('migration 0044', () => {
  it('back-fills 300 on types with no default, leaves the rest, and is idempotent', () => {
    const db = openDb(':memory:')
    migrateUp(db, '0043')
    mk(db, 'none', 'Digital Signage', null)
    mk(db, 'noDefault', 'Kiosk', { slots: [{ label: 'Ad', owner: 'advertiser' }] })
    mk(db, 'zoned', 'Digital Signage', { slots: [{ label: 'A', zoneId: 'z1' }, { label: 'B', zoneId: 'z2' }] })
    mk(db, 'set', 'Digital Signage', { slots: [], defaultVacd: 120, defaultVacdSource: 'computer_vision' })
    mk(db, 'zero', 'Digital Signage', { slots: [], defaultVacd: 0 })
    mk(db, 'web', 'Website', { slots: [] })
    migrateUp(db)
    const ext = (id: string) => JSON.parse((db.prepare('SELECT ph_extensions e FROM display_types WHERE id = ?').get(id) as { e: string }).e)
    expect(ext('none').defaultVacd).toBe(300)
    expect(ext('noDefault')).toMatchObject({ defaultVacd: 300, slots: [{ label: 'Ad' }] })
    expect(ext('zoned').defaultVacd).toBe(300)
    expect(ext('set')).toMatchObject({ defaultVacd: 120, defaultVacdSource: 'computer_vision' })
    expect(ext('zero').defaultVacd).toBe(0)
    expect((db.prepare('SELECT ph_extensions e FROM display_types WHERE id = ?').get('web') as { e: string }).e).toBe('{"slots":[]}')
    expect(loadMigrations().some((m) => m.version === '0044')).toBe(true)
  })
})
