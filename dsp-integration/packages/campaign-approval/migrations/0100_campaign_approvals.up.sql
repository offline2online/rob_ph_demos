-- Campaign approval, kept BESIDE the campaign (not inside it): one row per
-- campaign and asset version, plus an append-only audit log. Numbered 0100+
-- so it never collides with the host's migrations.
CREATE TABLE campaign_approvals (
  campaign_id   TEXT NOT NULL,
  asset_version TEXT NOT NULL,
  status        TEXT NOT NULL,
  mode          TEXT,
  submitted_at  TEXT,
  reviewed_by   TEXT,
  reviewed_at   TEXT,
  reason        TEXT,
  checks        TEXT NOT NULL DEFAULT '[]',
  created_at    TEXT NOT NULL,
  PRIMARY KEY (campaign_id, asset_version)
);

CREATE TABLE campaign_approval_audit (
  id            TEXT PRIMARY KEY,
  campaign_id   TEXT NOT NULL,
  asset_version TEXT NOT NULL,
  action        TEXT NOT NULL,
  actor         TEXT,
  reason        TEXT,
  at            TEXT NOT NULL
);
CREATE INDEX campaign_approval_audit_campaign ON campaign_approval_audit (campaign_id, at);
