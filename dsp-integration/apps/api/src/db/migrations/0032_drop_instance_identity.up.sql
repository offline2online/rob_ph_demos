-- Federation identity is a separate integration for a later release (PH
-- instances negotiating with each other), so this build's rows do not carry
-- it (Rob, 30 Sep 2026). Migration 0022 reserved two nullable columns that
-- nothing produced, read or returned; they sat on the same rows as the
-- seller-of-record fields. Drop them. The identity stays a documented seam
-- only (api/PH-CORE-BOUNDARIES.md, "Reserved for later releases"): it is not
-- sellers.json's seller_id and maps to the instance's stable domain.
ALTER TABLE reservations DROP COLUMN source_instance_id;
ALTER TABLE exchange DROP COLUMN platform_instance_id;
