-- Changing the play-window length (Advertiser settings → Auction schedule)
-- used to be refused outright while any future window was bid on or booked.
-- It's now accepted and scheduled instead: the new length is held here until
-- every currently active window has played, then it takes over (Rob's board
-- ticket, 26 Sep 2026).
ALTER TABLE company_advertiser_settings ADD COLUMN pending_play_window_hours INTEGER NULL;
ALTER TABLE company_advertiser_settings ADD COLUMN pending_play_window_effective_from TEXT NULL;
