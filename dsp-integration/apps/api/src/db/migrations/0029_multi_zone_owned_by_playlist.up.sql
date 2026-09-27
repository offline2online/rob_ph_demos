-- Multi-zone layout moves from the display type to its default playlist
-- (ticket "Add new playlist" from display type, 26 Sep 2026): zoning is a
-- decision the playlist makes — the same physical screen may be zoned three
-- ways by one playlist and run as a single canvas by another — while the
-- display type keeps only the physical truth (canvas size). Ratios/
-- percentages are unchanged; only which table stores them moves. Additive on
-- playlists (existing rows load unchanged with '{}' = single canvas);
-- display_types.multi_zone is superseded the same way migration 0017 retired
-- interactive_multiplier for interactive_cpe.
ALTER TABLE playlists ADD COLUMN multi_zone TEXT;
ALTER TABLE display_types DROP COLUMN multi_zone;
