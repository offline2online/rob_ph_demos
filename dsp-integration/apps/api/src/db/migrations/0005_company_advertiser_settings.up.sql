-- Company-wide advertiser settings (one row) and per-advertiser settings.
CREATE TABLE company_advertiser_settings (
  id                      TEXT PRIMARY KEY,
  currency                TEXT NOT NULL DEFAULT 'AUD',
  floor_cpm               REAL NOT NULL DEFAULT 100,
  personalised_multiplier REAL NOT NULL DEFAULT 1.5,
  interactive_multiplier  REAL NOT NULL DEFAULT 3,
  audience_scoring        TEXT,
  advertiser_whitelist    TEXT NOT NULL DEFAULT '[]',
  advertiser_blacklist    TEXT NOT NULL DEFAULT '[]',
  category_whitelist      TEXT NOT NULL DEFAULT '[]',
  category_blacklist      TEXT NOT NULL DEFAULT '[]',
  updated_at              TEXT NOT NULL
);

CREATE TABLE advertiser_settings (
  advertiser_id     TEXT PRIMARY KEY,
  approval_required INTEGER NOT NULL DEFAULT 1,
  floor_multiplier  REAL NOT NULL DEFAULT 1.0,
  updated_at        TEXT NOT NULL
);
