/* Guardrail: additive changes only — records written in the existing shape
   (before this project's migrations) load unchanged afterwards, and
   reverting this project's migrations leaves them intact. */
import { describe, expect, it } from 'vitest'
import { openDb } from '../src/db/db'
import { loadMigrations, migrateDown, migrateUp } from '../src/db/migrate'
import { sqliteCampaignSource } from '../src/platform/CampaignSource'
import { sqliteDisplayTypeSource } from '../src/platform/DisplayTypeSource'

const legacyDisplayType = () => ({
  playlist_settings: JSON.stringify({ assetPosition: 'Center', assetFill: null, maximumCampaignsPlayedInRotation: 4, campaignTransition: 'Fade', campaignAutoRotation: null, campaignAutoPlay: null }),
  qr_control: JSON.stringify({ enabled: false, phantomArea: { enabled: false, width: 250, height: 250, position: null, sizingMode: 'Fit to Display' } }),
  enabled_features: JSON.stringify({ inStoreRadio: { enabled: true } }),
  multi_zone: JSON.stringify({ enabled: false, zones: [] }),
})

function legacyDb() {
  const db = openDb(':memory:')
  migrateUp(db, '0001')
  const l = legacyDisplayType()
  db.prepare(
    `INSERT INTO display_types (id, touch_point, name, description, canvas_width, canvas_height, background_color, default_playlist_id,
       playlist_settings, qr_control, enabled_features, multi_zone) VALUES ('legacy', 'Kiosk', 'Legacy Kiosk', 'Old', 1080, 1920, '#222222', 'pl_x', ?, ?, ?, ?)`,
  ).run(l.playlist_settings, l.qr_control, l.enabled_features, l.multi_zone)
  db.prepare("INSERT INTO campaigns (id, name, targeting, created_at) VALUES ('c_old', 'Old campaign', ?, '2025-01-01T00:00:00.000Z')").run(
    JSON.stringify([[{ source: 'store', variable: 'store.state', op: 'equal', values: ['NSW'] }]]),
  )
  return db
}

const expectedLegacy = {
  id: 'legacy', name: 'Legacy Kiosk', touchPoint: 'Kiosk', description: 'Old', displayCanvasSize: { width: 1080, height: 1920 },
  backgroundColor: '#222222', defaultPlaylistId: 'pl_x',
  playlistSettings: JSON.parse(legacyDisplayType().playlist_settings), qrControl: JSON.parse(legacyDisplayType().qr_control),
  enabledFeatures: JSON.parse(legacyDisplayType().enabled_features), multiZone: { enabled: false, zones: [] },
}

describe('existing records after this project migrations', () => {
  it('a display type written before phExtensions existed loads unchanged, with no phExtensions', () => {
    const db = legacyDb()
    migrateUp(db)
    expect(sqliteDisplayTypeSource(db).get('legacy')).toEqual(expectedLegacy)
  })

  it('an existing campaign loads with the additions defaulted (HQ-authored, not activated by this build)', () => {
    const db = legacyDb()
    migrateUp(db)
    const c = sqliteCampaignSource(db).getCampaign('c_old')
    expect(c).toMatchObject({ campaignId: 'c_old', name: 'Old campaign', source: 'hq', advertiserId: null, partnerId: null, pricingType: null })
    expect(c?.targeting).toEqual([[{ source: 'store', variable: 'store.state', op: 'equal', values: ['NSW'] }]])
  })

  it("reverting this project's migrations keeps the existing records intact", () => {
    const db = legacyDb()
    migrateUp(db)
    sqliteDisplayTypeSource(db).saveExtensions('legacy', { slots: [{ label: 'Slot 1', owner: 'internal' }] })
    migrateDown(db, loadMigrations().length - 1)
    const row = db.prepare("SELECT * FROM display_types WHERE id = 'legacy'").get() as Record<string, unknown>
    expect(row).not.toHaveProperty('ph_extensions')
    expect(row.name).toBe('Legacy Kiosk')
    expect(JSON.parse(row.playlist_settings as string)).toEqual(expectedLegacy.playlistSettings)
    expect(db.prepare("SELECT name FROM campaigns WHERE id = 'c_old'").get()).toEqual({ name: 'Old campaign' })
  })
})
