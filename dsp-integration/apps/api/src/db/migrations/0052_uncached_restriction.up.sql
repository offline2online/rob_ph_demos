-- Bandwidth protection (Rob, 7 Oct 2026): while a restricted window is in
-- force, a real-time impression can only be won by a creative the player
-- already holds in its cache. off | fixed (daily start/end, UTC) | store_open.
ALTER TABLE company_advertiser_settings ADD COLUMN uncached_restriction TEXT NOT NULL DEFAULT 'off';
ALTER TABLE company_advertiser_settings ADD COLUMN uncached_restriction_start TEXT NOT NULL DEFAULT '09:00';
ALTER TABLE company_advertiser_settings ADD COLUMN uncached_restriction_end TEXT NOT NULL DEFAULT '18:00';
