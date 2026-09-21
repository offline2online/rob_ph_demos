ALTER TABLE company_advertiser_settings DROP COLUMN interactive_cpe;
ALTER TABLE company_advertiser_settings ADD COLUMN interactive_multiplier REAL NOT NULL DEFAULT 3;
