-- Asset-level rejection detail + safe reuse of previously approved assets
-- (spec §3, ticket 22 Sep).
ALTER TABLE campaign_approvals ADD COLUMN asset_reasons TEXT;
ALTER TABLE campaign_approval_audit ADD COLUMN asset_reasons TEXT;

-- One row per campaign asset a human has cleared (approved, not
-- auto-approved) at a given content hash. An asset may skip re-review on
-- resubmission only when it is unchanged (same content_hash) AND its most
-- recent clearance here was by a human — automated-pass alone never
-- qualifies, since it never writes a row here.
CREATE TABLE campaign_approval_asset_clearance (
  campaign_id   TEXT NOT NULL,
  asset_id      TEXT NOT NULL,
  content_hash  TEXT NOT NULL,
  cleared_by    TEXT NOT NULL,
  cleared_at    TEXT NOT NULL,
  PRIMARY KEY (campaign_id, asset_id)
);
