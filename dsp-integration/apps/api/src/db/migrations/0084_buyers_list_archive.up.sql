-- Deals are archived, never deleted (ticket bCcJ2e00CRLxtd98Utlr, 22 Oct 2026): an archived deal keeps its row, deal IDs, terms, history and bookings so campaigns, bookings and billing still resolve it. archived_by is the person's name, or 'system' when its flight ended and its last window was billed (domain/dealEnd.ts).
ALTER TABLE buyers_lists ADD COLUMN archived_at TEXT;
ALTER TABLE buyers_lists ADD COLUMN archived_by TEXT;
