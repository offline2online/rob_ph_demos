DROP INDEX plays_billing;
CREATE INDEX plays_billing ON plays (campaign_id, played_at, display_id, duration_sec);
ALTER TABLE plays DROP COLUMN tier;
ALTER TABLE plays DROP COLUMN version_id;
