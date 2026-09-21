-- Billing line items (spec §4 "Billing", §7 "Proof of play"): the CPM billed
-- against realised VAC-d, reconciled against existing playback data after a
-- window ends. Stored only: no UI, report or API.
CREATE TABLE billing_line_items (
  id              TEXT PRIMARY KEY,
  reservation_id  TEXT NOT NULL UNIQUE,
  partner_id      TEXT NOT NULL,
  advertiser_id   TEXT,
  campaign_id     TEXT NOT NULL,
  position_id     TEXT NOT NULL,
  window_start    TEXT NOT NULL,
  window_end      TEXT NOT NULL,
  plays           INTEGER NOT NULL,
  played_sec      REAL NOT NULL,
  expected_sec    REAL NOT NULL,
  assumed_views   INTEGER NOT NULL,
  realised_views  INTEGER NOT NULL,
  cpm             REAL NOT NULL,
  currency        TEXT NOT NULL,
  amount          REAL NOT NULL,
  computed_at     TEXT NOT NULL
);
