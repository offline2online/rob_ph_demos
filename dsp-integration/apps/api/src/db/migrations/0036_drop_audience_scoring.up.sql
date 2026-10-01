-- The "scoring framework" placeholder from 0005 was never built: scoring now
-- lives behind AudienceSource (audience_vacd, 0009; default VAC-d, 0035).
-- Nothing reads, writes or returns this column, so no data is lost.
ALTER TABLE company_advertiser_settings DROP COLUMN audience_scoring;
