/* Stand-in for the existing playback data. Read only: this build reads it
   for billing reconciliation and never writes or reports on it. */
import { type Db, prepared, type Awaitable } from '../db/db'

/* Which version of the campaign a play showed (Rob, 30 Sep 2026): the
   default, a localised one or a personalised one. Only PH Core's playback
   data can say, so this is a requirement on it (api/PH-CORE-BOUNDARIES.md,
   "Playback"); the stand-in carries it nullable. null = not known, billed as
   a default or localised play, exactly as before the field existed. */
export type PlayTier = 'default' | 'localised' | 'personalised'
export interface PlayRecord { displayId: string; campaignId: string; playedAt: string; durationSec: number; versionId?: string | null; tier?: PlayTier | null }
/* A play as the platform received it (Rob, 4 Oct 2026, settlement is final):
   receivedAt is when the platform got it, distinct from playedAt. null = not
   reported, treated as known at settlement (billed, never late). */
export interface ReceivedPlay extends PlayRecord { id: string; receivedAt: string | null }
/* plays / playedSec are every play, whatever tier played: all of them bill at
   the clearing CPM (Rob, 5 Oct 2026). The tier is kept on the play for reporting only. */
export interface PlayTotals {
  plays: number; playedSec: number
  /* Plays per campaign version shown (versionId; null = not reported),
     ordered by versionId. The audit trail for "plays the version it was
     handed" (contract v3.1 row 3): reported on the line item, never priced. */
  byVersion?: { versionId: string | null; plays: number }[]
}

export interface PlaybackSource {
  listPlays(q: { campaignId?: string; from: string; to: string }): Awaitable<PlayRecord[]>
  /* A campaign's plays on the displays of one display type in a window,
     as a count and a total duration — aggregated where the plays are
     stored, never read row by row. `receivedBy` is the settlement cut-off:
     only plays received at or before it (or with no received-at time) count,
     so playback that arrives after a window's invoice is written is not
     billed (spec §4 "Billing"). Billing asks this once per sold window
     (scalability review, 24 Sep 2026): a window on 1,000 displays is 1.9
     million plays, which listPlays turned into 1.9 million objects and
     23 seconds of the API's one thread. On integration the platform's
     playback store answers this from its own aggregates. */
  totals(q: { campaignId: string; displayTypeId: string; from: string; to: string; receivedBy?: string }): Awaitable<PlayTotals>
  /* Plays the platform received from `since` (inclusive) up to `upTo`
     (inclusive), oldest received first, at most `limit`, starting after the
     (receivedAt, id) cursor when one is given. The late-play ledger reads
     what arrived since its last scan with this; plays with no received-at
     time are never returned (they cannot be late). */
  receivedBetween(q: { since: string; upTo: string; after?: { receivedAt: string; id: string }; limit: number }): Awaitable<ReceivedPlay[]>
}

interface Row { display_id: string; campaign_id: string; played_at: string; duration_sec: number; version_id: string | null; tier: PlayTier | null }

export const sqlitePlaybackSource = (db: Db): PlaybackSource => ({
  listPlays({ campaignId, from, to }) {
    const rows = (campaignId
      ? prepared(db, 'SELECT * FROM plays WHERE campaign_id = ? AND played_at >= ? AND played_at < ? ORDER BY played_at').all(campaignId, from, to)
      : prepared(db, 'SELECT * FROM plays WHERE played_at >= ? AND played_at < ? ORDER BY played_at').all(from, to)) as unknown as Row[]
    return rows.map((r) => ({ displayId: r.display_id, campaignId: r.campaign_id, playedAt: r.played_at, durationSec: r.duration_sec, versionId: r.version_id, tier: r.tier }))
  },
  receivedBetween({ since, upTo, after, limit }) {
    const rows = (after
      ? prepared(db, `SELECT * FROM plays WHERE received_at IS NOT NULL AND received_at >= ? AND received_at <= ?
                        AND (received_at > ? OR (received_at = ? AND id > ?)) ORDER BY received_at, id LIMIT ?`).all(since, upTo, after.receivedAt, after.receivedAt, after.id, limit)
      : prepared(db, 'SELECT * FROM plays WHERE received_at IS NOT NULL AND received_at >= ? AND received_at <= ? ORDER BY received_at, id LIMIT ?').all(since, upTo, limit)) as unknown as (Row & { id: string; received_at: string })[]
    return rows.map((r) => ({ id: r.id, displayId: r.display_id, campaignId: r.campaign_id, playedAt: r.played_at, durationSec: r.duration_sec, versionId: r.version_id, tier: r.tier, receivedAt: r.received_at }))
  },
  totals({ campaignId, displayTypeId, from, to, receivedBy }) {
    /* Answered from the covering index plays (campaign_id, played_at,
       display_id, duration_sec, tier, version_id, received_at) (migrations 0025, 0033,
       0039, 0043), keeping only plays on the display type's own displays.
       Measured on 1.9 million plays: 0.5 s this way, 0.6 s as a join, 17 s
       as rows into JavaScript.
       Plays per version come out of the SAME scan (review, 3 Oct 2026): a
       window almost always played the one version it was handed, so the
       scan reports the version range and how many plays carry one; only a
       window that really played several versions pays for the per-version
       GROUP BY. A second scan for every window cost 1.7 s on 1.9 million
       plays where this costs 0.8. */
    const where = `WHERE campaign_id = ? AND played_at >= ? AND played_at < ?
          AND display_id IN (SELECT id FROM displays WHERE display_type_id = ?)${receivedBy ? ' AND (received_at IS NULL OR received_at <= ?)' : ''}`
    const args = receivedBy ? [campaignId, from, to, displayTypeId, receivedBy] : [campaignId, from, to, displayTypeId]
    const r = prepared(db,
      `SELECT COUNT(*) AS plays, COALESCE(SUM(duration_sec), 0) AS played_sec,
              COUNT(version_id) AS with_version, MIN(version_id) AS v_min, MAX(version_id) AS v_max
         FROM plays ${where}`,
    ).get(...args) as { plays: number; played_sec: number; with_version: number; v_min: string | null; v_max: string | null }
    let byVersion: { versionId: string | null; plays: number }[]
    if (r.v_min === r.v_max) {
      byVersion = [
        ...(r.plays > r.with_version ? [{ versionId: null, plays: r.plays - r.with_version }] : []),
        ...(r.with_version ? [{ versionId: r.v_min, plays: r.with_version }] : []),
      ]
    } else {
      byVersion = (prepared(db, `SELECT version_id, COUNT(*) AS plays FROM plays ${where} GROUP BY version_id ORDER BY version_id`).all(...args) as { version_id: string | null; plays: number }[])
        .map((v) => ({ versionId: v.version_id, plays: v.plays }))
    }
    return { plays: r.plays, playedSec: r.played_sec, byVersion }
  },
})
