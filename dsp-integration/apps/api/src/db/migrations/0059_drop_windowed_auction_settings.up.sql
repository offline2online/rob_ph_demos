-- Windowed auction machinery removed (Rob, 8 Oct 2026). Non-deal slots are
-- sold in real time, per impression; deals are governed by the buyers list's
-- activeFrom/activeTo/auctionCloses. The company-wide auction schedule (when
-- a window's auction opens and cuts off) and the company-wide play-window
-- length, with its deferred-change bookkeeping, have nothing left to drive.
-- A position's window length is its billing unit (slot, else display type,
-- else the platform default).
ALTER TABLE company_advertiser_settings DROP COLUMN pending_play_window_effective_from;
ALTER TABLE company_advertiser_settings DROP COLUMN pending_play_window_hours;
ALTER TABLE company_advertiser_settings DROP COLUMN auction_cutoff_time;
ALTER TABLE company_advertiser_settings DROP COLUMN play_window_hours;
ALTER TABLE company_advertiser_settings DROP COLUMN auction_opens_hours;
