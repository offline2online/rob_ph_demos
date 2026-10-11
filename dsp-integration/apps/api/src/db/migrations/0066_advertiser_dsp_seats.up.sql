-- PH advertiser -> DSP seats (ticket T0gLfo2zDrRXPVGcvEoL, 10 Oct 2026): the seats
-- an advertiser bids under, one { partner_id, seat_id } per DSP seat, the same
-- identifier an invited buyer on a buyers list carries. Chosen from synced seats;
-- a seat a re-sync later drops stays here, flagged on read, so it can be re-pointed.
CREATE TABLE advertiser_seats (
  advertiser_id TEXT NOT NULL,
  partner_id    TEXT NOT NULL,
  seat_id       TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  PRIMARY KEY (advertiser_id, partner_id, seat_id)
);
