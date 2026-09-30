-- Which version of a campaign a play showed (ticket "Personalised
-- multiplier: bill per personalised play", 30 Sep 2026). Only PH Core's
-- playback data can say (api/PH-CORE-BOUNDARIES.md); this stand-in table
-- carries the two columns the seam will supply. Nullable: a play with no
-- tier bills as it always has, at the clearing CPM.
ALTER TABLE plays ADD COLUMN version_id TEXT;
ALTER TABLE plays ADD COLUMN tier TEXT CHECK (tier IN ('default', 'localised', 'personalised'));
-- Billing's aggregate now also sums the personalised plays, so the covering
-- index (migration 0025) carries tier.
DROP INDEX plays_billing;
CREATE INDEX plays_billing ON plays (campaign_id, played_at, display_id, duration_sec, tier);
