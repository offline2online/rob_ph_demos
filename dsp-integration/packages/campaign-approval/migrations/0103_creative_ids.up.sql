-- Creative IDs: the grouping a DSP bids on. A retailer approves campaigns one
-- at a time and assigns each to a creative ID; private-auction bids target the
-- ID, not one campaign. An ID belongs to ONE advertiser (every campaign under
-- it is that advertiser's). The assignment is keyed by CAMPAIGN, not by asset
-- version, so a creative the advertiser later updates and resubmits keeps its
-- ID while it awaits re-approval.
CREATE TABLE creative_ids (
  creative_id   TEXT PRIMARY KEY,
  advertiser_id TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  created_by    TEXT
);
CREATE INDEX creative_ids_advertiser ON creative_ids (advertiser_id);

CREATE TABLE campaign_creative_ids (
  campaign_id TEXT PRIMARY KEY,
  creative_id TEXT NOT NULL REFERENCES creative_ids (creative_id),
  assigned_at TEXT NOT NULL,
  assigned_by TEXT
);
CREATE INDEX campaign_creative_ids_creative ON campaign_creative_ids (creative_id);
