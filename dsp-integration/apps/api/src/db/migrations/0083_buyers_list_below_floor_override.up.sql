-- Below-floor override (ticket O0nPOgvjA2z89Q5Sy8zo, 22 Oct 2026): a Preferred or guaranteed deal priced under the platform floor (a fixed CPM below it, or a total for the term whose equivalent CPM is below the slots' floors) can be saved when an admin explicitly overrides the warning. The deal records that it was, and who and when.
ALTER TABLE buyers_lists ADD COLUMN below_floor_override INTEGER NOT NULL DEFAULT 0;
ALTER TABLE buyers_lists ADD COLUMN below_floor_override_by TEXT;
ALTER TABLE buyers_lists ADD COLUMN below_floor_override_at TEXT;
