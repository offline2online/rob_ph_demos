-- POC stand-in for the existing platform's campaign creative storage: one
-- row per uploaded file, versioned per campaign. Files live in the
-- AssetStore (data/assets/ in the POC).
CREATE TABLE campaign_assets (
  id           TEXT PRIMARY KEY,
  campaign_id  TEXT NOT NULL,
  version      INTEGER NOT NULL,
  role         TEXT NOT NULL,
  file         TEXT NOT NULL,
  mime_type    TEXT NOT NULL,
  width        INTEGER,
  height       INTEGER,
  duration_sec REAL,
  bitrate_kbps REAL,
  size_bytes   INTEGER NOT NULL,
  created_at   TEXT NOT NULL
);
CREATE INDEX campaign_assets_campaign ON campaign_assets (campaign_id, version);
