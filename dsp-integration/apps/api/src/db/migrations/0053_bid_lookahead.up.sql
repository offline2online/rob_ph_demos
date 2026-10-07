-- Real-time bidding lookahead (Rob, 7 Oct 2026): how many seconds before a
-- slot plays its auction opens. Company-wide; default 35, as Broadsign Reach.
ALTER TABLE company_advertiser_settings ADD COLUMN bid_lookahead_seconds INTEGER NOT NULL DEFAULT 35;
