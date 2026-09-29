-- Re-approval keeps the approved version running (Q38, Rob, 29 Sep 2026)
-- and safe reuse is keyed on content (Q40, same day):
--   content_hash   sha256 of the uploaded file — "unchanged" means
--                  byte-identical, the basis for safe reuse (spec §3).
--   discarded_at   set on the assets of an edit the retailer rejected: the
--                  edit is thrown away and the approved version carries on,
--                  so they are no longer part of the campaign's current
--                  version. Kept (not deleted) so version numbers never
--                  repeat and the audit trail's versions stay unambiguous.
--   asset_version  on a booking: which campaign_assets version was handed
--                  off for that window, so the campaign system plays the
--                  approved creative, never one still under review.
ALTER TABLE campaign_assets ADD COLUMN content_hash TEXT;
ALTER TABLE campaign_assets ADD COLUMN discarded_at TEXT;
ALTER TABLE campaign_slot_bookings ADD COLUMN asset_version INTEGER;
