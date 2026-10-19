-- Advertiser audiences (ticket OanRebXyEryAXBQrBsVe, 19 Oct 2026): Visitor Segments values the
-- retailer shares with one advertiser only, such as "Blackmores · new to brand". The retailer's own
-- systems decide who is in each audience and publish it as a visitor segment; PH stores only which
-- advertiser may target which value. A direct advertiser and a DSP advertiser share advertiser_id.
CREATE TABLE advertiser_audiences (
  advertiser_id TEXT NOT NULL,
  segment_value TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  created_by    TEXT,
  PRIMARY KEY (advertiser_id, segment_value)
);
CREATE INDEX advertiser_audiences_segment ON advertiser_audiences (segment_value);
