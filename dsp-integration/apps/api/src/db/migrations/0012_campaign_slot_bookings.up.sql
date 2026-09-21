-- POC stand-in for the existing campaign system's side of the hand-off
-- (spec §6, §7): a winning, approved campaign booked into a display type's
-- slot for a play window. The existing platform then distributes and plays
-- it as it does today; nothing here changes playback.
CREATE TABLE campaign_slot_bookings (
  id              TEXT PRIMARY KEY,
  campaign_id     TEXT NOT NULL,
  display_type_id TEXT NOT NULL,
  slot            INTEGER NOT NULL,
  window_start    TEXT NOT NULL,
  window_end      TEXT NOT NULL,
  created_at      TEXT NOT NULL
);
