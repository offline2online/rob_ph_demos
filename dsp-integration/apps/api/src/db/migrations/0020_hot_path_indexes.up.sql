-- Indexes for the Partner API and exchange hot paths (scalability review,
-- 23 Sep 2026). Additive and reversible; no data changes.
--
-- displays (existing-platform stand-in): every position looks up the displays
-- of its display type — inventory, availability, the auction and the booking
-- schedule. Without this each lookup scans the whole displays table, which
-- grows with the estate (6,000+ displays for a large retailer).
CREATE INDEX displays_display_type ON displays (display_type_id);

-- plays (existing-platform stand-in, read only): billing reconciles one
-- campaign's plays over one window.
CREATE INDEX plays_campaign_played ON plays (campaign_id, played_at);
CREATE INDEX plays_played ON plays (played_at);

-- campaign_slot_bookings: the hand-off and Campaign Status read a
-- campaign's bookings.
CREATE INDEX campaign_slot_bookings_campaign ON campaign_slot_bookings (campaign_id);

-- reservations: billing and the schedule read by status over a date range.
CREATE INDEX reservations_status_window ON reservations (status, window_start);
