-- Reserved, not used (REQUIREMENTS §9.3, 22 Sep 2026): the source-instance
-- identifier for a later cross-instance federation release, placed now so
-- that release has a field to key off instead of retrofitting one across
-- records that already exist by then. Nothing reads or writes these yet, and
-- no API returns them. Both stay NULL.
--
-- exchange.platform_instance_id — this instance's own identity to OTHER PH
--   instances, held ALONGSIDE the seller-of-record fields, never inside them.
--   It is not sellers.json's seller_id (the retailer's identity to the ad
--   ecosystem, published as `sid`); it maps to the same stable domain.
-- reservations.source_instance_id — which instance a booking came from, once
--   instances can book each other's inventory.
ALTER TABLE exchange ADD COLUMN platform_instance_id TEXT;
ALTER TABLE reservations ADD COLUMN source_instance_id TEXT;
