/* Stand-in for the existing playlist service. Items, scenes and scheduling
   are existing platform data: stored and passed through, never changed. */
import { type Db, fromJson, prepared, toJson, type Awaitable } from '../db/db'

export interface PlaylistRecord {
  id: string
  name: string
  autoCreatedFor: string | null
  schedule: unknown
  items: { campaignId: string; playbackDuration: number; enabled?: boolean; [k: string]: unknown }[]
  /* This playlist's own settings (Asset Position/Fill, Campaign Transition,
     Auto-Rotation, Auto-Play) — null values mean inherit. Maximum Campaigns
     Played In Rotation and slot assignment stay on the display type(s) it is
     assigned to (DisplayTypeSource): those size and sell that specific
     screen's positions, not the playlist's content (26 Sep 2026). */
  playlistSettings: Record<string, unknown>
}

export interface PlaylistSource {
  list(): Awaitable<PlaylistRecord[]>
  get(id: string): Awaitable<PlaylistRecord | null>
  create(p: Pick<PlaylistRecord, 'id' | 'name' | 'autoCreatedFor'> & Partial<PlaylistRecord>): Awaitable<PlaylistRecord>
  rename(id: string, name: string): Awaitable<PlaylistRecord | null>
  saveSettings(id: string, settings: Record<string, unknown>): Awaitable<PlaylistRecord | null>
  delete(id: string): Awaitable<boolean>
}

interface Row { id: string; name: string; auto_created_for: string | null; schedule: string | null; items: string; playlist_settings: string | null }
const toRecord = (r: Row): PlaylistRecord => ({
  id: r.id, name: r.name, autoCreatedFor: r.auto_created_for, schedule: fromJson(r.schedule, null), items: fromJson(r.items, []),
  playlistSettings: fromJson(r.playlist_settings, {}),
})

/* Loop length, for inventory display and VAC-d billing only. */
export const loopLengthSec = (p: PlaylistRecord | null) =>
  (p?.items ?? []).filter((i) => i.enabled !== false).reduce((s, i) => s + (Number(i.playbackDuration) || 0), 0)

export function sqlitePlaylistSource(db: Db): PlaylistSource {
  const get = (id: string) => {
    const r = prepared(db, 'SELECT * FROM playlists WHERE id = ?').get(id) as Row | undefined
    return r ? toRecord(r) : null
  }
  return {
    list: () => (prepared(db, 'SELECT * FROM playlists ORDER BY seq').all() as unknown as Row[]).map(toRecord),
    get,
    create(p) {
      prepared(db, 'INSERT INTO playlists (id, name, auto_created_for, schedule, items, playlist_settings) VALUES (?, ?, ?, ?, ?, ?)').run(
        p.id, p.name, p.autoCreatedFor ?? null, toJson(p.schedule ?? { mode: 'store_hours', from: null, to: null }), toJson(p.items ?? []) ?? '[]',
        toJson(p.playlistSettings ?? {}) ?? '{}',
      )
      return get(p.id) as PlaylistRecord
    },
    rename(id, name) {
      return prepared(db, 'UPDATE playlists SET name = ? WHERE id = ?').run(name, id).changes ? get(id) : null
    },
    saveSettings(id, settings) {
      return prepared(db, 'UPDATE playlists SET playlist_settings = ? WHERE id = ?').run(toJson(settings) ?? '{}', id).changes ? get(id) : null
    },
    delete: (id) => prepared(db, 'DELETE FROM playlists WHERE id = ?').run(id).changes > 0,
  }
}
