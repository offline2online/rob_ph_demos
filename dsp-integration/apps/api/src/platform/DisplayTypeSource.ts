/* Stand-in for the existing display type service. The API routes and
   everything this build adds read display types only through this
   interface, so engineering can swap in the real service. */
import type { DisplayType, DisplayTypeExtensions } from '@ph-dsp/types'
import { type Db, fromJson, toJson } from '../db/db'

export interface DisplayTypeSource {
  list(): DisplayType[]
  get(id: string): DisplayType | null
  create(dt: DisplayType): DisplayType
  /* Existing fields only; phExtensions is left as it is. */
  saveRecord(id: string, dt: DisplayType): DisplayType | null
  saveExtensions(id: string, ext: DisplayTypeExtensions): DisplayTypeExtensions | null
  delete(id: string): boolean
}

interface Row {
  id: string
  touch_point: string
  name: string
  description: string | null
  canvas_width: number
  canvas_height: number
  background_color: string
  default_playlist_id: string | null
  playlist_settings: string
  qr_control: string
  enabled_features: string
  multi_zone: string
  ph_extensions: string | null
}

const toRecord = (r: Row): DisplayType => {
  const out: DisplayType = {
    id: r.id,
    name: r.name,
    touchPoint: r.touch_point,
    description: r.description,
    displayCanvasSize: { width: r.canvas_width, height: r.canvas_height },
    backgroundColor: r.background_color,
    playlistSettings: fromJson(r.playlist_settings, {}),
    qrControl: fromJson(r.qr_control, {}),
    enabledFeatures: fromJson(r.enabled_features, {}),
    multiZone: fromJson(r.multi_zone, {}),
  }
  if (r.default_playlist_id !== null) out.defaultPlaylistId = r.default_playlist_id
  if (r.ph_extensions !== null) out.phExtensions = fromJson(r.ph_extensions, { slots: [] })
  return out
}

export function sqliteDisplayTypeSource(db: Db): DisplayTypeSource {
  const get = (id: string) => {
    const r = db.prepare('SELECT * FROM display_types WHERE id = ?').get(id) as Row | undefined
    return r ? toRecord(r) : null
  }
  const now = () => new Date().toISOString()
  return {
    list: () => (db.prepare('SELECT * FROM display_types ORDER BY rowid').all() as unknown as Row[]).map(toRecord),
    get,
    create(dt) {
      db.prepare(
        `INSERT INTO display_types (id, touch_point, name, description, canvas_width, canvas_height, background_color,
           default_playlist_id, playlist_settings, qr_control, enabled_features, multi_zone, ph_extensions, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        dt.id, dt.touchPoint, dt.name, dt.description ?? null, dt.displayCanvasSize.width, dt.displayCanvasSize.height,
        dt.backgroundColor ?? '#333333', dt.defaultPlaylistId ?? null, toJson(dt.playlistSettings) ?? '{}',
        toJson(dt.qrControl ?? {}) ?? '{}', toJson(dt.enabledFeatures ?? {}) ?? '{}', toJson(dt.multiZone ?? { enabled: false, zones: [] }) ?? '{}',
        toJson(dt.phExtensions), now(),
      )
      return get(dt.id) as DisplayType
    },
    saveRecord(id, dt) {
      const res = db.prepare(
        `UPDATE display_types SET touch_point = ?, name = ?, description = ?, canvas_width = ?, canvas_height = ?,
           background_color = ?, default_playlist_id = ?, playlist_settings = ?, qr_control = ?, enabled_features = ?,
           multi_zone = ?, updated_at = ? WHERE id = ?`,
      ).run(
        dt.touchPoint, dt.name, dt.description ?? null, dt.displayCanvasSize.width, dt.displayCanvasSize.height,
        dt.backgroundColor ?? '#333333', dt.defaultPlaylistId ?? null, toJson(dt.playlistSettings) ?? '{}',
        toJson(dt.qrControl ?? {}) ?? '{}', toJson(dt.enabledFeatures ?? {}) ?? '{}', toJson(dt.multiZone ?? {}) ?? '{}', now(), id,
      )
      return res.changes ? get(id) : null
    },
    saveExtensions(id, ext) {
      const res = db.prepare('UPDATE display_types SET ph_extensions = ?, updated_at = ? WHERE id = ?').run(toJson(ext), now(), id)
      return res.changes ? (get(id)?.phExtensions ?? null) : null
    },
    delete: (id) => db.prepare('DELETE FROM display_types WHERE id = ?').run(id).changes > 0,
  }
}
