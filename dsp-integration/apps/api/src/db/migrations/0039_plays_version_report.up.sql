-- Every play carries the campaign version it showed (interface contract
-- v3.1 row 3; ticket DDOjJoYjraKROu4Ainj5, Rob 2 Oct 2026): billing reports
-- plays per version on the line item, the audit trail that the version
-- handed off on the booking is the version that played. It is not priced.
-- The billing aggregate stays index-only, so the covering index also
-- carries version_id. plays is PH Core's stand-in (dropped on integration).
DROP INDEX plays_billing;
CREATE INDEX plays_billing ON plays (campaign_id, played_at, display_id, duration_sec, tier, version_id);
ALTER TABLE billing_line_items ADD COLUMN plays_by_version TEXT NOT NULL DEFAULT '[]';
