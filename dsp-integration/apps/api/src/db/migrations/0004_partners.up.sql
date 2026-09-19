-- DSP partner record (spec §8). Secret credential fields are stored only in
-- creds_secret, encrypted (AES-256-GCM via SecretsStore).
CREATE TABLE partners (
  id           TEXT PRIMARY KEY,
  provider     TEXT NOT NULL,
  name         TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'draft',
  last_sync    TEXT,
  mode         TEXT NOT NULL DEFAULT 'test',
  creds_public TEXT NOT NULL DEFAULT '{}',
  creds_secret TEXT,
  bidder       TEXT NOT NULL DEFAULT '{}',
  seats        TEXT NOT NULL DEFAULT '[]',
  lists_linked INTEGER NOT NULL DEFAULT 1,
  allow_list   TEXT NOT NULL DEFAULT '[]',
  block_list   TEXT NOT NULL DEFAULT '[]',
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
CREATE UNIQUE INDEX partners_provider ON partners (provider);
