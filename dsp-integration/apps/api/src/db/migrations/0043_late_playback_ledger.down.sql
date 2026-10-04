DROP TABLE late_play_scan;
DROP INDEX late_plays_line_item;
DROP INDEX late_plays_played;
DROP TABLE late_plays;
DROP INDEX billing_line_items_campaign_window;
DROP INDEX plays_received;
DROP INDEX plays_billing;
CREATE INDEX plays_billing ON plays (campaign_id, played_at, display_id, duration_sec, tier, version_id);
ALTER TABLE plays DROP COLUMN received_at;
