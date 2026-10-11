-- Term versioning and re-acceptance for buyers lists (ticket KcqiJpzR5RXy4TWODYlG, 11 Oct 2026). The deal ID and type stay fixed; the mutable terms (floor, committed plays, delivery term, auction window, invited buyers/categories) are versioned on the same deal. term_version goes up by one on every saved change to them; reaccept_version is the latest version at which a change needed buyers to accept again (floor, committed plays, delivery term, auction window). A buyer is "accepted" while its accepted_version >= reaccept_version.
ALTER TABLE buyers_lists ADD COLUMN term_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE buyers_lists ADD COLUMN reaccept_version INTEGER NOT NULL DEFAULT 1;
-- Append-only history: what changed, when, by whom.
CREATE TABLE buyers_list_term_versions (
  list_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  at TEXT NOT NULL,
  by_name TEXT NOT NULL,
  changes TEXT NOT NULL,
  requires_reacceptance INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (list_id, version)
);
CREATE TRIGGER buyers_list_term_versions_append_only BEFORE UPDATE ON buyers_list_term_versions
BEGIN
  SELECT RAISE(ABORT, 'Term versions are append-only.');
END;
-- Which version each named invited buyer (a DSP seat) has accepted.
CREATE TABLE buyers_list_acceptances (
  list_id TEXT NOT NULL,
  partner_id TEXT NOT NULL,
  seat_id TEXT NOT NULL,
  accepted_version INTEGER NOT NULL,
  accepted_at TEXT NOT NULL,
  PRIMARY KEY (list_id, partner_id, seat_id)
);
-- Backfill: every existing list is version 1, created when it was.
INSERT INTO buyers_list_term_versions (list_id, version, at, by_name, changes, requires_reacceptance)
SELECT id, 1, created_at, 'system (migration)', '[]', 0 FROM buyers_lists;
