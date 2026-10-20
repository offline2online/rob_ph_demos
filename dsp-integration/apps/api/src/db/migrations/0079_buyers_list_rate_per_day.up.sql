-- Programmatic guaranteed deals book whole days at a flat rate per day (Rob, 20 Oct 2026; the DOOH full-day takeover standard): the USD rate for one 24-hour day on a slot. NULL = a deal that pre-dates per-day pricing, or one that is not guaranteed. The equivalent CPM is derived from the assigned slots' forecast, never stored.
ALTER TABLE buyers_lists ADD COLUMN rate_per_day REAL;
