ALTER TABLE billing_line_items DROP COLUMN plays_by_version;
DROP INDEX plays_billing;
CREATE INDEX plays_billing ON plays (campaign_id, played_at, display_id, duration_sec, tier);
