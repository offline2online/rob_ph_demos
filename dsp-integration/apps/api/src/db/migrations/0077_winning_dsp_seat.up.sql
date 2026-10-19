-- Winning DSP seat on reservations and billing line items (ticket eIr40FtXM13n0YcOj2Gl,
-- 19 Oct 2026): the seat (seatbid.seat of the bid response; with the row's partner_id it
-- names the DSP seat) that placed the bid. Retail Media Insights reads it for demand by
-- DSP seat. Stored as written, not joined to partners.seats at read time, so a seat a DSP
-- re-sync drops keeps its history. Null on a Partner API booking and on rows written
-- before this migration.
ALTER TABLE reservations ADD COLUMN seat_id TEXT;
ALTER TABLE billing_line_items ADD COLUMN seat_id TEXT;
