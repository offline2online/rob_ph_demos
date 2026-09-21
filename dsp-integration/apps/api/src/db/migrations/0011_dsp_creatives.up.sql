-- DSP creative IDs (a bid's crid) and the campaign each became when it was
-- first seen and queued for approval (spec §3: a bid carrying an unknown
-- creative is discarded and the creative placed in the approval queue).
CREATE TABLE dsp_creatives (
  partner_id  TEXT NOT NULL,
  crid        TEXT NOT NULL,
  campaign_id TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  PRIMARY KEY (partner_id, crid)
);
