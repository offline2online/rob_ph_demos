-- Settlement is final; late playback is reported as lost revenue from
-- downtime (Rob, 4 Oct 2026; spec §4 "Billing", api/PH-CORE-BOUNDARIES.md).
--
-- received_at: when the platform RECEIVED the play, distinct from played_at
-- (when it played). It is the settlement cut-off: a play received before its
-- window's line item is written counts toward billing, one received after is
-- late. PH Core's playback data must supply it; null (rows written before
-- this migration, or a store that doesn't report it) means "known at
-- settlement", i.e. billed exactly as before. plays is PH Core's stand-in.
ALTER TABLE plays ADD COLUMN received_at TEXT;
-- Billing's aggregate now also filters on received_at, so the covering index
-- carries it and the scan stays index-only.
DROP INDEX plays_billing;
CREATE INDEX plays_billing ON plays (campaign_id, played_at, display_id, duration_sec, tier, version_id, received_at);
-- The late-play scan reads plays by arrival time.
CREATE INDEX plays_received ON plays (received_at) WHERE received_at IS NOT NULL;
-- Finding the line item a late play belongs to.
CREATE INDEX billing_line_items_campaign_window ON billing_line_items (campaign_id, window_start);

-- The late-play ledger: one row per play received after its window's line
-- item was written, recorded at what it would have been worth at the
-- window's cleared CPM (personalised multiplier included). An operational
-- report for the retailer, never on an advertiser's invoice. The line item
-- itself is never touched. play_id is unique: a play is recorded once.
CREATE TABLE late_plays (
  play_id                 TEXT PRIMARY KEY,
  line_item_id            TEXT NOT NULL,
  reservation_id          TEXT NOT NULL,
  campaign_id             TEXT NOT NULL,
  position_id             TEXT NOT NULL,
  display_id              TEXT NOT NULL,
  store_id                TEXT,
  played_at               TEXT NOT NULL,
  received_at             TEXT NOT NULL,
  duration_sec            REAL NOT NULL,
  tier                    TEXT,
  cpm                     REAL NOT NULL,
  currency                TEXT NOT NULL,
  personalised_multiplier REAL,
  lost_views              REAL NOT NULL,
  lost_amount             REAL NOT NULL,
  recorded_at             TEXT NOT NULL
);
CREATE INDEX late_plays_played ON late_plays (played_at);
CREATE INDEX late_plays_line_item ON late_plays (line_item_id);

-- Where the last late-play scan got to (by received_at), so a tick reads
-- only what arrived since. One row.
CREATE TABLE late_play_scan (
  id              INTEGER PRIMARY KEY CHECK (id = 1),
  scanned_through TEXT NOT NULL
);
