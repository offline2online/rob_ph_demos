/* Stand-in for the existing playlist service. Items, scenes and scheduling
   are existing platform data: stored and passed through, never changed. */
import { type Db, fromJson, prepared, toJson } from '../db/db'

export interface PlaylistRecord {
  id: string
  name: string
  autoCreatedFor: string | null
  schedule: unknown
  items: { campaignId: string; playbackDuration: number; enabled?: boolean; [k: string]: unknown }[]
}

export interface PlaylistSource {
  list(): PlaylistRecord[]
  get(id: string): PlaylistRecord | null
  create(p: Pick<PlaylistRecord, 'id' | 'name' | 'autoCreatedFor'> & Partial<PlaylistRecord>): PlaylistRecord
  rename(id: string, name: string): PlaylistRecord | null
  delete(id: string): boolean
}

interface Row { id: string; name: string; auto_created_for: string | null; schedule: string | null; items: string }
const toRecord = (r: Row): PlaylistRecord => ({
  id: r.id, name: r.name, autoCreatedFor: r.auto_created_for, schedule: fromJson(r.schedule, null), items: fromJson(r.items, []),
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
    list: () => (prepared(db, 'SELECT * FROM playlists ORDER BY rowid').all() as unknown as Row[]).map(toRecord),
    get,
    create(p) {
      prepared(db, 'INSERT INTO playlists (id, name, auto_created_for, schedule, items) VALUES (?, ?, ?, ?, ?)').run(
        p.id, p.name, p.autoCreatedFor ?? null, toJson(p.schedule ?? { mode: 'store_hours', from: null, to: null }), toJson(p.items ?? []) ?? '[]',
      )
      return get(p.id) as PlaylistRecord
    },
    rename(id, name) {
      return prepared(db, 'UPDATE playlists SET name = ? WHERE id = ?').run(name, id).changes ? get(id) : null
    },
    delete: (id) => prepared(db, 'DELETE FROM playlists WHERE id = ?').run(id).changes > 0,
  }
}
