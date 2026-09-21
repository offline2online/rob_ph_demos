-- Interactive is no longer a multiplier on the CPM (Rob, 20 Sep): an
-- interactive campaign pays its ordinary floor for the plays, plus a fixed
-- amount each time someone engages with it — scanning the QR Control code.
-- The old multiplier has no sensible conversion, so every retailer starts
-- from the default fee and sets its own.
ALTER TABLE company_advertiser_settings DROP COLUMN interactive_multiplier;
ALTER TABLE company_advertiser_settings ADD COLUMN interactive_cpe REAL NOT NULL DEFAULT 0.5;
