-- Billing over a large estate (scalability review, 24 Sep 2026). Billing a
-- window counts and sums a campaign's plays on one display type's displays
-- in that window (PlaybackSource.totals). On 1,000 displays that is 1.9
-- million rows; with the (campaign_id, played_at) index each still cost a
-- table lookup for display_id and duration_sec. A covering index answers
-- the whole aggregate from the index: 1.6 s → 0.5 s measured. It replaces
-- the narrower index of migration 0020, which it contains.
--
-- plays is a stand-in for the platform's playback data; on integration the
-- playback store answers totals() from its own aggregates and neither
-- index exists there.
DROP INDEX plays_campaign_played;
CREATE INDEX plays_billing ON plays (campaign_id, played_at, display_id, duration_sec);
