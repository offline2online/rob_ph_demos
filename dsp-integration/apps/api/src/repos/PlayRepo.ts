/* Writes to PH Core's stand-in plays table that aren't playback reads
   (those are platform/PlaybackSource.ts): only the test-only endpoint's
   synthetic plays (routes/admin/test.ts), which is deleted with the
   stand-in on integration. */
import { type Db, prepared, type Awaitable } from '../db/db'
import type { PlayTier } from '../platform/PlaybackSource'

export interface TestPlay {
  id: string
  displayId: string
  campaignId: string
  playedAt: string
  durationSec: number
  /* The campaign version the play showed (contract v3.1 row 3). */
  versionId: string | null
  tier: PlayTier | null
}

export interface PlayRepo {
  insertTestPlay(p: TestPlay): Awaitable<void>
}

export function sqlitePlayRepo(db: Db): PlayRepo {
  return {
    insertTestPlay(p) {
      prepared(db, 'INSERT INTO plays (id, display_id, campaign_id, played_at, duration_sec, version_id, tier) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(p.id, p.displayId, p.campaignId, p.playedAt, p.durationSec, p.versionId, p.tier)
    },
  }
}
