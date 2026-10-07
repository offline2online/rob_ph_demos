-- Bid floor hierarchy (Rob, 7 Oct 2026): a buyers list may carry its own floor
-- CPM (USD). NULL inherits from the level above (the DSP's floor, else the
-- platform floor); a value is never below the platform floor. The per-DSP
-- floor lives in the partner's bidder JSON, so it needs no column.
ALTER TABLE buyers_lists ADD COLUMN floor_cpm REAL;
