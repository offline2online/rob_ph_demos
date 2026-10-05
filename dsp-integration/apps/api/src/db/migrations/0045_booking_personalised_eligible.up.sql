-- Personalised versions play only in a window held by a reserve booking (Rob, 5 Oct 2026).
ALTER TABLE campaign_slot_bookings ADD COLUMN personalised_eligible INTEGER NOT NULL DEFAULT 0;
