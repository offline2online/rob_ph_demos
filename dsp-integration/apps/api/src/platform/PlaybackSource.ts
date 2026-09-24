/* Stand-in for the existing playback data. Read only: this build reads it
   for billing reconciliation and never writes or reports on it. */
import { type Db, prepared } from '../db/db'

export interface PlayRecord { displayId: string; campaignId: string; playedAt: string; durationSec: number }
export interface PlayTotals { plays: number; playedSec: number }

export interface PlaybackSource {
  listPlays(q: { campaignId?: string; from: string; to: string }): PlayRecord[]
  /* A campaign's plays on the displays of one display type in a window,
     as a count and a total duration — aggregated where the plays are
     stored, never read row by row. Billing asks this once per sold window
     (scalability review, 24 Sep 2026): a window on 1,000 displays is 1.9
     million plays, which listPlays turned into 1.9 million objects and
     23 seconds of the API's one thread. On integration the platform's
     playback store answers this from its own aggregates. */
  totals(q: { campaignId: string; displayTypeId: string; from: string; to: string }): PlayTotals
}

interface Row { display_id: string; campaign_id: string; played_at: string; duration_sec: number }

export const sqlitePlaybackSource = (db: Db): PlaybackSource => ({
  listPlays({ campaignId, from, to }) {
    const rows = (campaignId
      ? prepared(db, 'SELECT * FROM plays WHERE campaign_id = ? AND played_at >= ? AND played_at < ? ORDER BY played_at').all(campaignId, from, to)
      : prepared(db, 'SELECT * FROM plays WHERE played_at >= ? AND played_at < ? ORDER BY played_at').all(from, to)) as unknown as Row[]
    return rows.map((r) => ({ displayId: r.display_id, campaignId: r.campaign_id, playedAt: r.played_at, durationSec: r.duration_sec }))
  },
  totals({ campaignId, displayTypeId, from, to }) {
    /* Answered from the covering index plays (campaign_id, played_at,
       display_id, duration_sec) (migration 0025), keeping only plays on the
       display type's own displays. Measured on 1.9 million plays: 0.5 s
       this way, 0.6 s as a join, 17 s as rows into JavaScript. */
    const r = prepared(db,
      `SELECT COUNT(*) AS plays, COALESCE(SUM(duration_sec), 0) AS played_sec
         FROM plays
        WHERE campaign_id = ? AND played_at >= ? AND played_at < ?
          AND display_id IN (SELECT id FROM displays WHERE display_type_id = ?)`,
    ).get(campaignId, from, to, displayTypeId) as { plays: number; played_sec: number }
    return { plays: r.plays, playedSec: r.played_sec }
  },
})
