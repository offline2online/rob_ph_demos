/* Stand-in for the existing display type service. The API routes and
   everything this build adds read display types only through this
   interface, so engineering can swap in the real service. */
import type { DisplayType, DisplayTypeExtensions } from '@ph-dsp/types'
import { type Db, fromJson, prepared, toJson } from '../db/db'

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

/* Deep-freeze a cached record: callers share it, so one must never be able
   to change what every other request sees. (Every caller builds a new
   object — `{ ...ext, slots: … }` — rather than mutating; freezing keeps it
   that way, and a slip fails loudly in the tests instead of silently.) */
const deepFreeze = <T>(o: T): T => {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o)
    for (const v of Object.values(o as object)) deepFreeze(v)
  }
  return o
}

/* Performance note (review, 23 Sep 2026). Every Partner API request and
   every auction position starts from the display types (allPositions), and
   turning each row back into a record parses five JSON columns. On a large
   estate (250 display types) that was most of a request's time. Display
   types change only when an admin saves one, through this source, so the
   parsed list is kept as a snapshot that every write here replaces, and
   that also expires after SNAPSHOT_TTL_MS so a change made by another
   process (or, on the platform, another instance) is seen within that time.
   On integration the real display type service decides its own caching;
   the contract (PH-CORE-BOUNDARIES.md) only asks that list() be cheap. */
export const SNAPSHOT_TTL_MS = 1_000

export function sqliteDisplayTypeSource(db: Db): DisplayTypeSource {
  let snap: { at: number; list: DisplayType[]; byId: Map<string, DisplayType> } | null = null
  const snapshot = () => {
    if (!snap || Date.now() - snap.at > SNAPSHOT_TTL_MS) {
      const list = (prepared(db, 'SELECT * FROM display_types ORDER BY rowid').all() as unknown as Row[]).map((r) => deepFreeze(toRecord(r)))
      snap = { at: Date.now(), list, byId: new Map(list.map((dt) => [dt.id, dt])) }
    }
    return snap
  }
  const invalidate = () => { snap = null }
  const get = (id: string) => snapshot().byId.get(id) ?? null
  const now = () => new Date().toISOString()
  return {
    /* A copy of the array (callers sort and filter it); the records are shared and frozen. */
    list: () => [...snapshot().list],
    get,
    create(dt) {
      prepared(db,
        `INSERT INTO display_types (id, touch_point, name, description, canvas_width, canvas_height, background_color,
           default_playlist_id, playlist_settings, qr_control, enabled_features, multi_zone, ph_extensions, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        dt.id, dt.touchPoint, dt.name, dt.description ?? null, dt.displayCanvasSize.width, dt.displayCanvasSize.height,
        dt.backgroundColor ?? '#333333', dt.defaultPlaylistId ?? null, toJson(dt.playlistSettings) ?? '{}',
        toJson(dt.qrControl ?? {}) ?? '{}', toJson(dt.enabledFeatures ?? {}) ?? '{}', toJson(dt.multiZone ?? { enabled: false, zones: [] }) ?? '{}',
        toJson(dt.phExtensions), now(),
      )
      invalidate()
      return get(dt.id) as DisplayType
    },
    saveRecord(id, dt) {
      const res = prepared(db,
        `UPDATE display_types SET touch_point = ?, name = ?, description = ?, canvas_width = ?, canvas_height = ?,
           background_color = ?, default_playlist_id = ?, playlist_settings = ?, qr_control = ?, enabled_features = ?,
           multi_zone = ?, updated_at = ? WHERE id = ?`,
      ).run(
        dt.touchPoint, dt.name, dt.description ?? null, dt.displayCanvasSize.width, dt.displayCanvasSize.height,
        dt.backgroundColor ?? '#333333', dt.defaultPlaylistId ?? null, toJson(dt.playlistSettings) ?? '{}',
        toJson(dt.qrControl ?? {}) ?? '{}', toJson(dt.enabledFeatures ?? {}) ?? '{}', toJson(dt.multiZone ?? {}) ?? '{}', now(), id,
      )
      invalidate()
      return res.changes ? get(id) : null
    },
    saveExtensions(id, ext) {
      const res = prepared(db, 'UPDATE display_types SET ph_extensions = ?, updated_at = ? WHERE id = ?').run(toJson(ext), now(), id)
      invalidate()
      return res.changes ? (get(id)?.phExtensions ?? null) : null
    },
    delete(id) {
      const gone = prepared(db, 'DELETE FROM display_types WHERE id = ?').run(id).changes > 0
      invalidate()
      return gone
    },
  }
}
