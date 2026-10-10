-- Deal ID: the advertiser-facing grouping for a private auction. An advertiser
-- may tag a campaign with a deal ID when it submits it (Partner API dealId);
-- the retailer then approves the deal's campaigns in subsets, each subset into
-- a creative ID. NULL for a direct campaign (no deal).
ALTER TABLE campaigns ADD COLUMN deal_id TEXT;
CREATE INDEX campaigns_deal_id ON campaigns (deal_id);
