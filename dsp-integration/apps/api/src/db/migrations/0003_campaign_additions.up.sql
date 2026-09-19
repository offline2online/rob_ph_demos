-- Additive: spec §8 campaign additions. Defaults keep existing (HQ-authored)
-- campaigns loading unchanged. Approval state lives beside the campaign in
-- its own table (package 11), not here.
ALTER TABLE campaigns ADD COLUMN source TEXT NOT NULL DEFAULT 'hq';
ALTER TABLE campaigns ADD COLUMN advertiser_id TEXT;
ALTER TABLE campaigns ADD COLUMN partner_id TEXT;
ALTER TABLE campaigns ADD COLUMN display_type_id TEXT;
ALTER TABLE campaigns ADD COLUMN pricing_type TEXT;
ALTER TABLE campaigns ADD COLUMN activation_enabled INTEGER NOT NULL DEFAULT 0;
