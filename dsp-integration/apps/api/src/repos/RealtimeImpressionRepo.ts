/* Real-time impressions (migration 0047): one row per impression the player
   signals for a real-time position, its fill or no fill, and its proof of
   play. Separate from reservations on purpose — see exchange/realtime.ts. */
import { type Db, prepared, type Awaitable } from '../db/db'

export type ImpressionStatus = 'filled' | 'no_fill' | 'played'
export interface ImpressionRecord {
  id: string
  positionId: string
  displayId: string
  windowStart: string
  requestedAt: string
  status: ImpressionStatus
  reason: string | null
  partnerId: string | null
  advertiserId: string | null
  campaignId: string | null
  crid: string | null
  clearingCpm: number | null
  currency: string
  testMode: boolean
  assetVersion: string | null
  expiresAt: string | null
  playedAt: string | null
  bidRequests: number
  elapsedMs: number | null
}

interface Row {
  id: string; position_id: string; display_id: string; window_start: string; requested_at: string; status: ImpressionStatus; reason: string | null
  partner_id: string | null; advertiser_id: string | null; campaign_id: string | null; crid: string | null; clearing_cpm: number | null; currency: string
  test_mode: number; asset_version: string | null; expires_at: string | null; played_at: string | null; bid_requests: number; elapsed_ms: number | null
}
const toRecord = (r: Row): ImpressionRecord => ({
  id: r.id, positionId: r.position_id, displayId: r.display_id, windowStart: r.window_start, requestedAt: r.requested_at, status: r.status, reason: r.reason,
  partnerId: r.partner_id, advertiserId: r.advertiser_id, campaignId: r.campaign_id, crid: r.crid, clearingCpm: r.clearing_cpm, currency: r.currency,
  testMode: !!r.test_mode, assetVersion: r.asset_version, expiresAt: r.expires_at, playedAt: r.played_at, bidRequests: r.bid_requests, elapsedMs: r.elapsed_ms,
})

export interface ImpressionRepo {
  insert(r: ImpressionRecord): Awaitable<ImpressionRecord>
  get(id: string): Awaitable<ImpressionRecord | null>
  /* filled → played, once: false when it was already played, never filled, or its fill has expired (`at` is past expires_at). */
  markPlayed(id: string, at: string, playedAt: string): Awaitable<boolean>
  forPosition(positionId: string): Awaitable<ImpressionRecord[]>
}

export function sqliteImpressionRepo(db: Db): ImpressionRepo {
  return {
    insert(r) {
      prepared(db, `INSERT INTO realtime_impressions (id, position_id, display_id, window_start, requested_at, status, reason, partner_id, advertiser_id, campaign_id, crid, clearing_cpm, currency, test_mode, asset_version, expires_at, played_at, bid_requests, elapsed_ms)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(r.id, r.positionId, r.displayId, r.windowStart, r.requestedAt, r.status, r.reason, r.partnerId, r.advertiserId, r.campaignId, r.crid, r.clearingCpm, r.currency, r.testMode ? 1 : 0, r.assetVersion, r.expiresAt, r.playedAt, r.bidRequests, r.elapsedMs)
      return r
    },
    get: (id) => {
      const row = prepared(db, 'SELECT * FROM realtime_impressions WHERE id = ?').get(id) as Row | undefined
      return row ? toRecord(row) : null
    },
    markPlayed: (id, at, playedAt) =>
      prepared(db, "UPDATE realtime_impressions SET status = 'played', played_at = ? WHERE id = ? AND status = 'filled' AND expires_at >= ?").run(playedAt, id, at).changes > 0,
    forPosition: (positionId) => (prepared(db, 'SELECT * FROM realtime_impressions WHERE position_id = ? ORDER BY requested_at').all(positionId) as unknown as Row[]).map(toRecord),
  }
}
