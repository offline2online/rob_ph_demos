-- A booking carries the version it plays as the approval module's opaque
-- string (eeBT1Qp33GdsPcxG2As3, 2 Oct 2026): the same value latestAssets
-- resolves (FWwsCUJP), not this stand-in's campaign_assets number. Existing
-- numeric versions become the stand-in's own label, 'v<n>'. A new column is
-- added and the old one dropped, so the declared type is TEXT on any engine.
ALTER TABLE campaign_slot_bookings ADD COLUMN asset_version_label TEXT;
UPDATE campaign_slot_bookings SET asset_version_label = 'v' || asset_version WHERE asset_version IS NOT NULL;
ALTER TABLE campaign_slot_bookings DROP COLUMN asset_version;
ALTER TABLE campaign_slot_bookings RENAME COLUMN asset_version_label TO asset_version;
