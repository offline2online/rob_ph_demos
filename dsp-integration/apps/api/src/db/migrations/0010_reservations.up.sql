-- Reservations and bids for a play window (spec §6, §7), and the auction's
-- outcome for each. One row per reservation, API bid or DSP bid response.
CREATE TABLE reservations (
  id            TEXT PRIMARY KEY,
  partner_id    TEXT NOT NULL,
  advertiser_id TEXT,
  campaign_id   TEXT,
  position_id   TEXT NOT NULL,
  window_start  TEXT NOT NULL,
  type          TEXT NOT NULL,              -- reserve | bid
  channel       TEXT NOT NULL DEFAULT 'api', -- api | openrtb
  bid_cpm       REAL,
  currency      TEXT NOT NULL,
  status        TEXT NOT NULL,              -- pending | won | lost | reserved | rejected
  clearing_cpm  REAL,
  reason        TEXT,
  test_mode     INTEGER NOT NULL DEFAULT 0,
  pricing_type  TEXT,
  handed_off_at TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE INDEX reservations_window ON reservations (position_id, window_start);
