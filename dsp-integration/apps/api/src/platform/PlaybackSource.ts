/* Stand-in for the existing playback data. Read only: this build reads it
   for billing reconciliation and never writes or reports on it. */
import { type Db, prepared } from '../db/db'

export interface PlayRecord { displayId: string; campaignId: string; playedAt: string; durationSec: number }

export interface PlaybackSource {
  listPlays(q: { campaignId?: string; from: string; to: string }): PlayRecord[]
}

interface Row { display_id: string; campaign_id: string; played_at: string; duration_sec: number }

export const sqlitePlaybackSource = (db: Db): PlaybackSource => ({
  listPlays({ campaignId, from, to }) {
    const rows = (campaignId
      ? prepared(db, 'SELECT * FROM plays WHERE campaign_id = ? AND played_at >= ? AND played_at < ? ORDER BY played_at').all(campaignId, from, to)
      : prepared(db, 'SELECT * FROM plays WHERE played_at >= ? AND played_at < ? ORDER BY played_at').all(from, to)) as unknown as Row[]
    return rows.map((r) => ({ displayId: r.display_id, campaignId: r.campaign_id, playedAt: r.played_at, durationSec: r.duration_sec }))
  },
})
