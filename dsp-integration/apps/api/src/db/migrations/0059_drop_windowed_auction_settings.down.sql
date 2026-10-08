ALTER TABLE company_advertiser_settings ADD COLUMN auction_opens_hours INTEGER NOT NULL DEFAULT 168;
ALTER TABLE company_advertiser_settings ADD COLUMN play_window_hours INTEGER NOT NULL DEFAULT 24;
ALTER TABLE company_advertiser_settings ADD COLUMN auction_cutoff_time TEXT NOT NULL DEFAULT '18:00';
ALTER TABLE company_advertiser_settings ADD COLUMN pending_play_window_hours INTEGER NULL;
ALTER TABLE company_advertiser_settings ADD COLUMN pending_play_window_effective_from TEXT NULL;
