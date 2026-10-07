-- Real-time (player-triggered) bidding, 7 Oct 2026: one row per impression the player signals for a real-time position. Deliberately its own table: a real-time fill never touches reservations or slot bookings, so migration 0021's one-live-winner-per-window index is unaffected.
CREATE TABLE realtime_impressions (
  id             TEXT PRIMARY KEY,
  position_id    TEXT NOT NULL,
  display_id     TEXT NOT NULL,
  window_start   TEXT NOT NULL,
  requested_at   TEXT NOT NULL,
  status         TEXT NOT NULL,
  reason         TEXT,
  partner_id     TEXT,
  advertiser_id  TEXT,
  campaign_id    TEXT,
  crid           TEXT,
  clearing_cpm   REAL,
  currency       TEXT NOT NULL DEFAULT 'USD',
  test_mode      INTEGER NOT NULL DEFAULT 0,
  asset_version  TEXT,
  expires_at     TEXT,
  played_at      TEXT,
  bid_requests   INTEGER NOT NULL DEFAULT 0,
  elapsed_ms     INTEGER
);
CREATE INDEX realtime_impressions_position ON realtime_impressions (position_id, requested_at);
