-- One live sale per position and play window, enforced by the database
-- (security/scalability review, 23 Sep 2026).
--
-- The auction and POST /v1/reservations both check "is this window already
-- sold?" before they write, but a check-then-write in application code does
-- not hold once two writers run at once: the auction CLI next to the API's
-- own scheduled auction, or two API instances. Reproduced before this
-- migration: two concurrent auctions for the same window produced two `won`
-- rows and two slot bookings — double delivery and double billing.
--
-- A database that already holds duplicates (from exactly that race) couldn't
-- take the index, and the API would not start. So first, keep the earliest
-- live winner of each window and mark any later one lost, saying why; and
-- keep the earliest booking of each slot and window. Idempotent: on a clean
-- database both statements change nothing.
UPDATE reservations
   SET status = 'lost',
       reason = 'Duplicate winner for this window, removed by migration 0021 (one live winner per window).'
 WHERE id IN (
   SELECT id FROM (
     SELECT id, ROW_NUMBER() OVER (PARTITION BY position_id, window_start ORDER BY created_at, rowid) AS n
       FROM reservations
      WHERE test_mode = 0 AND status IN ('won', 'reserved')
   ) WHERE n > 1
 );
DELETE FROM campaign_slot_bookings
 WHERE rowid IN (
   SELECT rowid FROM (
     SELECT rowid, ROW_NUMBER() OVER (PARTITION BY display_type_id, slot, window_start ORDER BY created_at, rowid) AS n
       FROM campaign_slot_bookings
   ) WHERE n > 1
 );

-- A partial unique index makes the second writer fail instead. Test-mode
-- wins are excluded on purpose: they never take a window (spec §7), and
-- Test-mode DSPs clear among themselves alongside the live winner.
CREATE UNIQUE INDEX reservations_one_live_winner
  ON reservations (position_id, window_start)
  WHERE test_mode = 0 AND status IN ('won', 'reserved');

-- The hand-off books a campaign into a slot for a window in the (stand-in)
-- campaign system: one campaign per slot per window.
CREATE UNIQUE INDEX campaign_slot_bookings_one_per_window
  ON campaign_slot_bookings (display_type_id, slot, window_start);
