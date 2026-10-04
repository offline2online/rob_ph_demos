import { describe, expect, it } from 'vitest'
import { openDb } from '../src/db/db'
import { appliedVersions, loadMigrations, migrateDown, migrateUp } from '../src/db/migrate'

const tables = (db: ReturnType<typeof openDb>) =>
  (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name != 'schema_migrations' ORDER BY name").all() as { name: string }[]).map((r) => r.name)

describe('migrations', () => {
  it('every migration has a down script and versions are unique and ordered', () => {
    const ms = loadMigrations()
    expect(ms.length).toBeGreaterThanOrEqual(7)
    expect(new Set(ms.map((m) => m.version)).size).toBe(ms.length)
    expect(ms.map((m) => m.version)).toEqual([...ms.map((m) => m.version)].sort())
  })

  it('round-trips: up, all the way down, and up again', () => {
    const db = openDb(':memory:')
    migrateUp(db)
    const full = tables(db)
    expect(full).toEqual(expect.arrayContaining(['display_types', 'playlists', 'displays', 'campaigns', 'plays', 'partners', 'company_advertiser_settings', 'advertiser_settings', 'variable_access', 'exchange', 'campaign_assets', 'campaign_approvals', 'campaign_approval_audit']))
    migrateDown(db, loadMigrations().length)
    expect(tables(db)).toEqual([])
    expect(appliedVersions(db)).toEqual([])
    migrateUp(db)
    expect(tables(db)).toEqual(full)
  })

  it('reverts each migration one step at a time', () => {
    const db = openDb(':memory:')
    migrateUp(db)
    const n = loadMigrations().length
    for (let i = n; i > 0; i--) {
      expect(appliedVersions(db).length).toBe(i)
      migrateDown(db, 1)
    }
    expect(appliedVersions(db)).toEqual([])
  })

  it('is idempotent', () => {
    const db = openDb(':memory:')
    migrateUp(db)
    expect(migrateUp(db)).toEqual([])
  })

  /* 28 Sep 2026: 0029 (multi-zone layout owned by the default playlist)
     used to add the playlist column and drop the display type's without
     copying anything between them. Deployed onto a database that already
     held a zoned Menu Board, it turned it into a single-zone screen and left
     its zone playlists unused. The layout now travels with the migration. */
  it('0029 carries an existing multi-zone layout across to the default playlist', () => {
    const db = openDb(':memory:')
    migrateUp(db, '0028')
    const zones = JSON.stringify({ enabled: true, zones: [{ id: 'z1', name: 'Zone 1', playlistId: 'pl_z1' }, { id: 'z2', name: 'Zone 2', playlistId: 'pl_z2' }] })
    db.prepare("INSERT INTO playlists (id, name, auto_created_for, items) VALUES ('pl_menu', 'Menu Board Playlist', 'menu_board', '[]'), ('pl_other', 'Other', NULL, '[]')").run()
    db.prepare(`INSERT INTO display_types (id, touch_point, name, canvas_width, canvas_height, background_color, default_playlist_id, playlist_settings, qr_control, enabled_features, multi_zone)
                VALUES ('menu_board', 'Digital Signage', 'Menu Board', 5760, 1080, '#111111', 'pl_menu', '{}', '{}', '{}', ?)`).run(zones)
    expect(migrateUp(db)).toContain('0029_multi_zone_owned_by_playlist')
    const rows = db.prepare('SELECT id, multi_zone FROM playlists ORDER BY id').all() as { id: string; multi_zone: string | null }[]
    expect(rows).toEqual([{ id: 'pl_menu', multi_zone: zones }, { id: 'pl_other', multi_zone: null }])
    expect((db.prepare('PRAGMA table_info(display_types)').all() as { name: string }[]).map((c) => c.name)).not.toContain('multi_zone')
  })

  /* 2 Oct 2026 (pwGKh6gfIKq8O7A1ymP6): 0029's down dropped the playlist
     column without copying it back, so a rollback lost every display
     type's zoning. Up → down → up must keep it. */
  it('0029 down carries the layout back to the display type, and up again restores it', () => {
    const db = openDb(':memory:')
    migrateUp(db, '0028')
    const zones = JSON.stringify({ enabled: true, zones: [{ id: 'z1', name: 'Zone 1', playlistId: 'pl_z1' }] })
    db.prepare("INSERT INTO playlists (id, name, auto_created_for, items) VALUES ('pl_menu', 'Menu Board Playlist', 'menu_board', '[]')").run()
    db.prepare(`INSERT INTO display_types (id, touch_point, name, canvas_width, canvas_height, background_color, default_playlist_id, playlist_settings, qr_control, enabled_features, multi_zone)
                VALUES ('menu_board', 'Digital Signage', 'Menu Board', 5760, 1080, '#111111', 'pl_menu', '{}', '{}', '{}', ?)`).run(zones)
    migrateUp(db)
    migrateDown(db, appliedVersions(db).filter((v) => v >= '0029').length)
    expect(appliedVersions(db).at(-1)).toMatch(/^0028/)
    expect(db.prepare("SELECT multi_zone FROM display_types WHERE id = 'menu_board'").get()).toEqual({ multi_zone: zones })
    migrateUp(db)
    expect(db.prepare("SELECT multi_zone FROM playlists WHERE id = 'pl_menu'").get()).toEqual({ multi_zone: zones })
  })

  /* 0041: advertiser lists move from the company to each DSP, names → seat IDs.
     (Built as 0040 in parallel with 0040_dsp_creative_content_identity; renumbered.) */
  it('0041 carries company and DSP advertiser lists over as the DSP’s own seat IDs', () => {
    const db = openDb(':memory:')
    migrateUp(db, '0040')
    db.prepare("INSERT INTO company_advertiser_settings (id, advertiser_whitelist, advertiser_blacklist, updated_at) VALUES ('company', ?, ?, 'x')")
      .run(JSON.stringify(['Nestlé', ' swisse ', 'Gone Co']), JSON.stringify(['Red Bull', 'Swisse']))
    const seats = JSON.stringify([{ id: '1', name: 'Nestlé' }, { id: '2', name: 'Swisse' }])
    const ins = db.prepare("INSERT INTO partners (id, provider, name, status, mode, seats, lists_linked, allow_list, block_list, created_at, updated_at) VALUES (?, ?, ?, 'draft', 'test', ?, ?, ?, ?, 'x', 'x')")
    ins.run('linked', 'google_dv360', 'Linked', seats, 1, '[]', '[]')
    ins.run('own', 'amazon_dsp', 'Own', seats, 0, JSON.stringify(['2', 'Nestlé', 'Unknown']), JSON.stringify(['nestlé']))
    migrateUp(db)
    const row = (id: string) => db.prepare('SELECT allow_list, block_list FROM partners WHERE id = ?').get(id) as { allow_list: string; block_list: string }
    expect(JSON.parse(row('linked').allow_list).sort()).toEqual(['1', '2'])
    expect(JSON.parse(row('linked').block_list)).toEqual(['2'])
    expect(JSON.parse(row('own').allow_list).sort()).toEqual(['1', '2'])
    expect(JSON.parse(row('own').block_list)).toEqual(['1'])
    const cols = (db.prepare('PRAGMA table_info(company_advertiser_settings)').all() as { name: string }[]).map((c) => c.name)
    expect(cols).not.toContain('advertiser_whitelist')
    expect(cols).toContain('category_whitelist')
  })

  /* 0042: invited buyers become seats the DSPs synced. */
  it('0042 turns name- and seat-ID-typed invited buyers into synced seats and drops the rest', () => {
    const db = openDb(':memory:')
    migrateUp(db, '0041')
    const ins = db.prepare("INSERT INTO partners (id, provider, name, status, mode, seats, created_at, updated_at) VALUES (?, ?, ?, 'draft', 'test', ?, 'x', 'x')")
    ins.run('g', 'google_dv360', 'G', JSON.stringify([{ id: '1', name: 'Nestlé' }, { id: '2', name: 'Swisse' }]))
    ins.run('a', 'amazon_dsp', 'A', JSON.stringify([{ id: 'x9', name: ' nestlé ' }]))
    const invited = [
      { identifierType: 'brandEntity', value: 'Nestlé' }, { identifierType: 'dspSeatId', value: '2' },
      { identifierType: 'brandEntity', value: 'Unknown Co' }, { identifierType: 'other', value: 'Nestlé' },
    ]
    db.prepare("INSERT INTO buyers_lists (id, name, description, invited_buyers, created_at, updated_at) VALUES ('bl', 'L', '', ?, 'x', 'x')").run(JSON.stringify(invited))
    migrateUp(db)
    const got = JSON.parse((db.prepare("SELECT invited_buyers FROM buyers_lists WHERE id = 'bl'").get() as { invited_buyers: string }).invited_buyers) as { partnerId: string; seatId: string }[]
    expect(got.map((b) => `${b.partnerId}:${b.seatId}`).sort()).toEqual(['a:x9', 'g:1', 'g:2'])
  })
})
