-- The advertiser's campaign brief, captured with the booking (Rob, 20 Sep):
-- the same shape as the platform's Campaign Brief tab, stored as JSON beside
-- the campaign. Optional, so existing campaigns load unchanged.
ALTER TABLE campaigns ADD COLUMN brief TEXT;
