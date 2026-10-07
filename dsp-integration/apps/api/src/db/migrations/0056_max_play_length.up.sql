-- Max play length (7 Oct 2026): the fixed per-play duration, in seconds, that
-- plays per window are counted against. Company-wide default (15 s); a display
-- type and a slot can each override it (inside their JSON extensions).
ALTER TABLE company_advertiser_settings ADD COLUMN max_play_length_sec INTEGER NOT NULL DEFAULT 15;
