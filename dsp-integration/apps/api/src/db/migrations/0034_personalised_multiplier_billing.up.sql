-- The personalised multiplier is charged per personalised play, not as a
-- bid floor (Rob, 30 Sep 2026). Its value is snapshotted on the reservation
-- when the window clears, so a later settings change cannot reprice a
-- window already sold or a locked term. null = none (interactive
-- campaigns, and windows cleared before this migration): bills at the
-- clearing CPM alone.
ALTER TABLE reservations ADD COLUMN personalised_multiplier REAL;
-- The split on each line item: the personalised plays, their realised
-- VAC-d, the multiplier applied, and the personalised part of the amount
-- (amount already includes it). Zero / null for a window with none.
ALTER TABLE billing_line_items ADD COLUMN personalised_plays INTEGER NOT NULL DEFAULT 0;
ALTER TABLE billing_line_items ADD COLUMN personalised_views INTEGER NOT NULL DEFAULT 0;
ALTER TABLE billing_line_items ADD COLUMN personalised_multiplier REAL;
ALTER TABLE billing_line_items ADD COLUMN personalised_amount REAL NOT NULL DEFAULT 0;
