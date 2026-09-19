-- Which DSPs may target each shared variable: '"all"' or a JSON array of
-- partner ids ('[]' = none). A missing key takes the spec §6 default.
CREATE TABLE variable_access (
  variable_key TEXT PRIMARY KEY,
  access       TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
