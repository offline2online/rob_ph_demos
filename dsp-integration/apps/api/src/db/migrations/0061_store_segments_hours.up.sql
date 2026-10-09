-- Plays-per-day capacity (Rob, 9 Oct 2026): a store's localized segments
-- (Metro, Airport ... as the platform's fixed and variable store segments) and
-- its trading hours, both stand-ins for what Displays & Devices answers on
-- integration. segments is a JSON array of names; hours are whole hours of the
-- day (0-24), open inclusive, close exclusive. Default: no segment, open 24/7.
ALTER TABLE stores ADD COLUMN segments TEXT NOT NULL DEFAULT '[]';
ALTER TABLE stores ADD COLUMN open_hour INTEGER NOT NULL DEFAULT 0;
ALTER TABLE stores ADD COLUMN close_hour INTEGER NOT NULL DEFAULT 24;
