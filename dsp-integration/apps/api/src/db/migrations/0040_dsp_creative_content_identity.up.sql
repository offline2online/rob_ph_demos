-- A creative's identity is PH's own content-derived ID (the campaign id
-- derived from advertiser + content hash), not the DSP's crid. dsp_creatives
-- is now the crid -> creative LABEL table: which creative this DSP's crid
-- last resolved to, the bytes' hash and URL it was verified at, and when.
-- Rows from before this migration carry no hash, so each is re-verified
-- (fetched and hashed) the next time its crid is bid with.
ALTER TABLE dsp_creatives ADD COLUMN content_hash TEXT;
ALTER TABLE dsp_creatives ADD COLUMN iurl TEXT;
ALTER TABLE dsp_creatives ADD COLUMN verified_at TEXT;
ALTER TABLE dsp_creatives ADD COLUMN claimed_at TEXT;
