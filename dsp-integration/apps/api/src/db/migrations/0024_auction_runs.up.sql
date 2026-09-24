-- Which process clears a play window's auction (scalability review, 24 Sep
-- 2026). The scheduler used to remember the windows it had cleared in
-- memory, per process: a second API replica, a CronJob tick or the CLI
-- would each run the auction again for the same window (migration 0021
-- stops the window being sold twice, but every DSP is sent a second round
-- of bid requests). A tick now claims a window here first — one row per
-- window, so exactly one process gets it — and marks it finished after.
-- A claim left unfinished for 15 minutes is a process that died mid-auction
-- and may be taken over (exchange/scheduler.ts).
CREATE TABLE auction_runs (
  window_start TEXT PRIMARY KEY,
  claimed_at   TEXT NOT NULL,
  claimed_by   TEXT NOT NULL,
  finished_at  TEXT
);
