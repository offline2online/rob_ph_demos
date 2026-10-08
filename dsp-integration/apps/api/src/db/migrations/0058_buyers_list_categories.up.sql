-- A buyers list can invite by IAB category as well as by named seat (Rob, 7 Oct 2026; ticket M9aTqeDgGfRZoL3AEw9i): every advertiser a connected DSP reports in a listed category is invited, resolved live against the synced seats. A JSON array of IAB category names; the two scopes are a union.
ALTER TABLE buyers_lists ADD COLUMN invited_categories TEXT NOT NULL DEFAULT '[]';
