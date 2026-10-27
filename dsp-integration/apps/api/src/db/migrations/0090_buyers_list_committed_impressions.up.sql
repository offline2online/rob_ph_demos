-- Programmatic guaranteed commits IMPRESSIONS, not plays (Rob, 28 Oct 2026; ticket jfQ4gbwnLCxVSR8ZeCP5). Derived from the assigned slots (per display, per open hour, plays x VAC-d, less the buffer) and stored beside committed_plays; filled on the next slot, term or buffer change and by the demo seed.
ALTER TABLE buyers_lists ADD COLUMN committed_impressions INTEGER;
