-- Back to the stand-in's numeric version: 'v<n>' gives n; any other label has no number.
ALTER TABLE campaign_slot_bookings ADD COLUMN asset_version_number INTEGER;
UPDATE campaign_slot_bookings SET asset_version_number = CAST(SUBSTR(asset_version, 2) AS INTEGER) WHERE asset_version LIKE 'v%';
ALTER TABLE campaign_slot_bookings DROP COLUMN asset_version;
ALTER TABLE campaign_slot_bookings RENAME COLUMN asset_version_number TO asset_version;
