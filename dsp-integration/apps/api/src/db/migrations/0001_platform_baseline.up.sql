-- POC stand-in for the EXISTING Personalisation Hub records this build reads
-- or extends (spec §8). Engineering does not run this on integration: the
-- real platform already has these records. Nested objects are JSON TEXT.

CREATE TABLE display_types (
  id                  TEXT PRIMARY KEY,
  touch_point         TEXT NOT NULL,
  name                TEXT NOT NULL,
  description         TEXT,
  image               TEXT,
  canvas_width        INTEGER NOT NULL,
  canvas_height       INTEGER NOT NULL,
  background_color    TEXT NOT NULL,
  default_playlist_id TEXT,
  playlist_settings   TEXT NOT NULL,
  qr_control          TEXT NOT NULL,
  enabled_features    TEXT NOT NULL,
  multi_zone          TEXT NOT NULL,
  updated_at          TEXT
);

CREATE TABLE playlists (
  id               TEXT PRIMARY KEY,
  name             TEXT NOT NULL,
  auto_created_for TEXT,
  schedule         TEXT,
  items            TEXT NOT NULL
);

-- Displays & Devices (read only here).
CREATE TABLE displays (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  store           TEXT NOT NULL,
  display_type_id TEXT NOT NULL
);

CREATE TABLE campaigns (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  targeting  TEXT,
  created_at TEXT NOT NULL
);

-- Existing playback data (read only; billing reconciliation only).
CREATE TABLE plays (
  id           TEXT PRIMARY KEY,
  display_id   TEXT NOT NULL,
  campaign_id  TEXT NOT NULL,
  played_at    TEXT NOT NULL,
  duration_sec REAL NOT NULL
);
