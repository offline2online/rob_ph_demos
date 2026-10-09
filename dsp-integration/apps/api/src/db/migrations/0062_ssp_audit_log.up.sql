-- SSP settings audit log (ticket W9b1lEcTUbEMphsmBma3, 9 Oct 2026): one row per field changed on a retailer-side SSP setting (exchange, pricing and floors, buyers lists / deals, inventory and auction configuration, DSP bid settings), with who changed it (a human or an agent), the object and field, old and new value and when. Append-only: nothing in the API updates or deletes a row. Values are JSON text. seq is the insertion order (the tie-break for entries with the same timestamp).
CREATE TABLE ssp_audit_log (
  seq             INTEGER PRIMARY KEY,
  id              TEXT NOT NULL UNIQUE,
  at              TEXT NOT NULL,
  change_id       TEXT NOT NULL,
  actor_type      TEXT NOT NULL CHECK (actor_type IN ('human', 'agent')),
  actor_id        TEXT NOT NULL,
  actor_name      TEXT NOT NULL,
  session_user_id TEXT NOT NULL,
  request         TEXT NOT NULL,
  reason          TEXT,
  object_type     TEXT NOT NULL,
  object_id       TEXT NOT NULL,
  object_label    TEXT NOT NULL,
  change_type     TEXT NOT NULL CHECK (change_type IN ('created', 'updated', 'deleted')),
  field           TEXT NOT NULL,
  old_value       TEXT,
  new_value       TEXT
);
CREATE INDEX ssp_audit_log_at ON ssp_audit_log (at);
CREATE INDEX ssp_audit_log_object ON ssp_audit_log (object_type, object_id, field);
CREATE INDEX ssp_audit_log_actor ON ssp_audit_log (actor_type, actor_id);
