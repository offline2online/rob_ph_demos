-- Multi-zone layout moves from the display type to its default playlist
-- (ticket "Add new playlist" from display type, 26 Sep 2026): zoning is a
-- decision the playlist makes — the same physical screen may be zoned three
-- ways by one playlist and run as a single canvas by another — while the
-- display type keeps only the physical truth (canvas size). Ratios/
-- percentages are unchanged; only which table stores them moves. Additive on
-- playlists (existing rows load unchanged with '{}' = single canvas);
-- display_types.multi_zone is superseded the same way migration 0017 retired
-- interactive_multiplier for interactive_cpe.
--
-- The layout is COPIED across before the old column goes (28 Sep 2026): the
-- first version of this migration only added the column and dropped the
-- old one, which on the hosted demo silently turned the three-zone Menu
-- Board into a single-zone screen the day it was finally deployed — its
-- zone playlists read as unused and every zone slot was gone. A display
-- type's zones go to its default playlist; where two display types share a
-- default playlist, the earlier row's layout wins (the same one the read
-- side would have resolved).
ALTER TABLE playlists ADD COLUMN multi_zone TEXT;
UPDATE playlists
   SET multi_zone = (SELECT dt.multi_zone FROM display_types dt
                      WHERE dt.default_playlist_id = playlists.id
                      ORDER BY dt.rowid LIMIT 1)
 WHERE id IN (SELECT default_playlist_id FROM display_types WHERE default_playlist_id IS NOT NULL);
ALTER TABLE display_types DROP COLUMN multi_zone;
