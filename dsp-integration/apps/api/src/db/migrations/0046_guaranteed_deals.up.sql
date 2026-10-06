-- Guaranteed deal path (Rob, 7 Oct 2026): a retailer-configurable contingency buffer (default 10%) and, per reservation, which deal type it is and the volume committed.
ALTER TABLE company_advertiser_settings ADD COLUMN guarantee_buffer_pct REAL NOT NULL DEFAULT 10;
ALTER TABLE reservations ADD COLUMN deal_type TEXT NOT NULL DEFAULT 'preferred';
ALTER TABLE reservations ADD COLUMN forecast_impressions INTEGER;
ALTER TABLE reservations ADD COLUMN guaranteed_impressions INTEGER;
