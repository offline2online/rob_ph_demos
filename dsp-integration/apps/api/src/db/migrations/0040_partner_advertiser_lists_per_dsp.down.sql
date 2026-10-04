-- The company-wide advertiser lists come back empty; the per-DSP lists keep
-- the seat IDs they hold.
ALTER TABLE company_advertiser_settings ADD COLUMN advertiser_whitelist TEXT NOT NULL DEFAULT '[]';
ALTER TABLE company_advertiser_settings ADD COLUMN advertiser_blacklist TEXT NOT NULL DEFAULT '[]';
