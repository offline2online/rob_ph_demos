-- At-bid creative with post-bid approval (real-time path), 7 Oct 2026: an impression can be filled with the creative the DSP supplied in its bid, played before PH has seen it, and reviewed afterwards. creative_url is the DSP-hosted URL the player was told to fetch; creative_source says which kind of fill it was: approved (PH's own approved copy), under_review (PH's copy, review still open) or at_bid (the DSP's URL, not yet seen by PH); content_hash is filled once PH has fetched the bytes after the play; review_note says what happened to the review.
ALTER TABLE realtime_impressions ADD COLUMN creative_url TEXT;
ALTER TABLE realtime_impressions ADD COLUMN creative_source TEXT;
ALTER TABLE realtime_impressions ADD COLUMN content_hash TEXT;
ALTER TABLE realtime_impressions ADD COLUMN review_note TEXT;
