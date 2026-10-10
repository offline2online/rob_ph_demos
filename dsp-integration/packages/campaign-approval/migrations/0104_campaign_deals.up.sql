-- Deal associations added to a campaign after authoring: a campaign carries a
-- SET of deals, not one. The deal the advertiser set at authoring stays on
-- campaigns.deal_id (immutable through approval); every further deal is a row
-- here, added by the retailer or the advertiser from the campaign — e.g. a
-- campaign first run direct that is later also run through a DSP. A creative ID
-- takes its deal set from the campaigns grouped under it, so one creative can
-- be in many deals at once.
CREATE TABLE campaign_deals (
  campaign_id TEXT NOT NULL,
  deal_id     TEXT NOT NULL,
  added_at    TEXT NOT NULL,
  added_by    TEXT,
  PRIMARY KEY (campaign_id, deal_id)
);
CREATE INDEX campaign_deals_deal ON campaign_deals (deal_id);
