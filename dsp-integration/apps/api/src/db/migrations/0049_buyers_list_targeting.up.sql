-- Buyers and targeting lists: a buyers list now also carries the targeting
-- criteria appended to its deal (ticket w0Iu6g6efYGjA3U6J1Nv, Rob 7 Oct 2026).
-- A JSON array of shared-variable Conditions, ANDed; [] = no extra targeting.
ALTER TABLE buyers_lists ADD COLUMN targeting TEXT NOT NULL DEFAULT '[]';
