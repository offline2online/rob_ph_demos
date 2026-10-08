-- Pre-caching retention (Rob, 8 Oct 2026): how many hours PH Core's PWA player
-- may keep a pre-cached, approved creative. Company-wide; default 48, as
-- Broadsign Air's pre-cache horizon. An upper bound, never a guaranteed hold.
ALTER TABLE company_advertiser_settings ADD COLUMN cached_asset_retention_hours INTEGER NOT NULL DEFAULT 48;
