-- Auction schedule (Rob's board ticket and Q13), in Advertiser settings →
-- Pricing: when bidding for a play window opens (hours before the cutoff),
-- how long a play window is, and the daily auction cutoff time (UTC).
ALTER TABLE company_advertiser_settings ADD COLUMN auction_opens_hours INTEGER NOT NULL DEFAULT 168;
ALTER TABLE company_advertiser_settings ADD COLUMN play_window_hours INTEGER NOT NULL DEFAULT 24;
ALTER TABLE company_advertiser_settings ADD COLUMN auction_cutoff_time TEXT NOT NULL DEFAULT '18:00';
