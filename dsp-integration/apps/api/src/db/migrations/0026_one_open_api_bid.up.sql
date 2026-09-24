-- One open API bid or reservation per advertiser, position and play window,
-- enforced by the database (stability review, 24 Sep 2026).
--
-- POST /v1/reservations refuses a second bid from an advertiser that
-- already has one pending (or a reservation) for the window, but that is a
-- check-then-write: two requests interleaving at the route's awaits, or two
-- API instances, both pass it and the advertiser holds two bids. Same
-- pattern as migration 0021: keep the earliest, mark later duplicates
-- lost, then make the database refuse the next one. Idempotent on a clean
-- database.
UPDATE reservations
   SET status = 'lost',
       reason = 'Duplicate bid for this window, removed by migration 0026 (one open bid per advertiser and window).'
 WHERE id IN (
   SELECT id FROM (
     SELECT id, ROW_NUMBER() OVER (PARTITION BY position_id, window_start, advertiser_id ORDER BY created_at, rowid) AS n
       FROM reservations
      WHERE channel = 'api' AND status IN ('pending', 'reserved')
   ) WHERE n > 1
 );

CREATE UNIQUE INDEX reservations_one_open_api_bid
  ON reservations (position_id, window_start, advertiser_id)
  WHERE channel = 'api' AND status IN ('pending', 'reserved');
