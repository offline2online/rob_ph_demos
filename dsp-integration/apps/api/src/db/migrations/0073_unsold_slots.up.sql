-- Unsold real-time slots (ticket 3BXfWxs2jkN6S7awLXhQ, 16 Oct 2026): every real-time impression opportunity that found no buyer, aggregated per hour x display x position x reason so the table is bounded by estate size and retention, never by traffic. Append-only (counts and values only grow); the retention sweep deletes whole old hours. Indicative missed revenue at the resolved floor, never billed or shown to advertisers. Test-mode traffic is never recorded.
CREATE TABLE unsold_slots (
  hour             TEXT NOT NULL,   -- UTC hour of the play opportunity, YYYY-MM-DDTHH
  display_id       TEXT NOT NULL,
  position_id      TEXT NOT NULL,
  reason           TEXT NOT NULL,   -- no_bids | below_floor | uncached | no_creative | other
  currency         TEXT NOT NULL,
  store_id         TEXT,
  display_type_id  TEXT NOT NULL,
  impressions      INTEGER NOT NULL DEFAULT 0,
  floor_cpm_sum    REAL NOT NULL DEFAULT 0,  -- sum of the resolved floor CPM per opportunity (average = sum / impressions)
  missed_views     REAL NOT NULL DEFAULT 0,  -- assumed views (VAC-d share) of the opportunities
  missed_amount    REAL NOT NULL DEFAULT 0,  -- missed_views / 1000 x floor CPM
  PRIMARY KEY (hour, display_id, position_id, reason, currency)
);
CREATE INDEX unsold_slots_store ON unsold_slots (store_id, hour);
