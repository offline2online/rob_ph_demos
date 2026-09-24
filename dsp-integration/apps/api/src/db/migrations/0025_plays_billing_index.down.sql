DROP INDEX plays_billing;
CREATE INDEX plays_campaign_played ON plays (campaign_id, played_at);
